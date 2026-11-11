const filenameLanguages: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "cmakelists.txt": "cmake",
};

const extensionLanguages: Record<string, string> = {
  bash: "shell", c: "c", cc: "cpp", cjs: "javascript", cpp: "cpp", cs: "csharp", css: "css", csv: "plaintext",
  cts: "typescript", go: "go", graphql: "graphql", h: "c", hpp: "cpp", htm: "html", html: "html", java: "java",
  js: "javascript", json: "json", jsx: "javascript", kt: "kotlin", lua: "lua", md: "markdown", mjs: "javascript",
  mts: "typescript", php: "php", pl: "perl", ps1: "powershell", py: "python", rb: "ruby", rs: "rust", scss: "scss",
  sh: "shell", sql: "sql", swift: "swift", ts: "typescript", tsx: "typescript", txt: "plaintext", xml: "xml",
  yaml: "yaml", yml: "yaml",
};

export function languageFromPath(filePath: string): string {
  const filename = filePath.split("/").at(-1)?.toLowerCase() ?? "";
  const filenameLanguage = filenameLanguages[filename];
  if (filenameLanguage) return filenameLanguage;
  const extension = filename.split(".").at(-1) ?? "";
  return extensionLanguages[extension] ?? "plaintext";
}