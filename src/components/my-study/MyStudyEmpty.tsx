import Link from "next/link";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { routes } from "@/lib/routes";

export function MyStudyEmpty() {
  return (
    <div className="flex min-h-screen flex-col p-4">
      <AppHeader active="myStudy" variant="card" bell={<NotificationBell />} />
      <main className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-3 rounded-[20px] border border-dashed border-line-dash bg-surface px-6 py-16 text-center">
        <p className="m-0 text-[17px] font-semibold">아직 참가한 스터디가 없어요</p>
        <p className="m-0 text-[14px] text-muted">둘러보기에서 마음에 드는 방에 참가하거나 직접 만들어 보세요.</p>
        <div className="mt-2 flex gap-2">
          <Link href={routes.home()} className="flex h-11 items-center rounded-[12px] border border-line-3 bg-surface px-[18px] text-[14px] font-semibold text-ink">방 둘러보기</Link>
          <Link href={routes.createRoom()} className="flex h-11 items-center rounded-[12px] bg-navy px-[18px] text-[14px] font-semibold text-white hover:text-white">방 만들기</Link>
        </div>
      </main>
    </div>
  );
}
