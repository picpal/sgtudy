"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { fetchMe } from "@/lib/api/me";
import { routes, safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "./AuthShell";
import { authErrorMessage, errorCode } from "./otp";
import { PasswordInput } from "./PasswordInput";
import { useCaptcha } from "./Turnstile";
import { fieldClass, labelClass, primaryClass } from "./styles";

/**
 * 기본 로그인: 이메일 + 비밀번호. 인증 코드는 가입(routes.signup)과 비밀번호 재설정(routes.resetPassword)에서만 쓴다.
 * sessionExpired = 고아 세션을 정리하고 넘어온 경우(?reason=session_expired) — 한 줄 안내를 띄운다
 */
export function LoginScreen({ returnTo, sessionExpired = false }: { returnTo: string; sessionExpired?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 어느 칸이 문제인지 — 형식 오류는 그 칸만, 로그인 실패는 둘 다 aria-invalid
  const [bad, setBad] = useState<"email" | "password" | "both" | null>(null);
  const [badCredentials, setBadCredentials] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const addr = email.trim().toLowerCase();
  const dest = safeReturnTo(returnTo);
  const back = dest === "/" ? undefined : dest;
  // NEXT_PUBLIC_TURNSTILE_SITE_KEY 가 있을 때만 — 없으면 지금과 같다
  const captcha = useCaptcha("login");

  const errorId = useId();
  // 고치기 시작하면 지난 오류는 지운다 — "비밀번호 만들기" 안내는 아래 상자에 늘 있다
  const clearError = () => {
    if (!error) return;
    setError("");
    setBad(null);
    setBadCredentials(false);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setError("이메일 주소를 확인해 주세요");
      setBad("email");
      emailRef.current?.focus(); // Q2-19: 오류 필드로 포커스
      return;
    }
    if (!password) {
      setError("비밀번호를 입력해 주세요");
      setBad("password");
      passwordRef.current?.focus();
      return;
    }
    const blocked = captcha.block();
    if (blocked) {
      setError(blocked);
      return;
    }
    setBusy(true);
    setError("");
    setBad(null);
    setBadCredentials(false);
    try {
      const { error: e } = await createClient().auth.signInWithPassword({ email: addr, password, options: { ...captcha.options } });
      captcha.reset(); // 토큰은 한 번만 쓴다 — 다음 시도에 새 토큰
      if (e) throw e;
      const me = await fetchMe();
      router.replace(me.onboarded ? dest : routes.onboarding(dest));
      router.refresh();
    } catch (e) {
      setBusy(false);
      const wrong = errorCode(e) === "invalid_credentials";
      if (wrong) setPassword(""); // 연결 실패 등에는 그대로 두고 다시 누르기만 하면 되게
      setError(authErrorMessage(e));
      setBad(wrong ? "both" : null);
      passwordRef.current?.focus();
      // 모든 로그인 실패에 똑같이 붙는다(계정 존재와 무관) — 기존 호스팅 사용자는 아직 비밀번호가 없다
      setBadCredentials(wrong);
    }
  };

  return (
    <AuthShell title="로그인" subtitle="이메일과 비밀번호로 로그인해요.">
      {sessionExpired && (
        <p role="status" className="m-0 rounded-[12px] bg-surface-3 px-4 py-3 text-[13px] leading-[1.6] text-ink">
          로그인 정보가 만료됐어요. 다시 로그인해 주세요.
        </p>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
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
              clearError();
            }}
            placeholder="you@example.com"
            aria-invalid={bad === "email" || bad === "both"}
            aria-describedby={error ? errorId : undefined}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          비밀번호
          <PasswordInput
            inputRef={passwordRef}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError();
            }}
            aria-invalid={bad === "password" || bad === "both"}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        {error && (
          <div id={errorId} role="alert" className="flex flex-col gap-1 text-[13px]">
            <p className="m-0 text-warn">{error}</p>
            {badCredentials && (
              <p className="m-0 text-muted">
                인증 코드로만 쓰던 계정이면 →{" "}
                <Link href={routes.resetPassword(back)} className="font-semibold text-mint">
                  비밀번호 만들기
                </Link>
              </p>
            )}
          </div>
        )}
        {captcha.widget}
        <button type="submit" disabled={busy} className={primaryClass}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>
      <div className="flex items-center justify-between text-[13px]">
        <Link href={routes.signup(back)} className="flex h-11 items-center font-semibold text-mint">
          회원가입
        </Link>
        <Link href={routes.resetPassword(back)} className="flex h-11 items-center text-muted">
          비밀번호를 잊으셨나요?
        </Link>
      </div>
      <p className="m-0 rounded-[12px] bg-surface-3 px-4 py-3 text-[12px] leading-[1.6] text-muted">
        인증 코드로만 로그인하던 계정은 아직 비밀번호가 없어요. <Link href={routes.resetPassword(back)} className="font-semibold text-mint">비밀번호 만들기</Link>에서 이메일 인증 후 비밀번호를 정해 주세요.
      </p>
    </AuthShell>
  );
}
