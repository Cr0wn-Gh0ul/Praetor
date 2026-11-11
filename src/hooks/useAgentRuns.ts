"use client";

import useSWR from "swr";

export type AgentRunStatus = {
  id: number;
  title: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "unknown";
  conclusion: string | null;
  event: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
};

async function fetchRuns(url: string): Promise<AgentRunStatus[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json() as { runs?: AgentRunStatus[]; error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? "Could not read agent workflow status.");
  return result.runs ?? [];
}

export function useAgentRuns(issueNumber: number) {
  return useSWR(`/api/agent/runs?issue=${issueNumber}`, fetchRuns, { refreshInterval: 5_000, revalidateOnFocus: true });
}

export function isAgentRunActive(run: AgentRunStatus | undefined): boolean {
  return Boolean(run && (run.status === "queued" || run.status === "in_progress" || run.status === "waiting"));
}
