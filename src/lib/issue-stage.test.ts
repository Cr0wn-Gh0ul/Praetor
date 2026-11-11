import { describe, expect, it } from "vitest";
import { ISSUE_PIPELINE_STAGES, ISSUE_STATE_TITLES, issueMatchesStage, parseIssueStageFilter } from "./issue-stage";

describe("issue pipeline stages", () => {
  it("groups issues by their pipeline stage", () => {
    expect(issueMatchesStage(["bug"], "issue")).toBe(true);
    expect(issueMatchesStage(["agent: planning"], "plan")).toBe(true);
    expect(issueMatchesStage(["agent: plan-approved"], "build")).toBe(true);
    expect(issueMatchesStage(["agent: plan-approved"], "plan")).toBe(false);
    expect(issueMatchesStage(["agent: coding"], "build")).toBe(true);
    expect(issueMatchesStage(["agent: code-review"], "review")).toBe(true);
    expect(issueMatchesStage(["agent: pr-created"], "pull-request")).toBe(true);
    expect(issueMatchesStage(["agent: needs-human"], "needs-attention")).toBe(true);
    expect(issueMatchesStage(["agent: done"], "done")).toBe(true);
  });

  it("distinguishes a plan ready for a build from a build that was started", () => {
    expect(ISSUE_STATE_TITLES["plan-approved"]).toBe("Ready to build");
    expect(ISSUE_STATE_TITLES.coding).toBe("Build started");
  });

  it("routes conflicting agent labels to attention instead of treating them as new issues", () => {
    const labels = ["agent: planning", "agent: coding"];
    expect(issueMatchesStage(labels, "issue")).toBe(false);
    expect(issueMatchesStage(labels, "needs-attention")).toBe(true);
    expect(issueMatchesStage(["agent: future-state"], "needs-attention")).toBe(true);
  });

  it("assigns each known agent state to exactly one pipeline stage", () => {
    const states = ["planning", "plan-approved", "coding", "code-review", "pr-created", "needs-human", "done"];
    for (const state of states) {
      const matches = ISSUE_PIPELINE_STAGES.filter(({ id }) => issueMatchesStage([`agent: ${state}`], id));
      expect(matches, state).toHaveLength(1);
    }
  });

  it("keeps old stage URLs working", () => {
    expect(parseIssueStageFilter("create")).toBe("build");
    expect(parseIssueStageFilter("merge")).toBe("pull-request");
    expect(parseIssueStageFilter("needs-attention")).toBe("needs-attention");
  });
});