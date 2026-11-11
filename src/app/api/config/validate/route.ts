import { Octokit } from "@octokit/rest";
import { z } from "zod";
import { apiError } from "@/lib/api-response";

const validationRequestSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("github"), token: z.string().min(1) }),
  z.object({ provider: z.literal("openrouter"), apiKey: z.string().min(1) }),
]);

export async function POST(request: Request) {
  const parsed = validationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("INVALID_VALIDATION_REQUEST", parsed.error.issues[0]?.message ?? "Validation request is invalid.", 400);
  }

  try {
    switch (parsed.data.provider) {
      case "github": {
        const octokit = new Octokit({ auth: parsed.data.token, userAgent: "codeless-ide" });
        const response = await octokit.rest.users.getAuthenticated();
        return Response.json({ valid: true, message: `Connected as ${response.data.login}.` });
      }
      case "openrouter": {
        const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${parsed.data.apiKey}` },
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return Response.json({ valid: false, message: "OpenRouter rejected this API key." });
        return Response.json({ valid: true, message: "OpenRouter API key accepted." });
      }
    }
  } catch {
    return Response.json({ valid: false, message: "Could not validate this value. Check it and try again." });
  }
}