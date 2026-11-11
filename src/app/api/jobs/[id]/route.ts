import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getJob } from "@/lib/jobs";

const idSchema = z.string().uuid();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return apiError("INVALID_JOB_ID", "Job ID is invalid.", 400);
  const job = getJob(id.data);
  return job ? Response.json(job, { headers: { "Cache-Control": "no-store" } }) : apiError("JOB_NOT_FOUND", "Job not found.", 404);
}