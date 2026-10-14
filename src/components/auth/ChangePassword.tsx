"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { HAS_PASSWORD_KEY } from "./flow";
import { OtpInput } from "./OtpInput";
import { EMPTY_DIGITS, RESEND_SEC, authErrorMessage, isComplete, rateLimitWait, type Digits } from "./otp";
import { PASSWORD_MISMATCH_TEXT, passwordFormError } from "./password";
import { PasswordFields } from "./PasswordFields";

type Msg = { tone: "ok" | "bad"; text: string };

/**
 * /me 비밀번호 변경 — 재인증 필수(config.toml secure_password_change = true, 호스팅 security_update_password_require_reauthentication).
 * 새 비밀번호 → reauthenticate()(이메일로 6자리 코드) → updateUser({ password, nonce }).
 * 세션만 빼앗겨도 영구 자격 증명(비밀번호)을 만들 수 없게 메일함 확인을 한 번 더 받는다.
 */
export function ChangePassword({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<"form" | "code">("form");
  const [digits, setDigits] = useState<Digits>(EMPTY_DIGITS);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  /** 재인증 코드 발송. 1분 안에 다시 누르면 남은 시간만 보여 주고 이미 받은 코드를 쓰게 한다 */
  const sendCode = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.reauthenticate();
    setBusy(false);
    setDigits(EMPTY_DIGITS);
    if (error) {
      const wait = rateLimitWait(error, null, Date.now());
      if (wait === null) return setMsg({ tone: "bad", text: authErrorMessage(error, "change") });
      setLeft(wait);
      setMsg({ tone: "bad", text: authErrorMessage(error, "change") });
    } else setLeft(RESEND_SEC);
    setStep("code");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordFormError(password, confirm);
    if (problem === PASSWORD_MISMATCH_TEXT) return confirmRef.current?.focus(); // 확인 칸 밑에 이미 떠 있다
    if (problem) return setMsg({ tone: "bad", text: problem });
    await sendCode();
  };

  const verify = async (d: Digits) => {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.updateUser({ password, nonce: d.join(""), data: { [HAS_PASSWORD_KEY]: true } });
    setBusy(false);
    if (error) {
      setDigits(EMPTY_DIGITS);
      return setMsg({ tone: "bad", text: authErrorMessage(error, "change") });
    }
    setPassword("");
    setConfirm("");
    setStep("form");
    setMsg({ tone: "ok", text: "비밀번호를 바꿨어요 · 다음 로그인부터 새 비밀번호를 써 주세요" });
  };

  const onDigits = (d: Digits) => {
    setDigits(d);
    if (msg?.tone === "bad") setMsg(null);
    if (isComplete(d) && !busy) void verify(d);
  };

  const cancel = () => {
    setStep("form");
    setDigits(EMPTY_DIGITS);
    setMsg(null);
  };

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (msg) setMsg(null);
  };

  const note = msg && (
    <p role={msg.tone === "bad" ? "alert" : "status"} className="m-0 text-[13px]" style={{ color: msg.tone === "ok" ? "#0D7A64" : "#B4462B" }}>
      {msg.text}
    </p>
  );

  return (
    <section aria-label="비밀번호 변경" className="flex flex-col gap-3 rounded-[14px] border border-line p-4">
      <span className="block text-[14px] font-semibold">비밀번호 변경</span>
      {step === "code" ? (
        <>
          <p className="m-0 text-[13px] leading-[1.6] text-muted">보안을 위해 {email} 로 보낸 6자리 인증 코드를 입력해 주세요. 코드를 입력하면 바로 바뀌어요.</p>
          <OtpInput value={digits} onChange={onDigits} disabled={busy} />
          {note}
          <div className="flex items-center justify-between text-[13px]">
            <button type="button" onClick={cancel} disabled={busy} className="h-11 text-muted">
              취소
            </button>
            <button type="button" onClick={() => void sendCode()} disabled={busy || left > 0} className="h-11 font-semibold text-mint disabled:text-faint">
              {left > 0 ? `재전송 (${left}초)` : "코드 재전송"}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <PasswordFields password={password} confirm={confirm} onPassword={edit(setPassword)} onConfirm={edit(setConfirm)} label="새 비밀번호" disabled={busy} confirmRef={confirmRef} />
          {note}
          <button type="submit" disabled={busy || !password || !confirm} className="flex h-11 items-center justify-center rounded-[22px] border border-line-3 text-[14px] font-semibold text-ink disabled:text-faint">
            {busy ? "코드 보내는 중…" : "인증 코드 받고 변경"}
          </button>
          <span className="text-[12px] text-muted">변경 전에 이메일로 6자리 인증 코드를 한 번 더 확인해요.</span>
        </form>
      )}
    </section>
  );
}
