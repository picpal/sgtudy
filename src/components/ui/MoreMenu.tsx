"use client";

import { GuardedLink as Link } from "@/components/ui/GuardedLink";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type MoreMenuItem = { key: string; label: string; href?: string; onSelect?: () => void; danger?: boolean };

/**
 * 헤더 "더보기"(…) 버튼 + 메뉴. 44px 둥근 버튼, 항목도 44px.
 * 키보드: Enter/Space/↓ 로 열면 첫 항목, ↑/↓/Home/End 이동, Esc 닫고 버튼으로, Tab 은 닫으며 다음으로. 바깥 클릭 닫힘.
 * items 가 비면 버튼을 그리지 않는다.
 */
export function MoreMenu({ items, label = "더보기" }: { items: MoreMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusAt = (i: number) => {
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (els.length) els[(i + els.length) % els.length].focus();
  };
  // 열리면 첫 항목에 포커스
  useEffect(() => {
    if (open) focusAt(0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  if (items.length === 0) return null;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusAt(at + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(at - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAt(els.length - 1);
    } else if (e.key === "Tab") close(false);
  };
  const itemCls = (danger?: boolean) =>
    `flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-[14px] font-medium hover:bg-bg focus-visible:bg-bg ${danger ? "text-[#B4462B] hover:text-[#B4462B]" : "text-ink hover:text-ink"}`;

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#1B2230" aria-hidden="true">
          <circle cx="6" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="18" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div
          ref={box}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-[calc(100%+6px)] z-30 flex min-w-[180px] flex-col rounded-[14px] border border-line bg-surface p-[6px] shadow-[0_12px_32px_rgba(27,34,48,.16)]"
        >
          {items.map((it) =>
            it.href ? (
              <Link key={it.key} role="menuitem" tabIndex={-1} href={it.href} onClick={() => setOpen(false)} className={itemCls(it.danger)}>
                {it.label}
              </Link>
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  it.onSelect?.();
                }}
                className={itemCls(it.danger)}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
