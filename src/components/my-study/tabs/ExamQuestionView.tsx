"use client";

import type { ExamQuestion } from "@/lib/api/types";
import { MarkdownView } from "../MarkdownView";
import { QTYPE_KO, toggleIndex } from "../exam";

type Props = {
  q: ExamQuestion;
  /** 화면에 보이는 번호(1부터) */
  no: number;
  /** 내 답(저장된 값 + 아직 보내지 않은 값) — 없으면 null */
  mine: unknown;
} & (
  | { mode: "take"; onChange: (answer: unknown) => void; disabled?: boolean }
  /** 결과: 정오·배점은 서버 results 가 있을 때만(after_deadline 마감 뒤 미제출이면 null) */
  | { mode: "result"; correct: boolean | null; earned: number | null }
);

const OX = (v: unknown) => (v === true ? "O" : v === false ? "X" : "");
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : []);
// 하단 고정 막대(약 64px)에 가리지 않게 — 키보드로 옮겨 가도 막대 위로 스크롤된다
const row = "flex min-h-11 scroll-mb-20 items-center gap-3 rounded-[10px] border px-3 py-2 text-[14px]";

/** 시험 문항 1개 — 응시(라디오·체크·O/X 두 버튼·단답 칸) 또는 결과(내 답·정답·정오·해설). 서버가 보낸 키만 그린다 */
export function ExamQuestionView(p: Props) {
  const { q, no, mine } = p;
  const headId = `exam-q-${q.id}`;
  const kind = q.type === "single" ? null : QTYPE_KO[q.type];
  const hasKey = "answer" in q;
  const key = q.answer;
  const res = p.mode === "result" ? p : null;
  const verdict = res && res.correct !== null ? (res.correct ? "✓ 정답" : "✗ 오답") : null;
  const pts = res && res.correct === false && res.earned !== null ? `(${res.earned}/${q.points}점)` : `(${q.points}점)`;

  return (
    <li role="group" aria-labelledby={headId} className="flex flex-col gap-2">
      <div id={headId} className="flex flex-col gap-1">
        <p className="m-0 flex flex-wrap items-center gap-x-[6px] text-[13px] font-semibold text-ink-3">
          <span className="font-bold text-ink">{no}.</span>
          {verdict && <span className={res?.correct ? "text-[#1A7F55]" : "text-warn"}>{verdict}</span>}
          <span>{pts}</span>
          {kind && <span>{kind}</span>}
        </p>
        <MarkdownView src={q.prompt} className="text-[15px] font-medium leading-[1.7] text-ink" />
      </div>

      {p.mode === "take" ? (
        <TakeInput q={q} mine={mine} onChange={p.onChange} disabled={!!p.disabled} />
      ) : (
        <ResultBody q={q} mine={mine} hasKey={hasKey} answerKey={key} />
      )}

      {res && "explanation" in q && (q.explanation ?? "").trim() !== "" && (
        <details className="rounded-[10px] bg-surface-2 px-3 text-[13px]">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-ink-2">해설</summary>
          <div className="pb-3">
            <MarkdownView src={q.explanation!} className="text-[13px] leading-[1.7]" />
          </div>
        </details>
      )}
    </li>
  );
}

function TakeInput({ q, mine, onChange, disabled }: { q: ExamQuestion; mine: unknown; onChange: (a: unknown) => void; disabled: boolean }) {
  if (q.type === "single" || q.type === "multi") {
    const picked = q.type === "single" ? (typeof mine === "number" ? [mine] : []) : nums(mine);
    return (
      <div className="flex flex-col gap-[6px]">
        {(q.choices ?? []).map((c, k) => {
          const on = picked.includes(k);
          return (
            <label key={k} className={`${row} cursor-pointer ${on ? "border-mint bg-mint-soft font-semibold text-ink" : "border-line bg-surface text-ink-2"}`}>
              <input
                type={q.type === "single" ? "radio" : "checkbox"}
                name={`exam-take-${q.id}`}
                checked={on}
                disabled={disabled}
                onChange={() => onChange(q.type === "single" ? k : toggleIndex(nums(mine), k))}
                className="size-[18px] shrink-0 scroll-mb-20 accent-mint"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{c}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (q.type === "ox") {
    return (
      <div className="flex items-center gap-2">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={mine === v}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={`inline-flex h-11 min-w-[72px] scroll-mb-20 items-center justify-center rounded-[22px] border text-[16px] font-bold disabled:opacity-60 ${mine === v ? "border-mint bg-mint-soft text-mint-deep" : "border-line-3 bg-surface text-ink-3"}`}
          >
            {OX(v)}
          </button>
        ))}
      </div>
    );
  }
  return (
    <input
      type="text"
      value={typeof mine === "string" ? mine : ""}
      maxLength={200}
      disabled={disabled}
      aria-label="답"
      placeholder="답을 적어 주세요"
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 w-full scroll-mb-20 rounded-[10px] border border-line-3 bg-surface px-3 text-[15px] text-ink outline-none focus:border-ink"
    />
  );
}

/** 결과 — 내 답과(서버가 보냈으면) 정답. 정답 키가 없으면 내 답만 */
function ResultBody({ q, mine, hasKey, answerKey }: { q: ExamQuestion; mine: unknown; hasKey: boolean; answerKey: unknown }) {
  const tag = "shrink-0 rounded-[6px] px-[6px] py-[1px] text-[11px] font-bold";
  if (q.type === "single" || q.type === "multi") {
    const picked = q.type === "single" ? (typeof mine === "number" ? [mine] : []) : nums(mine);
    const right = !hasKey ? [] : q.type === "single" ? (typeof answerKey === "number" ? [answerKey] : []) : nums(answerKey);
    return (
      <ul className="m-0 flex list-none flex-col gap-[6px] p-0">
        {(q.choices ?? []).map((c, k) => {
          const me = picked.includes(k);
          const ok = right.includes(k);
          return (
            <li key={k} className={`${row} ${ok ? "border-[#BFE6D4] bg-[#E3F5EC]" : me ? "border-[#F0C9C4] bg-[#FFF7F6]" : "border-line bg-surface"} text-ink-2`}>
              <span aria-hidden="true" className="w-[18px] shrink-0 text-center font-bold text-ink">
                {me ? (q.type === "single" ? "●" : "✓") : ""}
              </span>
              <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${me ? "font-semibold text-ink" : ""}`}>{c}</span>
              {me && <span className={`${tag} bg-slate-soft text-ink-3`}>내 답</span>}
              {ok && <span className={`${tag} bg-[#BFE6D4] text-[#1A7F55]`}>정답</span>}
            </li>
          );
        })}
      </ul>
    );
  }
  const show = (v: unknown) => (q.type === "ox" ? OX(v) : Array.isArray(v) ? v.join(" / ") : typeof v === "string" ? v : "");
  const mineText = show(mine);
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
      <dt className="text-ink-3">내 답</dt>
      <dd className="m-0 font-semibold text-ink [overflow-wrap:anywhere]">{mineText || <span className="font-normal text-muted">답하지 않았어요</span>}</dd>
      {hasKey && (
        <>
          <dt className="text-ink-3">정답</dt>
          <dd className="m-0 font-semibold text-[#1A7F55] [overflow-wrap:anywhere]">{show(answerKey)}</dd>
        </>
      )}
    </dl>
  );
}
