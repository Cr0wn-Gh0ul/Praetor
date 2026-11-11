import { describe, expect, it, vi } from "vitest";
import { createModelCatalog, normalizeModelCatalog } from "./models";

vi.mock("server-only", () => ({}));
vi.mock("./config", () => ({ getConfig: async () => ({ openRouterApiKey: "" }) }));

const payload = {
  data: [
    {
      id: "anthropic/claude-sonnet-4",
      name: "Anthropic: Claude Sonnet 4",
      context_length: 200_000,
      created: 200,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools", "temperature"],
      architecture: { output_modalities: ["text"] },
    },
    {
      id: "anthropic/claude-3-haiku",
      name: "Anthropic: Claude 3 Haiku",
      context_length: 200_000,
      created: 100,
      pricing: { prompt: "0.00000025", completion: "0.00000125" },
      supported_parameters: ["temperature"],
    },
    { id: "openrouter/auto", name: "Auto Router", context_length: null, pricing: { prompt: "-1", completion: "-1" } },
    { id: "black-forest-labs/flux", name: "Flux", architecture: { output_modalities: ["image"] } },
    { id: "anthropic/claude-sonnet-4:batch", name: "Anthropic: Batch", endpoints: ["/api/v1/batches"] },
    { id: "anthropic/claude-sonnet-4", name: "Duplicate" },
    { name: "Missing id" },
  ],
};

describe("model catalog", () => {
  it("normalizes names, prices, capabilities, and ordering", () => {
    const models = normalizeModelCatalog(payload);

    expect(models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4", "anthropic/claude-3-haiku", "openrouter/auto", "typesafe/jev-router"]);
    expect(models[0]).toMatchObject({ name: "Claude Sonnet 4", provider: "Anthropic", promptPrice: 3, completionPrice: 15, structuredOutput: true, contextLength: 200_000 });
    expect(models[1]).toMatchObject({ promptPrice: 0.25, structuredOutput: false });
    expect(models[2]).toMatchObject({ provider: "openrouter", name: "Auto Router", promptPrice: null, contextLength: null });
    expect(models[3]).toMatchObject({ id: "typesafe/jev-router", provider: "TypeSafe", name: "Jev Router" });
  });

  it("rejects payloads that are not a model list", () => {
    expect(() => normalizeModelCatalog({ models: [] })).toThrow(/unexpected/);
  });

  it("caches results and serves stale data when a refresh fails", async () => {
    let time = 0;
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockRejectedValueOnce(new Error("offline"));
    const catalog = createModelCatalog({ fetchImpl, getApiKey: async () => "key", now: () => time, ttlMs: 1_000 });

    const first = await catalog.getModelCatalog();
    expect(await catalog.getModelCatalog()).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer key" });

    time = 5_000;
    expect(await catalog.getModelCatalog()).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces errors when nothing is cached", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 500 }));
    const catalog = createModelCatalog({ fetchImpl, getApiKey: async () => "" });
    await expect(catalog.getModelCatalog()).rejects.toThrow(/status 500/);
  });
});
