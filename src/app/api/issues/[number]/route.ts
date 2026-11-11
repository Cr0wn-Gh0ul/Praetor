import { z } from "zod";
import { getIssueDetail } from "@/lib/github";
import { apiError } from "@/lib/api-response";

const issueNumberSchema = z.coerce.number().int().positive();

export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const parsed = issueNumberSchema.safeParse((await params).number);
  if (!parsed.success) return apiError("INVALID_ISSUE_NUMBER", "Issue number must be a positive integer.", 400);
  try {
    return Response.json(await getIssueDetail(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("ISSUE_FETCH_FAILED", "Could not load this issue from GitHub.", 502);
  }
}