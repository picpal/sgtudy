"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { HAS_PASSWORD_KEY } from "./flow";
import { authErrorMessage } from "./otp";
import { passwordFormError } from "./password";
import { PasswordFields } from "./PasswordFields";

/** /me 비밀번호 변경 — 현재 세션으로 바꾼다(config.toml secure_password_change = false: 재인증 없음) */
export function ChangePassword({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordFormError(password, confirm);
    if (problem) return setMsg({ tone: "bad", text: problem });
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().auth.updateUser({ password, data: { [HAS_PASSWORD_KEY]: true } });
    setBusy(false);
    if (error) return setMsg({ tone: "bad", text: authErrorMessage(error) });
    setPassword("");
    setConfirm("");
    setMsg({ tone: "ok", text: "비밀번호를 바꿨어요 · 다음 로그인부터 새 비밀번호를 써 주세요" });
  };

  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    if (msg) setMsg(null);
  };

  return (
    <section aria-label="비밀번호 변경" className="flex flex-col gap-3 rounded-[14px] border border-line p-4">
      <span className="block text-[14px] font-semibold">비밀번호 변경</span>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <PasswordFields password={password} confirm={confirm} onPassword={edit(setPassword)} onConfirm={edit(setConfirm)} label="새 비밀번호" disabled={busy} />
        {msg && <p role={msg.tone === "bad" ? "alert" : "status"} className="m-0 text-[13px]" style={{ color: msg.tone === "ok" ? "#0D7A64" : "#B4462B" }}>{msg.text}</p>}
        <button type="submit" disabled={busy || !password || !confirm} className="flex h-11 items-center justify-center rounded-[22px] border border-line-3 text-[14px] font-semibold text-ink disabled:text-faint">
          {busy ? "바꾸는 중…" : "비밀번호 변경"}
        </button>
      </form>
    </section>
  );
}
