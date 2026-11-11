import { describe, expect, it, vi } from "vitest";
import { filterRepoFiles, isPreviewableRepoPath } from "./repo";

vi.mock("server-only", () => ({}));

describe("repository file filters", () => {
  it("includes configured roots and excludes generated folders", () => {
    expect(filterRepoFiles(
      ["src/app.ts", "docs/guide.md", "node_modules/pkg/index.js", "README.md"],
      ["src", "docs"],
      [],
    )).toEqual(["src/app.ts", "docs/guide.md"]);
  });

  it("rejects traversal and git metadata", () => {
    expect(() => filterRepoFiles(["src/../secret.txt"], ["src"], [])).toThrow("Repository path must be relative");
    expect(() => filterRepoFiles([".git/config"], ["."], [])).toThrow("Repository path must be relative");
  });

  it("excludes likely secrets from indexed files", () => {
    expect(filterRepoFiles(["src/app.ts", "src/.env.local", "docs/server.pem", "src/credentials.json"], ["src", "docs"], []))
      .toEqual(["src/app.ts"]);
  });

  it("allows previews only for safe repository-relative files", () => {
    expect(isPreviewableRepoPath("src/app.ts")).toBe(true);
    expect(["../secret", ".git/config", ".github/workflows/deploy.yml", ".env.local", "docs/server.pem"]
      .every((filePath) => !isPreviewableRepoPath(filePath))).toBe(true);
  });
});