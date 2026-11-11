import { redirect } from "next/navigation";
import { getConfig, isConfigured } from "@/lib/config";
import { RepositoryExplorer } from "./repository-explorer";

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
  if (!(await isConfigured())) redirect("/onboarding");
  const config = await getConfig();
  if (!config.targetRepo) redirect("/dashboard");
  return <RepositoryExplorer targetRepo={config.targetRepo} baseBranch={config.baseBranch} />;
}