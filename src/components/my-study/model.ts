/**
 * 내 스터디 화면의 순수 로직 — Curriculum DTO(전위 순서 NodeDto[]) → 트리, 편집 오버라이드, 상태 판정, 집계, 캘린더/간트 배치.
 * React 와 무관하게 입력 → 출력만 한다. "오늘"과 "나"는 인자로 받는다.
 */
import { addDays, dday, diffDays, md, parseISO } from "@/lib/date";
import { TASK_TYPE_KO, rangeShort } from "@/lib/api/format";
import type { Curriculum, NodeDto } from "@/lib/api/types";
import type { Tone } from "@/lib/palette";
import type { TaskStatus } from "@/lib/types";
import type { TaskType } from "@/data/my-study";

/* ---------------- 코드 / 상태 ---------------- */

export type Code = "D" | "L" | "M" | "O" | "P";
export type LeafState = "unassigned" | "complete" | "planned" | "delayed" | "progress";
export type Person = { userId: string; name: string; tone: Tone; c: Code };
export type TreeMember = { userId: string; name: string; tone: Tone; doesTasks: boolean; assignFrom: string | null };

export const CODE_LABEL: Record<Code, string> = { D: "기한내 제출", L: "지각 제출", M: "미제출", O: "진행중", P: "예정" };
/** 개인 목표 상태 문구 — 제출이 아니라 완료한다. 마감 지난 미완료(M)는 "기한 지남" */
export const PERSONAL_LABEL: Record<Code, string> = { D: "기한내 완료", L: "늦게 완료", M: "기한 지남", O: "진행중", P: "예정" };
/** 리프의 사람별 상태 문구 단일 출처 — 개인 목표면 PERSONAL_LABEL, 팀 과제면 CODE_LABEL */
export const codeLabel = (l: { personal: boolean }, c: Code): string => (l.personal ? PERSONAL_LABEL[c] : CODE_LABEL[c]);
/** 상태 색 단일 출처 — 기한내 초록 · 늦게/지각 호박 · 기한 지남/미제출 빨강 (보드·상세·회차 섹션·진행목표·/tasks 공용) */
export const CODE_COLOR: Record<Code, string> = { D: "#1A7F55", L: "#8A5A00", M: "#C0392B", O: "#3A4452", P: "#5B6675" };
/** 상태 칩(바탕 + 글자) — CODE_COLOR 와 같은 계열. 진행목표 행·/tasks 행 공용 */
export const CODE_CHIP: Record<Code, string> = { D: "bg-mint-soft text-mint-deep", L: "bg-amber-soft text-amber-text", M: "bg-warn-soft text-warn", O: "bg-line-2 text-ink-2", P: "bg-line-2 text-ink-2" };
/** 완료(기한내·늦게) 판정 단일 출처 */
export const isDoneCode = (c: Code | null | undefined): boolean => c === "D" || c === "L";
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
  /** 노드 id → 선택된 첨부 id (저장본과 다를 때만) */
  files: Record<string, string[]>;
  /** 부모 id 또는 'root' → 추가된 제목 배열 (서버 응답으로 교체되기 전까지) */
  added: Record<string, string[]>;
  removed: Record<string, boolean>;
  archived: Record<string, boolean>;
};

export const EMPTY_OVERRIDES: Overrides = { titles: {}, descs: {}, dates: {}, typeOv: {}, assignOv: {}, files: {}, added: {}, removed: {}, archived: {} };

/** 편집 패널이 "저장" 전까지 모아 두는 필드 — 구조 변경(added/removed/archived)은 즉시 RPC 라 미저장 대상이 아니다 */
const FIELD_KEYS = ["titles", "descs", "dates", "typeOv", "assignOv", "files"] as const;

/** 그 노드에 저장하지 않은 수정이 있나 (Q2-05) */
export const isDirty = (ov: Overrides, id: string | null): boolean => !!id && FIELD_KEYS.some((k) => id in ov[k]);

/** 한 노드의 미저장 수정만 버린다 */
export function dropFieldOv(ov: Overrides, id: string): Overrides {
  const out = { ...ov };
  FIELD_KEYS.forEach((k) => {
    const { [id]: _omit, ...rest } = ov[k] as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-unused-vars
    (out as Record<string, unknown>)[k] = rest;
  });
  return out;
}

/** 저장에 보낸 값(sent)과 지금 값이 같은 필드만 버린다 — 저장하는 사이 또 고친 필드는 남아 계속 "미저장" 이다.
 *  오버라이드 값은 고칠 때마다 새 값(문자열·새 객체/배열)이라 === 로 견준다 */
export function dropSentFieldOv(ov: Overrides, sent: Overrides, id: string): Overrides {
  const out = { ...ov };
  FIELD_KEYS.forEach((k) => {
    const cur = ov[k] as Record<string, unknown>;
    if (!(id in cur) || cur[id] !== (sent[k] as Record<string, unknown>)[id]) return;
    const { [id]: _omit, ...rest } = cur; // eslint-disable-line @typescript-eslint/no-unused-vars
    (out as Record<string, unknown>)[k] = rest;
  });
  return out;
}

/** 구조 오버라이드만 남긴다 — 커리큘럼 편집 패널 밖(개요·보드·캘린더·간트)에는 저장된 값만 보인다 */
export const stripFieldOv = (ov: Overrides): Overrides => ({ ...ov, titles: {}, descs: {}, dates: {}, typeOv: {}, assignOv: {}, files: {} });

/** 추가(미저장) 노드의 임시 id */
export const tempId = (parentId: string, i: number) => `${parentId}.new${i}`;
const TEMP_ORDER = 10_000;

/* ---------------- 트리 노드 ---------------- */

type NodeBase = {
  id: string;
  parentId: string | null;
  /** 속한 회차(루트) id — 보드 회차 필터 */
  roundId: string;
  /** depth: 루트 0 (= DTO depth − 2) */
  d: number;
  title: string;
  desc: string;
  s: string;
  e: string;
  /** 저장된(서버) 시작일 — 편집 중 오버라이드와 비교해 "하위도 함께 옮길까요" 를 묻는다 (시나리오 QA D2) */
  s0?: string;
  /** 만든 사람 닉네임 (0024 createdBy — 그 이전·시드 노드는 null) — 상세에 "OO 님이 추가" (시나리오 QA #13) */
  by?: string | null;
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

export type LeafNode = NodeBase & {
  leaf: true;
  type: TaskType;
  people: Person[];
  asg: number;
  sub: number;
  state: LeafState;
  /** 개인 목표 소유자 (팀 과제는 null) */
  ownerId: string | null;
  /** 개인 목표 리프 — 부모 롤업·Tree.leaves 에서 빠지고, 편집 모드에 그리지 않는다 */
  personal: boolean;
  /** 개인 목표 소유자의 멤버 순서(Curriculum.members). 팀 과제·명단에 없는 소유자는 -1 / 끝 */
  ownerRank: number;
  /** 개인 목표 소유자가 ACTIVE 명단에 없다(이탈) — "보관됨 · 이탈" 배지, 그룹장 "보관 해제" 없음(서버 OWNER_NOT_ACTIVE) */
  ownerLeft: boolean;
};
export type ParentNode = NodeBase & { leaf: false; label: string | null; kids: TreeNode[]; childCount: number; asg: number; sub: number; pct: number };
export type TreeNode = LeafNode | ParentNode;

export type Tree = {
  roots: ParentNode[];
  /** 전위 순회 전체 (삭제 제외) */
  nodes: TreeNode[];
  /** 보관 제외 팀 리프 (개인 목표 제외 — 집계·보드·캘린더의 팀 의미 그대로) */
  leaves: LeafNode[];
  /** 보관 제외 개인 목표 리프 (보이는 것 = 서버가 준 것) */
  personal: LeafNode[];
  /** 추가 회차 포함 루트 수 */
  rootCount: number;
  /** 활성 참가자 (이탈자 제외) */
  members: TreeMember[];
};

const after = (a: string, b: string) => parseISO(a) > parseISO(b);
const before = (a: string, b: string) => parseISO(a) < parseISO(b);

/**
 * 제출이 있는 과제에서 미리 막을 편집 — 저장 때 서버가 거절하는 것을 토글 단계에서 보여 준다 (시나리오 QA #11).
 * 서버 node_update(0023): 제출물이 있으면 유형 변경 불가(NODE_HAS_SUBMISSIONS), 제출한 담당자는 뺄 수 없음(ASSIGNEE_HAS_SUBMISSION).
 */
export function leafLocks(n: Pick<LeafNode, "subAll" | "people" | "personal">): { typeReason: string | null; lockedIds: Set<string>; assignReason: string } {
  const lockedIds = new Set(n.people.filter((p) => isDoneCode(p.c)).map((p) => p.userId));
  const has = n.subAll > 0 || lockedIds.size > 0;
  return { typeReason: has ? "제출물이 있는 과제는 유형을 바꿀 수 없어요" : null, lockedIds, assignReason: "이미 제출한 담당자는 뺄 수 없어요" };
}

export function leafState(asg: number, sub: number, s: string, e: string, today: string): LeafState {
  if (asg === 0) return "unassigned";
  if (sub === asg) return "complete";
  if (after(s, today)) return "planned";
  if (before(e, today)) return "delayed";
  return "progress";
}

/** Curriculum + 오버라이드 → 집계된 트리. 서버 사람별 코드를 그대로 쓰고, 유형/담당자 오버라이드가 있는 리프만 다시 계산한다. */
export function buildTree(cur: Curriculum, ov: Overrides, today: string): Tree {
  const members: TreeMember[] = cur.members.filter((m) => m.status === "active").map((m) => ({ userId: m.userId, name: m.nickname, tone: m.tone, doesTasks: m.doesTasks, assignFrom: m.assignFrom ?? null }));
  const doers = members.filter((m) => m.doesTasks);
  const rank = new Map(cur.members.map((m, i) => [m.userId, i]));
  const activeIds = new Set(members.map((m) => m.userId));
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
    const base = { id: n.id, parentId: n.parentId, roundId, d, title, desc, s, e, s0: n.startDate, by: n.createdBy?.nickname ?? null, archived, archivedByParent, crumb: crumbs.join(" › "), temp };

    if (n.task && kidsRaw.length === 0) {
      const personal = n.task.type === "personal";
      // 개인 목표는 편집 패널 대상이 아니다 — 유형/담당 오버라이드를 무시하고 서버 people(= [소유자])을 그대로 쓴다
      const type: TaskType = personal ? "개인" : (ov.typeOv[n.id] ?? TASK_TYPE_KO[n.task.type]);
      const known = new Map(n.task.people.map((p) => [p.userId, STATUS_CODE[p.status]]));
      const recompute = !personal && (temp || n.id in ov.typeOv || n.id in ov.assignOv || (type === "공통" && n.id in ov.dates && doers.some((m) => m.assignFrom)));
      let people: Person[];
      if (!recompute) people = n.task.people.map((p) => ({ userId: p.userId, name: p.nickname, tone: p.tone, c: STATUS_CODE[p.status] }));
      else {
        // 공통 담당 = (원래 공통 과제였다면) 이미 배정된 사람 ∪ 배정 자격(assignFrom 없음 ∨ 마감 ≥ assignFrom) — 서버 assignment_resync 1단계와 같은 규칙.
        // 지정→공통 전환은 서버가 기존 DESIGNATED 배정을 먼저 해제한다(node_update 0028) → 기존 담당 유지는 원래 COMMON 배정에만
        const keepKnown = n.task.type === "common";
        const commonDoers = doers.filter((m) => (keepKnown && known.has(m.userId)) || !m.assignFrom || e >= m.assignFrom);
        const chosen = type === "공통" ? commonDoers : ov.assignOv[n.id] ? doers.filter((m) => ov.assignOv[n.id].includes(m.userId)) : doers.filter((m) => known.has(m.userId));
        people = chosen.map((m) => ({ userId: m.userId, name: m.name, tone: m.tone, c: known.get(m.userId) ?? fresh(s) }));
      }
      const asg = people.length;
      const sub = people.filter((p) => isDoneCode(p.c)).length;
      const ownerId = personal ? (n.ownerId ?? null) : null;
      const ownerRank = ownerId ? (rank.get(ownerId) ?? rank.size) : -1;
      const ownerLeft = !!ownerId && !activeIds.has(ownerId);
      const leaf: LeafNode = { ...base, subAll: sub, leaf: true, type, people, asg, sub, state: leafState(asg, sub, s, e, today), roundLabel: rl, ownerId, personal, ownerRank, ownerLeft };
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
    // 개인 목표는 팀 수치에서 뺀다(서버 집계와 같음). subAll 은 개인 포함 — 서버 node_has_submissions 와 같은 삭제 거부 규칙
    const live = node.kids.filter((k) => !k.archived && !isPersonal(k));
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
  const leaves = nodes.filter((n): n is LeafNode => n.leaf && !n.archived && !n.personal);
  const personal = nodes.filter((n): n is LeafNode => n.leaf && !n.archived && n.personal);
  return { roots, nodes, leaves, personal, rootCount: rootList.length, members };
}

export const isPersonal = (n: TreeNode): n is LeafNode => n.leaf && n.personal;

/** 목록·보드·캘린더가 함께 쓰는 보기 범위 */
export type ItemScope = {
  meId: string | null;
  /** 내게 배정된 팀 과제만 */
  mineOnly: boolean;
  /** 남의 개인 목표도 보기 */
  others: boolean;
  /** 커리큘럼 편집 모드 — 개인 목표를 그리지 않는다 */
  isEdit: boolean;
  isLeader: boolean;
};

/**
 * 범위 판정. 부모 = 항상(빈 회차 안내는 화면 몫). 팀 리프 = mineOnly 면 내게 배정된 것만.
 * 개인 = 편집 모드가 아니고, 내 것(보관돼도 — 흐리게) 또는 others 일 때 남의 것(보관은 그룹장만).
 */
export function inScope(n: TreeNode, sc: ItemScope): boolean {
  if (!n.leaf) return true;
  if (!n.personal) return !sc.mineOnly || !!myCode(n, sc.meId);
  if (sc.isEdit) return false;
  if (sc.meId !== null && n.ownerId === sc.meId) return true;
  return sc.others && (!n.archived || sc.isLeader);
}

/** 화면 순서: [팀(서버 순서), 내 개인(서버 순서), 남의 개인(멤버 순서 → 서버 순서)] — 안정 분할. 서버 index 계산은 늘 원래 kids 로 한다 */
function screenOrder(kids: TreeNode[], meId: string | null): TreeNode[] {
  const team: TreeNode[] = [];
  const mine: LeafNode[] = [];
  const others: LeafNode[] = [];
  kids.forEach((k) => {
    if (!isPersonal(k)) team.push(k);
    else if (meId !== null && k.ownerId === meId) mine.push(k);
    else others.push(k);
  });
  // Array.prototype.sort 는 안정 정렬 — 같은 소유자 안에서는 서버 순서가 유지된다
  others.sort((a, b) => a.ownerRank - b.ownerRank);
  return [...team, ...mine, ...others];
}

const hasLeafInScope = (n: ParentNode, sc: ItemScope): boolean => n.kids.some((k) => (k.leaf ? inScope(k, sc) : hasLeafInScope(k, sc)));

/**
 * 접힘 상태를 반영한 보이는 행 (전위 순서). 각 부모의 kids 는 screenOrder 로 나눈다.
 * sc 가 없으면 범위 필터 없이 전부(개인은 각 부모의 끝).
 */
export function visibleNodes(roots: ParentNode[], closed: Record<string, boolean>, sc?: ItemScope): TreeNode[] {
  const out: TreeNode[] = [];
  const meId = sc?.meId ?? null;
  const add = (n: TreeNode) => {
    if (sc && !inScope(n, sc)) return;
    // "내 것만": 내 리프가 하나도 없는 묶음(비루트 부모)은 빈 행이 되므로 건너뛴다. 회차 행은 남긴다(빈 회차 안내는 화면 몫)
    if (sc?.mineOnly && !n.leaf && n.d > 0 && !hasLeafInScope(n, sc)) return;
    out.push(n);
    if (!n.leaf && !closed[n.id]) screenOrder(n.kids, meId).forEach(add);
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
    if (isDoneCode(p.c)) done += 1;
  });
  return { done, total };
}

/**
 * "이번 회차" — 서버 me_tasks 의 cur 규칙과 같다(/tasks 와 같은 회차): 보관·임시 제외 회차 중
 * 시작한 회차에서 오늘을 포함하는 것 우선 → 시작일 늦은 순 → 순서 뒤쪽(room_current_round_id), 시작한 회차가 없으면 첫 회차. 회차가 없으면 null
 */
export function thisRoundId(roots: ParentNode[], today: string): string | null {
  const live = roots.map((r, i) => ({ r, i })).filter(({ r }) => !r.archived && !r.temp);
  if (live.length === 0) return null;
  const started = live.filter(({ r }) => r.s <= today);
  if (started.length === 0) return [...live].sort((a, b) => (a.r.s < b.r.s ? -1 : a.r.s > b.r.s ? 1 : a.i - b.i))[0].r.id;
  const key = ({ r, i }: { r: ParentNode; i: number }) => [r.e >= today ? 1 : 0, r.s, i] as const;
  return started.reduce((best, x) => {
    const [a1, a2, a3] = key(x);
    const [b1, b2, b3] = key(best);
    return a1 !== b1 ? (a1 > b1 ? x : best) : a2 !== b2 ? (a2 > b2 ? x : best) : a3 > b3 ? x : best;
  }).r.id;
}

/** 한 사람의 개인 목표 완료/전체 (보관 제외 — Tree.personal 을 넘긴다). roundId 가 있으면 그 회차만 */
export function personalStats(personal: LeafNode[], userId: string, roundId?: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  personal.forEach((l) => {
    if (l.ownerId !== userId || (roundId !== undefined && l.roundId !== roundId)) return;
    total += 1;
    const c = myCode(l, userId);
    if (isDoneCode(c)) done += 1;
  });
  return { done, total };
}

export const findNode = (nodes: TreeNode[], id: string | null) => (id ? (nodes.find((n) => n.id === id) ?? null) : null);

export const ddayLabel = (today: string, e: string) => dday(today, e);

/** 보기 상세의 기간 상태 문구 — 시작 전 / 진행 중(마감 D-n) / 종료 */
export function roundStatus(n: { s: string; e: string }, today: string): string {
  if (today < n.s) return `시작 ${dday(today, n.s)}`;
  if (today > n.e) return "종료";
  return `진행 중 · 마감 ${dday(today, n.e)}`;
}

/** 보관된 것까지 모든 하위 항목 수 — 삭제하면 함께 지워진다 */
export const descendantCount = (n: TreeNode): number => (n.leaf ? 0 : n.kids.reduce((a, k) => a + 1 + descendantCount(k), 0));

/** 보관된 것까지 하위의 개인 목표 수 — 회차를 지우면 함께 지워진다 */
export const personalDescendants = (n: TreeNode): number => (n.leaf ? 0 : n.kids.reduce((a, k) => a + (isPersonal(k) ? 1 : personalDescendants(k)), 0));

/**
 * 삭제 버튼을 눌렀을 때 할 일 (편집 화면·목록 공통).
 * 하위 어디에든 제출이 있으면 서버가 삭제를 막으므로 보관을 권하고, 이미 보관돼 있으면 더 할 게 없다.
 */
export type RemovePlan = { kind: "delete" | "archive"; label: string; text: string } | { kind: "none"; reason: string };
export function removePlan(n: TreeNode): RemovePlan {
  if (n.subAll > 0) {
    if (n.archived) return { kind: "none", reason: "제출물이 있어 삭제할 수 없어요 · 이미 보관돼 있어요" };
    return { kind: "archive", label: "보관", text: "제출물이 있어 삭제할 수 없어요. 대신 보관하면 참가자 화면에서 숨겨지고 제출물은 그대로 남아요. 보관할까요?" };
  }
  // 하위 항목 수는 편집 목록에 보이는 팀 항목만 — 함께 지워지는 개인 목표(서버 0014 가 같이 지운다)는 따로 알린다
  const p = personalDescendants(n);
  const k = descendantCount(n) - p;
  const head = k > 0 ? `이 항목과 하위 항목 ${k}개를 함께 삭제할까요? 되돌릴 수 없어요.` : "이 항목을 삭제할까요? 되돌릴 수 없어요.";
  return { kind: "delete", label: "삭제", text: p > 0 ? `${head} 개인 목표 ${p}개도 함께 삭제돼요.` : head };
}

/** 분석서 E4 — 상위 기간·방 기간 밖이면 경고 문구 (저장·생성은 막지 않는다) */
/** today: 날짜 표기 기준(rangeShort — 오늘과 다른 해·해를 넘는 끝은 연도, Q2-13). 생략하면 방 시작 해 기준 */
export function periodWarnings(n: { s: string; e: string }, parent: { s: string; e: string } | null, room: { start: string; end: string }, today: string = room.start): string[] {
  const out: string[] = [];
  if (parent && (n.s < parent.s || n.e > parent.e)) out.push(`상위 항목 기간(${rangeShort(parent.s, parent.e, today)})을 벗어났어요`);
  if (n.s < room.start || n.e > room.end) out.push(`방 기간(${rangeShort(room.start, room.end, today)})을 벗어났어요`);
  return out;
}

/* ---------------- 보드 ---------------- */

export type BoardCol = "todo" | "doing" | "done";

export const myCode = (l: LeafNode, meId: string | null): Code | null => (meId ? (l.people.find((p) => p.userId === meId)?.c ?? null) : null);

export function boardColumn(l: LeafNode, mine: boolean, meId: string | null): BoardCol {
  if (mine) {
    const c = myCode(l, meId);
    return c === "P" ? "todo" : isDoneCode(c) ? "done" : "doing";
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
  // 과제가 없어도 1주짜리 토막 대신 이번 주부터 5주를 그려 헤더가 끊겨 보이지 않게 한다
  if (roots.length === 0) return { start: weekStartOf(today), nDays: 35 };
  const rS = roots.reduce((a, r) => (r.s < a ? r.s : a), roots[0].s);
  const rE = roots.reduce((a, r) => (r.e > a ? r.e : a), roots[0].e);
  const start = weekStartOf(rS);
  const end = addDays(rE, 6 - dow(rE));
  return { start, nDays: diffDays(start, end) + 1 };
}
