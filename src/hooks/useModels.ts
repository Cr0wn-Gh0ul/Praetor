"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { MODEL_ID_PATTERN, type ModelStage } from "@/lib/constants";
import type { ModelCatalog } from "@/lib/types";

async function fetchCatalog(url: string): Promise<ModelCatalog> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json() as ModelCatalog | { error?: { message?: string } };
  if (!response.ok) throw new Error("error" in result ? result.error?.message ?? "Could not load models." : "Could not load models.");
  return result as ModelCatalog;
}

export function useModels() {
  return useSWR<ModelCatalog>("/api/models", fetchCatalog, { revalidateOnFocus: false, dedupingInterval: 10 * 60_000 });
}

const storageKey = (stage: ModelStage) => `codeless.model.${stage}`;

/** Remembers the last model chosen for a stage in this browser, falling back to the workspace default. */
export function useStoredModel(stage: ModelStage, fallback: string) {
  const [model, setModel] = useState(fallback);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey(stage));
    if (stored && MODEL_ID_PATTERN.test(stored)) setModel(stored);
    else setModel(fallback);
  }, [fallback, stage]);

  function update(next: string) {
    setModel(next);
    if (next === fallback) window.localStorage.removeItem(storageKey(stage));
    else window.localStorage.setItem(storageKey(stage), next);
  }

  return [model, update] as const;
}
