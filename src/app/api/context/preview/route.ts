import { z } from "zod";
import { buildContext } from "@/lib/agent/context";
import { apiError } from "@/lib/api-response";

const querySchema = z.string().trim().min(1).max(4_000);

export async function GET(request: Request) {
  const query = querySchema.safeParse(new URL(request.url).searchParams.get("q"));
  if (!query.success) return apiError("INVALID_CONTEXT_QUERY", "Provide a non-empty context query.", 400);
  try {
    return Response.json(await buildContext(query.data), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("CONTEXT_SEARCH_FAILED", "Could not search the local repository index.", 503);
  }
}