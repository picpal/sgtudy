"use client";

import { useCallback, useEffect, useState } from "react";
import { isMobile } from "./AskAiPill";
import { readSelection, type SelectionPick } from "./selection";

export const SELECT_DEBOUNCE_MS = 250;
const SELECT_KEYS = new Set(["Shift", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

/**
 * 선택 감지(D3) — document selectionchange 를 250ms 디바운스(마지막 것만) + keyup(Shift+화살표 선택 끝) 보조.
 * 위치는 선택이 확정된 그 순간 readSelection 이 한 번 잰다. 스크롤 리스너로 다시 계산하지 않는다(ed3a2a5 — Safari 크래시 이력):
 * 데스크톱(선택 위 플로팅)만 pick 이 있는 동안 scroll(capture·passive·once)·resize(once) 를 걸어 첫 이벤트에 숨긴다 — 위치가 선택에 묶여 있어서.
 * 모바일 하단 고정 막대는 위치가 선택과 무관하므로 스크롤로 숨기지 않는다(iOS 길게 눌러 선택 중 미세 스크롤·핸들 드래그·주소창 접힘 resize 로
 * 바로 사라지던 문제). 선택이 비면 selectionchange → readSelection 이 null 을 돌려 숨는다. clear 는 state 만 비운다(선택은 그대로)
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
