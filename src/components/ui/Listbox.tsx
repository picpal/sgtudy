"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type ListboxTone = "mint" | "slate" | "muted";
export type ListboxOption = {
  value: string;
  /** 한 줄 제목 (버튼에도 이 글이 보인다) */
  label: string;
  /** 제목 아래 작은 글 — 기간 등 */
  sub?: string;
  /** 오른쪽 작은 꼬리표 — 진행 상태 등 */
  tag?: { text: string; tone: ListboxTone };
};

const TAG: Record<ListboxTone, string> = {
  mint: "bg-mint-soft text-mint-deep",
  slate: "bg-slate-soft text-slate-text",
  muted: "bg-line-2 text-muted",
};

function Tag({ tag }: { tag: NonNullable<ListboxOption["tag"]> }) {
  return <span className={`shrink-0 whitespace-nowrap rounded-[6px] px-[7px] py-[2px] text-[11px] font-bold ${TAG[tag.tone]}`}>{tag.text}</span>;
}

/**
 * 단일 선택 드롭다운 (WAI-ARIA listbox). 기본 select 대신 앱 디자인으로 그린다.
 * - 버튼: Enter/Space/↓/↑ 로 열기. 목록: ↑/↓/Home/End 이동, Enter/Space 고르기, Esc 닫고 버튼으로, Tab 닫기, 글자 입력으로 찾아가기.
 * - 바깥을 누르면 닫힌다. 열 때 고른 항목이 보이도록 스크롤한다.
 * - sm 이상: 버튼 아래 팝오버(최대 높이 + 스크롤). 좁은 폭(<640): 화면 아래에서 올라오는 시트 — 가로로 넘치지 않는다.
 */
export function Listbox({
  label,
  prefix,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
  describedBy,
  align = "right",
}: {
  /** 버튼·목록의 접근성 이름 (모바일 시트 제목으로도 쓴다) */
  label: string;
  /** 버튼 왼쪽에 보이는 작은 글 (예: "회차") */
  prefix?: ReactNode;
  value: string;
  options: ListboxOption[];
  onChange: (value: string) => void;
  className?: string;
  /** 고를 수 없다(잠김) — 포커스는 남기고 열지 않는다(aria-disabled) */
  disabled?: boolean;
  /** 잠긴 이유 등 버튼 설명 id */
  describedBy?: string;
  /** sm 이상 팝오버를 버튼의 어느 끝에 맞출지 — 줄 왼쪽에 놓인 좁은 버튼은 "left" (팝오버가 화면 왼쪽 밖으로 나가지 않게) */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-opt-${i}`;
  const selIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selIndex];

  const openAt = (i: number) => {
    setActive(i);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    close(true);
    if (o && o.value !== value) onChange(o.value);
  };

  // 열리면 목록에 포커스
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);
  // 활성 항목이 보이도록
  useEffect(() => {
    if (!open) return;
    document.getElementById(optId(active))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);
  // 바깥 누르면 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open || disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAt(selIndex);
    }
  };
  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.min(last, Math.max(0, i)));
    };
    if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(last);
    else if (e.key === "PageDown") move(active + 5);
    else if (e.key === "PageUp") move(active - 5);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") close(false);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // 글자 찾기 — 0.5초 안에 이어 친 글자는 이어 붙여 찾는다
      const now = e.timeStamp;
      const text = (now - typed.current.at < 500 ? typed.current.text : "") + e.key.toLowerCase();
      typed.current = { text, at: now };
      const n = options.length;
      for (let k = 1; k <= n; k++) {
        const i = (active + (text.length > 1 ? 0 : 1) + k - 1) % n;
        if (options[i].label.toLowerCase().startsWith(text)) {
          setActive(i);
          break;
        }
      }
    }
  };

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${selected?.label ?? ""}`}
        aria-disabled={disabled || undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? close(false) : !disabled && openAt(selIndex))}
        onKeyDown={onButtonKey}
        className={`relative flex h-11 w-full min-w-0 items-center gap-2 rounded-[12px] border bg-surface pl-3 pr-[10px] text-left text-[13px] transition-[border-color,box-shadow] duration-150 before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] hover:border-line-dash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint/40 aria-disabled:cursor-default aria-disabled:bg-surface-2 aria-disabled:opacity-70 aria-disabled:hover:border-line-3 sm:h-10 ${
          open ? "border-mint shadow-[0_0_0_3px_rgba(13,122,100,.12)]" : "border-line-3"
        }`}
      >
        {prefix && <span className="shrink-0 font-medium text-ink-2">{prefix}</span>}
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{selected?.label}</span>
        {selected?.tag && <Tag tag={selected.tag} />}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          {/* 좁은 폭: 뒤를 어둡게 — 누르면 바깥 누름으로 닫힌다 */}
          <div aria-hidden="true" className="fixed inset-0 z-40 bg-[rgba(27,34,48,.32)] sm:hidden" />
          <div
            ref={panel}
            data-listbox-panel=""
            className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col rounded-t-[20px] border border-line bg-surface pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-12px_32px_rgba(27,34,48,.18)] sm:absolute sm:inset-x-auto sm:bottom-auto ${align === "left" ? "sm:left-0" : "sm:right-0"} sm:top-[calc(100%+6px)] sm:z-30 sm:max-h-[min(360px,60vh)] sm:w-[340px] sm:min-w-full sm:rounded-[14px] sm:pb-0 sm:shadow-[0_12px_32px_rgba(27,34,48,.16)]`}
          >
            <div className="flex shrink-0 flex-col items-center gap-2 px-4 pb-1 pt-2 sm:hidden">
              <span aria-hidden="true" className="h-1 w-10 rounded-full bg-line-3" />
              <span className="self-start text-[15px] font-bold text-ink">{label}</span>
            </div>
            <ul
              ref={list}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={label}
              aria-activedescendant={optId(active)}
              onKeyDown={onListKey}
              className="m-0 flex min-h-0 list-none flex-col gap-[2px] overflow-y-auto overscroll-contain p-[6px] outline-none"
            >
              {options.map((o, i) => {
                const on = o.value === selected?.value;
                return (
                  <li
                    key={o.value}
                    id={optId(i)}
                    role="option"
                    aria-selected={on}
                    onPointerMove={() => active !== i && setActive(i)}
                    onClick={() => choose(i)}
                    className={`flex min-h-11 cursor-pointer items-center gap-[10px] rounded-[10px] px-3 py-2 ${i === active ? "bg-bg" : ""} ${on ? "text-mint-deep" : "text-ink"}`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                      <span className={`truncate text-[14px] ${on ? "font-bold" : "font-semibold"}`}>{o.label}</span>
                      {o.sub && <span className="text-[12px] font-medium text-muted">{o.sub}</span>}
                    </span>
                    {o.tag && <Tag tag={o.tag} />}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-mint ${on ? "" : "invisible"}`}>
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
