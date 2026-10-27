"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GuardedLink as Link } from "@/components/ui/GuardedLink";
import { studyTone } from "@/components/tasks/tone";
import type { WrongNoteExam, WrongNoteRound } from "@/lib/api/types";
import type { WrongNoteAnswer } from "@/lib/api/wrongNote";
import { routes } from "@/lib/routes";
import type { PracticeOutcome } from "./useWrongNote";
import { LockIcon, WrongNoteDetail, type Batch, type Run } from "./WrongNoteDetail";
import { WrongNoteItemView, type ItemRun } from "./WrongNoteItem";
import {
  applyFilter, batchSummary, emptyState, FILTER_EMPTY_TEXT, FILTER_KO, FILTERS, findRound, periodLine, roundLockedLine, roundStarCount, roundStatParts, roundStats, starEntries, studyEmptyLine,
  totalsLine, totalsOf, visibleCount, type Filter, type NoteStudy, type RoundPeriods, type StarEntry,
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
  /** 다시 볼 문제(★, 0051) 켜기·끄기 */
  onBookmark: (slug: string, questionId: string, on: boolean) => Promise<boolean>;
  /** 묶음 채점 막대를 본문 카드 끝까지 — 그 화면 카드 안쪽 여백만큼 음수 마진 + 같은 여백(기본 = 내 스터디 본문 카드) */
  barInset?: string;
  /** 열린 회차(주소 ?round=, useNoteRound) — null 이면 회차 카드 목록 */
  round?: string | null;
  onOpenRound?: (id: string) => void;
  onBack?: () => void;
  /** 회차 기간 — 응답에 없어 화면이 넘긴다(없으면 기간 줄을 뺀다) */
  periods?: RoundPeriods;
};

const CHIP = "inline-flex h-11 shrink-0 items-center rounded-[22px] border px-4 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint";
const BAR_INSET = "-mx-7 px-7 max-[901px]:-mx-4 max-[901px]:px-4";
const noop = () => {};

const itemsOf = (ss: NoteStudy[]) => ss.flatMap((s) => s.rounds.flatMap((r) => r.exams.flatMap((ex) => ex.items ?? [])));

/**
 * 오답노트 본문(스펙 §6.1·§6.2·§6.5 · D22~) — 방 탭(스터디 1개)과 내 과제 보기(여러 개)가 같이 쓴다. 데이터·호출은 부모(useWrongNote).
 * 첫 화면은 회차 카드, 카드를 누르면 그 회차 상세(문항·다시 풀기·문항 이동). 필터는 두 화면이 같은 상태를 쓴다
 */
export function WrongNoteList({ studies, pending, scope, studyFilter = "all", busy, onPractice, onMaster, onBookmark, barInset = BAR_INSET, round = null, onOpenRound = noop, onBack = noop, periods }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  // ★ 모아 보기 — 연 때의 ★ 문항(ids)을 보여 준다. 보는 중에 ☆ 로 꺼도 그 자리에 남는다(되돌리기 · 포커스가 사라지지 않게)
  const [starIds, setStarIds] = useState<ReadonlySet<string> | null>(null);
  // ★ 에서 「회차에서 보기」 — 상세가 열리면 그 문항으로 스크롤·포커스
  const jumpTo = useRef<string | null>(null);
  const [showMastered, setShowMastered] = useState(false);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [batches, setBatches] = useState<Record<string, Batch>>({});
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  // 다른 회차로 가면(목록 포함) 다시 풀기 입력은 버린다(D15 — 잃어도 되는 값)
  const [shownRound, setShownRound] = useState(round);
  if (shownRound !== round) {
    setShownRound(round);
    setRuns({});
    setBatches({});
    setFieldErr({});
  }
  const rootRef = useRef<HTMLDivElement>(null);
  // 상세를 열면 그 제목으로, 목록으로 돌아오면 그 회차 카드로 — 처음 그린 화면(새로고침·링크)은 포커스를 옮기지 않는다
  const prevRound = useRef(round);
  useEffect(() => {
    const prev = prevRound.current;
    prevRound.current = round;
    if (prev === round) return;
    const want = jumpTo.current;
    jumpTo.current = null;
    if (round && want) {
      const li = rootRef.current?.querySelector<HTMLElement>(`[data-wn-item="${want}"]`);
      if (li) {
        li.scrollIntoView({ block: "start" });
        document.getElementById(`exam-q-wn-${want}`)?.focus({ preventScroll: true });
        return;
      }
    }
    const el = round
      ? rootRef.current?.querySelector<HTMLElement>("[data-wn-head]")
      : rootRef.current?.querySelector<HTMLElement>(`[data-round-card="${prev}"]`);
    el?.focus();
  }, [round]);
  // 외웠어요·다시 노트에 뒤 포커스 — 누른 단추가 사라져 body 로 빠지지 않게. [그 문항, 다음, 앞] 순서로 남아 있는 곳
  const focusWant = useRef<string[] | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    const want = focusWant.current;
    if (!want || !rootRef.current) return;
    const a = document.activeElement;
    if (a && a !== document.body && !rootRef.current.contains(a)) return;
    const root = rootRef.current;
    const [self, ...others] = want;
    const target =
      root.querySelector<HTMLElement>(`[data-wn-item="${self}"] [data-focus="master"]`) ??
      others.map((id) => root.querySelector<HTMLElement>(`[data-wn-item="${id}"] [data-focus="start"]`)).find(Boolean) ??
      root.querySelector<HTMLElement>("[role=radio][aria-checked=true]");
    if (!target) return;
    target.focus();
    focusWant.current = null;
  }, [focusTick, studies]);
  const master = async (slug: string, id: string, on: boolean) => {
    const els = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-wn-item]") ?? [])];
    const i = els.findIndex((e) => e.dataset.wnItem === id);
    const near = [els[i + 1], els[i - 1]].flatMap((e) => (e?.dataset.wnItem ? [e.dataset.wnItem] : []));
    if (!(await onMaster(slug, id, on))) return;
    focusWant.current = [id, ...near];
    setFocusTick((t) => t + 1);
  };

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
  // 내 과제에서 스터디 하나를 고르면(?study=) 그 섹션 머리(h2)를 남기고 빈 문구는 섹션 한 줄로(스펙 §6.5)
  const oneSection = scope === "all" && selected.length === 1;
  const empty = oneSection && !pending ? null : emptyState(selected, { pending, showMastered, scope, visible });
  const starCount = starEntries(selected).length;

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
    if (!o.ok || !o.results[id]) return failed(o);
    // 그사이 필터를 바꿔 입력을 버렸으면(목록에서 빠짐) 결과도 버린다
    const correct = o.results[id].correct;
    setRuns((r) => (r[id]?.st.s === "take" ? { ...r, [id]: { ...r[id], st: { s: "done", answer, correct } } } : r));
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
    // 응답을 기다리는 사이 필터로 묶음이 줄거나 사라졌을 수 있다 — 지금 남은 묶음의 문항에만 반영한다
    setBatches((all) => {
      const cur = all[nodeId];
      if (!cur) return all;
      const kept = Object.fromEntries(Object.entries(o.results).filter(([id]) => cur.ids.includes(id)));
      return { ...all, [nodeId]: { ...cur, summary: batchSummary(kept, cur.ids.length) } };
    });
    setRuns((r) => {
      const next = { ...r };
      for (const a of answers) if (next[a.questionId]?.st.s === "take" && o.results[a.questionId]) next[a.questionId] = { ...next[a.questionId], st: { s: "done", answer: a.answer, correct: o.results[a.questionId].correct } };
      return next;
    });
  };

  const openStars = () => setStarIds(new Set(starEntries(selected).map((e) => e.item.question.id)));
  const starButton = (
    <button
      type="button"
      aria-pressed={starIds !== null}
      onClick={() => (starIds ? setStarIds(null) : openStars())}
      className={`${CHIP} gap-1 ${starIds ? "border-amber-text bg-amber-soft font-semibold text-amber-text" : "border-line-3 bg-surface font-medium text-ink-3"}`}
    >
      <span aria-hidden="true">★</span> 다시 볼 문제 ({starCount})
    </button>
  );
  const itemHandlers = (slug: string, id: string) => ({
    onStart: () => setRun(id, { s: "take", answer: null }),
    onAnswer: (a: unknown) => setRun(id, { s: "take", answer: a }),
    onGrade: () => void gradeOne(slug, id),
    onClose: () => setRun(id, null),
    onMaster: (on: boolean) => {
      clearErr([id]);
      void master(slug, id, on);
    },
    onBookmark: (on: boolean) => void onBookmark(slug, id, on),
  });

  if (round === null && starIds && !pending) {
    const entries = starEntries(selected, starIds);
    return (
      <div ref={rootRef} className="mt-[18px] flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {starButton}
            <button type="button" onClick={() => setStarIds(null)} className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-mint-deep underline underline-offset-2">
              회차 목록으로
            </button>
          </div>
          <p className="m-0 text-[13px] text-ink-3">다시 풀어 맞혔거나 외운 문항도 ★ 표시를 끄기 전까지 여기에 모여요</p>
        </div>
        {entries.length === 0 ? (
          <p className="m-0 rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">
            아직 표시한 문항이 없어요 · 문항의 ☆ 다시 볼 문제를 누르면 여기에 모여요
          </p>
        ) : (
          <ol aria-label="다시 볼 문제" className="m-0 flex list-none flex-col gap-4 p-0">
            {entries.map((e) => (
              <StarRow
                key={e.item.question.id}
                e={e}
                scope={scope}
                busy={busy}
                run={runs[e.item.question.id]?.st}
                fieldError={fieldErr[e.item.question.id] ?? null}
                onOpen={() => {
                  jumpTo.current = e.item.question.id;
                  // 그 문항이 상세 필터에 가려지지 않게 — 「전체」 + (외운 문항이면) 외운 문제 보기
                  changeView("all", showMastered || e.item.mastered);
                  onOpenRound(e.round.id);
                }}
                h={itemHandlers(e.study.slug, e.item.question.id)}
              />
            ))}
          </ol>
        )}
      </div>
    );
  }

  if (empty && empty.text !== FILTER_EMPTY_TEXT) {
    return (
      <div className="mt-[18px] rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">
        {starCount > 0 && !pending && <div className="mb-3 flex justify-center">{starButton}</div>}
        <p className="m-0">{empty.text}</p>
        {empty.masteredLink && (
          <button type="button" onClick={() => changeView(filter, true)} className="mt-1 inline-flex min-h-11 items-center px-2 font-semibold text-mint-deep underline underline-offset-2">
            외운 문제 {totals.mastered}개 보기
          </button>
        )}
      </div>
    );
  }

  const onChipKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = FILTERS[(FILTERS.indexOf(filter) + d + FILTERS.length) % FILTERS.length];
    changeView(next, showMastered);
    e.currentTarget.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus();
  };
  // 상세의 「외운 문제 n개 보기」 는 그 회차 기준
  const filterBar = (mastered: number) => (
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
      {mastered > 0 && (
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" checked={showMastered} onChange={(e) => changeView(filter, e.target.checked)} className="size-[18px] accent-mint" />
          외운 문제 {mastered}개 보기
        </label>
      )}
    </div>
  );

  if (round !== null) {
    const hit = findRound(studies, round);
    if (!hit) {
      return (
        <div ref={rootRef} className="mt-[18px] flex flex-col items-start gap-2">
          <p className="m-0 w-full rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">이 회차의 오답을 찾을 수 없어요</p>
          <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-mint-deep underline underline-offset-2">
            회차 목록으로
          </button>
        </div>
      );
    }
    const vis = findRound(applyFilter(frozen, filter, showMastered), round);
    return (
      <div ref={rootRef}>
        <WrongNoteDetail
          study={hit.study}
          round={hit.round}
          visible={vis?.round ?? null}
          scope={scope}
          live={live}
          runs={runs}
          batches={batches}
          fieldErr={fieldErr}
          busy={busy}
          barInset={barInset}
          period={periods?.[round]}
          filterBar={filterBar(roundStats(hit.round).mastered)}
          onBack={onBack}
          onRun={setRun}
          onGrade={(id) => void gradeOne(hit.study.slug, id)}
          onMaster={(id, on) => {
            clearErr([id]);
            void master(hit.study.slug, id, on);
          }}
          onBookmark={(id, on) => void onBookmark(hit.study.slug, id, on)}
          onStartBatch={(ex) => startBatch(hit.study.slug, ex)}
          onGradeBatch={(nodeId) => void gradeBatch(nodeId)}
          onEndBatch={endBatch}
        />
      </div>
    );
  }

  const line = totalsLine(totals);
  return (
    <div ref={rootRef} className="mt-[18px] flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {line && <p className="m-0 text-[14px] font-semibold text-ink-2">{line}</p>}
        <div>{starButton}</div>
        {filterBar(totals.mastered)}
      </div>

      {empty ? (
        <p className="m-0 rounded-[14px] border border-dashed border-line-dash p-5 text-center text-[13px] text-muted">{empty.text}</p>
      ) : (
        visible.map((vs) => {
          const s = selected.find((x) => x.slug === vs.slug) ?? vs;
          const studyLine = scope === "all" ? studyEmptyLine(s, vs) : null;
          return (
            <section key={vs.slug} aria-label={vs.title} className="flex flex-col gap-3">
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
              {vs.rounds.length > 0 && (
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-3 p-0">
                  {vs.rounds.map((r) => (
                    <RoundCard
                      key={r.id}
                      round={s.rounds.find((x) => x.id === r.id) ?? r}
                      shown={visibleCount(r)}
                      filtered={filter !== "all" || showMastered}
                      period={periodLine(periods?.[r.id])}
                      onOpen={() => onOpenRound(r.id)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

type RoundCardProps = {
  /** 필터 전 회차 — 카드 숫자의 기준 */
  round: WrongNoteRound;
  /** 지금 필터로 상세에 보일 문항 수 */
  shown: number;
  filtered: boolean;
  period: string | null;
  onOpen: () => void;
};

/** 회차 카드(D22) — 회차명·기간·시험 수·오답/미답/다시 풀어 맞힘/외움/잠김. 전부 잠긴 회차는 열 수 없다(자물쇠 + 열리는 날) */
function RoundCard({ round, shown, filtered, period, onOpen }: RoundCardProps) {
  const st = roundStats(round);
  const stars = roundStarCount(round);
  const descId = `wn-round-desc-${round.id}`;
  const meta = [period, `시험 ${st.exams}개`].filter(Boolean).join(" · ");
  const parts = roundStatParts(st);
  if (st.allLocked) {
    return (
      <li>
        <article aria-labelledby={`wn-round-${round.id}`} className="flex h-full flex-col gap-2 rounded-[14px] border border-line bg-surface-2 px-4 py-[14px]">
          <h3 id={`wn-round-${round.id}`} className="m-0 flex items-center gap-2 text-[15px] font-bold text-ink-2">
            <span className="min-w-0 [overflow-wrap:anywhere]">{round.title}</span>
            <span className="ml-auto text-ink-3">
              <LockIcon />
            </span>
          </h3>
          <p className="m-0 text-[13px] text-ink-3">{meta}</p>
          <p className="m-0 text-[13px] font-semibold text-ink-3">
            {parts.map(([k, n]) => `${k} ${n}`).join(" · ")} · {roundLockedLine(st)}
          </p>
        </article>
      </li>
    );
  }
  return (
    <li>
      <article className="relative flex h-full flex-col gap-2 rounded-[14px] border border-line bg-surface px-4 py-[14px] transition-[box-shadow,border-color] hover:border-mint hover:shadow-[0_4px_14px_rgba(27,34,48,.08)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-mint motion-reduce:transition-none">
        <div className="flex items-center gap-2">
          <h3 className="m-0 min-w-0 text-[15px] font-bold text-ink">
            {/* 카드 전체가 누르는 자리(after 로 덮는다) — 이름은 회차명, 숫자는 설명으로 */}
            <button type="button" data-round-card={round.id} aria-describedby={descId} onClick={onOpen} className="cursor-pointer text-left outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-[14px]">
              {round.title}
            </button>
          </h3>
          <span aria-hidden="true" className="ml-auto text-[16px] text-ink-3">›</span>
        </div>
        <div id={descId} className="flex flex-col gap-2">
          <p className="m-0 text-[13px] text-ink-3">{meta}</p>
          <ul className="m-0 flex list-none flex-wrap gap-[6px] p-0">
            {parts.map(([k, n]) => (
              <li key={k} className={`rounded-[6px] px-[7px] py-[2px] text-[12px] font-semibold ${STAT_TONE[k] ?? "bg-slate-soft text-ink-3"}`}>
                {k} {n}
              </li>
            ))}
          </ul>
          {stars > 0 && (
            <p className="m-0 text-[12px] font-semibold text-amber-text">
              <span aria-hidden="true">★</span> 다시 볼 문제 {stars}
            </p>
          )}
          {filtered && <p className="m-0 text-[12px] font-semibold text-mint-deep">조건에 맞는 {shown}문항</p>}
        </div>
      </article>
    </li>
  );
}

const STAT_TONE: Record<string, string> = {
  오답: "bg-[#FFF1EF] text-warn",
  미답: "bg-[#FFF1EF] text-warn",
  "다시 풀어 맞힘": "bg-[#E3F5EC] text-[#1A7F55]",
};


type StarRowProps = {
  e: StarEntry;
  scope: "room" | "all";
  busy: boolean;
  run: ItemRun | undefined;
  fieldError: string | null;
  onOpen: () => void;
  h: Pick<Parameters<typeof WrongNoteItemView>[0], "onStart" | "onAnswer" | "onGrade" | "onClose" | "onMaster" | "onBookmark">;
};

/** ★ 모아 보기 한 줄 — 원래 자리(스터디·회차·시험) + 「회차에서 보기」 + 문항(다시 풀기·외웠어요·☆ 그대로) */
function StarRow({ e, scope, busy, run, fieldError, onOpen, h }: StarRowProps) {
  return (
    <li className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface-2 px-4 py-4 max-sm:px-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="m-0 flex min-w-0 flex-[1_1_200px] items-center gap-2 text-[13px] text-ink-3">
          {scope === "all" && e.study.title && (
            <>
              <span aria-hidden="true" className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: studyTone(e.study.tone ?? "mint").dot }} />
              <span className="font-semibold text-ink-2">{e.study.title}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {e.round.title} · {e.exam.title}
          </span>
        </p>
        <button type="button" onClick={onOpen} className="inline-flex min-h-11 shrink-0 items-center px-2 text-[13px] font-semibold text-mint-deep">
          회차에서 보기 ›
        </button>
      </div>
      <ol className="m-0 list-none rounded-[12px] bg-surface p-4 max-sm:p-3">
        <WrongNoteItemView it={e.item} run={run} inBatch={false} busy={busy} fieldError={fieldError} {...h} />
      </ol>
    </li>
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
