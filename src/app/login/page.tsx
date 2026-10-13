import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { getAuthUser } from "@/lib/api/me.server";
import { safeReturnTo } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  if (await getAuthUser()) redirect(dest);
  return <LoginScreen returnTo={dest} />;
}
