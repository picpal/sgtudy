"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { withRound } from "./wrongNote";

/**
 * 오답노트 회차 상세 ↔ 주소 ?round= (D23). 주소가 원본 — 열기 = push(뒤로 가기 = 카드 목록), 닫기 = 이 화면이 쌓은 기록이면 back,
 * 새로고침·링크로 바로 열린 상세면 replace(아래 기록이 목록이라는 보장이 없다 — 커리큘럼 상세의 origin 복귀와 같은 규칙).
 * 같은 화면 안에서 쿼리만 바꾼다(Native History API — useSearchParams 가 따라온다, 서버 왕복 없음)
 */
export function useNoteRound(enabled = true) {
  const sp = useSearchParams();
  const round = enabled ? sp.get("round") || null : null;
  // 지금 상세 기록을 이 화면이 목록 기록 위에 쌓았는지 — history.state 는 Next 가 갈아 끼우므로 메모리에 둔다
  const pushed = useRef(false);
  useEffect(() => {
    // 뒤로·앞으로 가기 — 앞으로 가기로 돌아온 상세 기록은 목록 기록 위에 있다
    const onPop = () => void (pushed.current = new URLSearchParams(window.location.search).has("round"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const open = useCallback((id: string) => {
    pushed.current = true;
    window.history.pushState(null, "", withRound(window.location.href, id));
  }, []);
  const back = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else window.history.replaceState(null, "", withRound(window.location.href, null));
  }, []);
  return { round, open, back };
}
