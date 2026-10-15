/**
 * 회차(스프린트형 그릇) ↔ 과제(이슈) 순수 로직 — 현재 회차, 회차 선택지, 이동 기간, 형제 순서, 목록의 "+ 과제 추가" 줄.
 * React 와 무관. 서버 계약: node_move 의 index 는 "자기를 뺀 새 형제" 기준 위치다.
 */
import { addDays, diffDays, md } from "@/lib/date";
import type { ParentNode, TreeNode } from "./model";

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

export const siblingIndex = (parent: ParentNode, id: string): number => parent.kids.findIndex((k) => k.id === id);

/** 위(-1)/아래(+1)로 한 칸 — node_move index. 끝이면 null */
export function reorderIndex(parent: ParentNode, id: string, dir: -1 | 1): number | null {
  const i = siblingIndex(parent, id);
  const j = i + dir;
  return i < 0 || j < 0 || j >= parent.kids.length ? null : j;
}

export type ListEntry = { kind: "node"; n: TreeNode } | { kind: "add"; round: ParentNode };

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

/** 빠른 추가 제목 — 앞뒤 공백 제거, 비면 null, 80자까지 (서버 INVALID_TITLE 와 같은 한도) */
export const normalizeTitle = (raw: string): string | null => {
  const t = raw.trim();
  return t ? t.slice(0, 80) : null;
};
