"use client";

import { useRef, useState, type ReactNode } from "react";
import { studyTone } from "@/components/tasks/tone";
import type { WrongNoteExam, WrongNoteItem, WrongNoteRound } from "@/lib/api/types";
import { isAnswered } from "./exam";
import { NAV_TONE, QuestionNav, QuestionNavSheet, useCurrentQuestion, type NavGroup } from "./tabs/ExamNav";
import { BTN, BTN_PRIMARY, WrongNoteItemView, type ItemRun } from "./WrongNoteItem";
import {
  examHeadLine, FILTER_EMPTY_TEXT, lastMark, periodLine, RETRY_TIER_KO, retryCount, retryLabel, retryTier, roundLockedLine, roundStatParts, roundStats, type NoteStudy, type RetryTier,
} from "./wrongNote";

/** 다시 풀기 중인 문항 — snap 은 시작할 때의 문항(필터는 이걸로 판정해 채점 결과로 목록에서 갑자기 사라지지 않게) */
export type Run = { snap: WrongNoteItem; st: ItemRun };
export type Batch = { slug: string; ids: string[]; summary: string | null };

/** 다시 푼 횟수 단계 색 — 0 = 기본, 1 = 연한 파랑, 2 = 파랑, 3번+ = 남색(한 색 계열로 진해진다). 마지막 정오는 귀퉁이 ✓·✗ */
const TIER_SWATCH: Record<RetryTier, string> = {
  0: "border-line-3 bg-surface text-ink-3",
  1: "border-blue/30 bg-blue-soft text-blue-text",
  2: "border-blue bg-blue text-white",
  3: "border-navy bg-navy text-white",
};
const TIER_TONE: Record<RetryTier, string> = {
  0: NAV_TONE.idle,
  1: `${TIER_SWATCH[1]} hover:bg-[#d3e0fb]`,
  2: `${TIER_SWATCH[2]} hover:bg-[#3263cf]`,
  3: `${TIER_SWATCH[3]} hover:bg-[#2e3363]`,
};
const TIERS: RetryTier[] = [0, 1, 2, 3];

/** 넓은 화면 기준 — 이 폭부터 오른쪽에 문항 이동이 붙는다(본문 카드 폭 기준 @container) */
const SIDE_NAV = "hidden @[760px]:flex";
const SHEET_ONLY = "@[760px]:hidden";

type Props = {
  /** 상세 머리(제목·숫자)는 필터 전 회차, 본문은 필터 결과(visible) — 필터로 비면 null */
  study: NoteStudy;
  round: WrongNoteRound;
  visible: WrongNoteRound | null;
  scope: "room" | "all";
  live: Map<string, WrongNoteItem>;
  runs: Record<string, Run>;
  batches: Record<string, Batch>;
  fieldErr: Record<string, string>;
  busy: boolean;
  barInset: string;
  period?: { startDate: string; endDate: string };
  /** 필터 칩 줄(목록과 같은 상태) */
  filterBar: ReactNode;
  onBack: () => void;
  onRun: (id: string, st: ItemRun | null) => void;
  onGrade: (id: string) => void;
  onMaster: (id: string, on: boolean) => void;
  onStartBatch: (ex: WrongNoteExam) => void;
  onGradeBatch: (nodeId: string) => void;
  onEndBatch: (nodeId: string) => void;
};

const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

/** 회차 오답노트 상세(D23·D24) — 시험 카드·문항 목록 + 오른쪽 따라오는 문항 이동(다시 푼 횟수 색 · 각주). 좁으면 하단 막대 [문항 이동] 바텀 시트 */
export function WrongNoteDetail(p: Props) {
  const { study, round, visible, runs, batches, live } = p;
  const stats = roundStats(round);
  const period = periodLine(p.period);
  const listRef = useRef<HTMLDivElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = () => setNavOpen(false);

  // 문항 이동 칸 — 잠기지 않은 시험별 묶음, 번호는 시험 안 번호(문항 머리와 같은 수). 순번은 묶음을 이어 센다
  const exams = visible?.exams ?? [];
  const ids: string[] = [];
  const groups: NavGroup[] = [];
  let taking = 0;
  let answered = 0;
  for (const ex of exams) {
    if (ex.locked) continue;
    const b = batches[ex.nodeId];
    const inTake = !!b && b.summary === null;
    groups.push({
      key: ex.nodeId,
      title: exams.filter((e) => !e.locked).length > 1 ? ex.title : undefined,
      cells: (ex.items ?? []).map((snap) => {
        const it = live.get(snap.question.id) ?? snap;
        ids.push(it.question.id);
        if (inTake && b.ids.includes(it.question.id)) {
          // 묶음 다시 풀기 중 — 시험 응시와 같이 답함/안 답함
          const a = isAnswered(runs[it.question.id]?.st.answer);
          taking += 1;
          if (a) answered += 1;
          return { key: it.question.id, text: String(it.no), label: `${it.no}번 문항 · ${a ? "답함" : "안 답함"}`, tone: a ? NAV_TONE.answered : NAV_TONE.idle };
        }
        return { key: it.question.id, text: String(it.no), label: retryLabel(it), tone: TIER_TONE[retryTier(retryCount(it))], mark: lastMark(it) };
      }),
    });
  }
  const [current, setCurrent] = useCurrentQuestion(listRef, ids.join(","), "wn-idx");
  const idxOf = new Map(ids.map((id, i) => [id, i]));
  const jump = (i: number) => {
    const id = ids[i];
    const li = listRef.current?.querySelector<HTMLElement>(`[data-wn-item="${id}"]`);
    if (!li) return;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    li.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    document.getElementById(`exam-q-wn-${id}`)?.focus({ preventScroll: true });
    setCurrent(i);
    setNavOpen(false);
  };
  const summary =
    taking > 0 ? (
      <>
        <b className="font-bold text-ink">
          {answered}/{taking}
        </b>{" "}
        답함
      </>
    ) : (
      <>
        <b className="font-bold text-ink">{ids.length}</b>문항
      </>
    );
  const legend = <NavLegend taking={taking > 0} />;
  const nav = ids.length > 0;

  return (
    <div className="mt-[18px] flex flex-col gap-4 @container">
      <div>
        <button type="button" onClick={p.onBack} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-[10px] px-2 text-[13px] font-semibold text-ink-2 hover:bg-surface-2">
          <BackIcon />
          회차 목록
        </button>
      </div>
      <header className="flex flex-col gap-1">
        {p.scope === "all" && study.title && (
          <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-ink-3">
            <span aria-hidden="true" className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: studyTone(study.tone ?? "mint").dot }} />
            {study.title}
          </p>
        )}
        <h3 data-wn-head tabIndex={-1} className="m-0 text-[18px] font-bold text-ink outline-none [overflow-wrap:anywhere]">
          {round.title}
        </h3>
        <p className="m-0 text-[13px] text-ink-3">{[period, `시험 ${stats.exams}개`, ...roundStatParts(stats).map(([k, n]) => `${k} ${n}`)].filter(Boolean).join(" · ")}</p>
      </header>

      {stats.allLocked ? (
        <p role="note" className="m-0 flex items-center gap-2 rounded-[14px] border border-line bg-surface-2 px-4 py-3 text-[13px] text-ink-2">
          <LockIcon />
          {roundLockedLine(stats)} · 정답이 공개되면 문항을 볼 수 있어요
        </p>
      ) : (
        p.filterBar
      )}

      {!stats.allLocked && exams.length === 0 && (
        <p className="m-0 rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">{FILTER_EMPTY_TEXT}</p>
      )}

      {exams.length > 0 && (
        <div className="flex items-start gap-6">
          <div ref={listRef} className="flex min-w-0 flex-1 flex-col gap-4">
            {(stats.allLocked ? round.exams : exams).map((ex) => (
              <ExamCard
                key={ex.nodeId}
                ex={ex}
                live={live}
                runs={runs}
                idxOf={idxOf}
                batch={batches[ex.nodeId] ?? null}
                fieldErr={p.fieldErr}
                busy={p.busy}
                barInset={p.barInset}
                onRun={p.onRun}
                onGrade={p.onGrade}
                onMaster={p.onMaster}
                onStartBatch={() => p.onStartBatch(ex)}
                onGradeBatch={() => p.onGradeBatch(ex.nodeId)}
                onEndBatch={() => p.onEndBatch(ex.nodeId)}
              />
            ))}
          </div>
          {nav && (
            <QuestionNav
              variant="side"
              groups={groups}
              summary={summary}
              current={current}
              onJump={jump}
              legend={legend}
              className={`sticky top-[max(16px,calc(50vh-220px))] max-h-[min(480px,calc(100vh-100px))] w-[220px] shrink-0 overflow-y-auto rounded-[14px] border border-line bg-surface-2 p-3 ${SIDE_NAV}`}
            />
          )}
        </div>
      )}

      {nav && (
        // 좁은 화면 — 시험 응시처럼 하단 고정 막대의 [문항 이동] 이 바텀 시트를 연다. 묶음 채점 막대는 이 막대 위에 선다
        <div className={`sticky bottom-0 z-[3] flex flex-col gap-2 border-t border-line-2 bg-surface py-2 ${p.barInset} ${SHEET_ONLY}`}>
          {navOpen && <QuestionNavSheet id="wn-nav-sheet" groups={groups} summary={summary} current={current} onJump={jump} legend={legend} onClose={closeNav} />}
          <div className="flex items-center gap-3">
            {/* 묶음 다시 풀기 중이면 "n/총 답함" 은 바로 위 묶음 막대가 보인다 — 겹치지 않게 비운다 */}
            <p className="m-0 min-w-0 flex-1 text-[13px] text-ink-2">{taking === 0 && summary}</p>
            <button
              type="button"
              aria-expanded={navOpen}
              aria-controls="wn-nav-sheet"
              onClick={() => setNavOpen((o) => !o)}
              className="h-11 shrink-0 cursor-pointer rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-semibold text-ink hover:bg-surface-2"
            >
              문항 이동
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 문항 이동 각주 — 번호 칸 아래. 색 단계 + 귀퉁이 표시(묶음 다시 풀기 중이면 「답함」 도) */
function NavLegend({ taking }: { taking: boolean }) {
  const sw = "inline-block size-3 shrink-0 rounded-[4px] border";
  return (
    <div data-wn-legend className="flex flex-col gap-[6px] border-t border-line-2 pt-2 text-[11px] text-ink-3">
      <p className="m-0 font-semibold text-ink-2">다시 푼 횟수</p>
      <ul className="m-0 flex list-none flex-wrap gap-x-[10px] gap-y-1 p-0">
        {TIERS.map((t) => (
          <li key={t} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={`${sw} ${TIER_SWATCH[t]}`} />
            {RETRY_TIER_KO[t]}
          </li>
        ))}
      </ul>
      <ul className="m-0 flex list-none flex-wrap gap-x-[10px] gap-y-1 p-0">
        <li className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="grid size-3 place-items-center rounded-full bg-done text-[8px] leading-none text-white">✓</span>
          마지막에 맞힘
        </li>
        <li className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="grid size-3 place-items-center rounded-full bg-warn text-[8px] leading-none text-white">✗</span>
          마지막에 틀림
        </li>
        {taking && (
          <li className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={`${sw} border-mint/40 bg-mint-soft`} />
            답함
          </li>
        )}
      </ul>
    </div>
  );
}

export const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

type CardProps = {
  ex: WrongNoteExam;
  live: Map<string, WrongNoteItem>;
  runs: Record<string, Run>;
  idxOf: Map<string, number>;
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

/** 시험 카드 — 잠금(개수·날짜만, 버튼 없음) 또는 오답 문항 목록 + [이 시험 다시 풀기] · 묶음 채점 하단 막대 */
function ExamCard({ ex, live, runs, idxOf, batch, fieldErr, busy, barInset, onRun, onGrade, onMaster, onStartBatch, onGradeBatch, onEndBatch }: CardProps) {
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
                idx={idxOf.get(id)}
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
        // 하단 고정 막대 — 시험 응시(ExamSection)의 막대와 같은 방식. 카드가 끝나면 따라 올라간다. 좁은 화면은 [문항 이동] 막대 위
        <div className={`sticky bottom-[61px] z-[2] mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-2 bg-surface py-2 @[760px]:bottom-0 ${barInset}`}>
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
            // 채점하면 [채점] 이 사라진다 — 포커스가 body 로 빠지지 않게 [닫기] 로
            <button type="button" className={BTN} onClick={onEndBatch} ref={(el) => void (el && (!document.activeElement || document.activeElement === document.body) && el.focus())}>
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
