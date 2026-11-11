import { describe, expect, it } from "vitest";
import { ciStatusFromRuns, excludeAgentRuns, type WorkflowRunSummary } from "./ci-status";

function run(overrides: Partial<WorkflowRunSummary>): WorkflowRunSummary {
  return { id: 1, name: "Praetor CI", workflowId: 10, status: "completed", conclusion: "success", headSha: "abc", createdAt: "2026-01-01T00:00:00Z", ...overrides };
}

describe("ciStatusFromRuns", () => {
  it("is unknown without runs for the commit", () => {
    expect(ciStatusFromRuns([], "abc")).toBe("unknown");
    expect(ciStatusFromRuns([run({ headSha: "other" })], "abc")).toBe("unknown");
  });

  it("uses only the latest run of each workflow", () => {
    const runs = [
      run({ id: 1, conclusion: "failure", createdAt: "2026-01-01T00:00:00Z" }),
      run({ id: 2, conclusion: "success", createdAt: "2026-01-01T01:00:00Z" }),
    ];
    expect(ciStatusFromRuns(runs, "abc")).toBe("success");
  });

  it("fails when any workflow fails and waits while any is running", () => {
    expect(ciStatusFromRuns([run({}), run({ id: 3, workflowId: 11, conclusion: "failure" })], "abc")).toBe("failure");
    expect(ciStatusFromRuns([run({}), run({ id: 3, workflowId: 11, status: "in_progress", conclusion: null })], "abc")).toBe("pending");
    expect(ciStatusFromRuns([run({ conclusion: "skipped" })], "abc")).toBe("success");
  });

  it("ignores agent runs", () => {
    expect(excludeAgentRuns([run({ name: "Codeless agent" }), run({ id: 2, name: "Praetor agent" }), run({ id: 3 })])).toHaveLength(1);
  });
});
