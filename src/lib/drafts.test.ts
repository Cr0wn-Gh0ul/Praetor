import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDraft, deleteDraft, getDraft, listDrafts, recordDraftRevision, updateDraft } from "./drafts";

vi.mock("server-only", () => ({}));

const previousDataDir = process.env.DATA_DIR;
let temporaryDirectory = "";

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe("local drafts", () => {
  it("creates, updates, lists, and deletes drafts", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "codeless-drafts-"));
    process.env.DATA_DIR = temporaryDirectory;

    const draft = await createDraft();
    await updateDraft(draft.id, { title: "Test idea", body: "## Context\nDetails" });
    expect(await getDraft(draft.id)).toMatchObject({ title: "Test idea", body: "## Context\nDetails" });
    expect(await listDrafts()).toHaveLength(1);
    await deleteDraft(draft.id);
    expect(await getDraft(draft.id)).toBeNull();
  });

  it("records assistant revisions with the request history", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "codeless-drafts-"));
    process.env.DATA_DIR = temporaryDirectory;

    const draft = await createDraft();
    expect(draft.messages).toEqual([]);
    const updated = await recordDraftRevision(draft.id, {
      title: "Add CSV export",
      body: "## Context\nReports",
      request: "Users want CSV export",
      summary: "Drafted the issue.",
      model: "provider/model",
      sources: ["src/reports.ts"],
    });

    expect(updated).toMatchObject({ title: "Add CSV export", body: "## Context\nReports" });
    expect(updated.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(updated.messages[1]).toMatchObject({ content: "Drafted the issue.", model: "provider/model", sources: ["src/reports.ts"] });
    expect((await getDraft(draft.id))?.messages).toHaveLength(2);
  });

  it("reads drafts saved before message history existed", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "codeless-drafts-"));
    process.env.DATA_DIR = temporaryDirectory;
    const id = "7f1d6a2e-4b7c-4c1e-9a55-2b8f0c1d3e4f";
    await mkdir(path.join(temporaryDirectory, "drafts"), { recursive: true });
    const now = new Date().toISOString();
    await writeFile(path.join(temporaryDirectory, "drafts", `${id}.json`), JSON.stringify({ id, title: "Old", body: "Body", createdAt: now, updatedAt: now }));

    expect(await getDraft(id)).toMatchObject({ title: "Old", messages: [] });
  });
});