"use client";

import { Editor } from "@monaco-editor/react";
import { languageFromPath } from "./language";

export default function MonacoFileClient({ filePath, content }: { filePath: string; content: string }) {
  return <div className="h-full min-h-0 w-full">
    <Editor
      height="100%"
      theme="vs"
      language={languageFromPath(filePath)}
      value={content}
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: "on",
        fontSize: 12,
        lineNumbersMinChars: 3,
        renderLineHighlight: "none",
        contextmenu: false,
        padding: { top: 12, bottom: 12 },
      }}
    />
  </div>;
}