import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { compareBranch } from "@/lib/github";
import { AGENT_BRANCH_PREFIX } from "@/lib/constants";
import { getConfig } from "@/lib/config";

const issueNumberSchema = z.coerce.number().int().positive();

export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const issueNumber = issueNumberSchema.safeParse((await params).number);
  if (!issueNumber.success) return apiError("INVALID_ISSUE_NUMBER", "Issue number must be a positive integer.", 400);
  try {
    const config = await getConfig();
    const files = await compareBranch(config.baseBranch, `${AGENT_BRANCH_PREFIX}${issueNumber.data}`);
    return Response.json(files, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("DIFF_FETCH_FAILED", "Could not load the GitHub branch diff.", 502);
  }
}