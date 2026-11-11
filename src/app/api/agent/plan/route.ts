import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { AGENT_WORKFLOW_FILE } from "@/lib/bootstrap";
import { getConfig } from "@/lib/config";
import { dispatchWorkflow, getIssue } from "@/lib/github";
import { modelIdSchema } from "@/lib/schemas";
import { getRepositorySetup } from "@/lib/repo-setup";
import { stateFromLabels } from "@/lib/state";

const requestSchema = z.object({
  issueNumber: z.number().int().positive(),
  feedback: z.string().max(8_000).optional(),
  model: modelIdSchema.optional(),
}).strict();

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_PLAN_REQUEST", "Issue number must be a positive integer.", 400);
  try {
    const issue = await getIssue(parsed.data.issueNumber);
    if (stateFromLabels(issue.labels) !== "planning") {
      return apiError("ISSUE_NOT_PLANNING", "Plans can only be generated while the issue is in planning.", 409);
    }
    const setup = await getRepositorySetup();
    if (setup.summary !== "ready") return apiError("SETUP_REQUIRED", "Set up the repository and store the OpenRouter key before running the agent.", 409);
    const config = await getConfig();
    await dispatchWorkflow(AGENT_WORKFLOW_FILE, config.baseBranch, {
      stage: "plan",
      issue: String(issue.number),
      model: parsed.data.model ?? config.models.plan,
      instruction: parsed.data.feedback ?? "",
    });
    return Response.json({ dispatched: true, stage: "plan", issueNumber: issue.number }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = (error as { status?: number }).status;
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error("Plan dispatch failed", { status, detail });
    if (status === 404) return apiError("WORKFLOW_NOT_FOUND", `${AGENT_WORKFLOW_FILE} was not found on the base branch. Re-run repository setup and merge the workflow.`, 409);
    if (status === 403) return apiError("WORKFLOW_FORBIDDEN", "The GitHub token needs Actions: write and Workflows permissions on this repository.", 403);
    if (status === 422) return apiError("WORKFLOW_INPUT_REJECTED", "GitHub rejected the dispatch. The workflow on the base branch may be outdated or lack workflow_dispatch inputs.", 422);
    return apiError("PLAN_DISPATCH_FAILED", "Could not start the planning workflow. Check repository Actions and Workflows permissions.", 503);
  }
}