import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getIssue, setAgentState, submitPullRequestReview } from "@/lib/github";
import { submitReviewSchema } from "@/lib/schemas";
import { stateFromLabels } from "@/lib/state";

const issueNumberSchema = z.coerce.number().int().positive();
const GITHUB_EVENTS = { approve: "APPROVE", comment: "COMMENT", "request-changes": "REQUEST_CHANGES" } as const;

function reviewErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.replace(/\s+-\s+https?:\/\/\S+$/, "") || "Could not submit the review.";
}

export async function POST(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const issueNumber = issueNumberSchema.safeParse((await params).number);
  if (!issueNumber.success) return apiError("INVALID_ISSUE_NUMBER", "Issue number must be a positive integer.", 400);
  const body = submitReviewSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError("INVALID_REVIEW", body.error.issues[0]?.message ?? "A valid review is required.", 400);

  try {
    const issue = await getIssue(issueNumber.data);
    const state = stateFromLabels(issue.labels);
    await submitPullRequestReview(issue.number, GITHUB_EVENTS[body.data.event], body.data.body ?? "");

    let movedToAttention = false;
    if (body.data.event === "request-changes" && state === "pr-created") {
      await setAgentState(issue.number, "needs-human");
      movedToAttention = true;
    }
    return Response.json({ submitted: true, event: body.data.event, movedToAttention }, { status: 201 });
  } catch (error) {
    return apiError("REVIEW_SUBMIT_FAILED", reviewErrorMessage(error), 409);
  }
}
