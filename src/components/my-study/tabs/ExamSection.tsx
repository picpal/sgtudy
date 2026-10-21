"use client";

import { useEffect, useRef, useState } from "react";
import { useHashTarget } from "@/lib/hashTarget";
import { useMe } from "@/lib/me";
import type { ExamView } from "@/lib/api/types";
import { CODE_STATUS } from "../model";
import { questionResult, resultSummary, submitAsk, submittedLine, takeNote } from "../exam";
import { statusRows, type StatusRow } from "../submission";
import { useExamTake, type ExamSaveState } from "../useExamTake";
import { useTaskDetail } from "../useTaskDetail";
import { ExamQuestionView } from "./ExamQuestionView";
import { InlineConfirm } from "./InlineConfirm";
import type { SubmissionSectionProps } from "./SubmissionSection";
import { SubmissionStatusList } from "./SubmissionStatusList";

export type ExamSectionProps = Omit<SubmissionSectionProps, "onUploadingChange"> & {
  /** 저장하지 못한 답이 있다 — 상세 화면이 나가기 전에 묻는다(올리는 중 파일과 같은 경로) */
  onUnsavedChange?: (unsaved: boolean) => void;
};

type Mode = "take" | "result" | "note";

/** 응시 · 결과(정답·해설) · 안내 중 무엇을 그리나 — 서버 viewer·attempt 그대로 */
export function examMode(v: ExamView): Mode {
  if (v.viewer.canTake && v.questions) return "take";
  if (v.attempt?.status === "submitted") return "result";
  // after_deadline 마감 뒤: 제출 안 했어도 정답·해설이 열린다(스펙 §3.4)
  if (v.viewer.reason === "closed" && v.questions) return "result";
  return "note";
}

const SAVE_TEXT: Record<ExamSaveState, string> = { idle: "", saving: "저장 중…", saved: "저장됨", failed: "저장 실패" };

/** 시험 리프 상세의 본문 — 상태 안내 · 응시(문항 + 하단 고정 막대 · 제출 확인) · 결과 · 제출 현황 (스펙 §4.3·4.4) */
export function ExamSection({ n, slug, focus, onFocused, onSubmitted, toast, viewerPending, isLeader = false, quietNotAssigned = false, onUnsavedChange }: ExamSectionProps) {
  const meId = useMe()?.id ?? null;
  const t = useExamTake(slug, n.id, toast);
  const task = useTaskDetail(slug, n.id);
  const [ask, setAsk] = useState(false);
  const examRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLHeadingElement>(null);
  const v = t.view;
  const mode = v ? examMode(v) : null;

  const failed = t.save === "failed";
  useEffect(() => {
    onUnsavedChange?.(failed);
  }, [failed, onUnsavedChange]);
  useEffect(() => () => onUnsavedChange?.(false), [onUnsavedChange]);

  // 보드·캘린더·알림 진입: 응답이 오면 한 번 — 풀 수 있거나 결과가 있으면 시험, 아니면(또는 #submissions) 제출 현황
  const settled = !!v || !!t.error;
  const toStatus = useHashTarget("submissions", settled);
  useEffect(() => {
    if (focus !== "submission" || !settled) return;
    const el = !toStatus && mode && mode !== "note" ? examRef.current : statusRef.current;
    el?.scrollIntoView({ block: "start" });
    el?.focus({ preventScroll: true });
    onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, settled]);

  // 제출 뒤 결과 카드로 포커스
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === "take" && mode === "result") examRef.current?.focus({ preventScroll: false });
    prevMode.current = mode;
  }, [mode]);

  const submit = async () => {
    const ok = await t.submit();
    setAsk(false);
    if (!ok) return;
    task.refetch();
    onSubmitted();
  };

  const rows: StatusRow[] = task.detail
    ? statusRows(task.detail, meId)
    : n.people.map((p) => ({ userId: p.userId, name: p.name, tone: p.tone, status: CODE_STATUS[p.c], me: p.userId === meId, released: false, submission: null }));
  const tk = task.detail?.node.task;
  const note = viewerPending
    ? "참가가 승인되면 다른 사람의 제출물을 볼 수 있어요"
    : n.archived && !isLeader
      ? "보관된 과제예요 · 제출물은 그룹장과 작성자만 볼 수 있어요"
      : null;

  const qs = v?.questions ? [...v.questions].sort((a, b) => a.ord - b.ord) : [];
  const total = qs.length;
  const info = v ? takeNote(v, quietNotAssigned) : null;
  const sum = v && mode === "result" ? resultSummary(v) : null;
  const stamp = v?.attempt?.status === "submitted" ? submittedLine(v.attempt) : null;
  // 결과 목록: 정오(results)나 정답 키가 왔을 때만 — after_deadline 마감 전 제출이면 점수 카드만
  const showList = mode === "result" && !!v && (!!v.attempt?.results || qs.some((q) => "answer" in q));

  return (
    <div className="flex flex-col gap-5">
      {t.loading && (
        <div aria-busy="true" aria-label="시험 불러오는 중" className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-[14px]">
          <div className="h-5 w-24 rounded-[6px] bg-line-2" />
          <div className="h-[120px] rounded-[10px] bg-surface-3" />
        </div>
      )}
      {!v && t.error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-surface-3 px-[14px] py-2 text-[13px] text-ink-2">
          <span className="min-w-0 flex-[1_1_200px]">시험을 불러오지 못했어요</span>
          <button type="button" onClick={t.refetch} className="h-11 shrink-0 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink">
            다시 시도
          </button>
        </div>
      )}

      {v && info && (
        <p role="note" className="m-0 rounded-[12px] bg-surface-2 px-[14px] py-[10px] text-[13px] text-ink-3">
          {info}
        </p>
      )}

      {v && mode === "take" && (
        <div ref={examRef} tabIndex={-1} aria-label="시험 문항" className="flex flex-col outline-none">
          <ol className="m-0 flex list-none flex-col gap-6 p-0 pb-5">
            {qs.map((q, i) => (
              <ExamQuestionView key={q.id} mode="take" q={q} no={i + 1} mine={t.answers[q.id] ?? null} onChange={(a) => t.setAnswer(q.id, a)} disabled={t.submitting} />
            ))}
          </ol>
          {/* 하단 고정 막대 — DetailView 위 막대(sticky top-0)와 같은 방식. 문항 목록이 끝나면 따라 올라간다 */}
          <div className="sticky bottom-0 z-[2] -mx-1 flex flex-col gap-2 border-t border-line-2 bg-surface px-1 py-2">
            {ask ? (
              <InlineConfirm
                text={submitAsk(total - t.answered)}
                onCancel={() => setAsk(false)}
                actions={[{ label: t.submitting ? "제출 중…" : "제출", tone: "primary", disabled: t.submitting, onClick: () => void submit() }]}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-x-[6px] text-[13px] text-ink-2" aria-live="polite">
                  <span>
                    <b className="font-bold text-ink">
                      {t.answered}/{total}
                    </b>{" "}
                    답함
                  </span>
                  {SAVE_TEXT[t.save] && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className={failed ? "font-semibold text-warn" : ""}>{SAVE_TEXT[t.save]}</span>
                    </>
                  )}
                  {failed && (
                    <button type="button" onClick={t.retry} className="inline-flex min-h-11 items-center rounded-[8px] px-2 text-[13px] font-semibold text-ink underline underline-offset-2">
                      다시 시도
                    </button>
                  )}
                </p>
                <button type="button" disabled={t.submitting} onClick={() => setAsk(true)} className="h-11 shrink-0 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white disabled:opacity-50">
                  제출하기
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {v && mode === "result" && (
        <div ref={examRef} tabIndex={-1} aria-label="시험 결과" className="flex flex-col gap-5 outline-none">
          {sum?.headline && (
            <div className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface-2 px-[14px] py-3">
              <h3 className="m-0 flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold text-ink">
                <span>내 결과</span>
                <span className="text-[17px]">{sum.headline}</span>
              </h3>
              {stamp && <p className="m-0 text-[13px] text-ink-3">{stamp}</p>}
              {sum.sub && <p className="m-0 text-[13px] text-ink-2">{sum.sub}</p>}
            </div>
          )}
          {showList && (
            <ol className="m-0 flex list-none flex-col gap-6 p-0">
              {qs.map((q, i) => {
                const r = questionResult(q, v.attempt);
                return <ExamQuestionView key={q.id} mode="result" q={q} no={i + 1} mine={r.mine} correct={r.correct} earned={r.earned} />;
              })}
            </ol>
          )}
        </div>
      )}

      <SubmissionStatusList rows={rows} sub={tk ? tk.submitted : n.sub} asg={tk ? tk.assigned : n.asg} note={note} archived={n.archived} headingRef={statusRef} onOpenFile={() => {}} expandable={false} />
    </div>
  );
}
