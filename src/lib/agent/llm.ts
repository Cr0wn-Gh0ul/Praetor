import "server-only";

import { streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { apiError } from "../api-response";
import { DEFAULT_MODELS } from "../constants";
import { getConfig } from "../config";

export type AgentStage = keyof typeof DEFAULT_MODELS;

export async function getModel(stage: AgentStage, override?: string) {
  const config = await getConfig();
  if (!config.openRouterApiKey) throw new Error("OpenRouter API key is not configured.");
  const provider = createOpenRouter({ apiKey: config.openRouterApiKey, compatibility: "strict", appName: "Praetor" });
  return provider(override || config.models[stage] || DEFAULT_MODELS[stage]);
}

export async function streamMarkdown(options: {
  stage: AgentStage;
  prompt: string;
  system?: string;
  model?: string;
  abortSignal?: AbortSignal;
}) {
  const model = await getModel(options.stage, options.model);
  return streamText({
    model,
    system: options.system,
    prompt: options.prompt,
    abortSignal: options.abortSignal,
    maxOutputTokens: 8_000,
    temperature: 0.2,
  });
}

/** Maps provider failures to actionable messages without echoing provider payloads. */
export function describeModelError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
  if (status === 401 || status === 403) return "OpenRouter rejected the API key. Update it in Settings.";
  if (status === 402) return "OpenRouter reports insufficient credits for this model.";
  if (status === 404 || /not a valid model|no endpoints|model.*not found/i.test(message)) return "That model is not available on OpenRouter. Choose another model.";
  if (status === 429) return "The model is rate limited right now. Wait a moment or choose another model.";
  return "The model request failed. Try again or choose another model.";
}

type MarkdownStream = Awaited<ReturnType<typeof streamMarkdown>>;

/**
 * Streams model text to the client. Failures before the first token become JSON API errors, and
 * `onComplete` runs (and finishes) before the stream closes, so clients can refetch saved state
 * as soon as the response ends. Aborted or empty generations are never passed to `onComplete`.
 */
export async function toTextStreamResponse(result: MarkdownStream, options: {
  onComplete?: (text: string) => Promise<void>;
  headers?: Record<string, string>;
  abortSignal?: AbortSignal;
} = {}): Promise<Response> {
  const iterator = result.fullStream[Symbol.asyncIterator]();
  let firstText = "";
  while (!firstText) {
    const next = await iterator.next();
    if (next.done || next.value.type === "abort") {
      return apiError("MODEL_EMPTY_RESPONSE", "The model returned an empty response. Try again or choose another model.", 502);
    }
    if (next.value.type === "error") return apiError("MODEL_REQUEST_FAILED", describeModelError(next.value.error), 502);
    if (next.value.type === "text-delta") firstText = next.value.text;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = firstText;
      controller.enqueue(encoder.encode(firstText));
      try {
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          const part = next.value;
          if (part.type === "text-delta") {
            text += part.text;
            controller.enqueue(encoder.encode(part.text));
          } else if (part.type === "error") {
            throw new Error(describeModelError(part.error));
          } else if (part.type === "abort") {
            controller.close();
            return;
          }
        }
        if (options.abortSignal?.aborted) {
          controller.close();
          return;
        }
        await options.onComplete?.(text);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...options.headers },
  });
}
