"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { GuardedLink as Link } from "@/components/ui/GuardedLink";
import { studyTone } from "@/components/tasks/tone";
import type { WrongNoteExam, WrongNoteItem } from "@/lib/api/types";
import type { WrongNoteAnswer } from "@/lib/api/wrongNote";
import { routes } from "@/lib/routes";
import { isAnswered } from "./exam";
import type { PracticeOutcome } from "./useWrongNote";
import { BTN, BTN_PRIMARY, WrongNoteItemView, type ItemRun } from "./WrongNoteItem";
import {
  applyFilter, batchSummary, emptyState, examHeadLine, FILTER_EMPTY_TEXT, FILTER_KO, FILTERS, studyEmptyLine, totalsLine, totalsOf, type Filter, type NoteStudy,
} from "./wrongNote";

type Props = {
  studies: NoteStudy[];
  /** 방 탭: 승인 대기(PENDING) — 내용 없이 안내만 */
  pending?: boolean;
  /** room = 방 탭(스터디 1개, 머리 없음) · all = 내 과제(스터디마다 h2) — 빈 상태 문구가 다르다 */
  scope: "room" | "all";
  /** 내 과제 ?study= — 그 스터디 섹션만(모르는 slug 는 전체) */
  studyFilter?: string;
  busy: boolean;
  onPractice: (slug: string, answers: WrongNoteAnswer[]) => Promise<PracticeOutcome>;
  onMaster: (slug: string, questionId: string, on: boolean) => Promise<boolean>;
  /** 묶음 채점 막대를 본문 카드 끝까지 — 그 화면 카드 안쪽 여백만큼 음수 마진 + 같은 여백(기본 = 내 스터디 본문 카드) */
  barInset?: string;
};

/** 다시 풀기 중인 문항 — snap 은 시작할 때의 문항(필터는 이걸로 판정해 채점 결과로 목록에서 갑자기 사라지지 않게) */
type Run = { snap: WrongNoteItem; st: ItemRun };
type Batch = { slug: string; ids: string[]; summary: string | null };

const CHIP = "inline-flex h-11 shrink-0 items-center rounded-[22px] border px-4 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint";
const BAR_INSET = "-mx-7 px-7 max-[901px]:-mx-4 max-[901px]:px-4";

const itemsOf = (ss: NoteStudy[]) => ss.flatMap((s) => s.rounds.flatMap((r) => r.exams.flatMap((ex) => ex.items ?? [])));

/** 오답노트 본문(스펙 §6.1·§6.2·§6.5) — 방 탭(스터디 1개)과 내 과제 보기(여러 개)가 같이 쓴다. 데이터·호출은 부모(useWrongNote) */
export function WrongNoteList({ studies, pending, scope, studyFilter = "all", busy, onPractice, onMaster, barInset = BAR_INSET }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showMastered, setShowMastered] = useState(false);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [batches, setBatches] = useState<Record<string, Batch>>({});
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});

  const live = useMemo(() => new Map(itemsOf(studies).map((it) => [it.question.id, it])), [studies]);
  // 다시 풀기 중인 문항은 시작할 때 모습으로 필터를 통과시킨다
  const frozen = useMemo(
    () =>
      studies.map((s) => ({
        ...s,
        rounds: s.rounds.map((r) => ({ ...r, exams: r.exams.map((ex) => (ex.items ? { ...ex, items: ex.items.map((it) => runs[it.question.id]?.snap ?? it) } : ex)) })),
      })),
    [studies, runs],
  );
  const visibleOf = (f: Filter, m: boolean) => applyFilter(frozen, f, m, studyFilter);
  const visible = visibleOf(filter, showMastered);
  const selected = applyFilter(studies, "all", true, studyFilter);
  const totals = totalsOf(selected);
  const empty = emptyState(selected, { pending, showMastered, scope, visible });

  // 필터를 바꿔 목록에서 빠진 문항의 입력은 버린다(D15 — 잃어도 되는 값)
  const changeView = (f: Filter, m: boolean) => {
    const keep = new Set(itemsOf(visibleOf(f, m)).map((it) => it.question.id));
    setFilter(f);
    setShowMastered(m);
    setRuns((r) => Object.fromEntries(Object.entries(r).filter(([id]) => keep.has(id))));
    setBatches((b) =>
      Object.fromEntries(
        Object.entries(b)
          .map(([k, v]) => [k, { ...v, ids: v.ids.filter((id) => keep.has(id)) }] as const)
          .filter(([, v]) => v.ids.length > 0),
      ),
    );
  };

  const setRun = (id: string, st: ItemRun | null) =>
    setRuns((r) => {
      const next = { ...r };
      const snap = r[id]?.snap ?? live.get(id);
      if (st && snap) next[id] = { snap, st };
      else delete next[id];
      return next;
    });
  const clearErr = (ids: string[]) => setFieldErr((e) => Object.fromEntries(Object.entries(e).filter(([id]) => !ids.includes(id))));
  const failed = (o: PracticeOutcome) => {
    if (!o.ok && o.field) setFieldErr((e) => ({ ...e, [o.field!]: "답을 확인해 주세요" }));
  };

  const gradeOne = async (slug: string, id: string) => {
    const run = runs[id];
    if (!run || run.st.s !== "take") return;
    const answer = run.st.answer;
    clearErr([id]);
    const o = await onPractice(slug, [{ questionId: id, answer }]);
    if (o.ok && o.results[id]) setRun(id, { s: "done", answer, correct: o.results[id].correct });
    else failed(o);
  };

  const startBatch = (slug: string, ex: WrongNoteExam) => {
    const ids = (ex.items ?? []).map((it) => it.question.id);
    setRuns((r) => {
      const next = { ...r };
      for (const id of ids) next[id] = { snap: r[id]?.snap ?? live.get(id)!, st: { s: "take", answer: null } };
      return next;
    });
    clearErr(ids);
    setBatches((b) => ({ ...b, [ex.nodeId]: { slug, ids, summary: null } }));
  };
  const endBatch = (nodeId: string) => {
    const ids = batches[nodeId]?.ids ?? [];
    setRuns((r) => Object.fromEntries(Object.entries(r).filter(([id]) => !ids.includes(id))));
    clearErr(ids);
    setBatches((b) => {
      const next = { ...b };
      delete next[nodeId];
      return next;
    });
  };
  const gradeBatch = async (nodeId: string) => {
    const b = batches[nodeId];
    if (!b) return;
    const answers = b.ids.map((id) => ({ questionId: id, answer: runs[id]?.st.answer ?? null }));
    clearErr(b.ids);
    const o = await onPractice(b.slug, answers);
    if (!o.ok) return failed(o);
    setRuns((r) => {
      const next = { ...r };
      for (const a of answers) if (next[a.questionId] && o.results[a.questionId]) next[a.questionId] = { ...next[a.questionId], st: { s: "done", answer: a.answer, correct: o.results[a.questionId].correct } };
      return next;
    });
    setBatches((all) => ({ ...all, [nodeId]: { ...b, summary: batchSummary(o.results, b.ids.length) } }));
  };

  if (empty && empty.text !== FILTER_EMPTY_TEXT) {
    return (
      <div className="mt-[18px] rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">
        <p className="m-0">{empty.text}</p>
        {empty.masteredLink && (
          <button type="button" onClick={() => changeView(filter, true)} className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-mint-deep underline underline-offset-2">
            외운 문제 {totals.mastered}개 보기
          </button>
        )}
      </div>
    );
  }

  const line = totalsLine(totals);
  const onChipKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = FILTERS[(FILTERS.indexOf(filter) + d + FILTERS.length) % FILTERS.length];
    changeView(next, showMastered);
    e.currentTarget.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus();
  };

  return (
    <div className="mt-[18px] flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {line && <p className="m-0 text-[14px] font-semibold text-ink-2">{line}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div role="radiogroup" aria-label="오답 필터" onKeyDown={onChipKey} className="flex min-w-0 max-w-full gap-2 overflow-x-auto">
            {FILTERS.map((f) => {
              const on = f === filter;
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  data-filter={f}
                  onClick={() => changeView(f, showMastered)}
                  className={`${CHIP} ${on ? "border-ink bg-ink font-semibold text-white" : "border-line-3 bg-surface font-medium text-ink-3"}`}
                >
                  {FILTER_KO[f]}
                </button>
              );
            })}
          </div>
          {totals.mastered > 0 && (
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={showMastered} onChange={(e) => changeView(filter, e.target.checked)} className="size-[18px] accent-mint" />
              외운 문제 {totals.mastered}개 보기
            </label>
          )}
        </div>
      </div>

      {empty ? (
        <p className="m-0 rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">{empty.text}</p>
      ) : (
        visible.map((vs) => {
          const s = selected.find((x) => x.slug === vs.slug) ?? vs;
          const studyLine = scope === "all" ? studyEmptyLine(s, vs) : null;
          return (
            <section key={vs.slug} aria-label={vs.title} className="flex flex-col gap-4">
              {vs.title && (
                <h2 className="m-0 flex items-center gap-2 px-1 text-[15px] font-bold">
                  <span aria-hidden="true" className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: studyTone(vs.tone ?? "mint").dot }} />
                  <span className="min-w-0">{vs.title}</span>
                  <Link href={routes.myStudyTab(vs.slug, "wrong")} className="ml-auto inline-flex min-h-11 shrink-0 items-center px-2 text-[13px] font-semibold text-mint">
                    오답노트 ›
                  </Link>
                </h2>
              )}
              {studyLine && <p className="m-0 px-1 text-[13px] text-muted">{studyLine}</p>}
              {vs.rounds.map((r) => (
                <section key={r.id} aria-labelledby={`wn-round-${vs.slug}-${r.id}`} className="flex flex-col gap-3">
                  <h3 id={`wn-round-${vs.slug}-${r.id}`} className="m-0 text-[15px] font-bold text-ink">
                    {r.title}
                  </h3>
                  {r.exams.map((ex) => (
                    <ExamCard
                      key={ex.nodeId}
                      ex={ex}
                      live={live}
                      runs={runs}
                      batch={batches[ex.nodeId] ?? null}
                      fieldErr={fieldErr}
                      busy={busy}
                      barInset={barInset}
                      onRun={setRun}
                      onGrade={(id) => void gradeOne(vs.slug, id)}
                      onMaster={(id, on) => {
                        clearErr([id]);
                        void onMaster(vs.slug, id, on);
                      }}
                      onStartBatch={() => startBatch(vs.slug, ex)}
                      onGradeBatch={() => void gradeBatch(ex.nodeId)}
                      onEndBatch={() => endBatch(ex.nodeId)}
                    />
                  ))}
                </section>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}

type CardProps = {
  ex: WrongNoteExam;
  live: Map<string, WrongNoteItem>;
  runs: Record<string, Run>;
  batch: Batch | null;
  fieldErr: Record<string, string>;
  busy: boolean;
  barInset: string;
  onRun: (id: string, st: ItemRun | null) => void;
  onGrade: (id: string) => void;
  onMaster: (id: string, on: boolean) => void;
  onStartBatch: () => void;
  onGradeBatch: () => void;
  onEndBatch: () => void;
};

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/** 시험 카드 — 잠금(개수·날짜만, 버튼 없음) 또는 오답 문항 목록 + [이 시험 다시 풀기] · 묶음 채점 하단 막대 */
function ExamCard({ ex, live, runs, batch, fieldErr, busy, barInset, onRun, onGrade, onMaster, onStartBatch, onGradeBatch, onEndBatch }: CardProps) {
  const titleId = `wn-exam-${ex.nodeId}`;
  if (ex.locked) {
    return (
      <article aria-labelledby={titleId} className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface-2 px-4 py-3">
        <h4 id={titleId} className="m-0 flex items-center gap-2 text-[15px] font-bold text-ink">
          <span className="min-w-0 [overflow-wrap:anywhere]">{ex.title}</span>
          <span className="text-ink-3">
            <LockIcon />
          </span>
        </h4>
        <p className="m-0 text-[13px] text-ink-3">{examHeadLine(ex)}</p>
      </article>
    );
  }
  const items = (ex.items ?? []).map((it) => live.get(it.question.id) ?? it);
  const answered = batch ? batch.ids.filter((id) => isAnswered(runs[id]?.st.answer)).length : 0;
  return (
    <article aria-labelledby={titleId} className="flex flex-col">
      <div className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface-2 px-4 py-4 max-sm:px-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-[2px]">
            <h4 id={titleId} className="m-0 text-[15px] font-bold text-ink [overflow-wrap:anywhere]">
              {ex.title}
            </h4>
            <p className="m-0 text-[13px] text-ink-3">{examHeadLine(ex)}</p>
          </div>
          {!batch && (
            <button type="button" className={BTN} disabled={busy} onClick={onStartBatch}>
              이 시험 다시 풀기
            </button>
          )}
        </div>
        <ol className="m-0 flex list-none flex-col gap-4 rounded-[12px] bg-surface p-4 max-sm:p-3">
          {items.map((it) => {
            const id = it.question.id;
            return (
              <WrongNoteItemView
                key={id}
                it={it}
                run={runs[id]?.st}
                inBatch={!!batch?.ids.includes(id)}
                busy={busy}
                fieldError={fieldErr[id] ?? null}
                onStart={() => onRun(id, { s: "take", answer: null })}
                onAnswer={(a) => onRun(id, { s: "take", answer: a })}
                onGrade={() => onGrade(id)}
                onClose={() => onRun(id, null)}
                onMaster={(on) => onMaster(id, on)}
              />
            );
          })}
        </ol>
      </div>
      {batch && (
        // 하단 고정 막대 — 시험 응시(ExamSection)의 막대와 같은 방식. 카드가 끝나면 따라 올라간다
        <div className={`sticky bottom-0 z-[2] mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-2 bg-surface py-2 ${barInset}`}>
          <p className="m-0 min-w-0 flex-1 text-[13px] text-ink-2" aria-live="polite">
            {batch.summary ?? (
              <>
                <b className="font-bold text-ink">
                  {answered}/{batch.ids.length}
                </b>{" "}
                답함
              </>
            )}
          </p>
          {batch.summary ? (
            <button type="button" className={BTN} onClick={onEndBatch}>
              닫기
            </button>
          ) : (
            <>
              <button type="button" className={BTN} disabled={busy} onClick={onEndBatch}>
                그만두기
              </button>
              <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={onGradeBatch}>
                {busy ? "채점 중…" : "채점"}
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** 처음 받는 중 — 시험 응시 카드와 같은 자리표시 */
export function WrongNoteLoading() {
  return (
    <div aria-busy="true" aria-label="오답노트 불러오는 중" className="mt-[18px] flex flex-col gap-3">
      <div className="h-5 w-40 rounded-[6px] bg-line-2" />
      <div className="h-[120px] rounded-[14px] bg-surface-3" />
    </div>
  );
}

export function WrongNoteError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mt-[18px] flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
      <span className="min-w-0 flex-[1_1_200px]">오답노트를 불러오지 못했어요</span>
      <button type="button" onClick={onRetry} className="h-11 shrink-0 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink">
        다시 시도
      </button>
    </div>
  );
}
