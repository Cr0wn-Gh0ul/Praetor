import "server-only";

import { z } from "zod";
import { getConfig } from "./config";
import type { ModelCatalog, ModelOption } from "./types";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_CACHE_TTL_MS = 15 * 60_000;
const STRUCTURED_PARAMETERS = new Set(["structured_outputs", "response_format", "tools"]);

const priceSchema = z.union([z.string(), z.number()]).nullish();

const rawModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  description: z.string().nullish(),
  context_length: z.number().nullish(),
  created: z.number().nullish(),
  pricing: z.object({ prompt: priceSchema, completion: priceSchema }).partial().nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  architecture: z.object({ output_modalities: z.array(z.string()).nullish() }).partial().nullish(),
  endpoints: z.array(z.string()).nullish(),
});

const CHAT_ENDPOINT = "/api/v1/chat/completions";

const responseSchema = z.object({ data: z.array(z.unknown()) });

function perMillion(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 1_000_000 * 10_000) / 10_000;
}

function splitDisplayName(id: string, name: string | null | undefined): { provider: string; name: string } {
  const providerSlug = id.replace(/^~/, "").split("/")[0] ?? id;
  const trimmed = name?.trim() ?? "";
  const separator = trimmed.indexOf(": ");
  if (separator > 0) return { provider: trimmed.slice(0, separator), name: trimmed.slice(separator + 2) };
  return { provider: providerSlug, name: trimmed || id };
}

/** Converts the OpenRouter `/models` payload into browser-safe, text-capable model options. */
export function normalizeModelCatalog(payload: unknown): ModelOption[] {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("OpenRouter returned an unexpected model list.");
  const models: ModelOption[] = [];
  const seen = new Set<string>();
  for (const entry of parsed.data.data) {
    const model = rawModelSchema.safeParse(entry);
    if (!model.success || seen.has(model.data.id) || !model.data.id.includes("/")) continue;
    const outputs = model.data.architecture?.output_modalities;
    if (outputs && outputs.length > 0 && !outputs.includes("text")) continue;
    // Batch-only and other non-chat models cannot serve the streaming requests this app makes.
    if (model.data.endpoints && !model.data.endpoints.includes(CHAT_ENDPOINT)) continue;
    seen.add(model.data.id);
    const display = splitDisplayName(model.data.id, model.data.name);
    models.push({
      id: model.data.id,
      name: display.name,
      provider: display.provider,
      description: model.data.description?.trim().slice(0, 280) ?? "",
      contextLength: model.data.context_length ?? null,
      promptPrice: perMillion(model.data.pricing?.prompt),
      completionPrice: perMillion(model.data.pricing?.completion),
      structuredOutput: (model.data.supported_parameters ?? []).some((parameter) => STRUCTURED_PARAMETERS.has(parameter)),
      created: model.data.created ?? 0,
    });
  }
  if (!seen.has("typesafe/jev-router")) {
    models.push({
      id: "typesafe/jev-router",
      name: "Jev Router",
      provider: "TypeSafe",
      description: "Routes chat requests to a TypeSafe model.",
      contextLength: null,
      promptPrice: null,
      completionPrice: null,
      structuredOutput: false,
      created: 0,
    });
  }
  return models.sort((left, right) => left.provider.localeCompare(right.provider) || right.created - left.created || left.name.localeCompare(right.name));
}

type CatalogOptions = {
  fetchImpl?: typeof fetch;
  getApiKey?: () => Promise<string>;
  now?: () => number;
  ttlMs?: number;
};

export function createModelCatalog(options: CatalogOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const getApiKey = options.getApiKey ?? (async () => (await getConfig()).openRouterApiKey);
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  let cached: { catalog: ModelCatalog; expiresAt: number } | null = null;
  let inflight: Promise<ModelCatalog> | null = null;

  async function load(): Promise<ModelCatalog> {
    const apiKey = await getApiKey();
    const response = await fetchImpl(OPENROUTER_MODELS_URL, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`OpenRouter model list request failed with status ${response.status}.`);
    const catalog = { models: normalizeModelCatalog(await response.json()), fetchedAt: new Date(now()).toISOString() };
    cached = { catalog, expiresAt: now() + ttlMs };
    return catalog;
  }

  async function getModelCatalog({ force = false }: { force?: boolean } = {}): Promise<ModelCatalog> {
    if (!force && cached && cached.expiresAt > now()) return cached.catalog;
    inflight ??= load().finally(() => { inflight = null; });
    try {
      return await inflight;
    } catch (error) {
      if (cached) return cached.catalog;
      throw error;
    }
  }

  return { getModelCatalog };
}

const defaultCatalog = createModelCatalog();

export const getModelCatalog = defaultCatalog.getModelCatalog;
