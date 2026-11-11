"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Cpu, ExternalLink, FolderGit2, KeyRound, LoaderCircle, LogOut, RotateCcw, Save } from "lucide-react";
import { ModelPicker } from "@/components/models/ModelPicker";
import { DEFAULT_MODELS, MODEL_STAGES, type ModelStage } from "@/lib/constants";
import type { PublicAppConfig } from "@/lib/types";

const stages = Object.keys(MODEL_STAGES) as ModelStage[];
const tokenUrl = "https://github.com/settings/personal-access-tokens/new?name=Praetor&description=Local+GitHub+issue+and+Actions+automation&expires_in=90&contents=write&issues=write&pull_requests=write&actions=write&workflows=write&secrets=write&metadata=read";

export function SettingsWorkspace({ config }: { config: PublicAppConfig }) {
  const [saved, setSaved] = useState(config);
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [baseBranch, setBaseBranch] = useState(config.baseBranch);
  const [models, setModels] = useState(config.models);
  const [appAvailable, setAppAvailable] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [device, setDevice] = useState<{ id: string; userCode: string; verificationUri: string; expiresIn: number; interval: number } | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/auth/github/device", { cache: "no-store" }).then((response) => response.json()).then((result: { available?: boolean; installUrl?: string | null }) => {
      setAppAvailable(Boolean(result.available));
      setInstallUrl(result.installUrl ?? null);
    }).catch(() => undefined);
  }, []);

  const dirty = Boolean(openRouterApiKey || githubToken) || baseBranch !== saved.baseBranch || stages.some((stage) => models[stage] !== saved.models[stage]);

  async function reloadConfig() {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not refresh settings.");
    const result = await response.json() as PublicAppConfig;
    setSaved(result);
    setBaseBranch(result.baseBranch);
    setModels(result.models);
    setGithubToken("");
  }

  async function signIn() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/github/device", { method: "POST" });
      const result = await response.json() as typeof device & { error?: { message?: string } };
      if (!response.ok || !result?.id) throw new Error(result.error?.message ?? "Could not start GitHub sign-in.");
      setDevice(result as NonNullable<typeof device>);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start GitHub sign-in.");
    } finally {
      setBusy(false);
    }
  }

  async function pollSignIn() {
    if (!device) return;
    setBusy(true);
    setError("");
    const deadline = Date.now() + device.expiresIn * 1_000;
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, device.interval * 1_000));
        const response = await fetch("/api/auth/github/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: device.id }) });
        const result = await response.json() as { status?: string; interval?: number; message?: string; login?: string; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? "GitHub sign-in failed.");
        if (result.status === "pending") {
          if (result.interval) device.interval = result.interval;
          continue;
        }
        if (result.status === "authorized") {
          setDevice(null);
          setMessage(`Connected as @${result.login}.`);
          await reloadConfig();
          return;
        }
        throw new Error(result.message ?? "GitHub sign-in was not completed.");
      }
      throw new Error("The sign-in code expired. Start again to get a new one.");
    } catch (cause) {
      setDevice(null);
      setError(cause instanceof Error ? cause.message : "GitHub sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/github/signout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out.");
      await reloadConfig();
      setMessage("Signed out of GitHub.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(githubToken ? { githubToken } : {}), ...(openRouterApiKey ? { openRouterApiKey } : {}), baseBranch, models }) });
      const result = await response.json() as PublicAppConfig & { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not save settings.");
      setSaved(result);
      setModels(result.models);
      setOpenRouterApiKey("");
      setGithubToken("");
      setMessage("Settings saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-5 pb-24 pt-8 md:px-10 md:pt-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <Link href="/dashboard" className="btn btn-ghost btn-sm -ml-2.5"><ArrowLeft size={15} /> Back to workspace</Link>
        {saved.targetRepo && <span className="chip"><FolderGit2 size={12} />{saved.targetRepo}</span>}
      </header>
      <div className="mb-8"><h1 className="text-3xl font-semibold">Settings</h1><p className="mt-2 text-sm text-[var(--muted)]">Connections, models, and repository behavior for this workspace.</p></div>

      <form id="settings-form" onSubmit={(event) => void save(event)} className="space-y-6">
        <Section icon={<KeyRound size={16} />} title="Connections">
          <div className="space-y-5">
            <div className="border-b border-[var(--line)] pb-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-sm font-semibold">GitHub</p><p className="mt-1 text-xs text-[var(--muted)]">{saved.github.method === "app" ? `Connected as @${saved.github.login}` : saved.github.method === "token" ? "Connected with a personal access token" : "Not connected"}</p></div>
                {saved.github.method === "app" ? <button type="button" disabled={busy} onClick={() => void signOut()} className="btn btn-ghost btn-sm"><LogOut size={14} /> Sign out</button> : appAvailable && <button type="button" disabled={busy} onClick={() => void signIn()} className="btn btn-secondary btn-sm">Sign in with GitHub</button>}
              </div>
              {device && <div className="mt-4 flex flex-wrap items-center gap-3 border-l-2 border-[var(--accent)] pl-3">
                <p className="font-mono text-lg font-semibold tracking-widest">{device.userCode}</p>
                <button type="button" onClick={() => void navigator.clipboard.writeText(device.userCode)} className="btn btn-ghost btn-sm">Copy code</button>
                <a className="btn btn-secondary btn-sm" href={device.verificationUri} target="_blank" rel="noreferrer">Open GitHub <ExternalLink size={12} /></a>
                <button type="button" disabled={busy} onClick={() => void pollSignIn()} className="btn btn-primary btn-sm">{busy ? <LoaderCircle size={13} className="animate-spin" /> : null} I have authorized</button>
              </div>}
              {saved.github.method === "app" && installUrl && <a className="mt-3 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline" href={installUrl} target="_blank" rel="noreferrer">Choose repositories for Praetor <ExternalLink size={11} /></a>}
              {saved.github.method !== "app" && !saved.github.fromEnvironment && <div className="mt-4">
                {!showToken ? <button type="button" onClick={() => setShowToken(true)} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">Use a token instead</button> : <div className="space-y-2">
                  <a href={tokenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">Create a fine-grained token <ExternalLink size={11} /></a>
                  <p className="text-xs leading-5 text-[var(--muted)]">Grant Contents, Issues, Pull requests, Actions, Workflows, and Secrets read/write; Metadata read. Tokens are stored locally.</p>
                  <input autoComplete="new-password" type="password" value={githubToken} onChange={(event) => setGithubToken(event.target.value)} placeholder="github_pat_…" className="setup-input" />
                </div>}
              </div>}
            </div>
            <Field label="OpenRouter API key" hint={saved.openRouterApiKeyMasked ? "Leave blank to keep the saved key. Store it in Repository setup to enable Actions." : "Required for agent model requests. It stays in this workspace."} status={saved.openRouterApiKeyMasked ? "Connected" : "Missing"}>
              <input autoComplete="new-password" type="password" value={openRouterApiKey} onChange={(event) => setOpenRouterApiKey(event.target.value)} placeholder={saved.openRouterApiKeyMasked ? "(saved)" : "sk-or-v1-…"} className="setup-input" />
            </Field>
          </div>
        </Section>

        <Section icon={<Cpu size={16} />} title="Models">
          <div className="divide-y divide-[var(--line)]">{stages.map((stage) => <div key={stage} className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] md:items-center"><div><p className="text-sm font-semibold">{MODEL_STAGES[stage].label}</p><p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{MODEL_STAGES[stage].description}</p></div><div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><ModelPicker stage={stage} value={models[stage]} defaultModel={saved.models[stage]} onChange={(model) => setModels((current) => ({ ...current, [stage]: model }))} align="end" /></div><button type="button" title={`Reset to ${DEFAULT_MODELS[stage]}`} aria-label={`Reset ${MODEL_STAGES[stage].label} model to the built-in default`} disabled={models[stage] === DEFAULT_MODELS[stage]} onClick={() => setModels((current) => ({ ...current, [stage]: DEFAULT_MODELS[stage] }))} className="btn btn-ghost btn-icon shrink-0"><RotateCcw size={14} /></button></div></div>)}</div>
        </Section>

        <Section icon={<FolderGit2 size={16} />} title="Repository">
          <div className="grid gap-5 md:grid-cols-2"><Field label="Base branch" hint="Target branch for generated changes and pull requests."><input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} className="setup-input font-mono" /></Field><div className="flex flex-col justify-center border-l border-[var(--line)] pl-4"><p className="text-sm font-semibold">Repository settings</p><Link href="/repo-setup#repository-settings" className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">Manage repository settings <ExternalLink size={12} /></Link></div></div>
        </Section>
      </form>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--base)]/90 backdrop-blur"><div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-5 py-3 md:px-10"><p className="mr-auto flex items-center gap-2 text-sm" aria-live="polite">{error ? <span className="flex items-center gap-2 text-[var(--warning)]"><CircleAlert size={15} />{error}</span> : message ? <span className="flex items-center gap-2 text-[var(--success)]"><Check size={15} />{message}</span> : dirty ? <span className="text-[var(--muted)]">Unsaved changes.</span> : null}</p><button type="submit" form="settings-form" disabled={!dirty || busy} className="btn btn-primary">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Save size={15} />} Save changes</button></div></div>
    </main>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="card p-5 md:p-6"><div className="mb-5 flex items-center gap-3"><span className="grid size-8 place-items-center border border-[var(--line-strong)] text-[var(--accent)]">{icon}</span><h2 className="text-base font-semibold">{title}</h2></div>{children}</section>;
}

function Field({ label, hint, status, children }: { label: string; hint: string; status?: "Connected" | "Missing"; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">{label}{status && <span className="text-[11px] text-[var(--muted)]">{status}</span>}</span>{children}<span className="mt-2 block text-xs leading-5 text-[var(--muted)]">{hint}</span></label>;
}
