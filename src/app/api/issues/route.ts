import { z } from "zod";
import { listAgentIssues } from "@/lib/github";
import { apiError } from "@/lib/api-response";

const filtersSchema = z.object({
  state: z.enum(["open", "closed", "all"]).default("open"),
  agentOnly: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
}).strict();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = filtersSchema.safeParse({ state: params.get("state") ?? undefined, agentOnly: params.get("agentOnly") ?? undefined });
  if (!filters.success) return apiError("INVALID_ISSUE_FILTER", "Issue filters are invalid.", 400);
  try {
    return Response.json(await listAgentIssues(filters.data.state, filters.data.agentOnly), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("ISSUES_FETCH_FAILED", "Could not load issues from the configured repository.", 502);
  }
}