import { redirect } from "next/navigation";
import { getConfig, isConfigured } from "@/lib/config";
import { ContextWorkspace } from "./context-workspace";

export const dynamic = "force-dynamic";

export default async function ContextPage() {
  if (!(await isConfigured())) redirect("/onboarding");
  const config = await getConfig();
  if (!config.targetRepo) redirect("/dashboard");
  return <ContextWorkspace targetRepo={config.targetRepo} baseBranch={config.baseBranch} initialPaths={config.additionalContextPaths} />;
}