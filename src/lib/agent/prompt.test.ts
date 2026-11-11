import { describe, expect, it } from "vitest";
import { buildDraftPrompt } from "./prompt";

const base = { request: "Add CSV export", currentTitle: "", currentBody: "", previousRequests: [], context: "", attachedFiles: {} };

describe("buildDraftPrompt", () => {
  it("asks for a new issue when the draft is empty and omits empty sections", () => {
    const prompt = buildDraftPrompt(base);
    expect(prompt).toContain("Turn the user's request into a GitHub issue draft.");
    expect(prompt).toContain("## Latest request\n<untrusted-data>\nAdd CSV export\n</untrusted-data>");
    expect(prompt).toContain("Do not use em dash punctuation in generated text.");
    expect(prompt).not.toContain("Current draft");
    expect(prompt).not.toContain("Repository context");
  });

  it("revises the existing draft with history, attachments, and context as untrusted data", () => {
    const prompt = buildDraftPrompt({
      ...base,
      request: "Make the criteria stricter",
      currentTitle: "Add CSV export",
      currentBody: "## Context\nReports",
      previousRequests: ["Add CSV export"],
      context: "## src/reports.ts\nexport function report() {}",
      attachedFiles: { "src/export.ts": "export const x = 1;" },
    });
    expect(prompt).toContain("Revise the current GitHub issue draft");
    expect(prompt).toContain("## Current draft\n<untrusted-data>\n# Add CSV export\n\n## Context\nReports\n</untrusted-data>");
    expect(prompt).toContain("1. Add CSV export");
    expect(prompt).toContain("### src/export.ts\nexport const x = 1;");
    expect(prompt).toContain("## Repository context\n<untrusted-data>");
    expect(prompt.indexOf("Latest request")).toBeLessThan(prompt.indexOf("Files attached by the user"));
  });

  it("preserves a selected template's structure without trusting its contents", () => {
    const prompt = buildDraftPrompt({ ...base, currentTitle: "Bug report", currentBody: "## Expected behavior", preserveTemplate: true });
    expect(prompt).toContain("preserve the current template's headings, order, and checklists");
    expect(prompt).toContain("Do not use em dash punctuation in generated text.");
    expect(prompt).not.toContain("include `## Architecture`");
    expect(prompt).toContain("## Current draft\n<untrusted-data>");
  });
});
