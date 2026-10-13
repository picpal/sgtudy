"use client";

import { useEffect, useRef } from "react";
import { applyBackspace, applyDigit, applyPaste, type Digits } from "./otp";

type Props = { value: Digits; onChange: (d: Digits) => void; disabled?: boolean };

export function OtpInput({ value, onChange, disabled }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusAt = (i: number) => refs.current[i]?.focus();

  useEffect(() => {
    focusAt(0);
  }, []);

  const commit = (r: { digits: Digits; focus: number }) => {
    onChange(r.digits);
    requestAnimationFrame(() => focusAt(r.focus));
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
