"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ExplainOut } from "@/lib/ai/explain/schema";
import { MarkdownView } from "@/components/my-study/MarkdownView";
import { useFocusTrap } from "@/components/ui/useFocusTrap";
import { COPY } from "./copy";

export type SheetState = { phase: "loading" } | { phase: "ok"; body: ExplainOut } | { phase: "error"; code: string; message: string; retryAfterSec?: number };

export const LOADING_STEP_MS = 3000;

type Props = {
  term: string;
  state: SheetState;
  onClose: () => void;
  onAskRelated: (t: string) => void;
  /** 닫은 뒤 포커스 자리(D18) — 알약은 이미 사라졌으니 선택이 있던 곳 */
  returnFocus: HTMLElement | null;
};

/**
 * 해설 대화상자(D6·D7·D18). 모바일 = 바텀시트(QuestionNavSheet 와 같은 결), 데스크톱(sm 이상) = 가운데 카드.
 * body 포털 · 어두운 바탕(누르면 닫힘) · Esc · 포커스 트랩 · 바탕 스크롤 잠금. 입력 요소 없음(키보드 fixed 함정 해당 없음)
 */
export function AskAiSheet({ term, state, onClose, onAskRelated, returnFocus }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const back = useRef(returnFocus);
  const onTrapKey = useFocusTrap(box);
  const tid = useId();

  useEffect(() => {
    head.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const target = back.current;
    return () => {
      document.body.style.overflow = overflow;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, []);
  const onEsc = useEffectEvent(() => onClose());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEsc();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const title = state.phase === "ok" && state.body.term ? state.body.term : term;

  return createPortal(
    <div data-ask-ai-backdrop className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(27,34,48,.4)] sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tid}
        aria-busy={state.phase === "loading"}
        onKeyDown={onTrapKey}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-48px)] w-full max-w-[560px] flex-col rounded-t-[18px] bg-surface shadow-[0_-8px_30px_rgba(27,34,48,.18)] motion-safe:animate-[notice-sheet_.22s_ease-out] sm:rounded-[18px] sm:shadow-[0_12px_40px_rgba(27,34,48,.22)] sm:motion-safe:animate-[notice-pop_.18s_ease-out]"
      >
        <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-3 sm:hidden" />
        <div className="flex shrink-0 items-start gap-2 border-b border-line-2 py-2 pl-4 pr-1 sm:pt-3">
          <div className="flex min-w-0 flex-col gap-[2px] py-1">
            <h2 id={tid} ref={head} tabIndex={-1} className="m-0 break-words text-[17px] font-bold text-ink outline-none">
              {title}
            </h2>
            <span className="text-[12px] text-ink-3">{COPY.subtitle}</span>
          </div>
          <button type="button" aria-label={COPY.close} onClick={onClose} className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-bg hover:text-ink">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="thin-scroll min-h-0 overflow-y-auto overscroll-contain px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
          {state.phase === "loading" ? (
            <Loading key={term} />
          ) : state.phase === "error" ? (
            <div role="alert" className="flex flex-col gap-1 rounded-[10px] bg-surface-2 px-3 py-3 text-[14px] text-ink-2">
              <p className="m-0">{state.message}</p>
              {state.retryAfterSec != null && state.retryAfterSec > 0 && <p className="m-0 text-[12px] text-ink-3">{COPY.retryAfter(state.retryAfterSec)}</p>}
            </div>
          ) : (
            <Body body={state.body} onAskRelated={onAskRelated} />
          )}
          <p className="m-0 mt-4 text-[11px] leading-[1.6] text-muted">{COPY.footnote}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Loading() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setStep(1), LOADING_STEP_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="m-0 text-[13px] text-ink-3">
        {step === 0 ? COPY.loading1 : COPY.loading2}
      </p>
      <div aria-hidden="true" className="flex flex-col gap-2 motion-safe:animate-pulse">
        <span className="h-4 w-11/12 rounded bg-line-3" />
        <span className="h-4 w-4/5 rounded bg-line-3" />
        <span className="h-4 w-3/5 rounded bg-line-3" />
      </div>
    </div>
  );
}

const sec = "m-0 text-[12px] font-bold text-ink-3";

function Body({ body, onAskRelated }: { body: ExplainOut; onAskRelated: (t: string) => void }) {
  if (body.kind === "not_term") return <p className="m-0 rounded-[10px] bg-surface-2 px-3 py-3 text-[14px] text-ink-2">{COPY.notTerm}</p>;
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <h3 className={sec}>{COPY.secOneLiner}</h3>
        <p className="m-0 text-[15px] font-semibold leading-[1.6] text-ink">{body.oneLiner}</p>
      </section>
      {body.inContext && (
        <section className="flex flex-col gap-1">
          <h3 className={sec}>{COPY.secInContext}</h3>
          <MarkdownView src={body.inContext} className="text-[14px] leading-[1.7]" />
        </section>
      )}
      {body.points.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className={sec}>{COPY.secPoints}</h3>
          <MarkdownView src={body.points.map((p) => `- ${p}`).join("\n")} className="text-[14px] leading-[1.7]" />
        </section>
      )}
      {body.related.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className={sec}>{COPY.secRelated}</h3>
          <div className="flex flex-wrap gap-2">
            {body.related.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onAskRelated(t)}
                className="flex min-h-11 items-center rounded-full border border-line-2 bg-surface px-4 text-[13px] font-semibold text-ink-2 hover:border-mint hover:bg-mint-soft hover:text-ink"
              >
                {t}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
