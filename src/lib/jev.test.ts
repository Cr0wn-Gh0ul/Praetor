import { afterEach, describe, expect, it, vi } from "vitest";
import { askJev } from "./jev";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllGlobals());

const questions = { fits: { type: "noul" as const, instructions: "Does this issue fit the template?" } };

describe("askJev", () => {
  it("returns validated probabilities and usage from the Decisions API", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "typesafe/jev-1.13-20260917",
      answers: { fits: { type: "noul", noul: 0.87 } },
      usage: { input_tokens: 120, output_tokens: 8, cost: 0.00001 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await askJev("secret", { issue: "example" }, questions);
    expect(result.scores.fits).toBe(0.87);
    expect(result.usage.cost).toBe(0.00001);
    expect(fetch).toHaveBeenCalledWith("https://openrouter.ai/api/alpha/decisions", expect.objectContaining({ method: "POST" }));
  });

  it("rejects incomplete or malformed decisions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "jev", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })));
    await expect(askJev("secret", {}, questions)).rejects.toThrow("incomplete decision");
  });
});
