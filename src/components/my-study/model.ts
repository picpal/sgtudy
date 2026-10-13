/**
 * 내 스터디 화면의 순수 로직 — Curriculum DTO(전위 순서 NodeDto[]) → 트리, 편집 오버라이드, 상태 판정, 집계, 캘린더/간트 배치.
 * React 와 무관하게 입력 → 출력만 한다. "오늘"과 "나"는 인자로 받는다.
 */
import { addDays, dday, diffDays, md, parseISO } from "@/lib/date";
import { TASK_TYPE_KO } from "@/lib/api/format";
import type { Curriculum, NodeDto } from "@/lib/api/types";
import type { Tone } from "@/lib/palette";
import type { TaskStatus } from "@/lib/types";
import type { TaskType } from "@/data/my-study";

/* ---------------- 코드 / 상태 ---------------- */

export type Code = "D" | "L" | "M" | "O" | "P";
export type LeafState = "unassigned" | "complete" | "planned" | "delayed" | "progress";
export type Person = { userId: string; name: string; tone: Tone; c: Code };
export type TreeMember = { userId: string; name: string; tone: Tone; doesTasks: boolean };

export const CODE_LABEL: Record<Code, string> = { D: "기한내 제출", L: "지각 제출", M: "미제출", O: "진행중", P: "예정" };
export const CODE_COLOR: Record<Code, string> = { D: "#1A7F55", L: "#8A5A00", M: "#C0392B", O: "#3A4452", P: "#5B6675" };
export const CODE_STATUS: Record<Code, TaskStatus> = { D: "done", L: "late", M: "missed", O: "open", P: "planned" };
export const STATUS_CODE: Record<TaskStatus, Code> = { done: "D", late: "L", missed: "M", open: "O", planned: "P" };
export const CODE_STATE: Record<Code, LeafState> = { D: "complete", L: "complete", M: "delayed", O: "progress", P: "planned" };

/* ---------------- 편집 오버라이드 (낙관적 갱신용) ---------------- */

export type Overrides = {
  titles: Record<string, string>;
  descs: Record<string, string>;
  dates: Record<string, { s?: string; e?: string }>;
  typeOv: Record<string, TaskType>;
  /** 지정 과제 담당자 userId[] */
  assignOv: Record<string, string[]>;
  /** 부모 id 또는 'root' → 추가된 제목 배열 (서버 응답으로 교체되기 전까지) */
  added: Record<string, string[]>;
  removed: Record<string, boolean>;
  archived: Record<string, boolean>;
};

export const EMPTY_OVERRIDES: Overrides = { titles: {}, descs: {}, dates: {}, typeOv: {}, assignOv: {}, added: {}, removed: {}, archived: {} };

/** 추가(미저장) 노드의 임시 id */
export const tempId = (parentId: string, i: number) => `${parentId}.new${i}`;
const TEMP_ORDER = 10_000;

/* ---------------- 트리 노드 ---------------- */

type NodeBase = {
  id: string;
  /** 속한 회차(루트) id — 보드 회차 필터 */
  roundId: string;
  /** depth: 루트 0 (= DTO depth − 2) */
  d: number;
  title: string;
  desc: string;
  s: string;
  e: string;
  archived: boolean;
  /** 자기는 보관이 아니고 상위가 보관돼 함께 숨겨진 상태 — 이 노드에서는 "보관 해제" 를 할 수 없다 */
  archivedByParent: boolean;
  /** 보관된 하위까지 포함한 제출 수 — 0 보다 크면 서버가 삭제를 막으므로 "보관" 을 권한다 */
  subAll: number;
  /** "1주차 IAM·VPC › 로드밸런서 비교" */
  crumb: string;
  roundLabel: string | null;
  /** 서버에 아직 없는 임시 노드 */
  temp: boolean;
};

export type LeafNode = NodeBase & { leaf: true; type: TaskType; people: Person[]; asg: number; sub: number; state: LeafState };
export type ParentNode = NodeBase & { leaf: false; label: string | null; kids: TreeNode[]; childCount: number; asg: number; sub: number; pct: number };
export type TreeNode = LeafNode | ParentNode;

export type Tree = {
  roots: ParentNode[];
  /** 전위 순회 전체 (삭제 제외) */
  nodes: TreeNode[];
  /** 보관 제외 리프 */
  leaves: LeafNode[];
  /** 추가 회차 포함 루트 수 */
  rootCount: number;
  /** 활성 참가자 (이탈자 제외) */
  members: TreeMember[];
};

const after = (a: string, b: string) => parseISO(a) > parseISO(b);
const before = (a: string, b: string) => parseISO(a) < parseISO(b);

export function leafState(asg: number, sub: number, s: string, e: string, today: string): LeafState {
  if (asg === 0) return "unassigned";
  if (sub === asg) return "complete";
  if (after(s, today)) return "planned";
  if (before(e, today)) return "delayed";
  return "progress";
}

/** Curriculum + 오버라이드 → 집계된 트리. 서버 사람별 코드를 그대로 쓰고, 유형/담당자 오버라이드가 있는 리프만 다시 계산한다. */
export function buildTree(cur: Curriculum, ov: Overrides, today: string): Tree {
  const members: TreeMember[] = cur.members.filter((m) => m.status === "active").map((m) => ({ userId: m.userId, name: m.nickname, tone: m.tone, doesTasks: m.doesTasks }));
  const doers = members.filter((m) => m.doesTasks);
  const byParent = new Map<string | null, NodeDto[]>();
  for (const n of cur.nodes) {
    const list = byParent.get(n.parentId) ?? [];
    list.push(n);
    byParent.set(n.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);
  const nodes: TreeNode[] = [];
  const fresh = (s: string): Code => (s > today ? "P" : "O");

  const tempChild = (p: NodeDto, title: string, i: number): NodeDto => ({
    id: tempId(p.id, i), parentId: p.id, roundId: p.depth === 2 ? p.id : p.roundId, depth: p.depth + 1, sortOrder: TEMP_ORDER + i, label: null, title, descriptionMd: "",
    startDate: p.startDate, endDate: p.endDate, archived: false, task: { type: "common", people: [], assigned: 0, submitted: 0, state: "unassigned" }, assigned: 0, submitted: 0, pct: null,
  });

  const walk = (n: NodeDto, crumbs: string[], rl: string | null, parentArchived: boolean, temp: boolean): TreeNode | null => {
    if (ov.removed[n.id]) return null;
    const title = ov.titles[n.id] ?? n.title;
    const desc = ov.descs[n.id] ?? n.descriptionMd;
    const dOv = ov.dates[n.id] ?? {};
    const s = dOv.s || n.startDate;
    const e = dOv.e || n.endDate;
    const archived = ov.archived[n.id] ?? (n.archived || parentArchived);
    const archivedByParent = parentArchived && !(ov.archived[n.id] ?? n.archived);
    const d = n.depth - 2;
    const roundId = d === 0 ? n.id : n.roundId;
    const kidsRaw = [...(byParent.get(n.id) ?? []), ...(ov.added[n.id] ?? []).map((t, i) => tempChild(n, t, i))];
    const base = { id: n.id, roundId, d, title, desc, s, e, archived, archivedByParent, crumb: crumbs.join(" › "), temp };

    if (n.task && kidsRaw.length === 0) {
      const type: TaskType = ov.typeOv[n.id] ?? TASK_TYPE_KO[n.task.type];
      const known = new Map(n.task.people.map((p) => [p.userId, STATUS_CODE[p.status]]));
      const recompute = temp || n.id in ov.typeOv || n.id in ov.assignOv;
      let people: Person[];
      if (!recompute) people = n.task.people.map((p) => ({ userId: p.userId, name: p.nickname, tone: p.tone, c: STATUS_CODE[p.status] }));
      else {
        const chosen = type === "공통" ? doers : ov.assignOv[n.id] ? doers.filter((m) => ov.assignOv[n.id].includes(m.userId)) : doers.filter((m) => known.has(m.userId));
        people = chosen.map((m) => ({ userId: m.userId, name: m.name, tone: m.tone, c: known.get(m.userId) ?? fresh(s) }));
      }
      const asg = people.length;
      const sub = people.filter((p) => p.c === "D" || p.c === "L").length;
      const leaf: LeafNode = { ...base, subAll: sub, leaf: true, type, people, asg, sub, state: leafState(asg, sub, s, e, today), roundLabel: rl };
      nodes.push(leaf);
      return leaf;
    }

    const roundLabel = d === 0 ? n.label : rl;
    const node: ParentNode = { ...base, subAll: 0, leaf: false, label: n.label, roundLabel, kids: [], childCount: kidsRaw.length, asg: 0, sub: 0, pct: 0 };
    nodes.push(node);
    const here = d === 0 ? `${n.label} ${title}` : title;
    kidsRaw.forEach((c) => {
      const k = walk(c, [...crumbs, here], roundLabel, archived, temp || c.sortOrder >= TEMP_ORDER);
      if (k) node.kids.push(k);
    });
    const live = node.kids.filter((k) => !k.archived);
    node.asg = live.reduce((a, k) => a + k.asg, 0);
    node.sub = live.reduce((a, k) => a + k.sub, 0);
    node.pct = node.asg ? Math.round((node.sub / node.asg) * 100) : 0;
    node.subAll = node.kids.reduce((a, k) => a + k.subAll, 0);
    return node;
  };

  const baseRoots = byParent.get(null) ?? [];
  const lastE = baseRoots.length ? baseRoots[baseRoots.length - 1].endDate : today;
  const tempRoots: NodeDto[] = (ov.added.root ?? []).map((t, i) => {
    const s = addDays(lastE, 1 + i * 7);
    const id = tempId("root", i);
    return { id, parentId: null, roundId: id, depth: 2, sortOrder: TEMP_ORDER + i, label: `${baseRoots.length + i + 1}주차`, title: t, descriptionMd: "", startDate: s, endDate: addDays(s, 6), archived: false, task: null, assigned: 0, submitted: 0, pct: null };
  });
  const rootList = [...baseRoots, ...tempRoots];
  const roots: ParentNode[] = [];
  rootList.forEach((n) => {
    const rt = walk(n, [], null, false, n.sortOrder >= TEMP_ORDER);
    if (rt && !rt.leaf) roots.push(rt);
  });
  const leaves = nodes.filter((n): n is LeafNode => n.leaf && !n.archived);
  return { roots, nodes, leaves, rootCount: rootList.length, members };
}

/** 접힘 상태를 반영한 보이는 행 (전위 순서) */
export function visibleNodes(roots: ParentNode[], closed: Record<string, boolean>): TreeNode[] {
  const out: TreeNode[] = [];
  const add = (n: TreeNode) => {
    out.push(n);
    if (!n.leaf && !closed[n.id]) n.kids.forEach(add);
  };
  roots.forEach(add);
  return out;
}

export function allParentsClosed(nodes: TreeNode[]): Record<string, boolean> {
  const c: Record<string, boolean> = {};
  nodes.forEach((n) => {
    if (!n.leaf) c[n.id] = true;
  });
  return c;
}

/** 전체 = 루트 합계 기준 (보관 루트 제외). asg 0 이면 null. */
export function overallPct(roots: ParentNode[]): number | null {
  const live = roots.filter((r) => !r.archived);
  const asg = live.reduce((a, r) => a + r.asg, 0);
  const sub = live.reduce((a, r) => a + r.sub, 0);
  return asg ? Math.round((sub / asg) * 100) : null;
}

export const unassignedCount = (leaves: LeafNode[]) => leaves.filter((l) => l.type === "지정" && l.asg === 0).length;

/** 참가자 한 명의 제출/담당 (보관 제외 리프, userId 기준) */
export function memberStats(leaves: LeafNode[], userId: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  leaves.forEach((l) => {
    const p = l.people.find((x) => x.userId === userId);
    if (!p) return;
    total += 1;
    if (p.c === "D" || p.c === "L") done += 1;
  });
  return { done, total };
}

export const findNode = (nodes: TreeNode[], id: string | null) => (id ? (nodes.find((n) => n.id === id) ?? null) : null);

export const ddayLabel = (today: string, e: string) => dday(today, e);

/* ---------------- 보드 ---------------- */

export type BoardCol = "todo" | "doing" | "done";

export const myCode = (l: LeafNode, meId: string | null): Code | null => (meId ? (l.people.find((p) => p.userId === meId)?.c ?? null) : null);

export function boardColumn(l: LeafNode, mine: boolean, meId: string | null): BoardCol {
  if (mine) {
    const c = myCode(l, meId);
    return c === "P" ? "todo" : c === "D" || c === "L" ? "done" : "doing";
  }
  return l.state === "planned" || l.state === "unassigned" ? "todo" : l.state === "complete" ? "done" : "doing";
}

/* ---------------- 캘린더 ---------------- */

export type CalMode = "month" | "week";

/** today 가 과제 범위 안이면 today, 아니면 첫 과제 시작일 */
export function calendarAnchor(leaves: LeafNode[], today: string): string {
  if (leaves.length === 0) return today;
  const minS = leaves.reduce((a, l) => (l.s < a ? l.s : a), leaves[0].s);
  const maxE = leaves.reduce((a, l) => (l.e > a ? l.e : a), leaves[0].e);
  return today >= minS && today <= maxE ? today : minS;
}

const dow = (iso: string) => new Date(parseISO(iso)).getUTCDay();
export const weekStartOf = (iso: string) => addDays(iso, -dow(iso));

export function calendarGrid(anchor: string, mode: CalMode): { gridStart: string; rows: number; label: string; month: number } {
  const y = +anchor.slice(0, 4);
  const mo = +anchor.slice(5, 7);
  if (mode === "week") {
    const gridStart = weekStartOf(anchor);
    return { gridStart, rows: 1, label: `${md(gridStart)} – ${md(addDays(gridStart, 6))}`, month: mo };
  }
  const first = `${y}-${String(mo).padStart(2, "0")}-01`;
  const lead = dow(first);
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { gridStart: addDays(first, -lead), rows: Math.ceil((lead + dim) / 7), label: `${y}년 ${mo}월`, month: mo };
}

export function shiftAnchor(anchor: string, mode: CalMode, dir: 1 | -1): string {
  if (mode === "week") return addDays(anchor, dir * 7);
  const y = +anchor.slice(0, 4);
  const mo = +anchor.slice(5, 7) - 1 + dir;
  return new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
}

export type CalSeg = { l: LeafNode; col: number; span: number; isStart: boolean; isEnd: boolean; lane: number };

export function weekSegments(leaves: LeafNode[], weekStart: string): CalSeg[] {
  const ws = parseISO(weekStart);
  const we = ws + 6 * 86400000;
  const segs = leaves
    .filter((l) => parseISO(l.s) <= we && parseISO(l.e) >= ws)
    .map((l) => {
      const s = Math.max(parseISO(l.s), ws);
      const e = Math.min(parseISO(l.e), we);
      return { l, col: Math.round((s - ws) / 86400000), span: Math.round((e - s) / 86400000) + 1, isStart: s === parseISO(l.s), isEnd: e === parseISO(l.e), lane: 0 };
    })
    .sort((a, b) => a.col - b.col || b.span - a.span);
  return packLanes(segs);
}

export function packLanes<T extends { col: number; span: number; lane: number }>(segs: T[]): T[] {
  const laneEnd: number[] = [];
  segs.forEach((sg) => {
    let ln = laneEnd.findIndex((x) => x < sg.col);
    if (ln === -1) {
      ln = laneEnd.length;
      laneEnd.push(-1);
    }
    laneEnd[ln] = sg.col + sg.span - 1;
    sg.lane = ln;
  });
  return segs;
}

/* ---------------- 간트 ---------------- */

export function ganttRange(roots: ParentNode[], today: string): { start: string; nDays: number } {
  if (roots.length === 0) return { start: weekStartOf(today), nDays: 7 };
  const rS = roots.reduce((a, r) => (r.s < a ? r.s : a), roots[0].s);
  const rE = roots.reduce((a, r) => (r.e > a ? r.e : a), roots[0].e);
  const start = weekStartOf(rS);
  const end = addDays(rE, 6 - dow(rE));
  return { start, nDays: diffDays(start, end) + 1 };
}
