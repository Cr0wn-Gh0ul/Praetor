import { z } from "zod";
import { getIssue } from "@/lib/github";
import { apiError } from "@/lib/api-response";
import { assertTransition, stateFromLabels } from "@/lib/state";
import { setAgentState } from "@/lib/github";
import { agentStateSchema } from "@/lib/schemas";

const bodySchema = z.object({ state: agentStateSchema }).strict();
const issueNumberSchema = z.coerce.number().int().positive();

export async function POST(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const issueNumber = issueNumberSchema.safeParse((await params).number);
  if (!issueNumber.success) return apiError("INVALID_ISSUE_NUMBER", "Issue number must be a positive integer.", 400);

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError("INVALID_STATE", "A valid agent state is required.", 400);

  try {
    const issue = await getIssue(issueNumber.data);
    const current = stateFromLabels(issue.labels);
    assertTransition(current, body.data.state);
    await setAgentState(issueNumber.data, body.data.state);
    return Response.json({ issueNumber: issueNumber.data, state: body.data.state });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid agent state transition:")) {
      return apiError("INVALID_STATE_TRANSITION", error.message, 409);
    }
    return apiError("STATE_UPDATE_FAILED", "Could not update the issue state.", 502);
  }
}