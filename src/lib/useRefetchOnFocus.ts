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
    const run = () => document.visibilityState !== "hidden" && ref.current();
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [on]);
}
