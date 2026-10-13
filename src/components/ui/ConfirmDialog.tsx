"use client";

import { useEffect, useRef } from "react";

type Props = { open: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void };

export function ConfirmDialog({ open, title, body, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // 열릴 때만 포커스 — 부모 재렌더(busy 등)로 포커스가 "돌아가기" 로 튀지 않게 open 에만 묶는다
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  // 처리 중(busy)에는 Esc·바깥 클릭으로 닫히지 않는다
  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(27,34,48,.4)] p-4" onClick={() => !busy && onCancel()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="cd-title" aria-describedby="cd-body" onClick={(e) => e.stopPropagation()} className="flex w-full max-w-[400px] flex-col gap-3 rounded-[18px] bg-surface p-6 shadow-[0_20px_60px_rgba(27,34,48,.25)]">
        <h2 id="cd-title" className="m-0 text-[18px] font-bold">{title}</h2>
        <p id="cd-body" className="m-0 text-[14px] leading-[1.6] text-ink-2">{body}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink">돌아가기</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="h-11 rounded-[22px] px-4 text-[14px] font-semibold text-white disabled:opacity-60" style={{ background: danger ? "#B4462B" : "#22264B" }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
