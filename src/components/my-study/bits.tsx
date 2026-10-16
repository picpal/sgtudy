"use client";

import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { PAL, toneOf } from "@/lib/palette";
import type { TaskStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";
import type { TaskType } from "@/data/my-study";
import { CODE_LABEL, CODE_STATUS, type Code, type Person } from "./model";

export const toneOfName = toneOf;

/** 세그먼트 컨트롤 */
export function Seg<T extends string>({ label, value, options, onChange, grow }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; grow?: boolean }) {
  return (
    <div role="group" aria-label={label} className={`flex rounded-[12px] bg-bg p-[3px] ${grow ? "w-full" : ""}`}>
      {options.map(([id, text]) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(id)}
            className={`h-[34px] whitespace-nowrap rounded-[9px] px-3 text-[13px] ${grow ? "flex-1" : ""} ${on ? "bg-surface font-semibold text-ink shadow-[0_1px_3px_rgba(27,34,48,.12)]" : "bg-transparent font-medium text-muted"}`}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** 필터 칩 */
export function Chip({ on, onClick, children, withAvatar }: { on: boolean; onClick: () => void; children: ReactNode; withAvatar?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      // 보이는 칩은 34px, 누르는 영역은 위아래로 5px 늘려 44px (before 의사 요소)
      className={`relative inline-flex h-[34px] items-center gap-[6px] rounded-[17px] border pr-3 before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-[''] text-[13px] ${withAvatar ? "pl-[6px]" : "pl-3"} ${
        on ? "border-ink bg-ink font-semibold text-white" : "border-line-3 bg-surface font-medium text-ink-3"
      }`}
    >
      {children}
    </button>
  );
}

/** 개인 목표 막대 [bg, 글자, border] — slate 톤 + 점선 (캘린더·간트 공용) */
export const PERSONAL_BAR: [string, string, string] = [PAL.slate.bg, PAL.slate.fg, "1.5px dashed #8C97A4"];

/** 과제 유형 배지: 공통 = mint, 지정 = lav, 개인 = slate */
export function TypeBadge({ type }: { type: TaskType }) {
  const c = type === "공통" ? PAL.mint : type === "개인" ? PAL.slate : PAL.lav;
  return (
    <span className="shrink-0 rounded-[6px] px-[7px] py-[2px] text-[11px] font-bold" style={{ background: c.bg, color: c.fg }}>
      {type}
    </span>
  );
}

/** 흰 링이 둘린 상태 아이콘 (아바타 우하단 오버레이용) */
export function RingedStatus({ status, size }: { status: TaskStatus; size: number }) {
  return (
    <span className="flex rounded-full bg-white p-px">
      <StatusIcon status={status} size={size} />
    </span>
  );
}

type StackProps = {
  people: Person[];
  /** 아바타 크기 */
  size: number;
  /** 링 색 (배경과 같은 색) */
  ring: string;
  iconSize: number;
  max?: number;
  /** "+N" 원 크기 */
  overflowSize?: number;
};

/** 아바타 스택 — 겹침 -6, 최대 max 명, 초과분 "+N" */
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

/** 코드 아이콘 나열 (캘린더 끝·간트 좌측) */
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

/** 44 원형 아이콘 버튼 (동작 없음) */
export function RoundIconButton({ label, children, size = 44, title, onClick }: { label: string; children: ReactNode; size?: number; title?: string; onClick?: () => void }) {
  return (
    <button type="button" aria-label={label} title={title} onClick={onClick} className="flex shrink-0 items-center justify-center rounded-full border border-line bg-surface" style={{ width: size, height: size }}>
      {children}
    </button>
  );
}

/** 36 높이 라운드 보조 버튼 */
export function PillButton({ onClick, children, weight = 400 }: { onClick: () => void; children: ReactNode; weight?: 400 | 500 | 600 }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-9 items-center rounded-[18px] border border-line bg-surface px-3 text-[13px] text-ink" style={{ fontWeight: weight }}>
      {children}
    </button>
  );
}
