import "server-only";

import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";
import { getConfig } from "./config";
import { agentConfigFileSchema, repoNameSchema } from "./schemas";
import { getGitHubToken } from "./github-auth";
import type { AgentConfigFile } from "./types";

const DEFAULT_EXCLUDE = ["node_modules", "dist", ".next", ".git", "coverage"];
const SENSITIVE_FILE_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)(secrets?|credentials?)(\.[a-z]+)?$/i,
];

function dataDirectory(): string {
  return path.resolve(process.env.DATA_DIR ?? (process.env.DOCKER === "1" ? "/data" : ".data"));
}

function repoDirectory(repoName: string): string {
  const [owner, repo] = repoNameSchema.parse(repoName).split("/");
  return path.join(dataDirectory(), "repos", `${owner}__${repo}`);
}

function askpassEnvironment(token: string) {
  return async <T>(run: (env: Record<string, string>) => Promise<T>): Promise<T> => {
    const script = path.join(os.tmpdir(), `codeless-git-askpass-${randomUUID()}.sh`);
    await writeFile(script, '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$GITHUB_TOKEN" ;;\nesac\n', { mode: 0o700 });
    try {
      return await run({ GIT_ASKPASS: script, GITHUB_TOKEN: token, GIT_TERMINAL_PROMPT: "0" });
    } finally {
      await rm(script, { force: true });
    }
  };
}

async function withAuthenticatedGit<T>(directory: string, run: (git: ReturnType<typeof simpleGit>) => Promise<T>): Promise<T> {
  const token = await getGitHubToken();
  const execute = await askpassEnvironment(token);
  try {
    return await execute(async (env) => run(simpleGit({
      baseDir: directory,
      binary: "git",
      allowEnvironment: ["GIT_ASKPASS", "GIT_TERMINAL_PROMPT"],
      unsafe: { allowUnsafeAskPass: true },
    }).env(env)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = message
      .replaceAll(token, "[redacted]")
      .replace(/https?:\/\/[^\s/@]+@/g, "https://[redacted]@");
    throw new Error(`GitHub repository operation failed: ${safeMessage.slice(0, 800)}`);
  }
}

export async function ensureClone(repoName?: string): Promise<string> {
  const config = await getConfig();
  const repository = repoNameSchema.parse(repoName ?? config.targetRepo);
  const destination = repoDirectory(repository);
  try {
    await access(path.join(destination, ".git"));
    return destination;
  } catch {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  }

  const remote = `https://github.com/${repository}.git`;
  await withAuthenticatedGit(path.dirname(destination), async (git) => {
    await git.clone(remote, destination, ["--quiet"]);
    await git.cwd(destination).remote(["set-url", "origin", remote]);
  });
  return destination;
}

export async function pull(branch?: string): Promise<void> {
  const config = await getConfig();
  await pullRepository(config.targetRepo, branch ?? config.baseBranch);
}

export async function pullRepository(repoName: string, branch?: string): Promise<void> {
  const repository = repoNameSchema.parse(repoName);
  const destination = await ensureClone(repository);
  await withAuthenticatedGit(destination, async (git) => {
    await git.fetch("origin");
    if (branch) {
      await git.checkout(branch);
      await git.pull("origin", branch);
    } else {
      await git.pull();
    }
  });
}

export async function getHeadSha(repoName?: string): Promise<string> {
  const destination = await ensureClone(repoName);
  return (await simpleGit(destination).revparse(["HEAD"])).trim();
}

export async function getChangedFilesSince(commit: string, repoName?: string): Promise<string[]> {
  if (!/^[a-f0-9]{40,64}$/i.test(commit)) throw new Error("Index commit is invalid.");
  const destination = await ensureClone(repoName);
  const changed = await simpleGit(destination).raw(["diff", "--name-only", `${commit}..HEAD`]);
  return changed.split("\n").filter(Boolean);
}

function validateRepoPath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === ".git")) {
    throw new Error("Repository path must be relative and cannot access .git or parent directories.");
  }
  return normalized;
}

export function isSensitiveRepoPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return true;
  if (normalized.split("/").some((segment) => segment === ".." || segment === ".git")) return true;
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isPreviewableRepoPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  if (isSensitiveRepoPath(normalized)) return false;
  if (normalized.split("/").some((segment) => !segment || segment === ".")) return false;
  if (/^\.github\/workflows(?:\/|$)/i.test(normalized)) return false;
  return true;
}

export async function readRepoFile(relativePath: string, repoName?: string): Promise<string> {
  const destination = await ensureClone(repoName);
  const safePath = validateRepoPath(relativePath);
  const absolutePath = path.resolve(destination, safePath);
  if (!absolutePath.startsWith(`${destination}${path.sep}`)) throw new Error("Repository path escaped the clone directory.");
  const [cloneRoot, resolvedPath] = await Promise.all([realpath(destination), realpath(absolutePath)]);
  if (!resolvedPath.startsWith(`${cloneRoot}${path.sep}`)) throw new Error("Repository file escaped the clone directory.");
  return readFile(resolvedPath, "utf8");
}

function pathMatches(filePath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const normalized = root.replace(/^\.\//, "").replace(/\/$/, "");
    return filePath === normalized || filePath.startsWith(`${normalized}/`);
  });
}

export function filterRepoFiles(filePaths: string[], include: string[], exclude: string[]): string[] {
  const allowed = include.length ? include : ["."];
  return filePaths
    .map(validateRepoPath)
    .filter((filePath) => !isSensitiveRepoPath(filePath))
    .filter((filePath) => pathMatches(filePath, allowed))
    .filter((filePath) => !pathMatches(filePath, [...DEFAULT_EXCLUDE, ...exclude]));
}

export async function listFiles(include: string[], exclude: string[], repoName?: string): Promise<string[]> {
  const destination = await ensureClone(repoName);
  const files = await simpleGit(destination).raw(["ls-files", "--cached"]);
  return filterRepoFiles(files.split("\n").filter(Boolean), include, exclude);
}

export async function readAgentConfig(): Promise<{ config: AgentConfigFile; bootstrapped: boolean }> {
  const config = await getConfig();
  try {
    const contents = await readRepoFile(".github/agent-config.json");
    return { config: agentConfigFileSchema.parse(JSON.parse(contents)), bootstrapped: true };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Repository agent-config.json is not valid JSON.");
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        config: {
          version: 1,
          include: ["src", "docs"],
          exclude: DEFAULT_EXCLUDE,
          installCommand: "npm ci",
          testCommand: "npm test --if-present",
          nodeVersion: "22",
          baseBranch: config.baseBranch,
          contextSources: [],
        },
        bootstrapped: false,
      };
    }
    throw error;
  }
}