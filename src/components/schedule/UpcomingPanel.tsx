import Link from "next/link";
import { dday, diffDays, md, weekdayKo } from "@/lib/date";
import { shortName, type Study, type Task } from "@/data/schedule";
import { taskHref } from "./calc";

export function UpcomingPanel({ today, studies, upcoming }: { today: string; studies: Record<string, Study>; upcoming: Task[] }) {
  return (
    <section className="thin-scroll box-border flex min-h-0 flex-[1_1_0] flex-col gap-3 overflow-auto rounded-[20px] bg-surface p-5 max-[900px]:flex-none max-[900px]:overflow-visible">
      <h2 className="m-0 flex items-center gap-2 text-[16px] font-bold">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#B4462B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 21V4M4 4h12l-2 4 2 4H4" />
        </svg>
        다가오는 마감 <span className="text-[12px] font-medium text-muted">7일 이내</span>
      </h2>
      {upcoming.length ? (
        <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
          {upcoming.map((t) => {
            const n = diffDays(today, t.e);
            return (
              <li key={t.id}>
                <Link href={taskHref(t, studies[t.study])} className="flex items-center gap-[10px] rounded-[12px] bg-surface-2 px-3 py-[10px] text-ink hover:bg-[#EEF4F2] hover:text-ink focus-visible:outline-2 focus-visible:outline-mint focus-visible:-outline-offset-2">
                  <span className="w-12 shrink-0 rounded-[8px] py-[5px] text-center text-[12px] font-bold text-white" style={{ background: n <= 2 ? "#B4462B" : "#4A5563" }}>
                    {dday(today, t.e)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{t.title}</span>
                    <span className="mt-[2px] block text-[12px] text-muted">
                      {shortName(studies[t.study])} · {md(t.e)}({weekdayKo(t.e)}) 23:59
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-muted">7일 안에 마감되는 과제가 없어요</p>
      )}
    </section>
  );
}
