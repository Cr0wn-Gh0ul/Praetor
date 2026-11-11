import { z } from "zod";
import { apiError } from "@/lib/api-response";
import { saveConfig } from "@/lib/config";
import { getGitHubAppClientId, pollDeviceCode } from "@/lib/github-auth";
import { deleteGitHubDeviceSession, getGitHubDeviceSession, updateGitHubDeviceInterval } from "@/lib/github-device-store";

const requestSchema = z.object({ id: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_DEVICE_SESSION", "Sign-in session is invalid.", 400);
  const session = getGitHubDeviceSession(parsed.data.id);
  const clientId = getGitHubAppClientId();
  if (!session || !clientId) {
    deleteGitHubDeviceSession(parsed.data.id);
    return apiError("DEVICE_SESSION_EXPIRED", "The sign-in session expired. Start again to get a new code.", 410);
  }
  try {
    const result = await pollDeviceCode(clientId, session.deviceCode, session.interval);
    if (result.status !== "authorized") {
      if (result.status === "pending") updateGitHubDeviceInterval(parsed.data.id, result.interval);
      if (result.status === "expired" || result.status === "denied" || result.status === "error") deleteGitHubDeviceSession(parsed.data.id);
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    const response = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${result.auth.accessToken}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("GitHub authorized sign-in but did not return the account profile.");
    const user = z.object({ login: z.string().min(1) }).parse(await response.json());
    await saveConfig({ githubAuth: { ...result.auth, login: user.login }, githubToken: "" });
    deleteGitHubDeviceSession(parsed.data.id);
    return Response.json({ status: "authorized", login: user.login }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError("GITHUB_DEVICE_POLL_FAILED", error instanceof Error ? error.message : "Could not complete GitHub sign-in.", 502);
  }
}
