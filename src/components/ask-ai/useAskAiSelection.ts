"use client";

import { useCallback, useEffect, useState } from "react";
import { readSelection, type SelectionPick } from "./selection";

export const SELECT_DEBOUNCE_MS = 250;
const SELECT_KEYS = new Set(["Shift", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

/**
 * 선택 감지(D3) — document selectionchange 를 250ms 디바운스(마지막 것만) + keyup(Shift+화살표 선택 끝) 보조.
 * 위치는 선택이 확정된 그 순간 readSelection 이 한 번 잰다. 스크롤 리스너로 다시 계산하지 않는다(ed3a2a5 — Safari 크래시 이력):
 * pick 이 있는 동안만 scroll(capture·passive·once)·resize(once) 를 걸어 첫 이벤트에 숨기기만 한다. clear 는 state 만 비운다(선택은 그대로)
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
    if (!pick) return;
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
