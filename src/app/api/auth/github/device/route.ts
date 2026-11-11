import { randomUUID } from "node:crypto";
import { apiError } from "@/lib/api-response";
import { appInstallUrl, getGitHubAppClientId, getGitHubAppSlug, requestDeviceCode } from "@/lib/github-auth";
import { addGitHubDeviceSession } from "@/lib/github-device-store";

export async function GET() {
  return Response.json({ available: Boolean(getGitHubAppClientId()), installUrl: appInstallUrl(getGitHubAppSlug()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST() {
  const clientId = getGitHubAppClientId();
  if (!clientId) return apiError("GITHUB_APP_UNAVAILABLE", "GitHub App sign-in is not configured.", 503);
  try {
    const code = await requestDeviceCode(clientId);
    const id = randomUUID();
    if (!addGitHubDeviceSession(id, { deviceCode: code.deviceCode, interval: code.interval, expiresAt: Date.now() + code.expiresIn * 1_000 })) {
      return apiError("SIGNIN_CAPACITY", "Too many sign-in requests are active. Try again shortly.", 429);
    }
    return Response.json({ id, userCode: code.userCode, verificationUri: code.verificationUri, expiresIn: code.expiresIn, interval: code.interval }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError("GITHUB_DEVICE_REQUEST_FAILED", error instanceof Error ? error.message : "Could not start GitHub sign-in.", 502);
  }
}
