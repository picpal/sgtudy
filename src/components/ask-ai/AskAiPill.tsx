"use client";

import { createPortal } from "react-dom";
import { clampCp, cpLength } from "@/components/room-new/validate";
import { COPY } from "./copy";
import type { SelectionPick } from "./selection";

/** 모바일 판정(D4) — 640px 미만이면 하단 고정 막대 */
/* z: 공지 팝업(NoticePopup z-[45]) 안의 선택에서도 알약이 그 위에 떠야 한다 */
export const MOBILE_MQ = "(width < 40rem)";
export const PILL_W = 168;
export const HINT_W = 248;
const PILL_H = 44;
const GAP = 8;
const MOBILE_TERM_MAX = 18;

export const isMobile = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_MQ).matches;

/** 데스크톱 플로팅 위치 — 선택 위 가운데, 위가 모자라면 선택 아래. 가로는 화면 안으로 clamp(폭은 고정값, 측정 없음) */
export function pillPosition(rect: Pick<DOMRect, "top" | "bottom" | "left" | "width">, vw: number, w = PILL_W): { top: number; left: number } {
  const above = rect.top - PILL_H - GAP;
  const top = above < GAP ? rect.bottom + GAP : above;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - w / 2, GAP), Math.max(GAP, vw - w - GAP));
  return { top, left };
}

/**
 * 모바일 막대 자리 — iOS·Android 의 선택 메뉴(복사하기 등)는 선택 바로 위·아래에 뜨고 웹에서 끌 수 없다.
 * 선택이 화면 아래쪽 절반이면 막대를 위로 올려 겹치지 않게 한다. 위치는 선택이 확정된 순간 한 번만 본다(스크롤 리스너 없음 — ed3a2a5)
 */
export const barPlace = (rect: Pick<DOMRect, "top" | "bottom">, vh: number): "top" | "bottom" => ((rect.top + rect.bottom) / 2 > vh / 2 ? "top" : "bottom");
const BAR_POS = {
  top: "top-[calc(16px+env(safe-area-inset-top))]",
  bottom: "bottom-[calc(16px+env(safe-area-inset-bottom))]",
} as const;
const barCls = (rect: Pick<DOMRect, "top" | "bottom">) =>
  `pointer-events-none fixed inset-x-0 ${BAR_POS[barPlace(rect, window.innerHeight)]} z-[46] flex justify-center px-4`;

const short = (t: string) => (cpLength(t) > MOBILE_TERM_MAX ? `${clampCp(t, MOBILE_TERM_MAX)}…` : t);

/**
 * 「AI에게 물어보기」 알약(D4·D5·D18). 데스크톱 = 선택 위 플로팅, 모바일 = 화면 아래 고정 막대(네이티브 콜아웃과 겹치지 않게).
 * 누를 때 선택이 풀리지 않게 pointerdown 만 막는다 — 용어는 이미 state 에 있으니 풀려도 동작한다
 */
export function AskAiPill({ pick, onAsk }: { pick: SelectionPick; onAsk: () => void }) {
  const mobile = isMobile();
  if (pick.tooLong) return <TooLongHint pick={pick} mobile={mobile} />;
  const common = {
    type: "button" as const,
    "aria-label": COPY.pillAria,
    onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: onAsk,
  };
  const icon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  );
  if (mobile) {
    return createPortal(
      <div data-ask-ai-pill="bar" className={barCls(pick.rect)}>
        <button {...common} className="pointer-events-auto flex min-h-11 max-w-full items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-surface shadow-[0_6px_20px_rgba(27,34,48,.28)]">
          {icon}
          <span className="truncate">{COPY.pillMobile(short(pick.term))}</span>
        </button>
      </div>,
      document.body,
    );
  }
  const { top, left } = pillPosition(pick.rect, window.innerWidth);
  return createPortal(
    <button
      {...common}
      data-ask-ai-pill="float"
      style={{ top, left, width: PILL_W }}
      className="fixed z-[46] flex h-11 items-center justify-center gap-[6px] rounded-full bg-ink text-[14px] font-semibold text-surface shadow-[0_6px_20px_rgba(27,34,48,.28)]"
    >
      {icon}
      {COPY.pill}
    </button>,
    document.body,
  );
}

/** 40자 초과 선택 — 버튼이 갑자기 안 뜨는 것처럼 보이지 않게 같은 자리에 안내만(누를 것 없음, 스크린리더엔 status) */
function TooLongHint({ pick, mobile }: { pick: SelectionPick; mobile: boolean }) {
  const cls = "flex items-center justify-center rounded-full bg-surface-2 px-4 text-[13px] font-medium text-ink-2 shadow-[0_6px_20px_rgba(27,34,48,.18)]";
  if (mobile) {
    return createPortal(
      <div data-ask-ai-pill="bar" className={barCls(pick.rect)}>
        <p role="status" data-ask-ai-hint className={`m-0 min-h-11 max-w-full ${cls}`}>{COPY.tooLong}</p>
      </div>,
      document.body,
    );
  }
  const { top, left } = pillPosition(pick.rect, window.innerWidth, HINT_W);
  return createPortal(
    <p role="status" data-ask-ai-pill="float" data-ask-ai-hint style={{ top, left, width: HINT_W }} className={`pointer-events-none fixed z-[46] m-0 h-11 ${cls}`}>
      {COPY.tooLong}
    </p>,
    document.body,
  );
}
