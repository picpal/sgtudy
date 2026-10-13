"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toApiError } from "@/lib/api/errors";
import { updateMe } from "@/lib/api/me";
import { AuthShell } from "./AuthShell";
import { NicknameField } from "./NicknameField";
import type { NickHint } from "./nickname";

export function OnboardingScreen({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [nick, setNick] = useState("");
  const [hint, setHint] = useState<NickHint>({ tone: "idle", text: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (hint.tone !== "ok") return;
    setBusy(true);
    setError("");
    try {
      await updateMe({ nickname: nick.trim() });
      router.replace(returnTo);
      router.refresh();
    } catch (err) {
      setBusy(false);
      setError(toApiError(err).message);
    }
  };

  return (
    <AuthShell title="닉네임을 정해 주세요" subtitle="스터디에서 이 이름으로 보여요. 나중에 내 프로필에서 바꿀 수 있어요.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <NicknameField value={nick} onChange={setNick} onHint={setHint} autoFocus />
        {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
        <button type="submit" disabled={busy || hint.tone !== "ok"} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">
          {busy ? "저장 중…" : "시작하기"}
        </button>
      </form>
    </AuthShell>
  );
}
