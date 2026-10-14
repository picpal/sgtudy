"use client";

import { useId, type Ref } from "react";
import { PASSWORD_MISMATCH_TEXT, PASSWORD_RULE_TEXT, passwordFormError, passwordProblem } from "./password";
import { PasswordInput } from "./PasswordInput";
import { labelClass } from "./styles";

type Props = {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  confirmRef?: Ref<HTMLInputElement>;
};

/** 새 비밀번호 + 확인. 정책 문구는 늘 보이고, 맞으면 초록으로 바뀐다 */
export function PasswordFields({ password, confirm, onPassword, onConfirm, label = "비밀번호", autoFocus, disabled, confirmRef }: Props) {
  const id = useId();
  const problem = password === "" ? null : passwordProblem(password);
  const ok = password !== "" && problem === null;
  const tooLong = problem === "too_long";
  // 8자는 채웠는데 영문·숫자가 빠졌으면 같은 규칙 문구를 빨간색으로 — 무엇이 모자란지 바로 보이게
  const bad = tooLong || (problem === "letters_digits");
  const mismatch = confirm !== "" && confirm !== password;
  return (
    <>
      <label className={labelClass}>
        {label}
        <PasswordInput
          autoComplete="new-password"
          autoFocus={autoFocus}
          disabled={disabled}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          aria-invalid={bad}
          aria-describedby={`${id}-rule`}
        />
        <span id={`${id}-rule`} aria-live="polite" className="text-[12px] font-medium" style={{ color: ok ? "#0D7A64" : bad ? "#B4462B" : "#7A8594" }}>
          {ok ? "사용할 수 있는 비밀번호예요" : tooLong ? passwordFormError(password, password) : PASSWORD_RULE_TEXT}
        </span>
      </label>
      <label className={labelClass}>
        {label} 확인
        <PasswordInput
          inputRef={confirmRef}
          autoComplete="new-password"
          disabled={disabled}
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? `${id}-confirm` : undefined}
        />
        {mismatch && (
          <span id={`${id}-confirm`} className="text-[12px] font-medium" style={{ color: "#B4462B" }}>
            {PASSWORD_MISMATCH_TEXT}
          </span>
        )}
      </label>
    </>
  );
}
