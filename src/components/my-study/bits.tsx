"use client";

import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { PAL, PERSONAL_LOOK, toneOf } from "@/lib/palette";
import type { TaskStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";
import type { TaskType } from "@/data/my-study";
import { CODE_LABEL, CODE_STATUS, type Code, type Person } from "./model";

export const toneOfName = toneOf;

/**
 * 누르는 영역 44px — 보이는 크기는 그대로 두고 가상 요소로만 키운다.
 * HIT_Y: 너비는 그대로, 세로 44px(가로로 이웃과 나란한 칩·세그). HIT_SQ: 44x44(아이콘 버튼).
 * 이웃과 겹치지 않으려면 위아래 줄 간격은 (44 − 보이는 높이) 이상, 아이콘 버튼 사이는 44 − 보이는 크기 이상.
 */
export const HIT_Y = "relative before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']";
export const HIT_SQ = "relative before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";

export function Seg<T extends string>({ label, value, options, onChange, grow, disabled, describedBy }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; grow?: boolean; disabled?: boolean; describedBy?: string }) {
  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className={`flex rounded-[12px] bg-bg p-[3px] ${grow ? "w-full" : ""} ${disabled ? "opacity-60" : ""}`}>
      {options.map(([id, text]) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={`${HIT_Y} h-[34px] whitespace-nowrap disabled:cursor-not-allowed rounded-[9px] px-3 text-[13px] ${grow ? "flex-1" : ""} ${on ? "bg-surface font-semibold text-ink shadow-[0_1px_3px_rgba(27,34,48,.12)]" : "bg-transparent font-medium text-muted"}`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ on, onClick, children, withAvatar }: { on: boolean; onClick: () => void; children: ReactNode; withAvatar?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`${HIT_Y} inline-flex h-[34px] items-center gap-[6px] rounded-[17px] border pr-3 text-[13px] ${withAvatar ? "pl-[6px]" : "pl-3"} ${
        on ? "border-ink bg-ink font-semibold text-white" : "border-line-3 bg-surface font-medium text-ink-3"
      }`}
    >
      {children}
    </button>
  );
}

/** 개인 목표 막대 [bg, 글자, border] — 캘린더·간트 공용, 내 일정 PERSONAL_LOOK 과 같은 값 */
export const PERSONAL_BAR: [string, string, string] = [PERSONAL_LOOK.fill, PERSONAL_LOOK.color, PERSONAL_LOOK.line];

/** left = 이탈한 팀원의 개인 목표 */
export function ArchivedBadge({ left = false }: { left?: boolean }) {
  return (
    <span data-archived-badge className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">
      {left ? "보관됨 · 이탈" : "보관됨"}
    </span>
  );
}

export function TypeBadge({ type }: { type: TaskType }) {
  const c = type === "공통" ? PAL.mint : type === "개인" ? PAL.slate : PAL.lav;
  return (
    <span className="shrink-0 rounded-[6px] px-[7px] py-[2px] text-[11px] font-bold" style={{ background: c.bg, color: c.fg }}>
      {type}
    </span>
  );
}

/** draft 는 status 로 판정한다(warnings 아님) */
export function ExamBadge({ draft }: { draft: boolean }) {
  return (
    <span data-exam-badge className="inline-flex shrink-0 items-center gap-1">
      <span className="rounded-[6px] px-[7px] py-[2px] text-[11px] font-bold" style={{ background: PAL.blue.bg, color: PAL.blue.fg }}>
        시험
      </span>
      {draft && (
        <span className="rounded-[6px] px-[7px] py-[2px] text-[11px] font-bold" style={{ background: PAL.amber.bg, color: PAL.amber.fg }}>
          초안
        </span>
      )}
    </span>
  );
}

export function RingedStatus({ status, size }: { status: TaskStatus; size: number }) {
  return (
    <span className="flex rounded-full bg-white p-px">
      <StatusIcon status={status} size={size} />
    </span>
  );
}

type StackProps = {
  people: Person[];
  size: number;
  /** 배경과 같은 색 */
  ring: string;
  iconSize: number;
  max?: number;
  overflowSize?: number;
};

export function AvatarStack({ people, size, ring, iconSize, max = 4, overflowSize = size + 2 }: StackProps) {
  const shown = people.slice(0, max);
  const over = people.length - shown.length;
  return (
    <span className="flex items-center">
      {shown.map((p, i) => (
        <span key={p.userId} title={`${p.name} · ${CODE_LABEL[p.c]}`} className="relative inline-flex shrink-0 rounded-full" style={{ marginLeft: i === 0 ? 0 : -6, border: `2px solid ${ring}` }}>
          <Avatar name={p.name} size={size} tone={p.tone} id={p.userId} />
          <span className="absolute -right-[3px] -bottom-[3px] flex">
            <RingedStatus status={CODE_STATUS[p.c]} size={iconSize} />
          </span>
        </span>
      ))}
      {over > 0 && (
        <span
          className="-ml-[6px] inline-flex items-center justify-center rounded-full border-2 border-white bg-slate-soft text-[11px] font-bold text-ink-3"
          style={{ width: overflowSize, height: overflowSize, fontSize: overflowSize <= 28 ? 10 : 11 }}
        >
          +{over}
        </span>
      )}
    </span>
  );
}

export function CodeIcons({ codes, size, max }: { codes: Code[]; size: number; max: number }) {
  return (
    <span className="flex shrink-0 items-center gap-[2px]">
      {codes.slice(0, max).map((c, i) => (
        <StatusIcon key={i} status={CODE_STATUS[c]} size={size} />
      ))}
      {codes.length > max && <span className="ml-[2px] text-[10px] font-bold">+{codes.length - max}</span>}
    </span>
  );
}

export const statusLabelOf = (s: TaskStatus) => STATUS_LABEL[s];

export function RoundIconButton({ label, children, size = 44, title, onClick }: { label: string; children: ReactNode; size?: number; title?: string; onClick?: () => void }) {
  return (
    <button type="button" aria-label={label} title={title} onClick={onClick} className="flex shrink-0 items-center justify-center rounded-full border border-line bg-surface" style={{ width: size, height: size }}>
      {children}
    </button>
  );
}

export function PillButton({ onClick, children, weight = 400 }: { onClick: () => void; children: ReactNode; weight?: 400 | 500 | 600 }) {
  return (
    <button type="button" onClick={onClick} className={`${HIT_Y} inline-flex h-9 items-center rounded-[18px] border border-line bg-surface px-3 text-[13px] text-ink`} style={{ fontWeight: weight }}>
      {children}
    </button>
  );
}
