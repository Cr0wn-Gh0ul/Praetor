"use client";

import { useState } from "react";
import { CircleAlert, ExternalLink, GitMerge, LoaderCircle, RotateCcw } from "lucide-react";
import type { IssueDetail } from "@/lib/types";

const ciLabels = {
  pending: { text: "Checks running", className: "text-[var(--muted)]" },
  success: { text: "Checks passed", className: "text-[var(--accent)]" },
  failure: { text: "Checks failed", className: "text-[var(--warning)]" },
  unknown: { text: "Checks unavailable", className: "text-[var(--muted)]" },
} as const;

export function PullRequestControls({ issue, onMerged }: { issue: IssueDetail; onMerged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pullRequest = issue.pullRequest;
  if (!pullRequest) return null;
  const pullRequestNumber = pullRequest.number;

  const changesRequested = pullRequest.reviews.changesRequested;
  const mergeBlocker = pullRequest.ciStatus !== "success" ? "Merging unlocks once checks pass." : changesRequested > 0 ? `${changesRequested} reviewer${changesRequested === 1 ? " has" : "s have"} requested changes.` : "";

  async function resume() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/issues/${issue.number}/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "pr-created" }) });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not resume this pull request.");
      onMerged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not resume this pull request.");
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!window.confirm(`Merge pull request #${pullRequestNumber}?`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/issues/${issue.number}/merge`, { method: "POST" });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not merge pull request.");
      onMerged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not merge pull request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5">
      <a href={pullRequest.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 text-sm font-semibold hover:text-[var(--accent)]">
        <span className="truncate">Pull request #{pullRequest.number}</span><ExternalLink size={14} className="shrink-0" />
      </a>
      <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${ciLabels[pullRequest.ciStatus].className}`}>
        {pullRequest.ciStatus === "pending" ? <LoaderCircle size={12} className="animate-spin" /> : <span className="status-dot" style={{ background: "currentColor" }} />}
        {ciLabels[pullRequest.ciStatus].text}
      </p>
      {pullRequest.state === "merged" ? (
        <p className="mt-4 rounded-lg bg-[var(--success)]/10 px-3 py-2 text-xs text-[var(--success)]">Merged · context reindex queued</p>
      ) : pullRequest.state === "open" ? (
        <>
          <button type="button" onClick={() => void merge()} disabled={busy || Boolean(mergeBlocker)} className="btn btn-primary mt-4 w-full">
            {busy ? <LoaderCircle className="animate-spin" size={15} /> : <GitMerge size={15} />} Merge pull request
          </button>
          {mergeBlocker && <p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">{mergeBlocker}</p>}
          {issue.agentState === "needs-human" && <>
            <button type="button" onClick={() => void resume()} disabled={busy || changesRequested > 0} className="btn btn-secondary mt-3 w-full"><RotateCcw size={14} />Mark as ready for review</button>
            <p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">{changesRequested > 0 ? "Available once requested changes are resolved or dismissed on GitHub." : "Moves the issue back to the pull request stage."}</p>
          </>}
        </>
      ) : <p className="mt-4 text-xs text-[var(--muted)]">Pull request closed without merging.</p>}
      {error && <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" />{error}</p>}
    </div>
  );
}