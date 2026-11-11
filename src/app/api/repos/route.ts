import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { listAvailableRepositories, selectRepository } from "@/lib/github";

const selectSchema = z.object({ repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/) }).strict();

export async function GET() {
  try {
    return Response.json(await listAvailableRepositories(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("REPOSITORIES_FETCH_FAILED", "Could not list repositories available to this GitHub token.", 502);
  }
}

export async function POST(request: Request) {
  const parsed = selectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_REPOSITORY", "Choose a valid owner/repository entry.", 400);
  try {
    return Response.json(await selectRepository(parsed.data.repository));
  } catch {
    return apiError("REPOSITORY_SELECTION_FAILED", "Could not select that repository. Check that the token has write access.", 403);
  }
}