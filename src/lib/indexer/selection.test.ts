import { describe, expect, it } from "vitest";
import { getIndexChanges, mergeIndexIncludePaths } from "./selection";

describe("index selection", () => {
  it("merges local context paths without duplicates", () => {
    expect(mergeIndexIncludePaths(["src", "docs"], ["docs", "configs/app.json"]))
      .toEqual(["src", "docs", "configs/app.json"]);
  });

  it("re-indexes newly included files as well as changed and removed files", () => {
    expect(getIndexChanges(["src/old.ts", "src/current.ts"], ["src/current.ts", "docs/new.md"], ["src/current.ts"]))
      .toEqual(["src/current.ts", "docs/new.md", "src/old.ts"]);
  });
});