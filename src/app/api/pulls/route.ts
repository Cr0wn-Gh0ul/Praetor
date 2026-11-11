import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { listWorkspacePullRequests } from "@/lib/github";

const filtersSchema = z.object({
  state: z.enum(["open", "closed", "all"]).default("open"),
  ci: z.enum(["pending", "success", "failure", "unknown"]).optional(),
  author: z.string().trim().max(100).optional(),
}).strict();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = filtersSchema.safeParse({ state: params.get("state") ?? undefined, ci: params.get("ci") ?? undefined, author: params.get("author") ?? undefined });
  if (!filters.success) return apiError("INVALID_PULL_REQUEST_FILTER", filters.error.issues[0]?.message ?? "Pull request filters are invalid.", 400);
  try {
    const pulls = await listWorkspacePullRequests(filters.data.state);
    const result = pulls.filter((pull) => (!filters.data.ci || pull.ciStatus === filters.data.ci) && (!filters.data.author || pull.author.toLowerCase().includes(filters.data.author.toLowerCase())));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("PULL_REQUESTS_FETCH_FAILED", "Could not load pull requests from GitHub.", 502);
  }
}
