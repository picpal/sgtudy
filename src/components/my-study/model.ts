/**
 * 내 스터디 화면의 순수 로직 — 트리 평탄화, 편집 오버라이드, 상태 판정, 집계, 캘린더/간트 배치.
 * React 와 무관하게 입력 → 출력만 한다.
 */
import { addDays, dday, diffDays, md, parseISO } from "@/lib/date";
import { ME, TODAY } from "@/lib/routes";
import type { TaskStatus } from "@/lib/types";
import { isRawLeaf, type Plan, type RawChild, type RawNode, type TaskType } from "@/data/my-study";

/* ---------------- 코드 / 상태 ---------------- */

/** 담당자별 코드 (미배정 '-' 는 people 에서 제외되므로 여기 없음) */
export type Code = "D" | "L" | "M" | "O" | "P";
export type LeafState = "unassigned" | "complete" | "planned" | "delayed" | "progress";
export type Person = { name: string; c: Code };

export const CODE_LABEL: Record<Code, string> = { D: "기한내 제출", L: "지각 제출", M: "미제출", O: "진행중", P: "예정" };
export const CODE_COLOR: Record<Code, string> = { D: "#1A7F55", L: "#8A5A00", M: "#C0392B", O: "#3A4452", P: "#5B6675" };
export const CODE_STATUS: Record<Code, TaskStatus> = { D: "done", L: "late", M: "missed", O: "open", P: "planned" };
/** 특정인 필터 시 막대 색: 그 사람 코드 → state */
export const CODE_STATE: Record<Code, LeafState> = { D: "complete", L: "complete", M: "delayed", O: "progress", P: "planned" };

const isCode = (c: string): c is Code => c === "D" || c === "L" || c === "M" || c === "O" || c === "P";

/* ---------------- 편집 오버라이드 ---------------- */

export type Overrides = {
  titles: Record<string, string>;
  dates: Record<string, { s?: string; e?: string }>;
  typeOv: Record<string, TaskType>;
  assignOv: Record<string, string[]>;
  /** 부모 id 또는 'root' → 추가된 제목 배열 */
  added: Record<string, string[]>;
  removed: Record<string, boolean>;
  archived: Record<string, boolean>;
};

export const EMPTY_OVERRIDES: Overrides = { titles: {}, dates: {}, typeOv: {}, assignOv: {}, added: {}, removed: {}, archived: {} };

/* ---------------- 트리 노드 ---------------- */

type NodeBase = {
  id: string;
  /** depth: 루트 0 */
  d: number;
  title: string;
  s: string;
  e: string;
  archived: boolean;
  /** "1주차 IAM·VPC › 로드밸런서 비교" */
  crumb: string;
  /** 속한 회차 라벨 */
  roundLabel: string | null;
};

export type LeafNode = NodeBase & {
  leaf: true;
  type: TaskType;
  people: Person[];
  asg: number;
  sub: number;
  state: LeafState;
};

export type ParentNode = NodeBase & {
  leaf: false;
  label: string | null;
  kids: TreeNode[];
  /** 추가 항목 포함 자식 수 (새 자식 id 계산용) */
  childCount: number;
  asg: number;
  sub: number;
  pct: number;
};

export type TreeNode = LeafNode | ParentNode;

export type Tree = {
  roots: ParentNode[];
  /** 전위 순회 전체 (삭제 제외) */
  nodes: TreeNode[];
  /** 보관 제외 리프 */
  leaves: LeafNode[];
  /** 추가 회차 포함 루트 수 — "+ 회차 추가" 시 새 id */
  rootCount: number;
  members: string[];
};

const after = (a: string, b: string) => parseISO(a) > parseISO(b);
const before = (a: string, b: string) => parseISO(a) < parseISO(b);

export function leafState(asg: number, sub: number, s: string, e: string): LeafState {
  if (asg === 0) return "unassigned";
  if (sub === asg) return "complete";
  if (after(s, TODAY)) return "planned";
  if (before(e, TODAY)) return "delayed";
  return "progress";
}

/** 원본 트리 + 오버라이드 → 집계된 트리. id 는 루트 "0", 하위 "0.1" 형식. */
export function buildTree(plan: Plan, ov: Overrides): Tree {
  const members = plan.members;
  const nodes: TreeNode[] = [];

  const walk = (n: RawChild, id: string, dep: number, crumbs: string[], rl: string | null): TreeNode | null => {
    if (ov.removed[id]) return null;
    const title = ov.titles[id] ?? n.title;
    const dOv = ov.dates[id] ?? {};
    const s = dOv.s || n.s;
    const e = dOv.e || n.e;
    const archived = !!ov.archived[id];
    const crumb = crumbs.join(" › ");

    if (isRawLeaf(n)) {
      const type = ov.typeOv[id] ?? n.type;
      const fresh: Code = after(s, TODAY) ? "P" : "O";
      let codes: string[] = members.map((_, i) => n.codes[i] || "-");
      if (type === "공통") codes = codes.map((c) => (c === "-" ? fresh : c));
      else if (ov.assignOv[id]) {
        const chosen = ov.assignOv[id];
        codes = members.map((m, i) => (chosen.includes(m) ? (codes[i] === "-" ? fresh : codes[i]) : "-"));
      }
      const people: Person[] = [];
      members.forEach((m, i) => {
        const c = codes[i];
        if (isCode(c)) people.push({ name: m, c });
      });
      const asg = people.length;
      const sub = people.filter((p) => p.c === "D" || p.c === "L").length;
      const leaf: LeafNode = { id, d: dep, leaf: true, title, s, e, type, people, asg, sub, state: leafState(asg, sub, s, e), archived, crumb, roundLabel: rl };
      nodes.push(leaf);
      return leaf;
    }

    const roundLabel = dep === 0 ? n.label : rl;
    const node: ParentNode = { id, d: dep, leaf: false, title, s, e, label: n.label, roundLabel, archived, kids: [], crumb, childCount: 0, asg: 0, sub: 0, pct: 0 };
    nodes.push(node);
    const extra: RawChild[] = (ov.added[id] ?? []).map((t) => ({ title: t, type: "공통" as const, s, e, codes: "" }));
    const all = n.children.concat(extra);
    node.childCount = all.length;
    const here = dep === 0 ? `${n.label} ${title}` : title;
    all.forEach((c, i) => {
      const k = walk(c, `${id}.${i}`, dep + 1, [...crumbs, here], roundLabel);
      if (k) node.kids.push(k);
    });
    const live = node.kids.filter((k) => !k.archived);
    node.asg = live.reduce((a, k) => a + k.asg, 0);
    node.sub = live.reduce((a, k) => a + k.sub, 0);
    node.pct = node.asg ? Math.round((node.sub / node.asg) * 100) : 0;
    return node;
  };

  const lastE = plan.tree[plan.tree.length - 1].e;
  const rootList: RawNode[] = plan.tree.concat(
    (ov.added.root ?? []).map((t, i) => {
      const s = addDays(lastE, 1 + i * 7);
      return { label: `${plan.tree.length + i + 1}회차`, title: t, s, e: addDays(s, 6), children: [] };
    }),
  );
  const roots: ParentNode[] = [];
  rootList.forEach((n, i) => {
    const rt = walk(n, String(i), 0, [], null);
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

/** 참가자 한 명의 제출/담당 (보관 제외 리프 기준) */
export function memberStats(leaves: LeafNode[], name: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  leaves.forEach((l) => {
    const p = l.people.find((x) => x.name === name);
    if (!p) return;
    total += 1;
    if (p.c === "D" || p.c === "L") done += 1;
  });
  return { done, total };
}

export const findNode = (nodes: TreeNode[], id: string | null) => (id ? (nodes.find((n) => n.id === id) ?? null) : null);

export const ddayLabel = (e: string) => dday(TODAY, e);

/* ---------------- 보드 ---------------- */

export type BoardCol = "todo" | "doing" | "done";

export const myCode = (l: LeafNode): Code | null => l.people.find((p) => p.name === ME.name)?.c ?? null;

export function boardColumn(l: LeafNode, mine: boolean): BoardCol {
  if (mine) {
    const c = myCode(l);
    return c === "P" ? "todo" : c === "D" || c === "L" ? "done" : "doing";
  }
  return l.state === "planned" || l.state === "unassigned" ? "todo" : l.state === "complete" ? "done" : "doing";
}

/* ---------------- 캘린더 ---------------- */

export type CalMode = "month" | "week";

/** TODAY 가 과제 범위 안이면 TODAY, 아니면 첫 과제 시작일 */
export function calendarAnchor(leaves: LeafNode[]): string {
  if (leaves.length === 0) return TODAY;
  const minS = leaves.reduce((a, l) => (l.s < a ? l.s : a), leaves[0].s);
  const maxE = leaves.reduce((a, l) => (l.e > a ? l.e : a), leaves[0].e);
  return TODAY >= minS && TODAY <= maxE ? TODAY : minS;
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

/** 한 주(일요일 시작) 안의 막대 조각 — 레인 배치 포함 */
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

/** 시작열 순 정렬된 조각을 겹치지 않는 첫 레인에 배치 */
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

/** 루트 최소 시작일의 일요일 ~ 루트 최대 종료일의 토요일 */
export function ganttRange(roots: ParentNode[]): { start: string; nDays: number } {
  if (roots.length === 0) return { start: weekStartOf(TODAY), nDays: 7 };
  const rS = roots.reduce((a, r) => (r.s < a ? r.s : a), roots[0].s);
  const rE = roots.reduce((a, r) => (r.e > a ? r.e : a), roots[0].e);
  const start = weekStartOf(rS);
  const end = addDays(rE, 6 - dow(rE));
  return { start, nDays: diffDays(start, end) + 1 };
}
