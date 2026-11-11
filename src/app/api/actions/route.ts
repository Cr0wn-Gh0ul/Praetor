import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { listRepositoryWorkflowRuns } from "@/lib/github";

const filtersSchema = z.object({
  workflow: z.string().trim().max(200).optional(),
  status: z.enum(["queued", "in_progress", "completed", "waiting", "unknown"]).optional(),
  branch: z.string().trim().max(255).optional(),
}).strict();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = filtersSchema.safeParse({ workflow: params.get("workflow") ?? undefined, status: params.get("status") ?? undefined, branch: params.get("branch") ?? undefined });
  if (!filters.success) return apiError("INVALID_ACTION_FILTER", filters.error.issues[0]?.message ?? "Action filters are invalid.", 400);
  try {
    const runs = await listRepositoryWorkflowRuns();
    const result = runs.filter((run) => (!filters.data.workflow || run.workflow.toLowerCase().includes(filters.data.workflow.toLowerCase()))
      && (!filters.data.status || run.status === filters.data.status)
      && (!filters.data.branch || run.branch.toLowerCase().includes(filters.data.branch.toLowerCase())));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("ACTIONS_FETCH_FAILED", "Could not load workflow runs from GitHub.", 502);
  }
}
