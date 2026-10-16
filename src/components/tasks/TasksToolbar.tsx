"use client";

import type { ReactNode } from "react";
import { STUDY_TONE } from "@/lib/api/schedule";
import type { MeTaskStudy } from "@/lib/api/types";
import type { TasksFilter } from "./calc";

const focus = "focus-visible:outline-2 focus-visible:outline-mint focus-visible:outline-offset-2";

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-[12px] bg-bg p-[3px]">
      {options.map(([id, text]) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(id)}
            className={`h-[34px] whitespace-nowrap rounded-[9px] px-3 text-[13px] max-sm:h-[38px] ${focus} ${on ? "bg-surface font-semibold text-ink shadow-[0_1px_3px_rgba(27,34,48,.12)]" : "bg-transparent font-medium text-muted"}`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** 필터 칩 — 390 에서는 44px 높이 */
function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`inline-flex h-[34px] max-w-full items-center gap-[6px] rounded-[17px] border px-3 text-[13px] max-sm:h-11 max-sm:rounded-[22px] ${focus} ${
        on ? "border-ink bg-ink font-semibold text-white" : "border-line-3 bg-surface font-medium text-ink-3"
      }`}
    >
      {children}
    </button>
  );
}

const TYPES: [TasksFilter["type"], string, string][] = [
  ["all", "전체 유형", "전체"],
  ["team", "팀 과제", "팀 과제"],
  ["personal", "개인 목표", "개인"],
];

/** 기간 · 묶기 · 유형 · 완료 숨기기 · 스터디 */
export function TasksToolbar({ filter, studies, onChange }: { filter: TasksFilter; studies: MeTaskStudy[]; onChange: (f: TasksFilter) => void }) {
  const set = (p: Partial<TasksFilter>) => onChange({ ...filter, ...p });
  return (
    <div className="flex flex-col gap-[10px] rounded-[16px] bg-surface-2 px-4 py-3 max-sm:px-2">
      <div className="flex flex-wrap items-center gap-x-[14px] gap-y-2 max-sm:gap-x-2">
        <Seg
          label="기간"
          value={filter.scope}
          options={[
            ["current", "이번 회차"],
            ["all", "전체"],
          ]}
          onChange={(scope) => set({ scope })}
        />
        <span className="inline-flex items-center gap-2 max-sm:hidden">
          <span className="text-[13px] font-semibold text-ink-3">묶기</span>
          <Seg
            label="묶기"
            value={filter.group}
            options={[
              ["round", "회차"],
              ["due", "마감일"],
            ]}
            onChange={(group) => set({ group })}
          />
        </span>
        {/* 390: 묶기는 select 하나 (스펙 §4.2) */}
        <label className="inline-flex min-h-11 items-center gap-[6px] rounded-[12px] border border-line-3 bg-surface px-3 text-[13px] font-medium text-ink-2 sm:hidden">
          묶기
          <select value={filter.group} onChange={(e) => set({ group: e.target.value as TasksFilter["group"] })} className="border-0 bg-transparent text-[13px] font-semibold text-ink">
            <option value="round">회차</option>
            <option value="due">마감일</option>
          </select>
        </label>
        <div role="group" aria-label="유형" className="flex flex-wrap gap-[6px]">
          {TYPES.map(([id, long, short]) => (
            <Chip key={id} on={filter.type === id} onClick={() => set({ type: id })}>
              <span className="max-sm:hidden">{long}</span>
              <span className="sm:hidden">{short}</span>
            </Chip>
          ))}
        </div>
        <span className="flex-[1_1_10px] max-sm:hidden" />
        <label className="inline-flex min-h-11 items-center gap-2 px-1 text-[13px] text-ink-2">
          <input type="checkbox" checked={filter.hideDone} onChange={(e) => set({ hideDone: e.target.checked })} className="m-0 h-[18px] w-[18px] accent-mint" />
          완료 숨기기
        </label>
      </div>
      {studies.length > 1 && (
        <div role="group" aria-label="스터디" className="flex flex-wrap items-center gap-[6px]">
          <span className="mr-1 text-[13px] font-semibold text-ink-3 max-sm:hidden">스터디</span>
          <Chip on={filter.study === "all"} onClick={() => set({ study: "all" })}>
            전체
          </Chip>
          {studies.map((s) => (
            <Chip key={s.slug} on={filter.study === s.slug} title={s.title} onClick={() => set({ study: s.slug })}>
              <span aria-hidden="true" className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ background: (STUDY_TONE[s.tone] ?? STUDY_TONE.mint).dot }} />
              <span className="truncate max-sm:max-w-[140px]">{s.title}</span>
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
