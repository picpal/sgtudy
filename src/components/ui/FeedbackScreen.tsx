"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { feedbackContext } from "@/lib/api/feedback";
import type { FeedbackContext } from "@/lib/api/types";
import { safeReturnTo } from "@/lib/routes";
import { APP_COMMIT } from "./FeedbackButton";
import { FeedbackForm } from "./FeedbackForm";
import { clearFeedbackOpened, openedInApp, setFeedbackSent } from "./feedbackNav";

/** from 을 경로로 — 같은 사이트 경로만(아니면 홈). 비밀 쿼리 가리기는 feedbackContext 가 한다 */
function fromLocation(from: string | undefined): { pathname: string; search: string } {
  if (!from || !from.startsWith("/") || from.startsWith("//")) return { pathname: "/", search: "" };
  const u = new URL(from, "http://x");
  return { pathname: u.pathname, search: u.search };
}

/**
 * 모바일 의견 보내기 페이지(/feedback?from=). 모달 대신 일반 문서 흐름 — 키보드·주소 바는 브라우저가 처리한다.
 * 함께 보내는 정보의 「보던 화면」은 from(연 화면) 기준. 뒤로·보낸 뒤: 앱 안에서 왔으면 history.back, 직접 열었으면 from 으로
 */
export function FeedbackScreen({ from }: { from?: string }) {
  const router = useRouter();
  const id = useId();
  const [ctx, setCtx] = useState<FeedbackContext | null>(null);

  // 브라우저 정보는 마운트 뒤에만 읽을 수 있다
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window·navigator 는 마운트 뒤에만 있다
    setCtx(feedbackContext(fromLocation(from), navigator.userAgent, window.innerWidth, window.innerHeight, APP_COMMIT));
  }, [from]);

  const leave = () => {
    if (from && openedInApp(from)) {
      clearFeedbackOpened();
      router.back();
    } else router.replace(safeReturnTo(from));
  };
  const onSent = () => {
    setFeedbackSent();
    leave();
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="flex min-h-14 items-center gap-1 border-b border-line px-1">
        <button type="button" aria-label="뒤로" onClick={leave} className="flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-bg hover:text-ink">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18 9 12l6-6" />
          </svg>
        </button>
        <h1 id={`${id}-title`} className="m-0 text-[18px] font-bold">의견 보내기</h1>
      </header>
      <main aria-labelledby={`${id}-title`} className="mx-auto flex w-full max-w-[560px] flex-col gap-4 p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <p className="m-0 text-[14px] leading-[1.6] text-ink-2">불편한 점·버그·바라는 기능을 알려 주세요. 답이 필요하면 계정 이메일로 연락드려요.</p>
        {ctx && <FeedbackForm id={id} ctx={ctx} onSent={onSent} />}
      </main>
    </div>
  );
}
