import "server-only";

import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { CodeChunk, RetrievedChunk } from "./types";

type LanceConnection = Awaited<ReturnType<(typeof import("@lancedb/lancedb"))["connect"]>>;
type VectorRow = Omit<CodeChunk, "vector"> & { vector: number[]; _distance?: number };

function safeRepoKey(repoKey: string): string {
  return repoKey.replace(/[^A-Za-z0-9_]/g, "_");
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

export function createVectorStore(databasePath: string) {
  let connectionPromise: Promise<LanceConnection> | null = null;

  async function connection(): Promise<LanceConnection> {
    if (!connectionPromise) {
      connectionPromise = (async () => {
        await mkdir(databasePath, { recursive: true, mode: 0o700 });
        const { connect } = await import("@lancedb/lancedb");
        return connect(databasePath);
      })().catch((error: unknown) => {
        connectionPromise = null;
        throw error;
      });
    }
    return connectionPromise;
  }

  async function getTable(repoKey: string, create = false, firstRows?: VectorRow[]) {
    const db = await connection();
    const name = safeRepoKey(repoKey);
    const names = await db.tableNames();
    if (names.includes(name)) return db.openTable(name);
    if (!create || !firstRows?.length) return null;
    return db.createTable(name, firstRows, { mode: "create", existOk: true });
  }

  async function upsertFileChunks(repoKey: string, filePath: string, chunks: CodeChunk[]): Promise<void> {
    const rows = chunks.map((chunk) => ({ ...chunk, repoKey }));
    const table = await getTable(repoKey, rows.length > 0, rows);
    if (!table) return;
    await table.delete(`path = '${escapeSqlString(filePath)}'`);
    if (rows.length) await table.add(rows, { mode: "append" });
  }

  async function deleteFiles(repoKey: string, filePaths: string[]): Promise<void> {
    const table = await getTable(repoKey);
    if (!table) return;
    for (const filePath of filePaths) {
      await table.delete(`path = '${escapeSqlString(filePath)}'`);
    }
  }

  async function search(repoKey: string, vector: number[], limit = 8): Promise<RetrievedChunk[]> {
    if (limit <= 0) return [];
    const table = await getTable(repoKey);
    if (!table) return [];
    const rows = await table.query().nearestTo(vector).limit(limit).toArray() as VectorRow[];
    return rows.map((row) => {
      const { vector, _distance, ...metadata } = row;
      void vector;
      return { ...metadata, score: -(_distance ?? 0) };
    });
  }

  async function dropTable(repoKey: string): Promise<void> {
    const db = await connection();
    const name = safeRepoKey(repoKey);
    if ((await db.tableNames()).includes(name)) await db.dropTable(name);
  }

  return { upsertFileChunks, deleteFiles, search, dropTable };
}

const defaultDatabasePath = path.join(path.resolve(process.env.DATA_DIR ?? (process.env.DOCKER === "1" ? "/data" : ".data")), "lancedb");
const defaultStore = createVectorStore(defaultDatabasePath);

export const upsertFileChunks = defaultStore.upsertFileChunks;
export const deleteFiles = defaultStore.deleteFiles;
export const search = defaultStore.search;
export const dropTable = defaultStore.dropTable;