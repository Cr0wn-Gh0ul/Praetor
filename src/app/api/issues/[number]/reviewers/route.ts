import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { requestPullRequestReviewers } from "@/lib/github";
import { requestReviewersSchema } from "@/lib/schemas";

const issueNumberSchema = z.coerce.number().int().positive();

export async function POST(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const issueNumber = issueNumberSchema.safeParse((await params).number);
  if (!issueNumber.success) return apiError("INVALID_ISSUE_NUMBER", "Issue number must be a positive integer.", 400);
  const body = requestReviewersSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError("INVALID_REVIEWERS", body.error.issues[0]?.message ?? "Provide one to fifteen GitHub usernames.", 400);

  try {
    await requestPullRequestReviewers(issueNumber.data, body.data.reviewers);
    return Response.json({ requested: body.data.reviewers }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/\s+-\s+https?:\/\/\S+$/, "") : "";
    return apiError("REVIEWER_REQUEST_FAILED", message || "Could not request reviewers.", 409);
  }
}
