"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Ask, ChipOption } from "@/lib/ai/schema";
import { DATE_NO_OVERFLOW_CLASS, FIELD_CLASS } from "../fields";

/* 선택지 칩(D14·§9.1) — 단일 = radiogroup(roving tabindex, ←/→ 로 고르고 Enter·Space·클릭으로 보냄), 복수 = aria-pressed + [선택 완료],
   「직접」 = 같은 자리에 날짜·숫자 입력 + [확인]. 높이 44px, 값이 라벨에 보인다(색만으로 구분하지 않음) */

const CHIP = "inline-flex min-h-11 items-center gap-1 rounded-[22px] border px-4 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint disabled:opacity-50";
const OFF = "border-line-3 bg-surface text-ink-2";
const ON = "border-mint bg-[#F5FBF9] text-mint";

/** 사용자 말풍선에 들어갈 글 — 직접 입력한 숫자는 단위를 붙인다 */
export function otherLabel(field: Ask["field"], value: string): string {
  if (field === "durationWeeks") return `${value}주`;
  if (field === "maxMembers" || field === "minMembers") return `${value}명`;
  return value;
}

export type Pick = (label: string, value: string) => void;

export function SingleChips({ ask, onPick, disabled }: { ask: Ask; onPick: Pick; disabled?: boolean }) {
  const opts = ask.options ?? [];
  const [sel, setSel] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + opts.length) % opts.length;
    setSel(n);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="선택지" className="flex flex-wrap gap-2">
      {opts.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={sel === i}
          tabIndex={sel === i ? 0 : -1}
          disabled={disabled}
          onClick={() => onPick(o.label, o.value)}
          onKeyDown={(e) => onKey(e, i)}
          className={`${CHIP} ${OFF}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MultiChips({ options, onDone, disabled }: { options: ChipOption[]; onDone: (picked: ChipOption[]) => void; disabled?: boolean }) {
  const [on, setOn] = useState<string[]>([]);
  const toggle = (v: string) => setOn((xs) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]));
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="여러 개 고르기" className="flex flex-wrap gap-2">
        {options.map((o) => {
          const pressed = on.includes(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={pressed} disabled={disabled} onClick={() => toggle(o.value)} className={`${CHIP} ${pressed ? ON : OFF}`}>
              <span aria-hidden="true">{pressed ? "✓" : "＋"}</span>
              {o.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={disabled || !on.length}
        onClick={() => onDone(options.filter((o) => on.includes(o.value)))}
        className="h-11 self-start rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted"
      >
        선택 완료{on.length ? ` (${on.length})` : ""}
      </button>
    </div>
  );
}

/** 「직접」 — 날짜·숫자 칸 + [확인] */
export function OtherInput({ kind, onSubmit, onCancel, min, disabled }: { kind: "date" | "number" | "text"; onSubmit: (v: string) => void; onCancel: () => void; min?: string; disabled?: boolean }) {
  const [v, setV] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const ok = kind === "number" ? /^\d{1,3}$/.test(v.trim()) : !!v.trim();
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(v.trim());
      }}
    >
      <label className="sr-only" htmlFor="interview-other">직접 입력</label>
      <input
        id="interview-other"
        ref={ref}
        type={kind}
        inputMode={kind === "number" ? "numeric" : undefined}
        min={kind === "date" ? min : kind === "number" ? 1 : undefined}
        value={v}
        onChange={(e) => setV(e.target.value)}
        disabled={disabled}
        className={`${FIELD_CLASS} ${kind === "date" ? DATE_NO_OVERFLOW_CLASS : ""} w-[200px] max-w-full`}
      />
      <button type="submit" disabled={disabled || !ok} className="h-11 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">확인</button>
      <button type="button" onClick={onCancel} className="h-11 px-3 text-[14px] font-semibold text-muted">취소</button>
    </form>
  );
}
