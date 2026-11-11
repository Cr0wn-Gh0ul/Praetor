"use client";

import useSWR from "swr";
import type { DraftIssue } from "@/lib/types";

async function fetchDraft(url: string): Promise<DraftIssue> {
  const response = await fetch(url, { cache: "no-store" });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error("Could not load this draft.");
  return result as DraftIssue;
}

export function useDraft(id: string | null) {
  return useSWR<DraftIssue>(id ? `/api/drafts/${id}` : null, fetchDraft);
}