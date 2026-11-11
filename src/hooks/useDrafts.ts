"use client";

import useSWR from "swr";
import type { DraftIssue } from "@/lib/types";

async function fetchDrafts(url: string): Promise<DraftIssue[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error("Could not load local drafts.");
  return result as DraftIssue[];
}

export function useDrafts() {
  return useSWR<DraftIssue[]>("/api/drafts", fetchDrafts, { refreshInterval: 10_000 });
}