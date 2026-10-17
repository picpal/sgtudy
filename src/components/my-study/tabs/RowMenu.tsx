"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { RowMove } from "../rounds";

type Props = { title: string; moves: RowMove[]; onMove: (m: RowMove) => void; disabled?: boolean };

/**
 * 편집 목록 과제·묶음 행의 "⋯ 옮기기" 메뉴 (Q2-4) — 드래그 핸들이 없는 390·키보드에서도 순서·회차를 바꾼다.
 * 누르는 자리 44px · 보이는 상자 32px(행의 "+"·삭제 버튼과 같은 모양). WAI-ARIA menu: 열면 첫 항목, ↑↓·Home·End, Esc 는 닫고 버튼으로, Tab 은 닫는다.
 * "다른 회차로" 항목 앞에는 소제목(메뉴 항목 아님)을 둔다.
 */
export function RowMenu({ title, moves, onMove, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  // 목록 상자가 overflow:hidden(둥근 모서리)이라 메뉴는 화면 기준(fixed)으로 띄운다 — 아래 자리가 모자라면 버튼 위로
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const items = () => Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const focusAt = (i: number) => {
    const els = items();
    if (els.length) els[(i + els.length) % els.length].focus();
  };
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    // 스크롤·크기 변경이면 자리가 어긋난다 — 닫는다(메뉴 안 스크롤은 제외)
    const onMove = (e: Event) => {
      if (!(e.target instanceof Node && box.current?.contains(e.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);
  const toggle = () => {
    if (open) return setOpen(false);
    const r = btn.current?.getBoundingClientRect();
    if (r) {
      const right = Math.max(8, window.innerWidth - r.right);
      setPos(window.innerHeight - r.bottom < 260 && r.top > window.innerHeight - r.bottom ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
    }
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = items().indexOf(document.activeElement as HTMLElement);
    const n = items().length;
    const to = e.key === "ArrowDown" ? at + 1 : e.key === "ArrowUp" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
    else if (to !== null) {
      e.preventDefault();
      focusAt(to);
    }
  };
  const label = `${title || "제목 없는 항목"} 옮기기`;
  const local = moves.filter((m) => !m.cross);
  const cross = moves.filter((m) => m.cross);
  const item = (m: RowMove) => (
    <button
      key={m.key}
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        close(true);
        onMove(m);
      }}
      className="flex min-h-11 w-full items-center whitespace-nowrap rounded-[10px] px-3 text-left text-[14px] font-medium text-ink hover:bg-bg focus-visible:bg-bg"
    >
      {m.label}
    </button>
  );
  return (
    <div className="shrink-0">
      <button
        ref={btn}
        type="button"
        data-row-menu
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled || moves.length === 0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            toggle();
          }
        }}
        className="group -mx-[6px] -my-1 flex h-11 w-11 items-center justify-center rounded-[11px] bg-transparent text-ink-3 disabled:text-ghost"
      >
        <span className={`flex h-8 w-8 items-center justify-center rounded-[9px] border group-disabled:border-line group-disabled:bg-[#F4F6F7] ${open ? "border-ink-3 bg-bg" : "border-line-3 bg-surface group-hover:border-ink-3"}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="6" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="18" cy="12" r="1.6" />
          </svg>
        </span>
      </button>
      {open && (
        <div
          ref={box}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          style={pos ?? undefined}
          className="fixed z-30 flex max-h-[min(60vh,420px)] min-w-[200px] flex-col overflow-y-auto rounded-[14px] border border-line bg-surface p-[6px] shadow-[0_12px_32px_rgba(27,34,48,.16)]"
        >
          {local.map(item)}
          {cross.length > 0 && (
            <div role="presentation" className={`px-3 pb-1 pt-2 text-[12px] font-semibold text-muted ${local.length ? "mt-1 border-t border-line-2" : ""}`}>
              다른 회차로
            </div>
          )}
          {cross.map(item)}
        </div>
      )}
    </div>
  );
}
