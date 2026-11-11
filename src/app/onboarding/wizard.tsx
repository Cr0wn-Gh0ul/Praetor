"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BadgeCheck, CircleHelp, ExternalLink, GitBranch, LoaderCircle, Sparkles } from "lucide-react";

type WizardValues = {
  githubToken: string;
  openRouterApiKey: string;
};

type ValidationState = { valid: boolean; message: string } | null;

const steps = [
  { title: "GitHub", description: "Connect your account", icon: GitBranch },
  { title: "OpenRouter", description: "Choose your model gateway", icon: Sparkles },
];
const tokenUrl = "https://github.com/settings/personal-access-tokens/new?name=Praetor&description=Local+GitHub+issue+and+Actions+automation&expires_in=90&contents=write&issues=write&pull_requests=write&actions=write&workflows=write&secrets=write&metadata=read";

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<WizardValues>({
    githubToken: "",
    openRouterApiKey: "",
  });
  const [validation, setValidation] = useState<ValidationState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [appAvailable, setAppAvailable] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [device, setDevice] = useState<{ id: string; userCode: string; verificationUri: string; expiresIn: number; interval: number } | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    void Promise.all([
      fetch("/api/auth/github/device", { cache: "no-store" }).then((response) => response.json()) as Promise<{ available?: boolean; installUrl?: string | null }>,
      fetch("/api/config", { cache: "no-store" }).then((response) => response.json()) as Promise<{ github?: { method?: string; login?: string } }>,
    ]).then(([deviceOptions, config]) => {
      setAppAvailable(Boolean(deviceOptions.available));
      setInstallUrl(deviceOptions.installUrl ?? null);
      setShowToken(!deviceOptions.available);
      if (config.github?.method === "app" || config.github?.method === "token") {
        setGithubConnected(true);
        setValidation({ valid: true, message: config.github.login ? `Connected as @${config.github.login}.` : "GitHub is connected." });
      }
    }).catch(() => setShowToken(true));
  }, []);

  const update = (key: keyof WizardValues, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setValidation(null);
    setError("");
  };

  async function testCurrentStep() {
    setBusy(true);
    setValidation(null);
    setError("");
    try {
      const payload = step === 0
        ? { provider: "github", token: values.githubToken }
        : { provider: "openrouter", apiKey: values.openRouterApiKey };

      const response = await fetch("/api/config/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { valid: boolean; message: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Validation request failed.");
      setValidation(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not validate this value.");
    } finally {
      setBusy(false);
    }
  }

  async function beginGitHubSignIn() {
    setBusy(true);
    setError("");
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

  async function finishGitHubSignIn() {
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
          setGithubConnected(true);
          setDevice(null);
          setValidation({ valid: true, message: `Connected as @${result.login}.` });
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

  async function finishSetup() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(values.githubToken ? { githubToken: values.githubToken } : {}),
          ...(values.openRouterApiKey ? { openRouterApiKey: values.openRouterApiKey } : {}),
        }),
      });
      const result = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not save configuration.");
      router.push("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save configuration.");
    } finally {
      setBusy(false);
    }
  }

  const activeStep = steps[step]!;
  const ActiveIcon = activeStep.icon;

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 gap-10 px-5 py-8 md:grid-cols-[270px_minmax(0,1fr)] md:px-10 md:py-12">
      <aside className="flex flex-col border-b border-[var(--line)] pb-7 md:min-h-[calc(100vh-6rem)] md:border-b-0 md:border-r md:pb-0 md:pr-8">
        <Link href="/" className="mb-12 flex items-center gap-3 text-sm font-bold tracking-wide text-[var(--ink)]">
          <span className="grid size-9 place-items-center rounded-lg border border-[var(--accent)]/50 text-[var(--accent)]">P</span>
          PRAETOR
        </Link>
        <p className="mb-3 text-xs font-bold uppercase text-[var(--muted)]">Initial setup</p>
        <ol className="grid grid-cols-2 gap-2 md:grid-cols-1">
          {steps.map((item, index) => {
            const Icon = item.icon;
            const selected = index === step;
            const complete = index < step;
            return (
              <li key={item.title}>
                <button
                  type="button"
                  onClick={() => { setStep(index); setValidation(null); setError(""); }}
                  className={`flex w-full items-center gap-3 border p-3 text-left transition-colors ${selected ? "border-[var(--accent)]/60 bg-[var(--panel)]" : "border-transparent hover:bg-white/[0.03]"}`}
                >
                  <span className={`grid size-8 shrink-0 place-items-center ${complete ? "bg-[var(--accent)] text-[var(--accent-ink)]" : selected ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>
                    {complete ? <BadgeCheck size={17} /> : <Icon size={17} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{item.title}</span>
                    <span className="hidden text-xs text-[var(--muted)] sm:block">{item.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-auto hidden border-t border-[var(--line)] pt-5 text-xs leading-5 text-[var(--muted)] md:block">
          <p className="mb-2 flex items-center gap-2 font-semibold text-[var(--ink)]"><CircleHelp size={14} /> Local credentials</p>
          Credentials are stored in the app data directory and are never sent to the browser after saving.
        </div>
      </aside>

      <section className="flex min-w-0 flex-col pt-2 md:pt-12">
        <div className="mb-10 flex items-center gap-3 text-xs font-semibold uppercase text-[var(--accent)]">
          <span className="h-px w-8 bg-[var(--accent)]" /> Step 0{step + 1} / 02
        </div>
        <div className="mb-8 max-w-2xl">
          <p className="mb-3 text-4xl font-semibold leading-tight text-[var(--ink)] md:text-5xl">
            {step === 0 && "Connect your GitHub account."}
            {step === 1 && "Bring your own models."}
          </p>
          <p className="max-w-xl text-sm leading-6 text-[var(--muted)]">
            {step === 0 && "Connect once, then choose any repository you can write to from the workspace."}
            {step === 1 && "OpenRouter routes planning and coding requests to the models you choose."}
          </p>
        </div>

        <div className="mb-8 max-w-2xl border-y border-[var(--line)] py-7">
          <div className="mb-6 flex items-center gap-3">
            <ActiveIcon className="text-[var(--accent)]" size={19} />
            <h1 className="text-base font-semibold">{activeStep.title}</h1>
          </div>

          {step === 0 && (
            <div className="space-y-5">
              {appAvailable && !showToken && <div className="space-y-3">
                <button type="button" disabled={busy || githubConnected} onClick={() => void beginGitHubSignIn()} className="btn btn-primary">{busy ? <LoaderCircle size={15} className="animate-spin" /> : <GitBranch size={15} />} {githubConnected ? "GitHub connected" : "Sign in with GitHub"}</button>
                {device && <div className="border-l-2 border-[var(--accent)] pl-3"><p className="font-mono text-lg font-semibold tracking-widest">{device.userCode}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => void navigator.clipboard.writeText(device.userCode)} className="btn btn-ghost btn-sm">Copy code</button><a href={device.verificationUri} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Open GitHub <ExternalLink size={12} /></a><button type="button" disabled={busy} onClick={() => void finishGitHubSignIn()} className="btn btn-primary btn-sm">{busy ? <LoaderCircle size={13} className="animate-spin" /> : null} I have authorized</button></div></div>}
                {githubConnected && installUrl && <a href={installUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">Choose repositories for Praetor <ExternalLink size={11} /></a>}
                <button type="button" onClick={() => setShowToken(true)} className="block text-xs text-[var(--muted)] hover:text-[var(--ink)]">Use a token instead</button>
              </div>}
              {showToken && <div className="space-y-2"><a href={tokenUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">Create a fine-grained token <ExternalLink size={11} /></a><Field label="Personal access token" hint="Grant Contents, Issues, Pull requests, Actions, Workflows, and Secrets read/write; Metadata read."><input autoComplete="off" type="password" value={values.githubToken} onChange={(event) => update("githubToken", event.target.value)} placeholder="github_pat_…" className="setup-input" /></Field>{appAvailable && <button type="button" onClick={() => { setShowToken(false); update("githubToken", ""); }} className="text-xs text-[var(--muted)] hover:text-[var(--ink)]">Back to GitHub sign-in</button>}</div>}
            </div>
          )}
          {step === 1 && (
            <Field label="OpenRouter API key" hint="Create a key in your OpenRouter account. The key stays on this machine.">
              <input autoComplete="off" type="password" value={values.openRouterApiKey} onChange={(event) => update("openRouterApiKey", event.target.value)} placeholder="sk-or-v1-…" className="setup-input" />
            </Field>
          )}
          <div className="mt-6 flex min-h-7 items-center gap-2 text-sm" aria-live="polite">
            {busy && <LoaderCircle className="animate-spin text-[var(--muted)]" size={16} />}
            {validation && <span className={validation.valid ? "text-[var(--accent)]" : "text-[var(--warning)]"}>{validation.message}</span>}
            {error && <span className="text-[var(--warning)]">{error}</span>}
          </div>
        </div>

        <div className="flex max-w-2xl flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || busy} className="btn btn-ghost h-10 disabled:invisible">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="ml-auto flex gap-2">
            {(step === 1 || showToken) && <button type="button" onClick={testCurrentStep} disabled={busy || (step === 0 && !values.githubToken)} className="btn btn-secondary h-10">{busy ? <LoaderCircle className="animate-spin" size={16} /> : <BadgeCheck size={16} />} Test</button>}
            {step < steps.length - 1 ? (
              <button type="button" onClick={() => { setStep((current) => current + 1); setValidation(null); setError(""); }} disabled={step === 0 && !githubConnected && !validation?.valid} className="btn btn-primary h-10">
                Continue <ArrowRight size={16} />
              </button>
            ) : (
              <button type="button" onClick={finishSetup} disabled={busy || !validation?.valid} className="btn btn-primary h-10">
                Finish setup <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {children}
      <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">{hint}</span>
    </label>
  );
}