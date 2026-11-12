"use client";

import { useCallback, useEffect, useState } from "react";
import { isMobile } from "./AskAiPill";
import { readSelection, type SelectionPick } from "./selection";

export const SELECT_DEBOUNCE_MS = 250;
const SELECT_KEYS = new Set(["Shift", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

/**
 * 위치는 선택이 확정된 순간 한 번만 잰다 — 스크롤 리스너로 다시 계산하지 않는다(Safari 크래시 이력).
 * 데스크톱 플로팅은 위치가 선택에 묶여 있어 첫 scroll·resize 에 숨긴다. 모바일 하단 막대는 선택과 무관한 자리라 숨기지 않는다
 * (iOS 길게 눌러 선택 중 미세 스크롤·핸들 드래그·주소창 접힘 resize 로 바로 사라지던 문제). clear 는 state 만 비운다(선택은 그대로)
 */
export function useAskAiSelection(enabled: boolean): { pick: SelectionPick | null; clear: () => void } {
  const [pick, setPick] = useState<SelectionPick | null>(null);
  const clear = useCallback(() => setPick(null), []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => setPick(readSelection(document));
    const onSelection = () => {
      clearTimeout(timer);
      timer = setTimeout(read, SELECT_DEBOUNCE_MS);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.shiftKey && !SELECT_KEYS.has(e.key)) return;
      clearTimeout(timer);
      read();
    };
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("keyup", onKeyUp);
      setPick(null);
    };
  }, [enabled]);

  useEffect(() => {
    if (!pick || isMobile()) return;
    const hide = () => setPick(null);
    window.addEventListener("scroll", hide, { capture: true, passive: true, once: true });
    window.addEventListener("resize", hide, { once: true });
    return () => {
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [pick]);

  return { pick: enabled ? pick : null, clear };
}
