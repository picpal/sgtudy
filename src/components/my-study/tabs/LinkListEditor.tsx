"use client";

import { useId, type KeyboardEvent } from "react";

type Props = {
  links: string[];
  input: string;
  onInput: (v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  /** index = null 이면 입력 칸 오류, 숫자면 그 링크 줄 오류(서버 INVALID_LINK) */
  error: { index: number | null; text: string } | null;
  disabled?: boolean;
};

/** 제출 링크 목록 편집 — 입력 + [추가](Enter 도, IME 조합 중 Enter 는 무시) · 줄마다 [빼기] (스펙 §2.3-2) */
export function LinkListEditor({ links, input, onInput, onAdd, onRemove, error, disabled }: Props) {
  const id = useId();
  const errId = `${id}-err`;
  const inputErr = error && error.index === null ? error.text : null;
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    onAdd();
  };
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={`${id}-in`} className="text-[12px] font-semibold text-ink-3">
        링크 (선택)
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${id}-in`}
          type="url"
          inputMode="url"
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
          placeholder="https://"
          aria-invalid={!!inputErr}
          aria-describedby={inputErr ? errId : undefined}
          className={`h-11 min-w-0 flex-[1_1_220px] rounded-[10px] border bg-surface px-3 text-[14px] text-ink ${inputErr ? "border-warn" : "border-line-3"}`}
        />
        <button type="button" onClick={onAdd} disabled={disabled} className="h-11 shrink-0 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink disabled:opacity-50">
          추가
        </button>
      </div>
      {inputErr && (
        <p id={errId} role="alert" className="m-0 text-[12px] font-medium text-warn">
          {inputErr}
        </p>
      )}
      {links.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {links.map((u, i) => {
            const bad = error?.index === i;
            return (
              <li key={u} className={`flex min-h-11 items-center gap-2 rounded-[10px] border px-3 py-1 ${bad ? "border-warn bg-warn-soft" : "border-line"}`}>
                <span className="min-w-0 flex-1 text-[14px] text-ink [overflow-wrap:anywhere]">
                  {u}
                  {bad && <span className="block text-[12px] font-medium text-warn">{error.text}</span>}
                </span>
                <button type="button" onClick={() => onRemove(i)} disabled={disabled} aria-label={`${u} 빼기`} className="h-11 shrink-0 rounded-[8px] px-3 text-[13px] font-semibold text-ink-3 hover:bg-surface-2 disabled:opacity-50">
                  빼기
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
