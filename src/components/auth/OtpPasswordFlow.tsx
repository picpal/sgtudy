"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { fetchMe, signOut } from "@/lib/api/me";
import { routes, safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "./AuthShell";
import { OtpInput } from "./OtpInput";
import { EMPTY_DIGITS, RESEND_SEC, authErrorMessage, errorCode, isComplete, isResetNoAccount, rateLimitWait, type Digits } from "./otp";
import { HAS_PASSWORD_KEY, otpFlowStep, signupAccountKind, type Verified } from "./flow";
import { passwordFormError } from "./password";
import { PasswordFields } from "./PasswordFields";
import { fieldClass, labelClass, primaryClass } from "./styles";

/** 코드 단계는 ?step=code 히스토리 항목 — 브라우저 뒤로가기가 이메일 단계로 돌아오게 한다(Q2-08) */
const STEP_KEY = "step";
const withStep = (on: boolean) => {
  const sp = new URLSearchParams(window.location.search);
  if (on) sp.set(STEP_KEY, "code");
  else sp.delete(STEP_KEY);
  const q = sp.toString();
  return `${window.location.pathname}${q ? `?${q}` : ""}`;
};

export type OtpFlowMode = "signup" | "reset";

const COPY = {
  signup: {
    title: "회원가입",
    subtitle: "이메일로 6자리 인증 코드를 보내 드려요. 인증한 뒤 비밀번호를 정해요.",
  },
  reset: {
    title: "비밀번호 재설정",
    subtitle: "가입한 이메일로 6자리 인증 코드를 보내 드려요. 인증 코드로만 로그인하던 계정도 여기서 비밀번호를 만들 수 있어요.",
  },
} as const;

/** 로그인했지만 비밀번호가 아직 없을 때(코드 확인 뒤 떠났다 돌아옴) 서버 페이지가 넘기는 시작 상태 */
export type OtpFlowResume = { email: string; verified: Exclude<Verified, "has_password"> };

/** 가입(shouldCreateUser: true)·재설정(false) 공용: 이메일 → 6자리 코드 → 비밀번호 정하기 → (닉네임) → returnTo */
export function OtpPasswordFlow({ mode, returnTo, resume }: { mode: OtpFlowMode; returnTo: string; resume?: OtpFlowResume }) {
  const router = useRouter();
  const params = useSearchParams();
  const flow = mode === "reset" ? "reset" : "login";
  const [email, setEmail] = useState("");
  // 코드를 보냈(거나 빈도 제한으로 이미 보낸 것으로 보이는) 주소. 계정은 소문자로 저장되니 소문자로 쓴다(Q2-18)
  const [sentTo, setSentTo] = useState<string | null>(resume?.email ?? null);
  const [digits, setDigits] = useState<Digits>(EMPTY_DIGITS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rateLimited, setRateLimited] = useState(false);
  const [left, setLeft] = useState(0);
  const [verified, setVerified] = useState<Verified | null>(resume?.verified ?? null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const sentAt = useRef<number | null>(null);
  const pushed = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const addr = email.trim().toLowerCase();
  const dest = safeReturnTo(returnTo);
  const back = dest === "/" ? undefined : dest;
  const step = otpFlowStep(verified, params.get(STEP_KEY) === "code", sentTo);

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
    const { error: e } = await createClient().auth.signInWithOtp({ email: to, options: { shouldCreateUser: mode === "signup" } });
    setBusy(false);
    // 재설정: 없는 주소도 보낸 것처럼 코드 단계로 — 화면 분기로 계정 존재를 드러내지 않는다(코드 확인은 "맞지 않거나 만료" 로 끝난다)
    if (e && !(mode === "reset" && isResetNoAccount(e))) {
      // 1분 안에 다시 요청: 남은 시간을 보여 주고, 이미 받은 코드를 입력하러 갈 수 있게 한다(Q2-08, Q2-30)
      const wait = rateLimitWait(e, sentTo === to ? sentAt.current : null, Date.now());
      if (wait !== null) {
        setLeft(wait);
        setRateLimited(true);
        if (step === "otp") setError(authErrorMessage(e, flow));
        return;
      }
      return setError(authErrorMessage(e, flow));
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
    const { data, error: e } = await createClient().auth.verifyOtp({ email: sentTo, token: d.join(""), type: "email" });
    setBusy(false);
    if (e || !data.user) {
      setDigits(EMPTY_DIGITS);
      return setError(authErrorMessage(e, flow));
    }
    setVerified(mode === "signup" ? signupAccountKind(data.user, Date.now()) : "reset");
  };

  const onDigits = (d: Digits) => {
    setDigits(d);
    if (isComplete(d) && !busy) void verify(d);
  };

  const finish = async () => {
    const me = await fetchMe();
    router.replace(me.onboarded ? dest : routes.onboarding(dest));
    router.refresh();
  };

  const savePassword = async (ev: FormEvent) => {
    ev.preventDefault();
    const problem = passwordFormError(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      const { error: e } = await createClient().auth.updateUser({ password, data: { [HAS_PASSWORD_KEY]: true } });
      if (e) throw e;
      await finish();
    } catch (e2) {
      // 재인증 켜짐(secure_password_change): 24시간보다 오래된 세션(resume)은 nonce 가 필요하다 →
      // 로그아웃하고 이메일 단계부터 다시(새 코드 확인 = 새 세션이라 nonce 없이 바뀐다)
      if (errorCode(e2) === "reauthentication_needed") {
        try {
          await signOut();
        } catch {
          /* 이미 끊긴 세션 — 그대로 이메일 단계로 */
        }
        setEmail(sentTo ?? "");
        setSentTo(null);
        setVerified(null);
        setPassword("");
        setConfirm("");
        router.refresh();
      }
      setBusy(false);
      setError(authErrorMessage(e2, flow));
    }
  };

  // 이미 비밀번호가 있는 계정으로 가입 시도: 조용히 로그인시키지 않고 로그인/새 비밀번호를 고르게 한다
  const toLogin = async () => {
    setBusy(true);
    try {
      await signOut();
      router.replace(routes.login(back));
      router.refresh();
    } catch (e) {
      setBusy(false);
      setError(authErrorMessage(e));
    }
  };

  if (step === "notice") {
    return (
      <AuthShell title="이미 가입된 계정이에요" subtitle={`${sentTo} 은(는) 비밀번호가 있는 계정이에요. 비밀번호로 로그인하거나, 방금 이메일을 인증했으니 새 비밀번호를 정할 수 있어요.`}>
        {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
        <button type="button" onClick={() => void toLogin()} disabled={busy} className={primaryClass}>
          비밀번호로 로그인하기
        </button>
        <button type="button" onClick={() => setVerified("reset")} disabled={busy} className="h-11 text-[14px] font-semibold text-mint">
          새 비밀번호 정하기
        </button>
      </AuthShell>
    );
  }

  if (step === "password") {
    const subtitle =
      verified === "reset"
        ? "새 비밀번호를 정하면 바로 로그인돼요."
        : verified === "existing"
          ? "이미 가입된 계정이에요 · 비밀번호를 정하면 다음부터 이메일과 비밀번호로 로그인해요."
          : "다음부터 이메일과 이 비밀번호로 로그인해요.";
    return (
      <AuthShell title={verified === "reset" ? "새 비밀번호 정하기" : "비밀번호 정하기"} subtitle={subtitle}>
        <form onSubmit={savePassword} className="flex flex-col gap-3">
          {/* 비밀번호 관리자가 이 계정 이메일로 저장하게 */}
          <input type="email" autoComplete="username" value={sentTo ?? ""} readOnly hidden />
          <PasswordFields
            password={password}
            confirm={confirm}
            onPassword={(v) => {
              setPassword(v);
              setError("");
            }}
            onConfirm={(v) => {
              setConfirm(v);
              setError("");
            }}
            label={verified === "reset" ? "새 비밀번호" : "비밀번호"}
            autoFocus
            disabled={busy}
          />
          {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
          <button type="submit" disabled={busy || !password || !confirm} className={primaryClass}>
            {busy ? "저장 중…" : verified === "reset" ? "비밀번호 저장하고 로그인" : "비밀번호 저장"}
          </button>
        </form>
      </AuthShell>
    );
  }

  if (step === "email") {
    const limited = rateLimited && left > 0;
    return (
      <AuthShell title={COPY[mode].title} subtitle={COPY[mode].subtitle}>
        <form onSubmit={onEmail} className="flex flex-col gap-3">
          <label className={labelClass}>
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
              className={fieldClass}
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
          <button type="submit" disabled={busy || limited} className={primaryClass}>
            {busy ? "보내는 중…" : limited ? `${left}초 뒤에 다시 받기` : "인증 코드 받기"}
          </button>
        </form>
        <p className="m-0 text-center text-[13px] text-muted">
          {mode === "signup" ? "이미 계정이 있나요? " : "비밀번호가 기억나요? "}
          <Link href={routes.login(back)} className="font-semibold text-mint">
            로그인
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="인증 코드 입력"
      subtitle={
        mode === "reset"
          ? `가입된 주소라면 ${sentTo} 로 6자리 코드를 보냈어요. 코드는 10분 동안 유효해요.`
          : `${sentTo} 로 보낸 6자리 코드를 입력해 주세요. 코드는 10분 동안 유효해요.`
      }
    >
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
