import { describe, expect, it } from "vitest";
import { extractPlannedPaths, validateGeneratedChanges } from "./code-safety";

describe("code generation path safety", () => {
  it("extracts repo-relative paths from the plan section", () => {
    expect(extractPlannedPaths("## Files to change\n- `src/lib/foo.ts`: update helper\n- README.md"))
      .toEqual(["src/lib/foo.ts", "README.md"]);
  });

  it("accepts only approved paths and rejects sensitive destinations", () => {
    expect(validateGeneratedChanges(["src/foo.ts"], [{ path: "src/foo.ts", action: "update", content: "ok" }])).toHaveLength(1);
    expect(() => validateGeneratedChanges(["src/foo.ts"], [{ path: "../secret", action: "delete" }])).toThrow("not allowed");
    expect(() => validateGeneratedChanges([".github/workflows/ci.yml"], [{ path: ".github/workflows/ci.yml", action: "delete" }])).toThrow("human-reviewed");
    expect(() => validateGeneratedChanges(["src/foo.ts"], [{ path: "src/bar.ts", action: "delete" }])).toThrow("not approved");
  });
});