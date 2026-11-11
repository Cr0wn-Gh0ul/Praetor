"use client";

import useSWR from "swr";
import type { IssueSummary } from "@/lib/types";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result === "object" && result !== null && "error" in result
      ? String((result.error as { message?: unknown }).message ?? "Request failed")
      : "Request failed. Try refreshing.";
    throw new Error(message);
  }
  return result as T;
}

export function useIssues(enabled = true, state: "open" | "closed" | "all" = "open", agentOnly = true) {
  const query = new URLSearchParams({ state, agentOnly: String(agentOnly) });
  const result = useSWR<IssueSummary[]>(enabled ? `/api/issues?${query}` : null, fetchJson, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  });
  return { ...result, refresh: result.mutate };
}