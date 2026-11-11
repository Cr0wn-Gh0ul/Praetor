import { saveConfig } from "@/lib/config";

export async function POST() {
  await saveConfig({ githubAuth: null });
  return Response.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } });
}
