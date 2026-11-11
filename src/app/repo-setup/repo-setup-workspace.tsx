"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Clipboard, ExternalLink, FolderTree, GitPullRequest, LoaderCircle, LockKeyhole, RefreshCw, Tag } from "lucide-react";
import { RepositoryPathPicker } from "@/components/repository/RepositoryPathPicker";

type SetupFile = { key: string; path: string; title: string; description: string; content: string; status: "current" | "missing" | "outdated" | "modified" | "invalid"; installedVersion: number | null; latestVersion: number };
type SetupStatus = {
  files: SetupFile[];
  summary: "ready" | "missing" | "outdated";
  hasOpenRouterSecret: boolean | null;
  setupPullRequest: { number: number; htmlUrl: string } | null;
  legacyFiles: string[];
  settings: { include: string[]; exclude: string[]; installCommand: string; testCommand: string; nodeVersion: string; baseBranch: string };
};

const statusLabels = { current: "Up to date", missing: "Missing", outdated: "Update available", modified: "Edited by hand", invalid: "Invalid" } as const;

export function RepoSetupPanel({ targetRepo, baseBranch: initialBranch }: { targetRepo: string; baseBranch: string }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [baseBranch, setBaseBranch] = useState(initialBranch || "main");
  const [include, setInclude] = useState<string[]>(["src", "docs"]);
  const [exclude, setExclude] = useState<string[]>(["node_modules", "dist", ".next", "coverage"]);
  const [pathMode, setPathMode] = useState<"include" | "exclude">("include");
  const [installCommand, setInstallCommand] = useState("npm ci");
  const [testCommand, setTestCommand] = useState("npm test --if-present");
  const [nodeVersion, setNodeVersion] = useState("22");
  const [busy, setBusy] = useState(false);
  const [syncingLabels, setSyncingLabels] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [labelSyncMessage, setLabelSyncMessage] = useState("");
  const [labelSyncError, setLabelSyncError] = useState("");
  const [selectedFile, setSelectedFile] = useState("");

  async function loadStatus() {
    setError("");
    try {
      const response = await fetch("/api/repo/setup", { cache: "no-store" });
      const result = await response.json() as SetupStatus & { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not load repository setup.");
      setStatus(result);
      setBaseBranch(result.settings.baseBranch);
      setInclude(result.settings.include);
      setExclude(result.settings.exclude);
      setInstallCommand(result.settings.installCommand);
      setTestCommand(result.settings.testCommand);
      setNodeVersion(result.settings.nodeVersion);
      setSelectedFile((current) => current || result.files[0]?.key || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load repository setup.");
    }
  }

  useEffect(() => { void loadStatus(); }, []);

  const request = useMemo(() => ({
    baseBranch,
    include,
    exclude,
    installCommand,
    testCommand,
    nodeVersion,
  }), [baseBranch, exclude, include, installCommand, nodeVersion, testCommand]);

  async function perform(path: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: path === "/api/repo/setup" ? JSON.stringify(request) : "{}" });
      const result = await response.json() as { htmlUrl?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Request failed.");
      setMessage(result.htmlUrl ? "Setup pull request opened." : "OpenRouter key stored in GitHub Actions.");
      await loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function syncLabels() {
    setSyncingLabels(true);
    setLabelSyncError("");
    setLabelSyncMessage("");
    try {
      const response = await fetch("/api/repo/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not synchronize repository issue labels.");
      setLabelSyncMessage("Praetor issue labels and descriptions are up to date.");
    } catch (cause) {
      setLabelSyncError(cause instanceof Error ? cause.message : "Could not synchronize repository issue labels.");
    } finally {
      setSyncingLabels(false);
    }
  }

  const preview = status?.files.find((file) => file.key === selectedFile);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-7 md:px-10 md:py-10">
      <header className="mb-8 flex items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <Link href="/dashboard" className="btn btn-ghost btn-sm -ml-2.5"><ArrowLeft size={15} /> Back to workspace</Link>
        <div className="flex min-w-0 items-center gap-3"><Link href="/explorer" className="btn btn-ghost btn-sm"><FolderTree size={14} />Explorer</Link><span className="truncate text-xs text-[var(--muted)]">{targetRepo}</span></div>
      </header>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-1 text-xs font-semibold text-[var(--muted)]">Repository setup</p><h1 className="text-3xl font-semibold">Agent workflows</h1></div>
        <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={syncingLabels} onClick={() => void syncLabels()} title="Create or update Praetor issue label colors and descriptions" className="btn btn-secondary btn-sm">{syncingLabels ? <LoaderCircle size={14} className="animate-spin" /> : <Tag size={14} />}Sync issue labels</button><button type="button" onClick={() => void loadStatus()} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh status</button></div>
      </div>
      {(labelSyncMessage || labelSyncError) && <p role={labelSyncError ? "alert" : "status"} className={`-mt-5 mb-5 text-xs ${labelSyncError ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>{labelSyncError || labelSyncMessage}</p>}

      <section className="border-y border-[var(--line)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--muted)]"><span>Managed files</span><span>{status?.summary === "ready" ? "Ready" : status?.summary === "outdated" ? "Updates available" : "Setup required"}</span></div>
        {status?.files.map((file) => (
          <button key={file.key} type="button" onClick={() => setSelectedFile(file.key)} className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--line)] px-3 py-3 text-left last:border-0 ${selectedFile === file.key ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"}`}>
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{file.path}</span><span className="mt-0.5 block text-xs text-[var(--muted)]">{file.description}</span></span>
            <span className={`whitespace-nowrap text-xs ${file.status === "current" ? "text-[var(--success)]" : file.status === "modified" ? "text-[var(--warning)]" : "text-[var(--ink)]"}`}>{file.status === "outdated" ? `${statusLabels[file.status]} v${file.installedVersion} to v${file.latestVersion}` : statusLabels[file.status]}</span>
          </button>
        ))}
        <div className="flex flex-wrap items-center gap-3 px-3 py-3">
          <span className="flex items-center gap-2 text-sm"><LockKeyhole size={15} /> OPENROUTER_API_KEY</span>
          <span className={`text-xs ${status?.hasOpenRouterSecret ? "text-[var(--success)]" : "text-[var(--warning)]"}`}>{status?.hasOpenRouterSecret ? "Stored" : status?.hasOpenRouterSecret === null ? "Permission unavailable" : "Missing"}</span>
          {status && status.hasOpenRouterSecret !== null && <button type="button" disabled={busy} onClick={() => void perform("/api/repo/secret")} className="btn btn-secondary btn-sm">{status.hasOpenRouterSecret ? "Update key" : "Store key"}</button>}
          {status?.setupPullRequest && <a className="btn btn-ghost btn-sm" href={status.setupPullRequest.htmlUrl} target="_blank" rel="noreferrer">View setup PR #{status.setupPullRequest.number}<ExternalLink size={12} /></a>}
        </div>
        {status?.legacyFiles.map((file) => <p key={file} className="px-3 pb-3 text-xs text-[var(--warning)]">Legacy workflow will be removed: {file}</p>)}
      </section>

      <section className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="mb-4 text-base font-semibold">Repository settings</h2>
          <div id="repository-settings" className="grid scroll-mt-20 gap-4 sm:grid-cols-2">
            <Field label="Base branch"><input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} className="setup-input" /></Field>
            <Field label="Node.js version"><input value={nodeVersion} onChange={(event) => setNodeVersion(event.target.value)} className="setup-input" /></Field>
            <div className="sm:col-span-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold text-[var(--muted)]">Repository paths</p>
                <div role="group" aria-label="Path selection mode" className="inline-flex rounded-md border border-[var(--line)] bg-[var(--panel)] p-1">
                  <button type="button" aria-pressed={pathMode === "include"} onClick={() => setPathMode("include")} className={`rounded-sm px-3 py-1.5 text-xs font-medium ${pathMode === "include" ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>Index <span className="ml-1 tabular-nums opacity-75">{include.length}</span></button>
                  <button type="button" aria-pressed={pathMode === "exclude"} onClick={() => setPathMode("exclude")} className={`rounded-sm px-3 py-1.5 text-xs font-medium ${pathMode === "exclude" ? "bg-[var(--accent)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>Exclude <span className="ml-1 tabular-nums opacity-75">{exclude.length}</span></button>
                </div>
              </div>
              <RepositoryPathPicker
                refName={baseBranch}
                label={pathMode === "include" ? "Included paths" : "Excluded paths"}
                description={pathMode === "include" ? "Select the files and folders available to the agent." : "Select files and folders that should be skipped during indexing."}
                value={pathMode === "include" ? include : exclude}
                onChange={pathMode === "include" ? setInclude : setExclude}
              />
            </div>
            <Field label="Install command"><input value={installCommand} onChange={(event) => setInstallCommand(event.target.value)} className="setup-input font-mono" /></Field>
            <Field label="Test command"><input value={testCommand} onChange={(event) => setTestCommand(event.target.value)} className="setup-input font-mono" /></Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || !status || Boolean(status.setupPullRequest)} onClick={() => void perform("/api/repo/setup")} className="btn btn-primary">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <GitPullRequest size={15} />}{status?.summary === "ready" ? "Open update PR" : "Open setup PR"}</button>
            {status?.setupPullRequest && <a className="btn btn-secondary" href={status.setupPullRequest.htmlUrl} target="_blank" rel="noreferrer">View setup PR #{status.setupPullRequest.number}<ExternalLink size={13} /></a>}
          </div>
          {message && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-[var(--success)]"><Check size={14} />{message}</p>}
          {error && <p role="alert" className="mt-3 text-sm text-[var(--warning)]">{error}</p>}
        </div>
        <div className="min-w-0">
          <h2 className="mb-4 text-base font-semibold">Generated file preview</h2>
          {status && <div className="mb-2 flex flex-wrap gap-1">{status.files.map((file) => <button key={file.key} type="button" onClick={() => setSelectedFile(file.key)} className={`rounded px-2 py-1 text-xs ${selectedFile === file.key ? "bg-white/10 text-[var(--ink)]" : "text-[var(--muted)] hover:bg-white/5"}`}>{file.title}</button>)}</div>}
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3"><code className="truncate text-xs text-[var(--muted)]">{preview?.path ?? "Loading setup files..."}</code><button type="button" disabled={!preview} title="Copy preview" aria-label="Copy preview" onClick={() => preview && void navigator.clipboard.writeText(preview.content)} className="btn btn-ghost btn-icon"><Clipboard size={14} /></button></div>
          <pre className="max-h-[34rem] min-h-64 overflow-auto border border-[var(--line)] bg-black/10 p-4 text-xs leading-5"><code>{preview?.content ?? ""}</code></pre>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-[var(--muted)]">{label}<span className="mt-1.5 block">{children}</span></label>;
}
