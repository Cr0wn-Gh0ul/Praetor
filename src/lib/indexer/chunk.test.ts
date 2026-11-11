import { describe, expect, it } from "vitest";
import { chunkMarkdown, chunkPlainText, shouldIndexFile } from "./chunk";
import { chunkSourceFile } from "./ts-morph";

describe("source chunking", () => {
  it("extracts TypeScript declarations and a file overview", () => {
    const chunks = chunkSourceFile("src/example.ts", [
      'import { helper } from "./helper";',
      "export interface Options { enabled: boolean }",
      "export const DEFAULT_ENABLED = true;",
      "export function runTask() { return helper(); }",
    ].join("\n"));

    expect(chunks.map((chunk) => chunk.symbol)).toEqual(expect.arrayContaining([
      "file overview",
      "Options",
      "DEFAULT_ENABLED",
      "runTask",
    ]));
    expect(chunks.every((chunk) => chunk.text.length <= 2_000 && chunk.contentHash.length === 64)).toBe(true);
    expect(chunks[0]?.text).toContain("./helper");
  });

  it("splits Markdown by headings and plain text into overlapping windows", () => {
    const markdown = chunkMarkdown("README.md", "# One\nalpha\n## Two\nbeta");
    expect(markdown.map((chunk) => chunk.symbol)).toEqual(["One", "Two"]);

    const text = chunkPlainText("notes.txt", Array.from({ length: 110 }, (_, index) => `line ${index + 1}`).join("\n"));
    expect(text).toHaveLength(3);
    expect(text[0]?.startLine).toBe(1);
    expect(text[1]?.startLine).toBe(51);
    expect(text[0]?.text).toContain("line 51");
  });

  it("skips oversized, binary, generated, and lock files", () => {
    expect(shouldIndexFile("src/big.ts", 256 * 1024 + 1)).toBe(false);
    expect(shouldIndexFile("src/image.png", 20)).toBe(false);
    expect(shouldIndexFile("node_modules/pkg/index.js", 20)).toBe(false);
    expect(shouldIndexFile("package-lock.json", 20)).toBe(false);
  });
});