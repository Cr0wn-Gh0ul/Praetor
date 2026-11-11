"use client";

import Link from "next/link";
import { CircleAlert, Database, FolderCog, LoaderCircle, RefreshCw } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import type { ContextSync } from "@/hooks/useIndex";
import { formatRelativeTime } from "@/lib/format";

export function contextTone(sync: ContextSync): { color: string; label: string } {
  if (sync.running) return { color: "var(--signal)", label: `Indexing ${sync.job?.progress ?? 0}%` };
  if (sync.error) return { color: "var(--warning)", label: "Index failed" };
  if (sync.metadata) return { color: "var(--success)", label: "Ready" };
  if (sync.loading) return { color: "var(--faint)", label: "Checking context…" };
  return { color: "var(--warning)", label: "Not indexed" };
}

/** Header control that explains, shows, and refreshes the repository context index. */
export function ContextStatus({ sync }: { sync: ContextSync }) {
  const tone = contextTone(sync);
  return (
    <Popover
      label="Repository context"
      triggerClassName="chip h-9 rounded-lg px-3"
      panelClassName="w-[min(22rem,calc(100vw-2rem))]"
      trigger={
        <>
          {sync.running ? <LoaderCircle size={13} className="animate-spin" style={{ color: tone.color }} /> : <span className="status-dot" style={{ background: tone.color }} />}
          <span className="hidden md:inline">Context</span>
          <span className="hidden text-[var(--ink)] lg:inline">· {tone.label}</span>
        </>
      }
    >
      {() => <ContextDetails sync={sync} />}
    </Popover>
  );
}

export function ContextDetails({ sync }: { sync: ContextSync }) {
  const { metadata, job, running, error } = sync;
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Database size={15} className="text-[var(--accent)]" />
        <p className="text-sm font-semibold">Repository context</p>
      </div>
      <p className="mb-4 text-xs leading-5 text-[var(--muted)]">
        The assistant searches a local index of your repository so drafts and plans reference real files. Re-sync after large changes; merges made here update it automatically.
      </p>

      {running ? (
        <div className="mb-4">
          <div className="mb-1.5 flex justify-between text-xs"><span>{job?.message || "Preparing…"}</span><span className="tabular-nums text-[var(--muted)]">{job?.progress ?? 0}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.max(job?.progress ?? 0, 3)}%` }} /></div>
          <p className="mt-2 text-[11px] text-[var(--faint)]">The first run downloads a small embedding model, which can take a minute.</p>
        </div>
      ) : metadata ? (
        <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Files" value={metadata.fileCount.toLocaleString()} />
          <Stat label="Chunks" value={metadata.chunkCount.toLocaleString()} />
          <Stat label="Synced" value={formatRelativeTime(metadata.indexedAt)} />
        </dl>
      ) : (
        <p className="mb-4 rounded-lg border border-dashed border-[var(--line-strong)] p-3 text-xs leading-5 text-[var(--muted)]">
          Not indexed yet. Until then, the assistant only knows what you type, and file attachments are unavailable.
        </p>
      )}

      {error && <p className="mb-3 flex items-start gap-2 text-xs leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" />{error}</p>}
      {metadata && !running && <p className="mb-3 truncate font-mono text-[11px] text-[var(--faint)]">commit {metadata.commit.slice(0, 7)}</p>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void sync.start()} disabled={running} className="btn btn-primary btn-sm">
          {running ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {metadata ? "Re-sync" : "Index repository"}
        </button>
        <Link href="/context" className="btn btn-ghost btn-sm"><FolderCog size={13} /> Manage context</Link>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-2 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
