import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ getConfig: vi.fn() }));
vi.mock("./github", () => ({
  getOpenPullRequestForBranch: vi.fn(),
  hasRepositorySecret: vi.fn(),
  listRepositoryFilePaths: vi.fn(),
  readRepoTextFile: vi.fn(),
}));

import { getRepositorySetup } from "./repo-setup";
import { getConfig } from "./config";
import { getOpenPullRequestForBranch, hasRepositorySecret, listRepositoryFilePaths, readRepoTextFile } from "./github";

describe("getRepositorySetup", () => {
  it("returns default arrays when the repository has no saved config", async () => {
    vi.mocked(getConfig).mockResolvedValue({
      githubToken: "token",
      githubAuth: null,
      openRouterApiKey: "",
      targetRepo: "owner/repo",
      baseBranch: "main",
      additionalContextPaths: [],
      models: { draft: "draft", plan: "plan", code: "code", review: "review" },
    });
    vi.mocked(readRepoTextFile).mockResolvedValue(null);
    vi.mocked(listRepositoryFilePaths).mockResolvedValue([]);
    vi.mocked(hasRepositorySecret).mockResolvedValue(false);
    vi.mocked(getOpenPullRequestForBranch).mockResolvedValue(null);

    const setup = await getRepositorySetup();

    expect(setup.settings.include).toEqual(["src", "docs"]);
    expect(setup.settings.exclude).toEqual(["node_modules", "dist", ".next", "coverage"]);
  });

  it("detects lockfile-aware commands for nested frontend and backend projects", async () => {
    vi.mocked(getConfig).mockResolvedValue({
      githubToken: "token",
      githubAuth: null,
      openRouterApiKey: "",
      targetRepo: "owner/repo",
      baseBranch: "main",
      additionalContextPaths: [],
      models: { draft: "draft", plan: "plan", code: "code", review: "review" },
    });
    const files: Record<string, string> = {
      "apps/portal/package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      "apps/portal/package-lock.json": "{}",
      "services/chat-api/package.json": JSON.stringify({ scripts: { build: "nest build", test: "jest" } }),
      "services/chat-api/npm-shrinkwrap.json": "{}",
    };
    vi.mocked(readRepoTextFile).mockImplementation(async (filePath) => files[filePath] ?? null);
    vi.mocked(listRepositoryFilePaths).mockResolvedValue(Object.keys(files));
    vi.mocked(hasRepositorySecret).mockResolvedValue(false);
    vi.mocked(getOpenPullRequestForBranch).mockResolvedValue(null);

    const setup = await getRepositorySetup();

    expect(setup.settings.installCommand).toBe("npm ci --prefix='apps/portal' && npm ci --prefix='services/chat-api'");
    expect(setup.settings.testCommand).toBe("npm run build --prefix='apps/portal' && npm run build --prefix='services/chat-api'");
  });
});