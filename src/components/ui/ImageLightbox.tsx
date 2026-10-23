"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "./useFocusTrap";

export type LightboxItem = { id: string; name: string; /** 「84 KB」 */ sizeLabel: string; /** inline 서명 URL — undefined 면 받는 중, null 이면(서명 실패) 실패 상자 */ url?: string | null; svg: boolean };

type Props = {
  items: LightboxItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** 받기 — download 서명 URL 로 저장(D15: 「원본 열기」는 두지 않는다) */
  onDownload: (id: string) => void;
  /** <img> 가 못 불러오면(서명 만료) 한 번 다시 서명 */
  onRefresh?: (id: string) => void;
};

const SWIPE = 50;
const ROUND = "flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-disabled:opacity-35";

/**
 * 첨부 그림 크게 보기 (md-images 스펙 §4.3) — 한 노드의 그림들을 ←/→·스와이프로 넘긴다(끝에서 멈춤).
 * Esc·닫기·그림 밖 클릭으로 닫히고 연 요소로 포커스가 돌아간다. 그림은 <img> 로만(D15)
 */
export function ImageLightbox({ items, index, onIndex, onClose, onDownload, onRefresh }: Props) {
  const n = items.length;
  const i = Math.min(Math.max(index, 0), n - 1);
  const cur = items[i];
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onTrapKey = useFocusTrap(box);

  // 열린 동안: 바탕 스크롤·포커스 막기(inert), 닫히면 연 요소로 포커스 복귀
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const host = box.current?.closest<HTMLElement>("[data-image-lightbox]") ?? null;
    const others = Array.from(document.body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el !== host && !el.hasAttribute("inert"));
    others.forEach((el) => el.setAttribute("inert", ""));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      others.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  const go = (d: -1 | 1) => {
    const j = i + d;
    if (j >= 0 && j < n) onIndex(j);
  };
  // Esc·←/→ — 처리하면 기본 동작을 막는다(defaultPrevented 를 보는 바깥 Esc 처리가 다시 반응하지 않게)
  const onNavKey = (e: { key: string; defaultPrevented: boolean; preventDefault: () => void }) => {
    if (e.defaultPrevented) return false;
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") go(e.key === "ArrowLeft" ? -1 : 1);
    else return false;
    e.preventDefault();
    return true;
  };
  // 포커스가 상자 밖일 때(드물다) 대비 — 상자 안 키는 아래 onKeyDown 이 먼저 처리한다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => void onNavKey(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // 가로 스와이프 — 50px 이상, 세로로 더 움직였으면(스크롤·핀치) 무시. 스와이프 끝의 click 은 닫기로 치지 않는다
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const onPointerDown = (e: PointerEvent) => {
    start.current = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
    swiped.current = false;
  };
  const onPointerUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true;
      go(dx < 0 ? 1 : -1);
    }
  };

  // 그림 상태 — url 단위(다시 서명하면 새 url 이라 처음부터)
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const retried = useRef(new Set<string>());
  const onError = (it: LightboxItem) => {
    if (!it.url) return;
    if (onRefresh && !retried.current.has(it.id)) {
      retried.current.add(it.id);
      onRefresh(it.id);
    } else setBroken((s) => new Set(s).add(it.url!));
  };

  if (!cur) return null;
  const failed = cur.url === null || (!!cur.url && broken.has(cur.url));
  const label = `${i + 1}/${n} ${cur.name}`;
  return createPortal(
    <div data-image-lightbox className="fixed inset-0 z-50 overscroll-contain bg-black/85 motion-safe:animate-[lightbox-fade_.15s_ease-out]">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={`${cur.name} (${i + 1}/${n})`}
        onKeyDown={(e) => {
          // 포털이어도 React 이벤트는 연 화면(보기 상세)으로 올라간다 — 거기 Esc(← 연 곳)가 같이 돌지 않게 여기서 멈춘다
          if (onNavKey(e)) e.stopPropagation();
          else onTrapKey(e);
        }}
        onClick={(e) => {
          // 그림·버튼 밖(바탕)만 닫는다
          if (swiped.current) swiped.current = false;
          else if ((e.target as HTMLElement).closest("[data-lb-keep]") === null) onClose();
        }}
        className="flex h-full w-full flex-col text-white"
      >
        <div aria-live="polite" className="sr-only">
          {label}
        </div>
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
          <span className="text-[13px] tabular-nums text-white/80">
            {i + 1} / {n}
          </span>
          <button ref={closeRef} data-lb-keep type="button" aria-label="닫기" onClick={onClose} className={ROUND}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (start.current = null)} className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-4">
          {failed ? (
            <div data-lb-keep className="flex flex-col items-center gap-3 rounded-[12px] bg-white/10 px-6 py-5 text-[14px]">
              그림을 불러올 수 없어요
            </div>
          ) : (
            <>
              {!(cur.url && loaded.has(cur.url)) && <span aria-hidden="true" className="absolute h-8 w-8 rounded-full border-[3px] border-white/30 border-t-white motion-safe:animate-spin" />}
              {/* eslint-disable-next-line @next/next/no-img-element -- 서명 URL·SVG 는 next/image 최적화 대상이 아니다(스펙 D17) */}
              {cur.url && <img
                key={cur.url}
                data-lb-keep
                src={cur.url}
                alt={cur.name}
                decoding="async"
                draggable={false}
                onLoad={() => setLoaded((s) => new Set(s).add(cur.url!))}
                onError={() => onError(cur)}
                className={`max-h-[calc(100dvh-136px)] max-w-[calc(100vw-32px)] select-none object-contain ${cur.svg ? "rounded-[8px] bg-white p-4" : ""}`}
              />}
            </>
          )}
          {n > 1 && (
            <>
              <button data-lb-keep type="button" aria-label="이전 그림" aria-disabled={i === 0} onClick={() => go(-1)} className={`${ROUND} absolute left-2 top-1/2 -translate-y-1/2`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 6-6 6 6 6" />
                </svg>
              </button>
              <button data-lb-keep type="button" aria-label="다음 그림" aria-disabled={i === n - 1} onClick={() => go(1)} className={`${ROUND} absolute right-2 top-1/2 -translate-y-1/2`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
            </>
          )}
        </div>
        <div className="flex min-h-16 shrink-0 items-center gap-3 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-[10px]">
          <span data-lb-keep className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-semibold">{cur.name}</span>
            <span className="text-[12px] text-white/70">{cur.sizeLabel}</span>
          </span>
          <button data-lb-keep type="button" aria-label={`${cur.name} 받기`} onClick={() => onDownload(cur.id)} className="h-11 shrink-0 rounded-[22px] bg-white px-5 text-[14px] font-semibold text-[#1b2230] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            받기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
