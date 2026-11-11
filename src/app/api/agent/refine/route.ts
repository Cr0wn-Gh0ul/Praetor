import { z } from "zod";
import { extractPlannedPaths } from "@/lib/agent/code-safety";
import { modelIdSchema } from "@/lib/schemas";
import { apiError } from "@/lib/api-response";
import { AGENT_WORKFLOW_FILE } from "@/lib/bootstrap";
import { getConfig } from "@/lib/config";
import { dispatchWorkflow, getIssue, getLatestMarkedComment, MARKERS } from "@/lib/github";
import { getRepositorySetup } from "@/lib/repo-setup";
import { stateFromLabels } from "@/lib/state";

const requestSchema = z.object({
  issueNumber: z.number().int().positive(),
  instruction: z.string().trim().min(1).max(8_000),
  selectedCode: z.string().max(20_000).default(""),
  model: modelIdSchema.optional(),
}).strict();

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_REFINE_REQUEST", "Issue number and refinement instructions are required.", 400);
  try {
    const issue = await getIssue(parsed.data.issueNumber);
    if (stateFromLabels(issue.labels) !== "code-review") {
      return apiError("ISSUE_NOT_IN_CODE_REVIEW", "Refinement is available only while reviewing generated code.", 409);
    }
    const plan = await getLatestMarkedComment(issue.number, MARKERS.plan);
    if (!plan) return apiError("PLAN_NOT_FOUND", "The approved plan is unavailable.", 409);
    const allowedPaths = extractPlannedPaths(plan);
    if (!allowedPaths.length) return apiError("PLAN_HAS_NO_FILES", "The plan does not list approved files to change.", 409);
    const setup = await getRepositorySetup();
    if (setup.summary !== "ready") return apiError("SETUP_REQUIRED", "Set up the repository and store the OpenRouter key before running the agent.", 409);
    const config = await getConfig();
    await dispatchWorkflow(AGENT_WORKFLOW_FILE, config.baseBranch, {
      stage: "refine",
      issue: String(issue.number),
      model: parsed.data.model ?? config.models.code,
      instruction: parsed.data.instruction,
      selected_code: parsed.data.selectedCode.slice(0, 16_000),
    });
    return Response.json({ dispatched: true, stage: "refine", issueNumber: issue.number }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("REFINE_DISPATCH_FAILED", "Could not start the refinement workflow. Check repository Actions and Workflows permissions.", 503);
  }
}