"use client";

import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Columns2, Rows2 } from "lucide-react";
import type { FileDiff } from "@/lib/github";
import { languageFromPath } from "./language";

type Props = { files: FileDiff[]; onSelection: (selection: string) => void };

const statusStyles: Record<string, { label: string; className: string }> = {
  added: { label: "A", className: "bg-[var(--success)]/12 text-[var(--success)]" },
  removed: { label: "D", className: "bg-[var(--warning)]/12 text-[var(--warning)]" },
  renamed: { label: "R", className: "bg-[var(--signal)]/12 text-[var(--signal)]" },
};

function splitPath(path: string): { dir: string; name: string } {
  const index = path.lastIndexOf("/");
  return index < 0 ? { dir: "", name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

export default function MonacoDiffClient({ files, onSelection }: Props) {
  const [selectedPath, setSelectedPath] = useState(files[0]?.path ?? "");
  const [sideBySide, setSideBySide] = useState(true);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0];

  useEffect(() => {
    if (!files.some((file) => file.path === selectedPath)) setSelectedPath(files[0]?.path ?? "");
  }, [files, selectedPath]);

  if (!selectedFile) return <p className="card p-6 text-sm text-[var(--muted)]">No text files in this diff.</p>;

  return (
    <div className="card flex h-[min(75vh,820px)] min-h-[440px] min-w-0 flex-col overflow-hidden md:flex-row">
      <nav aria-label="Changed files" className="max-h-40 shrink-0 overflow-y-auto border-b border-[var(--line)] bg-[var(--panel-2)] md:max-h-none md:w-60 md:border-b-0 md:border-r">
        <p className="label-caps sticky top-0 border-b border-[var(--line)] bg-[var(--panel-2)] px-3 py-2">{files.length} changed {files.length === 1 ? "file" : "files"}</p>
        <ul>
          {files.map((file) => {
            const { dir, name } = splitPath(file.path);
            const status = statusStyles[file.status];
            const active = file.path === selectedFile.path;
            return (
              <li key={file.path}>
                <button type="button" onClick={() => setSelectedPath(file.path)} title={file.path} aria-current={active ? "true" : undefined} className={`flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left ${active ? "border-[var(--accent)] bg-[var(--panel)]" : "border-transparent hover:bg-[var(--panel)]"}`}>
                  <span className={`grid size-4 shrink-0 place-items-center rounded text-[9px] font-bold ${status?.className ?? "bg-[var(--line)] text-[var(--muted)]"}`}>{status?.label ?? "M"}</span>
                  <span className="min-w-0"><span className="block truncate text-xs font-medium">{name}</span>{dir && <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{dir}</span>}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--line)] px-3">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{selectedFile.path}</span>
          <div role="group" aria-label="Diff layout" className="flex shrink-0 rounded-md border border-[var(--line-strong)] p-0.5">
            <button type="button" aria-pressed={sideBySide} title="Side by side" aria-label="Side by side" onClick={() => setSideBySide(true)} className={`grid size-6 place-items-center rounded ${sideBySide ? "bg-[var(--panel-2)] text-[var(--ink)]" : "text-[var(--muted)]"}`}><Columns2 size={13} /></button>
            <button type="button" aria-pressed={!sideBySide} title="Unified" aria-label="Unified" onClick={() => setSideBySide(false)} className={`grid size-6 place-items-center rounded ${!sideBySide ? "bg-[var(--panel-2)] text-[var(--ink)]" : "text-[var(--muted)]"}`}><Rows2 size={13} /></button>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <DiffEditor
            height="100%"
            theme="vs"
            language={languageFromPath(selectedFile.path)}
            original={selectedFile.original}
            modified={selectedFile.modified}
            options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: sideBySide, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", fontFamily: "IBM Plex Mono, monospace", fontSize: 12.5, lineHeight: 20, padding: { top: 8, bottom: 8 }, renderOverviewRuler: false, hideUnchangedRegions: { enabled: true } }}
            onMount={(editor) => {
              const modifiedEditor = editor.getModifiedEditor();
              modifiedEditor.onDidChangeCursorSelection((event) => {
                const model = modifiedEditor.getModel();
                onSelection(model?.getValueInRange(event.selection) ?? "");
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}
