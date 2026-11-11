import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getConfig } from "@/lib/config";
import { listRepositoryFilePaths } from "@/lib/github";

const refSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._/-]+$/).refine((value) => !value.includes("..") && !value.startsWith("/") && !value.endsWith("/"));

export async function GET(request: Request) {
  try {
    const ref = new URL(request.url).searchParams.get("ref") ?? (await getConfig()).baseBranch;
    const parsed = refSchema.safeParse(ref);
    if (!parsed.success) return apiError("INVALID_REPOSITORY_REF", "Repository branch is invalid.", 400);
    const files = await listRepositoryFilePaths(parsed.data);
    return Response.json({ files }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("REPOSITORY_FILES_FAILED", "Could not read files from the configured repository.", 502);
  }
}