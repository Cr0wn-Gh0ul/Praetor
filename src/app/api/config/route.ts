import { ZodError, z } from "zod";
import { getPublicConfig, saveConfig } from "@/lib/config";
import { apiError } from "@/lib/api-response";
import { contextPathSchema, modelIdSchema } from "@/lib/schemas";

const configUpdateSchema = z.object({
  githubToken: z.string().optional(),
  openRouterApiKey: z.string().optional(),
  baseBranch: z.string().optional(),
  additionalContextPaths: z.array(contextPathSchema).max(100).optional(),
  models: z.object({
    draft: modelIdSchema.optional(),
    plan: modelIdSchema.optional(),
    code: modelIdSchema.optional(),
    review: modelIdSchema.optional(),
  }).strict().partial().optional(),
}).strict();

export async function GET() {
  try {
    return Response.json(await getPublicConfig(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("CONFIG_READ_FAILED", "Could not read the local configuration.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const update = configUpdateSchema.parse(body);
    await saveConfig(update);
    return Response.json(await getPublicConfig(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError("INVALID_CONFIG", error.issues[0]?.message ?? "Configuration values are invalid.", 400);
    }
    if (error instanceof SyntaxError) {
      return apiError("INVALID_JSON", "Request body must be valid JSON.", 400);
    }
    return apiError("CONFIG_WRITE_FAILED", "Could not save the local configuration.", 500);
  }
}