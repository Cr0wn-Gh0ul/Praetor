import type { FileChange } from "../types";

export function extractPlannedPaths(plan: string): string[] {
  const section = /(?:^|\n)#{1,6}\s*Files to change\s*\n([\s\S]*?)(?=\n#{1,6}\s|\s*$)/i.exec(plan)?.[1];
  if (!section) return [];
  const paths = section.split("\n").flatMap((line) => {
    const item = /^\s*[-*]\s+(.+)$/.exec(line)?.[1];
    if (!item) return [];
    const path = /`([^`]+)`/.exec(item)?.[1] ?? item.split(/\s+[\u2014\u2013-]\s+|\s+/)[0];
    return path ? [path.replace(/^\.\//, "").replace(/[,:;.]$/, "")] : [];
  });
  return [...new Set(paths)];
}

export function validateGeneratedChanges(allowedPaths: string[], changes: FileChange[]): FileChange[] {
  if (changes.length === 0) throw new Error("The model returned no file changes.");
  const allowed = new Set(allowedPaths.map((filePath) => filePath.replace(/^\.\//, "")));
  for (const change of changes) {
    const normalized = change.path.replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
      throw new Error(`Generated path must be relative: ${change.path}`);
    }
    if (segments.some((segment) => segment === ".." || segment === ".git" || segment === "node_modules")) {
      throw new Error(`Generated path is not allowed: ${change.path}`);
    }
    if (segments[0] === ".github" && segments[1] === "workflows") {
      throw new Error("Generated workflow changes require a separate human-reviewed task.");
    }
    if (!allowed.has(normalized)) throw new Error(`Generated path was not approved in the plan: ${change.path}`);
  }
  return changes;
}