import "server-only";

import { z } from "zod";

const answerSchema = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) });
const responseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number(), cost: z.number().optional() }),
});

export type NoulQuestion = { type: "noul"; instructions: string };

export async function askJev<TQuestion extends Record<string, NoulQuestion>>(apiKey: string, state: unknown, questions: TQuestion) {
  const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "typesafe/jev-1.13", state, questions }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Jev decision request failed (${response.status}).`);
  }
  const result = responseSchema.parse(await response.json());
  const answerKeys = Object.keys(questions);
  if (answerKeys.some((key) => result.answers[key] === undefined)) throw new Error("Jev returned an incomplete decision.");
  return {
    model: result.model,
    scores: Object.fromEntries(answerKeys.map((key) => [key, result.answers[key]!.noul])) as Record<keyof TQuestion, number>,
    usage: result.usage,
  };
}
