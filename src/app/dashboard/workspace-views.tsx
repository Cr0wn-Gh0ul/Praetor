"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CircleAlert, GitPullRequest, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import type { AgentState, IssueSummary } from "@/lib/types";
import { AGENT_LABELS } from "@/lib/constants";
import { formatRelativeTime } from "@/lib/format";
import { hasAgentStateLabel, ISSUE_PIPELINE_STAGES, ISSUE_STATE_TITLES, issueMatchesStage, type IssueStageFilter } from "@/lib/issue-stage";
import { stateFromLabels } from "@/lib/state";

export { ISSUE_PIPELINE_STAGES, issueMatchesStage } from "@/lib/issue-stage";
export type { IssueStageFilter } from "@/lib/issue-stage";

type PullRequestRow = { number: number; title: string; state: "open" | "closed" | "merged"; htmlUrl: string; author: string; branch: string; updatedAt: string; ciStatus: "pending" | "success" | "failure" | "unknown" };
type ActionRow = { id: number; title: string; workflow: string; branch: string; status: "queued" | "in_progress" | "completed" | "waiting" | "unknown"; conclusion: string | null; event: string; htmlUrl: string; createdAt: string; updatedAt: string };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const value = await response.json() as T | { error?: { message?: string } };
  if (!response.ok) throw new Error((value as { error?: { message?: string } }).error?.message ?? "Could not load repository data.");
  return value as T;
}

export function IssuesWorkspace({ issues, error, loading, isValidating, onRefresh, stage, onSelectIssue, onNewIssue, creatingIssue }: { issues?: IssueSummary[]; error?: Error; loading: boolean; isValidating: boolean; onRefresh: () => void; stage: IssueStageFilter; onSelectIssue: (issueNumber: number) => void; onNewIssue: () => void; creatingIssue: boolean }) {
  const [label, setLabel] = useState("all");
  const [query, setQuery] = useState("");
  const labels = useMemo(() => [...new Set((issues ?? []).flatMap((issue) => issue.labels).filter((value) => !/^agent:/i.test(value)))].sort(), [issues]);
  const visible = (issues ?? []).filter((issue) => {
    return issueMatchesStage(issue.labels, stage)
      && (label === "all" || issue.labels.includes(label))
      && (!query || `${issue.title} ${issue.body} #${issue.number}`.toLowerCase().includes(query.toLowerCase()));
  });

  return <section className="mx-auto w-full max-w-6xl group-data-[wide=true]/main:max-w-none px-5 py-7 md:px-8">
    <header className="flex items-center gap-3 border-b border-[var(--line)] pb-4"><h1 className="text-2xl font-semibold">{ISSUE_PIPELINE_STAGES.find((item) => item.id === stage)?.label ?? "Issues"}</h1><span className="text-xs tabular-nums text-[var(--muted)]">{visible.length}</span><button type="button" onClick={onNewIssue} disabled={creatingIssue} className="btn btn-primary btn-sm ml-auto">{creatingIssue ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}New issue</button><button type="button" onClick={onRefresh} title="Refresh issues" aria-label="Refresh issues" className="btn btn-ghost btn-icon"><RefreshCw size={14} className={isValidating ? "animate-spin" : ""} /></button></header>
    <div className="my-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
      <input aria-label="Search issues" placeholder="Search title, description, or number" value={query} onChange={(event) => setQuery(event.target.value)} className="setup-input" />
      <select aria-label="Filter by label" value={label} onChange={(event) => setLabel(event.target.value)} className="setup-input"><option value="all">All labels</option>{labels.map((value) => <option key={value} value={value}>{value}</option>)}</select>
    </div>
    {error ? <ErrorMessage message={error.message} /> : loading && !issues ? <p className="flex items-center gap-2 border-y border-[var(--line)] px-2 py-8 text-sm text-[var(--muted)]"><LoaderCircle size={14} className="animate-spin" />Loading issues…</p> : <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
      {visible.map((issue) => <button key={issue.number} type="button" onClick={() => onSelectIssue(issue.number)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-2 py-3 text-left hover:bg-[var(--panel-2)] sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{issue.title}</span><span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]"><span>#{issue.number}</span><span>Updated {formatRelativeTime(issue.updatedAt)}</span>{issue.labels.filter((item) => !item.startsWith("agent: ")).slice(0, 3).map((item) => <span key={item} className="border border-[var(--line)] px-1.5 py-0.5">{item}</span>)}</span></span>
        <State state={stateFromLabels(issue.labels)} labels={issue.labels} />
        <span className="hidden text-xs text-[var(--muted)] sm:inline">{issue.state}</span>
      </button>)}
      {!visible.length && <p className="px-2 py-8 text-sm text-[var(--muted)]">No issues match these filters.</p>}
    </div>}
  </section>;
}

export function PullRequestsWorkspace() {
  const [state, setState] = useState("open");
  const [ci, setCi] = useState("all");
  const [author, setAuthor] = useState("");
  const query = new URLSearchParams({ state });
  if (ci !== "all") query.set("ci", ci);
  if (author.trim()) query.set("author", author.trim());
  const { data: pulls, error, isValidating, mutate } = useSWR<PullRequestRow[]>(`/api/pulls?${query}`, fetchJson, { refreshInterval: 30_000, keepPreviousData: true });

  return <section className="mx-auto w-full max-w-6xl group-data-[wide=true]/main:max-w-none px-5 py-7 md:px-8">
    <PageHeader title="Pull requests" count={pulls?.length} onRefresh={() => void mutate()} refreshing={isValidating} />
    <div className="my-5 grid gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_minmax(0,1fr)]">
      <select aria-label="Filter pull requests by state" value={state} onChange={(event) => setState(event.target.value)} className="setup-input"><option value="open">Open</option><option value="closed">Closed</option><option value="all">All states</option></select>
      <select aria-label="Filter pull requests by CI" value={ci} onChange={(event) => setCi(event.target.value)} className="setup-input"><option value="all">All CI states</option><option value="success">Checks passed</option><option value="pending">Checks running</option><option value="failure">Checks failed</option><option value="unknown">Checks unavailable</option></select>
      <input aria-label="Filter pull requests by author" placeholder="Author" value={author} onChange={(event) => setAuthor(event.target.value)} className="setup-input" />
    </div>
    {error ? <ErrorMessage message={error.message} /> : !pulls ? <LoadingRows label="Loading pull requests…" /> : <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
      {pulls.map((pull) => <a key={pull.number} href={pull.htmlUrl} target="_blank" rel="noreferrer" className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-3 hover:bg-[var(--panel-2)]">
        <GitPullRequest size={15} className={pull.state === "merged" ? "text-[var(--accent)]" : "text-[var(--muted)]"} />
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{pull.title}</span><span className="mt-1 block truncate text-[11px] text-[var(--muted)]">#{pull.number} · {pull.state} · {pull.author} · {pull.branch} · Updated {formatRelativeTime(pull.updatedAt)}</span></span>
        <span className={`text-xs ${pull.ciStatus === "success" ? "text-[var(--success)]" : pull.ciStatus === "failure" ? "text-[var(--warning)]" : "text-[var(--muted)]"}`}>{pull.ciStatus}</span>
      </a>)}
      {!pulls.length && <p className="px-2 py-8 text-sm text-[var(--muted)]">No pull requests match these filters.</p>}
    </div>}
  </section>;
}

export function ActionsWorkspace() {
  const [workflow, setWorkflow] = useState("");
  const [status, setStatus] = useState("all");
  const [branch, setBranch] = useState("");
  const query = new URLSearchParams();
  if (workflow.trim()) query.set("workflow", workflow.trim());
  if (status !== "all") query.set("status", status);
  if (branch.trim()) query.set("branch", branch.trim());
  const { data: actions, error, isValidating, mutate } = useSWR<ActionRow[]>(`/api/actions?${query}`, fetchJson, { refreshInterval: 15_000, keepPreviousData: true });

  return <section className="mx-auto w-full max-w-6xl group-data-[wide=true]/main:max-w-none px-5 py-7 md:px-8">
    <PageHeader title="Actions" count={actions?.length} onRefresh={() => void mutate()} refreshing={isValidating} />
    <div className="my-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,1fr)]">
      <input aria-label="Filter actions by workflow" placeholder="Workflow" value={workflow} onChange={(event) => setWorkflow(event.target.value)} className="setup-input" />
      <select aria-label="Filter actions by status" value={status} onChange={(event) => setStatus(event.target.value)} className="setup-input"><option value="all">All statuses</option><option value="queued">Queued</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="waiting">Waiting</option></select>
      <input aria-label="Filter actions by branch" placeholder="Branch" value={branch} onChange={(event) => setBranch(event.target.value)} className="setup-input" />
    </div>
    {error ? <ErrorMessage message={error.message} /> : !actions ? <LoadingRows label="Loading workflow runs…" /> : <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
      {actions.map((action) => <a key={action.id} href={action.htmlUrl} target="_blank" rel="noreferrer" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-3 hover:bg-[var(--panel-2)]">
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{action.title}</span><span className="mt-1 block truncate text-[11px] text-[var(--muted)]">{action.workflow} · {action.branch} · {action.event} · {formatRelativeTime(action.createdAt)}</span></span>
        <span className={`text-xs ${action.status === "completed" && action.conclusion === "failure" ? "text-[var(--warning)]" : action.status === "completed" && action.conclusion === "success" ? "text-[var(--success)]" : "text-[var(--muted)]"}`}>{action.status === "completed" ? action.conclusion : action.status.replace("_", " ")}</span>
      </a>)}
      {!actions.length && <p className="px-2 py-8 text-sm text-[var(--muted)]">No workflow runs match these filters.</p>}
    </div>}
  </section>;
}

function LoadingRows({ label }: { label: string }) {
  return <p role="status" className="flex items-center gap-2 border-y border-[var(--line)] px-2 py-8 text-sm text-[var(--muted)]"><LoaderCircle size={14} className="animate-spin" />{label}</p>;
}

function PageHeader({ title, count, onRefresh, refreshing }: { title: string; count?: number; onRefresh: () => void; refreshing: boolean }) {
  return <header className="flex items-center gap-3 border-b border-[var(--line)] pb-4"><h1 className="text-2xl font-semibold">{title}</h1>{count !== undefined && <span className="text-xs tabular-nums text-[var(--muted)]">{count}</span>}<button type="button" onClick={onRefresh} title={`Refresh ${title.toLowerCase()}`} aria-label={`Refresh ${title.toLowerCase()}`} className="btn btn-ghost btn-icon ml-auto"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button></header>;
}

function State({ state, labels }: { state: AgentState | null; labels: string[] }) {
  if (!state) return <span className="text-xs text-[var(--muted)]" title={hasAgentStateLabel(labels) ? "Conflicting or unknown agent stage labels." : undefined}>{hasAgentStateLabel(labels) ? "Needs attention" : "Untracked"}</span>;
  const color = `#${AGENT_LABELS[state].color}`;
  return <span className="whitespace-nowrap text-xs" title={state === "coding" ? "A build was started; check its workflow run for its current status." : AGENT_LABELS[state].description} style={{ color }}>{ISSUE_STATE_TITLES[state]}</span>;
}

function ErrorMessage({ message }: { message: string }) {
  return <p role="alert" className="flex items-center gap-2 py-6 text-sm text-[var(--warning)]"><CircleAlert size={15} />{message}</p>;
}
