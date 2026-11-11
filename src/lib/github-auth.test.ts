import { describe, expect, it, vi } from "vitest";
import { getGitHubAppClientId, needsRefresh, pollDeviceCode, refreshAccessToken, requestDeviceCode } from "./github-auth";

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ getConfig: vi.fn(), saveConfig: vi.fn() }));

function respond(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
}

describe("GitHub App device flow", () => {
  it("validates the configured client ID", () => {
    expect(getGitHubAppClientId({ GITHUB_APP_CLIENT_ID: "Iv23liAbCdEfGh123456" })).toBe("Iv23liAbCdEfGh123456");
    expect(getGitHubAppClientId({ GITHUB_APP_CLIENT_ID: "not a client id" })).toBeNull();
    expect(getGitHubAppClientId({})).toBeNull();
  });

  it("requests a device code with only the client ID", async () => {
    const fetchImpl = respond({ device_code: "dev", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
    await expect(requestDeviceCode("Iv23liAbCdEfGh123456", fetchImpl)).resolves.toEqual({ deviceCode: "dev", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 900, interval: 5 });
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body);
    expect(body).toBe("client_id=Iv23liAbCdEfGh123456");
  });

  it("explains a disabled device flow", async () => {
    await expect(requestDeviceCode("Iv23liAbCdEfGh123456", respond({ error: "device_flow_disabled" }))).rejects.toThrow(/not enabled/);
  });

  it("maps polling responses", async () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    await expect(pollDeviceCode("c", "d", 5, respond({ error: "authorization_pending" }))).resolves.toEqual({ status: "pending", interval: 5 });
    await expect(pollDeviceCode("c", "d", 5, respond({ error: "slow_down", interval: 10 }))).resolves.toEqual({ status: "pending", interval: 10 });
    await expect(pollDeviceCode("c", "d", 5, respond({ error: "access_denied" }))).resolves.toMatchObject({ status: "denied" });
    await expect(pollDeviceCode("c", "d", 5, respond({ error: "expired_token" }))).resolves.toMatchObject({ status: "expired" });
    await expect(pollDeviceCode("c", "d", 5, respond({ access_token: "ghu_x", refresh_token: "ghr_y", expires_in: 28_800, refresh_token_expires_in: 15_897_600 }), now)).resolves.toEqual({
      status: "authorized",
      auth: { method: "app", accessToken: "ghu_x", refreshToken: "ghr_y", accessTokenExpiresAt: "2026-01-01T08:00:00.000Z", refreshTokenExpiresAt: "2026-07-04T00:00:00.000Z" },
    });
  });

  it("refreshes tokens and decides when a refresh is due", async () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    await expect(refreshAccessToken("c", "ghr_y", respond({ access_token: "ghu_new", refresh_token: "ghr_new", expires_in: 28_800 }), now)).resolves.toMatchObject({ accessToken: "ghu_new", refreshToken: "ghr_new" });
    await expect(refreshAccessToken("c", "bad", respond({ error: "bad_refresh_token" }))).rejects.toThrow(/Sign in again/);
    expect(needsRefresh({ accessTokenExpiresAt: "2026-01-01T00:03:00.000Z" }, now)).toBe(true);
    expect(needsRefresh({ accessTokenExpiresAt: "2026-01-01T01:00:00.000Z" }, now)).toBe(false);
    expect(needsRefresh({ accessTokenExpiresAt: "" }, now)).toBe(false);
  });
});
