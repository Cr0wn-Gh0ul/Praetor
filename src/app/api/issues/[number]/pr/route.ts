import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getConfig } from "@/lib/config";
import { createPullRequest, getIssue, getLatestMarkedComment, MARKERS, setAgentState } from "@/lib/github";
import { stateFromLabels } from "@/lib/state";

const issueNumberSchema = z.coerce.number().int().positive();

export async function POST(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const issueNumber = issueNumberSchema.safeParse((await params).number);
  if (!issueNumber.success) return apiError("INVALID_ISSUE_NUMBER", "Issue number must be a positive integer.", 400);
  try {
    const issue = await getIssue(issueNumber.data);
    if (stateFromLabels(issue.labels) !== "code-review") {
      return apiError("ISSUE_NOT_IN_CODE_REVIEW", "Create a pull request after reviewing the generated diff.", 409);
    }
    const config = await getConfig();
    const selfReview = await getLatestMarkedComment(issue.number, MARKERS.selfReview);
    const pullRequest = await createPullRequest(
      `agent/issue-${issue.number}`,
      config.baseBranch,
      issue.title,
      `Closes #${issue.number}\n\n${selfReview ?? "Generated changes are ready for review."}`,
    );
    await setAgentState(issue.number, "pr-created");
    return Response.json({ number: pullRequest.number, htmlUrl: pullRequest.html_url }, { status: 201 });
  } catch {
    return apiError("PULL_REQUEST_CREATE_FAILED", "Could not create the pull request.", 502);
  }
}