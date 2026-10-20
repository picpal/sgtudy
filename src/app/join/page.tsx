import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { JoinCodeForm } from "@/components/auth/JoinCodeForm";
import { requireMe } from "@/lib/api/me.server";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "초대 코드로 참가" };

/** 초대 코드 입력 (0032, D10) — 로그인 필수. 맞으면 /invite/{token} 랜딩으로 넘긴다(미리보기·CTA 는 랜딩 한 곳) */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const sp = await searchParams;
  const code = Array.isArray(sp.code) ? sp.code[0] : sp.code;
  await requireMe(code ? routes.join(code) : routes.join());
  return (
    <AuthShell title="초대 코드로 참가" subtitle="그룹장에게 받은 8자리 코드를 넣어 주세요">
      <JoinCodeForm initial={code ?? ""} />
    </AuthShell>
  );
}
