import { describe, expect, it } from "vitest";
import { languageFromPath } from "./language";

describe("editor language detection", () => {
  it("detects common languages from nested repository paths", () => {
    expect(languageFromPath("src/components/App.tsx")).toBe("typescript");
    expect(languageFromPath(".github/workflows/test.yml")).toBe("yaml");
    expect(languageFromPath("docs/guide.md")).toBe("markdown");
  });

  it("supports extensionless build files and unknown extensions", () => {
    expect(languageFromPath("Dockerfile")).toBe("dockerfile");
    expect(languageFromPath("assets/logo.webp")).toBe("plaintext");
  });
});