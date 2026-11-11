import "server-only";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AgentConfigFile } from "./types";

export const RUNTIME_SOURCE_PATH = path.join("src", "agent-runtime", "codeless-agent.mjs");

/**
 * Files that Praetor adds to a repository through a reviewed setup pull request. Each managed file starts
 * with a version stamp so the app can tell whether a repository's copy is missing, current, outdated, or
 * edited by hand.
 */

export const SETUP_FILES = {
  config: ".github/agent-config.json",
  runtime: ".github/praetor/agent.mjs",
  agentWorkflow: ".github/workflows/praetor-agent.yml",
  ciWorkflow: ".github/workflows/praetor-ci.yml",
} as const;

export const STARTER_ISSUE_TEMPLATES = [
  {
    path: ".github/ISSUE_TEMPLATE/bug-report.md",
    content: `---
name: Bug report
about: Report a reproducible problem
title: "[Bug]: "
---

## Summary
Describe the problem and its impact.

## Steps to reproduce
1. 
2. 
3. 

## Expected behavior
What did you expect to happen?

## Actual behavior
What happened instead?

## Environment
Include relevant versions, platform, or configuration.
`,
  },
  {
    path: ".github/ISSUE_TEMPLATE/feature-request.md",
    content: `---
name: Feature request
about: Propose an improvement
title: "[Feature]: "
---

## Problem
What need or pain point would this address?

## Proposed solution
Describe the behavior you would like.

## Alternatives considered
What other approaches have you considered?

## Acceptance criteria
- [ ] 
`,
  },
  {
    path: ".github/ISSUE_TEMPLATE/task.md",
    content: `---
name: Task
about: Track a focused piece of work
title: "Task: "
---

## Goal
What should be accomplished?

## Scope
List the expected work and any known exclusions.

## Acceptance criteria
- [ ] 

## Constraints and context
Add dependencies, risks, or relevant links.
`,
  },
] as const;

export function selectMissingStarterIssueTemplates(existingPaths: Iterable<string>) {
  const existing = new Set(existingPaths);
  return STARTER_ISSUE_TEMPLATES.filter((template) => !existing.has(template.path));
}

export type SetupFileKey = keyof typeof SETUP_FILES;

/** Bump a file's version whenever its generated content changes. */
export const SETUP_VERSIONS: Record<SetupFileKey, number> = { config: 1, runtime: 5, agentWorkflow: 4, ciWorkflow: 4 };

/** Old bootstrap paths removed when the Praetor setup is installed. */
export const LEGACY_SETUP_FILES = [
  ".github/workflows/agent-ci.yml",
  ".github/workflows/codeless-agent.yml",
  ".github/workflows/codeless-ci.yml",
  ".github/codeless/agent.mjs",
] as const;

export const AGENT_WORKFLOW_FILE = "praetor-agent.yml";
export const CI_WORKFLOW_FILE = "praetor-ci.yml";
export const SETUP_BRANCH = "codeless/setup";

const MANAGED_STAMP = /^(?:#|\/\/) (?:praetor|codeless)-managed: v(\d+)\b/;
const HASH_STAMP = /^(?:#|\/\/) (?:praetor|codeless)-hash: ([a-f0-9]{12})$/m;

export type BootstrapOptions = {
  baseBranch: string;
  contextSources?: AgentConfigFile["contextSources"];
  include?: string[];
  exclude?: string[];
  installCommand?: string;
  testCommand?: string;
  nodeVersion?: string;
};

function assertBranch(branch: string) {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) throw new Error("Invalid base branch name.");
}

function assertNodeVersion(version: string) {
  if (!/^[0-9]+(?:\.[0-9]+){0,2}$/.test(version)) throw new Error("Invalid Node.js version.");
}

/** Install and test commands run in CI; keep them to a single plain line. */
export function assertCommand(command: string, label: string) {
  if (!command.trim()) throw new Error(`${label} is required.`);
  if (command.length > 300 || /[\r\n\0]/.test(command)) throw new Error(`${label} must be a single line of at most 300 characters.`);
}

export function generateAgentConfig(options: BootstrapOptions): AgentConfigFile {
  const config: AgentConfigFile = {
    version: 1,
    include: options.include?.length ? options.include : ["src", "docs"],
    exclude: options.exclude?.length ? options.exclude : ["node_modules", "dist", ".next", "coverage"],
    installCommand: options.installCommand?.trim() || "npm ci",
    testCommand: options.testCommand?.trim() || "npm test --if-present",
    nodeVersion: options.nodeVersion ?? "22",
    baseBranch: options.baseBranch,
    contextSources: options.contextSources ?? [],
  };
  assertBranch(config.baseBranch);
  assertNodeVersion(config.nodeVersion);
  assertCommand(config.installCommand, "Install command");
  assertCommand(config.testCommand, "Test command");
  return config;
}

function stamp(body: string, version: number): string {
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  return `# praetor-managed: v${version}\n# praetor-hash: ${hash}\n${body}`;
}

/** Workflow that runs the Praetor agent. Every stage is started by a person, except CI repair. */
export function generateAgentWorkflow(options: Pick<BootstrapOptions, "nodeVersion">): string {
  const nodeVersion = options.nodeVersion ?? "22";
  assertNodeVersion(nodeVersion);
  return stamp(`# Added by Praetor. Update it from Praetor (Repository setup) instead of editing by hand.
name: Praetor agent
run-name: "Praetor \${{ inputs.stage || (github.event_name == 'pull_request' && 'merge') || 'repair' }} #\${{ inputs.issue || github.event.workflow_run.head_branch || github.event.pull_request.head.ref }}"

on:
  workflow_dispatch:
    inputs:
      stage:
        description: Stage to run
        required: true
        type: choice
        options: [plan, code, refine]
      issue:
        description: Issue number
        required: true
        type: string
      model:
        description: OpenRouter model ID (optional)
        required: false
        type: string
      review_model:
        description: OpenRouter model for the self-review (optional)
        required: false
        type: string
      instruction:
        description: Plan feedback or refinement request
        required: false
        type: string
      selected_code:
        description: Code the reviewer selected
        required: false
        type: string
  workflow_run:
    workflows: ["Praetor CI"]
    types: [completed]
  pull_request:
    types: [closed]

permissions:
  contents: write
  issues: write
  actions: write

concurrency:
  group: praetor-agent-\${{ inputs.issue || github.event.workflow_run.head_branch || github.event.pull_request.head.ref }}
  cancel-in-progress: false

jobs:
  agent:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'failure' && startsWith(github.event.workflow_run.head_branch, 'agent/issue-') && github.event.workflow_run.head_repository.full_name == github.repository) ||
      (github.event_name == 'pull_request' && github.event.pull_request.merged && startsWith(github.event.pull_request.head.ref, 'agent/issue-') && github.event.pull_request.head.repo.full_name == github.repository)
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.repository.default_branch }}
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: "${nodeVersion}"
      - name: Run the Praetor agent
        env:
          GITHUB_TOKEN: \${{ github.token }}
          OPENROUTER_API_KEY: \${{ secrets.OPENROUTER_API_KEY }}
          PRAETOR_STAGE: \${{ inputs.stage || (github.event_name == 'pull_request' && 'merged') || 'ci-fix' }}
          PRAETOR_ISSUE: \${{ inputs.issue }}
          PRAETOR_MODEL: \${{ inputs.model }}
          PRAETOR_REVIEW_MODEL: \${{ inputs.review_model }}
          PRAETOR_INSTRUCTION: \${{ inputs.instruction }}
          PRAETOR_SELECTED_CODE: \${{ inputs.selected_code }}
          PRAETOR_CI_RUN_ID: \${{ github.event.workflow_run.id }}
          PRAETOR_CI_BRANCH: \${{ github.event.workflow_run.head_branch }}
          PRAETOR_PR_BRANCH: \${{ github.event.pull_request.head.ref }}
        run: |
          if [ -z "$PRAETOR_ISSUE" ] && [ -n "$PRAETOR_CI_BRANCH" ]; then export PRAETOR_ISSUE="\${PRAETOR_CI_BRANCH#agent/issue-}"; fi
          node .github/praetor/agent.mjs run
`, SETUP_VERSIONS.agentWorkflow);
}

/** CI for pull requests and agent branches. Runs the commands from agent-config.json. */
export function generateCiWorkflow(options: BootstrapOptions): string {
  const config = generateAgentConfig(options);
  return stamp(`# Added by Praetor. Update it from Praetor (Repository setup) instead of editing by hand.
name: Praetor CI

on:
  pull_request:
    branches: [${JSON.stringify(config.baseBranch)}]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: praetor-ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: Install and test
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${JSON.stringify(config.nodeVersion)}
      - name: Install dependencies
        run: ${JSON.stringify(config.installCommand)}
      - name: Run tests
        run: ${JSON.stringify(config.testCommand)}
`, SETUP_VERSIONS.ciWorkflow);
}

let runtimeCache: string | null = null;

/** Source of the agent program committed to repositories. Read from the app's own files on the server. */
export function generateRuntime(): string {
  runtimeCache ??= readFileSync(path.join(process.cwd(), RUNTIME_SOURCE_PATH), "utf8");
  return runtimeCache;
}

export type SetupFile = { key: SetupFileKey; path: string; version: number; content: string; title: string; description: string };

export function generateSetupFiles(options: BootstrapOptions): SetupFile[] {
  const config = generateAgentConfig(options);
  return [
    { key: "config", path: SETUP_FILES.config, version: SETUP_VERSIONS.config, content: `${JSON.stringify(config, null, 2)}\n`, title: "Repository settings", description: "Folders the assistant reads and the commands CI runs." },
    { key: "agentWorkflow", path: SETUP_FILES.agentWorkflow, version: SETUP_VERSIONS.agentWorkflow, content: generateAgentWorkflow(config), title: "Agent workflow", description: "Runs planning, coding, review, and automatic CI repair in GitHub Actions." },
    { key: "runtime", path: SETUP_FILES.runtime, version: SETUP_VERSIONS.runtime, content: generateRuntime(), title: "Agent program", description: "The code the agent workflow runs. No dependencies." },
    { key: "ciWorkflow", path: SETUP_FILES.ciWorkflow, version: SETUP_VERSIONS.ciWorkflow, content: generateCiWorkflow(config), title: "Checks workflow", description: "Installs dependencies and runs your tests on every pull request." },
  ];
}

export type SetupFileStatus = "current" | "missing" | "outdated" | "modified" | "invalid";

export type SetupFileReport = {
  key: SetupFileKey;
  path: string;
  title: string;
  status: SetupFileStatus;
  installedVersion: number | null;
  latestVersion: number;
};

/** Version stamped into a managed file, or null when the file is not managed by Praetor. */
export function readManagedVersion(content: string): number | null {
  const match = MANAGED_STAMP.exec(content);
  return match ? Number(match[1]) : null;
}

function wasEditedByHand(content: string): boolean {
  const hash = HASH_STAMP.exec(content)?.[1];
  if (!hash) return false;
  const body = content.split("\n").slice(2).join("\n");
  return createHash("sha256").update(body).digest("hex").slice(0, 12) !== hash;
}

/** Compares a repository's files with what Praetor would generate today. */
export function compareSetupFile(key: SetupFileKey, existing: string | null, latestVersion: number, parseConfig: (text: string) => boolean): Omit<SetupFileReport, "path" | "title"> {
  const base = { key, latestVersion };
  if (existing === null) return { ...base, status: "missing", installedVersion: null };
  if (key === "config") {
    if (!parseConfig(existing)) return { ...base, status: "invalid", installedVersion: null };
    return { ...base, status: "current", installedVersion: latestVersion };
  }
  const installed = readManagedVersion(existing);
  if (installed === null) return { ...base, status: "invalid", installedVersion: null };
  if (installed < latestVersion) return { ...base, status: "outdated", installedVersion: installed };
  if (key !== "runtime" && wasEditedByHand(existing)) return { ...base, status: "modified", installedVersion: installed };
  return { ...base, status: "current", installedVersion: installed };
}

export type SetupSummary = "ready" | "missing" | "outdated";

export function summarizeSetup(files: SetupFileReport[], hasOpenRouterSecret: boolean): SetupSummary {
  if (files.some((file) => file.status === "missing" || file.status === "invalid")) return "missing";
  if (!hasOpenRouterSecret) return "missing";
  if (files.some((file) => file.status === "outdated")) return "outdated";
  return "ready";
}