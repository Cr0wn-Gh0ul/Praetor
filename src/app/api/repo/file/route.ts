import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getConfig } from "@/lib/config";
import { readRepoTextFile } from "@/lib/github";
import { isPreviewableRepoPath } from "@/lib/repo";

const refSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._/-]+$/).refine((value) => !value.includes("..") && !value.startsWith("/") && !value.endsWith("/"));
const pathSchema = z.string().trim().min(1).max(500).refine(isPreviewableRepoPath);

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsedPath = pathSchema.safeParse(searchParams.get("path"));
  if (!parsedPath.success) return apiError("INVALID_REPOSITORY_PATH", "Repository file path is invalid or cannot be previewed.", 400);

  try {
    const ref = searchParams.get("ref") ?? (await getConfig()).baseBranch;
    const parsedRef = refSchema.safeParse(ref);
    if (!parsedRef.success) return apiError("INVALID_REPOSITORY_REF", "Repository branch is invalid.", 400);
    const content = await readRepoTextFile(parsedPath.data, parsedRef.data);
    if (content === null) return apiError("REPOSITORY_FILE_NOT_FOUND", "The file is unavailable or is not a text file.", 404);
    if (content.length > 200_000) return apiError("REPOSITORY_FILE_TOO_LARGE", "This file is too large to preview.", 413);
    return Response.json({ path: parsedPath.data, content }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("REPOSITORY_FILE_FAILED", "Could not read the repository file.", 502);
  }
}