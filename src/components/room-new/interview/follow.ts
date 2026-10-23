"use client";

import { useEffect, useRef, type RefObject } from "react";

/* 대화 자동 따라가기(§9) — 문서가 스크롤된다(안쪽 스크롤 없음). 맨 아래 말·칩(end)이 sticky 입력 막대(bar) 위에 보이게 창을 내린다.
   막대는 sticky 라 늘 화면 안에 있어서 막대에 scrollIntoView 를 걸면 아무 일도 없다 — 그래서 직접 잰다 */

/** 하단 근처로 보는 거리(px) — 이 안에 있을 때만 새 말을 따라간다 */
export const NEAR_PX = 80;
/** 마지막 말과 막대 사이 여백 */
export const GAP_PX = 12;

/** 보이는 아래 끝 — 막대 윗변과 화면(키보드가 올라오면 visualViewport) 아래 끝 중 위쪽 */
export function viewBottom(barTop: number | null, viewportBottom: number): number {
  return barTop == null ? viewportBottom : Math.min(barTop, viewportBottom);
}

/** 맨 아래 내용이 보이려면 더 내려야 하는 거리(0 이하면 이미 보임) */
export function followDelta(endBottom: number, bottom: number, gap = GAP_PX): number {
  return endBottom + gap - bottom;
}

/** 사용자가 하단 근처에 있는가 — 맨 아래 내용이 보이는 끝에서 NEAR_PX 안쪽으로 가려져 있으면 근처 */
export function isNear(endBottom: number, bottom: number, near = NEAR_PX): boolean {
  return followDelta(endBottom, bottom, 0) <= near;
}

/** 실제로 내릴 거리 — 문서 끝(maxTop) 을 넘지 않고, 위로는 올리지 않는다 */
export function scrollStep(delta: number, top: number, maxTop: number): number {
  return Math.max(0, Math.min(delta, maxTop - top));
}

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const scroller = () => document.scrollingElement ?? document.documentElement;
const INTENT = ["wheel", "touchmove", "keydown", "mousedown"] as const;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
const vport = () => (typeof visualViewport !== "undefined" ? visualViewport : null);

type Els = { end: RefObject<HTMLElement | null>; bar: RefObject<HTMLElement | null> };
type Pin = { pinned: boolean; userAt: number; lastTop: number };

function measure({ end, bar }: Els) {
  if (!end.current) return null;
  const vv = vport();
  const b = bar.current?.getBoundingClientRect();
  return { endBottom: end.current.getBoundingClientRect().bottom, bottom: viewBottom(b ? b.top : null, vv ? vv.offsetTop + vv.height : window.innerHeight) };
}

function follow(els: Els, pin: Pin) {
  if (!pin.pinned) return;
  const m = measure(els);
  if (!m) return;
  const se = scroller();
  const step = scrollStep(followDelta(m.endBottom, m.bottom), se.scrollTop, se.scrollHeight - se.clientHeight);
  if (step < 1) return;
  window.scrollBy({ top: step, behavior: reduced() ? "auto" : "smooth" });
}

/**
 * signal 이 바뀔 때(말 추가·생각 중·칩 도착 등)와 대화 높이가 바뀔 때 맨 아래(end)로 따라간다.
 * 사용자가 위로 올려 보고 있으면 따라가지 않는다. 반환한 force() 는 사용자가 직접 답을 보낸 순간 — 위치와 상관없이 따라가기를 켠다.
 * 포커스는 건드리지 않는다.
 */
export function useFollowBottom(end: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, signal: string) {
  const pin = useRef<Pin>({ pinned: true, userAt: 0, lastTop: 0 });

  useEffect(() => {
    const els = { end, bar };
    const p = pin.current;
    // 따라가기는 사용자가 직접 스크롤했을 때만 끄고 켠다(휠·터치·스크롤 키·스크롤바). 말풍선이 바뀌며 문서 높이가 줄어
    // 생기는 브라우저 보정 스크롤이나, 칩을 누른 뒤 우리가 내리는 부드러운 스크롤로는 판단하지 않는다
    const intent = (e: Event) => {
      if (e instanceof KeyboardEvent && (!SCROLL_KEYS.has(e.key) || (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")))) return;
      if (e.type === "mousedown" && e.target !== document.documentElement) return; // 스크롤바만
      p.userAt = Date.now();
    };
    const onScroll = () => {
      const top = scroller().scrollTop;
      const up = top < p.lastTop;
      p.lastTop = top;
      if (Date.now() - p.userAt > 600) return;
      const m = measure(els);
      if (!m) return;
      // 위로 올리면 하단 근처일 때만 남고, 아래로 내려 근처에 오면 다시 따라간다
      p.pinned = up ? isNear(m.endBottom, m.bottom) : p.pinned || isNear(m.endBottom, m.bottom);
    };
    // 칩·말풍선이 늦게 자리를 잡거나(글꼴·줄바꿈) 모바일 키보드로 보이는 높이가 바뀌어도 따라간다
    const run = () => follow(els, p);
    p.lastTop = scroller().scrollTop;
    for (const t of INTENT) window.addEventListener(t, intent, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    const box = end.current?.parentElement;
    const ro = box && typeof ResizeObserver === "function" ? new ResizeObserver(run) : null;
    if (box) ro?.observe(box);
    const vv = vport();
    vv?.addEventListener("resize", run);
    return () => {
      for (const t of INTENT) window.removeEventListener(t, intent);
      window.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      vv?.removeEventListener("resize", run);
    };
  }, [end, bar]);

  useEffect(() => {
    // 커밋 직후 바로 잰다(같은 커밋의 칩까지 포함) — 프레임을 기다리면 창이 가려져 있을 때 늦거나 빠진다
    follow({ end, bar }, pin.current);
  }, [signal, end, bar]);

  return () => {
    pin.current.pinned = true;
  };
}
