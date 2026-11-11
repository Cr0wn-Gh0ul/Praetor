import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";
import { embedBatch } from "./embed";
import { deleteFiles, upsertFileChunks } from "../lancedb";
import { filterRepoFiles, getChangedFilesSince, getHeadSha, listFiles, pull, pullRepository, readAgentConfig, readRepoFile } from "../repo";
import { chunkSourceFile } from "./ts-morph";
import { getIndexChanges, mergeIndexIncludePaths } from "./selection";
import type { CodeChunk } from "../types";

type IndexMetadata = {
  repoKey: string;
  commit: string;
  files: string[];
  chunkCounts?: Record<string, number>;
  fileCount: number;
  chunkCount: number;
  indexedAt: string;
};

function metadataPath(): string {
  const dataDirectory = path.resolve(process.env.DATA_DIR ?? (process.env.DOCKER === "1" ? "/data" : ".data"));
  return path.join(dataDirectory, "index-meta.json");
}

async function readMetadata(): Promise<Record<string, IndexMetadata>> {
  try {
    return JSON.parse(await readFile(metadataPath(), "utf8")) as Record<string, IndexMetadata>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeMetadata(metadata: Record<string, IndexMetadata>): Promise<void> {
  const file = metadataPath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export async function fullIndex(update: (progress: number, message: string) => void): Promise<IndexMetadata> {
  const config = await getConfig();
  await pull(config.baseBranch);
  const { config: agentConfig } = await readAgentConfig();
  const pathsByRepo = new Map<string, { repository: string; paths: string[] }>();
  pathsByRepo.set(config.targetRepo.toLowerCase(), { repository: config.targetRepo, paths: mergeIndexIncludePaths(agentConfig.include, config.additionalContextPaths) });
  for (const source of agentConfig.contextSources) {
    const repository = source.repo ?? config.targetRepo;
    const key = repository.toLowerCase();
    const existing = pathsByRepo.get(key);
    if (existing) existing.paths.push(...source.paths);
    else pathsByRepo.set(key, { repository, paths: [...source.paths] });
  }
  const filesByRepo = new Map<string, { repository: string; files: string[] }>();
  for (const [repoKey, { repository, paths }] of pathsByRepo) {
    if (repository.toLowerCase() !== config.targetRepo.toLowerCase()) await pullRepository(repository);
    filesByRepo.set(repoKey, { repository, files: await listFiles([...new Set(paths)], agentConfig.exclude, repository) });
  }
  const allFiles = [...filesByRepo.values()].reduce((total, group) => total + group.files.length, 0);
  const previousMetadata = await readMetadata();
  let indexedFiles = 0;
  let targetMetadata: IndexMetadata | null = null;

  for (const [repoKey, { repository, files }] of filesByRepo) {
    const chunkCounts: Record<string, number> = {};
    let chunkCount = 0;
    const previous = previousMetadata[repoKey];
    const currentFiles = new Set(files);
    const removed = (previous?.files ?? []).filter((filePath) => !currentFiles.has(filePath));
    if (removed.length) await deleteFiles(repoKey, removed);

    for (const filePath of files) {
      const contents = await readRepoFile(filePath, repository);
      const sourceChunks = chunkSourceFile(filePath, contents);
      const vectors = await embedBatch(sourceChunks.map((chunk) => chunk.text));
      const chunks: CodeChunk[] = sourceChunks.map((chunk, index) => ({ ...chunk, repoKey, vector: vectors[index]! }));
      await upsertFileChunks(repoKey, filePath, chunks);
      chunkCount += chunks.length;
      chunkCounts[filePath] = chunks.length;
      indexedFiles += 1;
      update(Math.round((indexedFiles / Math.max(allFiles, 1)) * 100), `Indexed ${indexedFiles} of ${allFiles} files across ${filesByRepo.size} repositories.`);
    }

    const metadata: IndexMetadata = {
      repoKey,
      commit: await getHeadSha(repository),
      files,
      chunkCounts,
      fileCount: files.length,
      chunkCount,
      indexedAt: new Date().toISOString(),
    };
    previousMetadata[repoKey] = metadata;
    if (repoKey === config.targetRepo.toLowerCase()) targetMetadata = metadata;
  }

  await writeMetadata(previousMetadata);
  if (!targetMetadata) throw new Error("Target repository index was not created.");
  return targetMetadata;
}

export async function incrementalIndex(update: (progress: number, message: string) => void): Promise<IndexMetadata> {
  const config = await getConfig();
  const { config: agentConfig } = await readAgentConfig();
  if (agentConfig.contextSources.length) return fullIndex(update);
  const repoKey = config.targetRepo.toLowerCase();
  await pull(config.baseBranch);
  const previous = await getIndexMetadata(repoKey);
  if (!previous?.chunkCounts) return fullIndex(update);

  const include = mergeIndexIncludePaths(agentConfig.include, config.additionalContextPaths);
  const files = await listFiles(include, agentConfig.exclude);
  const currentFiles = new Set(files);
  const changedFiles = filterRepoFiles(await getChangedFilesSince(previous.commit), include, agentConfig.exclude);
  const changed = new Set(getIndexChanges(previous.files, files, changedFiles));
  const chunkCounts = { ...previous.chunkCounts };
  let processed = 0;

  for (const filePath of changed) {
    if (!currentFiles.has(filePath)) {
      await deleteFiles(repoKey, [filePath]);
      delete chunkCounts[filePath];
    } else {
      const contents = await readRepoFile(filePath);
      const sourceChunks = chunkSourceFile(filePath, contents);
      const vectors = await embedBatch(sourceChunks.map((chunk) => chunk.text));
      const chunks: CodeChunk[] = sourceChunks.map((chunk, index) => ({ ...chunk, repoKey, vector: vectors[index]! }));
      await upsertFileChunks(repoKey, filePath, chunks);
      chunkCounts[filePath] = chunks.length;
    }
    processed += 1;
    update(Math.round((processed / Math.max(changed.size, 1)) * 100), `Updated ${processed} of ${changed.size} changed files.`);
  }

  const metadata: IndexMetadata = {
    repoKey,
    commit: await getHeadSha(),
    files,
    chunkCounts,
    fileCount: files.length,
    chunkCount: Object.values(chunkCounts).reduce((total, count) => total + count, 0),
    indexedAt: new Date().toISOString(),
  };
  const allMetadata = await readMetadata();
  allMetadata[repoKey] = metadata;
  await writeMetadata(allMetadata);
  return metadata;
}

export async function getIndexMetadata(repoKey: string): Promise<IndexMetadata | null> {
  const allMetadata = await readMetadata();
  return allMetadata[repoKey.toLowerCase()] ?? null;
}