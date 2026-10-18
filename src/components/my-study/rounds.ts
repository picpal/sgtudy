/**
 * 회차(스프린트형 그릇) ↔ 과제(이슈) 순수 로직 — 현재 회차, 회차 선택지, 이동 기간, 형제 순서, 목록의 "+ 과제 추가" 줄.
 * React 와 무관. 서버 계약: node_move 의 index 는 "자기를 뺀 새 형제" 기준 위치다.
 */
import { addDays, diffDays, md } from "@/lib/date";
import { endPart, mmdd } from "@/lib/api/format";
import { maxEndDate } from "@/components/room-new/validate";
import { isPersonal, type ParentNode, type TreeNode } from "./model";

const live = (roots: ParentNode[]) => roots.filter((r) => !r.archived && !r.temp);

/** 오늘이 든 회차 → 다음 회차 → 마지막 회차 → 없으면 "all" (보드 기본 필터) */
export function currentRoundId(roots: ParentNode[], today: string): string {
  const rs = live(roots);
  if (rs.length === 0) return "all";
  return (rs.find((r) => r.s <= today && today <= r.e) ?? rs.find((r) => r.s > today) ?? rs[rs.length - 1]).id;
}

export type RoundOption = { id: string; text: string; s: string; e: string };

/** 과제 편집 화면의 "회차" 선택지 — 보관·임시 회차 제외 */
export const roundOptions = (roots: ParentNode[]): RoundOption[] =>
  live(roots).map((r) => ({ id: r.id, text: `${r.label ?? ""} · ${r.title} (${md(r.s)} – ${md(r.e)})`, s: r.s, e: r.e }));

/** 노드가 속한 회차 (묶음 안 과제도 회차로) */
export const roundOf = (nodes: TreeNode[], n: TreeNode): ParentNode | null => {
  const r = nodes.find((x) => x.id === n.roundId);
  return r && !r.leaf ? r : null;
};

/** 다른 회차로 옮길 때의 새 기간. null = 그대로 둔다 (제출 있음 · 이미 새 회차 안) */
export function movedPeriod(task: { s: string; e: string; subAll: number }, from: { s: string; e: string }, to: { s: string; e: string }): { s: string; e: string } | null {
  if (task.subAll > 0) return null;
  if (task.s >= to.s && task.e <= to.e) return null;
  const offset = Math.max(0, diffDays(from.s, task.s));
  const len = diffDays(task.s, task.e);
  let s = addDays(to.s, offset);
  if (s > to.e) s = to.e;
  let e = addDays(s, len);
  if (e > to.e) e = to.e;
  return { s, e };
}

export type DatePlan = { id: string; s: string; e: string }[];
type PlanNode = { id: string; s: string; e: string; subAll: number; leaf: boolean; archived: boolean; kids?: PlanNode[] };

/**
 * 다른 회차로 옮길 때 서브트리 전체의 새 기간 — 노드마다 movedPeriod 규칙(옛 회차 시작 기준 offset·새 회차로 클램프).
 * 묶음 자신은 제출이 없다(subAll 은 하위 합계) → 묶음은 늘 새 회차에 맞추고, 제출 있는 과제만 그대로 둔다.
 * 보관된 노드는 뺀다(node_update 가 거부). 바뀌는 노드만, 위에서 아래(전위) 순서.
 */
export function movedPlan(n: PlanNode, from: { s: string; e: string }, to: { s: string; e: string }): DatePlan {
  const out: DatePlan = [];
  const walk = (x: PlanNode) => {
    if (x.archived) return;
    const p = movedPeriod({ s: x.s, e: x.e, subAll: x.leaf ? x.subAll : 0 }, from, to);
    if (p) out.push({ id: x.id, ...p });
    if (!x.leaf) x.kids?.forEach(walk);
  };
  walk(n);
  return out;
}

export const siblingIndex = (parent: ParentNode, id: string): number => parent.kids.findIndex((k) => k.id === id);

/**
 * 위(-1)/아래(+1)로 한 칸 — node_move index. 이웃 = 서버 순서 kids 에서 dir 쪽 첫 "개인 아님" 형제(개인 목표는 화면에서 팀 뒤로 빠져 있어 건너뛴다).
 * 서버 계약 "자기를 뺀 새 형제 기준": 위로 = 이웃 자리 j(이웃이 앞이라 자기를 빼도 그대로), 아래로 = 자기를 빼면 이웃이 j-1 로 당겨지므로 그 바로 뒤 = j.
 * 없으면 null.
 */
export function reorderIndex(parent: ParentNode, id: string, dir: -1 | 1): number | null {
  const sibs = parent.kids;
  const i = siblingIndex(parent, id);
  if (i < 0) return null;
  let j = i + dir;
  while (j >= 0 && j < sibs.length && isPersonal(sibs[j])) j += dir;
  return j < 0 || j >= sibs.length ? null : j;
}

/** 편집 목록 행 메뉴(⋯) 한 항목 — node_move(parentId, index). index 없음 = 그 회차 끝. cross = 다른 회차로 가는 이동(기간 규칙 movedPlan) */
export type RowMove = { key: string; label: string; parentId: string; index?: number; cross: boolean };

/**
 * 편집 목록 행 메뉴 — 드래그 없이(390·키보드) 순서를 바꾸고 회차를 옮긴다 (Q2-4). 서버 계약은 dropPlan 과 같다:
 * 위로/아래로 = reorderIndex(개인 목표 건너뜀), 내어쓰기 = 묶음 안 과제를 회차 바로 아래·묶음 바로 다음으로(node_outdent 와 같은 자리),
 * 다른 회차로 = 보관·임시 아닌 다른 회차의 끝. 들여쓰기는 없다 — UI 는 회차 → 과제 2단계, 묶음을 새로 만들지 않는다(goal-subtasks 스펙 §2.2).
 * 회차·보관·임시·개인 행(편집 모드에 없는 전제)과 보관된 부모 아래는 빈 목록.
 */
export function rowMoves(nodes: TreeNode[], roots: ParentNode[], id: string): RowMove[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const n = byId.get(id);
  if (!n || n.d === 0 || n.archived || n.temp || isPersonal(n)) return [];
  const p = n.parentId ? byId.get(n.parentId) : undefined;
  if (!p || p.leaf || p.archived) return [];
  const out: RowMove[] = [];
  const up = reorderIndex(p, id, -1);
  const down = reorderIndex(p, id, 1);
  if (up !== null) out.push({ key: "up", label: "위로", parentId: p.id, index: up, cross: false });
  if (down !== null) out.push({ key: "down", label: "아래로", parentId: p.id, index: down, cross: false });
  const gp = p.d > 0 && p.parentId ? byId.get(p.parentId) : undefined;
  if (gp && !gp.leaf) out.push({ key: "outdent", label: "내어쓰기 · 회차 바로 아래로", parentId: gp.id, index: siblingIndex(gp, p.id) + 1, cross: false });
  for (const r of live(roots)) {
    if (r.id === n.roundId) continue;
    out.push({ key: `round:${r.id}`, label: r.label ? `${r.label}로 옮기기` : `‘${r.title}’ 회차로 옮기기`, parentId: r.id, cross: true });
  }
  return out;
}

export type ListEntry =
  | { kind: "node"; n: TreeNode }
  | { kind: "add"; round: ParentNode }
  | { kind: "padd"; round: ParentNode }
  /** 소제목 "팀원 개인 목표 {count}( · 보관 {archived})" — 그 회차에 보이는 남의 개인 목표 앞. count 는 보관 제외 */
  | { kind: "others"; round: ParentNode; count: number; archived: number }
  /** "내 것만" 에서 펼친 회차 아래 보이는 항목이 없을 때 안내 */
  | { kind: "empty"; round: ParentNode };

/** 편집 목록: 펼쳐진(보관 아닌) 회차마다 그 회차의 마지막 보이는 행 뒤에 "+ 과제 추가" 줄 */
export function withAddRows(rows: TreeNode[], roots: ParentNode[], closed: Record<string, boolean>): ListEntry[] {
  const open = new Map(roots.filter((r) => !r.archived && !closed[r.id]).map((r) => [r.id, r]));
  const out: ListEntry[] = [];
  rows.forEach((n, i) => {
    out.push({ kind: "node", n });
    const next = rows[i + 1];
    const round = open.get(n.roundId);
    if (round && (!next || next.roundId !== n.roundId)) out.push({ kind: "add", round });
  });
  return out;
}

/**
 * 보기 모드 목록 (시안 C-2): 회차 → 팀 과제 → 내 개인 목표 → "＋ 내 목표 추가"(canAdd·펼친 비보관 회차) → 소제목 "팀원 개인 목표 n" → 남의 개인 목표.
 * rows 는 visibleNodes 순서(각 회차에서 팀 → 내 것 → 남의 것)여야 한다. 개인 목표는 늘 회차의 직계 자식이다.
 */
export function withPersonalAddRows(rows: TreeNode[], roots: ParentNode[], closed: Record<string, boolean>, canAdd: boolean, meId: string | null = null): ListEntry[] {
  const byId = new Map(roots.map((r) => [r.id, r]));
  const addable = (id: string) => {
    const r = byId.get(id);
    return canAdd && !!r && !r.archived && !r.temp && !closed[r.id];
  };
  const isOther = (n: TreeNode) => isPersonal(n) && (meId === null || n.ownerId !== meId);
  const others = new Map<string, { count: number; archived: number }>();
  rows.forEach((n) => {
    if (!isOther(n)) return;
    const c = others.get(n.roundId) ?? { count: 0, archived: 0 };
    if (n.archived) c.archived += 1;
    else c.count += 1;
    others.set(n.roundId, c);
  });
  const out: ListEntry[] = [];
  let added = false;
  let header = false;
  rows.forEach((n, i) => {
    if (n.d === 0) {
      added = false;
      header = false;
    }
    const round = byId.get(n.roundId);
    if (round && isOther(n) && !header) {
      if (!added && addable(round.id)) out.push({ kind: "padd", round });
      added = true;
      out.push({ kind: "others", round, ...(others.get(round.id) ?? { count: 0, archived: 0 }) });
      header = true;
    }
    out.push({ kind: "node", n });
    const next = rows[i + 1];
    if (round && !added && addable(round.id) && (!next || next.roundId !== n.roundId)) {
      out.push({ kind: "padd", round });
      added = true;
    }
  });
  return out;
}

/** "내 것만": 펼친 회차 행 바로 다음이 그 회차의 노드가 아니면(= 보이는 항목 없음) 회차 행 뒤에 안내 줄 */
export function withEmptyRounds(entries: ListEntry[], closed: Record<string, boolean>): ListEntry[] {
  const out: ListEntry[] = [];
  entries.forEach((e, i) => {
    out.push(e);
    if (e.kind !== "node" || e.n.leaf || e.n.d !== 0 || closed[e.n.id]) return;
    const next = entries[i + 1];
    if (!next || next.kind !== "node" || next.n.roundId !== e.n.id) out.push({ kind: "empty", round: e.n });
  });
  return out;
}

/** 빠른 추가 제목 — 앞뒤 공백 제거, 비면 null, 80자까지 (서버 INVALID_TITLE 와 같은 한도) */
export const normalizeTitle = (raw: string): string | null => {
  const t = raw.trim();
  return t ? t.slice(0, 80) : null;
};

/** 빠른 추가 Enter — 한글 조합을 확정하는 Enter(isComposing, Safari keyCode 229)는 제출이 아니다 */
export const shouldSubmitQuickAdd = (e: { key: string; isComposing: boolean; keyCode?: number }): boolean =>
  e.key === "Enter" && !e.isComposing && e.keyCode !== 229;

/** 과제 편집 화면 — 회차 선택으로 옮긴 뒤 안내(기간이 바뀌었는지) */
export function moveNote(task: { s: string; e: string; subAll: number }, period: { s: string; e: string } | null, sameRound: boolean): string {
  if (sameRound) return "";
  if (period) return `기간이 ${md(period.s)} – ${md(period.e)} 로 바뀌었어요`;
  return task.subAll > 0 ? "제출이 있어 기간은 그대로예요" : "기간은 그대로예요";
}

/**
 * 드래그로 놓은 자리 → node_move(parent, index). 회차 행 위 = 그 회차 끝, 과제·묶음 행 위 = 그 형제 사이(top 앞 / bottom 뒤).
 * 회차는 끌 수 없고, 자기·자기 하위·보관 대상 위에는 놓을 수 없다. 제자리면 null.
 */
export function dropPlan(nodes: TreeNode[], dragId: string, overId: string, half: "top" | "bottom"): { parentId: string; index: number } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const drag = byId.get(dragId);
  const over = byId.get(overId);
  if (!drag || !over || drag.d === 0 || drag.archived || over.archived || drag.temp || over.temp) return null;
  // 개인 목표 행은 끌 수도, 놓을 자리도 아니다(편집 모드에 없고, 서버 node_move 도 팀 구조 전용)
  if (isPersonal(drag) || isPersonal(over)) return null;
  for (let p: TreeNode | undefined = over; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (p.id === drag.id) return null;
  let parent: ParentNode;
  let index: number;
  if (!over.leaf && over.d === 0) {
    parent = over;
    index = over.kids.filter((k) => k.id !== drag.id).length;
  } else {
    const p = over.parentId ? byId.get(over.parentId) : undefined;
    if (!p || p.leaf || p.archived) return null;
    parent = p;
    const sibs = p.kids.filter((k) => k.id !== drag.id);
    index = sibs.findIndex((k) => k.id === over.id) + (half === "bottom" ? 1 : 0);
  }
  if (drag.parentId === parent.id) {
    if (siblingIndex(parent, drag.id) === index) return null;
    // 화면 순서는 팀 → 개인이라, 개인 목표를 뺀 팀 순서가 그대로면 보이는 변화가 없다 — node_move 를 보내지 않는다
    const team = (ks: TreeNode[]) => ks.filter((k) => !isPersonal(k)).map((k) => k.id).join(",");
    const rest = parent.kids.filter((k) => k.id !== drag.id);
    if (team([...rest.slice(0, index), drag, ...rest.slice(index)]) === team(parent.kids)) return null;
  }
  return { parentId: parent.id, index };
}

/** before: 시작일 앞에 걸친 일정이 있다 — 종료일 늘리기로는 못 맞추고 회차·과제 기간을 고쳐야 한다 */
export type PeriodGap = { count: number; text: string; fitEnd: string | null; before: boolean };
type PeriodNode = { parentId: string | null; startDate: string; endDate: string; archived: boolean };

/**
 * 방 기간을 벗어난 일정 — 서버 PERIOD_OUTSIDE_ROOM 과 같은 판정(보관 제외 모든 노드: 시작일 앞 또는 종료일 뒤로 걸치면).
 * 서버는 이 경고를 수정 응답(node_update·room_update)에만 실어서, 진행목표·개요는 서버가 준 노드(Curriculum.nodes —
 * 화면 필터·미저장 수정과 무관)로 여기서 본다. 회차(parentId 없음)와 과제를 나눠 센다. 없으면 null.
 * fitEnd: 종료일 뒤로 넘친 게 있고, 보관 제외 전체 노드의 마지막 마감(진행중 room_update 규칙: 마지막 과제 마감 이후)이
 * 1년 상한 안이면 그 날짜 — 아니면 null(회차 편집으로만)
 */
export function roundsOutsidePeriod(nodes: PeriodNode[], period: { start: string; end: string }): PeriodGap | null {
  const live = nodes.filter((n) => !n.archived);
  const out = live.filter((n) => n.startDate < period.start || n.endDate > period.end);
  if (out.length === 0) return null;
  const rounds = out.filter((n) => n.parentId === null).length;
  const tasks = out.length - rounds;
  const what = [rounds ? `회차 ${rounds}개` : "", tasks ? `과제 ${tasks}개` : ""].filter(Boolean).join("·");
  const text = `${what}가 스터디 기간(${mmdd(period.start)} – ${endPart(period.start, period.end)})을 벗어나요`;
  const lastEnd = live.reduce((m, n) => (n.endDate > m ? n.endDate : m), period.end);
  const fitEnd = lastEnd > period.end && lastEnd <= maxEndDate(period.start) ? lastEnd : null;
  return { count: out.length, text, fitEnd, before: out.some((n) => n.startDate < period.start) };
}

/**
 * 시작 전(준비·모집) 지정 과제 안내 — 아직 담당으로 고를 참가자가 없거나 적다 (시나리오 QA #12).
 * 공통 과제는 서버가 들어오는 참가자에게 자동 배정한다.
 */
export const designatedHint = (status: "draft" | "recruit" | "active" | "ended"): string | null =>
  status === "draft" || status === "recruit" ? "시작 전이라 참가자가 아직 다 모이지 않았어요 · 지정 과제의 담당은 참가자가 들어온 뒤 정해 주세요 · 공통 과제는 들어오는 사람에게 자동으로 배정돼요" : null;
