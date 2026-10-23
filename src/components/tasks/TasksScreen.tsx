"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { PageBody } from "@/components/ui/PageBody";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { fetchMyTasks, personalComplete, personalCreate } from "@/lib/api/personal";
import { fetchWrongNoteMine } from "@/lib/api/wrongNote";
import { bumpProgress, progressChangedSince, progressScope } from "@/lib/progressStale";
import type { MeTaskItem, MeTasks } from "@/lib/api/types";
import { md, weekdayKo } from "@/lib/date";
import { routes } from "@/lib/routes";
import { markTaskOrigin } from "@/lib/taskOrigin";
import { AddPersonalForm } from "./AddPersonalForm";
import { focusFirst, latestApplied } from "./requests";
import { personalErrorText } from "@/components/my-study/personal";
import { useNoteRound } from "@/components/my-study/useNoteRound";
import { useWrongNote } from "@/components/my-study/useWrongNote";
import { toNoteStudiesMine } from "@/components/my-study/wrongNote";
import { addableStudies, applyFilter, studyNote, atLimit, DEFAULT_FILTER, defaultCollapsed, emptyKind, filterQuery, groupByDue, groupByRound, isDone, normalizeFilter, parseFilter, summary, type RoundGroup, type TasksFilter } from "./calc";
import { RoundGroupCard } from "./RoundGroupCard";
import { TaskRow } from "./TaskRow";
import { TasksEmpty } from "./TasksEmpty";
import { TasksNotesView } from "./TasksNotesView";
import { TasksToolbar, type ToolbarStudy } from "./TasksToolbar";
import { studyTone } from "./tone";

const groupKey = (g: RoundGroup) => `${g.study.slug}:${g.round?.id ?? "-"}`;

/** 연속한 같은 스터디 묶음끼리 모은다 (groupByRound 는 스터디 순 → 회차 순) */
function byStudy(groups: RoundGroup[]): RoundGroup[][] {
  const out: RoundGroup[][] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (last && last[0].study.slug === g.study.slug) last.push(g);
    else out.push([g]);
  }
  return out;
}

/** 내 과제 /tasks — 여러 스터디의 내 팀 과제 + 개인 목표. 필터는 URL 쿼리(뒤로 가기·새로고침 유지), 데이터는 서버 초기값 → 변경 뒤 재조회 */
export function TasksScreen({ initial }: { initial: MeTasks }) {
  const [data, setData] = useState(initial);
  const sp = useSearchParams();
  const raw = parseFilter(new URLSearchParams(sp.toString()));
  const notesView = raw.view === "notes";
  const [toast, setToast] = useState<ToastMsg>(null);
  // 오답노트 보기(D17~D21) — 처음 그 보기가 될 때 받고, 과제 보기로 갔다 와도 유지(훅을 화면이 든다)
  const notes = useWrongNote(() => fetchWrongNoteMine().then(toNoteStudiesMine), [], { toast: setToast, enabled: notesView });
  // 오답노트 회차 상세(?round=, D23) — 과제 보기에서는 뜻이 없다
  const noteRound = useNoteRound(notesView);
  // 오답노트 보기의 스터디 칩은 오답 응답 기준 — me_tasks 에 없는 이탈(INACTIVE) 방도 오답 섹션이 있으니 칩도 있어야 한다.
  // 받기 전에는 과제 칩을 잠시 보이고, study 정리도 받은 뒤에 한다(이탈 방 slug 가 "전체"로 지워지지 않게)
  const noteStudies: ToolbarStudy[] | null = notes.studies?.map((s) => ({ slug: s.slug, title: s.title ?? s.slug, tone: s.tone ?? "mint" })) ?? null;
  // 모르는 study(떠난 방 북마크·알림 링크)는 "전체"로 — 화면·툴바·빈 상태·URL 모두 이 값을 쓴다
  const filter = !notesView
    ? normalizeFilter(data, raw)
    : !noteStudies || raw.study === "all" || noteStudies.some((s) => s.slug === raw.study)
      ? raw
      : { ...raw, study: "all" };
  // 같은 화면 안에서 쿼리만 바꾼다 — 서버 왕복(RSC) 없이 useSearchParams 와 동기화된다(Next 문서: Native History API).
  // replace: 필터 조작은 방문 기록을 쌓지 않는다. 상세로 갔다가 뒤로 오면 이 주소(필터)로 돌아온다
  const setFilter = (f: TasksFilter) => window.history.replaceState(null, "", routes.tasks(filterQuery(f)));

  // URL 에 남은 모르는 study 를 걷어 낸다 (replace — 기록은 쌓지 않는다)
  const stale = raw.study !== filter.study;
  const cleanQuery = routes.tasks({ ...filterQuery(filter), ...(noteRound.round ? { round: noteRound.round } : {}) });
  useEffect(() => {
    if (stale) window.history.replaceState(null, "", cleanQuery);
  }, [stale, cleanQuery]);

  // 처리 중인 항목 — 렌더용 state 와, 클로저(토스트 "되돌리기")가 최신 값을 보도록 ref 를 함께 둔다
  const busyRef = useRef<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const markBusy = (id: string, on: boolean) => {
    if (on) busyRef.current.add(id);
    else busyRef.current.delete(id);
    setBusyIds(new Set(busyRef.current));
  };
  // 진행 중인 요청 수 (여러 행을 동시에 눌러도 마지막 것이 끝날 때까지 aria-busy)
  const [pending, setPending] = useState(0);
  // 재조회 순번 — 늦게 도착한 이전 응답이 최신 목록을 덮지 않게, 늦게 보낸 요청이 실패해도 앞선 성공 응답은 반영
  const [seq] = useState(latestApplied);
  const headBtn = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [formOpen, setFormOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  // 기본 접힘(전체 범위의 지난 회차)에서 사용자가 뒤집은 묶음
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());

  const today = data.today;
  const items = applyFilter(data, filter);
  const sum = summary(data, items);
  const studyOf = new Map(data.studies.map((s) => [s.slug, s]));
  const roundOf = new Map(data.rounds.map((r) => [r.id, r]));
  const addable = addableStudies(data).length > 0;

  // 추가로 한도에 차 머리 버튼이 사라지면(addable true → false) 포커스가 body 에 남지 않게 제목으로
  const wasAddable = useRef(addable);
  useEffect(() => {
    if (wasAddable.current && !addable && (!document.activeElement || document.activeElement === document.body)) title.current?.focus();
    wasAddable.current = addable;
  }, [addable]);

  const refresh = async () => {
    const id = seq.next();
    const next = await fetchMyTasks();
    if (seq.accept(id)) setData(next);
  };
  // 브라우저 뒤로 가기로 되살아난 화면은 그때의 목록으로 시작한다 — 그 뒤 제출·완료가 있었으면 한 번 다시 받는다
  useEffect(() => {
    if (!progressChangedSince(progressScope.tasks)) return;
    notes.refetch(); // 제출 뒤 돌아왔다 — 새 오답도 보이게(오답노트 보기가 되면 받는다)
    const id = seq.next();
    fetchMyTasks().then((next) => {
      if (seq.accept(id)) setData(next);
    }, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 한 번
  }, []);
  // 폼을 닫으면 머리 버튼으로, 이미 없으면 제목으로 — 지금 DOM 기준으로 바로 옮긴다(rAF 는 창이 가려지면 멈춘다)
  const closeForm = () => {
    setFormOpen(false);
    focusFirst(headBtn.current, title.current);
  };

  const setComplete = async (it: MeTaskItem, done: boolean, undoable: boolean) => {
    if (busyRef.current.has(it.id)) return; // 같은 항목이 처리 중이면(행 버튼·되돌리기 겹침) 무시
    markBusy(it.id, true);
    setPending((n) => n + 1);
    try {
      try {
        await personalComplete(it.slug, it.id, done);
        bumpProgress();
      } catch (e) {
        setToast({ text: personalErrorText(toApiError(e)), tone: "bad" });
        return;
      }
      const text = done ? "완료했어요" : "완료를 취소했어요";
      try {
        await refresh();
      } catch {
        // 저장은 됐다 — 실패로 읽히지 않게 구분해서 알린다
        setToast({ text: `${text} · 목록을 새로고침하지 못했어요`, tone: "ok" });
        return;
      }
      setToast(done && undoable ? { text, tone: "ok", action: { label: "되돌리기", onClick: () => void setComplete(it, false, false) } } : { text, tone: "ok" });
    } finally {
      markBusy(it.id, false);
      setPending((n) => n - 1);
    }
  };
  const toggleDone = (it: MeTaskItem) => void setComplete(it, !isDone(it.st), true);

  const add = async (slug: string, roundId: string, title: string): Promise<boolean> => {
    setPending((n) => n + 1);
    try {
      try {
        await personalCreate(slug, roundId, title);
        bumpProgress();
      } catch (e) {
        setToast({ text: personalErrorText(toApiError(e)), tone: "bad" });
        return false;
      }
      try {
        await refresh();
        setToast({ text: "내 목표를 추가했어요", tone: "ok" });
      } catch {
        setToast({ text: "내 목표를 추가했어요 · 목록을 새로고침하지 못했어요", tone: "ok" });
      }
      return true;
    } finally {
      setPending((n) => n - 1);
    }
  };

  const empty = emptyKind(data, filter, items);
  // 오답노트 보기: 과제 스터디도 오답 스터디도 없을 때만(이탈한 방만 남아도 오답은 보이고, 툴바로 과제 보기에 돌아갈 수 있게)
  const noStudy = empty === "noStudy" && (!notesView || noteStudies?.length === 0);
  const pieces = [
    sum.left > 0 && <Fragment key="l">남은 팀 과제 {sum.left}개</Fragment>,
    sum.dueToday > 0 && (
      <strong key="t" className="font-semibold text-warn">
        오늘 마감 {sum.dueToday}개
      </strong>
    ),
    sum.personalTotal > 0 && (
      <Fragment key="p">
        이번 회차 개인 목표 {sum.personalDone}/{sum.personalTotal} 완료
      </Fragment>
    ),
  ].filter(Boolean);

  const renderBody = () => {
    if (empty === "noStudy") return <TasksEmpty kind="noStudy" />;
    if (empty)
      return empty === "noTasks" ? (
        <TasksEmpty kind="noTasks" onAdd={addable && !formOpen ? () => setFormOpen(true) : undefined} />
      ) : (
        <TasksEmpty kind="filtered" onClear={() => setFilter({ ...DEFAULT_FILTER, scope: filter.scope, group: filter.group })} />
      );
    if (filter.group === "due") {
      return (
        <div className="overflow-hidden rounded-[16px] border border-line">
          {groupByDue(data, items, today).map((sec) => (
            <section key={sec.key} aria-label={sec.label}>
              <h3 className="m-0 flex items-center gap-2 bg-surface-3 px-[18px] py-3 text-[13px] font-bold text-ink-2 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-line-2">
                {(sec.key === "overdue" || sec.key === "today") && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-warn" />}
                {sec.key === "today" ? `오늘 · ${md(today)}(${weekdayKo(today)})` : sec.label}
                <span className="font-semibold text-muted">{sec.items.length}</span>
              </h3>
              <ul className="m-0 list-none p-0">
                {sec.items.map((it) => {
                  const study = studyOf.get(it.slug);
                  if (!study) return null;
                  return <TaskRow key={it.id} item={it} study={study} round={roundOf.get(it.roundId) ?? null} today={today} withRoundChip busy={busyIds.has(it.id)} onToggle={toggleDone} />;
                })}
              </ul>
            </section>
          ))}
        </div>
      );
    }
    return byStudy(groupByRound(data, items, filter)).map((gs) => {
      const study = gs[0].study;
      const tone = studyTone(study.tone);
      return (
        <section key={study.slug} aria-label={study.title} className="flex flex-col gap-2">
          <h2 className="m-0 flex items-center gap-2 px-1 text-[15px] font-bold">
            <span aria-hidden="true" className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: tone.dot }} />
            <span className="min-w-0">{study.title}</span>
            <Link href={routes.myStudy(study.slug)} className="ml-auto inline-flex min-h-11 shrink-0 items-center px-2 text-[13px] font-semibold text-mint">
              진행목표 ›
            </Link>
          </h2>
          {studyNote(study) && <p className="m-0 rounded-[12px] bg-slate-soft px-[14px] py-[10px] text-[13px] text-ink-2">{studyNote(study)}</p>}
          {gs.map((g) => {
            const k = groupKey(g);
            const collapsed = defaultCollapsed(g, filter, today) !== flipped.has(k);
            return (
              <RoundGroupCard
                key={k}
                group={g}
                today={today}
                perRound={data.personalPerRound}
                limited={atLimit(data, g)}
                collapsed={collapsed}
                onToggleCollapsed={() =>
                  setFlipped((f) => {
                    const n = new Set(f);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
                busyIds={busyIds}
                onToggleDone={toggleDone}
                adding={adding === k}
                onOpenAdd={() => setAdding(k)}
                onCloseAdd={() => setAdding((a) => (a === k ? null : a))}
                onAdd={(t) => (g.round ? add(g.study.slug, g.round.id, t) : Promise.resolve(false))}
              />
            );
          })}
        </section>
      );
    });
  };

  return (
    // 과제 링크를 누르면 출발지를 기억한다 — 상세의 [← 내 과제] 가 이 화면으로 돌아온다
    <div className="flex min-h-screen flex-col" onClickCapture={(e) => markTaskOrigin("tasks", e)}>
      <AppHeader active="tasks" bell={<NotificationBell />} />
      <PageBody>
        <main aria-busy={pending > 0} className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 rounded-[20px] bg-surface px-7 pb-[30px] pt-[26px] max-sm:px-2 max-sm:pb-7 max-sm:pt-5">
          <div className="flex items-start gap-3 max-sm:px-2">
            <div className="min-w-0 flex-1">
              <h1 ref={title} tabIndex={-1} className="m-0 text-[26px] font-bold focus:outline-none tracking-[-0.02em] max-sm:text-[22px]">내 과제</h1>
              {!notesView && pieces.length > 0 && (
                <p className="m-0 mt-[6px] text-[14px] text-muted max-sm:text-[13px]">
                  {pieces.map((p, i) => (
                    <Fragment key={i}>
                      {i > 0 && " · "}
                      {p}
                    </Fragment>
                  ))}
                </p>
              )}
            </div>
            {!notesView && !noStudy && addable && (
              <button
                ref={headBtn}
                type="button"
                aria-expanded={formOpen}
                onClick={() => setFormOpen((o) => !o)}
                className="h-11 shrink-0 rounded-[12px] bg-navy px-[18px] text-[14px] font-semibold text-white max-sm:px-[14px]"
              >
                {formOpen ? (
                  "닫기"
                ) : (
                  <>
                    <span className="max-sm:hidden">＋ 내 목표 추가</span>
                    <span className="sm:hidden">＋ 목표</span>
                  </>
                )}
              </button>
            )}
          </div>
          {!notesView && formOpen && (
            <AddPersonalForm
              key={filter.study}
              data={data}
              chosenSlug={filter.study === "all" ? undefined : filter.study}
              onClose={closeForm}
              onAdd={async (slug, roundId, title) => {
                const ok = await add(slug, roundId, title);
                if (ok) closeForm();
                return ok;
              }}
            />
          )}
          {!noStudy && <TasksToolbar filter={filter} studies={notesView ? (noteStudies ?? data.studies) : data.studies} onChange={setFilter} />}
          {notesView ? (
            <TasksNotesView
              notes={notes}
              study={filter.study}
              round={noteRound.round}
              onOpenRound={noteRound.open}
              onBack={noteRound.back}
              periods={Object.fromEntries(data.rounds.map((r) => [r.id, { startDate: r.startDate, endDate: r.endDate }]))}
            />
          ) : (
            renderBody()
          )}
        </main>
        <Toast msg={toast} onClose={closeToast} />
      </PageBody>
    </div>
  );
}
