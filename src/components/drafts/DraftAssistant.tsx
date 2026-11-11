"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, ChevronRight, CircleAlert, Database, LoaderCircle, RotateCcw, Square } from "lucide-react";
import { ModelPicker } from "@/components/models/ModelPicker";
import { useModels } from "@/hooks/useModels";
import type { DraftMessage } from "@/lib/types";

export type PendingRequest = {
  message: string;
  contextStatus: string | null;
  sources: string[];
};

type DraftAssistantProps = {
  messages: DraftMessage[];
  hasDraft: boolean;
  streaming: boolean;
  pending: PendingRequest | null;
  error: string | null;
  model: string;
  defaultModel: string;
  onModelChange: (model: string) => void;
  onSend: (message: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onCollapse: () => void;
};

export function DraftAssistant(props: DraftAssistantProps) {
  const { messages, hasDraft, streaming, pending, error } = props;
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const { data: catalog } = useModels();
  const modelNames = useMemo(() => new Map((catalog?.models ?? []).map((model) => [model.id, model.name])), [catalog?.models]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending, error]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [message]);

  function submit() {
    const trimmed = message.trim();
    if (!trimmed || streaming) return;
    props.onSend(trimmed);
    setMessage("");
  }

  return (
    <aside className="flex min-h-[60vh] min-w-0 flex-col border-t border-[var(--line)] min-[900px]:sticky min-[900px]:top-14 min-[900px]:h-[calc(100vh-3.5rem)] min-[900px]:border-l min-[900px]:border-t-0">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--line)] pl-4 pr-2">
        <Bot size={15} className="shrink-0 text-[var(--accent)]" />
        <h2 className="text-sm font-semibold">Assistant</h2>
        <button type="button" onClick={props.onCollapse} title="Collapse assistant" aria-label="Collapse assistant" className="btn btn-ghost btn-sm btn-icon ml-auto"><ChevronRight size={14} /></button>
      </header>

      <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="pt-2">
            <p className="text-sm font-semibold">What should this issue be about?</p>
            <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
              Describe the problem, who it affects, and what “done” looks like. The assistant uses repository context to draft a structured issue. Ask for changes in plain language.
            </p>
          </div>
        )}

        {messages.map((item) => item.role === "user"
          ? <UserBubble key={item.id} text={item.content} />
          : <AssistantNote key={item.id} text={item.content} model={item.model ? modelNames.get(item.model) ?? item.model : undefined} sources={item.sources ?? []} />)}

        {pending && (
          <>
            <UserBubble text={pending.message} />
            {streaming && (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] p-3 text-xs">
                <p className="flex items-center gap-2 text-[var(--ink)]"><LoaderCircle size={13} className="animate-spin text-[var(--accent)]" /> Writing the draft…</p>
                <p className="mt-1.5 text-[var(--muted)]">{describeContext(pending.contextStatus, pending.sources.length)}</p>
              </div>
            )}
          </>
        )}

        {error && !streaming && (
          <div className="rounded-lg border border-[var(--warning)]/35 bg-[var(--warning)]/[0.06] p-3 text-xs leading-5">
            <p className="flex items-start gap-2 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" />{error}</p>
            <button type="button" onClick={props.onRetry} className="btn btn-ghost btn-sm mt-2 -ml-2"><RotateCcw size={12} /> Try again</button>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--line)] p-3">
        <div className="rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] transition-colors focus-within:border-[color-mix(in_srgb,var(--accent)_55%,transparent)]">
          <label htmlFor="draft-message" className="sr-only">Message the assistant</label>
          <textarea
            ref={textareaRef}
            id="draft-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={hasDraft ? "Ask for changes, e.g. “add error-handling criteria”…" : "Describe the bug or feature…"}
            rows={2}
            className="block max-h-[220px] w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm leading-5 outline-none placeholder:text-[var(--faint)]"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <div className="min-w-0 max-w-[14rem] flex-1"><ModelPicker stage="draft" value={props.model} defaultModel={props.defaultModel} onChange={props.onModelChange} size="sm" align="start" side="top" triggerClassName="border-transparent bg-transparent hover:bg-[var(--panel-2)]" /></div>
            <div className="ml-auto">
              {streaming ? (
                <button type="button" title="Stop" aria-label="Stop generating" onClick={props.onStop} className="btn btn-secondary btn-sm btn-icon"><Square size={12} /></button>
              ) : (
                <button type="button" title="Send (Enter)" aria-label="Send message" onClick={submit} disabled={!message.trim()} className="btn btn-primary btn-sm btn-icon"><ArrowUp size={15} /></button>
              )}
            </div>
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-[var(--faint)]"><span className="kbd">Enter</span> to send · <span className="kbd">Shift</span>+<span className="kbd">Enter</span> for a new line</p>
      </div>
    </aside>
  );
}

function describeContext(status: string | null, count: number): string {
  switch (status) {
    case "used": return `Using ${count} file${count === 1 ? "" : "s"} from your repository.`;
    case "empty": return "No closely related code found in the index.";
    case "disabled": return "Repository context is off for this request.";
    case "not-indexed": return "Repository isn't indexed. Drafting from your message only.";
    case "unavailable": return "Context search failed. Drafting from your message only.";
    default: return "Searching repository context…";
  }
}

function UserBubble({ text, files = [] }: { text: string; files?: string[] }) {
  return (
    <div className="ml-6 rounded-xl rounded-tr-sm bg-[var(--panel-2)] px-3.5 py-2.5 text-sm leading-6">
      <p className="whitespace-pre-wrap break-words">{text}</p>
      {files.length > 0 && <p className="mt-1.5 truncate text-[11px] text-[var(--muted)]">Attached: {files.join(", ")}</p>}
    </div>
  );
}

function AssistantNote({ text, model, sources }: { text: string; model?: string; sources: string[] }) {
  return (
    <div className="mr-6 text-sm">
      <p className="leading-6">{text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
        {model && <span className="truncate">{model}</span>}
        {sources.length > 0 ? (
          <details className="group w-full">
            <summary className="cursor-pointer list-none text-[var(--muted)] hover:text-[var(--ink)]">
              <span className="inline-flex items-center gap-1"><Database size={11} /> {sources.length} file{sources.length === 1 ? "" : "s"} used as context</span>
            </summary>
            <ul className="mt-1.5 space-y-0.5 border-l border-[var(--line)] pl-3 font-mono text-[10.5px]">
              {sources.map((source) => <li key={source} className="truncate" title={source}>{source}</li>)}
            </ul>
          </details>
        ) : <span>No repository files used</span>}
      </div>
    </div>
  );
}
