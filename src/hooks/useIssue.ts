"use client";

import useSWR from "swr";
import type { IssueDetail } from "@/lib/types";

async function fetchIssue(url: string): Promise<IssueDetail> {
  const response = await fetch(url, { cache: "no-store" });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result === "object" && result !== null && "error" in result
      ? String((result.error as { message?: unknown }).message ?? "Request failed")
      : "Request failed. Try refreshing.";
    throw new Error(message);
  }
  return result as IssueDetail;
}

export function useIssue(issueNumber: number | null) {
  return useSWR<IssueDetail>(issueNumber ? `/api/issues/${issueNumber}` : null, fetchIssue, {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  });
}