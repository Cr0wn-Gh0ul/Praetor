"use client";

import dynamic from "next/dynamic";
import type { FileDiff } from "@/lib/github";

const MonacoDiffClient = dynamic(() => import("./MonacoDiff.client"), {
  ssr: false,
  loading: () => <div className="grid h-[min(70vh,760px)] min-h-[420px] place-items-center border border-[var(--line)] text-sm text-[var(--muted)]">Loading editor…</div>,
});

export function MonacoDiff({ files, onSelection }: { files: FileDiff[]; onSelection: (selection: string) => void }) {
  return <MonacoDiffClient files={files} onSelection={onSelection} />;
}