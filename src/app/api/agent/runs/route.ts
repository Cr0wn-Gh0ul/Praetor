import { z } from "zod";
import { AGENT_WORKFLOW_FILE } from "@/lib/bootstrap";
import { apiError } from "@/lib/api-response";
import { listWorkflowRuns } from "@/lib/github";

const issueQuerySchema = z.coerce.number().int().positive();

export async function GET(request: Request) {
  const issueNumber = issueQuerySchema.safeParse(new URL(request.url).searchParams.get("issue"));
  if (!issueNumber.success) return apiError("INVALID_ISSUE_NUMBER", "Provide a positive issue number.", 400);
  try {
    const runs = await listWorkflowRuns(AGENT_WORKFLOW_FILE);
    const issueMarker = new RegExp(`(^|\\s)#${issueNumber.data}(\\s|$)`);
    const matching = runs?.filter((run) => issueMarker.test(run.title)) ?? [];
    return Response.json({ runs: matching }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("AGENT_RUNS_FAILED", "Could not read agent workflow runs.", 502);
  }
}
