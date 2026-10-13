"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { fetchMe } from "@/lib/api/me";
import { routes, safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "./AuthShell";
import { OtpInput } from "./OtpInput";
import { EMPTY_DIGITS, authErrorMessage, isComplete, type Digits } from "./otp";

const RESEND_SEC = 60;
const field = "h-12 w-full rounded-[12px] border border-line-3 px-4 text-[15px] text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE]";
const primary = "flex h-12 w-full items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted";

export function LoginScreen({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<Digits>(EMPTY_DIGITS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const send = async () => {
    setBusy(true);
    setError("");
    const { error: e } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) return setError(authErrorMessage(e));
    setDigits(EMPTY_DIGITS);
    setLeft(RESEND_SEC);
    setStep("otp");
  };

  const onEmail = (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("이메일 주소를 확인해 주세요");
    void send();
  };

  const verify = async (d: Digits) => {
    setBusy(true);
    setError("");
    const { error: e } = await createClient().auth.verifyOtp({ email: email.trim(), token: d.join(""), type: "email" });
    if (e) {
      setBusy(false);
      setDigits(EMPTY_DIGITS);
      return setError(authErrorMessage(e));
    }
    try {
      const me = await fetchMe();
      const dest = me.onboarded ? safeReturnTo(returnTo) : routes.onboarding(safeReturnTo(returnTo));
      router.replace(dest);
      router.refresh();
    } catch (e2) {
      setBusy(false);
      setError(authErrorMessage(e2));
    }
  };

  const onDigits = (d: Digits) => {
    setDigits(d);
    if (isComplete(d) && !busy) void verify(d);
  };

  if (step === "email") {
    return (
      <AuthShell title="로그인" subtitle="이메일로 6자리 인증 코드를 보내 드려요. 비밀번호는 없어요.">
        <form onSubmit={onEmail} className="flex flex-col gap-3">
          <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
            이메일
            <input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={field} />
          </label>
          {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
          <button type="submit" disabled={busy} className={primary}>
            {busy ? "보내는 중…" : "인증 코드 받기"}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="인증 코드 입력" subtitle={`${email.trim()} 로 보낸 6자리 코드를 입력해 주세요. 코드는 10분 동안 유효해요.`}>
      <OtpInput value={digits} onChange={onDigits} disabled={busy} />
      {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
      <div className="flex items-center justify-between text-[13px]">
        <button type="button" onClick={() => { setStep("email"); setError(""); }} className="h-11 text-muted">
          이메일 바꾸기
        </button>
        <button type="button" onClick={send} disabled={busy || left > 0} className="h-11 font-semibold text-mint disabled:text-faint">
          {left > 0 ? `재전송 (${left}초)` : "코드 재전송"}
        </button>
      </div>
    </AuthShell>
  );
}
