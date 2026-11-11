import { describe, expect, it, vi } from "vitest";
import { contextSources, formatRetrievedChunks, isSensitivePath, MAX_ATTACHED_FILES, selectAttachableFiles } from "./context";
import type { RetrievedChunk } from "../types";

vi.mock("server-only", () => ({}));

const chunks: RetrievedChunk[] = [
  { id: "a", repoKey: "owner/repo", path: "src/a.ts", startLine: 1, endLine: 2, symbol: "a", text: "first", contentHash: "a", score: -0.1 },
  { id: "b", repoKey: "owner/repo", path: "src/a.ts", startLine: 3, endLine: 4, symbol: "b", text: "second", contentHash: "b", score: -0.2 },
  { id: "c", repoKey: "owner/repo", path: "src/b.ts", startLine: 1, endLine: 2, symbol: "c", text: "third", contentHash: "c", score: -0.3 },
];

describe("retrieved context formatting", () => {
  it("groups chunks by file and respects the character budget", () => {
    const context = formatRetrievedChunks(chunks, 75);
    expect(context).toContain("## src/a.ts");
    expect(context).toContain("first");
    expect(context.length).toBeLessThanOrEqual(75);
  });

  it("lists unique source paths in retrieval order", () => {
    expect(contextSources(chunks)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("keeps repository identity in citations for external sources", () => {
    const mixed = [...chunks, { ...chunks[0]!, id: "external", repoKey: "owner/docs" }];
    expect(formatRetrievedChunks(mixed, undefined, "owner/repo")).toContain("## owner/docs/src/a.ts");
    expect(contextSources(mixed, "owner/repo")).toEqual(["src/a.ts", "src/b.ts", "owner/docs/src/a.ts"]);
  });
});

describe("attached context files", () => {
  it("flags secrets, traversal, and absolute paths", () => {
    expect(isSensitivePath("src/app.ts")).toBe(false);
    expect(isSensitivePath(".env.local")).toBe(true);
    expect(isSensitivePath("config/server.pem")).toBe(true);
    expect(isSensitivePath("../outside.ts")).toBe(true);
    expect(isSensitivePath("/etc/passwd")).toBe(true);
    expect(isSensitivePath(".git/config")).toBe(true);
  });

  it("accepts only indexed, non-sensitive files up to the limit", () => {
    const indexed = ["src/a.ts", "src/b.ts", "src/.env", ...Array.from({ length: 10 }, (_, index) => `src/f${index}.ts`)];
    expect(selectAttachableFiles(["src/a.ts", "src/missing.ts", "src/.env", "src/a.ts"], indexed)).toEqual({
      accepted: ["src/a.ts"],
      rejected: ["src/missing.ts", "src/.env"],
    });
    const many = selectAttachableFiles(indexed.filter((file) => file.includes("/f")), indexed);
    expect(many.accepted).toHaveLength(MAX_ATTACHED_FILES);
    expect(many.rejected).toHaveLength(10 - MAX_ATTACHED_FILES);
  });
});