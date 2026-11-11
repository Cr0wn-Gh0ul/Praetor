export type CiStatus = "pending" | "success" | "failure" | "unknown";

export type WorkflowRunSummary = {
  id: number;
  name: string;
  workflowId: number;
  status: string | null;
  conclusion: string | null;
  headSha: string;
  createdAt: string;
};

const PASSING = new Set(["success", "skipped", "neutral"]);

/**
 * Combines the latest run of each workflow for a commit into one status. Uses Actions workflow runs,
 * which fine-grained tokens and GitHub App user tokens can read, unlike the Checks API.
 */
export function ciStatusFromRuns(runs: WorkflowRunSummary[], headSha: string): CiStatus {
  const latestByWorkflow = new Map<number, WorkflowRunSummary>();
  for (const run of runs) {
    if (run.headSha !== headSha) continue;
    const existing = latestByWorkflow.get(run.workflowId);
    if (!existing || run.createdAt > existing.createdAt || (run.createdAt === existing.createdAt && run.id > existing.id)) latestByWorkflow.set(run.workflowId, run);
  }
  const latest = [...latestByWorkflow.values()];
  if (latest.length === 0) return "unknown";
  if (latest.some((run) => run.status === "completed" && !PASSING.has(run.conclusion ?? ""))) return "failure";
  if (latest.some((run) => run.status !== "completed")) return "pending";
  return "success";
}

/** Agent runs are not CI; exclude them so a running agent doesn't block merging. */
export function excludeAgentRuns(runs: WorkflowRunSummary[]): WorkflowRunSummary[] {
  return runs.filter((run) => run.name !== "Praetor agent" && run.name !== "Codeless agent");
}
