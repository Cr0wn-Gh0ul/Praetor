import { createHash } from "node:crypto";
import { MAX_CHUNK_CHARACTERS } from "./constants";

export interface SourceChunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol: string;
  text: string;
  contentHash: string;
}

export const MAX_SOURCE_FILE_BYTES = 256 * 1024;
const TEXT_WINDOW_LINES = 60;
const TEXT_OVERLAP_LINES = 10;
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".wasm", ".woff", ".woff2", ".ttf", ".mp4", ".mp3"]);

export function createSourceChunk(filePath: string, startLine: number, endLine: number, symbol: string, source: string): SourceChunk {
  const text = `${filePath}:${startLine}-${endLine} ${symbol}\n${source}`.slice(0, MAX_CHUNK_CHARACTERS);
  const contentHash = createHash("sha256").update(text).digest("hex");
  return {
    id: `${filePath}:${startLine}:${symbol}:${contentHash.slice(0, 12)}`,
    path: filePath,
    startLine,
    endLine,
    symbol,
    text,
    contentHash,
  };
}

export function chunkMarkdown(filePath: string, content: string): SourceChunk[] {
  const lines = content.split("\n");
  const sections: Array<{ title: string; start: number; lines: string[] }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index] ?? "");
    if (heading) sections.push({ title: heading[2]!, start: index + 1, lines: [] });
    const current = sections.at(-1);
    if (current) current.lines.push(lines[index]!);
  }
  if (sections.length === 0 && content.trim()) sections.push({ title: "document", start: 1, lines });
  return sections.flatMap((section) => {
    const pieces: SourceChunk[] = [];
    let part = "";
    let start = section.start;
    let end = section.start;
    for (const line of section.lines) {
      if (part.length + line.length + 1 > MAX_CHUNK_CHARACTERS - 160 && part) {
        pieces.push(createSourceChunk(filePath, start, end, section.title, part));
        part = "";
        start = end + 1;
      }
      part += `${line}\n`;
      end += 1;
    }
    if (part.trim()) pieces.push(createSourceChunk(filePath, start, end, section.title, part));
    return pieces;
  });
}

export function chunkPlainText(filePath: string, content: string): SourceChunk[] {
  const lines = content.split("\n");
  const chunks: SourceChunk[] = [];
  const step = TEXT_WINDOW_LINES - TEXT_OVERLAP_LINES;
  for (let start = 0; start < lines.length; start += step) {
    const window = lines.slice(start, start + TEXT_WINDOW_LINES);
    if (window.length === 0) break;
    chunks.push(createSourceChunk(filePath, start + 1, start + window.length, "text", window.join("\n")));
  }
  return chunks;
}

export function shouldIndexFile(filePath: string, byteLength: number): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (byteLength > MAX_SOURCE_FILE_BYTES || segments.some((segment) => ["node_modules", "dist", ".git", ".next", "coverage"].includes(segment))) return false;
  if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].includes(segments.at(-1) ?? "")) return false;
  if (BINARY_EXTENSIONS.has(normalized.slice(normalized.lastIndexOf(".")).toLowerCase())) return false;
  return true;
}