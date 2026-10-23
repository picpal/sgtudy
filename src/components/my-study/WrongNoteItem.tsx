"use client";

import { useEffect, useRef, useState } from "react";
import type { ExamQuestion, WrongNoteItem } from "@/lib/api/types";
import { MarkdownView } from "./MarkdownView";
import { ExamQuestionView } from "./tabs/ExamQuestionView";
import { itemBadges, practiceResultText, stripKey, type ItemBadge } from "./wrongNote";

/** 다시 풀기 상태 — 없으면 기본(내 제출 답) */
export type ItemRun = { s: "take"; answer: unknown } | { s: "done"; answer: unknown; correct: boolean };

export const BTN = "inline-flex h-11 shrink-0 items-center justify-center rounded-[22px] border border-line-3 bg-surface px-4 text-[13px] font-semibold text-ink hover:bg-surface-2 disabled:opacity-50";
export const BTN_PRIMARY = "inline-flex h-11 shrink-0 items-center justify-center rounded-[22px] bg-navy px-5 text-[13px] font-semibold text-white disabled:opacity-50";
const BADGE: Record<ItemBadge["tone"], string> = {
  wrong: "bg-[#FFF1EF] text-warn",
  ok: "bg-[#E3F5EC] text-[#1A7F55]",
  muted: "bg-slate-soft text-ink-3",
};
const NO_EXPLANATION = "해설이 없는 문항이에요";

/** 정답만 있는 사본 — 「정답·해설」 을 열면 보기 목록에 정답 태그를 단다(해설은 아래 따로) */
const keyOnly = (q: ExamQuestion): ExamQuestion => ({ ...stripKey(q), answer: q.answer });
const hasExplanation = (q: ExamQuestion) => (q.explanation ?? "").trim() !== "";

type Props = {
  it: WrongNoteItem;
  /** 상세 안 순번(문항 이동이 찾는 data-wn-idx) */
  idx?: number;
  run: ItemRun | undefined;
  /** 시험 묶음 다시 풀기 중 — 문항별 [채점]·[외웠어요] 는 숨기고 카드 하단 막대가 맡는다 */
  inBatch: boolean;
  busy: boolean;
  /** 「답을 확인해 주세요」(서버 VALIDATION_FAILED) */
  fieldError: string | null;
  onStart: () => void;
  onAnswer: (a: unknown) => void;
  onGrade: () => void;
  onClose: () => void;
  onMaster: (on: boolean) => void;
};

/**
 * 오답 문항 하나(스펙 §6.1·§6.4). 기본 = 내 제출 답만(정답 키를 지운 사본, 「정답」 태그 없음) + [다시 풀기]·[외웠어요] + 「정답·해설」 펼침.
 * 다시 풀기 = 같은 자리에서 응시 입력(take) → [채점](서버) → 결과(정답 표시·해설 자동 펼침). 정오는 서버 응답 그대로
 */
export function WrongNoteItemView({ it, idx, run, inBatch, busy, fieldError, onStart, onAnswer, onGrade, onClose, onMaster }: Props) {
  const q = it.question;
  const [reveal, setReveal] = useState(false);
  const badges = itemBadges(it);
  // 누른 단추가 상태 전환으로 사라지면 포커스가 body 로 빠진다 — 같은 문항의 다음 컨트롤로(입력 = 첫 보기, 결과 = [한 번 더], 기본 = [다시 풀기])
  const liRef = useRef<HTMLLIElement>(null);
  const phase = run?.s ?? "idle";
  const prev = useRef(phase);
  useEffect(() => {
    if (prev.current === phase) return;
    prev.current = phase;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    const sel = phase === "take" ? "input, button[aria-pressed]" : phase === "done" ? '[data-focus="again"]' : '[data-focus="start"]';
    liRef.current?.querySelector<HTMLElement>(sel)?.focus();
  }, [phase]);

  return (
    <li ref={liRef} className="flex scroll-mt-24 flex-col gap-2 border-t border-line-2 pt-4 first:border-t-0 first:pt-0" data-wn-item={q.id} data-wn-idx={idx}>
      <p className="m-0 flex flex-wrap items-center gap-[6px]" aria-label="문항 상태">
        {badges.map((b) => (
          <span key={b.text} className={`rounded-[6px] px-[6px] py-[1px] text-[11px] font-bold ${BADGE[b.tone]}`}>
            {b.text}
          </span>
        ))}
        {run?.s === "done" && (
          <span role="status" className={`text-[12px] font-bold ${run.correct ? "text-[#1A7F55]" : "text-warn"}`}>
            {practiceResultText(run.correct)}
          </span>
        )}
      </p>

      <ul className="m-0 list-none p-0">
        {run?.s === "take" ? (
          <ExamQuestionView mode="take" idScope="wn" q={stripKey(q)} no={it.no} mine={run.answer} onChange={onAnswer} disabled={busy} />
        ) : run?.s === "done" ? (
          <ExamQuestionView mode="result" idScope="wn" q={q} no={it.no} mine={run.answer} mineLabel="이번 답" correct={run.correct} earned={run.correct ? q.points : 0} explanationOpen />
        ) : (
          <ExamQuestionView mode="result" idScope="wn" q={reveal ? keyOnly(q) : stripKey(q)} no={it.no} mine={it.mine} correct={null} earned={null} />
        )}
      </ul>

      {run?.s === "done" && !hasExplanation(q) && <p className="m-0 text-[13px] text-muted">{NO_EXPLANATION}</p>}
      {fieldError && (
        <p role="alert" className="m-0 text-[13px] font-semibold text-warn">
          {fieldError}
        </p>
      )}

      {!inBatch && run?.s === "take" && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={onGrade}>
            {busy ? "채점 중…" : "채점"}
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={onClose}>
            취소
          </button>
        </div>
      )}
      {!inBatch && run?.s === "done" && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} disabled={busy} onClick={onStart} data-focus="again">
            한 번 더
          </button>
          <button type="button" className={BTN} disabled={busy} onClick={onClose}>
            닫기
          </button>
        </div>
      )}
      {!run && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={BTN} disabled={busy} onClick={onStart} data-focus="start">
              다시 풀기
            </button>
            {it.mastered ? (
              <button type="button" className={BTN} disabled={busy} onClick={() => onMaster(false)} data-focus="master">
                다시 노트에
              </button>
            ) : (
              <button type="button" className={BTN} disabled={busy} onClick={() => onMaster(true)} data-focus="master">
                외웠어요
              </button>
            )}
          </div>
          {/* 열면 위 보기 목록에 정답 태그가 붙고 여기 해설 — 정답은 해설 유무와 무관하게 이 안에서(D13) */}
          <details open={reveal} onToggle={(e) => setReveal(e.currentTarget.open)} className="rounded-[10px] bg-surface-2 px-3 text-[13px]">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink-2">정답·해설</summary>
            <div className="pb-3">
              {reveal && (hasExplanation(q) ? <MarkdownView src={q.explanation!} className="text-[13px] leading-[1.7]" /> : <p className="m-0 text-muted">{NO_EXPLANATION}</p>)}
            </div>
          </details>
        </>
      )}
    </li>
  );
}
