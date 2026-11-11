import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  redirect((await isConfigured()) ? "/dashboard" : "/onboarding");
}
