import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { getAuthClaims, getMeOrExpire } from "@/lib/api/me.server";
import { safeReturnTo } from "@/lib/routes";
import { parseLoginReason } from "@/lib/supabase/return-to";

export const metadata: Metadata = { title: "슥터디 로그인" };

type Search = { returnTo?: string | string[]; reason?: string | string[] };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { returnTo, reason } = await searchParams;
  const dest = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  if (await getAuthClaims()) {
    // 고아 세션(계정 삭제 후 남은 쿠키)이면 dest ↔ /login 을 오가지 않게 세션 정리 라우트로 먼저 보낸다
    await getMeOrExpire(dest);
    redirect(dest);
  }
  return <LoginScreen returnTo={dest} reason={parseLoginReason(reason)} />;
}
