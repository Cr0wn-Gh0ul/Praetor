import { describe, expect, it, vi } from "vitest";
import { assertTransition, deriveState, initialIssueLabels, replaceAgentLabel, stateFromLabels } from "./state";

vi.mock("server-only", () => ({}));

describe("agent state", () => {
  it("maps exactly one agent label to a state", () => {
    expect(stateFromLabels(["bug", "agent: planning"])).toBe("planning");
    expect(stateFromLabels(["agent: planning", "agent: coding"])).toBeNull();
  });

  it("treats a merged pull request as done", () => {
    expect(deriveState(["agent: pr-created"], true)).toBe("done");
  });

  it("replaces only agent-owned labels", () => {
    expect(replaceAgentLabel(["bug", "agent: planning", "priority: high"], "coding"))
      .toEqual(["bug", "priority: high", "agent: coding"]);
  });

  it("leaves new issues untracked until a workflow stage is started", () => {
    expect(initialIssueLabels(["bug", "agent: coding", "bug"], null)).toEqual(["bug"]);
    expect(initialIssueLabels(["bug"], "planning")).toEqual(["bug", "agent: planning"]);
  });

  it("enforces state transitions", () => {
    expect(() => assertTransition(null, "planning")).not.toThrow();
    expect(() => assertTransition(null, "coding")).toThrow("Invalid agent state transition");
    expect(() => assertTransition("planning", "plan-approved")).not.toThrow();
    expect(() => assertTransition("planning", "done")).toThrow("Invalid agent state transition");
  });
});