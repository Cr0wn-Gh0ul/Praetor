import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfigStore } from "./config";

vi.mock("server-only", () => ({}));

const temporaryDirectories: string[] = [];

async function createStore(env: Record<string, string | undefined> = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "codeless-config-"));
  temporaryDirectories.push(dataDir);
  return { dataDir, store: createConfigStore({ dataDir, env }) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("config store", () => {
  it("allows onboarding to finish before a repository is selected", async () => {
    const { store } = await createStore();
    await store.saveConfig({ githubToken: "ghp-test-token", openRouterApiKey: "or-test-key" });

    expect(await store.isConfigured()).toBe(true);
    await expect(store.getConfig()).resolves.toMatchObject({ targetRepo: "", githubAuth: null });
  });

  it("persists settings and returns only safe public connection details", async () => {
    const { dataDir, store } = await createStore();
    const config = await store.saveConfig({
      githubToken: "ghp-test-token",
      openRouterApiKey: "or-test-key",
      targetRepo: "owner/repo",
      baseBranch: "main",
      additionalContextPaths: ["src/extra", "docs/guide.md"],
    });

    expect(await store.isConfigured()).toBe(true);
    expect(config.targetRepo).toBe("owner/repo");
    expect(await store.getPublicConfig()).toMatchObject({
      github: { method: "token", login: "", fromEnvironment: false },
      openRouterApiKeyMasked: "********",
      additionalContextPaths: ["src/extra", "docs/guide.md"],
    });

    const persisted = await readFile(path.join(dataDir, "config.json"), "utf8");
    expect(persisted).toContain("ghp-test-token");
  });

  it("rejects unsafe additional context paths", async () => {
    const { store } = await createStore();
    await expect(store.saveConfig({ additionalContextPaths: ["../secrets"] })).rejects.toThrow();
    await expect(store.saveConfig({ additionalContextPaths: ["src/.env.local"] })).rejects.toThrow();
  });

  it("drops legacy webhook settings when reading saved configuration", async () => {
    const { dataDir, store } = await createStore();
    await writeFile(path.join(dataDir, "config.json"), JSON.stringify({
      githubToken: "saved-token",
      webhookUrl: "https://old.example.test",
      webhookSecret: "old-secret",
      webhookSkipVerify: true,
    }));

    const config = await store.getConfig();
    expect(config).not.toHaveProperty("webhookUrl");
    expect(config).not.toHaveProperty("webhookSecret");
    expect(config).not.toHaveProperty("webhookSkipVerify");
  });

  it("lets environment values override saved values", async () => {
    const { store } = await createStore({ GITHUB_TOKEN: "environment-token" });
    await store.saveConfig({ githubToken: "saved-token", targetRepo: "owner/repo" });

    await expect(store.getConfig()).resolves.toMatchObject({
      githubToken: "environment-token",
      targetRepo: "owner/repo",
    });
  });

  it("merges model settings rather than discarding defaults", async () => {
    const { store } = await createStore();
    const config = await store.saveConfig({ models: { code: "provider/model" } });

    expect(config.models).toMatchObject({ code: "provider/model", draft: expect.any(String), plan: expect.any(String), review: expect.any(String) });
  });
});