"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, Database, FileCode2, FolderTree, LoaderCircle, RefreshCw } from "lucide-react";
import { useContextSync } from "@/hooks/useIndex";
import { formatRelativeTime } from "@/lib/format";
import { contextPathSchema } from "@/lib/schemas";
import { RepositoryPathPicker } from "@/components/repository/RepositoryPathPicker";

export function ContextWorkspace({ targetRepo, baseBranch, initialPaths }: { targetRepo: string; baseBranch: string; initialPaths: string[] }) {
  const sync = useContextSync(true);
  const [paths, setPaths] = useState(initialPaths);
  const [savedPaths, setSavedPaths] = useState(initialPaths);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selectedPaths = [...new Set(paths.map((value) => value.trim()).filter(Boolean))];
  const dirty = selectedPaths.join("\n") !== savedPaths.join("\n");

  async function saveAndIndex() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalContextPaths: selectedPaths }),
      });
      const result = await response.json() as { additionalContextPaths?: string[]; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not save context paths.");
      const normalized = result.additionalContextPaths ?? selectedPaths;
      setSavedPaths(normalized);
      setPaths(normalized);
      if (await sync.start()) setMessage("Paths saved. Repository indexing started.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save context paths.");
    } finally {
      setBusy(false);
    }
  }

  const files = sync.metadata?.files ?? [];

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-7 md:px-10 md:py-10">
      <header className="mb-8 flex items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <Link href="/dashboard" className="btn btn-ghost btn-sm -ml-2.5"><ArrowLeft size={15} /> Back to workspace</Link>
        <div className="flex min-w-0 items-center gap-3"><Link href="/explorer" className="btn btn-ghost btn-sm"><FolderTree size={14} />Explorer</Link><span className="truncate text-xs text-[var(--muted)]">{targetRepo}</span></div>
      </header>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--muted)]"><Database size={14} />Repository context</p><h1 className="text-3xl font-semibold">Context</h1></div>
        <span className={`text-xs ${sync.error ? "text-[var(--warning)]" : sync.metadata ? "text-[var(--success)]" : "text-[var(--muted)]"}`}>{sync.running ? `Indexing ${sync.job?.progress ?? 0}%` : sync.error ? "Index failed" : sync.metadata ? `Synced ${formatRelativeTime(sync.metadata.indexedAt)}` : sync.loading ? "Checking index…" : "Not indexed"}</span>
      </div>

      <section className="border-y border-[var(--line)] py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Additional paths</h2>{sync.metadata && <span className="text-xs text-[var(--muted)]">{sync.metadata.fileCount} files indexed</span>}</div>
        <p className="mb-4 max-w-2xl text-sm leading-6 text-[var(--muted)]">Add repository-relative files or folders to Praetor’s context index. These paths are saved locally and do not change repository files or open a pull request.</p>
        <div className="max-w-3xl"><RepositoryPathPicker refName={baseBranch} label="Browse repository" description="Select files or folders to add to the local context index. Selecting a folder includes its contents." value={selectedPaths} onChange={setPaths} canSelectPath={(path) => contextPathSchema.safeParse(path).success} /></div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || sync.running} onClick={() => void saveAndIndex()} className="btn btn-primary">{busy || sync.running ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}{dirty ? "Save paths and re-sync" : sync.metadata ? "Save and re-sync" : "Save paths and index"}</button>
          {sync.metadata && <span className="text-xs text-[var(--muted)]">Commit {sync.metadata.commit.slice(0, 7)}</span>}
        </div>
        {(error || sync.error) && <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-[var(--warning)]"><CircleAlert size={15} className="mt-0.5 shrink-0" />{error || sync.error}</p>}
        {message && <p role="status" className="mt-4 text-sm text-[var(--success)]">{message}</p>}
        {sync.running && <p className="mt-4 text-sm text-[var(--muted)]">{sync.job?.message || "Preparing repository index…"}</p>}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2"><FileCode2 size={15} className="text-[var(--accent)]" /><h2 className="text-base font-semibold">Indexed files</h2></div>
        {files.length ? <div className="max-h-[32rem] divide-y divide-[var(--line)] overflow-auto border-y border-[var(--line)]">
          {files.slice(0, 500).map((file) => <div key={file} className="px-3 py-2 font-mono text-xs text-[var(--muted)]">{file}</div>)}
          {files.length > 500 && <p className="px-3 py-3 text-xs text-[var(--faint)]">Showing 500 of {files.length} indexed files.</p>}
        </div> : <p className="border-y border-[var(--line)] py-5 text-sm text-[var(--muted)]">{sync.loading ? "Loading indexed files…" : "No indexed files yet. Add paths above, then index the repository."}</p>}
      </section>
    </main>
  );
}