import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getConfig } from "@/lib/config";
import { getJob, startRepoJob } from "@/lib/jobs";
import { fullIndex, getIndexMetadata } from "@/lib/indexer";

const startSchema = z.object({ action: z.literal("start") }).strict();
const jobIdSchema = z.string().uuid();

export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INDEX_REQUEST", "Request action must be start.", 400);
  try {
    const config = await getConfig();
    const job = startRepoJob(config.targetRepo.toLowerCase(), "index", fullIndex);
    return Response.json(job, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INDEX_START_FAILED", "Could not start repository indexing.", 500);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");
  if (jobId) {
    const parsed = jobIdSchema.safeParse(jobId);
    if (!parsed.success) return apiError("INVALID_JOB_ID", "Job ID is invalid.", 400);
    const job = getJob(parsed.data);
    return job ? Response.json(job, { headers: { "Cache-Control": "no-store" } }) : apiError("JOB_NOT_FOUND", "Index job not found.", 404);
  }

  try {
    const config = await getConfig();
    return Response.json(await getIndexMetadata(config.targetRepo), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("INDEX_STATUS_FAILED", "Could not read the index status.", 500);
  }
}