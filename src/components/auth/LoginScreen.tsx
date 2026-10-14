"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { fetchMe } from "@/lib/api/me";
import { routes, safeReturnTo } from "@/lib/routes";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "./AuthShell";
import { authErrorMessage } from "./otp";
import { fieldClass, labelClass, primaryClass } from "./styles";

/** 기본 로그인: 이메일 + 비밀번호. 인증 코드는 가입(routes.signup)과 비밀번호 재설정(routes.resetPassword)에서만 쓴다 */
export function LoginScreen({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const addr = email.trim().toLowerCase();
  const dest = safeReturnTo(returnTo);
  const back = dest === "/" ? undefined : dest;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setError("이메일 주소를 확인해 주세요");
      emailRef.current?.focus(); // Q2-19: 오류 필드로 포커스
      return;
    }
    if (!password) return setError("비밀번호를 입력해 주세요");
    setBusy(true);
    setError("");
    try {
      const { error: e } = await createClient().auth.signInWithPassword({ email: addr, password });
      if (e) throw e;
      const me = await fetchMe();
      router.replace(me.onboarded ? dest : routes.onboarding(dest));
      router.refresh();
    } catch (e) {
      setBusy(false);
      setPassword("");
      setError(authErrorMessage(e));
    }
  };

  return (
    <AuthShell title="로그인" subtitle="이메일과 비밀번호로 로그인해요.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className={labelClass}>
          이메일
          <input
            ref={emailRef}
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={!!error}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          비밀번호
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} className={fieldClass} />
        </label>
        {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
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
