import { stateFromLabels } from "./state";
import type { AgentState } from "./types";

export const ISSUE_STATE_TITLES: Record<AgentState, string> = {
  planning: "Planning",
  "plan-approved": "Ready to build",
  coding: "Build started",
  "code-review": "Code review",
  "pr-created": "Pull request",
  "needs-human": "Needs attention",
  done: "Done",
};

export const ISSUE_PIPELINE_STAGES = [
  { id: "issue", label: "Issues" },
  { id: "plan", label: "Plan" },
  { id: "build", label: "Build" },
  { id: "review", label: "Review" },
  { id: "pull-request", label: "Pull request" },
  { id: "needs-attention", label: "Needs attention" },
  { id: "done", label: "Done" },
] as const;

export type IssuePipelineStage = (typeof ISSUE_PIPELINE_STAGES)[number]["id"];
export type IssueStageFilter = "all" | IssuePipelineStage;

export function hasAgentStateLabel(labels: string[]): boolean {
  return labels.some((label) => /^agent:/i.test(label));
}

export function parseIssueStageFilter(value: string | undefined): IssueStageFilter {
  if (value === "all") return "all";
  if (value === "create") return "build";
  if (value === "merge") return "pull-request";
  return ISSUE_PIPELINE_STAGES.find(({ id }) => id === value)?.id ?? "issue";
}

export function issueMatchesStage(labels: string[], stage: IssueStageFilter): boolean {
  if (stage === "all") return true;
  const state = stateFromLabels(labels);
  switch (stage) {
    case "issue": return state === null && !hasAgentStateLabel(labels);
    case "plan": return state === "planning";
    case "build": return state === "plan-approved" || state === "coding";
    case "review": return state === "code-review";
    case "pull-request": return state === "pr-created";
    case "needs-attention": return state === "needs-human" || (state === null && hasAgentStateLabel(labels));
    case "done": return state === "done";
  }
}