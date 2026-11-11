"use client";

import useSWR from "swr";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { MonacoDiff } from "./MonacoDiff";
import type { FileDiff } from "@/lib/github";

async function fetchDiff(url: string): Promise<FileDiff[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json() as FileDiff[] | { error?: { message?: string } };
  if (!response.ok) throw new Error("error" in result ? result.error?.message ?? "Could not load diff." : "Could not load diff.");
  return result as FileDiff[];
}

export function DiffPanel({ issueNumber, onSelection, refreshKey }: { issueNumber: number; onSelection: (code: string) => void; refreshKey: number }) {
  const { data: files, error, isLoading } = useSWR<FileDiff[]>(`/api/issues/${issueNumber}/diff?refresh=${refreshKey}`, fetchDiff, { revalidateOnFocus: true });
  if (isLoading) return <div className="grid h-[min(70vh,760px)] min-h-[420px] place-items-center text-sm text-[var(--muted)]"><LoaderCircle className="animate-spin" size={18} /></div>;
  if (error) return <p className="flex items-center gap-2 p-5 text-sm text-[var(--warning)]"><CircleAlert size={16} />{error.message}</p>;
  return <MonacoDiff files={files ?? []} onSelection={onSelection} />;
}