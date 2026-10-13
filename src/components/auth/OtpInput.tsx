"use client";

import { useEffect, useRef } from "react";
import { applyBackspace, applyDigit, applyPaste, type Digits } from "./otp";

type Props = { value: Digits; onChange: (d: Digits) => void; disabled?: boolean };

export function OtpInput({ value, onChange, disabled }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = (i: number) => refs.current[i]?.focus();

  // 마운트 시, 그리고 검증 실패로 다시 활성화되며 칸이 비워지면 0번 칸에 포커스 (검증 중 disabled 라 포커스가 사라진다)
  const empty = value.every((c) => !c);
  useEffect(() => {
    if (!disabled && empty) focusAt(0);
  }, [disabled, empty]);

  // 포커스는 이벤트 안에서 바로 옮긴다 — rAF 로 미루면 다음 프레임 전에 친 숫자가 같은 칸을 덮어쓰고,
  // 틀린 코드로 칸이 비워진 뒤 0번 칸 포커스(위 effect)보다 늦게 실행돼 6번째 칸에 남는다(Q1-15, Q2-15)
  const commit = (r: { digits: Digits; focus: number }) => {
    focusAt(r.focus);
    onChange(r.digits);
  };

  return (
    <div role="group" aria-label="6자리 인증 코드" className="flex justify-between gap-2">
      {value.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${i + 1}번째 자리`}
          maxLength={6}
          value={c}
          disabled={disabled}
          onFocus={(e) => e.target.select()}
          onChange={(e) => commit(applyDigit(value, i, e.target.value))}
          onPaste={(e) => {
            e.preventDefault();
            commit(applyPaste(value, e.clipboardData.getData("text"), i));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              commit(applyBackspace(value, i));
            } else if (e.key === "ArrowLeft") focusAt(Math.max(0, i - 1));
            else if (e.key === "ArrowRight") focusAt(Math.min(5, i + 1));
          }}
          className="h-14 w-full min-w-0 rounded-[12px] border border-line-3 text-center text-[22px] font-bold text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE] disabled:bg-surface-3"
        />
      ))}
    </div>
  );
}
