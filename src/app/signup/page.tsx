import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OtpPasswordFlow } from "@/components/auth/OtpPasswordFlow";
import { getAuthUser } from "@/lib/api/me.server";
import { safeReturnTo } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 회원가입" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  if (await getAuthUser()) redirect(dest);
  return <OtpPasswordFlow mode="signup" returnTo={dest} />;
}
