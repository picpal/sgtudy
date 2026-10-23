"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type Dispatch } from "react";
import type { Draft, Field } from "@/lib/ai/schema";
import { routes } from "@/lib/routes";
import { clampCp, cpLength } from "../validate";
import { postTurn } from "./api";
import { DraftCard } from "./DraftCard";
import { MultiChips, OtherInput, otherLabel, SingleChips } from "./Chips";
import { useFollowBottom } from "./follow";
import { toMessages, type Action, type InterviewState } from "./state";

/* AI 인터뷰 대화(§9) — 말풍선 + 칩 + 입력. 방은 만들지 않는다: 끝나면 [미리보기로] 가 수동 폼으로 넘긴다(D11) */

const INPUT_MAX = 500;
/** 건너뛰기가 되는 질문(필수가 아닌 칸) */
const OPTIONAL: readonly Field[] = ["style", "extra", "minMembers", "leaderDoesTasks", "descriptionMd", "rulesMd", "tags"];

export function InterviewPanel({ state, dispatch, draft, today, onDraft, onFinish, onManual, onBudgetExceeded }: {
  state: InterviewState;
  dispatch: Dispatch<Action>;
  /** 지금 폼 값으로 만든 초안(채운 칸만) */
  draft: Draft;
  today: string;
  onDraft: (d: Draft) => void;
  onFinish: () => void;
  onManual: () => void;
  onBudgetExceeded: (message: string) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [other, setOther] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(state.started);

  const run = async (messages: ReturnType<typeof toMessages>, answer: { field: Field; value: string } | null) => {
    const r = await postTurn({ draft, messages, answer });
    if (r.ok) {
      onDraft(r.data.draft);
      dispatch({ type: "turn", res: r.data });
      return;
    }
    if (r.err.status === 401) return router.push(routes.login(`${routes.createRoom()}?mode=ai`));
    if (r.err.error === "AI_BUDGET_EXCEEDED") return onBudgetExceeded(r.err.message);
    dispatch({ type: "fail", err: r.err });
  };

  // 첫 진입: 빈 대화로 첫 질문을 받는다. 이미 채운 칸은 초안으로 같이 가서 다시 묻지 않는다(D13)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    dispatch({ type: "start" });
    void run([], null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 1회
  }, []);
  useEffect(() => inputRef.current?.focus(), []);

  const send = (say: string, answer: { field: Field; value: string } | null = null) => {
    if (state.busy || !say.trim()) return;
    forceFollow(); // 직접 보낸 순간엔 위로 올려 보고 있었어도 맨 아래로
    const messages = [...toMessages(state), { role: "user" as const, text: clampCp(say.trim(), INPUT_MAX) }];
    dispatch({ type: "send", text: messages.at(-1)!.text, answer });
    setText("");
    setOther(false);
    void run(messages, answer);
  };
  const retry = () => {
    forceFollow();
    dispatch({ type: "retry" });
    void run(toMessages(state), state.lastAnswer);
  };

  const { ask, busy, error, done, limit } = state;
  const closed = limit || done;
  const showChips = !!ask && !busy && !error && !closed;
  const canSkip = !!ask && OPTIONAL.includes(ask.field);
  // 말 추가·생각 중·칩 도착·오류·직접 입력 열기 때마다 맨 아래(칩까지)를 입력 막대 위에 보이게 — 하단 근처일 때만
  const forceFollow = useFollowBottom(endRef, barRef, `${state.lines.length}|${busy}|${showChips}|${!!error}|${done}|${other}`);

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start lg:gap-6">
      {/* 카드는 이 그리드의 직접 자식 — 모바일 접힘 바가 대화 전체 높이 동안 위에 붙어 있게 */}
      <DraftCard draft={draft} dropped={state.dropped} onAskChange={(obj) => send(`${obj} 바꿀래요`)} disabled={busy || limit} />
      <section aria-label="AI 인터뷰" className="flex min-w-0 flex-col gap-3 lg:order-1">
        <p className="m-0 text-[12px] text-muted">대화는 저장되지 않고 AI 응답 생성에만 쓰여요.</p>
        <ol role="log" aria-live="polite" aria-relevant="additions" aria-label="인터뷰 대화" className="m-0 flex list-none flex-col gap-3 p-0">
          {state.lines.map((l) => (
            <li key={l.id} className={`flex ${l.role === "user" ? "justify-end" : "justify-start"}`}>
              <span className="sr-only">{l.role === "user" ? "나: " : "AI: "}</span>
              {/* 텍스트 노드로만 — 마크다운·HTML 해석 없음(§6) */}
              <p className={`m-0 max-w-[85%] whitespace-pre-wrap break-words rounded-[16px] px-4 py-3 text-[15px] leading-[1.55] ${l.role === "user" ? "bg-navy text-white" : "bg-surface-2 text-ink"}`}>{l.text}</p>
            </li>
          ))}
        </ol>
        {busy && (
          <p aria-busy="true" className="m-0 self-start rounded-[16px] bg-surface-2 px-4 py-3 text-[14px] text-muted">
            생각 중…<span className="sr-only"> AI 가 답을 쓰고 있어요</span>
          </p>
        )}

        {error && (
          <div role="alert" className="flex flex-col gap-2 self-start rounded-[16px] border border-line bg-surface px-4 py-3">
            <p className="m-0 text-[14px] text-warn">{error.message}</p>
            <RetryRow
              seconds={error.error === "RATE_LIMITED" && typeof error.details?.retryAfterSec === "number" ? (error.details.retryAfterSec as number) : 0}
              canRetry={error.error !== "AI_TURN_LIMIT" && !(error.error === "RATE_LIMITED" && Number(error.details?.retryAfterSec) > 600)}
              onRetry={retry}
              onManual={onManual}
              onFinish={limit && !state.missing.length && state.lines.length > 0 ? onFinish : undefined}
            />
          </div>
        )}

        {showChips && ask.options?.length && ask.kind === "multi" && (
          <MultiChips key={state.lines.length} options={ask.options} onDone={(ps) => send(ps.map((p) => p.label).join(", "), { field: ask.field, value: ps.map((p) => p.value).join(",") })} />
        )}
        {showChips && ask.kind !== "multi" && (ask.options?.length || ask.allowOther) && (
          <div className="flex flex-col gap-2">
            {!other && !!ask.options?.length && <SingleChips key={state.lines.length} ask={ask} onPick={(label, value) => send(label, { field: ask.field, value })} />}
            {ask.allowOther && ask.allowOther !== "text" && !other && (
              <button type="button" onClick={() => setOther(true)} className="inline-flex min-h-11 items-center self-start rounded-[22px] border border-dashed border-line-3 px-4 text-[14px] font-semibold text-ink-2">
                {ask.allowOther === "date" ? "날짜 직접 고르기" : "직접 입력"}
              </button>
            )}
            {other && ask.allowOther && ask.allowOther !== "text" && (
              <OtherInput kind={ask.allowOther} min={today} onCancel={() => setOther(false)} onSubmit={(v) => send(otherLabel(ask.field, v), { field: ask.field, value: v })} />
            )}
          </div>
        )}

        {done && (
          <button type="button" onClick={onFinish} className="flex h-12 items-center justify-center self-start rounded-[24px] bg-navy px-6 text-[15px] font-semibold text-white">
            미리보기로
          </button>
        )}

        <div ref={endRef} aria-hidden="true" className="-mt-3 h-0" />

        {/* 입력창 — 화면 아래에 붙는다(안쪽 스크롤 없음). 모바일 홈 막대 여백 */}
        <div ref={barRef} className="sticky bottom-0 z-[2] -mx-1 flex flex-col gap-2 border-t border-line-2 bg-surface px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-2">
          {!limit && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
            >
              <label htmlFor="interview-input" className="sr-only">답 적기</label>
              <input
                id="interview-input"
                ref={inputRef}
                value={text}
                onChange={(e) => setText(clampCp(e.target.value, INPUT_MAX))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault(); // 한글 조합 중 Enter 는 보내지 않는다
                }}
                placeholder={done ? "바꿀 항목이 있으면 적어 주세요" : "답을 적어 주세요"}
                disabled={busy}
                aria-describedby="interview-count"
                enterKeyHint="send"
                className="h-12 min-w-0 flex-1 rounded-[12px] border border-line-3 bg-surface px-4 text-[15px] text-ink outline-none focus:border-mint focus:shadow-[0_0_0_3px_#DDF4EE] disabled:bg-surface-2"
              />
              <button type="submit" disabled={busy || !text.trim()} className="h-12 shrink-0 rounded-[24px] bg-navy px-5 text-[15px] font-semibold text-white disabled:bg-slate-soft disabled:text-muted">보내기</button>
            </form>
          )}
          <div className="flex flex-wrap items-center gap-x-3">
            {!limit && <span id="interview-count" className="text-[12px] text-muted">{cpLength(text)}/{INPUT_MAX}</span>}
            {canSkip && !busy && !closed && !error && (
              <button type="button" onClick={() => send("건너뛸게요")} className="h-11 text-[14px] font-semibold text-ink-2">건너뛰기</button>
            )}
            <button type="button" onClick={onManual} className="ml-auto h-11 text-[14px] font-semibold text-mint">직접 입력으로 이어서</button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** 오류 말풍선 버튼 — 잠시 후 다시(카운트다운)·다시 시도·직접 입력으로 이어서(초안 유지) */
function RetryRow({ seconds, canRetry, onRetry, onManual, onFinish }: { seconds: number; canRetry: boolean; onRetry: () => void; onManual: () => void; onFinish?: () => void }) {
  const [left, setLeft] = useState(canRetry ? seconds : 0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <div className="flex flex-wrap gap-2">
      {canRetry && (
        <button type="button" onClick={onRetry} disabled={left > 0} className="h-11 rounded-[22px] border border-line-3 px-4 text-[14px] font-semibold text-ink-2 disabled:text-muted">
          {left > 0 ? `${left}초 뒤 다시 시도` : "다시 시도"}
        </button>
      )}
      {onFinish && (
        <button type="button" onClick={onFinish} className="h-11 rounded-[22px] bg-navy px-4 text-[14px] font-semibold text-white">미리보기로</button>
      )}
      <button type="button" onClick={onManual} className="h-11 rounded-[22px] bg-navy px-4 text-[14px] font-semibold text-white">직접 입력으로 이어서</button>
    </div>
  );
}
