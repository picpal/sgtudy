"use client";

import { useEffect, useRef } from "react";

/** on 인 동안 창으로 돌아오면(포커스 · 탭이 다시 보임) fn 을 부른다 — 승인 대기 화면이 승인을 놓치지 않게 (시나리오 QA #9) */
export function useRefetchOnFocus(on: boolean, fn: () => void): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!on) return;
    // 탭으로 돌아오면 focus 와 visibilitychange 가 함께 온다 — 1초 안의 두 번째는 건너뛴다
    let last = -Infinity;
    const run = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      ref.current();
    };
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [on]);
}
