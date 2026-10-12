import { ProgressBar } from "@/components/ui/ProgressBar";
import type { RoomRound } from "@/data/room-view";

export function ScheduleList({ rounds, moreRounds }: { rounds: RoomRound[]; moreRounds: string }) {
  return (
    <>
      <ol className="flex flex-col gap-2">
        {rounds.map((rd) => {
          const isPre = typeof rd.sub !== "number";
          const pct = isPre ? 0 : Math.round((rd.sub! / rd.total!) * 100);
          return (
            <li
              key={rd.label}
              className={`flex flex-wrap items-center gap-3 rounded-xl border px-[14px] py-3 ${rd.current ? "border-[#9ED9C8] bg-[#F2FBF8]" : "border-line-2 bg-surface"}`}
            >
              <span className="w-16 shrink-0 text-[13px] font-bold">{rd.label}</span>
              <span className="min-w-0 flex-[1_1_180px]">
                <span className="block text-[14px] font-semibold">{rd.title}</span>
                <span className="mt-[2px] block text-[12px] text-muted">
                  {rd.dates} · {isPre ? "예정" : rd.state}
                </span>
              </span>
              <span className="flex w-[140px] items-center gap-2">
                <ProgressBar pct={pct} height={6} fill={pct >= 80 ? "#1E9E6A" : "#12A386"} className="flex-1" />
                <span className="w-[58px] text-right text-[12px] font-semibold">{isPre ? rd.state : `${rd.sub}/${rd.total}`}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {moreRounds && <p className="mt-[10px] text-[13px] text-muted">{moreRounds}</p>}
    </>
  );
}
