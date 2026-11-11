"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, ExternalLink, GitPullRequest, LoaderCircle, Send } from "lucide-react";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { ModelPicker } from "@/components/models/ModelPicker";
import { useAgentRuns, isAgentRunActive } from "@/hooks/useAgentRuns";
import { useStoredModel } from "@/hooks/useModels";
import type { IssueDetail } from "@/lib/types";
import { renderRunStatus } from "@/components/issue/PlanActions";

export function CodeReviewActions({ issue, selectedCode, defaultModel, setupReady, onChanged, onRefined }: {
  issue: IssueDetail;
  selectedCode: string;
  defaultModel: string;
  setupReady: boolean;
  onChanged: () => void;
  onRefined: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pullRequestUrl, setPullRequestUrl] = useState("");
  const [model, setModel] = useStoredModel("code", defaultModel);
  const { data: runs, error: runsError } = useAgentRuns(issue.number);
  const refineRun = runs?.find((run) => run.title.startsWith("Praetor refine #") || run.title.startsWith("Codeless refine #"));
  const handled = useRef<number | null>(null);

  useEffect(() => {
    if (refineRun?.status !== "completed" || handled.current === refineRun.id) return;
    handled.current = refineRun.id;
    onRefined();
    onChanged();
  }, [onChanged, onRefined, refineRun]);

  async function refine(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agent/refine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueNumber: issue.number, instruction, selectedCode, model }) });
      const result = await response.json() as { dispatched?: boolean; error?: { message?: string } };
      if (!response.ok || !result.dispatched) throw new Error(result.error?.message ?? "Could not start refinement.");
      setInstruction("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start refinement.");
    } finally {
      setBusy(false);
    }
  }

  async function createPullRequest() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/issues/${issue.number}/pr`, { method: "POST" });
      const result = await response.json() as { htmlUrl?: string; error?: { message?: string } };
      if (!response.ok || !result.htmlUrl) throw new Error(result.error?.message ?? "Could not create pull request.");
      setPullRequestUrl(result.htmlUrl);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create pull request.");
    } finally {
      setBusy(false);
    }
  }

  const refining = isAgentRunActive(refineRun) || busy;

  return (
    <div className="space-y-5 p-5">
      <form onSubmit={(event) => void refine(event)}>
        {selectedCode && <div className="mb-2 rounded border-l-2 border-[var(--accent)] bg-white/[0.03] p-2.5"><p className="mb-1.5 text-[10px] font-semibold text-[var(--accent)]">Selected code included</p><pre className="max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-4 text-[var(--muted)]">{selectedCode}</pre></div>}
        <MarkdownEditor id="refine-instruction" label="Request a refinement" value={instruction} onChange={setInstruction} rows={4} placeholder="Describe the change to make…" compact />
        <p className="mb-1.5 mt-3 text-[11px] font-semibold text-[var(--muted)]">Coding model</p><ModelPicker stage="code" value={model} defaultModel={defaultModel} onChange={setModel} size="sm" align="end" disabled={refining} />
        <button type="submit" disabled={!setupReady || refining || !instruction.trim()} title={!setupReady ? "Set up repository workflows first" : undefined} className="btn btn-secondary mt-3 w-full">{refining ? <><LoaderCircle size={14} className="animate-spin" /> Refining…</> : <><Send size={14} /> Apply refinement</>}</button>
        {renderRunStatus(refineRun)}
      </form>
      <div className="border-t border-[var(--line)] pt-5">
        {pullRequestUrl ? <a href={pullRequestUrl} target="_blank" rel="noreferrer" className="btn btn-secondary w-full">Pull request opened <ExternalLink size={12} /></a> : <button type="button" onClick={() => void createPullRequest()} disabled={busy || refining} className="btn btn-primary w-full">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <GitPullRequest size={15} />} Open pull request</button>}
        <p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">Open a PR so CI can run. You merge it after checks pass.</p>
      </div>
      {(error || runsError) && <p className="flex items-start gap-2 text-xs leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" />{error || runsError?.message}</p>}
    </div>
  );
}
