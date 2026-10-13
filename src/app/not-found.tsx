import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { NOT_FOUND_TITLE, routes } from "@/lib/routes";

export const metadata: Metadata = { title: NOT_FOUND_TITLE };

/** 없는 주소·없는 방·초대 없이 연 비공개 방(notFound()) 공통 404 — 앱 헤더와 돌아갈 길을 둔다(Q3-10, Q2-24) */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-bg p-4 text-ink">
      <AppHeader variant="card" bell={<NotificationBell />} />
      <main className="mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center gap-3 rounded-[20px] bg-surface px-6 py-16 text-center">
        <p className="m-0 text-[13px] font-semibold text-muted">404</p>
        <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">페이지를 찾을 수 없어요</h1>
        <p className="m-0 text-[14px] leading-[1.6] text-muted">
          주소가 바뀌었거나 없어진 방일 수 있어요.
          <br />
          비공개 방이라면 그룹장에게 받은 초대 링크로 들어와 주세요.
        </p>
        <Link href={routes.home()} className="mt-3 flex h-11 items-center rounded-[12px] bg-navy px-[18px] text-[14px] font-semibold text-white hover:text-white">
          방 둘러보기
        </Link>
      </main>
    </div>
  );
}
