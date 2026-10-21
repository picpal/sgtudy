"use client";

import { useCallback, type KeyboardEvent, type RefObject } from "react";

/** 대화상자 안에서 Tab 으로 갈 수 있는 것 — 링크·버튼·입력칸. tabIndex=-1(제목 포커스 자리)·비활성은 뺀다 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 포커스 트랩 (ConfirmDialog·공지 팝업 공용) — 돌려준 onKeyDown 을 대화상자 상자에 건다.
 * Tab/Shift+Tab 이 상자 안의 처음·끝에서 반대쪽 끝으로 돈다. 포커스가 상자 밖이거나 대상이 아닌 곳(제목)이면 방향에 따라 처음·끝으로
 */
export function useFocusTrap(box: RefObject<HTMLElement | null>) {
  return useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Tab") return;
      const els = Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const at = document.activeElement as HTMLElement | null;
      const inList = !!at && els.includes(at);
      if (e.shiftKey && (at === first || !inList)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !inList)) {
        e.preventDefault();
        first.focus();
      }
    },
    [box],
  );
}
