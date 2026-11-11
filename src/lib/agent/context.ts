import "server-only";

import { getConfig } from "../config";
import { MAX_FULL_FILE_CHARACTERS, MAX_RETRIEVAL_CONTEXT_CHARACTERS } from "../constants";
import { search } from "../lancedb";
import { isSensitiveRepoPath as isSensitivePath, readAgentConfig, readRepoFile } from "../repo";
import { embedBatch } from "../indexer/embed";
import type { RetrievedChunk } from "../types";

export function formatRetrievedChunks(chunks: RetrievedChunk[], maxCharacters = MAX_RETRIEVAL_CONTEXT_CHARACTERS, primaryRepo?: string): string {
  const grouped = new Map<string, { heading: string; chunks: RetrievedChunk[] }>();
  for (const chunk of chunks) {
    const key = `${chunk.repoKey}\0${chunk.path}`;
    const group = grouped.get(key) ?? { heading: !primaryRepo || chunk.repoKey === primaryRepo.toLowerCase() ? chunk.path : `${chunk.repoKey}/${chunk.path}`, chunks: [] };
    group.chunks.push(chunk);
    grouped.set(key, group);
  }

  const sections: string[] = [];
  let remaining = maxCharacters;
  for (const { heading, chunks: fileChunks } of grouped.values()) {
    const section = `## ${heading}\n${fileChunks.map((chunk) => chunk.text).join("\n\n")}`;
    if (section.length > remaining) {
      if (remaining > heading.length + 10) sections.push(section.slice(0, remaining));
      break;
    }
    sections.push(section);
    remaining -= section.length + 2;
  }
  return sections.join("\n\n");
}

export const MAX_ATTACHED_FILES = 8;

/** True for paths that must never be sent to a model as attached context. */
export { isSensitivePath };

/**
 * Validates user-attached files: each must be in the repository index, which already honors the
 * repository include/exclude rules, and must not look like a secret.
 */
export function selectAttachableFiles(requested: string[], indexedFiles: string[]): { accepted: string[]; rejected: string[] } {
  const indexed = new Set(indexedFiles);
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const filePath of [...new Set(requested)]) {
    if (indexed.has(filePath) && !isSensitivePath(filePath) && accepted.length < MAX_ATTACHED_FILES) accepted.push(filePath);
    else rejected.push(filePath);
  }
  return { accepted, rejected };
}

/** Unique repo-relative paths referenced by retrieved chunks, in retrieval order. */
export function contextSources(chunks: RetrievedChunk[], primaryRepo?: string): string[] {
  return [...new Set(chunks.map((chunk) => chunk.repoKey === primaryRepo?.toLowerCase() ? chunk.path : primaryRepo ? `${chunk.repoKey}/${chunk.path}` : chunk.path))];
}

export async function buildContext(query: string, limit = 8): Promise<{ context: string; chunks: RetrievedChunk[] }> {
  if (!query.trim()) return { context: "", chunks: [] };
  const config = await getConfig();
  const { config: agentConfig } = await readAgentConfig();
  const repositories = [...new Set([config.targetRepo, ...agentConfig.contextSources.map((source) => source.repo ?? config.targetRepo)])];
  const [vector] = await embedBatch([query]);
  if (!vector) return { context: "", chunks: [] };
  const results = await Promise.all(repositories.map((repository) => search(repository.toLowerCase(), vector, limit)));
  const chunks = results.flat().sort((left, right) => right.score - left.score).slice(0, limit);
  return { context: formatRetrievedChunks(chunks, MAX_RETRIEVAL_CONTEXT_CHARACTERS, config.targetRepo), chunks };
}

export async function getFullFiles(paths: string[]): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let remaining = MAX_FULL_FILE_CHARACTERS;
  for (const filePath of [...new Set(paths)]) {
    if (remaining <= 0) break;
    const content = await readRepoFile(filePath);
    const limitedContent = content.slice(0, remaining);
    result[filePath] = limitedContent;
    remaining -= limitedContent.length;
  }
  return result;
}