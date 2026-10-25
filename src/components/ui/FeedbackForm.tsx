"use client";

import { useEffect, useRef, useState } from "react";
import { toApiError } from "@/lib/api/errors";
import { FEEDBACK_KINDS, FEEDBACK_LIMITS, feedbackErrorText, submitFeedback, validateFeedback } from "@/lib/api/feedback";
import type { FeedbackContext, FeedbackKind } from "@/lib/api/types";

/** 함께 보내는 정보의 화면 이름 — 사용자에게 무엇이 붙는지 그대로 보여 준다(스펙 D5) */
const CTX_LABEL: Record<keyof FeedbackContext, string> = { path: "보던 화면", room: "스터디", userAgent: "브라우저", viewport: "화면 크기", appVersion: "앱 버전" };

/** 보낸 뒤 원래 화면 토스트 문구 — 모달·모바일 페이지 공통 */
export const FEEDBACK_SENT_TEXT = "보내 주셔서 고마워요 · 꼼꼼히 살펴볼게요";

/**
 * 의견 보내기 폼 본문(종류 칩·내용·함께 보내는 정보·보내기) — 데스크톱 모달과 모바일 /feedback 페이지가 같이 쓴다.
 * 제출·검증·오류 문구는 여기 한 곳. 보내는 중 여부는 onBusy 로 알려 준다(모달이 Esc·바깥 클릭을 막는 데 쓴다)
 */
export function FeedbackForm({
  id,
  ctx,
  autoFocus,
  onSent,
  onCancel,
  onBusy,
}: {
  id: string;
  ctx: FeedbackContext;
  autoFocus?: boolean;
  onSent: () => void;
  /** 있으면 보내기 옆에 「닫기」(모달) */
  onCancel?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("BUG");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  const setBusyBoth = (b: boolean) => {
    setBusy(b);
    onBusy?.(b);
  };

  const onSubmit = async () => {
    const bad = validateFeedback(message);
    if (bad) {
      setError(bad);
      textRef.current?.focus();
      return;
    }
    setBusyBoth(true);
    setError("");
    try {
      await submitFeedback(kind, message.trim(), ctx);
      setBusyBoth(false);
      onSent();
    } catch (e) {
      setError(feedbackErrorText(toApiError(e)));   // 입력은 그대로 둔다
      setBusyBoth(false);
    }
  };

  // 페이지(모바일): 보내기를 내용 바로 아래(문서 흐름)에 — 키보드가 떠도 조금만 내리면 닿는다. 모달: 맨 아래 닫기·보내기 줄
  const actions = (
    <div data-feedback-actions className="flex justify-end gap-2">
      {onCancel && (
        <button type="button" onClick={onCancel} disabled={busy} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-medium text-ink disabled:opacity-60">
          닫기
        </button>
      )}
      <button type="button" onClick={onSubmit} disabled={busy} className={`rounded-[22px] bg-navy px-4 text-[14px] font-semibold text-white disabled:opacity-60 ${onCancel ? "h-11" : "h-12 flex-1"}`}>
        {busy ? "보내는 중…" : "보내기"}
      </button>
    </div>
  );

  return (
    <>
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
      {!onCancel && actions}
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
      {onCancel && actions}
    </>
  );
}
