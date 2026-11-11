import { z } from "zod";
import { extractPlannedPaths } from "@/lib/agent/code-safety";
import { apiError } from "@/lib/api-response";
import { AGENT_WORKFLOW_FILE } from "@/lib/bootstrap";
import { getConfig } from "@/lib/config";
import { dispatchWorkflow, getIssue, getLatestMarkedComment, MARKERS } from "@/lib/github";
import { getRepositorySetup } from "@/lib/repo-setup";
import { modelIdSchema } from "@/lib/schemas";
import { stateFromLabels } from "@/lib/state";

const requestSchema = z.object({ issueNumber: z.number().int().positive(), model: modelIdSchema.optional() }).strict();

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_CODE_REQUEST", "Issue number must be a positive integer.", 400);

  try {
    const issue = await getIssue(parsed.data.issueNumber);
    if (stateFromLabels(issue.labels) !== "plan-approved") {
      return apiError("PLAN_NOT_APPROVED", "Code can only be generated after a human approves the plan.", 409);
    }
    const plan = await getLatestMarkedComment(issue.number, MARKERS.plan);
    if (!plan) return apiError("PLAN_NOT_FOUND", "Generate a plan before executing the build.", 409);
    const allowedPaths = extractPlannedPaths(plan);
    if (!allowedPaths.length) return apiError("PLAN_HAS_NO_FILES", "The approved plan must list files under `Files to change`.", 409);

    const setup = await getRepositorySetup();
    if (setup.summary !== "ready") return apiError("SETUP_REQUIRED", "Set up the repository and store the OpenRouter key before running the agent.", 409);
    const config = await getConfig();
    await dispatchWorkflow(AGENT_WORKFLOW_FILE, config.baseBranch, {
      stage: "code",
      issue: String(issue.number),
      model: parsed.data.model ?? config.models.code,
      review_model: config.models.review,
    });
    return Response.json({ dispatched: true, stage: "code", issueNumber: issue.number }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("CODE_DISPATCH_FAILED", "Could not start the coding workflow. Check repository Actions and Workflows permissions.", 503);
  }
}