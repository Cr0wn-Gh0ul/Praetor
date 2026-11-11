import { AGENT_LABELS, AGENT_STATES } from "./constants";
import type { AgentState } from "./types";

const ALLOWED_TRANSITIONS: Record<AgentState, readonly AgentState[]> = {
  planning: ["plan-approved", "needs-human"],
  "plan-approved": ["coding", "planning", "needs-human"],
  coding: ["code-review", "plan-approved", "needs-human"],
  "code-review": ["pr-created", "plan-approved", "needs-human"],
  "pr-created": ["needs-human", "done"],
  "needs-human": ["planning", "plan-approved", "coding", "code-review", "pr-created"],
  done: [],
};

export function stateFromLabels(labels: readonly string[]): AgentState | null {
  const states = labels.flatMap((label) => {
    const state = AGENT_STATES.find((candidate) => AGENT_LABELS[candidate] && label === `agent: ${candidate}`);
    return state ? [state] : [];
  });
  return states.length === 1 ? states[0]! : null;
}

export function deriveState(labels: readonly string[], pullRequestMerged = false): AgentState | null {
  if (pullRequestMerged) return "done";
  return stateFromLabels(labels);
}

export function assertTransition(current: AgentState | null, next: AgentState): void {
  if (current === null && next === "planning") return;
  if (current === null) throw new Error(`Invalid agent state transition: untracked -> ${next}`);
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new Error(`Invalid agent state transition: ${current} -> ${next}`);
  }
}

export function replaceAgentLabel(labels: readonly string[], next: AgentState): string[] {
  return [...labels.filter((label) => !label.startsWith("agent:")), `agent: ${next}`];
}

export function initialIssueLabels(labels: readonly string[], state: AgentState | null): string[] {
  return [...new Set([...labels.filter((label) => !/^agent:/i.test(label)), ...(state ? [`agent: ${state}`] : [])])];
}