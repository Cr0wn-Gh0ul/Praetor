import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/config";
import { OnboardingWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  if (await isConfigured()) redirect("/dashboard");
  return <OnboardingWizard />;
}