"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BadgeCheck, Check, CircleAlert, ChevronLeft, Eye, FileText, LoaderCircle, PencilLine, Trash2, Upload } from "lucide-react";
import { DraftAssistant, type PendingRequest } from "@/components/drafts/DraftAssistant";
import { Markdown } from "@/components/markdown/Markdown";
import { MarkdownToolbar, useMarkdownEditing } from "@/components/markdown/MarkdownEditor";
import { useDraft } from "@/hooks/useDraft";
import { useStoredModel } from "@/hooks/useModels";
import { useTextStream } from "@/hooks/useTextStream";
import { splitIssueMarkdown } from "@/lib/draft-format";
import { formatRelativeTime } from "@/lib/format";
import type { IssueTemplate } from "@/lib/issue-templates";
import useSWR from "swr";

type SaveState = "saved" | "dirty" | "saving" | "error";

async function fetchTemplates(url: string): Promise<IssueTemplate[]> {
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json() as IssueTemplate[] | { error?: { message?: string } };
  if (!response.ok) throw new Error((result as { error?: { message?: string } }).error?.message ?? "Could not load issue templates.");
  return result as IssueTemplate[];
}

type DraftWorkspaceProps = {
  id: string;
  repository: string;
  defaultModel: string;
  onPublished: (issueNumber: number) => void;
  onDeleted: () => void;
  onChanged: () => void;
};

function parseSources(headers: Headers): string[] {
  try {
    const value: unknown = JSON.parse(decodeURIComponent(headers.get("X-Context-Sources") ?? "[]"));
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function DraftWorkspace({ id, repository, defaultModel, onPublished, onDeleted, onChanged }: DraftWorkspaceProps) {
  const { data: draft, error, mutate } = useDraft(id);
  const { data: templates, error: templatesError } = useSWR<IssueTemplate[]>("/api/issue-templates", fetchTemplates);
  const stream = useTextStream();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"write" | "preview">("preview");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [busy, setBusy] = useState<"publish" | "delete" | null>(null);
  const [actionError, setActionError] = useState("");
  const [templateFit, setTemplateFit] = useState<{ score: number; cost: number | null } | null>(null);
  const [checkingFit, setCheckingFit] = useState(false);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [lastRequest, setLastRequest] = useState<string | null>(null);
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);
  const [model, setModel] = useStoredModel("draft", defaultModel);
  const loadedId = useRef<string | null>(null);
  const inflightSave = useRef<Promise<boolean> | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ title, body });
  latest.current = { title, body };
  const streamingText = stream.state === "streaming" ? stream.text : "";

  useLayoutEffect(() => {
    for (const element of [titleRef.current, bodyRef.current]) {
      if (!element) continue;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [title, body, mode, streamingText, draft?.id]);

  useEffect(() => {
    if (!draft || loadedId.current === draft.id) return;
    loadedId.current = draft.id;
    setTitle(draft.title);
    setBody(draft.body);
    setSaveState("saved");
    setMode(draft.body.trim() ? "preview" : "write");
  }, [draft]);

  const persist = useCallback(async () => {
    const snapshot = latest.current;
    setSaveState("saving");
    const save = (async () => {
      try {
        const response = await fetch(`/api/drafts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: snapshot.title.trim(), body: snapshot.body }),
        });
        if (!response.ok) throw new Error("Could not save this draft.");
        const changedSince = latest.current.title !== snapshot.title || latest.current.body !== snapshot.body;
        setSaveState(changedSince ? "dirty" : "saved");
        void mutate();
        onChanged();
        return true;
      } catch {
        setSaveState("error");
        return false;
      }
    })();
    inflightSave.current = save;
    try {
      return await save;
    } finally {
      if (inflightSave.current === save) inflightSave.current = null;
    }
  }, [id, mutate, onChanged]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const timer = window.setTimeout(() => void persist(), 800);
    return () => window.clearTimeout(timer);
  }, [persist, saveState, title, body]);

  const unsavedRef = useRef(false);
  unsavedRef.current = saveState === "dirty" || saveState === "error";
  useEffect(() => {
    const unsaved = unsavedRef;
    const snapshot = latest;
    return () => {
      // Keep edits made just before switching drafts or leaving the dashboard.
      if (!unsaved.current) return;
      void fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: snapshot.current.title.trim(), body: snapshot.current.body }),
      }).catch(() => undefined);
    };
  }, [id]);

  function edit(next: { title?: string; body?: string }) {
    if (next.title !== undefined) setTitle(next.title);
    if (next.body !== undefined) setBody(next.body);
    setSaveState("dirty");
    setActionError("");
    setTemplateFit(null);
  }

  const bodyEditing = useMarkdownEditing(bodyRef, body, (next) => edit({ body: next }));

  async function flush(): Promise<boolean> {
    if (inflightSave.current) await inflightSave.current;
    const { title: savedTitle, body: savedBody } = draft ?? { title: "", body: "" };
    const unsaved = saveState === "dirty" || saveState === "error" || latest.current.title.trim() !== savedTitle || latest.current.body !== savedBody;
    return unsaved ? persist() : true;
  }

  async function send(message: string) {
    if (!(await flush())) {
      setActionError("Save failed. Check the connection and try again.");
      return;
    }
    setLastRequest(message);
    setPending({ message, contextStatus: null, sources: [] });
    setActionError("");
    const result = await stream.start("/api/agent/draft", { id, message, model, useContext: true, files: [] }, {
      onHeaders: (headers) => setPending((current) => current && { ...current, contextStatus: headers.get("X-Context-Status"), sources: parseSources(headers) }),
    });
    if (result.status === "done") {
      const saved = await mutate();
      if (saved) {
        setTitle(saved.title);
        setBody(saved.body);
        setSaveState("saved");
      }
      setMode("preview");
      setPending(null);
      onChanged();
    } else if (result.status === "aborted") {
      setPending(null);
    }
  }

  function retry() {
    if (lastRequest) void send(lastRequest);
  }

  async function publish() {
    setBusy("publish");
    setActionError("");
    try {
      if (!(await flush())) throw new Error("Save the draft before publishing.");
      const response = await fetch(`/api/drafts/${id}/publish`, { method: "POST" });
      const result = await response.json() as { number?: number; error?: { message?: string } };
      if (!response.ok || !result.number) throw new Error(result.error?.message ?? "Could not publish this draft.");
      onPublished(result.number);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not publish this draft.");
      setBusy(null);
    }
  }

  async function applyTemplate(templateId: string) {
    const template = templates?.find((item) => item.id === templateId);
    if (template && hasDraft && !window.confirm("Applying this template replaces the current title and description. Continue?")) return;
    if (!(await flush())) {
      setActionError("Save failed. Check the connection and try again.");
      return;
    }
    const nextTitle = template?.title ?? title;
    const nextBody = template?.body ?? body;
    setActionError("");
    try {
      const response = await fetch(`/api/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, body: nextBody, templateId: template?.id ?? null, templateName: template?.name ?? null, labels: template?.labels ?? [] }),
      });
      if (!response.ok) throw new Error("Could not apply this template.");
      setTitle(nextTitle);
      setBody(nextBody);
      setTemplateFit(null);
      setSaveState("saved");
      await mutate();
      onChanged();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not apply this template.");
    }
  }

  async function checkTemplateFit() {
    const templateId = draft?.templateId;
    if (!templateId || !(await flush())) {
      setActionError("Save the draft and select a template before checking fit.");
      return;
    }
    setCheckingFit(true);
    setActionError("");
    setTemplateFit(null);
    try {
      const response = await fetch("/api/agent/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, templateId }),
      });
      const result = await response.json() as { score?: number; cost?: number | null; error?: { message?: string } };
      if (!response.ok || result.score === undefined) throw new Error(result.error?.message ?? "Could not check template fit.");
      setTemplateFit({ score: result.score, cost: result.cost ?? null });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not check template fit.");
    } finally {
      setCheckingFit(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    setBusy("delete");
    try {
      const response = await fetch(`/api/drafts/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete this draft.");
      onDeleted();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not delete this draft.");
      setBusy(null);
    }
  }

  if (error) return <p className="m-6 flex items-center gap-2 text-sm text-[var(--warning)]"><CircleAlert size={16} />{error.message}</p>;
  if (!draft) return <p className="flex items-center gap-2 p-6 text-sm text-[var(--muted)]"><LoaderCircle size={15} className="animate-spin" />Loading draft…</p>;

  const streaming = stream.state === "streaming";
  const live = streaming ? splitIssueMarkdown(stream.text) : null;
  const shownTitle = live ? live.title || title : title;
  const shownBody = live ? live.body : body;
  const hasDraft = Boolean(title.trim() || body.trim());
  const publishBlocker = !title.trim() ? "Add a title to publish." : !body.trim() ? "Add a description to publish." : "";
  const selectedTemplate = templates?.find((template) => template.id === draft.templateId);

  return (
    <div className={`grid min-h-[calc(100vh-3.5rem)] grid-cols-1 ${assistantCollapsed ? "min-[900px]:grid-cols-[minmax(0,1fr)_44px]" : "min-[900px]:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]"}`}>
      <section className="flex min-w-0 flex-col">
        <header className="sticky top-14 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-[var(--line)] bg-[var(--base)]/85 px-4 backdrop-blur">
          <span className="chip hidden h-6 shrink-0 px-2 text-[11px] xl:inline-flex">Local draft</span>
          <div className="min-w-0 truncate"><SaveIndicator state={streaming ? "writing" : saveState} updatedAt={draft.updatedAt} onRetry={() => void persist()} /></div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <div role="group" aria-label="Editor mode" className="flex rounded-lg border border-[var(--line-strong)] p-0.5">
              {(["write", "preview"] as const).map((item) => (
                <button key={item} type="button" aria-pressed={mode === item} aria-label={item === "write" ? "Write" : "Preview"} title={item === "write" ? "Edit Markdown" : "Preview"} disabled={streaming} onClick={() => setMode(item)} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors xl:px-2.5 ${mode === item && !streaming ? "bg-[var(--panel-2)] text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
                  {item === "write" ? <PencilLine size={12} /> : <Eye size={12} />}<span className="hidden xl:inline">{item === "write" ? "Write" : "Preview"}</span>
                </button>
              ))}
            </div>
            <button type="button" title="Delete draft" aria-label="Delete draft" onClick={() => void remove()} disabled={busy !== null || streaming} className="btn btn-ghost btn-sm btn-icon hover:!text-[var(--warning)]"><Trash2 size={14} /></button>
            <button type="button" title={publishBlocker || `Create this issue in ${repository}`} onClick={() => void publish()} disabled={busy !== null || streaming || Boolean(publishBlocker)} className="btn btn-primary btn-sm">
              {busy === "publish" ? <LoaderCircle className="animate-spin" size={13} /> : <Upload size={13} />} Publish<span className="hidden xl:inline"> issue</span>
            </button>
          </div>
        </header>

        <div className={`mx-auto w-full flex-1 px-5 py-8 xl:px-10 ${assistantCollapsed ? "max-w-[96rem]" : "max-w-3xl group-data-[wide=true]/main:max-w-[96rem]"}`}>
          {actionError && <p role="alert" className="mb-5 flex items-center gap-2 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning)]/[0.06] px-3 py-2 text-xs text-[var(--warning)]"><CircleAlert size={14} />{actionError}</p>}

          <section aria-label="Issue templates" className="mb-6 border-y border-[var(--line)] py-3">
            <header className="mb-2.5 flex flex-wrap items-center gap-2">
              <FileText size={14} className="text-[var(--accent)]" />
              <span className="text-xs font-semibold">Issue template</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]">{selectedTemplate?.name ?? "Start with a blank issue"}</span>
              <button type="button" onClick={() => void checkTemplateFit()} disabled={!draft.templateId || !title.trim() || !body.trim() || streaming || checkingFit} className="btn btn-secondary btn-sm" title="Ask Jev to assess template alignment">
                {checkingFit ? <LoaderCircle size={13} className="animate-spin" /> : <BadgeCheck size={13} />} Check fit
              </button>
              {templateFit && <span role="status" className="w-full text-right text-[11px] text-[var(--muted)]">Template alignment {Math.round(templateFit.score * 100)}%{templateFit.cost !== null ? ` · $${templateFit.cost.toFixed(6)}` : ""}</span>}
            </header>
            <div role="group" aria-label="Select issue template" className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 2xl:grid-cols-4">
              {[
                { id: "", name: "Blank", description: "Start fresh" },
                ...(templates ?? []).map((template) => ({ id: template.id, name: template.name, description: template.body.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "") || "GitHub issue template" })),
              ].map((template) => {
                const selected = (draft.templateId ?? "") === template.id;
                return <button key={template.id || "blank"} type="button" aria-pressed={selected} disabled={streaming} onClick={() => void applyTemplate(template.id)} className={`flex min-h-14 min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:opacity-50 ${selected ? "border-[color-mix(in_srgb,var(--accent)_65%,transparent)] bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]" : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--line-strong)] hover:bg-[var(--panel-2)]"}`}>
                  <span className={`grid size-7 shrink-0 place-items-center rounded border ${selected ? "border-[var(--accent)]/35 text-[var(--accent)]" : "border-[var(--line)] text-[var(--muted)]"}`}>{selected ? <Check size={13} /> : <FileText size={13} />}</span>
                  <span className="min-w-0"><span className="block truncate text-xs font-semibold">{template.name}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]">{template.description}</span></span>
                </button>;
              })}
            </div>
            {templatesError && <p role="status" className="mt-2 text-[11px] text-[var(--warning)]">Templates unavailable</p>}
            {!templates && !templatesError && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><LoaderCircle size={12} className="animate-spin" />Loading templates</p>}
            {templates && templates.length === 0 && <p className="mt-2 text-[11px] text-[var(--muted)]">No GitHub templates yet. You can still start blank.</p>}
          </section>

          <label htmlFor="draft-title" className="sr-only">Issue title</label>
          <textarea
            ref={titleRef}
            id="draft-title"
            value={shownTitle}
            readOnly={streaming}
            onChange={(event) => edit({ title: event.target.value.replace(/\n/g, " ") })}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              setMode("write");
              requestAnimationFrame(() => bodyRef.current?.focus());
            }}
            placeholder="Untitled issue"
            rows={1}
            className="block w-full resize-none overflow-hidden bg-transparent text-3xl font-semibold leading-tight outline-none placeholder:text-[var(--faint)]"
          />
          <p className="mb-6 mt-2 text-xs text-[var(--muted)]">Publishes to <span className="text-[var(--ink)]">{repository}</span> as an issue. Start planning when you are ready.</p>

          {streaming ? (
            <div className="stream-caret border-t border-[var(--line)] pt-6">{shownBody ? <Markdown>{shownBody}</Markdown> : <span className="text-sm text-[var(--muted)]">Writing…</span>}</div>
          ) : mode === "write" ? (
            <>
              <label htmlFor="draft-body" className="sr-only">Issue description (Markdown)</label>
              <div className="mb-2 flex items-center justify-between gap-3 border-b border-[var(--line)] pb-2">
                <MarkdownToolbar onAction={bodyEditing.apply} />
                <span className="hidden text-[11px] text-[var(--faint)] sm:inline">Add links, or images by URL</span>
              </div>
              <textarea
                ref={bodyRef}
                id="draft-body"
                value={body}
                onChange={(event) => edit({ body: event.target.value })}
                onKeyDown={bodyEditing.onKeyDown}
                onPaste={bodyEditing.onPaste}
                placeholder={"## Context\nWhat's the problem and who does it affect?\n\n## Architecture\nWhere does this fit in the codebase?\n\n## Acceptance criteria\n- [ ] …\n\nOr describe your idea to the assistant and it will write this for you."}
                className="block min-h-[50vh] w-full resize-none overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 font-mono text-[13px] leading-6 outline-none transition-colors placeholder:text-[var(--faint)] focus:border-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
              />
              <p className="mt-2 text-[11px] text-[var(--faint)]">Markdown supported · changes save automatically</p>
            </>
          ) : (
            <div className="border-t border-[var(--line)] pt-6">
              {body.trim() ? <Markdown>{body}</Markdown> : (
                <div className="rounded-xl border border-dashed border-[var(--line-strong)] p-8 text-center">
                  <p className="text-sm font-semibold">Nothing here yet</p>
                  <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-[var(--muted)]">Tell the assistant what you have in mind, or switch to Write to draft the issue yourself.</p>
                  <button type="button" onClick={() => setMode("write")} className="btn btn-secondary btn-sm mt-4"><PencilLine size={13} /> Start writing</button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {assistantCollapsed ? <aside className="flex min-h-20 justify-center border-t border-[var(--line)] py-3 min-[900px]:sticky min-[900px]:top-14 min-[900px]:h-[calc(100vh-3.5rem)] min-[900px]:border-l min-[900px]:border-t-0">
        <button type="button" onClick={() => setAssistantCollapsed(false)} title="Expand assistant" aria-label="Expand assistant" className="btn btn-ghost btn-icon"><ChevronLeft size={15} /></button>
      </aside> : <DraftAssistant
        messages={draft.messages}
        hasDraft={hasDraft}
        streaming={streaming}
        pending={pending}
        error={stream.state === "error" ? stream.error : null}
        model={model}
        defaultModel={defaultModel}
        onModelChange={setModel}
        onSend={(message) => void send(message)}
        onStop={() => { stream.stop(); setPending(null); }}
        onRetry={retry}
        onCollapse={() => setAssistantCollapsed(true)}
      />}
    </div>
  );
}

function SaveIndicator({ state, updatedAt, onRetry }: { state: SaveState | "writing"; updatedAt: string; onRetry: () => void }) {
  if (state === "writing") return <span className="flex items-center gap-1.5 text-xs text-[var(--accent)]"><LoaderCircle size={12} className="animate-spin" />Assistant is writing…</span>;
  if (state === "saving") return <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]"><LoaderCircle size={12} className="animate-spin" />Saving…</span>;
  if (state === "dirty") return <span className="text-xs text-[var(--muted)]">Unsaved changes</span>;
  if (state === "error") return <button type="button" onClick={onRetry} className="flex items-center gap-1.5 text-xs text-[var(--warning)] hover:underline"><CircleAlert size={12} />Save failed · Retry</button>;
  return <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted)]"><Check size={12} className="shrink-0 text-[var(--success)]" />Saved {formatRelativeTime(updatedAt)}</span>;
}