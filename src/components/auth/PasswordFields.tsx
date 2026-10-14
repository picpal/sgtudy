"use client";

import { useId } from "react";
import { PASSWORD_RULE_TEXT, passwordFormError, passwordProblem } from "./password";
import { fieldClass, labelClass } from "./styles";

type Props = {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
};

/** 새 비밀번호 + 확인. 정책 문구는 늘 보이고, 맞으면 초록으로 바뀐다 */
export function PasswordFields({ password, confirm, onPassword, onConfirm, label = "비밀번호", autoFocus, disabled }: Props) {
  const id = useId();
  const problem = password === "" ? null : passwordProblem(password);
  const ok = password !== "" && problem === null;
  const tooLong = problem === "too_long";
  const mismatch = confirm !== "" && confirm !== password;
  return (
    <>
      <label className={labelClass}>
        {label}
        <input
          type="password"
          autoComplete="new-password"
          autoFocus={autoFocus}
          disabled={disabled}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          aria-describedby={`${id}-rule`}
          className={fieldClass}
        />
        <span id={`${id}-rule`} className="text-[12px] font-medium" style={{ color: ok ? "#0D7A64" : tooLong ? "#B4462B" : "#7A8594" }}>
          {ok ? "사용할 수 있는 비밀번호예요" : tooLong ? passwordFormError(password, password) : PASSWORD_RULE_TEXT}
        </span>
      </label>
      <label className={labelClass}>
        {label} 확인
        <input
          type="password"
          autoComplete="new-password"
          disabled={disabled}
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? `${id}-confirm` : undefined}
          className={fieldClass}
        />
        {mismatch && (
          <span id={`${id}-confirm`} className="text-[12px] font-medium" style={{ color: "#B4462B" }}>
            비밀번호가 서로 달라요
          </span>
        )}
      </label>
    </>
  );
}
