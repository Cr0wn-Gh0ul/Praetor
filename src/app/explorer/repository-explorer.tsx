"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, FileCode2, Folder, FolderTree, LoaderCircle, Search, X } from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";
import { MonacoFile } from "@/components/editor/MonacoFile";

type PathNode = { name: string; path: string; directory: boolean; children: PathNode[] };
type FileContents = { path: string; content: string; loading: boolean; error: string };

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

export function RepositoryExplorer({ targetRepo, baseBranch }: { targetRepo: string; baseBranch: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [treeError, setTreeError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<FileContents | null>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const fileRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/repo/files?ref=${encodeURIComponent(baseBranch)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { files?: string[]; error?: { message?: string } };
        if (!response.ok) throw new Error(result.error?.message ?? "Could not load repository files.");
        setFiles(result.files ?? []);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setTreeError(cause instanceof Error ? cause.message : "Could not load repository files.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFiles(false);
      });
    return () => controller.abort();
  }, [baseBranch]);

  const tree = useMemo(() => filterTree(buildTree(files), query.trim().toLowerCase()), [files, query]);

  function toggleExpanded(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function openFile(filePath: string) {
    fileRequest.current?.abort();
    const controller = new AbortController();
    fileRequest.current = controller;
    setActiveFile({ path: filePath, content: "", loading: true, error: "" });
    try {
      const params = new URLSearchParams({ ref: baseBranch, path: filePath });
      const response = await fetch(`/api/repo/file?${params}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json() as { content?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "Could not read repository file.");
      setActiveFile({ path: filePath, content: result.content ?? "", loading: false, error: "" });
    } catch (cause) {
      if (!controller.signal.aborted) setActiveFile({ path: filePath, content: "", loading: false, error: cause instanceof Error ? cause.message : "Could not read repository file." });
    }
  }

  function closeFile() {
    fileRequest.current?.abort();
    fileRequest.current = null;
    setActiveFile(null);
  }

  const activeFileIsMarkdown = Boolean(activeFile && /\.(md|markdown)$/i.test(activeFile.path));

  return <main className="mx-auto min-h-screen max-w-[1500px] px-4 py-6 md:px-8 md:py-8">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
      <div className="flex min-w-0 items-center gap-4">
        <Link href="/dashboard" aria-label="Back to workspace" className="btn btn-ghost btn-sm"><ArrowLeft size={15} />Workspace</Link>
        <span className="h-6 w-px bg-[var(--line)]" />
        <div className="min-w-0"><div className="truncate text-xs font-medium text-[var(--ink)]">{targetRepo}</div><div className="mt-0.5 truncate font-mono text-[10px] text-[var(--muted)]">{baseBranch}</div></div>
      </div>
      <Link href="/context" className="btn btn-ghost btn-sm">Repository context</Link>
    </header>

    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div><p className="mb-1 flex items-center gap-2 text-xs font-semibold text-[var(--muted)]"><FolderTree size={14} />Repository</p><h1 className="text-3xl font-semibold">Explorer</h1></div>
      <p className="text-xs tabular-nums text-[var(--muted)]">{files.length.toLocaleString()} files</p>
    </div>

    <section className={`grid min-h-[min(72vh,56rem)] overflow-hidden rounded-md border border-[var(--line)] bg-[var(--panel)] md:h-[min(72vh,56rem)] md:min-h-96 ${treeCollapsed ? "md:grid-cols-[44px_minmax(0,1fr)]" : "md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]"}`}>
      {treeCollapsed ? <aside className="flex min-h-12 justify-center border-b border-[var(--line)] py-2 md:min-h-0 md:border-b-0 md:border-r">
        <button type="button" onClick={() => setTreeCollapsed(false)} title="Expand repository tree" aria-label="Expand repository tree" className="btn btn-ghost btn-icon"><ChevronRight size={15} /></button>
      </aside> : <aside className="flex min-h-72 min-w-0 flex-col border-b border-[var(--line)] md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 border-b border-[var(--line)] p-3">
          <label className="relative min-w-0 flex-1"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><input aria-label="Search repository files" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files and folders" className="setup-input bg-[var(--base)] pl-9" /></label>
          <button type="button" onClick={() => setTreeCollapsed(true)} title="Collapse repository tree" aria-label="Collapse repository tree" className="btn btn-ghost btn-sm btn-icon"><ChevronLeft size={14} /></button>
        </div>
        <div role="tree" aria-label="Repository files" className="min-h-0 flex-1 overflow-auto p-1.5">
          {loadingFiles ? <p className="flex items-center gap-2 px-3 py-5 text-xs text-[var(--muted)]"><LoaderCircle size={13} className="animate-spin" />Loading repository tree…</p> : treeError ? <p role="alert" className="px-3 py-5 text-xs text-[var(--warning)]">{treeError}</p> : !tree.length ? <p className="px-3 py-5 text-xs text-[var(--muted)]">{query ? "No matching files or folders." : "No repository files found."}</p> : tree.map((node) => <ExplorerRow key={node.path} node={node} level={0} query={Boolean(query.trim())} expanded={expanded} activePath={activeFile?.path ?? ""} onToggle={toggleExpanded} onOpenFile={openFile} />)}
        </div>
      </aside>}

      <section aria-label="File contents" className="flex min-h-72 min-w-0 flex-col bg-[var(--base)] md:min-h-0">
        {activeFile ? <>
          <header className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
            <h2 className="truncate font-mono text-xs text-[var(--ink)]">{activeFile.path}</h2>
            <div className="flex shrink-0 items-center gap-2">
              {activeFileIsMarkdown && <span className="text-[10px] text-[var(--muted)]">Rendered Markdown</span>}
              <button type="button" title="Close file" aria-label="Close file" onClick={closeFile} className="grid size-7 shrink-0 place-items-center text-[var(--muted)] hover:text-[var(--ink)]"><X size={14} /></button>
            </div>
          </header>
          {activeFile.loading ? <p className="flex items-center gap-2 p-5 text-xs text-[var(--muted)]"><LoaderCircle size={13} className="animate-spin" />Loading file…</p> : activeFile.error ? <p role="alert" className="p-5 text-xs text-[var(--warning)]">{activeFile.error}</p> : activeFileIsMarkdown ? <div className="min-h-0 flex-1 overflow-auto p-5"><Markdown className="mx-auto max-w-3xl">{activeFile.content}</Markdown></div> : <div className="min-h-0 flex-1"><MonacoFile filePath={activeFile.path} content={activeFile.content} /></div>}
        </> : <div className="grid flex-1 place-items-center p-8 text-center">
          <div><FileCode2 size={24} className="mx-auto mb-3 text-[var(--faint)]" /><p className="text-sm font-medium text-[var(--ink)]">No file selected</p></div>
        </div>}
      </section>
    </section>
  </main>;
}

function ExplorerRow({ node, level, query, expanded, activePath, onToggle, onOpenFile }: {
  node: PathNode;
  level: number;
  query: boolean;
  expanded: Set<string>;
  activePath: string;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isExpanded = query || expanded.has(node.path);
  const active = activePath === node.path;
  return <div role="none">
    <div role="treeitem" aria-expanded={node.directory ? isExpanded : undefined} aria-selected={node.directory ? undefined : active} className={`group flex min-h-8 min-w-0 items-center gap-2 rounded-sm border-l-2 py-1 pr-2 text-xs ${active ? "border-[var(--accent)] bg-[var(--accent)]/[0.08]" : "border-transparent hover:bg-[var(--panel-2)]"}`} style={{ paddingLeft: `${level * 16 + 6}px` }}>
      {node.directory ? <button type="button" onClick={() => onToggle(node.path)} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.path}`} className="grid size-5 shrink-0 place-items-center text-[var(--faint)] hover:text-[var(--ink)]">{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="size-5 shrink-0" />}
      {node.directory ? <Folder size={14} className="shrink-0 text-[var(--muted)]" /> : <FileCode2 size={14} className="shrink-0 text-[var(--faint)]" />}
      {node.directory ? <button type="button" onClick={() => onToggle(node.path)} className="min-w-0 truncate text-left font-mono text-[var(--muted)] hover:text-[var(--ink)]">{node.name}/</button> : <button type="button" onClick={() => onOpenFile(node.path)} aria-label={`Open ${node.path}`} className={`min-w-0 truncate text-left font-mono hover:text-[var(--accent)] ${active ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{node.name}</button>}
    </div>
    {node.directory && isExpanded && node.children.map((child) => <ExplorerRow key={child.path} node={child} level={level + 1} query={query} expanded={expanded} activePath={activePath} onToggle={onToggle} onOpenFile={onOpenFile} />)}
  </div>;
}