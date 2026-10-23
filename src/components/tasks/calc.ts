/** 내 과제(/tasks) 순수 로직 — 필터 파싱, 거르기, 회차/마감일 묶기, 요약. React·네트워크와 무관. */
import { addDays, parseISO } from "@/lib/date";
import type { MeTaskItem, MeTaskRound, MeTaskStudy, MeTasks } from "@/lib/api/types";
import type { TaskStatus } from "@/lib/types";
import { STATUS_CODE, codeLabel, isDoneCode } from "@/components/my-study/model";

export type TasksFilter = {
  scope: "current" | "all";
  group: "round" | "due";
  type: "all" | "team" | "personal";
  hideDone: boolean;
  study: string | "all";
  /** 「과제 · 오답노트」 보기 전환(오답노트 스펙 D17) — notes 면 기간·묶기·유형·완료 숨기기는 뜻이 없어 툴바에서 빠진다 */
  view: "tasks" | "notes";
};

export const DEFAULT_FILTER: TasksFilter = { scope: "current", group: "round", type: "all", hideDone: false, study: "all", view: "tasks" };

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
    view: sp.get("view") === "notes" ? "notes" : "tasks",
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
  if (f.view !== DEFAULT_FILTER.view) q.view = f.view;
  return q;
}

export const isDone = (st: TaskStatus): boolean => isDoneCode(STATUS_CODE[st]);

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

/** ord 없는 옛 서버(0042 전) 정렬: 미완료 먼저 → 마감 빠른 순 → 팀 과제 먼저 → 제목(ko) */
const cmpItem = (a: MeTaskItem, b: MeTaskItem) =>
  Number(isDone(a.st)) - Number(isDone(b.st)) ||
  a.endDate.localeCompare(b.endDate) ||
  Number(a.type === "personal") - Number(b.type === "personal") ||
  a.title.localeCompare(b.title, "ko");

const cmpOrd = (x: [number, number][], y: [number, number][]): number => {
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i][0] - y[i][0] || x[i][1] - y[i][1];
    if (d) return d;
  }
  return x.length - y.length;
};

/** 진행목표 순서(model.visibleNodes 와 같은 기준): 팀 과제 먼저(개인 목표는 회차 끝) → 트리 깊이 우선(형제 sort_order → id). 같은 회차 안에서만 뜻이 있다 */
export const curriculumCmp = (a: MeTaskItem, b: MeTaskItem): number =>
  Number(a.type === "personal") - Number(b.type === "personal") || cmpOrd(a.ord ?? [], b.ord ?? []);

/** 서버가 ord 를 주면(0042~) 진행목표 순서, 아니면 옛 정렬 */
const hasOrd = (its: MeTaskItem[]) => its.every((it) => Array.isArray(it.ord));

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
        items: [...its].sort(hasOrd(its) ? curriculumCmp : cmpItem),
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

/** 일~토 주 (내 일정 calc 와 같은 경계). 구간 안 = 마감일 → 스터디·회차 순서(m) → 진행목표 순서 */
export function groupByDue(m: MeTasks, items: MeTaskItem[], today: string): { key: DueSection; label: string; items: MeTaskItem[] }[] {
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
  const studyAt = new Map(m.studies.map((s, i) => [s.slug, i]));
  const roundAt = new Map(m.rounds.map((r, i) => [r.id, i]));
  const at = (map: Map<string, number>, k: string) => map.get(k) ?? map.size;
  const cmp = (a: MeTaskItem, b: MeTaskItem) =>
    a.endDate.localeCompare(b.endDate) || at(studyAt, a.slug) - at(studyAt, b.slug) || at(roundAt, a.roundId) - at(roundAt, b.roundId) || curriculumCmp(a, b);
  const sorter = hasOrd(items) ? cmp : cmpItem;
  return DUE_ORDER.filter(([k]) => buckets.has(k)).map(([key, label]) => ({ key, label, items: buckets.get(key)!.sort(sorter) }));
}

export function summary(m: MeTasks, items: MeTaskItem[]): { left: number; dueToday: number; personalDone: number; personalTotal: number } {
  const live = new Map(m.studies.filter(isLive).map((s) => [s.slug, s.currentRoundId]));
  const open = items.filter((it) => !isDone(it.st) && live.has(it.slug));
  const cur = m.items.filter((it) => it.type === "personal" && live.get(it.slug) === it.roundId);
  return {
    // 팀 과제만 — 개인 목표는 personalDone/personalTotal 로 따로 보인다 (시나리오 QA #16)
    left: open.filter((it) => it.type !== "personal").length,
    dueToday: open.filter((it) => it.endDate === m.today).length,
    personalDone: cur.filter((it) => isDone(it.st)).length,
    personalTotal: cur.length,
  };
}

/** 상태 문구 — model.codeLabel 단일 출처 (개인: 기한내 완료 · 늦게 완료 · 기한 지남) */
export const statusText = (it: MeTaskItem): string => codeLabel({ personal: it.type === "personal" }, STATUS_CODE[it.st]);

/* ---------- 화면 판단 (컴포넌트는 호출만) ---------- */

/** 모르는 study slug(떠난 방 북마크 등)는 "all" 로 바꾼 필터 — 화면·툴바·빈 상태·URL 이 이 값을 쓴다 */
export const normalizeFilter = (m: MeTasks, f: TasksFilter): TasksFilter => {
  const study = effStudy(m, f);
  return study === f.study ? f : { ...f, study };
};

/** 회차의 내 개인 목표 수(필터 무관 — 실제 한도 기준) */
export const personalCount = (m: MeTasks, roundId: string): number => m.items.filter((it) => it.roundId === roundId && it.type === "personal").length;

/** 지금 내 목표를 더할 수 있는 회차(서버 canAdd + 방 허용 + 한도 미만), 서버 순서 */
export function addableRounds(m: MeTasks, slug: string): MeTaskRound[] {
  const s = m.studies.find((x) => x.slug === slug);
  if (!s?.canAddPersonal) return [];
  return m.rounds.filter((r) => r.slug === slug && r.canAdd && personalCount(m, r.id) < m.personalPerRound);
}

export const addableStudies = (m: MeTasks): MeTaskStudy[] => m.studies.filter((s) => addableRounds(m, s.slug).length > 0);

export const DRAFT_ADD_NOTE = "모집을 시작하면 개인 목표를 추가할 수 있어요";

/** 그 방에 지금 내 목표를 못 더하는 이유 (null = 더할 수 있음) — 머리 폼이 고른 스터디 칩을 따를 때 (QA Q3-2) */
export function addBlockReason(m: MeTasks, slug: string): string | null {
  const s = m.studies.find((x) => x.slug === slug);
  if (!s) return null;
  if (addableRounds(m, slug).length > 0) return null;
  if (s.status === "draft") return DRAFT_ADD_NOTE;
  if (s.status === "ended") return "종료된 스터디에는 내 목표를 추가할 수 없어요";
  if (!s.canAddPersonal) return "지금은 이 스터디에 내 목표를 추가할 수 없어요"; // 종료 말고 다른 이유(보관·자격) — 틀린 이유를 대지 않는다
  if (!m.rounds.some((r) => r.slug === slug && r.canAdd)) return "아직 회차가 없어 내 목표를 추가할 수 없어요";
  return `모든 회차에 내 목표가 ${m.personalPerRound}개씩 있어 더 추가할 수 없어요`;
}

/** 스터디 묶음 머리 아래 안내 — 준비중(모집 전) 방에는 "＋ 내 목표 추가" 줄이 없는 이유를 한 번만 (QA Q3-2) */
export const studyNote = (s: MeTaskStudy): string | null => (s.status === "draft" ? DRAFT_ADD_NOTE : null);

/** 추가 폼 기본 회차 = 그 방 현재 회차(추가 가능할 때) → 아니면 첫 추가 가능 회차 → "" */
export function defaultRound(m: MeTasks, slug: string): string {
  const rs = addableRounds(m, slug);
  const cur = m.studies.find((s) => s.slug === slug)?.currentRoundId;
  return (rs.find((r) => r.id === cur) ?? rs[0])?.id ?? "";
}

/** 한도 안내 줄: 추가할 수 있는 방·회차인데 개수만 찼을 때 (종료·DRAFT 방·막힌 회차는 끝 줄 없음) */
export const atLimit = (m: MeTasks, g: RoundGroup): boolean =>
  !!g.round && g.round.canAdd && g.study.canAddPersonal && personalCount(m, g.round.id) >= m.personalPerRound;

/** "전체" 범위의 지난 회차는 접힌 채 시작 */
export const defaultCollapsed = (g: RoundGroup, f: TasksFilter, today: string): boolean => f.scope === "all" && !!g.round && g.round.endDate < today;

/** 빈 상태 종류 (스펙 §6). 결과가 있으면 null. 묶기·기간은 "필터"로 치지 않는다 */
export function emptyKind(m: MeTasks, f: TasksFilter, items: MeTaskItem[]): "noStudy" | "noTasks" | "filtered" | null {
  if (m.studies.length === 0) return "noStudy";
  if (items.length > 0) return null;
  const n = normalizeFilter(m, f);
  return n.type === "all" && !n.hideDone && n.study === "all" ? "noTasks" : "filtered";
}

export type RowTone = "done" | "late" | "missed" | "hot" | "plain";
/** 행 상태 톤 + D-day 강조(마감일이 오늘이거나 지났는데 미완료) */
export function rowState(it: MeTaskItem, today: string): { tone: RowTone; dueHot: boolean } {
  const done = isDone(it.st);
  const tone: RowTone = it.st === "done" || it.st === "late" || it.st === "missed" ? it.st : it.st === "open" && it.endDate === today ? "hot" : "plain";
  return { tone, dueHot: !done && it.endDate <= today };
}

/** 개인 목표 완료 체크 버튼: 진행 중 = 누름, 시작 전(모집·초안) = 비활성 + 안내, 종료 = 숨김(읽기 전용, 시안 E-4) */
export const checkMode = (s: MeTaskStudy): "enabled" | "disabled" | "hidden" =>
  s.status === "active" ? "enabled" : s.status === "ended" ? "hidden" : "disabled";
