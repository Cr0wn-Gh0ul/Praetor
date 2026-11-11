import "server-only";

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../constants";

type TensorLike = { tolist: () => unknown };
type FeaturePipeline = (texts: string | string[], options: { pooling: "mean"; normalize: true }) => Promise<TensorLike>;

let pipelinePromise: Promise<FeaturePipeline> | null = null;

function modelCacheDirectory(): string {
  return path.join(path.resolve(process.env.DATA_DIR ?? (process.env.DOCKER === "1" ? "/data" : ".data")), "models");
}

async function getPipeline(): Promise<FeaturePipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const cacheDir = modelCacheDirectory();
      await mkdir(cacheDir, { recursive: true, mode: 0o700 });
      const { pipeline } = await import("@huggingface/transformers");
      return await pipeline("feature-extraction", EMBEDDING_MODEL, { cache_dir: cacheDir }) as FeaturePipeline;
    })().catch((error: unknown) => {
      pipelinePromise = null;
      throw error;
    });
  }
  return pipelinePromise;
}

export function tensorToVectors(tensor: TensorLike, expectedCount: number): number[][] {
  const rows = tensor.tolist();
  if (!Array.isArray(rows) || rows.length !== expectedCount) {
    throw new Error("Embedding model returned an unexpected batch size.");
  }
  const vectors = rows.map((row) => {
    if (!Array.isArray(row) || row.length !== EMBEDDING_DIMENSIONS || !row.every((value) => typeof value === "number" && Number.isFinite(value))) {
      throw new Error("Embedding model returned an invalid vector.");
    }
    return row;
  });
  return vectors;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  const vectors: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const tensor = await extractor(batch, { pooling: "mean", normalize: true });
    vectors.push(...tensorToVectors(tensor, batch.length));
  }
  return vectors;
}