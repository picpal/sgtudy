import { myCode, type LeafNode, type Tree } from "./model";

const hasPerson = (l: LeafNode, userId: string | null) => !!userId && l.people.some((p) => p.userId === userId);
const ownedBy = (tree: Tree, userId: string | null) => (userId ? tree.personal.filter((l) => l.ownerId === userId) : []);

/** 보드 카드 원천 — 내 칸반: 내 배정 팀 리프 + 내 개인 목표 / 팀 칸반: 팀 리프만 */
export function boardSource(tree: Tree, mine: boolean, meId: string | null): LeafNode[] {
  if (!mine) return tree.leaves;
  return [...tree.leaves.filter((l) => !!myCode(l, meId)), ...ownedBy(tree, meId)];
}

/** 캘린더 막대 원천 — who: "all"(팀 리프 + 내 개인) | "me" | userId (그 사람 배정 리프 + 그 사람 개인) */
export function calendarSource(tree: Tree, who: string, meId: string | null): LeafNode[] {
  if (who === "all") return [...tree.leaves, ...ownedBy(tree, meId)];
  const uid = who === "me" ? meId : who;
  return [...tree.leaves.filter((l) => hasPerson(l, uid)), ...ownedBy(tree, uid)];
}
