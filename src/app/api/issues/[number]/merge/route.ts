import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getIssue } from "@/lib/github";
import { finalizeMergedIssue } from "@/lib/post-merge";
import { mergePullRequest } from "@/lib/github";
import { stateFromLabels } from "@/lib/state";

const issueNumberSchema = z.coerce.number().int().positive();

export async function POST(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const issueNumber = issueNumberSchema.safeParse((await params).number);
  if (!issueNumber.success) return apiError("INVALID_ISSUE_NUMBER", "Issue number must be a positive integer.", 400);
  try {
    const issue = await getIssue(issueNumber.data);
    if (!new Set(["pr-created", "needs-human"]).has(stateFromLabels(issue.labels) ?? "")) {
      return apiError("ISSUE_NOT_READY_TO_MERGE", "Only an open agent pull request can be merged from this workflow.", 409);
    }
    await mergePullRequest(issue.number);
    await finalizeMergedIssue(issue.number);
    return Response.json({ merged: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not merge this pull request.";
    return apiError("PULL_REQUEST_MERGE_FAILED", message, 409);
  }
}