"use client";

import dynamic from "next/dynamic";

const MonacoFileClient = dynamic(() => import("./MonacoFile.client"), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-72 place-items-center text-xs text-[var(--muted)]">Loading editor…</div>,
});

export function MonacoFile({ filePath, content }: { filePath: string; content: string }) {
  return <MonacoFileClient filePath={filePath} content={content} />;
}