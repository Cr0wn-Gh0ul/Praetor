"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Plus, Search } from "lucide-react";

export type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
  meta?: ReactNode;
  group?: string;
  icon?: ReactNode;
  keywords?: string;
};

type ComboboxProps = {
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  /** Return true when the free-text query may be used as a value that is not in the list. */
  allowCustom?: (query: string) => boolean;
  customLabel?: (query: string) => string;
  renderValue?: (option: ComboboxOption | undefined, value: string) => ReactNode;
  icon?: ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  size?: "sm" | "md";
  triggerClassName?: string;
  panelClassName?: string;
  maxResults?: number;
  footer?: ReactNode;
  /** `bare` renders only `triggerContent` inside a button styled by `triggerClassName`. */
  variant?: "field" | "bare";
  triggerContent?: ReactNode;
  title?: string;
};

type Item = { kind: "option"; option: ComboboxOption } | { kind: "custom"; value: string };
type PanelPosition = { top: number; left: number };

function matches(option: ComboboxOption, tokens: string[], includeDetails: boolean): boolean {
  if (tokens.length === 0) return true;
  const primary = `${option.label} ${option.value} ${option.group ?? ""}`;
  const haystack = (includeDetails ? `${primary} ${option.description ?? ""} ${option.keywords ?? ""}` : primary).toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function Combobox({
  value,
  options,
  onChange,
  label,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  loading = false,
  error,
  disabled = false,
  allowCustom,
  customLabel = (query) => `Use “${query}”`,
  renderValue,
  icon,
  align = "start",
  side = "bottom",
  size = "md",
  triggerClassName = "",
  panelClassName = "w-[min(26rem,calc(100vw-2rem))]",
  maxResults = 150,
  footer,
  variant = "field",
  triggerContent,
  title,
}: ComboboxProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  const selected = options.find((option) => option.value === value);

  const { items, truncated } = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    // Prefer name/ID matches; search descriptions only when nothing matches directly.
    const direct = options.filter((option) => matches(option, tokens, false));
    const filtered = direct.length ? direct : options.filter((option) => matches(option, tokens, true));
    const list: Item[] = [];
    const trimmed = query.trim();
    if (trimmed && allowCustom?.(trimmed) && !options.some((option) => option.value.toLowerCase() === trimmed.toLowerCase())) {
      list.push({ kind: "custom", value: trimmed });
    }
    for (const option of filtered.slice(0, maxResults)) list.push({ kind: "option", option });
    return { items: list, truncated: filtered.length > maxResults };
  }, [allowCustom, maxResults, options, query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPanelPosition(null);
      return;
    }
    function updatePosition() {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const maxLeft = Math.max(margin, window.innerWidth - panelRect.width - margin);
      const desiredLeft = align === "end" ? triggerRect.right - panelRect.width : triggerRect.left;
      const left = Math.min(maxLeft, Math.max(margin, desiredLeft));
      const maxTop = Math.max(margin, window.innerHeight - panelRect.height - margin);
      let top = side === "top" ? triggerRect.top - panelRect.height - gap : triggerRect.bottom + gap;
      if (side === "bottom" && top > maxTop) {
        const above = triggerRect.top - panelRect.height - gap;
        top = above >= margin ? above : maxTop;
      }
      setPanelPosition({ top: Math.min(maxTop, Math.max(margin, top)), left });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, open, side]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open) itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function openPanel() {
    if (disabled) return;
    setQuery("");
    const selectedIndex = options.findIndex((option) => option.value === value);
    setActiveIndex(selectedIndex >= 0 && selectedIndex < maxResults ? selectedIndex : 0);
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function choose(item: Item | undefined) {
    if (!item) return;
    const next = item.kind === "custom" ? item.value : item.option.value;
    close();
    if (next !== value) onChange(next);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(items.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(items.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const heightClass = size === "sm" ? "h-8 text-xs" : "h-10 text-sm";
  let lastGroup: string | undefined;

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openPanel();
          }
        }}
        className={variant === "bare" ? triggerClassName : `flex w-full min-w-0 items-center gap-2 rounded-lg border border-[var(--line-strong)] bg-[var(--panel)] px-3 text-left transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,var(--line-strong))] disabled:cursor-not-allowed disabled:opacity-50 ${open ? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)]" : ""} ${heightClass} ${triggerClassName}`}
      >
        {variant === "bare" ? triggerContent : (
          <>
            {loading ? <LoaderCircle size={size === "sm" ? 13 : 15} className="shrink-0 animate-spin text-[var(--accent)]" /> : icon}
            <span className="min-w-0 flex-1 truncate">
              {renderValue ? renderValue(selected, value) : selected ? selected.label : value || <span className="text-[var(--faint)]">{placeholder}</span>}
            </span>
            <ChevronDown size={size === "sm" ? 13 : 15} className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: panelPosition?.top ?? 0, left: panelPosition?.left ?? 0, visibility: panelPosition ? "visible" : "hidden" }}
          className={`popover z-50 flex max-h-[min(26rem,70vh)] flex-col overflow-hidden ${panelClassName}`}
        >
          <div className="flex items-center gap-2 border-b border-[var(--line)] px-3">
            <Search size={14} className="shrink-0 text-[var(--muted)]" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={items[activeIndex] ? optionId(activeIndex) : undefined}
              aria-label={`Search ${label.toLowerCase()}`}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--faint)] focus-visible:outline-none"
            />
          </div>
          <div id={listId} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto p-1">
            {error && <p className="flex items-start gap-2 px-3 py-3 text-xs leading-5 text-[var(--warning)]"><CircleAlert size={14} className="mt-0.5 shrink-0" />{error}</p>}
            {loading && options.length === 0 && <p className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--muted)]"><LoaderCircle size={14} className="animate-spin" />Loading…</p>}
            {!loading && !error && items.length === 0 && <p className="px-3 py-3 text-xs text-[var(--muted)]">{emptyText}</p>}
            {items.map((item, index) => {
              const active = index === activeIndex;
              if (item.kind === "custom") {
                return (
                  <div
                    key="__custom"
                    id={optionId(index)}
                    ref={(element) => { itemRefs.current[index] = element; }}
                    role="option"
                    aria-selected={false}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item)}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm ${active ? "bg-white/[0.06]" : ""}`}
                  >
                    <Plus size={14} className="shrink-0 text-[var(--accent)]" />
                    <span className="truncate">{customLabel(item.value)}</span>
                  </div>
                );
              }
              const { option } = item;
              const isSelected = option.value === value;
              const showGroup = option.group && option.group !== lastGroup;
              lastGroup = option.group;
              return (
                <div key={option.value}>
                  {showGroup && <p className="label-caps px-2.5 pb-1 pt-2.5 !text-[10px]">{option.group}</p>}
                  <div
                    id={optionId(index)}
                    ref={(element) => { itemRefs.current[index] = element; }}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item)}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 ${active ? "bg-white/[0.06]" : ""}`}
                  >
                    {option.icon && <span className="shrink-0 text-[var(--muted)]">{option.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${isSelected ? "font-semibold text-[var(--ink)]" : ""}`}>{option.label}</span>
                      {option.description && <span className="block truncate text-[11px] text-[var(--muted)]">{option.description}</span>}
                    </span>
                    {option.meta && <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted)]">{option.meta}</span>}
                    <Check size={14} className={`shrink-0 text-[var(--accent)] ${isSelected ? "" : "invisible"}`} />
                  </div>
                </div>
              );
            })}
            {truncated && <p className="px-3 py-2 text-[11px] text-[var(--faint)]">Showing the first {maxResults} matches. Keep typing to narrow the list.</p>}
          </div>
          {footer && <div className="border-t border-[var(--line)] px-3 py-2 text-[11px] text-[var(--muted)]">{footer}</div>}
        </div>,
        document.body,
      )}
    </div>
  );
}
