"use client";

import { useEffect, useId, useRef, type KeyboardEvent } from "react";

type Action = { label: string; onClick: () => void; tone?: "danger" | "primary" };
type Props = { text: string; actions: Action[]; onCancel: () => void; cancelLabel?: string };

/**
 * 편집 패널 안의 확인 상자 (Q3-13): 열리면 첫 버튼(취소)으로 포커스 · 화면 안으로 스크롤 · Esc 취소 · Tab 은 상자 안에서만 돈다.
 */
export function InlineConfirm({ text, actions, onCancel, cancelLabel = "취소" }: Props) {
  const textId = useId();
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    first.current?.focus({ preventScroll: true });
  }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const btns = Array.from(box.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    if (btns.length === 0) return;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : i === btns.length - 1 ? 0 : i + 1;
    e.preventDefault();
    btns[next].focus();
  };
  return (
    <div ref={box} role="alertdialog" aria-label="확인" aria-describedby={textId} onKeyDown={onKey} className="flex scroll-my-4 flex-col gap-[10px] rounded-[12px] border border-[#F0C9C4] bg-[#FFF7F6] p-3">
      <span id={textId} className="text-[13px] leading-[1.6] text-ink-2">
        {text}
      </span>
      <div className="flex flex-wrap justify-end gap-2">
        <button ref={first} type="button" onClick={onCancel} className="h-[38px] rounded-[19px] border border-line-3 bg-surface px-[14px] text-[13px]">
          {cancelLabel}
        </button>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            className={`h-[38px] rounded-[19px] px-[14px] text-[13px] font-semibold ${a.tone === "danger" ? "bg-warn text-white" : a.tone === "primary" ? "bg-navy text-white" : "border border-line-3 bg-surface text-ink"}`}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
