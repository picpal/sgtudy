"use client";

import Link from "next/link";
import { TypeBadge } from "@/components/my-study/bits";
import { CODE_CHIP } from "@/components/my-study/model";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { TASK_TYPE_KO } from "@/lib/api/format";
import type { MeTaskItem, MeTaskRound, MeTaskStudy } from "@/lib/api/types";
import { dday, md } from "@/lib/date";
import { routes } from "@/lib/routes";
import { checkMode, isDone, rowState, statusText, type RowTone } from "./calc";
import { studyTone } from "./tone";

export const period = (s: string, e: string) => (s === e ? md(e) : `${md(s)} – ${md(e)}`);

// 완료·늦게·기한 지남 색은 진행목표·보드와 같은 출처(CODE_CHIP)
const TONE_CLS: Record<RowTone, string> = {
  done: CODE_CHIP.D,
  late: CODE_CHIP.L,
  missed: CODE_CHIP.M,
  hot: "bg-warn text-white",
  plain: "bg-line-2 text-ink-2",
};

type Props = {
  item: MeTaskItem;
  study: MeTaskStudy;
  round: MeTaskRound | null;
  today: string;
  /** 마감일 묶기 — 스터디·회차 칩을 붙인다 */
  withRoundChip?: boolean;
  busy: boolean;
  onToggle: (item: MeTaskItem) => void;
};

/** 내 과제 한 줄 — 왼쪽 44px(개인 = 완료 체크 버튼, 팀 = 상태 아이콘), 본문 = 과제 상세 링크 */
export function TaskRow({ item, study, round, today, withRoundChip, busy, onToggle }: Props) {
  const done = isDone(item.st);
  const personal = item.type === "personal";
  const mode = checkMode(study);
  const active = mode === "enabled";
  const tone = studyTone(study.tone);
  const { tone: st, dueHot } = rowState(item, today);
  const hintId = `done-hint-${item.id}`;
  return (
    <li className="flex min-h-14 items-center gap-1 border-t border-line-2 bg-surface pl-[6px] pr-2 max-sm:items-start max-sm:py-1">
      {/* 종료된 방의 개인 목표는 읽기 전용 — 체크 버튼 대신 팀 과제처럼 상태 아이콘만 */}
      {personal && mode !== "hidden" ? (
        <button
          type="button"
          aria-pressed={done}
          aria-label={done ? `${item.title} 완료 취소` : `${item.title} 완료로 표시`}
          title={active ? undefined : "스터디가 진행 중일 때 완료할 수 있어요"}
          // 진행 중이 아닌 방: 포커스는 받되 누를 수 없게(aria-disabled) + 이유를 읽어 준다. busy 는 잠깐이라 disabled
          aria-disabled={!active || undefined}
          aria-describedby={active ? undefined : hintId}
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => {
            if (active) onToggle(item);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] hover:bg-slate-soft disabled:cursor-wait disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-mint"
        >
          {done ? (
            <StatusIcon status={item.st} size={22} label={false} />
          ) : (
            <span aria-hidden="true" className="block h-[22px] w-[22px] rounded-full border-2 border-slate-text bg-surface" />
          )}
          {!active && (
            <span id={hintId} className="sr-only">
              스터디가 진행 중일 때 완료할 수 있어요
            </span>
          )}
        </button>
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center">
          <StatusIcon status={item.st} size={16} label={false} />
        </span>
      )}
      <Link
        href={routes.task(item.slug, item.id)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[10px] px-1 py-2 text-ink hover:text-ink focus-visible:outline-2 focus-visible:outline-mint max-sm:flex-col max-sm:items-start max-sm:gap-1"
      >
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <TypeBadge type={TASK_TYPE_KO[item.type]} />
          <span className="flex min-w-0 flex-col">
            <span className={`text-[14px] font-medium leading-5 ${done ? "text-faint" : ""}`}>{item.title}</span>
            {item.groupTitle && <span className="text-[12px] text-muted">{item.groupTitle}</span>}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] max-sm:gap-x-2">
          {withRoundChip && (
            <span title={study.title} className="inline-flex max-w-[180px] items-center gap-[6px] rounded-[7px] px-2 py-[3px] text-[11px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.dot }} />
              <span className="sr-only">{study.title} </span>
              <span className="truncate">{round ? (round.label ?? round.title) : study.title}</span>
            </span>
          )}
          <span className="whitespace-nowrap text-muted sm:w-[96px]">{period(item.startDate, item.endDate)}</span>
          {/* 완료 행도 넓은 화면에선 D-day 칸 자리를 비워 둬 기간·상태 열이 줄 맞춤된다 */}
          {done ? <span aria-hidden="true" className="max-sm:hidden sm:w-[48px]" /> : <span className={`whitespace-nowrap font-bold sm:w-[48px] sm:text-right ${dueHot ? "text-warn" : "text-ink-2"}`}>{dday(today, item.endDate)}</span>}
          <span className={`whitespace-nowrap rounded-[8px] px-[10px] py-1 text-center font-semibold sm:min-w-[84px] ${TONE_CLS[st]}`}>{statusText(item)}</span>
        </span>
      </Link>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-ghost max-sm:hidden">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </li>
  );
}
