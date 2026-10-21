"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * ⓘ 설명 툴팁. 마우스는 올리면 보이고(hover), 터치·키보드는 눌러서 열고 닫는다(pinned).
 * Esc·바깥 누르기로 닫힘. 말풍선은 버튼 왼쪽 끝 기준으로 아래에 펼쳐지고 화면 폭을 넘지 않는다.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const box = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setPinned(false);
        setHover(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPinned(false);
      setHover(false);
      if (box.current?.contains(document.activeElement)) btn.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 터치는 pointerenter 를 흉내 내므로 마우스만 hover 로 친다
  const onHover = (v: boolean) => (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse") setHover(v);
  };

  return (
    <span ref={box} className="relative inline-flex" onPointerEnter={onHover(true)} onPointerLeave={onHover(false)}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={() => setPinned((p) => !p)}
        className="-my-[10px] inline-flex size-11 items-center justify-center rounded-full text-muted hover:text-ink-2 focus-visible:outline-2 focus-visible:outline-mint"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 w-max max-w-[min(240px,calc(100vw-48px))] rounded-[10px] bg-ink px-3 py-2 text-[12px] font-medium leading-[18px] text-white shadow-[0_6px_20px_rgba(27,34,48,.18)]"
        >
          {text}
        </span>
      )}
    </span>
  );
}
