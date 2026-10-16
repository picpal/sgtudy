"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { fetchMyTasks, personalComplete, personalCreate } from "@/lib/api/personal";
import { STUDY_TONE } from "@/lib/api/schedule";
import type { MeTaskItem, MeTasks } from "@/lib/api/types";
import { md, weekdayKo } from "@/lib/date";
import { routes } from "@/lib/routes";
import { AddPersonalForm } from "./AddPersonalForm";
import { applyFilter, DEFAULT_FILTER, filterQuery, groupByDue, groupByRound, isDone, parseFilter, summary, type RoundGroup, type TasksFilter } from "./calc";
import { RoundGroupCard } from "./RoundGroupCard";
import { TaskRow } from "./TaskRow";
import { TasksEmpty } from "./TasksEmpty";
import { TasksToolbar } from "./TasksToolbar";

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
  const filter = parseFilter(new URLSearchParams(sp.toString()));
  // 같은 화면 안에서 쿼리만 바꾼다 — 서버 왕복(RSC) 없이 useSearchParams 와 동기화된다(Next 문서: Native History API).
  // replace: 필터 조작은 방문 기록을 쌓지 않는다. 상세로 갔다가 뒤로 오면 이 주소(필터)로 돌아온다
  const setFilter = (f: TasksFilter) => window.history.replaceState(null, "", routes.tasks(filterQuery(f)));

  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<ToastMsg>(null);
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
  const addable = data.studies.some((s) => s.canAddPersonal && data.rounds.some((r) => r.slug === s.slug && r.canAdd));

  const refresh = async () => setData(await fetchMyTasks());

  const setComplete = async (it: MeTaskItem, done: boolean, undoable: boolean) => {
    setBusyIds((b) => new Set(b).add(it.id));
    setLoading(true);
    try {
      await personalComplete(it.slug, it.id, done);
      await refresh();
      setToast(
        done
          ? { text: "완료했어요", tone: "ok", action: undoable ? { label: "되돌리기", onClick: () => void setComplete(it, false, false) } : undefined }
          : { text: "완료를 취소했어요", tone: "ok" },
      );
    } catch (e) {
      setToast({ text: toApiError(e).message, tone: "bad" });
    } finally {
      setBusyIds((b) => {
        const n = new Set(b);
        n.delete(it.id);
        return n;
      });
      setLoading(false);
    }
  };
  const toggleDone = (it: MeTaskItem) => void setComplete(it, !isDone(it.st), true);

  const add = async (slug: string, roundId: string, title: string): Promise<boolean> => {
    setLoading(true);
    try {
      await personalCreate(slug, roundId, title);
      await refresh();
      setToast({ text: "내 목표를 추가했어요", tone: "ok" });
      return true;
    } catch (e) {
      setToast({ text: toApiError(e).message, tone: "bad" });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const noStudy = data.studies.length === 0;
  const unfiltered = filter.type === "all" && !filter.hideDone && filter.study === "all";
  const pieces = [
    sum.left > 0 && <Fragment key="l">남은 과제 {sum.left}개</Fragment>,
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
    if (noStudy) return <TasksEmpty kind="noStudy" />;
    if (items.length === 0)
      return unfiltered ? (
        <TasksEmpty kind="noTasks" onAdd={addable && !formOpen ? () => setFormOpen(true) : undefined} />
      ) : (
        <TasksEmpty kind="filtered" onClear={() => setFilter({ ...DEFAULT_FILTER, scope: filter.scope, group: filter.group })} />
      );
    if (filter.group === "due") {
      return (
        <div className="overflow-hidden rounded-[16px] border border-line">
          {groupByDue(items, today).map((sec) => (
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
      const tone = STUDY_TONE[study.tone] ?? STUDY_TONE.mint;
      return (
        <section key={study.slug} aria-label={study.title} className="flex flex-col gap-2">
          <h2 className="m-0 flex items-center gap-2 px-1 text-[15px] font-bold">
            <span aria-hidden="true" className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: tone.dot }} />
            <span className="min-w-0">{study.title}</span>
            <Link href={routes.myStudy(study.slug)} className="ml-auto inline-flex min-h-11 shrink-0 items-center px-2 text-[13px] font-semibold text-mint">
              진행목표 ›
            </Link>
          </h2>
          {gs.map((g) => {
            const k = groupKey(g);
            const past = filter.scope === "all" && !!g.round && g.round.endDate < today;
            const collapsed = past !== flipped.has(k);
            return (
              <RoundGroupCard
                key={k}
                group={g}
                today={today}
                perRound={data.personalPerRound}
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
    <div className="box-border flex min-h-screen flex-col p-4">
      <AppHeader active="tasks" variant="card" bell={<NotificationBell />} />
      <main aria-busy={loading} className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 rounded-[20px] bg-surface px-7 pb-[30px] pt-[26px] max-sm:px-2 max-sm:pb-7 max-sm:pt-5">
        <div className="flex items-start gap-3 max-sm:px-2">
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[26px] font-bold tracking-[-0.02em] max-sm:text-[22px]">내 과제</h1>
            {pieces.length > 0 && (
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
          {!noStudy && addable && (
            <button
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
        {formOpen && (
          <AddPersonalForm
            data={data}
            defaultSlug={filter.study === "all" ? undefined : filter.study}
            onClose={() => setFormOpen(false)}
            onAdd={async (slug, roundId, title) => {
              const ok = await add(slug, roundId, title);
              if (ok) setFormOpen(false);
              return ok;
            }}
          />
        )}
        {!noStudy && <TasksToolbar filter={filter} studies={data.studies} onChange={setFilter} />}
        {renderBody()}
      </main>
      <Toast msg={toast} onClose={closeToast} />
    </div>
  );
}
