import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVectorStore } from "./lancedb";
import type { CodeChunk } from "./types";

vi.mock("server-only", () => ({}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function makeChunk(text: string, vector: number[]): CodeChunk {
  return {
    id: "src/file.ts:1:function",
    repoKey: "owner/repo",
    path: "src/file.ts",
    startLine: 1,
    endLine: 3,
    symbol: "function",
    text,
    contentHash: text,
    vector,
  };
}

describe("LanceDB vector store", () => {
  it("upserts file chunks, searches, deletes files, and drops the repo table", async () => {
    const databasePath = await mkdtemp(path.join(os.tmpdir(), "codeless-lance-"));
    temporaryDirectories.push(databasePath);
    const store = createVectorStore(databasePath);

    await store.upsertFileChunks("owner/repo", "src/file.ts", [makeChunk("old", [1, 0])]);
    await store.upsertFileChunks("owner/repo", "src/file.ts", [makeChunk("new", [0, 1])]);

    const results = await store.search("owner/repo", [0, 1], 4);
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("new");

    await store.deleteFiles("owner/repo", ["src/file.ts"]);
    expect(await store.search("owner/repo", [0, 1], 4)).toEqual([]);
    await store.dropTable("owner/repo");
  });
});