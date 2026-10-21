"use client";

import { useEffect, useRef, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { updateRoomEndDate } from "@/lib/api/leader";
import type { RoomDetail } from "@/lib/api/types";
import { DATE_NO_OVERFLOW_CLASS } from "@/components/room-new/fields";

type Props = {
  slug: string;
  /** 처음 채울 날짜 — 시작이 막혔으면 상한, 회차가 넘치면 마지막 회차 마감 */
  initial: string;
  min?: string;
  max?: string;
  /** 입력 아래 안내 한 줄 */
  hint?: string;
  onSaved: (d: RoomDetail) => void;
  onCancel: () => void;
};

/**
 * 방 종료일만 바꾸는 작은 폼 (room_update {endDate}, 그룹장 전용) — 방 설정 화면이 아직 없어 필요한 자리에서 바로 연다.
 * 그룹장 패널("지금 시작"이 1년 상한에 막힘)·진행목표/개요("기간 맞추기")가 같이 쓴다. 검사는 서버가 하고 문구를 그대로 보여 준다
 */
export function EndDateForm({ slug, initial, min, max, hint, onSaved, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const save = async () => {
    if (busy || !value) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await updateRoomEndDate(slug, value));
    } catch (e) {
      setError(toApiError(e).message || "종료일을 바꾸지 못했어요 · 잠시 후 다시 시도해 주세요");
      setBusy(false);
    }
  };

  return (
    <form
      data-end-date-form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onCancel();
      }}
      className="flex flex-col gap-2"
    >
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-3">
        새 종료일
        <input
          ref={input}
          type="date"
          required
          value={value}
          min={min}
          max={max}
          aria-invalid={!!error || undefined}
          onChange={(e) => setValue(e.target.value)}
          className={`h-11 rounded-[10px] border border-line-3 bg-surface px-3 text-[14px] font-normal text-ink ${DATE_NO_OVERFLOW_CLASS}`}
        />
      </label>
      {hint && <span className="text-[12px] leading-[1.5] text-muted">{hint}</span>}
      {error && (
        <span role="alert" className="text-[12px] leading-[1.5] text-warn">
          {error}
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !value} className="h-11 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white disabled:opacity-60">
          저장
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink disabled:opacity-60">
          취소
        </button>
      </div>
    </form>
  );
}
