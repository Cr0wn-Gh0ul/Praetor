import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { deleteDraft, getDraft, updateDraft } from "@/lib/drafts";

const idSchema = z.string().uuid();
const updateSchema = z.object({
  title: z.string().max(300).optional(),
  body: z.string().max(100_000).optional(),
  templateId: z.string().max(500).nullable().optional(),
  templateName: z.string().max(200).nullable().optional(),
  labels: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
}).strict();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return apiError("INVALID_DRAFT_ID", "Draft ID is invalid.", 400);
  try {
    const draft = await getDraft(id.data);
    return draft ? Response.json(draft, { headers: { "Cache-Control": "no-store" } }) : apiError("DRAFT_NOT_FOUND", "Draft not found.", 404);
  } catch {
    return apiError("DRAFT_READ_FAILED", "Could not read this draft.", 500);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return apiError("INVALID_DRAFT_ID", "Draft ID is invalid.", 400);
  const body = updateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError("INVALID_DRAFT", "Draft fields are invalid.", 400);
  try {
    return Response.json(await updateDraft(id.data, body.data), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("DRAFT_UPDATE_FAILED", "Could not update this draft.", 404);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return apiError("INVALID_DRAFT_ID", "Draft ID is invalid.", 400);
  try {
    await deleteDraft(id.data);
    return new Response(null, { status: 204 });
  } catch {
    return apiError("DRAFT_DELETE_FAILED", "Could not delete this draft.", 500);
  }
}