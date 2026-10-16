import Link from "next/link";
import { addDays, dday, md, weekdayKo } from "@/lib/date";
import { STATUS_LABEL } from "@/lib/types";
import { shortName, type Study, type Task } from "@/data/schedule";
import { TypeBadge } from "@/components/my-study/bits";
import { isUrgent, monthRange, taskHref, weekStartOf } from "./calc";

type Props = { y: number; m: number; today: string; studies: Record<string, Study>; tasks: Task[] };

export function ListView({ y, m, today, studies, tasks }: Props) {
  const { start, end } = monthRange(y, m);
  const groups = new Map<string, Task[]>();
  for (const t of tasks.filter((t) => t.e >= start && t.e <= end).sort((a, b) => a.e.localeCompare(b.e))) {
    const ws = weekStartOf(t.e);
    groups.set(ws, [...(groups.get(ws) ?? []), t]);
  }
  const keys = [...groups.keys()].sort();

  return (
    // 한 페이지 스크롤 — 목록은 내용만큼 자라고, 주 제목은 페이지 스크롤에 붙는다(overflow-clip 은 sticky 를 막지 않는다)
    <div className="box-border flex flex-col overflow-clip rounded-[16px] border border-line bg-surface py-5 pr-[6px]">
      <div className="pr-4 pb-4 pl-5 max-sm:pl-3 max-sm:pr-1">
        <div className="flex flex-col gap-7">
          {keys.map((ws) => {
            const we = addDays(ws, 6);
            const isNow = today >= ws && today <= we;
            return (
              <section key={ws}>
                <h2 className="sticky -top-px z-[2] m-0 flex items-center gap-2 bg-surface pt-1 pb-3 text-[13px] font-semibold text-ink-3 shadow-[0_-4px_0_#FFF,0_6px_8px_-6px_rgba(27,34,48,.10)]">
                  {md(ws)} – {md(we)}
                  {isNow && <span className="rounded-[6px] bg-ink px-[7px] py-[2px] text-[11px] font-bold text-white">이번 주</span>}
                </h2>
                <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
                  {groups.get(ws)!.map((t) => {
                    const S = studies[t.study];
                    const urgent = isUrgent(t);
                    return (
                      <li key={t.id}>
                        {/* 월 막대·일 패널·다가오는 마감처럼 과제로 바로 간다 (V2-04) */}
                        <Link
                          href={taskHref(t, S)}
                          className="flex flex-wrap items-center gap-4 rounded-[14px] border border-line bg-surface px-[18px] py-4 text-ink transition-[border-color,box-shadow] duration-150 hover:border-line-dash hover:text-ink hover:shadow-[0_4px_12px_rgba(27,34,48,.06)]"
                        >
                          <span className="w-[92px] shrink-0 text-[13px] font-semibold">
                            {md(t.e)}({weekdayKo(t.e)})
                          </span>
                          <span className="shrink-0 rounded-[7px] px-2 py-[3px] text-[11px] font-bold" style={{ background: S.bg, color: S.fg }}>
                            {shortName(S)}
                          </span>
                          <span className="min-w-0 flex-[1_1_200px]">
                            <span className="flex items-center gap-[6px] text-[14px] font-semibold">
                              {t.personal && <TypeBadge type="개인" />}
                              {t.title}
                            </span>
                            <span className="mt-[2px] block text-[12px] text-muted">
                              {t.round} · {md(t.s)}–{md(t.e)}
                            </span>
                          </span>
                          <span
                            className="shrink-0 rounded-[8px] px-[10px] py-1 text-[12px] font-semibold"
                            style={{ color: urgent ? "#FFFFFF" : "#3A4452", background: urgent ? "#B4462B" : "#EEF2F1" }}
                          >
                            {urgent ? `${STATUS_LABEL[t.st]} · ${dday(today, t.e)}` : STATUS_LABEL[t.st]}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {keys.length === 0 && <p className="my-6 text-center text-[14px] text-muted">이 달에는 표시할 과제가 없어요</p>}
        </div>
      </div>
    </div>
  );
}
