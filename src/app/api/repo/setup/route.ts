import { z } from "zod";
import { LEGACY_SETUP_FILES, SETUP_BRANCH, generateSetupFiles, selectMissingStarterIssueTemplates, STARTER_ISSUE_TEMPLATES } from "@/lib/bootstrap";
import { apiError } from "@/lib/api-response";
import { saveConfig } from "@/lib/config";
import { createPullRequest, ensureAgentLabels, readRepoTextFile, replaceBranchWithCommit } from "@/lib/github";
import { getRepositorySetup } from "@/lib/repo-setup";
import { agentConfigFileSchema } from "@/lib/schemas";
import type { AgentConfigFile, FileChange } from "@/lib/types";

const setupRequestSchema = z.object({
  include: z.array(z.string().trim().min(1).max(200)).max(50),
  exclude: z.array(z.string().trim().min(1).max(200)).max(50),
  installCommand: z.string().trim().min(1).max(300),
  testCommand: z.string().trim().min(1).max(300),
  nodeVersion: z.string().regex(/^[0-9]+(?:\.[0-9]+){0,2}$/),
  baseBranch: z.string().trim().min(1).max(200),
}).strict();

export async function GET() {
  try {
    return Response.json(await getRepositorySetup(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return apiError("SETUP_STATUS_FAILED", "Could not read repository setup status.", 502);
  }
}

export async function POST(request: Request) {
  const parsed = setupRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_SETUP", parsed.error.issues[0]?.message ?? "Setup settings are invalid.", 400);
  try {
    const existingConfig = await readRepoTextFile(".github/agent-config.json", parsed.data.baseBranch);
    let contextSources: AgentConfigFile["contextSources"] = [];
    if (existingConfig) {
      try {
        const saved = agentConfigFileSchema.safeParse(JSON.parse(existingConfig));
        if (saved.success) contextSources = saved.data.contextSources;
      } catch {
        contextSources = [];
      }
    }
    const setupFiles = generateSetupFiles({ ...parsed.data, contextSources });
    const starterTemplateStatus = await Promise.all(STARTER_ISSUE_TEMPLATES.map(async ({ path }) => ({ path, exists: (await readRepoTextFile(path, parsed.data.baseBranch)) !== null })));
    const starterTemplates = selectMissingStarterIssueTemplates(starterTemplateStatus.filter((file) => file.exists).map((file) => file.path));
    const changes: FileChange[] = [
      ...setupFiles.map(({ path, content }) => ({ path, action: "create" as const, content })),
      ...starterTemplates.map(({ path, content }) => ({ path, action: "create" as const, content })),
    ];
    const legacy = await Promise.all(LEGACY_SETUP_FILES.map(async (path) => ({ path, exists: (await readRepoTextFile(path, parsed.data.baseBranch)) !== null })));
    changes.push(...legacy.filter((file) => file.exists).map(({ path }) => ({ path, action: "delete" as const })));
    await ensureAgentLabels();
    await replaceBranchWithCommit(SETUP_BRANCH, parsed.data.baseBranch, changes, "chore: set up Praetor agent");
    const body = [
      "This pull request adds or updates the files Praetor uses to run agent work in GitHub Actions.",
      "",
      ...setupFiles.map((file) => `- **${file.path}**: ${file.description}`),
      ...starterTemplates.map((file) => `- **${file.path}**: starter issue template.`),
      ...legacy.filter((file) => file.exists).map((file) => `- **${file.path}**: remove the legacy workflow replaced by the managed Praetor CI workflow.`),
      "",
      "Review the repository folders and CI commands in `.github/agent-config.json` before merging. Agent workflows require the `OPENROUTER_API_KEY` repository secret.",
    ].join("\n");
    const pullRequest = await createPullRequest(SETUP_BRANCH, parsed.data.baseBranch, "chore: set up Praetor", body);
    await saveConfig({ baseBranch: parsed.data.baseBranch });
    return Response.json({ number: pullRequest.number, htmlUrl: pullRequest.html_url }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open the setup pull request.";
    return apiError("SETUP_PR_FAILED", message, 502);
  }
}
