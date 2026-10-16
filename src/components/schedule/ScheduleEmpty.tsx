import Link from "next/link";
import { HomeLink } from "@/components/ui/HomeLink";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { routes } from "@/lib/routes";

/** 참가·신청한 스터디가 하나도 없을 때 — 빈 달력 대신 안내와 CTA (내 스터디 빈 상태와 같은 모양) */
export function ScheduleEmpty() {
  return (
    <div className="flex min-h-screen flex-col p-4">
      <AppHeader active="schedule" variant="card" bell={<NotificationBell />} />
      <main className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-3 rounded-[20px] border border-dashed border-line-dash bg-surface px-6 py-16 text-center">
        <h1 className="m-0 text-[17px] font-semibold">아직 일정이 있는 스터디가 없어요</h1>
        <p className="m-0 text-[14px] text-muted">스터디에 참가하면 과제 기간과 마감일이 이 달력에 모여요.</p>
        <div className="mt-2 flex gap-2">
          <HomeLink className="flex h-11 items-center rounded-[12px] border border-line-3 bg-surface px-[18px] text-[14px] font-semibold text-ink">방 둘러보기</HomeLink>
          <Link href={routes.createRoom()} className="flex h-11 items-center rounded-[12px] bg-navy px-[18px] text-[14px] font-semibold text-white hover:text-white">방 만들기</Link>
        </div>
      </main>
    </div>
  );
}
