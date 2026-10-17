import Link from "next/link";
import { HomeLink } from "@/components/ui/HomeLink";
import { routes } from "@/lib/routes";

const box = "flex flex-col items-center gap-[10px] rounded-[16px] border border-dashed border-line-dash px-5 py-10 text-center";
const btn = "flex h-11 items-center rounded-[12px] px-[18px] text-[14px] font-semibold";

/** 빈 상태 3종 (스펙 §6): 스터디 없음 · 이번 회차 비었음 · 필터로 비었음 */
export function TasksEmpty({ kind, onAdd, onClear }: { kind: "noStudy" | "noTasks" | "filtered"; onAdd?: () => void; onClear?: () => void }) {
  if (kind === "noStudy")
    return (
      <div className={box}>
        <p className="m-0 text-[16px] font-semibold">참여 중인 스터디가 없어요</p>
        <p className="m-0 text-[13px] text-muted">스터디에 참가하거나 직접 만들면 내 팀 과제와 개인 목표가 여기에 모여요.</p>
        {/* 내 스터디·내 일정 빈 상태와 같은 두 갈래 (QA Q3-9) */}
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <HomeLink className={`${btn} border border-line-3 bg-surface text-ink`}>방 둘러보기</HomeLink>
          <Link href={routes.createRoom()} className={`${btn} bg-navy text-white hover:text-white`}>
            방 만들기
          </Link>
        </div>
      </div>
    );
  if (kind === "noTasks")
    return (
      <div className={box}>
        <p className="m-0 text-[16px] font-semibold">이번 회차에 맡은 과제가 없어요</p>
        <p className="m-0 text-[13px] text-muted">스스로 목표를 세워 보세요</p>
        {onAdd && (
          <button type="button" onClick={onAdd} className={`${btn} mt-1 bg-navy text-white`}>
            ＋ 내 목표 추가
          </button>
        )}
      </div>
    );
  return (
    <div className={box}>
      <p className="m-0 text-[16px] font-semibold">조건에 맞는 과제가 없어요</p>
      <button type="button" onClick={onClear} className={`${btn} mt-1 border border-line-3 bg-surface text-ink`}>
        필터 지우기
      </button>
    </div>
  );
}
