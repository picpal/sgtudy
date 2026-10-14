import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OtpPasswordFlow } from "@/components/auth/OtpPasswordFlow";
import { getAuthUser } from "@/lib/api/me.server";
import { safeReturnTo } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 비밀번호 재설정" };

// 로그인한 상태의 비밀번호 변경은 /me 에서 한다
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  if (await getAuthUser()) redirect(dest);
  return <OtpPasswordFlow mode="reset" returnTo={dest} />;
}
