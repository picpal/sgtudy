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
/** 확대 배율 — 최대 4배, 버튼·키는 1.5배씩, 두 번 누르기는 2.5배 */
const MAX_ZOOM = 4;
const STEP = 1.5;
const TAP_ZOOM = 2.5;
type Zoom = { s: number; x: number; y: number };
const ONE: Zoom = { s: 1, x: 0, y: 0 };
const clampN = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
type Geo = { stage: HTMLElement | null; img: HTMLElement | null };
/** 그림이 무대 밖으로 날아가지 않게 — 넘친 만큼만 옮길 수 있다(원래 크기면 가운데) */
function fit(g: Geo, s: number, x: number, y: number): Zoom {
  if (s <= 1 || !g.img || !g.stage) return ONE;
  const mx = Math.max(0, (g.img.offsetWidth * s - g.stage.clientWidth) / 2);
  const my = Math.max(0, (g.img.offsetHeight * s - g.stage.clientHeight) / 2);
  return { s, x: clampN(x, -mx, mx), y: clampN(y, -my, my) };
}
/** (px,py) 화면 점이 그 자리에 머물도록 배율을 s 로 — 점이 없으면 무대 가운데 */
function zoomAt(g: Geo, s: number, base: Zoom, px?: number, py?: number): Zoom {
  const r = g.stage?.getBoundingClientRect();
  const ns = clampN(s, 1, MAX_ZOOM);
  const cx = r && px !== undefined ? px - (r.left + r.width / 2) : 0;
  const cy = r && py !== undefined ? py - (r.top + r.height / 2) : 0;
  const k = ns / base.s;
  return fit(g, ns, cx - (cx - base.x) * k, cy - (cy - base.y) * k);
}
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

  // 확대(핀치·휠·두 번 누르기·버튼·+/- 키) — 그림이 바뀌면 원래 크기. 새 의존성 없이 pointer events 로만
  const id = cur?.id ?? "";
  const [zoomOf, setZoomOf] = useState<{ id: string; z: Zoom }>({ id, z: ONE });
  const zoom = zoomOf.id === id ? zoomOf.z : ONE;
  const zoomed = zoom.s > 1;
  const stage = useRef<HTMLDivElement>(null);
  const imgEl = useRef<HTMLImageElement>(null);
  const geo = (): Geo => ({ stage: stage.current, img: imgEl.current });
  // 손가락·마우스로 움직이는 중에는 transition 없이 바로 따라가게
  const [dragging, setDragging] = useState(false);
  /** 지금 배율에서 다음 배율로 — 연달은 휠·키도 잃지 않게 이전 상태에서 계산 */
  const update = (f: (z: Zoom, g: Geo) => Zoom) => {
    const g = geo();
    setZoomOf((p) => ({ id, z: f(p.id === id ? p.z : ONE, g) }));
  };
  const zoomBy = (k: number) => update((z, g) => zoomAt(g, z.s * k, z));

  // 휠·트랙패드 핀치(ctrl+휠) — React onWheel 은 passive 라 브라우저 확대를 못 막는다
  const canZoom = !!cur?.url;
  useEffect(() => {
    const el = stage.current;
    if (!el || !canZoom) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const g: Geo = { stage: el, img: el.querySelector("img") };
      setZoomOf((p) => {
        const z = p.id === id ? p.z : ONE;
        return { id, z: zoomAt(g, z.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), z, e.clientX, e.clientY) };
      });
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [id, canZoom]);

  const go = (d: -1 | 1) => {
    const j = i + d;
    if (j >= 0 && j < n) onIndex(j);
  };
  // Esc·←/→ — 처리하면 기본 동작을 막는다(defaultPrevented 를 보는 바깥 Esc 처리가 다시 반응하지 않게)
  const onNavKey = (e: { key: string; defaultPrevented: boolean; preventDefault: () => void }) => {
    if (e.defaultPrevented) return false;
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") go(e.key === "ArrowLeft" ? -1 : 1);
    else if (e.key === "+" || e.key === "=") zoomBy(STEP);
    else if (e.key === "-") zoomBy(1 / STEP);
    else if (e.key === "0") update(() => ONE);
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

  // 누르고 있는 포인터들 — 하나면 (확대 중) 옮기기·(원래 크기) 스와이프, 둘이면 핀치
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; z: Zoom; pinch?: { d: number; mx: number; my: number }; moved: boolean; multi: boolean; onImg: boolean } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  // 스와이프·옮기기 끝의 click 은 닫기로 치지 않는다
  const swiped = useRef(false);
  // 누른 곳이 그림·버튼(data-lb-keep)이었나 — null 이면 포인터 없이 온 click(키보드·스크립트)
  const pressedKeep = useRef<boolean | null>(null);
  const begin = (onImg = false) => {
    const p = [...pts.current.values()];
    const g = gesture.current;
    if (p.length >= 2) {
      const [a, b] = p;
      gesture.current = { x: a.x, y: a.y, z: zoom, pinch: { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }, moved: true, multi: true, onImg: false };
    } else if (p.length === 1) gesture.current = { x: p[0].x, y: p[0].y, z: zoom, moved: g?.moved ?? false, multi: g?.multi ?? false, onImg };
    else gesture.current = null;
  };
  const onPointerDown = (e: PointerEvent) => {
    // 버튼(이전·다음)은 그대로 눌리게 — 캡처하면 click 이 버튼에 가지 않는다
    if ((e.target as HTMLElement).closest("button")) return;
    if (pts.current.size === 0) gesture.current = null;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // 캡처 못 해도 옮기기는 된다
    }
    begin(e.target === imgEl.current);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.pinch) {
      const [a, b] = [...pts.current.values()];
      if (!b) return;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // 핀치 시작점 기준으로 배율을 바꾸고, 두 손가락 가운데가 움직인 만큼 옮긴다
      const pinch = g.pinch;
      setDragging(true);
      update((_, geo) => {
        const z = zoomAt(geo, g.z.s * (d / pinch.d), g.z, pinch.mx, pinch.my);
        return fit(geo, z.s, z.x + mx - pinch.mx, z.y + my - pinch.my);
      });
      return;
    }
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true;
    if (g.z.s > 1 && g.moved) {
      setDragging(true);
      update((_, geo) => fit(geo, g.z.s, g.z.x + dx, g.z.y + dy));
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.delete(e.pointerId);
    const g = gesture.current;
    setDragging(false);
    if (pts.current.size > 0) return begin(); // 핀치에서 손가락 하나만 뗐다 — 남은 손가락으로 이어서 옮긴다
    gesture.current = null;
    if (!g) return;
    if (g.multi) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    // 그림을 두 번 누르기(더블클릭·더블탭) — 원래 크기면 그 점으로 확대, 확대 중이면 원래 크기
    if (!g.moved && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) {
      const t = e.timeStamp, l = lastTap.current;
      if (!g.onImg) lastTap.current = null;
      else if (l && t - l.t < 350 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 30) {
        lastTap.current = null;
        const { clientX: x, clientY: y } = e;
        update((z, geo) => (z.s > 1 ? ONE : zoomAt(geo, TAP_ZOOM, ONE, x, y)));
      } else lastTap.current = { t, x: e.clientX, y: e.clientY };
      return;
    }
    swiped.current = true;
    lastTap.current = null;
    if (g.z.s > 1) return; // 확대 중 끌기는 옮기기 — 넘기지 않는다
    if (Math.abs(dx) >= SWIPE && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };
  const onPointerCancel = (e: PointerEvent) => {
    pts.current.delete(e.pointerId);
    setDragging(false);
    if (pts.current.size > 0) begin();
    else gesture.current = null;
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
    // 바탕은 처음부터 불투명 — 화면 전체에 opacity 페이드를 걸면 첫 프레임들(또는 탭이 가려져 애니메이션이 멈춘 동안)에
    // 반투명 그림 너머로 본문 그림이 겹쳐 보였다. z 는 상단 sticky 막대·토스트(z-50)보다 위
    <div data-image-lightbox className="fixed inset-0 z-[70] isolate overscroll-contain bg-[#0b0f17]">
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
        onPointerDownCapture={(e) => (pressedKeep.current = (e.target as HTMLElement).closest("[data-lb-keep]") !== null)}
        onClick={(e) => {
          // 그림·버튼 밖(바탕)을 누른 것만 닫는다 — 누른 곳으로 판단: 무대가 포인터를 캡처하면 그림을 눌러도 click 은 무대(바탕)로 온다
          const keep = pressedKeep.current ?? (e.target as HTMLElement).closest("[data-lb-keep]") !== null;
          pressedKeep.current = null;
          if (swiped.current) swiped.current = false;
          else if (!keep) onClose();
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
          <span className="flex items-center gap-2">
            {!failed && cur.url && (
              <>
                <button data-lb-keep type="button" aria-label="축소" aria-disabled={!zoomed} onClick={() => zoomBy(1 / STEP)} className={ROUND}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 12h12" />
                  </svg>
                </button>
                <span aria-live="polite" className="min-w-[3.2em] text-center text-[12px] tabular-nums text-white/80">
                  {Math.round(zoom.s * 100)}%
                </span>
                <button data-lb-keep type="button" aria-label="확대" aria-disabled={zoom.s >= MAX_ZOOM} onClick={() => zoomBy(STEP)} className={ROUND}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 12h12M12 6v12" />
                  </svg>
                </button>
              </>
            )}
          <button ref={closeRef} data-lb-keep type="button" aria-label="닫기" onClick={onClose} className={ROUND}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          </span>
        </div>
        {/* touch-none — 핀치가 페이지 확대가 아니라 그림 확대가 되게. 옮기기·스와이프·핀치는 위 포인터 처리가 한다 */}
        <div ref={stage} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden px-4">
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
                ref={imgEl}
                data-lb-keep
                src={cur.url}
                alt={cur.name}
                decoding="async"
                draggable={false}
                onLoad={() => setLoaded((s) => new Set(s).add(cur.url!))}
                onError={() => onError(cur)}
                style={zoomed ? { transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})` } : undefined}
                className={`max-h-[calc(100dvh-136px)] max-w-[calc(100vw-32px)] select-none object-contain ${dragging ? "" : "motion-safe:transition-transform motion-safe:duration-150"} ${zoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"} ${cur.svg ? "rounded-[8px] bg-white p-4" : ""}`}
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
