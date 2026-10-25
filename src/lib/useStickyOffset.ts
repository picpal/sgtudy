"use client";

import { useEffect, type RefObject } from "react";

/**
 * 화면 위에 붙는 막대(sticky) 높이를 조상 요소의 CSS 변수로 싣는다 — 그 아래 편집기 툴바가 막대 밑에 붙게(--md-sticky-top, Q1-10).
 * 막대가 줄바꿈·확인 상자로 늘어나도 따라간다(ResizeObserver).
 */
export function useStickyOffset(bar: RefObject<HTMLElement | null>, host: RefObject<HTMLElement | null>, name = "--md-sticky-top"): void {
  useEffect(() => {
    const b = bar.current, el = host.current;
    if (!b || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => el.style.setProperty(name, `${b.offsetHeight}px`));
    ro.observe(b);
    return () => ro.disconnect();
  }, [bar, host, name]);
}

/**
 * 화면 맨 위에 붙은 막대에 data-stuck 을 단다. 모바일 Safari 는 상태바 쪽 위 띠 뒤로 본문이 비쳐 지나가므로,
 * 붙어 있는 동안만 막대 바탕을 위로 연장한다(STUCK_FILL) — 붙기 전에는 위 내용을 가리지 않는다.
 */
export const STUCK_FILL = "max-sm:data-[stuck]:shadow-[0_-64px_0_0_var(--surface)]";
export function useStuckAttr(bar: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const b = bar.current;
    if (!b) return;
    const upd = () => {
      if (b.getBoundingClientRect().top <= 0.5) b.setAttribute("data-stuck", "");
      else b.removeAttribute("data-stuck");
    };
    upd();
    window.addEventListener("scroll", upd, { passive: true });
    window.addEventListener("resize", upd);
    return () => {
      window.removeEventListener("scroll", upd);
      window.removeEventListener("resize", upd);
    };
  }, [bar]);
}
