import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resumeVerified } from "@/components/auth/flow";
import { OtpPasswordFlow } from "@/components/auth/OtpPasswordFlow";
import { getAuthUser } from "@/lib/api/me.server";
import { safeReturnTo } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 회원가입" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  const user = await getAuthUser();
  if (user) {
    // 코드 확인 뒤 비밀번호를 정하기 전에 떠났다면 비밀번호 단계로 다시 보낸다(이미 있으면 returnTo 로)
    const verified = resumeVerified(user, "signup");
    if (!verified || !user.email) redirect(dest);
    return <OtpPasswordFlow mode="signup" returnTo={dest} resume={{ email: user.email, verified }} />;
  }
  return <OtpPasswordFlow mode="signup" returnTo={dest} />;
}
