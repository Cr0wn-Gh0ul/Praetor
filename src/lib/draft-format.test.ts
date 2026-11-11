import { describe, expect, it } from "vitest";
import { issueFromDraft, splitIssueMarkdown } from "./draft-format";

describe("splitIssueMarkdown", () => {
  it("extracts a leading H1 as the title", () => {
    expect(splitIssueMarkdown("# Add CSV export\n\n## Context\nUsers need it.")).toEqual({
      title: "Add CSV export",
      body: "## Context\nUsers need it.",
    });
  });

  it("keeps documents without a leading H1 intact", () => {
    expect(splitIssueMarkdown("Intro\n\n# Not a title")).toEqual({ title: "", body: "Intro\n\n# Not a title" });
  });

  it("unwraps fenced output and handles a literal Title heading", () => {
    expect(splitIssueMarkdown("```markdown\n# Title\nFix login redirect\n\n## Context\nx\n```")).toEqual({
      title: "Fix login redirect",
      body: "## Context\nx",
    });
  });

  it("returns empty parts for empty input", () => {
    expect(splitIssueMarkdown("  \n ")).toEqual({ title: "", body: "" });
  });
});

describe("issueFromDraft", () => {
  it("prefers the explicit title and leaves body headings alone", () => {
    expect(issueFromDraft({ title: "Explicit", body: "## Context\n\n# Later heading" })).toEqual({
      title: "Explicit",
      body: "## Context\n\n# Later heading",
    });
  });

  it("removes a legacy H1 from the body", () => {
    expect(issueFromDraft({ title: "", body: "# Legacy title\n\nBody" })).toEqual({ title: "Legacy title", body: "Body" });
    expect(issueFromDraft({ title: "Saved", body: "# Legacy title\n\nBody" })).toEqual({ title: "Saved", body: "Body" });
  });
});
