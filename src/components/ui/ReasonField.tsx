"use client";

import { useId } from "react";

/** 확인 창 안의 짧은 글(탈퇴 요청 사유·참가 신청 한마디) — 서버 한도 200자, 비우면 보내지 않는다 */
export function ReasonField({ value, onChange, label, placeholder, max = 200 }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; max?: number }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={id} className="flex items-baseline justify-between text-[13px] font-semibold text-ink-2">
        {label}
        <span className="text-[12px] font-medium text-muted" aria-hidden="true">
          {value.length}/{max}
        </span>
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={max}
        rows={3}
        placeholder={placeholder}
        aria-describedby={`${id}-n`}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[88px] w-full resize-y rounded-[12px] border border-line px-3 py-[10px] text-[14px] leading-[1.5] outline-none placeholder:text-faint focus:border-mint"
      />
      {/* 글자 수는 키마다 읽히지 않게 live 를 두지 않고 설명으로만 (최종 리뷰 Minor 3) */}
      <span id={`${id}-n`} className="sr-only">
        {max}자까지 · 지금 {value.length}자
      </span>
    </div>
  );
}
