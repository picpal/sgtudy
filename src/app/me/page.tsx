import type { Metadata } from "next";
import { ProfileScreen } from "@/components/auth/ProfileScreen";
import { requireMe } from "@/lib/api/me.server";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "슥터디 내 프로필" };

export default async function MePage() {
  const me = await requireMe(routes.me());
  return <ProfileScreen me={me} />;
}
