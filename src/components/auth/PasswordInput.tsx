"use client";

import { useState, type InputHTMLAttributes, type Ref } from "react";
import { fieldClass } from "./styles";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className"> & { inputRef?: Ref<HTMLInputElement> };

/** 비밀번호 칸 + 보기/숨기기. 버튼은 칸 안 오른쪽 44px — 입력 글자가 버튼 밑으로 들어가지 않게 오른쪽 여백을 둔다 */
export function PasswordInput({ inputRef, disabled, ...rest }: Props) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...rest} ref={inputRef} type={shown ? "text" : "password"} disabled={disabled} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={`${fieldClass} pr-12`} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        disabled={disabled}
        aria-label={shown ? "비밀번호 숨기기" : "비밀번호 보기"}
        aria-pressed={shown}
        className="absolute right-[2px] top-[2px] flex h-11 w-11 items-center justify-center rounded-[10px] text-muted outline-none hover:text-ink focus-visible:shadow-[0_0_0_3px_#DDF4EE] disabled:text-faint"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1.5 9S4.2 3.75 9 3.75 16.5 9 16.5 9 13.8 14.25 9 14.25 1.5 9 1.5 9z" />
          <circle cx="9" cy="9" r="2.25" />
          {shown && <path d="M2.5 15.5l13-13" />}
        </svg>
      </button>
    </div>
  );
}
