import { apiError } from "@/lib/api-response";
import { listIssueTemplates } from "@/lib/github";

export async function GET() {
  try {
    return Response.json(await listIssueTemplates(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("ISSUE_TEMPLATES_FETCH_FAILED", "Could not load issue templates from GitHub.", 502);
  }
}
