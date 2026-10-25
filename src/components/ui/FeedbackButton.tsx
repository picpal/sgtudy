"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { feedbackContext } from "@/lib/api/feedback";
import type { FeedbackContext } from "@/lib/api/types";
import { routes } from "@/lib/routes";
import { FEEDBACK_SENT_TEXT, FeedbackForm } from "./FeedbackForm";
import { markFeedbackOpened, takeFeedbackSent } from "./feedbackNav";
import { Toast, type ToastMsg } from "./Toast";
import { useFocusTrap } from "./useFocusTrap";

/** next.config 가 빌드 때 VERCEL_GIT_COMMIT_SHA 앞 7자로 채운다 — process.env.X 모양 그대로 써야 값이 들어간다 */
export const APP_COMMIT: string | undefined = process.env.NEXT_PUBLIC_APP_COMMIT;

/** Tailwind max-sm 과 같은 경계 */
const MOBILE_MQ = "(width < 40rem)";

/**
 * 헤더 벨 왼쪽 「의견 보내기」(0044, 스펙 2026-10-22-feedback-design). 로그인 분기에서만 그린다(D1).
 * 데스크톱: ConfirmDialog 모양 대화상자 — 포커스 트랩 · Esc/바깥 클릭 닫기(보내는 중엔 안 닫힘) · 닫히면 버튼으로 포커스.
 * < sm: /feedback 페이지로 간다 — iOS Safari 는 키보드가 뜨면 fixed 시트 아래로 뒤 페이지가 비쳐(visualViewport·WebKit 297779)
 * 일반 문서 흐름에 맡긴다. 보내고 돌아오면 여기서 토스트
 */
export function FeedbackButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<FeedbackContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMsg>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const onTrapKey = useFocusTrap(boxRef);
  const id = useId();

  const closeToast = useCallback(() => setToast(null), []);
  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  // 모바일 페이지에서 보내고 돌아왔으면 한 번 알린다
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 돌아온 뒤 한 번
    if (takeFeedbackSent()) setToast({ text: FEEDBACK_SENT_TEXT, tone: "ok" });
  }, []);

  const onOpen = () => {
    if (window.matchMedia?.(MOBILE_MQ).matches) {
      // 원래 화면 주소를 싣는다 — 함께 보내는 정보·돌아갈 곳의 기준
      const from = window.location.pathname + window.location.search;
      markFeedbackOpened(from);
      router.push(routes.feedback(from));
      return;
    }
    // 연 순간의 화면 정보를 찍어 둔다 — 보내기 전에 펼쳐 볼 수 있게
    setCtx(feedbackContext(window.location, navigator.userAgent, window.innerWidth, window.innerHeight, APP_COMMIT));
    setOpen(true);
  };

  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, close]);

  const onSent = () => {
    close();
    setToast({ text: FEEDBACK_SENT_TEXT, tone: "ok" });
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="의견 보내기"
        title="의견 보내기 · 버그 신고·제안·문의"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-line bg-surface"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1B2230" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5v6.5a1.5 1.5 0 0 1-1.5 1.5H8l-3.5 3v-3h0A1.5 1.5 0 0 1 3 11z" />
          <path d="M6.5 7.2h5M6.5 9.6h3" />
        </svg>
      </button>
      {open &&
        ctx &&
        createPortal(
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(27,34,48,.4)] p-4" onClick={() => !busy && close()}>
            <div
              ref={boxRef}
              onKeyDown={onTrapKey}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-desc`}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[calc(100dvh-32px)] w-full max-w-[440px] flex-col gap-4 overflow-y-auto rounded-[18px] bg-surface p-6 shadow-[0_20px_60px_rgba(27,34,48,.25)]"
            >
              <h2 id={`${id}-title`} className="m-0 text-[18px] font-bold">의견 보내기</h2>
              <p id={`${id}-desc`} className="-mt-3 mb-0 text-[14px] leading-[1.6] text-ink-2">불편한 점·버그·바라는 기능을 알려 주세요. 답이 필요하면 계정 이메일로 연락드려요.</p>
              <FeedbackForm id={id} ctx={ctx} autoFocus onSent={onSent} onCancel={close} onBusy={setBusy} />
            </div>
          </div>,
          document.body,
        )}
      <Toast msg={toast} onClose={closeToast} />
    </>
  );
}
