import { apiError } from "@/lib/api-response";
import { getConfig } from "@/lib/config";
import { setRepositorySecret } from "@/lib/github";

export async function POST() {
  try {
    const config = await getConfig();
    if (!config.openRouterApiKey) return apiError("OPENROUTER_KEY_MISSING", "Save an OpenRouter API key in Settings first.", 409);
    await setRepositorySecret("OPENROUTER_API_KEY", config.openRouterApiKey);
    return Response.json({ stored: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("SECRET_STORE_FAILED", "Could not store the OpenRouter key as a repository Actions secret.", 502);
  }
}
