import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { ensureAgentLabels } from "@/lib/github";

const requestSchema = z.object({}).strict();

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_LABEL_SYNC", "Label sync request is invalid.", 400);
  try {
    await ensureAgentLabels();
    return Response.json({ synchronized: true });
  } catch {
    return apiError("LABEL_SYNC_FAILED", "Could not synchronize repository issue labels.", 502);
  }
}