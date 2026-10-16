/** 내 과제(/tasks) 순수 로직 — 필터 파싱, 거르기, 회차/마감일 묶기, 요약. React·네트워크와 무관. */
import { addDays, parseISO } from "@/lib/date";
import type { MeTaskItem, MeTaskRound, MeTaskStudy, MeTasks } from "@/lib/api/types";
import type { TaskStatus } from "@/lib/types";
import { CODE_LABEL, STATUS_CODE } from "@/components/my-study/model";

export type TasksFilter = {
  scope: "current" | "all";
  group: "round" | "due";
  type: "all" | "team" | "personal";
  hideDone: boolean;
  study: string | "all";
};

export const DEFAULT_FILTER: TasksFilter = { scope: "current", group: "round", type: "all", hideDone: false, study: "all" };

export function parseFilter(sp: URLSearchParams): TasksFilter {
  const scope = sp.get("scope");
  const group = sp.get("group");
  const type = sp.get("type");
  return {
    scope: scope === "all" ? "all" : "current",
    group: group === "due" ? "due" : "round",
    type: type === "team" || type === "personal" ? type : "all",
    hideDone: sp.get("done") === "hide",
    study: sp.get("study") || "all",
  };
}

/** 기본값과 같은 키는 뺀다 (routes.tasks 인자) */
export function filterQuery(f: TasksFilter): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.scope !== DEFAULT_FILTER.scope) q.scope = f.scope;
  if (f.group !== DEFAULT_FILTER.group) q.group = f.group;
  if (f.type !== DEFAULT_FILTER.type) q.type = f.type;
  if (f.hideDone) q.done = "hide";
  if (f.study !== "all") q.study = f.study;
  return q;
}

export const isDone = (st: TaskStatus) => st === "done" || st === "late";

const isLive = (s: MeTaskStudy) => s.status === "recruit" || s.status === "active";

/** m.studies 에 없는 slug 는 "all" 로 취급 */
const effStudy = (m: MeTasks, f: TasksFilter): string => (m.studies.some((s) => s.slug === f.study) ? f.study : "all");

export function applyFilter(m: MeTasks, f: TasksFilter): MeTaskItem[] {
  const studies = new Map(m.studies.map((s) => [s.slug, s]));
  const only = effStudy(m, f);
  return m.items.filter((it) => {
    const s = studies.get(it.slug);
    if (!s) return false;
    if (only !== "all" && it.slug !== only) return false;
    if (f.scope === "current" && !(it.roundId === s.currentRoundId && isLive(s))) return false;
    if (f.type === "team" && it.type === "personal") return false;
    if (f.type === "personal" && it.type !== "personal") return false;
    if (f.hideDone && isDone(it.st)) return false;
    return true;
  });
}

/** 미완료 먼저 → 마감 빠른 순 → 팀 과제 먼저 → 제목(ko) */
const cmpItem = (a: MeTaskItem, b: MeTaskItem) =>
  Number(isDone(a.st)) - Number(isDone(b.st)) ||
  a.endDate.localeCompare(b.endDate) ||
  Number(a.type === "personal") - Number(b.type === "personal") ||
  a.title.localeCompare(b.title, "ko");

export type RoundGroup = { study: MeTaskStudy; round: MeTaskRound | null; items: MeTaskItem[]; done: number; canAdd: boolean };

export function groupByRound(m: MeTasks, items: MeTaskItem[], f: TasksFilter): RoundGroup[] {
  const out: RoundGroup[] = [];
  const studies = m.studies; // 서버가 방 id 순으로 준다(me_tasks order by r.id)
  const only = effStudy(m, f);
  for (const study of studies) {
    if (only !== "all" && study.slug !== only) continue;
    const mine = items.filter((it) => it.slug === study.slug);
    const rounds = m.rounds.filter((r) => r.slug === study.slug); // 서버 순서(r.id, sort_order, id) 유지
    const known = new Set(rounds.map((r) => r.id));
    const make = (round: MeTaskRound | null, its: MeTaskItem[]): RoundGroup => {
      const personal = round ? m.items.filter((it) => it.roundId === round.id && it.type === "personal").length : 0;
      return {
        study,
        round,
        items: [...its].sort(cmpItem),
        done: its.filter((it) => isDone(it.st)).length,
        canAdd: !!round && round.canAdd && study.canAddPersonal && personal < m.personalPerRound,
      };
    };
    for (const round of rounds) {
      const its = mine.filter((it) => it.roundId === round.id);
      const emptyCurrent = f.scope === "current" && f.type !== "team" && isLive(study) && round.id === study.currentRoundId;
      if (its.length || emptyCurrent) out.push(make(round, its));
    }
    const orphan = mine.filter((it) => !known.has(it.roundId));
    if (orphan.length) out.push(make(null, orphan));
  }
  return out;
}

export type DueSection = "overdue" | "today" | "week" | "next" | "later" | "done";
const DUE_ORDER: [DueSection, string][] = [
  ["overdue", "지난 마감"],
  ["today", "오늘"],
  ["week", "이번 주"],
  ["next", "다음 주"],
  ["later", "나중"],
  ["done", "완료"],
];

/** 일~토 주 (내 일정 calc 와 같은 경계) */
export function groupByDue(items: MeTaskItem[], today: string): { key: DueSection; label: string; items: MeTaskItem[] }[] {
  const weekEnd = addDays(today, 6 - new Date(parseISO(today)).getUTCDay());
  const nextEnd = addDays(weekEnd, 7);
  const sectionOf = (it: MeTaskItem): DueSection => {
    if (isDone(it.st)) return "done";
    if (it.endDate < today) return "overdue";
    if (it.endDate === today) return "today";
    if (it.endDate <= weekEnd) return "week";
    if (it.endDate <= nextEnd) return "next";
    return "later";
  };
  const buckets = new Map<DueSection, MeTaskItem[]>();
  for (const it of items) {
    const k = sectionOf(it);
    buckets.set(k, [...(buckets.get(k) ?? []), it]);
  }
  return DUE_ORDER.filter(([k]) => buckets.has(k)).map(([key, label]) => ({ key, label, items: buckets.get(key)!.sort(cmpItem) }));
}

export function summary(m: MeTasks, items: MeTaskItem[]): { left: number; dueToday: number; personalDone: number; personalTotal: number } {
  const live = new Map(m.studies.filter(isLive).map((s) => [s.slug, s.currentRoundId]));
  const open = items.filter((it) => !isDone(it.st) && live.has(it.slug));
  const cur = m.items.filter((it) => it.type === "personal" && live.get(it.slug) === it.roundId);
  return {
    left: open.length,
    dueToday: open.filter((it) => it.endDate === m.today).length,
    personalDone: cur.filter((it) => isDone(it.st)).length,
    personalTotal: cur.length,
  };
}

/** 개인 목표는 done/late 를 "제출" 대신 "완료"로 */
export const statusText = (it: MeTaskItem): string => {
  if (it.type === "personal") {
    if (it.st === "done") return "기한내 완료";
    if (it.st === "late") return "늦게 완료";
  }
  return CODE_LABEL[STATUS_CODE[it.st]];
};
