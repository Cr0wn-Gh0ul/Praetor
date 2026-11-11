"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import type { JobStatus } from "@/lib/types";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error("Could not read repository index status.");
  return result as T;
}

export type IndexMetadata = {
  repoKey: string;
  commit: string;
  files: string[];
  fileCount: number;
  chunkCount: number;
  indexedAt: string;
};

export function useIndexStatus(enabled = true) {
  return useSWR<IndexMetadata | null>(enabled ? "/api/index-repo" : null, fetchJson, { refreshInterval: 10_000 });
}

export function useIndexJob(jobId: string | null) {
  return useSWR<JobStatus>(jobId ? `/api/index-repo?jobId=${encodeURIComponent(jobId)}` : null, fetchJson, {
    refreshInterval: (latest) => !jobId || latest?.status === "completed" || latest?.status === "failed" ? 0 : 1_500,
    revalidateOnFocus: true,
  });
}

export type ContextSync = {
  metadata: IndexMetadata | null;
  loading: boolean;
  job: JobStatus | null;
  running: boolean;
  error: string;
  start: () => Promise<boolean>;
  refresh: () => void;
  dismiss: () => void;
};

/** Repository index status plus a start action, shared by the header and drafting panel. */
export function useContextSync(enabled: boolean): ContextSync {
  const status = useIndexStatus(enabled);
  const [jobId, setJobId] = useState<string | null>(null);
  const [startError, setStartError] = useState("");
  const { data: job } = useIndexJob(jobId);
  const refreshStatus = status.mutate;

  useEffect(() => {
    if (job?.status === "completed") void refreshStatus();
  }, [job?.status, refreshStatus]);

  async function start(): Promise<boolean> {
    setStartError("");
    try {
      const response = await fetch("/api/index-repo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const result = await response.json() as { id?: string; error?: { message?: string } };
      if (!response.ok || !result.id) throw new Error(result.error?.message ?? "Could not start indexing.");
      setJobId(result.id);
      return true;
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : "Could not start indexing.");
      return false;
    }
  }

  return {
    metadata: status.data ?? null,
    loading: status.isLoading,
    job: job ?? null,
    running: job?.status === "queued" || job?.status === "running",
    error: startError || (job?.status === "failed" ? job.error ?? "Indexing failed." : ""),
    start,
    refresh: () => { void refreshStatus(); },
    dismiss: () => { setJobId(null); setStartError(""); },
  };
}