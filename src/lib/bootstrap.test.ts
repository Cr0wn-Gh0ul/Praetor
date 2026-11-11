import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  LEGACY_SETUP_FILES,
  SETUP_FILES,
  SETUP_VERSIONS,
  STARTER_ISSUE_TEMPLATES,
  assertCommand,
  compareSetupFile,
  generateAgentConfig,
  generateAgentWorkflow,
  generateCiWorkflow,
  generateSetupFiles,
  readManagedVersion,
  selectMissingStarterIssueTemplates,
  summarizeSetup,
  type SetupFileReport,
} from "./bootstrap";
import { agentConfigFileSchema } from "./schemas";
import { parseIssueTemplate } from "./issue-templates";

const parseConfig = (text: string) => {
  try {
    return agentConfigFileSchema.safeParse(JSON.parse(text)).success;
  } catch {
    return false;
  }
};

describe("agent config", () => {
  it("generates a valid default agent config", () => {
    expect(generateAgentConfig({ baseBranch: "main" })).toEqual({
      version: 1,
      include: ["src", "docs"],
      exclude: ["node_modules", "dist", ".next", "coverage"],
      installCommand: "npm ci",
      testCommand: "npm test --if-present",
      nodeVersion: "22",
      baseBranch: "main",
      contextSources: [],
    });
  });

  it("accepts scoped context sources and rejects unsafe repository paths", () => {
    const config = generateAgentConfig({ baseBranch: "main" });
    const contextSources = [{ repo: "owner/docs", paths: ["docs", "guides/setup.md"] }];
    expect(agentConfigFileSchema.safeParse({ ...config, contextSources }).success).toBe(true);
    expect(generateAgentConfig({ baseBranch: "main", contextSources }).contextSources).toEqual(contextSources);
    expect(agentConfigFileSchema.safeParse({ ...config, contextSources: [{ repo: "owner/docs", paths: ["../secrets"] }] }).success).toBe(false);
    expect(agentConfigFileSchema.safeParse({ ...config, contextSources: [{ repo: "owner/docs", paths: ["/.env"] }] }).success).toBe(false);
    expect(agentConfigFileSchema.safeParse({ ...config, contextSources: [{ repo: "owner/docs", paths: [".git/config"] }] }).success).toBe(false);
  });

  it("rejects unsafe branches, versions, and commands", () => {
    expect(() => generateAgentConfig({ baseBranch: "main\n  malicious: true" })).toThrow("Invalid base branch");
    expect(() => generateAgentConfig({ baseBranch: "../main" })).toThrow("Invalid base branch");
    expect(() => generateAgentConfig({ baseBranch: "main", nodeVersion: "22; rm -rf /" })).toThrow("Invalid Node.js version");
    expect(() => generateAgentConfig({ baseBranch: "main", testCommand: "npm test\ncurl evil" })).toThrow("single line");
    expect(() => assertCommand("   ", "Install command")).toThrow("Install command is required");
    expect(() => assertCommand("x".repeat(301), "Test command")).toThrow("300 characters");
  });
});

describe("generated setup files", () => {
  it("returns every managed file with its current version", () => {
    const files = generateSetupFiles({ baseBranch: "main" });
    expect(files.map((file) => file.path).sort()).toEqual(Object.values(SETUP_FILES).sort());
    expect(SETUP_FILES).toMatchObject({
      runtime: ".github/praetor/agent.mjs",
      agentWorkflow: ".github/workflows/praetor-agent.yml",
      ciWorkflow: ".github/workflows/praetor-ci.yml",
    });
    expect(LEGACY_SETUP_FILES).toContain(".github/workflows/codeless-agent.yml");
    expect(LEGACY_SETUP_FILES).toContain(".github/workflows/codeless-ci.yml");
    for (const file of files) {
      expect(file.version).toBe(SETUP_VERSIONS[file.key]);
      if (file.key !== "config") expect(readManagedVersion(file.content)).toBe(SETUP_VERSIONS[file.key]);
    }
    expect(parseConfig(files.find((file) => file.key === "config")!.content)).toBe(true);
  });

  it("quotes CI commands and the base branch", () => {
    const workflow = generateCiWorkflow({ baseBranch: "release/1.x", installCommand: "pnpm i", testCommand: "pnpm test" });
    expect(workflow).toContain('branches: ["release/1.x"]');
    expect(workflow).toContain('run: "pnpm i"');
    expect(workflow).toContain('run: "pnpm test"');
    expect(workflow).toContain("workflow_dispatch:");
  });

  it("names the agent workflow so CI status can exclude it", () => {
    const workflow = generateAgentWorkflow({ nodeVersion: "20" });
    expect(workflow).toContain("name: Praetor agent");
    expect(workflow).toContain('workflows: ["Praetor CI"]');
    expect(workflow).toContain('node-version: "20"');
    expect(workflow).toContain("secrets.OPENROUTER_API_KEY");
    expect(workflow).toContain("PRAETOR_STAGE:");
    expect(workflow).toContain("node .github/praetor/agent.mjs run");
    expect(workflow).not.toMatch(/codeless/i);
  });

  it("uses Praetor naming for CI workflow concurrency", () => {
    const workflow = generateCiWorkflow({ baseBranch: "main" });
    expect(workflow).toContain("group: praetor-ci-");
    expect(workflow).not.toMatch(/codeless/i);
  });
});

describe("starter issue templates", () => {
  it("generates valid bug, feature, and task templates", () => {
    expect(STARTER_ISSUE_TEMPLATES).toHaveLength(3);
    for (const template of STARTER_ISSUE_TEMPLATES) {
      const filename = template.path.split("/").at(-1)!;
      expect(parseIssueTemplate(template.path, filename, template.content)).not.toBeNull();
    }
  });

  it("selects only template paths missing from the repository", () => {
    const existing = STARTER_ISSUE_TEMPLATES[0].path;
    expect(selectMissingStarterIssueTemplates([existing]).map((template) => template.path))
      .toEqual(STARTER_ISSUE_TEMPLATES.slice(1).map((template) => template.path));
  });
});

describe("compareSetupFile", () => {
  const ci = generateCiWorkflow({ baseBranch: "main" });

  it("reports missing files", () => {
    expect(compareSetupFile("ciWorkflow", null, 2, parseConfig)).toMatchObject({ status: "missing", installedVersion: null });
  });

  it("reports outdated files", () => {
    const old = ci.replace(/^# praetor-managed: v\d+/, "# praetor-managed: v1");
    expect(compareSetupFile("ciWorkflow", old, 2, parseConfig)).toMatchObject({ status: "outdated", installedVersion: 1 });
  });

  it("continues to read managed versions from older Codeless files", () => {
    expect(readManagedVersion("# codeless-managed: v3\n# codeless-hash: 0123456789ab\n" )).toBe(3);
  });

  it("reports files edited by hand", () => {
    const edited = ci.replace("timeout-minutes: 30", "timeout-minutes: 90");
    expect(compareSetupFile("ciWorkflow", edited, SETUP_VERSIONS.ciWorkflow, parseConfig)).toMatchObject({ status: "modified" });
  });

  it("reports current files", () => {
    expect(compareSetupFile("ciWorkflow", ci, SETUP_VERSIONS.ciWorkflow, parseConfig)).toMatchObject({ status: "current", installedVersion: SETUP_VERSIONS.ciWorkflow });
    const config = `${JSON.stringify(generateAgentConfig({ baseBranch: "main" }))}\n`;
    expect(compareSetupFile("config", config, 1, parseConfig)).toMatchObject({ status: "current" });
  });

  it("reports unmanaged or unparsable files as invalid", () => {
    expect(compareSetupFile("ciWorkflow", "name: CI\n", 2, parseConfig)).toMatchObject({ status: "invalid" });
    expect(compareSetupFile("config", "{not json", 1, parseConfig)).toMatchObject({ status: "invalid" });
  });
});

describe("summarizeSetup", () => {
  const report = (status: SetupFileReport["status"]): SetupFileReport => ({ key: "ciWorkflow", path: SETUP_FILES.ciWorkflow, title: "Checks", status, installedVersion: 1, latestVersion: 2 });

  it("needs every file and the OpenRouter secret", () => {
    expect(summarizeSetup([report("current")], true)).toBe("ready");
    expect(summarizeSetup([report("modified")], true)).toBe("ready");
    expect(summarizeSetup([report("current")], false)).toBe("missing");
    expect(summarizeSetup([report("missing")], true)).toBe("missing");
    expect(summarizeSetup([report("invalid")], true)).toBe("missing");
    expect(summarizeSetup([report("outdated")], true)).toBe("outdated");
  });
});
