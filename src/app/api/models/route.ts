import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { getModelCatalog } from "@/lib/models";

const querySchema = z.object({ refresh: z.enum(["0", "1"]).optional() }).strict();

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return apiError("INVALID_MODELS_QUERY", "Only the refresh query parameter is supported.", 400);
  try {
    const catalog = await getModelCatalog({ force: parsed.data.refresh === "1" });
    return Response.json(catalog, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("MODELS_FETCH_FAILED", "Could not load the OpenRouter model list. You can still enter a model ID manually.", 502);
  }
}
