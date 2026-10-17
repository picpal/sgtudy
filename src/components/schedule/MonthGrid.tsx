import Link from "next/link";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { md, WEEKDAY_KO, weekdayKo } from "@/lib/date";
import type { Marker, Study, Task } from "@/data/schedule";
import { barLook, monthWeeks, packWeek, statusLabel, taskHref, type Seg } from "./calc";

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
    // overflow-clip: 둥근 모서리만 자르고 스크롤 영역은 만들지 않는다(한 페이지 스크롤)
    <div className="flex flex-col overflow-clip rounded-[16px] border border-line">
      <div className="grid grid-cols-7 border-b border-line bg-surface-2">
        {WEEKDAY_KO.map((wd, i) => (
          <div key={wd} className="p-[10px] text-[12px] font-semibold max-sm:px-1" style={{ color: dayColor(i) }}>
            {wd}
          </div>
        ))}
      </div>
      {/* 주 행은 최소 높이를 갖되 레인이 많으면 막대 높이만큼 늘어난다 — 다음 주 행 밑으로 숨지 않게 (schedule §1-5). 달력은 내용만큼 자라고 페이지가 스크롤된다 */}
      <div className="flex flex-col">
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
    <div data-week={days[0]} className="relative min-h-[96px] flex-[1_0_auto] border-b border-line-2 min-[901px]:min-h-[112px]">
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
            // 칸 = 래퍼(배경·선택 테두리·막대 아래 빈 곳 클릭) + 머리 줄 버튼(36px). 버튼이 칸 전체를 덮으면 그 위의 과제 막대가 가운데를 가로채
            // 날짜 버튼을 직접 누를 수 없다(Q1-7) — 버튼은 막대가 시작하는 pt-9(36px) 위에만 둔다. 빈 곳 클릭은 래퍼가 받고, 키보드·스크린리더는 버튼이 맡는다
            <div
              key={k}
              data-day-cell={k}
              onClick={() => onPick(k)}
              className={`flex min-w-0 flex-col items-stretch hover:bg-[#F6FAF9] ${c < 6 ? "border-r border-line-2" : ""}`}
              style={{ background: isSel ? "#F0F9F6" : inMonth ? "#FFFFFF" : "#FAFBFB", boxShadow: isSel ? "inset 0 0 0 2px #5FC8B0" : "none" }}
            >
              <button
                type="button"
                aria-label={aria}
                aria-pressed={isSel}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(k);
                }}
                className="flex h-9 w-full min-w-0 shrink-0 flex-col items-stretch bg-transparent px-2 pt-[5px] text-left focus-visible:outline-2 focus-visible:outline-mint focus-visible:-outline-offset-2 max-sm:px-1"
              >
                <span className="flex w-full items-center justify-between gap-1 max-sm:gap-[2px]">
                  <span
                    className="inline-flex h-[26px] w-[26px] shrink-0 max-sm:h-6 max-sm:w-6 items-center justify-center rounded-full text-[13px]"
                    style={{ fontWeight: isToday ? 700 : 500, background: isToday ? "#1B2230" : "transparent", color }}
                  >
                    {num}
                  </span>
                  {/* 좁은 칸(max-sm)에서는 글자 배지 대신 점 — 날짜 숫자·칸 경계와 부딪히지 않게 (회차는 aria-label·일 패널에 있다) */}
                  <span className="flex min-w-0 items-center gap-[3px] max-sm:gap-[2px]">
                    {mks.map((mk) => (
                      <span
                        key={mk.study}
                        title={`${studies[mk.study].name} ${mk.round} 시작`}
                        className="whitespace-nowrap rounded-[5px] px-[5px] py-px text-[10px] font-bold text-white max-sm:h-[7px] max-sm:w-[7px] max-sm:shrink-0 max-sm:rounded-full max-sm:p-0 max-sm:text-[0px] max-sm:leading-none"
                        style={{ background: studies[mk.study].dot }}
                      >
                        {mk.round.replace("주차", "주")}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            </div>
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
  const finished = t.st === "done" || t.st === "late";
  const look = barLook(t, S);
  const lr = isStart ? 7 : 0;
  const rr = isEnd ? 7 : 0;
  return (
    <Link
      href={taskHref(t, S)}
      data-task={t.id}
      title={`${t.personal ? "[개인] " : ""}${S.name} · ${t.round} · ${t.title} (${md(t.s)}–${md(t.e)}) · ${statusLabel(t)}`}
      className="pointer-events-auto relative box-border max-sm:pointer-events-none flex min-w-0 items-center gap-1 pl-2 pr-[6px] text-[12px] transition-[box-shadow,transform] duration-[120ms] hover:z-[2] hover:-translate-y-px hover:shadow-[0_3px_8px_rgba(27,34,48,.18)] focus-visible:z-[2] focus-visible:outline-2 focus-visible:outline-ink focus-visible:outline-offset-1"
      style={{
        gridColumn: `${col + 1} / span ${span}`,
        gridRow: lane + 1,
        margin: `0 ${isEnd ? 5 : 0}px 0 ${isStart ? 5 : 0}px`,
        borderRadius: `${lr}px ${rr}px ${rr}px ${lr}px`,
        fontWeight: look.weight,
        color: look.color,
        background: look.fill,
        border: look.line,
        opacity: finished ? 0.72 : 1,
      }}
    >
      {/* [개인] 미니 배지 — 시작 조각에만, 390 에선 막대가 좁아 점선·색으로만 구분 */}
      {!isStart && (
        <span data-cont="prev" aria-hidden="true" className="-ml-1 shrink-0 text-[12px] font-bold leading-none opacity-60">
          ‹
        </span>
      )}
      {look.badge && span > 1 && (isStart || col === 0) && (
        <span className="shrink-0 rounded-[5px] bg-slate-soft px-[5px] text-[10px] font-bold leading-4 text-personal-ink max-sm:hidden">
          개인
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{isStart || col === 0 ? t.title : `${t.title} (계속)`}</span>
      {!isEnd && (
        <span data-cont="next" aria-hidden="true" className="-mr-1 shrink-0 text-[12px] font-bold leading-none opacity-60">
          ›
        </span>
      )}
      {isEnd && t.mine !== false && (
        <span className="flex shrink-0">
          <StatusIcon status={t.st} size={14} />
        </span>
      )}
    </Link>
  );
}
