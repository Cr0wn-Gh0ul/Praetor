"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, FileCode2, Folder, LoaderCircle, Search, X } from "lucide-react";

type PathNode = { name: string; path: string; directory: boolean; children: PathNode[] };

function buildTree(paths: string[]): PathNode[] {
  const root: PathNode = { name: "", path: "", directory: true, children: [] };
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let parent = root;
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      let node = parent.children.find((child) => child.name === name);
      if (!node) {
        node = { name, path, directory: index < parts.length - 1, children: [] };
        parent.children.push(node);
      }
      parent = node;
    });
  }
  const sort = (nodes: PathNode[]) => {
    nodes.sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root.children);
  return root.children;
}

function filterTree(nodes: PathNode[], query: string): PathNode[] {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    if (node.path.toLowerCase().includes(query)) return [node];
    const children = filterTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function RepositoryPathPicker({ refName, label, description, value, onChange, canSelectPath = () => true }: {
  refName: string;
  label: string;
  description: string;
  value: string[];
  onChange: (paths: string[]) => void;
  canSelectPath?: (path: string) => boolean;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      fetch(`/api/repo/files?ref=${encodeURIComponent(refName)}`, { cache: "no-store" })
        .then(async (response) => {
          const result = await response.json() as { files?: string[]; error?: { message?: string } };
          if (!response.ok) throw new Error(result.error?.message ?? "Could not load repository files.");
          if (current) setFiles(result.files ?? []);
        })
        .catch((cause: unknown) => {
          if (current) setError(cause instanceof Error ? cause.message : "Could not load repository files.");
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [refName]);

  const tree = useMemo(() => filterTree(buildTree(files), query.trim().toLowerCase()), [files, query]);

  function toggle(path: string) {
    onChange(value.includes(path) ? value.filter((item) => item !== path) : [...value, path]);
  }

  function toggleExpanded(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return <section className="min-w-0 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)]">
    <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0"><h3 className="text-sm font-semibold">{label}</h3><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p></div>
      <span className="shrink-0 border border-[var(--line)] bg-[var(--base)] px-2 py-1 text-[11px] tabular-nums text-[var(--muted)]">{value.length} selected</span>
    </header>
    <div className="border-y border-[var(--line)] bg-[var(--base)] p-3">
      <label className="relative block"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input aria-label={`Search ${label.toLowerCase()}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repository files and folders" className="setup-input bg-[var(--panel)] pl-9" /></label>
      {value.length > 0 && <div aria-label="Selected repository paths" className="mt-2 flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">{value.map((path) => <span key={path} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-[var(--line)] bg-[var(--panel)] px-1.5 py-1 font-mono text-[10px] text-[var(--muted)]"><span className="truncate">{path}</span><button type="button" title={`Remove ${path}`} aria-label={`Remove ${path}`} onClick={() => toggle(path)} className="grid size-4 shrink-0 place-items-center text-[var(--faint)] hover:text-[var(--ink)]"><X size={11} /></button></span>)}</div>}
    </div>
    <div className="max-h-72 overflow-auto bg-[var(--panel)] p-1.5" role="group" aria-label={`${label} repository tree`}>
      {loading ? <p className="flex items-center gap-2 px-3 py-5 text-xs text-[var(--muted)]"><LoaderCircle size={13} className="animate-spin" />Loading repository tree…</p> : error ? <p role="alert" className="px-3 py-5 text-xs text-[var(--warning)]">{error}</p> : !tree.length ? <p className="px-3 py-5 text-xs text-[var(--muted)]">{query ? "No matching files or folders." : "No repository files found."}</p> : tree.map((node) => <PathRow key={node.path} node={node} level={0} query={Boolean(query.trim())} expanded={expanded} selected={value} canSelectPath={canSelectPath} onToggle={toggle} onExpand={toggleExpanded} />)}
    </div>
  </section>;
}

function PathRow({ node, level, query, expanded, selected, canSelectPath, onToggle, onExpand }: {
  node: PathNode;
  level: number;
  query: boolean;
  expanded: Set<string>;
  selected: string[];
  canSelectPath: (path: string) => boolean;
  onToggle: (path: string) => void;
  onExpand: (path: string) => void;
}) {
  const isExpanded = query || expanded.has(node.path);
  const checked = selected.includes(node.path);
  const selectable = canSelectPath(node.path);
  return <div>
    <div className={`group flex min-h-8 min-w-0 items-center gap-2 rounded-sm border-l-2 py-1 pr-2 text-xs ${checked ? "border-[var(--accent)] bg-[var(--accent)]/[0.07]" : "border-transparent hover:bg-[var(--panel-2)]"}`} style={{ paddingLeft: `${level * 16 + 8}px` }}>
      {node.directory ? <button type="button" onClick={() => onExpand(node.path)} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.path}`} aria-expanded={isExpanded} className="grid size-5 shrink-0 place-items-center text-[var(--faint)] hover:text-[var(--ink)]">{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="size-5 shrink-0" />}
      <input type="checkbox" checked={checked} onChange={() => onToggle(node.path)} disabled={!selectable && !checked} title={selectable ? undefined : "This path cannot be added to context."} aria-label={`Select ${node.directory ? "folder" : "file"} ${node.path}`} className="size-3.5 shrink-0 accent-[var(--accent)]" />
      {node.directory ? <Folder size={14} className={`shrink-0 ${checked ? "text-[var(--accent)]" : "text-[var(--muted)]"}`} /> : <FileCode2 size={14} className="shrink-0 text-[var(--faint)]" />}
      <span className={`min-w-0 truncate font-mono ${checked ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{node.name}{node.directory ? "/" : ""}</span>
      {checked && <Check size={12} className="ml-auto shrink-0 text-[var(--accent)]" />}
    </div>
    {node.directory && isExpanded && node.children.map((child) => <PathRow key={child.path} node={child} level={level + 1} query={query} expanded={expanded} selected={selected} canSelectPath={canSelectPath} onToggle={onToggle} onExpand={onExpand} />)}
  </div>;
}