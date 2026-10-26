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
