"use client";

import { useEffect, useRef, useState } from "react";
import { roundStatus } from "@/components/my-study/model";
import { normalizeTitle, shouldSubmitQuickAdd } from "@/components/my-study/rounds";
import type { MeTaskItem } from "@/lib/api/types";
import { md, weekdayKo } from "@/lib/date";
import type { RoundGroup } from "./calc";
import { TaskRow } from "./TaskRow";

const mdw = (s: string) => `${md(s)}(${weekdayKo(s)})`;

/**
 * 회차 끝 빠른 추가 — my-study QuickAdd 와 같은 IME(shouldSubmitQuickAdd)·Esc·빈 입력 blur 닫힘 규칙.
 * 개인 목표는 낙관적 임시 행 없이 응답을 기다린다(스펙 §7: 서버 한도·기간 오류를 바로 보여 주려고) → 입력 aria-busy.
 * QuickAdd 자체는 ParentNode·"과제" 문구에 묶여 있어(문구 prop 은 Task 8 범위) 같은 규칙으로 따로 둔다.
 */
function PersonalQuickAdd({ label, onAdd, onClose }: { label: string; onAdd: (title: string) => Promise<boolean>; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState("");
  useEffect(() => input.current?.focus(), []);
  const submit = async () => {
    const t = normalizeTitle(text);
    if (!t || busy) return;
    setBusy(true);
    const ok = await onAdd(t);
    setBusy(false);
    if (ok) {
      setText("");
      setLast(t);
    }
    input.current?.focus();
  };
  return (
    <li className="flex min-h-12 items-center border-t border-line-2 bg-surface-2 px-3 py-1">
      <input
        ref={input}
        type="text"
        value={text}
        maxLength={80}
        aria-busy={busy}
        readOnly={busy}
        aria-label={`${label}에 추가할 내 목표 제목`}
        placeholder="내 목표 제목을 쓰고 Enter · Esc 닫기"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (shouldSubmitQuickAdd({ key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
            e.preventDefault();
            void submit();
          }
        }}
        onBlur={() => {
          if (!text.trim() && !busy) onClose();
        }}
        className="h-11 min-w-0 flex-1 rounded-[10px] border-[1.5px] border-[#4F6382] bg-surface px-3 text-[14px] text-ink"
      />
      <span role="status" className="sr-only">
        {last ? `추가했어요: ${last}` : ""}
      </span>
    </li>
  );
}

type Props = {
  group: RoundGroup;
  today: string;
  perRound: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  busyIds: ReadonlySet<string>;
  onToggleDone: (item: MeTaskItem) => void;
  /** 이 회차 끝 빠른 추가가 열려 있는지 */
  adding: boolean;
  onOpenAdd: () => void;
  onCloseAdd: () => void;
  onAdd: (title: string) => Promise<boolean>;
};

/** 회차 묶음 카드 — 머리(회차 라벨·제목·기간·상태·x/y 완료, 접기) + 행 + 끝 줄(＋ 내 목표 추가 / 한도 안내) */
export function RoundGroupCard({ group, today, perRound, collapsed, onToggleCollapsed, busyIds, onToggleDone, adding, onOpenAdd, onCloseAdd, onAdd }: Props) {
  const { study, round, items, done, canAdd } = group;
  const label = round ? [round.label, round.title].filter(Boolean).join(" ") : "회차 밖";
  // 한도 안내는 "추가할 수 있는 방·회차인데 개수만 찼을 때"만 — 종료·DRAFT 방이나 막힌 회차는 끝 줄을 그리지 않는다
  const atLimit = !!round && round.canAdd && study.canAddPersonal && !canAdd;
  const bodyId = `round-${study.slug}-${round?.id ?? "none"}`;
  return (
    <div className="overflow-hidden rounded-[16px] border border-line">
      <div className="flex items-center gap-2 bg-surface-3 py-[6px] pl-[14px] pr-[6px] sm:pl-[18px]">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[10px] gap-y-1 py-[6px] max-sm:flex-col max-sm:items-start">
          <span className="flex min-w-0 items-center gap-2">
            {round?.label && <span className="shrink-0 rounded-[7px] bg-navy px-2 py-[3px] text-[12px] font-bold text-white">{round.label}</span>}
            <span className="text-[15px] font-bold">{round ? round.title : "회차 밖"}</span>
          </span>
          {round && (
            <span className="text-[12px] text-muted">
              <span className="max-sm:hidden">{`${mdw(round.startDate)} – ${mdw(round.endDate)}`}</span>
              <span className="sm:hidden">{`${md(round.startDate)} – ${md(round.endDate)}`}</span>
              {` · ${roundStatus({ s: round.startDate, e: round.endDate }, today)}`}
              <span className="sm:hidden">{` · ${done}/${items.length} 완료`}</span>
            </span>
          )}
        </div>
        <span className="shrink-0 text-[12px] font-bold text-ink-2 max-sm:hidden">
          {done}/{items.length} 완료
        </span>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={`${label} ${collapsed ? "펼치기" : "접기"}`}
          onClick={onToggleCollapsed}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-muted hover:bg-line-2 focus-visible:outline-2 focus-visible:outline-mint"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={collapsed ? "" : "rotate-180"}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      {!collapsed && (
        <ul id={bodyId} aria-label={label} className="m-0 list-none p-0">
          {items.length === 0 && <li className="border-t border-line-2 px-[18px] py-3 text-[13px] text-muted">이 회차에 내 항목이 없어요</li>}
          {items.map((it) => (
            <TaskRow key={it.id} item={it} study={study} round={round} today={today} busy={busyIds.has(it.id)} onToggle={onToggleDone} />
          ))}
          {canAdd &&
            (adding ? (
              <PersonalQuickAdd label={label} onAdd={onAdd} onClose={onCloseAdd} />
            ) : (
              <li className="border-t border-line-2">
                <button
                  type="button"
                  data-add-personal={round?.id}
                  onClick={onOpenAdd}
                  aria-label={`${label}에 내 목표 추가`}
                  className="flex min-h-12 w-full items-center gap-2 bg-surface px-[18px] text-left text-[13px] font-semibold text-[#3D4F6B] hover:bg-[#F6F8FB] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-mint"
                >
                  ＋ 내 목표 추가
                </button>
              </li>
            ))}
          {atLimit && <li className="border-t border-line-2 bg-[#F7F9FC] px-[18px] py-[14px] text-[13px] text-muted">이 회차에는 개인 목표를 {perRound}개까지 둘 수 있어요</li>}
        </ul>
      )}
    </div>
  );
}
