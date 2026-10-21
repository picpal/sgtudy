"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { EXAM_LIMITS } from "@/lib/api/exam";
import type { ExamQType, ExamReveal, ExamSummary } from "@/lib/api/types";
import { Seg } from "../bits";
import { QTYPE_KO, REVEAL_KO, draftTotals, examHead, isExamDraft } from "../exam";
import { useExamEditor, type ExamEditorApi } from "../useExamEditor";
import { ExamQuestionForm } from "./ExamQuestionForm";
import { InlineConfirm } from "./InlineConfirm";

/** EditView 가 위쪽 [저장]·떠나기 확인에서 부른다 — 저장하지 않은 문항을 저장하거나 버린다 */
export type ExamEditorHandle = { save: () => Promise<boolean>; discard: () => void };
export type ExamTab = "manual" | "ai";

type Props = {
  slug: string;
  nodeId: string;
  /** 트리의 시험 요약 — 불러오기 전 머리 줄(초안/발행됨) */
  summary: ExamSummary;
  /** 발행 알림을 받을 담당자 수 ("팀원 n명에게 알림이 가요") */
  assignees: number;
  toast: (m: ToastMsg) => void;
  /** 저장하지 않은 문항 수정이 생기고 없어질 때 — EditView 가 S.examDirty 로 올린다(미저장 가드) */
  onDirty: (dirty: boolean) => void;
  /** 저장·발행 성공 — 트리 요약(배지·문항 수)을 다시 받는다 */
  onChanged?: () => void;
  /** 「AI 로 생성」 탭 내용 (Task 8). 없으면 탭 줄 없이 직접 작성만 */
  ai?: (ed: ExamEditorApi, goManual: () => void) => ReactNode;
  ref?: Ref<ExamEditorHandle>;
};

const QTYPES = Object.keys(QTYPE_KO) as ExamQType[];
const EMPTY_NOTE = "문항을 하나 이상 넣어야 발행할 수 있어요";

/**
 * 리프 편집 화면의 「문제」 섹션 (스펙 §4.2) — 머리 줄(상태·문항 수·점수·발행) · 탭 · 문항 카드 · 문항 추가 · 공개 시점 · [문제 저장].
 * 문항 편집은 즉시 저장이 아니라 [문제 저장](exam_put) 한 번 — 제목·설명 저장(node_update)과 따로다.
 * 응시가 시작되면(응시 행 1건~) 구조 입력은 aria-disabled · 추가/삭제/순서 버튼은 숨긴다 — 문제 글·해설·공개 시점만
 */
export function ExamEditor({ slug, nodeId, summary, assignees, toast, onDirty, onChanged, ai, ref }: Props) {
  const ed = useExamEditor(slug, nodeId, toast, onChanged);
  const { view, draft, dirty, locked, lockNote, saving, publishing, fieldErr } = ed;
  const [tab, setTab] = useState<ExamTab>("manual");
  const [ask, setAsk] = useState<"publish" | "unpublish" | null>(null);

  useImperativeHandle(ref, () => ({ save: ed.save, discard: ed.discard }), [ed.save, ed.discard]);

  const onDirtyRef = useRef(onDirty);
  useEffect(() => {
    onDirtyRef.current = onDirty;
  });
  useEffect(() => onDirtyRef.current(dirty), [dirty]);
  useEffect(() => () => onDirtyRef.current(false), []);

  const lockId = `exam-lock-${nodeId}`;
  // 상태는 서버 응답(view)이 더 새롭다 — 없으면 트리 요약(n.exam.status). warnings 로 판정하지 않는다
  const draftState = isExamDraft(view?.exam ?? summary);
  const totals = draftTotals(draft);
  const head = view ? `${examHead({ status: draftState ? "draft" : "published", questionCount: totals.count, totalPoints: totals.points })}${dirty ? " · 저장 전" : ""}` : examHead(summary);
  const busy = saving || publishing;
  const canPublish = !!view && totals.count > 0;
  const unpublishLocked = !!view?.exam.locked;
  const globalErr = fieldErr && fieldErr.index < 0 ? fieldErr : null;

  const doPublish = async (on: boolean) => {
    const ok = await ed.publish(on);
    if (ok) setAsk(null);
  };

  return (
    <section aria-labelledby={`exam-head-${nodeId}`} className="flex flex-col gap-3 border-t border-line-2 pt-4" data-exam-editor="">
      {/* 머리 줄 — 문제 · 초안/발행됨 · n문항 · m점 · [발행]/[초안으로] */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={`exam-head-${nodeId}`} className="m-0 text-[15px] font-bold text-ink">
          문제
        </h3>
        <span role="status" className="min-w-0 text-[13px] font-medium text-ink-2">
          {head}
        </span>
        <div className="ml-auto">
          {draftState ? (
            <button type="button" disabled={!canPublish || busy || !!ask} aria-describedby={view && !canPublish ? `exam-empty-${nodeId}` : undefined} onClick={() => setAsk("publish")} className="h-11 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white disabled:opacity-50">
              발행
            </button>
          ) : (
            <button type="button" disabled={!view || unpublishLocked || busy || !!ask} aria-describedby={unpublishLocked ? lockId : undefined} onClick={() => setAsk("unpublish")} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-semibold text-ink disabled:opacity-50">
              초안으로
            </button>
          )}
        </div>
      </div>
      {draftState && view && !canPublish && (
        <p id={`exam-empty-${nodeId}`} className="m-0 -mt-1 text-[12px] font-medium text-muted">
          {EMPTY_NOTE}
        </p>
      )}
      {ask === "publish" && (
        <InlineConfirm
          text={`팀원 ${assignees}명에게 알림이 가요${dirty ? " · 고친 문항을 먼저 저장해요" : ""}`}
          onCancel={() => setAsk(null)}
          actions={[{ label: dirty ? "저장하고 발행" : "발행", tone: "primary", onClick: () => void doPublish(true), disabled: busy }]}
        />
      )}
      {ask === "unpublish" && (
        <InlineConfirm text="초안으로 되돌리면 팀원에게 다시 보이지 않아요 · 응시가 시작된 시험은 되돌릴 수 없어요" onCancel={() => setAsk(null)} actions={[{ label: "초안으로", onClick: () => void doPublish(false), disabled: busy }]} />
      )}

      {ai && (
        <div className="[&_button]:h-11">
          <Seg<ExamTab> label="출제 방법" value={tab} onChange={setTab} options={[["manual", "직접 작성"], ["ai", "AI 로 생성"]]} />
        </div>
      )}

      {ai && tab === "ai" ? (
        ai(ed, () => setTab("manual"))
      ) : (
        <>
          {lockNote && (
            <p id={lockId} role="note" className="m-0 rounded-[9px] bg-[#FDF4E1] px-[10px] py-2 text-[12px] font-semibold text-amber-text">
              {lockNote}
            </p>
          )}
          {!view ? (
            ed.loadErr ? (
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                시험을 불러오지 못했어요
                <button type="button" onClick={() => void ed.reload()} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[13px] font-semibold text-ink">
                  다시 불러오기
                </button>
              </div>
            ) : (
              <p className="m-0 text-[13px] text-muted">문제를 불러오는 중…</p>
            )
          ) : (
            <>
              {draft.questions.length === 0 ? (
                <p className="m-0 rounded-[12px] border border-dashed border-line-3 px-3 py-4 text-center text-[13px] text-muted">아직 문항이 없어요 · 아래에서 유형을 골라 추가해 주세요</p>
              ) : (
                <ol aria-label="문항" className="m-0 flex list-none flex-col gap-3 p-0">
                  {draft.questions.map((q, i) => (
                    <ExamQuestionForm key={i} q={q} i={i} count={draft.questions.length} locked={locked} lockId={locked ? lockId : undefined} err={fieldErr && fieldErr.index === i ? fieldErr : null} dispatch={ed.dispatch} />
                  ))}
                </ol>
              )}

              {!locked && (
                <div role="group" aria-label="문항 추가" className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-semibold text-ink-3">문항 추가</span>
                  {QTYPES.map((t) => (
                    <button key={t} type="button" disabled={draft.questions.length >= EXAM_LIMITS.questions} onClick={() => ed.dispatch({ type: "add", qtype: t })} className="inline-flex h-11 items-center rounded-[22px] border border-dashed border-line-3 bg-surface px-4 text-[13px] font-semibold text-ink-2 disabled:opacity-50">
                      + {QTYPE_KO[t]}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-ink-3">정답·해설 공개</span>
                <div className="[&_button]:h-11">
                  <Seg<ExamReveal> label="정답·해설 공개" value={draft.reveal} onChange={(r) => ed.dispatch({ type: "setReveal", reveal: r })} options={[["after_submit", REVEAL_KO.after_submit], ["after_deadline", REVEAL_KO.after_deadline]]} />
                </div>
              </div>

              {globalErr && (
                <p role="alert" className="m-0 rounded-[9px] bg-[#FFF1EF] px-[10px] py-2 text-[12px] font-semibold text-warn">
                  {globalErr.message}
                </p>
              )}

              <button type="button" disabled={!dirty || busy} aria-busy={saving || undefined} onClick={() => void ed.save().then((ok) => ok && toast({ text: "문제를 저장했어요", tone: "ok" }))} className="h-11 w-full rounded-[22px] bg-navy text-[14px] font-semibold text-white disabled:opacity-50">
                {saving ? "저장하는 중…" : "문제 저장"}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
