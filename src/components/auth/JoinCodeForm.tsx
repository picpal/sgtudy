"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toApiError } from "@/lib/api/errors";
import { codeInputView, isCodeShape, lookupInviteCode, normalizeCode, recruitErrorText } from "@/lib/api/recruit";

/** 초대 코드 입력 — 맞으면 /invite/{token} 랜딩으로 보낸다 */
export function JoinCodeForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(() => codeInputView(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isCodeShape(value)) {
      setError("8자리 코드를 모두 넣어 주세요");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await lookupInviteCode(normalizeCode(value));
      if (res.found) {
        router.push(res.url);
        return;
      }
      setError(res.remaining > 0 ? `맞는 코드가 없어요 · ${res.remaining}번 더 시도할 수 있어요` : "1시간 뒤에 다시 시도해 주세요");
    } catch (err) {
      const a = toApiError(err);
      setError(recruitErrorText(a.code, a.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <input
        value={value}
        onChange={(e) => {
          setValue(codeInputView(e.target.value));
          if (error) setError("");
        }}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        aria-label="초대 코드"
        aria-invalid={error ? true : undefined}
        placeholder="XXXX-XXXX"
        className="h-12 w-full rounded-[12px] border border-line-3 px-4 text-center font-mono text-[20px] tracking-[0.08em] text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE]"
      />
      {error && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
      <button type="submit" disabled={busy} className="h-12 w-full rounded-[24px] bg-navy text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">
        {busy ? "확인 중…" : "다음"}
      </button>
    </form>
  );
}
