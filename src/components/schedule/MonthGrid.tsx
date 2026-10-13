import Link from "next/link";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { md, WEEKDAY_KO, weekdayKo } from "@/lib/date";
import { routes } from "@/lib/routes";
import { STATUS_LABEL } from "@/lib/types";
import type { Marker, Study, Task } from "@/data/schedule";
import { monthWeeks, packWeek, type Seg } from "./calc";

type Props = {
  y: number;
  m: number;
  sel: string;
  today: string;
  studies: Record<string, Study>;
  tasks: Task[];
  markers: Marker[];
  onPick: (k: string) => void;
};

const dayColor = (i: number) => (i === 0 ? "#C0453A" : i === 6 ? "#2F5BC2" : "#4A5563");

export function MonthGrid({ y, m, sel, today, studies, tasks, markers, onPick }: Props) {
  const weeks = monthWeeks(y, m);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-line">
      <div className="grid grid-cols-7 border-b border-line bg-surface-2">
        {WEEKDAY_KO.map((wd, i) => (
          <div key={wd} className="p-[10px] text-[12px] font-semibold max-sm:px-1" style={{ color: dayColor(i) }}>
            {wd}
          </div>
        ))}
      </div>
      <div className="thin-scroll grid min-h-0 flex-1 overflow-auto" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(96px, 1fr))` }}>
        {weeks.map((days) => (
          <WeekRow key={days[0]} days={days} m={m} sel={sel} today={today} studies={studies} tasks={tasks} markers={markers} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

type WeekProps = Omit<Props, "y"> & { days: string[] };

function WeekRow({ days, m, sel, today, studies, tasks, markers, onPick }: WeekProps) {
  const segs = packWeek(tasks, days[0]);
  return (
    <div className="relative min-h-[96px] border-b border-line-2">
      {/* 레이어 A: 날짜 셀 */}
      <div className="absolute inset-0 grid grid-cols-7">
        {days.map((k, c) => {
          const inMonth = Number(k.slice(5, 7)) - 1 === m;
          const isToday = k === today;
          const isSel = k === sel;
          const past = k < today;
          const mks = markers.filter((mk) => mk.date === k);
          const due = tasks.filter((t) => t.e === k).length;
          const num = Number(k.slice(8, 10));
          const aria = `${Number(k.slice(5, 7))}월 ${num}일 ${weekdayKo(k)}요일${due ? `, 마감 ${due}개` : ""}${mks.length ? `, 회차 시작 ${mks.length}개` : ""}`;
          const color = isToday ? "#FFFFFF" : !inMonth ? "#A7B0BA" : c === 0 ? "#C0453A" : c === 6 ? "#2F5BC2" : past ? "#7A8594" : "#1B2230";
          return (
            <button
              key={k}
              type="button"
              aria-label={aria}
              aria-pressed={isSel}
              onClick={() => onPick(k)}
              className={`flex min-w-0 flex-col items-stretch px-2 py-[6px] text-left hover:bg-[#F6FAF9] focus-visible:outline-2 focus-visible:outline-mint focus-visible:-outline-offset-2 max-sm:px-1 ${
                c < 6 ? "border-r border-line-2" : ""
              }`}
              style={{ background: isSel ? "#F0F9F6" : inMonth ? "#FFFFFF" : "#FAFBFB", boxShadow: isSel ? "inset 0 0 0 2px #5FC8B0" : "none" }}
            >
              <span className="flex w-full items-center justify-between gap-1">
                <span
                  className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[13px]"
                  style={{ fontWeight: isToday ? 700 : 500, background: isToday ? "#1B2230" : "transparent", color }}
                >
                  {num}
                </span>
                <span className="flex min-w-0 items-center gap-[3px]">
                  {mks.map((mk) => (
                    <span
                      key={mk.study}
                      title={`${studies[mk.study].name} ${mk.round} 시작`}
                      className="whitespace-nowrap rounded-[5px] px-[5px] py-px text-[10px] font-bold text-white"
                      style={{ background: studies[mk.study].dot }}
                    >
                      {mk.round.replace("주차", "주")}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {/* 레이어 B: 과제 막대 */}
      <div className="pointer-events-none relative grid grid-cols-7 auto-rows-[24px] gap-y-1 pt-9 pb-[10px]">
        {segs.map((sg) => (
          <TaskBar key={sg.task.id} seg={sg} studies={studies} />
        ))}
      </div>
    </div>
  );
}

function TaskBar({ seg: { task: t, col, span, isStart, isEnd, lane }, studies }: { seg: Seg; studies: Record<string, Study> }) {
  const S = studies[t.study];
  const planned = t.st === "planned";
  const finished = t.st === "done" || t.st === "late";
  const fill = S.pending ? `repeating-linear-gradient(135deg, ${S.bg} 0 6px, #FFFFFF 6px 10px)` : planned ? "#FFFFFF" : S.bg;
  const line = S.pending ? `1px solid ${S.dot}` : planned ? `1px dashed ${S.dot}` : t.st === "open" ? `1.5px solid ${S.dot}` : "1px solid transparent";
  const lr = isStart ? 7 : 0;
  const rr = isEnd ? 7 : 0;
  return (
    <Link
      href={S.pending ? routes.room(t.study) : routes.myStudy(t.study)}
      title={`${S.name} · ${t.round} · ${t.title} (${md(t.s)}–${md(t.e)}) · ${STATUS_LABEL[t.st]}`}
      className="pointer-events-auto relative box-border flex min-w-0 items-center gap-1 pl-2 pr-[6px] text-[12px] transition-[box-shadow,transform] duration-[120ms] hover:z-[2] hover:-translate-y-px hover:shadow-[0_3px_8px_rgba(27,34,48,.18)] focus-visible:z-[2] focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-1"
      style={{
        gridColumn: `${col + 1} / span ${span}`,
        gridRow: lane + 1,
        margin: `0 ${isEnd ? 5 : 0}px 0 ${isStart ? 5 : 0}px`,
        borderRadius: `${lr}px ${rr}px ${rr}px ${lr}px`,
        fontWeight: t.st === "open" ? 700 : 500,
        color: S.fg,
        background: fill,
        border: line,
        opacity: finished ? 0.72 : 1,
      }}
    >
      <span className="min-w-0 flex-1 truncate">{isStart || col === 0 ? t.title : `${t.title} (계속)`}</span>
      {isEnd && t.mine !== false && (
        <span className="flex shrink-0">
          <StatusIcon status={t.st} size={14} />
        </span>
      )}
    </Link>
  );
}
