"use client";

import { Listbox, type ListboxOption } from "@/components/ui/Listbox";
import { EXAM_LIMITS, type ExamDraftQuestion } from "@/lib/api/exam";
import type { ExamQType } from "@/lib/api/types";
import { QTYPE_KO, toggleIndex, type DraftAction } from "../exam";
import type { ExamFieldErr } from "../useExamEditor";

type Props = {
  q: ExamDraftQuestion;
  i: number;
  count: number;
  /** 응시가 시작돼 구조(유형·보기·정답·배점·추가·삭제·순서)가 잠겼다 — 문제 글·해설만 고친다 */
  locked: boolean;
  /** 잠금 문구 id (잠긴 입력의 aria-describedby) */
  lockId?: string;
  /** 이 문항의 저장 거절·검사 오류 */
  err: ExamFieldErr | null;
  dispatch: (a: DraftAction) => void;
};

const TYPE_OPTIONS: ListboxOption[] = (Object.keys(QTYPE_KO) as ExamQType[]).map((t) => ({ value: t, label: QTYPE_KO[t] }));
const POINT_OPTIONS: ListboxOption[] = Array.from({ length: EXAM_LIMITS.pointsMax }, (_, k) => ({ value: String(k + 1), label: `${k + 1}점` }));

const text = "w-full min-w-0 rounded-[10px] border border-line-3 bg-surface px-3 py-[10px] text-[14px] leading-[1.55] text-ink read-only:bg-surface-2 aria-invalid:border-warn";
const area = `${text} min-h-[76px] resize-y [field-sizing:content]`;
const label = "flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3";
const iconBtn = "inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-3 hover:bg-bg disabled:opacity-40";
const addBtn = "inline-flex h-11 items-center self-start rounded-[22px] border border-dashed border-line-3 px-4 text-[13px] font-semibold text-ink-2 disabled:opacity-50";

function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const X = "M6 6l12 12M18 6 6 18";

/** 출제 화면 문항 카드 1개 (스펙 §4.2) — 유형·배점 고르기 · 문제 · 보기(라디오/체크 = 정답) · OX · 단답 허용 답 · 해설 · 위/아래/삭제 */
export function ExamQuestionForm({ q, i, count, locked, lockId, err, dispatch }: Props) {
  const no = i + 1;
  const bad = (f: string) => (err?.field === f ? true : undefined);
  const lockProps = locked ? { "aria-disabled": true, "aria-describedby": lockId, readOnly: true } : {};
  const errId = `exam-q-${i}-err`;

  return (
    <li className="flex flex-col gap-3 rounded-[14px] border border-line-2 bg-surface p-3" aria-label={`${no}번 문항`}>
      {/* 머리 — 번호 · 유형 · 배점 · 순서/삭제(390 에서 넘치면 다음 줄로) */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-bold text-ink">{no}.</span>
        <Listbox label={`${no}번 문항 유형`} value={q.type} options={TYPE_OPTIONS} onChange={(v) => dispatch({ type: "patch", i, patch: { type: v as ExamQType } })} disabled={locked} describedBy={locked ? lockId : undefined} className="w-[132px]" align="left" />
        <Listbox label={`${no}번 문항 배점`} prefix="배점" value={String(q.points)} options={POINT_OPTIONS} onChange={(v) => dispatch({ type: "patch", i, patch: { points: Number(v) } })} disabled={locked} describedBy={locked ? lockId : undefined} className="w-[112px]" align="left" />
        {!locked && (
          <div className="ml-auto flex items-center">
            <button type="button" aria-label={`${no}번 문항 위로`} disabled={i === 0} onClick={() => dispatch({ type: "move", i, dir: -1 })} className={iconBtn}>
              <Icon d="M12 19V5M6 11l6-6 6 6" />
            </button>
            <button type="button" aria-label={`${no}번 문항 아래로`} disabled={i === count - 1} onClick={() => dispatch({ type: "move", i, dir: 1 })} className={iconBtn}>
              <Icon d="M12 5v14M6 13l6 6 6-6" />
            </button>
            <button type="button" aria-label={`${no}번 문항 삭제`} onClick={() => dispatch({ type: "remove", i })} className={`${iconBtn} text-warn`}>
              <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </button>
          </div>
        )}
      </div>

      <label className={label}>
        문제
        <textarea rows={2} value={q.prompt} maxLength={EXAM_LIMITS.prompt} aria-invalid={bad("prompt")} aria-describedby={bad("prompt") && errId} onChange={(e) => dispatch({ type: "patch", i, patch: { prompt: e.target.value } })} placeholder="문제를 적어 주세요" className={area} />
      </label>

      {(q.type === "single" || q.type === "multi") && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-invalid={bad("choices") || bad("answer")}>
          <legend className="mb-1 text-[12px] font-semibold text-ink-3">보기 · {q.type === "single" ? "정답 하나를 골라요" : "정답을 모두 골라요"}</legend>
          {q.choices.map((c, k) => {
            const on = q.type === "single" ? q.answer === k : (q.answer as number[]).includes(k);
            return (
              <div key={k} className="flex min-h-11 items-center gap-1">
                <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
                  <input
                    type={q.type === "single" ? "radio" : "checkbox"}
                    name={`exam-q-${i}-answer`}
                    checked={on}
                    aria-label={`${k + 1}번 보기 정답`}
                    aria-disabled={locked || undefined}
                    aria-describedby={locked ? lockId : undefined}
                    onChange={() => dispatch({ type: "setAnswer", i, answer: q.type === "single" ? k : toggleIndex(q.answer as number[], k) })}
                    className="size-[18px] accent-mint"
                  />
                </label>
                <input type="text" value={c} maxLength={EXAM_LIMITS.choice} aria-label={`${no}번 문항 ${k + 1}번 보기`} placeholder={`보기 ${k + 1}`} {...lockProps} onChange={(e) => dispatch({ type: "choiceSet", i, c: k, text: e.target.value })} className={`${text} h-11 py-0 ${on ? "border-mint font-semibold" : ""}`} />
                {!locked && (
                  <button type="button" aria-label={`${k + 1}번 보기 빼기`} disabled={q.choices.length <= EXAM_LIMITS.choicesMin} onClick={() => dispatch({ type: "choiceRemove", i, c: k })} className={iconBtn}>
                    <Icon d={X} />
                  </button>
                )}
              </div>
            );
          })}
          {!locked && (
            <button type="button" disabled={q.choices.length >= EXAM_LIMITS.choicesMax} onClick={() => dispatch({ type: "choiceAdd", i })} className={addBtn}>
              + 보기
            </button>
          )}
        </fieldset>
      )}

      {q.type === "ox" && (
        <div role="group" aria-label={`${no}번 문항 정답`} className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-ink-3">정답</span>
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={q.answer === v}
              aria-disabled={locked || undefined}
              aria-describedby={locked ? lockId : undefined}
              onClick={() => !locked && dispatch({ type: "setAnswer", i, answer: v })}
              className={`inline-flex h-11 min-w-[64px] items-center justify-center rounded-[22px] border text-[15px] font-bold ${q.answer === v ? "border-mint bg-mint-soft text-mint-deep" : "border-line-3 bg-surface text-ink-3"} aria-disabled:cursor-default aria-disabled:opacity-70`}
            >
              {v ? "O" : "X"}
            </button>
          ))}
        </div>
      )}

      {q.type === "short" &&
        (() => {
          const xs = q.answer as string[];
          const set = (next: string[]) => dispatch({ type: "setAnswer", i, answer: next });
          return (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-invalid={bad("answer")}>
              <legend className="mb-1 text-[12px] font-semibold text-ink-3">허용 답 · 하나라도 맞으면 정답 (대소문자·띄어쓰기·문장부호는 보지 않아요)</legend>
              {xs.map((a, k) => (
                <div key={k} className="flex min-h-11 items-center gap-1">
                  <input type="text" value={a} maxLength={EXAM_LIMITS.shortAnswer} aria-label={`${no}번 문항 허용 답 ${k + 1}`} placeholder="정답으로 칠 답" {...lockProps} onChange={(e) => set(xs.map((x, j) => (j === k ? e.target.value : x)))} className={`${text} h-11 py-0`} />
                  {!locked && (
                    <button type="button" aria-label={`허용 답 ${k + 1} 빼기`} onClick={() => set(xs.length <= 1 ? [""] : xs.filter((_, j) => j !== k))} className={iconBtn}>
                      <Icon d={X} />
                    </button>
                  )}
                </div>
              ))}
              {!locked && (
                <button type="button" disabled={xs.length >= EXAM_LIMITS.shortAnswers} onClick={() => set([...xs, ""])} className={addBtn}>
                  + 허용 답
                </button>
              )}
            </fieldset>
          );
        })()}

      <label className={label}>
        해설 (선택)
        <textarea rows={2} value={q.explanation} maxLength={EXAM_LIMITS.explanation} aria-invalid={bad("explanation")} onChange={(e) => dispatch({ type: "patch", i, patch: { explanation: e.target.value } })} placeholder="왜 이 답인지 — 공개 시점에 응시자에게 보여요" className={area} />
      </label>

      {err && (
        <p id={errId} role="alert" className="m-0 rounded-[9px] bg-[#FFF1EF] px-[10px] py-2 text-[12px] font-semibold text-warn">
          {err.message}
        </p>
      )}
    </li>
  );
}
