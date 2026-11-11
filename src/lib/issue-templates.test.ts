import { describe, expect, it } from "vitest";
import { parseIssueTemplate } from "./issue-templates";

describe("parseIssueTemplate", () => {
  it("parses Markdown front matter and preserves its body", () => {
    expect(parseIssueTemplate(".github/ISSUE_TEMPLATE/bug.md", "bug.md", "---\nname: Bug report\ntitle: '[Bug]: '\nlabels: bug, triage\n---\n## What happened?\n"))
      .toEqual({ id: ".github/ISSUE_TEMPLATE/bug.md", name: "Bug report", title: "[Bug]:", body: "## What happened?", labels: ["bug", "triage"] });
  });

  it("builds a Markdown scaffold from a YAML issue form", () => {
    const source = [
      "name: Feature request",
      "title: '[Feature]: '",
      "labels: [enhancement, triage]",
      "body:",
      "  - type: textarea",
      "    id: problem",
      "    attributes:",
      "      label: Problem",
      "      description: What should improve?",
      "      placeholder: Describe the problem",
      "    validations:",
      "      required: true",
      "  - type: checkboxes",
      "    id: acceptance",
      "    attributes:",
      "      label: Acceptance criteria",
      "      options:",
      "        - label: Add a test",
      "        - label: Update documentation",
    ].join("\n");
    expect(parseIssueTemplate(".github/ISSUE_TEMPLATE/feature.yml", "feature.yml", source)).toEqual({
      id: ".github/ISSUE_TEMPLATE/feature.yml",
      name: "Feature request",
      title: "[Feature]:",
      body: "## Problem\n\nWhat should improve?\n\n## Acceptance criteria\n\n- [ ] Add a test\n- [ ] Update documentation",
      labels: ["enhancement", "triage"],
    });
  });

  it("ignores malformed templates", () => {
    expect(parseIssueTemplate("bad.md", "bad.md", "---\nname: [\n---\nBody")).toBeNull();
  });
});
