import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "../constants";
import { tensorToVectors } from "./embed";

vi.mock("server-only", () => ({}));

describe("embedding tensor validation", () => {
  it("converts correctly-sized finite vectors", () => {
    const row = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / EMBEDDING_DIMENSIONS);
    expect(tensorToVectors({ tolist: () => [row] }, 1)).toEqual([row]);
  });

  it("rejects malformed vectors and batch sizes", () => {
    expect(() => tensorToVectors({ tolist: () => [[]] }, 1)).toThrow("invalid vector");
    expect(() => tensorToVectors({ tolist: () => [] }, 1)).toThrow("unexpected batch size");
  });
});