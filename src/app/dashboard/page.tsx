import { redirect } from "next/navigation";
import { getConfig, isConfigured } from "@/lib/config";
import { parseIssueStageFilter } from "@/lib/issue-stage";
import { DashboardShell } from "./dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ issue?: string; draft?: string; view?: string; stage?: string }> }) {
  if (!(await isConfigured())) redirect("/onboarding");
  const config = await getConfig();
  const { issue, draft, view, stage } = await searchParams;
  const parsedIssue = issue ? Number(issue) : NaN;
  return <DashboardShell
    initialIssue={Number.isSafeInteger(parsedIssue) && parsedIssue > 0 ? parsedIssue : null}
    initialDraft={draft ?? null}
    initialView={view === "pulls" || view === "actions" ? view : view === "issues" || issue || draft || stage ? "issues" : "home"}
    initialStage={parseIssueStageFilter(stage)}
    initialRepo={config.targetRepo}
    defaultModels={config.models}
  />;
}