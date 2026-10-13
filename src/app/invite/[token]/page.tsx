import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { InviteScreen } from "@/components/auth/InviteScreen";
import { toApiError } from "@/lib/api/errors";
import { fetchInvitePreview } from "@/lib/api/invite";
import { routes } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "슥터디 초대" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let preview: Awaited<ReturnType<typeof fetchInvitePreview>>;
  try {
    preview = await fetchInvitePreview(token, await createClient());
  } catch (e) {
    const err = toApiError(e);
    const text = err.code === "INVITE_REVOKED" ? "더 이상 쓸 수 없는 초대 링크예요" : err.code === "INVITE_NOT_FOUND" ? "유효하지 않은 초대 링크예요" : err.message;
    return (
      <AuthShell title="초대 링크를 열 수 없어요" subtitle={text}>
        <Link href={routes.home()} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white hover:text-white">방 둘러보기</Link>
      </AuthShell>
    );
  }
  return <InviteScreen token={token} preview={preview} />;
}
