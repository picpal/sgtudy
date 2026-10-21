"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchExamAttempt, fetchExamResults } from "@/lib/api/exam";
import type { ExamResults as ExamResultsDto, ExamView } from "@/lib/api/types";
import type { ToastMsg } from "@/components/ui/Toast";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { kstMd, questionResult, rateText, resultSummary, resultsHead, submittedLine } from "../exam";
import { ExamQuestionView } from "./ExamQuestionView";

type Props = {
  slug: string;
  nodeId: string;
  toast: (m: ToastMsg) => void;
  /** 바뀌면 다시 불러온다(편집자 자신이 제출한 뒤 등) */
  refreshKey?: string;
};

/** 그룹장·편집자 결과 보기 — 요약 · 문항별 정답률 · 멤버별 점수와 [답안 ▸](스펙 §4.5). 점수는 본인과 편집자만(D7) */
export function ExamResults({ slug, nodeId, toast, refreshKey = "" }: Props) {
  const [data, setData] = useState<ExamResultsDto | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, ExamView>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const my = ++seq.current;
    fetchExamResults(slug, nodeId).then(
      (r) => {
        if (my !== seq.current) return;
        setError(false);
        setData(r);
        setAnswers({});
      },
      () => {
        if (my === seq.current) setError(true);
      },
    );
  }, [slug, nodeId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const toggle = async (userId: string) => {
    if (open === userId) return setOpen(null);
    if (answers[userId]) return setOpen(userId);
    setBusy(userId);
    try {
      const v = await fetchExamAttempt(slug, nodeId, userId);
      setAnswers((a) => ({ ...a, [userId]: v }));
      setOpen(userId);
    } catch {
      toast({ text: "답안을 불러오지 못했어요", tone: "bad" });
    } finally {
      setBusy(null);
    }
  };

  const qs = data ? [...data.questions].sort((a, b) => a.ord - b.ord) : [];

  return (
    <section aria-labelledby={`exam-results-${nodeId}`} className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-[14px]">
      <h3 id={`exam-results-${nodeId}`} className="m-0 flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold text-ink">
        <span>결과</span>
        {data && <span className="text-[13px] font-semibold text-ink-2">{resultsHead(data)}</span>}
      </h3>

      {!data && !error && <div aria-busy="true" aria-label="결과 불러오는 중" className="h-[96px] rounded-[10px] bg-surface-3" />}
      {!data && error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <span className="min-w-0 flex-[1_1_200px]">결과를 불러오지 못했어요</span>
          <button
            type="button"
            onClick={() => {
              setError(false);
              load();
            }}
            className="h-11 shrink-0 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink">
            다시 시도
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="flex flex-col gap-2">
            <h4 className="m-0 text-[13px] font-semibold text-ink-3">문항별 정답률</h4>
            <ol className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-2 p-0 sm:grid-cols-2">
              {qs.map((q, i) => (
                <li key={q.id} className="flex min-h-11 items-center gap-3 text-[13px]">
                  <span className="w-6 shrink-0 font-bold text-ink">{i + 1}.</span>
                  <ProgressBar pct={q.correctRate ?? 0} height={8} className="min-w-0 flex-1" />
                  <span className="w-10 shrink-0 text-right font-semibold text-ink-2">{rateText(q.correctRate)}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-1">
            <h4 className="m-0 text-[13px] font-semibold text-ink-3">멤버</h4>
            <ul className="m-0 flex list-none flex-col p-0">
              {data.members.map((m) => {
                const done = m.submittedAt != null;
                const isOpen = open === m.userId;
                const v = answers[m.userId];
                return (
                  <li key={m.userId} className="flex flex-col border-t border-line-2 first:border-t-0">
                    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1 text-[14px]">
                      <span className="min-w-0 flex-[1_1_80px] truncate font-semibold text-ink">{m.nickname}</span>
                      {done ? (
                        <>
                          <span className="font-bold text-ink">
                            {m.score ?? "—"}/{data.maxScore}
                          </span>
                          <span className="text-[13px] text-ink-3">{kstMd(m.submittedAt!)}</span>
                          <span className={`text-[13px] ${m.isLate ? "font-semibold text-warn" : "text-ink-3"}`}>{m.isLate ? "지각" : "기한 내"}</span>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            disabled={busy === m.userId}
                            onClick={() => void toggle(m.userId)}
                            className="inline-flex h-11 shrink-0 items-center rounded-[22px] px-3 text-[13px] font-semibold text-ink underline underline-offset-2 disabled:opacity-50"
                          >
                            {isOpen ? "답안 ▾" : "답안 ▸"}
                          </button>
                        </>
                      ) : (
                        <span className="text-[13px] text-ink-3">— 미제출</span>
                      )}
                    </div>
                    {isOpen && v && <AttemptView v={v} name={m.nickname} scope={`m${m.userId}`} />}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

/** 그 멤버의 문항별 답·정오 — 응시 결과 화면과 같은 뷰, 읽기 전용 */
function AttemptView({ v, name, scope }: { v: ExamView; name: string; scope: string }) {
  const qs = v.questions ? [...v.questions].sort((a, b) => a.ord - b.ord) : [];
  const sum = resultSummary(v);
  const stamp = v.attempt ? submittedLine(v.attempt) : null;
  return (
    <div role="region" aria-label={`${name} 답안`} className="mb-3 flex flex-col gap-5 rounded-[12px] bg-surface-2 px-[14px] py-3">
      {(sum.headline || stamp) && (
        <div className="flex flex-col gap-1">
          {sum.headline && <p className="m-0 text-[15px] font-bold text-ink">{sum.headline}</p>}
          {stamp && <p className="m-0 text-[13px] text-ink-3">{stamp}</p>}
          {sum.sub && <p className="m-0 text-[13px] text-ink-2">{sum.sub}</p>}
        </div>
      )}
      {qs.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-6 p-0">
          {qs.map((q, i) => {
            const r = questionResult(q, v.attempt);
            return <ExamQuestionView key={q.id} mode="result" q={q} no={i + 1} mine={r.mine} correct={r.correct} earned={r.earned} idScope={scope} />;
          })}
        </ol>
      )}
    </div>
  );
}
