import { z } from "zod";
import { AGENT_SYSTEM_PROMPT, buildDraftPrompt } from "@/lib/agent/prompt";
import { buildContext, contextSources, getFullFiles, MAX_ATTACHED_FILES, selectAttachableFiles } from "@/lib/agent/context";
import { streamMarkdown, toTextStreamResponse } from "@/lib/agent/llm";
import { apiError } from "@/lib/api-response";
import { getConfig } from "@/lib/config";
import { splitIssueMarkdown } from "@/lib/draft-format";
import { getDraft, recordDraftRevision } from "@/lib/drafts";
import { getIndexMetadata } from "@/lib/indexer";
import { modelIdSchema } from "@/lib/schemas";

const requestSchema = z.object({
  id: z.string().uuid(),
  message: z.string().trim().min(1).max(8_000),
  model: modelIdSchema.optional(),
  useContext: z.boolean().default(true),
  files: z.array(z.string().min(1).max(500)).max(MAX_ATTACHED_FILES).default([]),
}).strict();

type ContextStatus = "used" | "empty" | "disabled" | "not-indexed" | "unavailable";

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_DRAFT_REQUEST", parsed.error.issues[0]?.message ?? "Draft ID and a non-empty message are required.", 400);
  const { id, message, useContext, files } = parsed.data;
  try {
    const draft = await getDraft(id);
    if (!draft) return apiError("DRAFT_NOT_FOUND", "Draft not found.", 404);
    const config = await getConfig();
    if (!config.targetRepo) return apiError("REPOSITORY_REQUIRED", "Select a repository before drafting.", 409);
    const model = parsed.data.model ?? config.models.draft;
    const metadata = await getIndexMetadata(config.targetRepo);

    let attachedFiles: Record<string, string> = {};
    if (files.length) {
      if (!metadata) return apiError("CONTEXT_NOT_INDEXED", "Sync repository context before attaching files.", 409);
      const { accepted, rejected } = selectAttachableFiles(files, metadata.files);
      if (rejected.length) return apiError("INVALID_CONTEXT_FILES", `These files cannot be attached: ${rejected.slice(0, 3).join(", ")}.`, 400);
      attachedFiles = await getFullFiles(accepted);
    }

    let context = "";
    let sources: string[] = [];
    let contextStatus: ContextStatus = useContext ? "empty" : "disabled";
    if (useContext) {
      try {
        const retrieval = await buildContext(`${draft.title}\n${message}`);
        context = retrieval.context;
        sources = contextSources(retrieval.chunks, config.targetRepo);
        if (sources.length) contextStatus = "used";
        else if (!metadata) contextStatus = "not-indexed";
      } catch {
        contextStatus = "unavailable";
      }
    }

    const hadDraft = Boolean(draft.title.trim() || draft.body.trim());
    const result = await streamMarkdown({
      stage: "draft",
      model,
      system: AGENT_SYSTEM_PROMPT,
      prompt: buildDraftPrompt({
        request: message,
        currentTitle: draft.title,
        currentBody: draft.body,
        preserveTemplate: Boolean(draft.templateId),
        previousRequests: draft.messages.filter((item) => item.role === "user").map((item) => item.content).slice(-10),
        context,
        attachedFiles,
      }),
      abortSignal: request.signal,
    });

    const usedFiles = [...new Set([...Object.keys(attachedFiles), ...sources])];
    return toTextStreamResponse(result, {
      abortSignal: request.signal,
      headers: {
        "X-Context-Status": contextStatus,
        "X-Context-Sources": encodeURIComponent(JSON.stringify(usedFiles)),
        "X-Model": model,
      },
      onComplete: async (text) => {
        const parts = splitIssueMarkdown(text);
        const title = parts.title || draft.title;
        await recordDraftRevision(id, {
          title,
          body: parts.body,
          request: message,
          summary: hadDraft ? "Updated the draft." : `Drafted “${title || "Untitled issue"}”.`,
          model,
          sources: usedFiles,
        });
      },
    });
  } catch {
    return apiError("DRAFT_GENERATION_FAILED", "Could not generate an issue draft. Check the model settings and try again.", 503);
  }
}