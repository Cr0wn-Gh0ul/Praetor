import { createDraft, listDrafts } from "@/lib/drafts";
import { apiError } from "@/lib/api-response";

export async function GET() {
  try {
    return Response.json(await listDrafts(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("DRAFTS_READ_FAILED", "Could not read local drafts.", 500);
  }
}

export async function POST() {
  try {
    return Response.json(await createDraft(), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("DRAFT_CREATE_FAILED", "Could not create a local draft.", 500);
  }
}