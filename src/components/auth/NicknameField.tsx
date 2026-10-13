"use client";

import { useEffect, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { checkNickname } from "@/lib/api/me";
import type { NicknameCheck } from "@/lib/api/types";
import { useDebounced } from "@/lib/useDebounced";
import { nicknameHint, type NickHint } from "./nickname";

type Props = { value: string; onChange: (v: string) => void; original?: string; onHint: (h: NickHint) => void; autoFocus?: boolean };

const HINT_COLOR: Record<NickHint["tone"], string> = { idle: "#7A8594", checking: "#7A8594", ok: "#0D7A64", bad: "#B4462B" };

/** 결과는 검사한 값으로 키를 단다 — 값이 바뀌면 지난 결과는 지우지 않고 무시된다(C10: effect 안 동기 setState 없음). */
type Check = { v: string; r: NicknameCheck; error?: string };

export function NicknameField({ value, onChange, original, onHint, autoFocus }: Props) {
  const v = value.trim();
  const debounced = useDebounced(v, 300);
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => {
    if (nicknameHint(debounced, null, false, original).tone !== "checking") return;
    let live = true;
    checkNickname(debounced)
      .then((r) => live && setCheck({ v: debounced, r }))
      // E4: nickname_check 는 사유를 값으로 돌려주고, 던지는 건 AUTH_REQUIRED·네트워크뿐 — 메시지를 그대로 보여 준다
      .catch((e) => live && setCheck({ v: debounced, r: { available: false, reason: "invalid" }, error: toApiError(e).message }));
    return () => {
      live = false;
    };
  }, [debounced, original]);

  const mine = check?.v === v ? check : null;
  const base = nicknameHint(v, mine?.r ?? null, debounced !== v, original);
  const hint: NickHint = mine?.error && base.tone === "bad" ? { tone: "bad", text: mine.error } : base;
  useEffect(() => onHint(hint), [hint.tone, hint.text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
      닉네임
      <input
        type="text"
        autoFocus={autoFocus}
        autoComplete="nickname"
        maxLength={16}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={hint.tone === "bad"}
        aria-describedby="nick-hint"
        className="h-12 w-full rounded-[12px] border border-line-3 px-4 text-[15px] font-medium text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE]"
      />
      <span id="nick-hint" role="status" className="text-[12px] font-medium" style={{ color: HINT_COLOR[hint.tone] }}>
        {hint.text}
      </span>
    </label>
  );
}
