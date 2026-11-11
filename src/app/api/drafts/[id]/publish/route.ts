import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { issueFromDraft } from "@/lib/draft-format";
import { deleteDraft, getDraft } from "@/lib/drafts";
import { createIssue } from "@/lib/github";

const idSchema = z.string().uuid();

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return apiError("INVALID_DRAFT_ID", "Draft ID is invalid.", 400);
  try {
    const draft = await getDraft(id.data);
    if (!draft) return apiError("DRAFT_NOT_FOUND", "Draft not found.", 404);
    const { title, body } = issueFromDraft(draft);
    if (!title) return apiError("DRAFT_TITLE_REQUIRED", "Add a title before publishing this draft.", 400);
    if (!body) return apiError("DRAFT_BODY_REQUIRED", "Add a description before publishing this draft.", 400);
    const issue = await createIssue(title, body, null, draft.labels);
    await deleteDraft(draft.id);
    return Response.json(issue, { status: 201 });
  } catch {
    return apiError("DRAFT_PUBLISH_FAILED", "Could not publish the issue to GitHub.", 502);
  }
}