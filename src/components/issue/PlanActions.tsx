"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, ExternalLink, LoaderCircle, RotateCcw, Sparkles, Wrench } from "lucide-react";
import { MarkdownEditor } from "@/components/markdown/MarkdownEditor";
import { ModelPicker } from "@/components/models/ModelPicker";
import { useAgentRuns, isAgentRunActive, type AgentRunStatus } from "@/hooks/useAgentRuns";
import { useStoredModel } from "@/hooks/useModels";
import type { AppConfig, IssueDetail } from "@/lib/types";

/** How long a newly dispatched plan may take to show up in the workflow run list. */
const RUN_START_GRACE_MS = 2 * 60_000;

function useNow(active: boolean, intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

export function PlanActions({ issue, defaultModels, setupReady, onChanged, onApproved, planningSubmittedAt }: { issue: IssueDetail; defaultModels: AppConfig["models"]; setupReady: boolean; onChanged: () => void; onApproved: () => void; planningSubmittedAt: number | null }) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submittedPlanAt, setSubmittedPlanAt] = useState<number | null>(null);
  const [planModel, setPlanModel] = useStoredModel("plan", defaultModels.plan);
  const [codeModel, setCodeModel] = useStoredModel("code", defaultModels.code);
  const { data: runs, error: runsError } = useAgentRuns(issue.number);
  const planRun = runs?.find((run) => run.title.startsWith("Praetor plan #") || run.title.startsWith("Codeless plan #"));
  const codeRun = runs?.find((run) => run.title.startsWith("Praetor code #") || run.title.startsWith("Codeless code #"));
  const handled = useRef<number | null>(null);
  const pendingPlanAt = submittedPlanAt ?? planningSubmittedAt;
  const currentPlanRun = Boolean(planRun && pendingPlanAt && Date.parse(planRun.createdAt) >= pendingPlanAt - 5_000);
  const nowForPlan = useNow(Boolean(pendingPlanAt && !currentPlanRun));
  const planPending = Boolean(pendingPlanAt && !currentPlanRun && nowForPlan - pendingPlanAt < RUN_START_GRACE_MS);

  useEffect(() => {
    if (submittedPlanAt && currentPlanRun) setSubmittedPlanAt(null);
  }, [currentPlanRun, submittedPlanAt]);

  useEffect(() => {
    const completed = [planRun, codeRun].find((run) => run?.status === "completed");
    if (!completed || handled.current === completed.id) return;
    handled.current = completed.id;
    onChanged();
  }, [codeRun, onChanged, planRun]);

  async function dispatch(stage: "plan" | "code") {
    setBusy(true);
    setError("");
    const submittedAt = Date.now();
    try {
      const response = await fetch(`/api/agent/${stage}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stage === "plan" ? { issueNumber: issue.number, model: planModel, ...(feedback.trim() ? { feedback: feedback.trim() } : {}) } : { issueNumber: issue.number, model: codeModel }) });
      const result = await response.json() as { dispatched?: boolean; error?: { message?: string } };
      if (!response.ok || !result.dispatched) throw new Error(result.error?.message ?? `Could not start ${stage}.`);
      if (stage === "plan") {
        setFeedback("");
        setSubmittedPlanAt(submittedAt);
      }
      onChanged();
    } catch (cause) {
      if (stage === "plan") setSubmittedPlanAt(null);
      setError(cause instanceof Error ? cause.message : `Could not start ${stage}.`);
    } finally {
      setBusy(false);
    }
  }

  async function approvePlan() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/issues/${issue.number}/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "plan-approved" }) });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not approve this plan.");
      onChanged();
      onApproved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not approve this plan.");
    } finally {
      setBusy(false);
    }
  }

  const activeRun = issue.agentState === "planning" ? planRun : codeRun;
  const missingBuildRun = issue.agentState === "coding" && !codeRun && runs !== undefined;
  const running = isAgentRunActive(activeRun) || busy || planPending;
  const message = error || runsError?.message;

  return (
    <div className="space-y-5 p-5">
      {issue.agentState === "planning" && <>
        <div>
          {issue.latestPlan ? <MarkdownEditor id="plan-feedback" label="Request changes to the plan" value={feedback} onChange={setFeedback} rows={4} compact /> : <p className="mb-3 text-xs leading-5 text-[var(--muted)]">The agent reads the issue and repository context, then proposes tasks, files to change, risks, and verification steps.</p>}
          <p className="mb-1.5 mt-3 text-[11px] font-semibold text-[var(--muted)]">Planning model</p><ModelPicker stage="plan" value={planModel} defaultModel={defaultModels.plan} onChange={setPlanModel} size="sm" align="end" disabled={running} />
          <button type="button" onClick={() => void dispatch("plan")} disabled={!setupReady || running || (Boolean(issue.latestPlan) && !feedback.trim())} title={!setupReady ? "Set up repository workflows first" : undefined} className={`btn mt-3 w-full ${issue.latestPlan ? "btn-secondary" : "btn-primary"}`}>{running ? <LoaderCircle size={14} className="animate-spin" /> : issue.latestPlan ? <RotateCcw size={14} /> : <Sparkles size={15} />}{planPending ? "Planning…" : running ? "Planning…" : issue.latestPlan ? "Revise plan" : "Generate plan"}</button>
          {renderRunStatus(planRun)}
        </div>
        {issue.latestPlan && <div className="border-t border-[var(--line)] pt-5"><button type="button" onClick={() => void approvePlan()} disabled={busy} className="btn btn-primary w-full">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />} Approve plan</button><p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">Approval lets the agent change only the files listed under “Files to change”.</p></div>}
      </>}
      {issue.agentState === "plan-approved" && <div>
        <p className="mb-1.5 text-[11px] font-semibold text-[var(--muted)]">Coding model</p><ModelPicker stage="code" value={codeModel} defaultModel={defaultModels.code} onChange={setCodeModel} size="sm" align="end" disabled={running} />
        <button type="button" onClick={() => void dispatch("code")} disabled={!setupReady || running} title={!setupReady ? "Set up repository workflows first" : undefined} className="btn btn-primary mt-3 w-full">{running ? <LoaderCircle size={15} className="animate-spin" /> : <Wrench size={15} />}{running ? "Building…" : "Run build"}</button>
        {renderRunStatus(codeRun)}
      </div>}
      {issue.agentState === "coding" && <div>
        <p className="text-[11px] font-semibold text-[var(--muted)]">Build status</p>
        {runs === undefined && !runsError && <p className="mt-3 text-xs text-[var(--muted)]">Loading workflow status…</p>}
        {renderRunStatus(codeRun)}
        {(missingBuildRun || codeRun?.status === "completed") && <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{missingBuildRun ? "No build run was found for this issue; a new run may still be starting." : "The latest build run has finished, but the issue is still marked Build started."} Check Actions before changing its agent label on GitHub. If no build is active, change the label to <code>agent: plan-approved</code> to enable a new build.</p>}
      </div>}
      {!setupReady && <p className="text-xs leading-5 text-[var(--warning)]">Set up the repository workflows and Actions secret before running the agent.</p>}
      {message && <p className="flex items-start gap-2 text-xs leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" />{message}</p>}
    </div>
  );
}

export function renderRunStatus(run: AgentRunStatus | undefined) {
  if (!run) return null;
  const label = run.status === "queued" ? "Queued" : run.status === "in_progress" ? "Running" : run.status === "waiting" ? "Waiting" : run.status === "completed" ? run.conclusion === "success" ? "Completed" : `Finished: ${run.conclusion ?? "unknown"}` : "Status unavailable";
  return <a href={run.htmlUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)]">{isAgentRunActive(run) && <LoaderCircle size={12} className="animate-spin" />}{label}<ExternalLink size={11} /></a>;
}
