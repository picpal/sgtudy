"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 한 페이지 스크롤에서 옆 열(내 스터디 목록·일정 요약·전체 스터디 목록)의 공통 규칙:
 * 화면 높이 안에 다 들어가면 sticky 로 붙고, 더 길면 붙이지 않고 페이지와 함께 스크롤한다(안쪽 스크롤바는 만들지 않는다).
 * 길이가 바뀌면(검색·접기·데이터) ResizeObserver 로, 창 높이가 바뀌면 resize 로 다시 잰다.
 * @param gap 위·아래 여백(px) — sticky top 과 같은 값
 */
export function useStickyFit<T extends HTMLElement>(gap = 36) {
  const ref = useRef<T>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setFits(el.offsetHeight + gap * 2 <= window.innerHeight);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    check();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [gap]);
  return [ref, fits] as const;
}

/** >900 에서만 붙인다(≤900 은 옆 열이 위·아래로 쌓인다). top-9 = 36px = useStickyFit 기본 gap(헤더→본문 간격) */
export const stickyAside = (fits: boolean) => (fits ? "min-[901px]:sticky min-[901px]:top-9" : "");
