"use client";

import { useCallback, useRef, useState } from "react";
import { Bold, Code, Image as ImageIcon, Italic, Link as LinkIcon, List, ListChecks, Quote } from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";
import { applyMarkdownAction, linkSelectionToUrl, type MarkdownAction, type MarkdownEdit } from "@/lib/markdown-format";

const TOOLS: { action: MarkdownAction; label: string; shortcut?: string; Icon: typeof Bold }[] = [
  { action: "bold", label: "Bold", shortcut: "B", Icon: Bold },
  { action: "italic", label: "Italic", shortcut: "I", Icon: Italic },
  { action: "code", label: "Code", Icon: Code },
  { action: "quote", label: "Quote", Icon: Quote },
  { action: "list", label: "Bulleted list", Icon: List },
  { action: "task", label: "Task list", Icon: ListChecks },
  { action: "link", label: "Link", shortcut: "K", Icon: LinkIcon },
  { action: "image", label: "Image (by URL)", Icon: ImageIcon },
];

type TextareaRef = React.RefObject<HTMLTextAreaElement | null>;

/** Applies edits to a controlled textarea and restores focus and selection afterwards. */
export function useMarkdownEditing(textareaRef: TextareaRef, value: string, onChange: (value: string) => void) {
  const commit = useCallback((edit: MarkdownEdit) => {
    onChange(edit.value);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(edit.start, edit.end);
    });
  }, [onChange, textareaRef]);

  const apply = useCallback((action: MarkdownAction) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    commit(applyMarkdownAction(value, start, end, action));
  }, [commit, textareaRef, value]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const action = TOOLS.find((tool) => tool.shortcut?.toLowerCase() === event.key.toLowerCase())?.action;
    if (!action) return;
    event.preventDefault();
    apply(action);
  }, [apply]);

  const onPaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const edit = linkSelectionToUrl(value, textarea.selectionStart, textarea.selectionEnd, event.clipboardData.getData("text/plain"));
    if (!edit) return;
    event.preventDefault();
    commit(edit);
  }, [commit, value]);

  return { apply, onKeyDown, onPaste };
}

const COMPACT_ACTIONS = new Set<MarkdownAction>(["bold", "italic", "link", "image"]);

export function MarkdownToolbar({ onAction, disabled, compact }: { onAction: (action: MarkdownAction) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <div role="toolbar" aria-label="Formatting" className={`flex items-center gap-0.5 ${compact ? "flex-nowrap" : "flex-wrap"}`}>
      {TOOLS.filter((tool) => !compact || COMPACT_ACTIONS.has(tool.action)).map(({ action, label, shortcut, Icon }) => (
        <button
          key={action}
          type="button"
          disabled={disabled}
          title={shortcut ? `${label} (Ctrl+${shortcut})` : label}
          aria-label={label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onAction(action)}
          className={`btn btn-ghost btn-sm btn-icon ${compact ? "size-6" : "size-7"}`}
        ><Icon size={14} /></button>
      ))}
    </div>
  );
}

type MarkdownEditorProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Hides the label visually while keeping it for screen readers. */
  hideLabel?: boolean;
  /** Fewer toolbar buttons, for narrow side panels. */
  compact?: boolean;
  textareaRef?: TextareaRef;
};

/** A GitHub-style Markdown input: Write and Preview tabs, a formatting toolbar, and link shortcuts. */
export function MarkdownEditor({ id, label, value, onChange, rows = 4, placeholder, disabled, autoFocus, hideLabel, compact, textareaRef }: MarkdownEditorProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? localRef;
  const { apply, onKeyDown, onPaste } = useMarkdownEditing(ref, value, onChange);
  const minHeight = `${rows * 1.5 + 1.25}rem`;

  return (
    <div className="min-w-0">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "mb-1.5 block text-xs font-semibold"}>{label}</label>
      <div className="overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--panel)] transition-shadow focus-within:border-[color-mix(in_srgb,var(--accent)_70%,transparent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]">
        <div className={`flex items-center border-b border-[var(--line)] bg-[var(--panel-2)] px-1.5 py-1 ${compact ? "gap-0.5" : "gap-2"}`}>
          <div role="tablist" aria-label="Editor mode" className="flex shrink-0">
            {(["write", "preview"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                onClick={() => setMode(item)}
                className={`h-7 rounded-md ${compact ? "px-1.5 text-[11px]" : "px-2.5 text-xs"} font-semibold capitalize ${mode === item ? "bg-[var(--panel)] text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
              >{item}</button>
            ))}
          </div>
          {mode === "write" && <div className="ml-auto min-w-0"><MarkdownToolbar onAction={apply} disabled={disabled} compact={compact} /></div>}
        </div>
        {mode === "write" ? (
          <textarea
            ref={(node) => { ref.current = node; }}
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={rows}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            className="block w-full resize-y bg-transparent px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-[var(--faint)] disabled:opacity-60"
          />
        ) : (
          <div className="overflow-auto px-3 py-2.5" style={{ minHeight }}>
            {value.trim() ? <Markdown compact>{value}</Markdown> : <p className="text-sm text-[var(--muted)]">Nothing to preview.</p>}
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-[var(--faint)]">Markdown supported. Add links, or images by URL.</p>
    </div>
  );
}
