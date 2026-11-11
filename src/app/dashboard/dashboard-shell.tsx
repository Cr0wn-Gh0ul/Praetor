"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, CircleAlert, ExternalLink, GitPullRequest, LoaderCircle, Settings2, Shield, Wrench, RefreshCw, X, FolderTree, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { ContextStatus } from "@/components/context/ContextStatus";
import { DraftWorkspace } from "@/components/drafts/DraftWorkspace";
import { RepositorySelector } from "@/components/repository/RepositorySelector";
import { DiffPanel } from "@/components/editor/DiffPanel";
import { CodeReviewActions } from "@/components/issue/CodeReviewActions";
import { PullRequestControls } from "@/components/issue/PullRequestControls";
import { PullRequestReviews } from "@/components/issue/PullRequestReviews";
import { PlanActions } from "@/components/issue/PlanActions";
import { Markdown } from "@/components/markdown/Markdown";
import { ActionsWorkspace, HomeWorkspace, IssuesWorkspace, PullRequestsWorkspace, STAGE_ICONS } from "./workspace-views";
import { useIssue } from "@/hooks/useIssue";
import { useContextSync } from "@/hooks/useIndex";
import { useIssues } from "@/hooks/useIssues";
import { AGENT_LABELS } from "@/lib/constants";
import { formatRelativeTime } from "@/lib/format";
import { hasAgentStateLabel, ISSUE_PIPELINE_STAGES, ISSUE_STATE_TITLES, issueMatchesStage, type IssueStageFilter } from "@/lib/issue-stage";
import type { AgentState, AppConfig, IssueDetail } from "@/lib/types";

const workflowSteps = ["Plan", "Approve", "Build", "Review", "Pull request", "Merge"] as const;

function currentStep(issue: IssueDetail): number {
  switch (issue.agentState) {
    case "planning": return issue.latestPlan ? 1 : 0;
    case "plan-approved":
    case "coding": return 2;
    case "code-review": return 3;
    case "pr-created": return issue.pullRequest?.state === "merged" ? 6 : issue.pullRequest?.ciStatus === "success" ? 5 : 4;
    case "needs-human": return issue.pullRequest ? 4 : 3;
    case "done": return 6;
    default: return 0;
  }
}

const nextStepHints: Partial<Record<AgentState, string>> = {
  planning: "Generate or review the plan, request revisions if needed, then approve it.",
  "plan-approved": "The plan is approved. Run the build to generate changes limited to its listed files.",
  coding: "This issue is marked as a started build. Check its run status below; changes move to Review when ready.",
  "code-review": "Review the generated diff, request refinements if needed, then open a pull request.",
  "pr-created": "The pull request is open. Check its status and merge it after required checks pass.",
  "needs-human": "Automation is paused. Review the latest run and issue activity before continuing.",
  done: "The pull request has been merged.",
};

type DashboardView = "home" | "issues" | "pulls" | "actions";

type DashboardShellProps = {
  initialIssue: number | null;
  initialDraft: string | null;
  initialView: DashboardView;
  initialStage: IssueStageFilter;
  initialRepo: string;
  defaultModels: AppConfig["models"];
};

export function DashboardShell({ initialIssue, initialDraft, initialView, initialStage, initialRepo, defaultModels }: DashboardShellProps) {
  const router = useRouter();
  const hasRepo = Boolean(initialRepo);
  const { data: issues, error: issuesError, isLoading: issuesLoading, isValidating: issuesValidating, refresh } = useIssues(hasRepo, "all", false);
  const context = useContextSync(hasRepo);
  const { data: setup } = useSWR<{ summary: "ready" | "missing" | "outdated" }>(hasRepo ? "/api/repo/setup" : null, async (url: string) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load repository setup status.");
    return response.json();
  }, { refreshInterval: 60_000, revalidateOnFocus: true });
  const setupReady = setup?.summary === "ready";
  const [selectedIssue, setSelectedIssue] = useState(hasRepo ? initialIssue : null);
  const [selectedDraft, setSelectedDraft] = useState(initialDraft);
  const [activeView, setActiveView] = useState<DashboardView>(initialView);
  const [stageFilter, setStageFilter] = useState<IssueStageFilter>(initialStage);
  const [selectedCode, setSelectedCode] = useState("");
  const [diffRefreshKey, setDiffRefreshKey] = useState(0);
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [startingPlanning, setStartingPlanning] = useState(false);
  const [planningSubmittedAt, setPlanningSubmittedAt] = useState<number | null>(null);
  const [pipelineCollapsed, setPipelineCollapsed] = useState(false);
  const [issueActionsCollapsed, setIssueActionsCollapsed] = useState(false);
  const { data: issue, error: issueError, isLoading: issueLoading, mutate: refreshIssue } = useIssue(hasRepo ? selectedIssue : null);

  useEffect(() => {
    if (activeView === "home") {
      router.replace("/dashboard", { scroll: false });
      return;
    }
    const params = new URLSearchParams({ view: activeView });
    if (activeView === "issues" && selectedDraft) params.set("draft", selectedDraft);
    if (activeView === "issues" && selectedIssue) params.set("issue", String(selectedIssue));
    if (activeView === "issues" && stageFilter !== "issue") params.set("stage", stageFilter);
    const query = `?${params}`;
    router.replace(`/dashboard${query}`, { scroll: false });
  }, [activeView, router, selectedDraft, selectedIssue, stageFilter]);

  useEffect(() => {
    setSelectedCode("");
  }, [selectedIssue]);

  useEffect(() => {
    if (!issue || issue.number !== selectedIssue) return;
    const stage = ISSUE_PIPELINE_STAGES.find(({ id }) => issueMatchesStage(issue.labels, id));
    if (stage) setStageFilter(stage.id);
  }, [issue, selectedIssue]);

  const refreshAll = useCallback(() => { void refresh(); void refreshIssue(); }, [refresh, refreshIssue]);
  const refreshDiff = useCallback(() => setDiffRefreshKey((key) => key + 1), []);

  function selectIssue(issueNumber: number) {
    setActiveView("issues");
    setSelectedDraft(null);
    setSelectedIssue(issueNumber);
  }

  function selectHome() {
    setActiveView("home");
    setSelectedIssue(null);
    setSelectedDraft(null);
  }

  function selectView(view: "issues" | "pulls" | "actions") {
    setActiveView(view);
    setSelectedIssue(null);
    setSelectedDraft(null);
  }

  function selectStage(stage: IssueStageFilter) {
    setActiveView("issues");
    setStageFilter(stage);
    setSelectedIssue(null);
    setSelectedDraft(null);
  }

  async function createNewDraft() {
    setCreatingDraft(true);
    setNotice(null);
    try {
      const response = await fetch("/api/drafts", { method: "POST" });
      const result = await response.json() as { id?: string; error?: { message?: string } };
      if (!response.ok || !result.id) throw new Error(result.error?.message ?? "Could not create a draft.");
      setSelectedIssue(null);
      setSelectedDraft(result.id);
      setActiveView("issues");
      setStageFilter("issue");
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not create a draft." });
    } finally {
      setCreatingDraft(false);
    }
  }

  async function startPlanning(issueNumber: number) {
    setStartingPlanning(true);
    setNotice(null);
    let markedForPlanning = false;
    try {
      const response = await fetch(`/api/issues/${issueNumber}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "planning" }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not start planning for this issue.");
      markedForPlanning = true;
      const submittedAt = Date.now();
      const planResponse = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueNumber, model: defaultModels.plan }),
      });
      const planResult = await planResponse.json() as { error?: { message?: string } };
      if (!planResponse.ok) throw new Error(`${planResult.error?.message ?? "Could not start the planning workflow."} The issue is now in planning and can be retried from its issue view.`);
      setPlanningSubmittedAt(submittedAt);
      setNotice({ tone: "success", text: `Planning started for issue #${issueNumber}.` });
      await Promise.all([refresh(), refreshIssue()]);
    } catch (error) {
      setPlanningSubmittedAt(null);
      if (markedForPlanning) await Promise.all([refresh(), refreshIssue()]);
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not start planning for this issue." });
    } finally {
      setStartingPlanning(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b border-[var(--line)] bg-[var(--base)]/85 px-3 backdrop-blur md:px-4">
        <Link href="/dashboard" onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); selectHome(); }} className="flex shrink-0 items-center gap-2.5 text-sm font-semibold tracking-wide">
          <span className="grid size-8 place-items-center rounded-lg border border-[var(--accent)]/50 text-[var(--accent)]"><Shield size={16} strokeWidth={2.25} aria-hidden="true" /></span>
          <span className="hidden sm:inline">Praetor</span>
        </Link>
        <span className="hidden h-6 w-px bg-[var(--line)] sm:block" />
        <div className="w-[min(52vw,17rem)] min-w-0"><RepositorySelector selectedRepo={initialRepo} /></div>
        <div className="ml-auto flex items-center gap-1.5">
          {hasRepo && <ContextStatus sync={context} />}
          {hasRepo && <Link href="/explorer" title="Repository explorer" aria-label="Repository explorer" className="btn btn-ghost btn-icon"><FolderTree size={16} /></Link>}
          <Link href="/settings" title="Settings" aria-label="Settings" className="btn btn-ghost btn-icon"><Settings2 size={16} /></Link>
        </div>
      </header>

      {hasRepo && !setupReady && <div className="sticky top-14 z-30 flex flex-wrap items-center gap-2 border-b border-[var(--warning)]/25 bg-[var(--base)] px-4 py-2 text-xs">
        <CircleAlert size={14} className="text-[var(--warning)]" />
        <span className="flex-1 text-[var(--muted)]">{setup ? "This repository isn't set up for the agent yet, or its files need an update." : "Checking repository agent setup…"}</span>
        <Link href="/repo-setup" className="inline-flex items-center gap-1 font-semibold text-[var(--accent)]">Review setup <ArrowRight size={12} /></Link>
      </div>}

      <div className={`grid flex-1 grid-cols-1 ${pipelineCollapsed ? "md:grid-cols-[44px_minmax(0,1fr)]" : "md:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)]"}`}>
        <aside className={`border-b border-[var(--line)] md:sticky ${hasRepo && !setupReady ? "md:top-24 md:h-[calc(100vh-6rem)]" : "md:top-14 md:h-[calc(100vh-3.5rem)]"} md:overflow-y-auto md:border-b-0 md:border-r`}>
          {pipelineCollapsed ? <div className="flex justify-center px-1 py-3">
            <button type="button" onClick={() => setPipelineCollapsed(false)} title="Expand navigation" aria-label="Expand navigation" className="btn btn-ghost btn-icon"><ChevronRight size={15} /></button>
          </div> : <>
          <div className="flex items-center justify-end px-2 pt-2">
            <button type="button" onClick={() => setPipelineCollapsed(true)} title="Collapse navigation" aria-label="Collapse navigation" className="btn btn-ghost btn-sm btn-icon"><ChevronLeft size={14} /></button>
          </div>
          <div className="px-2 py-3">
            <nav aria-label="Issue pipeline stages" className="space-y-0.5">
              {ISSUE_PIPELINE_STAGES.map(({ id, label }) => {
                const StageIcon = STAGE_ICONS[id];
                const count = issues?.filter((item) => issueMatchesStage(item.labels, id)).length;
                return <SidebarItem key={id} active={activeView === "issues" && stageFilter === id} onClick={() => selectStage(id)}><span className="flex items-center gap-2"><StageIcon size={14} />{label}<span className="ml-auto text-[11px] tabular-nums text-[var(--muted)]">{count ?? "–"}</span></span></SidebarItem>;
              })}
            </nav>
          </div>
          <nav aria-label="Repository activity" className="space-y-0.5 border-t border-[var(--line)] px-2 py-3">
            <SidebarItem active={activeView === "pulls"} onClick={() => selectView("pulls")}><span className="flex items-center gap-2"><GitPullRequest size={14} />Pull requests</span></SidebarItem>
            <SidebarItem active={activeView === "actions"} onClick={() => selectView("actions")}><span className="flex items-center gap-2"><Wrench size={14} />Actions</span></SidebarItem>
          </nav>
          </>}
        </aside>

        <main className="group/main min-w-0" data-wide={pipelineCollapsed}>
          {notice && (
            <div role={notice.tone === "error" ? "alert" : "status"} className={`flex items-center gap-2 border-b px-4 py-2 text-xs ${notice.tone === "error" ? "border-[var(--warning)]/30 bg-[var(--warning)]/[0.06] text-[var(--warning)]" : "border-[var(--success)]/30 bg-[var(--success)]/[0.06] text-[var(--success)]"}`}>
              {notice.tone === "error" ? <CircleAlert size={14} /> : <Check size={14} />}
              <span className="flex-1">{notice.text}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="btn btn-ghost btn-sm btn-icon size-6"><X size={12} /></button>
            </div>
          )}

          {!hasRepo ? (
            <ChooseRepository />
          ) : activeView === "home" ? (
            <HomeWorkspace repository={initialRepo} issues={issues} error={issuesError} loading={issuesLoading} creatingIssue={creatingDraft} onNewIssue={() => void createNewDraft()} onSelectStage={selectStage} onSelectIssue={selectIssue} onSelectView={selectView} />
          ) : activeView === "pulls" ? (
            <PullRequestsWorkspace />
          ) : activeView === "actions" ? (
            <ActionsWorkspace />
          ) : activeView === "issues" && selectedDraft ? (
            <DraftWorkspace
              key={selectedDraft}
              id={selectedDraft}
              repository={initialRepo}
              defaultModel={defaultModels.draft}
              onChanged={() => undefined}
              onDeleted={() => {
                setSelectedDraft(null);
              }}
              onPublished={(issueNumber) => {
                setActiveView("issues");
                setSelectedDraft(null);
                setSelectedIssue(issueNumber);
                setNotice({ tone: "success", text: `Published issue #${issueNumber}. Next, generate an implementation plan.` });
                void refresh();
              }}
            />
          ) : selectedIssue ? (
            <IssueView
              issue={issue}
              loading={issueLoading}
              error={issueError}
              selectedCode={selectedCode}
              diffRefreshKey={diffRefreshKey}
              defaultModels={defaultModels}
              onSelection={setSelectedCode}
              onRefreshDiff={refreshDiff}
              setupReady={setupReady}
              startingPlanning={startingPlanning}
              planningSubmittedAt={planningSubmittedAt}
              issueActionsCollapsed={issueActionsCollapsed}
              onToggleIssueActions={() => setIssueActionsCollapsed((collapsed) => !collapsed)}
              onStartPlanning={() => { if (issue) void startPlanning(issue.number); }}
              onChanged={refreshAll}
              onApproved={() => { setActiveView("issues"); setStageFilter("build"); }}
              onMerged={() => { refreshAll(); context.refresh(); }}
            />
          ) : (
            <IssuesWorkspace issues={issues} error={issuesError} loading={issuesLoading} isValidating={issuesValidating} onRefresh={() => void refresh()} stage={stageFilter} creatingIssue={creatingDraft} onNewIssue={() => void createNewDraft()} onSelectIssue={selectIssue} />
          )}
        </main>
      </div>
    </div>
  );
}

function SidebarItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? "page" : undefined} className={`relative w-full rounded-lg px-2.5 py-2 text-left transition-colors ${active ? "bg-[var(--panel-2)] text-[var(--ink)]" : "text-[var(--ink)]/90 hover:bg-[var(--panel-2)]"}`}>
      {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--accent)]" />}
      {children}
    </button>
  );
}

function ReviewSection({ issue, diffRefreshKey, onRefreshDiff, onSelection }: { issue: IssueDetail; diffRefreshKey: number; onRefreshDiff: () => void; onSelection: (code: string) => void }) {
  const hasReview = Boolean(issue.latestSelfReview);
  const [view, setView] = useState<"review" | "diff">(hasReview ? "review" : "diff");
  const current = hasReview ? view : "diff";
  return <section aria-label="Generated changes" className="mt-8">
    <div className="mb-3 flex items-center gap-2">
      <h2 className="label-caps">{current === "review" ? "Agent review" : "Generated changes"}</h2>
      <div className="ml-auto flex items-center gap-2">
        {current === "diff" && <button type="button" onClick={onRefreshDiff} className="btn btn-ghost btn-sm"><RefreshCw size={12} />Refresh diff</button>}
        {hasReview && <div role="group" aria-label="Review view" className="flex rounded-lg border border-[var(--line-strong)] p-0.5">
          {([["review", "Agent review"], ["diff", "Diff"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={current === id} onClick={() => setView(id)} className={`h-7 rounded-md px-2.5 text-xs font-semibold ${current === id ? "bg-[var(--panel-2)] text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{label}</button>)}
        </div>}
      </div>
    </div>
    {current === "review" ? <div className="card p-5"><Markdown>{issue.latestSelfReview ?? ""}</Markdown></div> : <>
      {issue.agentState === "code-review" && <p className="mb-3 text-xs text-[var(--muted)]">Select code in the diff to include it with a refinement request.</p>}
      <DiffPanel issueNumber={issue.number} refreshKey={diffRefreshKey} onSelection={onSelection} />
    </>}
  </section>;
}

function CollapsibleSection({ id, title, defaultOpen, children }: { id: string; title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return <section aria-labelledby={`${id}-heading`}>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="mb-3 flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--ink)]">
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<h2 id={`${id}-heading`} className="label-caps">{title}</h2>
    </button>
    {open && children}
  </section>;
}

const checkStyles = {
  success: { label: "Passed", className: "text-[var(--success)]" },
  failure: { label: "Failed", className: "text-[var(--warning)]" },
  pending: { label: "Running", className: "text-[var(--muted)]" },
  unknown: { label: "Unavailable", className: "text-[var(--muted)]" },
} as const;

function ChecksSummary({ issue }: { issue: IssueDetail }) {
  const pullRequest = issue.pullRequest;
  const ci = pullRequest?.ciStatus ?? issue.branchCiStatus;
  const style = checkStyles[ci ?? "unknown"];
  const rows: { label: string; value: React.ReactNode; className?: string }[] = [
    { label: "Pull request", value: pullRequest ? <a href={pullRequest.htmlUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[var(--accent)]">#{pullRequest.number} · {pullRequest.state}<ExternalLink size={11} /></a> : "Not opened yet" },
    { label: pullRequest ? "PR checks" : "Branch checks", value: <span className="inline-flex items-center gap-1.5">{ci === "pending" ? <LoaderCircle size={12} className="animate-spin" /> : <span className="status-dot" style={{ background: "currentColor" }} />}{style.label}</span>, className: style.className },
    { label: "Branch", value: <span className="font-mono text-xs">{pullRequest?.headRef ?? `agent/issue-${issue.number}`}</span> },
  ];
  if (pullRequest) {
    const { approvals, changesRequested, requestedReviewers } = pullRequest.reviews;
    const reviewText = changesRequested > 0 ? `${changesRequested} requesting changes` : approvals > 0 ? `${approvals} approved` : requestedReviewers.length > 0 ? `${requestedReviewers.length} awaiting` : "No reviews";
    rows.push({ label: "Reviews", value: reviewText, className: changesRequested > 0 ? "text-[var(--warning)]" : approvals > 0 ? "text-[var(--success)]" : "text-[var(--muted)]" });
  }
  return <section aria-label="Checks and status" className={`card mt-8 grid divide-y divide-[var(--line)] sm:divide-x sm:divide-y-0 ${rows.length > 3 ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
    {rows.map((row) => <div key={row.label} className="px-4 py-3"><p className="label-caps mb-1">{row.label}</p><p className={`text-sm font-semibold ${row.className ?? ""}`}>{row.value}</p></div>)}
  </section>;
}

function StateBadge({ state }: { state: AgentState }) {
  const color = `#${AGENT_LABELS[state].color}`;
  return <span className="inline-flex min-w-0 items-center gap-1.5 truncate" style={{ color }}><span className="status-dot size-1.5" style={{ background: color }} />{ISSUE_STATE_TITLES[state]}</span>;
}

function ChooseRepository() {
  return (
    <section className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-6">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-5 grid size-12 place-items-center rounded-xl border border-[var(--accent)]/40 text-[var(--accent)]"><GitPullRequest size={20} /></span>
        <h1 className="text-2xl font-semibold">Choose a repository to work in</h1>
        <p className="mx-auto mb-6 mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">Pick any repository you can write to. Issues, drafts, and code context load for that repository.</p>
        <div className="mx-auto max-w-sm text-left"><RepositorySelector selectedRepo="" size="md" /></div>
      </div>
    </section>
  );
}

type IssueViewProps = {
  issue: IssueDetail | undefined;
  loading: boolean;
  error: Error | undefined;
  selectedCode: string;
  diffRefreshKey: number;
  defaultModels: AppConfig["models"];
  setupReady: boolean;
  startingPlanning: boolean;
  planningSubmittedAt: number | null;
  issueActionsCollapsed: boolean;
  onToggleIssueActions: () => void;
  onStartPlanning: () => void;
  onSelection: (code: string) => void;
  onRefreshDiff: () => void;
  onChanged: () => void;
  onApproved: () => void;
  onMerged: () => void;
};

function IssueView({ issue, loading, error, selectedCode, diffRefreshKey, defaultModels, setupReady, startingPlanning, planningSubmittedAt, issueActionsCollapsed, onToggleIssueActions, onStartPlanning, onSelection, onRefreshDiff, onChanged, onApproved, onMerged }: IssueViewProps) {
  if (error) return <p className="m-6 flex items-center gap-2 text-sm text-[var(--warning)]"><CircleAlert size={16} />{error.message}</p>;
  if (!issue) return loading ? <p className="flex items-center gap-2 p-6 text-sm text-[var(--muted)]"><LoaderCircle size={15} className="animate-spin" />Loading issue…</p> : null;

  const step = currentStep(issue);
  const needsHuman = issue.agentState === "needs-human";
  const invalidAgentLabels = !issue.agentState && hasAgentStateLabel(issue.labels);
  const untracked = !issue.agentState && !invalidAgentLabels;
  const inReview = issue.agentState === "code-review" || issue.agentState === "pr-created" || (issue.agentState === "needs-human" && issue.branchCiStatus !== null);

  return (
    <div className={`grid grid-cols-1 ${issueActionsCollapsed ? "min-[900px]:grid-cols-[minmax(0,1fr)_44px]" : "min-[900px]:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]"}`}>
      <article className="min-w-0">
        <header className="sticky top-14 z-20 flex h-12 items-center gap-3 border-b border-[var(--line)] bg-[var(--base)]/85 px-5 backdrop-blur">
          <span className="font-mono text-xs text-[var(--muted)]">#{issue.number}</span>
          {issue.agentState && <StateBadge state={issue.agentState} />}
          {invalidAgentLabels && <span className="border border-[var(--warning)]/40 px-2 py-1 text-[11px] text-[var(--warning)]">Needs attention</span>}
          <a href={issue.htmlUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm ml-auto">GitHub <ExternalLink size={12} /></a>
        </header>

        <div className={`mx-auto px-5 py-8 xl:px-10 ${issueActionsCollapsed ? "max-w-[96rem]" : "max-w-3xl group-data-[wide=true]/main:max-w-[96rem]"}`}>
          <h1 className="text-3xl font-semibold leading-tight">{issue.title}</h1>
          <p className="mt-2 text-xs text-[var(--muted)]">Updated {formatRelativeTime(issue.updatedAt)}</p>

          {invalidAgentLabels ? <p role="alert" className="mt-6 border-l-2 border-[var(--warning)] px-3 py-2 text-xs leading-5 text-[var(--warning)]">This issue has conflicting or unknown Praetor stage labels. Correct its labels on GitHub before continuing.</p> : <ol aria-label="Workflow progress" className="mt-6 flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {workflowSteps.map((label, index) => {
              const complete = index < step;
              const current = index === step;
              return (
                <li key={label} className="flex items-center gap-1.5">
                  <span className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium ${complete ? "border-transparent bg-[var(--success)]/10 text-[var(--success)]" : current ? needsHuman ? "border-[var(--warning)]/60 text-[var(--warning)]" : "border-[var(--accent)]/60 text-[var(--accent)]" : "border-[var(--line)] text-[var(--faint)]"}`} aria-current={current ? "step" : undefined}>
                    {complete ? <Check size={11} strokeWidth={3} /> : <span className="tabular-nums">{index + 1}</span>}{label}
                  </span>
                  {index < workflowSteps.length - 1 && <span className={`h-px w-3 ${complete ? "bg-[var(--success)]/40" : "bg-[var(--line)]"}`} />}
                </li>
              );
            })}
          </ol>}

          {inReview && <ChecksSummary issue={issue} />}
          {inReview && issue.pullRequest && <PullRequestReviews issue={issue} onChanged={onChanged} />}

          {inReview && <ReviewSection issue={issue} diffRefreshKey={diffRefreshKey} onRefreshDiff={onRefreshDiff} onSelection={onSelection} />}

          <div className="mt-8 space-y-6 border-t border-[var(--line)] pt-6">
            {issue.latestPlan && <CollapsibleSection key={`plan-${issue.number}`} id="implementation-plan" title="Implementation plan" defaultOpen={!inReview}>
              <div className="card p-5"><Markdown>{issue.latestPlan}</Markdown></div>
            </CollapsibleSection>}
            <CollapsibleSection key={`issue-${issue.number}`} id="issue-description" title="Issue description" defaultOpen={!issue.latestPlan}>
              {issue.body.trim() ? <Markdown>{issue.body}</Markdown> : <p className="text-sm text-[var(--muted)]">This issue has no description.</p>}
            </CollapsibleSection>
          </div>

          {issue.latestAgentError && <div role="alert" className="mt-6 border-l-2 border-[var(--warning)] bg-[var(--warning)]/[0.05] p-3 text-sm"><p className="mb-1 font-semibold text-[var(--warning)]">Latest agent run failed</p><p className="whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{issue.latestAgentError.message}</p></div>}

        </div>
      </article>

      {issueActionsCollapsed ? <aside className="flex min-h-12 justify-center border-t border-[var(--line)] py-2 min-[900px]:sticky min-[900px]:top-14 min-[900px]:h-[calc(100vh-3.5rem)] min-[900px]:border-l min-[900px]:border-t-0">
        <button type="button" onClick={onToggleIssueActions} title="Show next-step panel" aria-label="Show next-step panel" className="btn btn-ghost btn-icon"><ChevronLeft size={15} /></button>
      </aside> : <aside className="min-w-0 border-t border-[var(--line)] min-[900px]:sticky min-[900px]:top-14 min-[900px]:h-[calc(100vh-3.5rem)] min-[900px]:overflow-y-auto min-[900px]:border-l min-[900px]:border-t-0">
        <div className="border-b border-[var(--line)] p-5">
          <div className="mb-1.5 flex items-center justify-between"><p className="label-caps">Next step</p><button type="button" onClick={onToggleIssueActions} title="Collapse next-step panel" aria-label="Collapse next-step panel" className="btn btn-ghost btn-sm btn-icon -mr-2 -mt-1.5"><ChevronRight size={14} /></button></div>
          <p className="text-base font-semibold">{issue.agentState ? ISSUE_STATE_TITLES[issue.agentState] : invalidAgentLabels ? "Invalid stage labels" : "Untracked issue"}</p>
          <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">{issue.agentState ? nextStepHints[issue.agentState] ?? AGENT_LABELS[issue.agentState].description : invalidAgentLabels ? "These labels conflict or are not recognized. Review them on GitHub before starting a workflow." : "This issue has no Praetor stage label. Start planning when you are ready."}</p>
        </div>
        {untracked && <div className="border-b border-[var(--line)] p-5">
          <button type="button" onClick={onStartPlanning} disabled={!setupReady || startingPlanning} title={!setupReady ? "Set up repository workflows first" : undefined} className="btn btn-primary w-full">
            {startingPlanning ? <LoaderCircle size={14} className="animate-spin" /> : <Wrench size={14} />} Start planning
          </button>
          {!setupReady && <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Set up the repository workflows before starting this issue.</p>}
        </div>}
        {(issue.agentState === "planning" || issue.agentState === "plan-approved" || issue.agentState === "coding") && (
          <PlanActions issue={issue} defaultModels={defaultModels} setupReady={setupReady} onChanged={onChanged} onApproved={onApproved} planningSubmittedAt={planningSubmittedAt} />
        )}
        {issue.agentState === "code-review" && (
          <CodeReviewActions issue={issue} selectedCode={selectedCode} defaultModel={defaultModels.code} setupReady={setupReady} onChanged={onChanged} onRefined={onRefreshDiff} />
        )}
        {issue.pullRequest && <div className="border-t border-[var(--line)]"><PullRequestControls issue={issue} onMerged={onMerged} /></div>}
      </aside>}
    </div>
  );
}