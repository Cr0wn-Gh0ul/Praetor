import "server-only";

import { z } from "zod";
import { getConfig, saveConfig } from "./config";

/**
 * Sign-in through the Codeless GitHub App using the OAuth device flow. The device flow needs only the
 * app's public client ID, so no client secret ships with the app. User tokens from GitHub Apps expire
 * after eight hours and are refreshed automatically with the refresh token.
 */

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const REFRESH_MARGIN_MS = 5 * 60_000;

export const githubAppClientIdSchema = z.string().trim().regex(/^(Iv[0-9]\.|Ov2[0-9A-Za-z]{2})?[0-9A-Za-z]{16,40}$/, "GitHub App client IDs look like Iv23li… .");

export function getGitHubAppClientId(env: Record<string, string | undefined> = process.env): string | null {
  const parsed = githubAppClientIdSchema.safeParse(env.GITHUB_APP_CLIENT_ID ?? "");
  return parsed.success ? parsed.data : null;
}

export function getGitHubAppSlug(env: Record<string, string | undefined> = process.env): string | null {
  const slug = env.GITHUB_APP_SLUG?.trim() ?? "";
  return /^[a-z0-9][a-z0-9-]{0,38}$/.test(slug) ? slug : null;
}

const deviceCodeSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
});

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().int().positive().optional(),
});

const errorSchema = z.object({ error: z.string(), error_description: z.string().optional(), interval: z.number().optional() });

export type DeviceCode = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number };

export type StoredGitHubAuth = {
  method: "app";
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  login: string;
};

export type DevicePollResult =
  | { status: "pending"; interval: number }
  | { status: "authorized"; auth: Omit<StoredGitHubAuth, "login"> }
  | { status: "expired" | "denied" | "error"; message: string };

type FetchLike = typeof fetch;

async function postForm(fetchImpl: FetchLike, url: string, form: Record<string, string>): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok && !errorSchema.safeParse(body).success) throw new Error(`GitHub responded with status ${response.status}.`);
  return body;
}

function toStoredAuth(token: z.infer<typeof tokenSchema>, now: number): Omit<StoredGitHubAuth, "login"> {
  return {
    method: "app",
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? "",
    accessTokenExpiresAt: token.expires_in ? new Date(now + token.expires_in * 1_000).toISOString() : "",
    refreshTokenExpiresAt: token.refresh_token_expires_in ? new Date(now + token.refresh_token_expires_in * 1_000).toISOString() : "",
  };
}

export async function requestDeviceCode(clientId: string, fetchImpl: FetchLike = fetch): Promise<DeviceCode> {
  const body = await postForm(fetchImpl, DEVICE_CODE_URL, { client_id: clientId });
  const error = errorSchema.safeParse(body);
  if (error.success) {
    throw new Error(error.data.error === "device_flow_disabled" ? "Device sign-in is not enabled for the Codeless GitHub App." : error.data.error_description ?? "GitHub refused the sign-in request.");
  }
  const parsed = deviceCodeSchema.parse(body);
  return { deviceCode: parsed.device_code, userCode: parsed.user_code, verificationUri: parsed.verification_uri, expiresIn: parsed.expires_in, interval: parsed.interval };
}

export async function pollDeviceCode(clientId: string, deviceCode: string, interval: number, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<DevicePollResult> {
  const body = await postForm(fetchImpl, ACCESS_TOKEN_URL, { client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
  const token = tokenSchema.safeParse(body);
  if (token.success) return { status: "authorized", auth: toStoredAuth(token.data, now) };
  const error = errorSchema.safeParse(body);
  if (!error.success) return { status: "error", message: "GitHub returned an unexpected response." };
  switch (error.data.error) {
    case "authorization_pending": return { status: "pending", interval };
    case "slow_down": return { status: "pending", interval: error.data.interval ?? interval + 5 };
    case "expired_token": return { status: "expired", message: "The code expired. Start again to get a new one." };
    case "access_denied": return { status: "denied", message: "Sign-in was cancelled on GitHub." };
    default: return { status: "error", message: error.data.error_description ?? "GitHub could not complete sign-in." };
  }
}

export async function refreshAccessToken(clientId: string, refreshToken: string, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<Omit<StoredGitHubAuth, "login">> {
  const body = await postForm(fetchImpl, ACCESS_TOKEN_URL, { client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken });
  const token = tokenSchema.safeParse(body);
  if (!token.success) throw new Error("GitHub sign-in expired. Sign in again.");
  return toStoredAuth(token.data, now);
}

export function needsRefresh(auth: Pick<StoredGitHubAuth, "accessTokenExpiresAt">, now = Date.now()): boolean {
  if (!auth.accessTokenExpiresAt) return false;
  return Date.parse(auth.accessTokenExpiresAt) - REFRESH_MARGIN_MS <= now;
}

let refreshing: Promise<string> | null = null;

/**
 * Returns a usable GitHub token: the GitHub App user token (refreshing it when needed), otherwise the
 * personal access token from settings or the environment.
 */
export async function getGitHubToken(): Promise<string> {
  const config = await getConfig();
  const auth = config.githubAuth;
  if (!auth?.accessToken) {
    if (!config.githubToken) throw new Error("Connect GitHub before continuing.");
    return config.githubToken;
  }
  if (!needsRefresh(auth)) return auth.accessToken;
  const clientId = getGitHubAppClientId();
  if (!clientId || !auth.refreshToken) throw new Error("GitHub sign-in expired. Sign in again.");
  refreshing ??= (async () => {
    try {
      const next = await refreshAccessToken(clientId, auth.refreshToken);
      await saveConfig({ githubAuth: { ...next, login: auth.login } });
      return next.accessToken;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export function appInstallUrl(slug: string | null): string | null {
  return slug ? `https://github.com/apps/${slug}/installations/new` : null;
}
