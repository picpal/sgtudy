// /onboarding 은 proxy 보호 목록 밖이라 여기서 직접 가드한다
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingScreen } from "@/components/auth/OnboardingScreen";
import { getMeOrExpire } from "@/lib/api/me.server";
import { routes, safeReturnTo } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 닉네임 설정" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  const me = await getMeOrExpire(dest);
  if (!me) redirect(routes.login(dest));
  if (me.onboarded) redirect(dest);
  return <OnboardingScreen returnTo={dest} />;
}
