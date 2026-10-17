"use client";

import { useEffect, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { checkNickname } from "@/lib/api/me";
import type { NicknameCheck } from "@/lib/api/types";
import { useDebounced } from "@/lib/useDebounced";
import { NICK_INPUT_MAX, nicknameHint, type NickHint } from "./nickname";

type Props = { value: string; onChange: (v: string) => void; original?: string; onHint: (h: NickHint) => void; autoFocus?: boolean };

const HINT_COLOR: Record<NickHint["tone"], string> = { idle: "#7A8594", checking: "#7A8594", ok: "#0D7A64", bad: "#B4462B" };

/**
 * 결과는 검사 요청 키(입력 세대 gen + 값)로 단다. 입력할 때마다 gen 이 올라가므로 같은 값으로 돌아와도
 * 지난 결과는 재검사 결과가 올 때까지 쓰이지 않는다(낡은 available 로 저장 버튼이 켜지지 않게).
 * C10: effect 안 동기 setState 없음 — gen 은 이벤트 핸들러에서만 올린다.
 */
type Check = { key: string; r: NicknameCheck; error?: string };

export function NicknameField({ value, onChange, original, onHint, autoFocus }: Props) {
  const v = value.trim();
  const [gen, setGen] = useState(0);
  const key = `${gen}\n${v}`;
  const dKey = useDebounced(key, 300);
  const debounced = dKey.slice(dKey.indexOf("\n") + 1);
  const [check, setCheck] = useState<Check | null>(null);

  useEffect(() => {
    if (nicknameHint(debounced, null, false, original).tone !== "checking") return;
    let live = true;
    checkNickname(debounced)
      .then((r) => live && setCheck({ key: dKey, r }))
      // E4: nickname_check 는 사유를 값으로 돌려주고, 던지는 건 AUTH_REQUIRED·네트워크뿐 — 메시지를 그대로 보여 준다
      .catch((e) => live && setCheck({ key: dKey, r: { available: false, reason: "invalid" }, error: toApiError(e).message }));
    return () => {
      live = false;
    };
  }, [dKey, debounced, original]);

  const mine = check?.key === key ? check : null;
  const base = nicknameHint(v, mine?.r ?? null, dKey !== key, original);
  const hint: NickHint = mine?.error && base.tone === "bad" ? { tone: "bad", text: mine.error } : base;
  useEffect(() => onHint(hint), [hint.tone, hint.text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
      닉네임
      <input
        type="text"
        autoFocus={autoFocus}
        autoComplete="nickname"
        maxLength={NICK_INPUT_MAX}
        value={value}
        onChange={(e) => {
          setGen((g) => g + 1);
          onChange(e.target.value);
        }}
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
