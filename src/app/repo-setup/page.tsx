import { redirect } from "next/navigation";
import { getConfig, isConfigured } from "@/lib/config";
import { RepoSetupPanel } from "./repo-setup-workspace";

export const dynamic = "force-dynamic";

export default async function RepoSetupPage() {
  if (!(await isConfigured())) redirect("/onboarding");
  const config = await getConfig();
  if (!config.targetRepo) redirect("/dashboard");
  return <RepoSetupPanel targetRepo={config.targetRepo} baseBranch={config.baseBranch} />;
}