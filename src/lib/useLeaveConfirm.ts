"use client";

import { useCallback, useEffect, useState } from "react";
import { setLeaveGuard } from "./leaveGuard";

/**
 * 폼 화면용 이탈 확인 (Q2-1) — 저장 안 한 수정(dirty)이 있으면 헤더 메뉴·로고·화면 안 링크(GuardedLink)의 이동을 막고
 * 목적지를 pending 으로 보류한다. 화면은 pending 이 있으면 확인 대화상자를 띄우고 stay(계속 편집) / leave(버리고 이동 = go(href)) 를 부른다.
 * 새로고침·탭 닫기는 화면의 beforeunload 가 따로 맡는다.
 */
export function useLeaveConfirm(dirty: boolean, go: (href: string) => void) {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    return setLeaveGuard((href) => {
      setPending(href);
      return true;
    });
  }, [dirty]);
  const stay = useCallback(() => setPending(null), []);
  const leave = useCallback(() => {
    const href = pending;
    setPending(null);
    if (href) go(href);
  }, [pending, go]);
  return { pending, stay, leave };
}
