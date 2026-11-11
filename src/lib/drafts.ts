import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { draftIssueSchema } from "./schemas";
import type { DraftIssue, DraftMessage } from "./types";

type DraftUpdate = Partial<Pick<DraftIssue, "title" | "body" | "templateId" | "templateName" | "labels">>;

const MAX_STORED_MESSAGES = 60;

function draftsDirectory(): string {
  return path.join(path.resolve(process.env.DATA_DIR ?? (process.env.DOCKER === "1" ? "/data" : ".data")), "drafts");
}

function draftPath(id: string): string {
  const parsedId = draftIssueSchema.shape.id.parse(id);
  return path.join(draftsDirectory(), `${parsedId}.json`);
}

async function writeDraft(draft: DraftIssue): Promise<void> {
  const file = draftPath(draft.id);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export async function listDrafts(): Promise<DraftIssue[]> {
  let names: string[];
  try {
    names = await readdir(draftsDirectory());
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const drafts = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
    const contents = await readFile(path.join(draftsDirectory(), name), "utf8");
    return draftIssueSchema.parse(JSON.parse(contents));
  }));
  return drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getDraft(id: string): Promise<DraftIssue | null> {
  try {
    const contents = await readFile(draftPath(id), "utf8");
    return draftIssueSchema.parse(JSON.parse(contents));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function createDraft(): Promise<DraftIssue> {
  const now = new Date().toISOString();
  const draft: DraftIssue = { id: randomUUID(), title: "", body: "", templateId: null, templateName: null, labels: [], messages: [], createdAt: now, updatedAt: now };
  await writeDraft(draft);
  return draft;
}

/** Saves an assistant revision together with the user request that produced it. */
export async function recordDraftRevision(id: string, revision: {
  title: string;
  body: string;
  request: string;
  summary: string;
  model: string;
  sources: string[];
}): Promise<DraftIssue> {
  const draft = await getDraft(id);
  if (!draft) throw new Error("Draft not found.");
  const now = new Date().toISOString();
  const request: DraftMessage = { id: randomUUID(), role: "user", content: revision.request, createdAt: now };
  const reply: DraftMessage = { id: randomUUID(), role: "assistant", content: revision.summary, model: revision.model, sources: revision.sources, createdAt: now };
  const messages = [...draft.messages, request, reply].slice(-MAX_STORED_MESSAGES);
  const updated = draftIssueSchema.parse({ ...draft, title: revision.title, body: revision.body, messages, updatedAt: now });
  await writeDraft(updated);
  return updated;
}

export async function updateDraft(id: string, update: DraftUpdate): Promise<DraftIssue> {
  const draft = await getDraft(id);
  if (!draft) throw new Error("Draft not found.");
  const updated = draftIssueSchema.parse({ ...draft, ...update, updatedAt: new Date().toISOString() });
  await writeDraft(updated);
  return updated;
}

export async function deleteDraft(id: string): Promise<void> {
  await rm(draftPath(id), { force: true });
}