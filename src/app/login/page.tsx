import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "슥터디 로그인" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const dest = safeReturnTo(returnTo);
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (user) redirect(dest);
  return <LoginScreen returnTo={dest} />;
}
