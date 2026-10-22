"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { FEEDBACK_KINDS, FEEDBACK_LIMITS, feedbackContext, feedbackErrorText, submitFeedback, validateFeedback } from "@/lib/api/feedback";
import type { FeedbackContext, FeedbackKind } from "@/lib/api/types";
import { Toast, type ToastMsg } from "./Toast";
import { useFocusTrap } from "./useFocusTrap";

/** next.config 가 빌드 때 VERCEL_GIT_COMMIT_SHA 앞 7자로 채운다 — process.env.X 모양 그대로 써야 값이 들어간다 */
const APP_COMMIT: string | undefined = process.env.NEXT_PUBLIC_APP_COMMIT;

/** 함께 보내는 정보의 화면 이름 — 사용자에게 무엇이 붙는지 그대로 보여 준다(스펙 D5) */
const CTX_LABEL: Record<keyof FeedbackContext, string> = { path: "보던 화면", room: "스터디", userAgent: "브라우저", viewport: "화면 크기", appVersion: "앱 버전" };

/**
 * 헤더 벨 왼쪽 「의견 보내기」(0044, 스펙 2026-10-22-feedback-design). 로그인 분기에서만 그린다(D1).
 * 대화상자는 ConfirmDialog 모양 — 포커스 트랩 · Esc/바깥 클릭 닫기(보내는 중엔 안 닫힘) · 닫히면 버튼으로 포커스
 */
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("BUG");
  const [message, setMessage] = useState("");
  const [ctx, setCtx] = useState<FeedbackContext | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMsg>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const onTrapKey = useFocusTrap(boxRef);
  const id = useId();

  const closeToast = useCallback(() => setToast(null), []);
  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  // 연 순간의 화면 정보를 찍어 둔다 — 보내기 전에 펼쳐 볼 수 있게
  const onOpen = () => {
    setCtx(feedbackContext(window.location, navigator.userAgent, window.innerWidth, window.innerHeight, APP_COMMIT));
    setError("");
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    textRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, close]);

  const onSubmit = async () => {
    const bad = validateFeedback(message);
    if (bad) {
      setError(bad);
      textRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await submitFeedback(kind, message.trim(), ctx!);
      setMessage("");
      setKind("BUG");
      close();
      setToast({ text: "보내 주셔서 고마워요 · 꼼꼼히 살펴볼게요", tone: "ok" });
    } catch (e) {
      setError(feedbackErrorText(toApiError(e)));   // 입력은 그대로 둔다
    } finally {
      setBusy(false);
    }
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
      {open && ctx && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(27,34,48,.4)] p-4" onClick={() => !busy && close()}>
          <div
            ref={boxRef}
            onKeyDown={onTrapKey}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-desc`}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[calc(100vh-32px)] w-full max-w-[440px] flex-col gap-4 overflow-y-auto rounded-[18px] bg-surface p-6 shadow-[0_20px_60px_rgba(27,34,48,.25)]"
          >
            <div className="flex flex-col gap-1">
              <h2 id={`${id}-title`} className="m-0 text-[18px] font-bold">의견 보내기</h2>
              <p id={`${id}-desc`} className="m-0 text-[14px] leading-[1.6] text-ink-2">불편한 점·버그·바라는 기능을 알려 주세요. 답이 필요하면 계정 이메일로 연락드려요.</p>
            </div>
            <div role="radiogroup" aria-label="종류" className="flex flex-wrap gap-2">
              {FEEDBACK_KINDS.map((k) => {
                const on = k.key === kind;
                return (
                  <button
                    key={k.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setKind(k.key)}
                    className={`h-11 rounded-[22px] border px-4 text-[14px] ${on ? "border-navy bg-navy font-semibold text-white" : "border-line-3 bg-surface font-medium text-ink"}`}
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor={`${id}-msg`} className="flex items-baseline justify-between text-[13px] font-semibold text-ink-2">
                내용
                <span className="text-[12px] font-medium text-muted" aria-hidden="true">
                  {message.length.toLocaleString()}/{FEEDBACK_LIMITS.messageMax.toLocaleString()}
                </span>
              </label>
              <textarea
                ref={textRef}
                id={`${id}-msg`}
                value={message}
                maxLength={FEEDBACK_LIMITS.messageMax}
                rows={6}
                placeholder="어느 화면에서 무엇을 했을 때 어떻게 됐는지 적어 주시면 빨리 고칠 수 있어요. 화면 캡처가 필요하면 내용에 적어 주세요"
                aria-invalid={!!error || undefined}
                aria-describedby={error ? `${id}-err` : undefined}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (error) setError("");
                }}
                className="min-h-[132px] w-full resize-y rounded-[12px] border border-line px-3 py-[10px] text-[14px] leading-[1.5] outline-none placeholder:text-faint focus:border-mint"
              />
              {error && (
                <p id={`${id}-err`} role="alert" className="m-0 text-[13px] font-medium text-danger">
                  {error}
                </p>
              )}
            </div>
            <details className="rounded-[12px] bg-bg px-3 text-[13px] text-ink-2">
              <summary className="flex min-h-11 cursor-pointer items-center font-semibold">함께 보내는 정보</summary>
              <dl className="m-0 flex flex-col gap-1 pb-3">
                {(Object.keys(CTX_LABEL) as (keyof FeedbackContext)[])
                  .filter((k) => ctx[k])
                  .map((k) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-[64px] shrink-0 text-muted">{CTX_LABEL[k]}</dt>
                      <dd className="m-0 min-w-0 break-all">{ctx[k]}</dd>
                    </div>
                  ))}
                <div className="flex gap-2">
                  <dt className="w-[64px] shrink-0 text-muted">계정</dt>
                  <dd className="m-0">로그인한 계정</dd>
                </div>
              </dl>
            </details>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink disabled:opacity-60">
                닫기
              </button>
              <button type="button" onClick={onSubmit} disabled={busy} className="h-11 rounded-[22px] bg-navy px-4 text-[14px] font-semibold text-white disabled:opacity-60">
                {busy ? "보내는 중…" : "보내기"}
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast msg={toast} onClose={closeToast} />
    </>
  );
}
