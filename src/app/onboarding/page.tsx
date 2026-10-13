// /onboarding 은 proxy 보호 목록 밖이라 여기서 직접 가드한다
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingScreen } from "@/components/auth/OnboardingScreen";
import { rpc } from "@/lib/api/errors";
import type { Me } from "@/lib/api/types";
import { routes, safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "슥터디 닉네임 설정" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect(routes.login(dest));
  const me = await rpc<Me>("me_get", {}, client);
  if (me.onboarded) redirect(dest);
  return <OnboardingScreen returnTo={dest} />;
}
