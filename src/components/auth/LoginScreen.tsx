"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchMe } from "@/lib/api/me";
import { routes, safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "./AuthShell";
import { OtpInput } from "./OtpInput";
import { EMPTY_DIGITS, RESEND_SEC, authErrorMessage, isComplete, rateLimitWait, type Digits } from "./otp";

const field = "h-12 w-full rounded-[12px] border border-line-3 px-4 text-[15px] text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE]";
const primary = "flex h-12 w-full items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted";

/** 코드 단계는 ?step=code 히스토리 항목 — 브라우저 뒤로가기가 이메일 단계로 돌아오게 한다(Q2-08) */
const STEP_KEY = "step";
const withStep = (on: boolean) => {
  const sp = new URLSearchParams(window.location.search);
  if (on) sp.set(STEP_KEY, "code");
  else sp.delete(STEP_KEY);
  const q = sp.toString();
  return `${window.location.pathname}${q ? `?${q}` : ""}`;
};

export function LoginScreen({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  // 코드를 보냈(거나 빈도 제한으로 이미 보낸 것으로 보이는) 주소. 계정은 소문자로 저장되니 소문자로 쓴다(Q2-18)
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [digits, setDigits] = useState<Digits>(EMPTY_DIGITS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rateLimited, setRateLimited] = useState(false);
  const [left, setLeft] = useState(0);
  const sentAt = useRef<number | null>(null);
  const pushed = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const addr = email.trim().toLowerCase();
  const step = params.get(STEP_KEY) === "code" && sentTo ? "otp" : "email";

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const toCode = (to: string) => {
    setSentTo(to);
    setDigits(EMPTY_DIGITS);
    setError("");
    setRateLimited(false);
    if (params.get(STEP_KEY) === "code") {
      window.history.replaceState(null, "", withStep(true));
    } else {
      window.history.pushState(null, "", withStep(true));
      pushed.current = true;
    }
  };

  const toEmail = () => {
    setError("");
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else window.history.replaceState(null, "", withStep(false));
  };

  const send = async (to: string) => {
    setBusy(true);
    setError("");
    setRateLimited(false);
    const { error: e } = await createClient().auth.signInWithOtp({ email: to, options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) {
      // 1분 안에 다시 요청: 남은 시간을 보여 주고, 이미 받은 코드를 입력하러 갈 수 있게 한다(Q2-08, Q2-30)
      const wait = rateLimitWait(e, sentTo === to ? sentAt.current : null, Date.now());
      if (wait !== null) {
        setLeft(wait);
        setRateLimited(true);
        if (step === "otp") setError(authErrorMessage(e));
        return;
      }
      return setError(authErrorMessage(e));
    }
    sentAt.current = Date.now();
    setLeft(RESEND_SEC);
    if (step === "email") toCode(to);
    else setDigits(EMPTY_DIGITS);
  };

  const onEmail = (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setRateLimited(false);
      setError("이메일 주소를 확인해 주세요");
      emailRef.current?.focus(); // Q2-19: 오류 필드로 포커스
      return;
    }
    void send(addr);
  };

  const verify = async (d: Digits) => {
    if (!sentTo) return;
    setBusy(true);
    setError("");
    const { error: e } = await createClient().auth.verifyOtp({ email: sentTo, token: d.join(""), type: "email" });
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
    const limited = rateLimited && left > 0;
    return (
      <AuthShell title="로그인" subtitle="이메일로 6자리 인증 코드를 보내 드려요. 비밀번호는 없어요.">
        <form onSubmit={onEmail} className="flex flex-col gap-3">
          <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
            이메일
            <input
              ref={emailRef}
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setRateLimited(false);
              }}
              placeholder="you@example.com"
              aria-invalid={!!error && !limited}
              className={field}
            />
          </label>
          {limited ? (
            <div role="alert" className="flex flex-col gap-2 text-[13px] text-warn">
              <p className="m-0">인증 코드는 1분에 한 번만 보낼 수 있어요 · {left}초 뒤에 다시 받을 수 있어요</p>
              <button type="button" onClick={() => toCode(addr)} className="h-11 self-start font-semibold text-mint">
                이미 받은 코드 입력하기
              </button>
            </div>
          ) : (
            error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>
          )}
          <button type="submit" disabled={busy || limited} className={primary}>
            {busy ? "보내는 중…" : limited ? `${left}초 뒤에 다시 받기` : "인증 코드 받기"}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="인증 코드 입력" subtitle={`${sentTo} 로 보낸 6자리 코드를 입력해 주세요. 코드는 10분 동안 유효해요.`}>
      <OtpInput value={digits} onChange={onDigits} disabled={busy} />
      {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
      <div className="flex items-center justify-between text-[13px]">
        <button type="button" onClick={toEmail} className="h-11 text-muted">
          이메일 바꾸기
        </button>
        <button type="button" onClick={() => sentTo && void send(sentTo)} disabled={busy || left > 0} className="h-11 font-semibold text-mint disabled:text-faint">
          {left > 0 ? `재전송 (${left}초)` : "코드 재전송"}
        </button>
      </div>
    </AuthShell>
  );
}
