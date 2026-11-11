import { redirect } from "next/navigation";
import { getPublicConfig, isConfigured } from "@/lib/config";
import { SettingsWorkspace } from "./settings-workspace";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isConfigured())) redirect("/onboarding");
  return <SettingsWorkspace config={await getPublicConfig()} />;
}