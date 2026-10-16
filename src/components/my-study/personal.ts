/**
 * 개인 목표 상세·편집 폼·회차 상세 섹션의 순수 로직 (스펙 §4.5·§4.6·§5.4·§6). React 와 무관.
 */
import type { PersonalPatch } from "@/lib/api/personal";
import type { Tone } from "@/lib/palette";
import { md } from "@/lib/date";
import { CODE_LABEL, isPersonal, roundStatus, type Code, type LeafNode, type ParentNode } from "./model";
import type { RoomStatus } from "./submission";

export type PersonalActions = {
  edit: boolean;
  complete: boolean;
  archive: boolean;
  remove: boolean;
  /** 삭제를 막은 이유 (그룹장 · 제출 있음) — ⋯ 메뉴의 비활성 "삭제" 아래 한 줄 */
  removeOff?: string;
  /** 그룹장이 남의 목표를 볼 때 안내 */
  note?: string;
};

const NONE: PersonalActions = { edit: false, complete: false, archive: false, remove: false };
export const LEADER_NOTE = "팀원이 만든 목표예요 · 그룹장은 보관·삭제만 할 수 있어요";

/**
 * 누가 무엇을 할 수 있나 (스펙 §5.4).
 * 소유자(eligible = 그룹장이거나 ACTIVE 멤버 — Curriculum.personal.canAdd 와 같은 자격): 방 RECRUIT·ACTIVE 면 고치기·보관·삭제, ACTIVE 면 완료.
 * 보관된 목표는 고치기·완료 없음(TASK_ARCHIVED), 회차째 보관됐으면 여기서 해제할 수 없다(PARENT_ARCHIVED).
 * 그룹장(남의 것): 보관/해제, 삭제는 제출 없을 때만. 그 외: 없음.
 */
export function personalActions(n: LeafNode, meId: string | null, isLeader: boolean, roomStatus: RoomStatus, eligible = true): PersonalActions {
  const open = roomStatus === "recruit" || roomStatus === "active";
  if (!open || !meId) return { ...NONE };
  const canArchive = !n.archivedByParent;
  if (n.ownerId === meId) {
    if (!eligible) return { ...NONE };
    return { edit: !n.archived, complete: roomStatus === "active" && !n.archived, archive: canArchive, remove: true };
  }
  if (!isLeader) return { ...NONE };
  const hasSub = n.subAll > 0;
  return { edit: false, complete: false, archive: canArchive, remove: !hasSub, ...(hasSub ? { removeOff: "완료 기록이 있어 보관만 할 수 있어요" } : {}), note: LEADER_NOTE };
}

/** 개인 목표 상태 문구 — 완료는 "기한내 완료"/"늦게 완료", 마감 지난 미완료는 "기한 지남"(팀 "미제출" 아님 — 나중에 model.ts codeLabel 로 합친다) */
export function completeLabel(c: Code): string {
  if (c === "D") return "기한내 완료";
  if (c === "L") return "늦게 완료";
  if (c === "M") return "기한 지남";
  return CODE_LABEL[c];
}

export const isDone = (c: Code) => c === "D" || c === "L";

/** 소유자의 코드 — people = [소유자] (서버 task_node_json) */
export const ownerCode = (n: LeafNode): Code => (n.people.find((p) => p.userId === n.ownerId) ?? n.people[0])?.c ?? "P";

/** 상세 기간 줄 끝의 상태 — 완료·미완료는 코드로, 그 밖에는 기간 상태(시작 전 / 진행 중 · 마감 D-n) */
export function statusText(n: LeafNode, today: string): string {
  const c = ownerCode(n);
  return isDone(c) || c === "M" ? completeLabel(c) : roundStatus(n, today);
}

/** 상태 글자색 — 완료 초록, 미완료 호박 */
export const statusColor = (c: Code): string | undefined => (isDone(c) ? "#1A7F55" : c === "M" ? "#7A4F00" : undefined);

/** 삭제 확인 문구 (스펙 §4.6) — 그룹장·제출 있음은 삭제 자체가 없다(보관만) */
export const removeText = (n: LeafNode): string => (n.subAll > 0 ? "완료 기록과 제출 내용까지 함께 지워져요. 삭제할까요?" : "이 목표를 삭제할까요? 되돌릴 수 없어요.");

/** 편집 폼 값 */
export type PersonalDraft = { title: string; desc: string; s: string; e: string; roundId: string };
export const draftOf = (n: LeafNode): PersonalDraft => ({ title: n.title, desc: n.desc, s: n.s, e: n.e, roundId: n.roundId });

/** 바뀐 것만 personal_update 패치로. 제목은 앞뒤 공백을 뗀다(빈 제목 검사는 폼 몫) */
export function personalPatch(n: LeafNode, d: PersonalDraft): PersonalPatch {
  const p: PersonalPatch = {};
  const title = d.title.trim();
  if (title !== n.title) p.title = title;
  if (d.roundId !== n.roundId) p.roundId = d.roundId;
  if (d.s !== n.s) p.startDate = d.s;
  if (d.e !== n.e) p.endDate = d.e;
  if (d.desc !== n.desc) p.descriptionMd = d.desc;
  return p;
}

/** 편집 폼 회차 이동 미리보기 (시안 B-2) */
export function movePreview(label: string, period: { s: string; e: string } | null, sameRound: boolean): string {
  if (sameRound) return "";
  return period ? `${label}로 옮기면 기간이 ${md(period.s)} – ${md(period.e)} 로 바뀌어요` : `${label}로 옮겨도 기간은 그대로예요`;
}

/** 회차 기간 밖 경고 (서버 PERIOD_OUTSIDE_PARENT 와 같은 판정) — 소유자 상세·폼 위 */
export function roundWarning(n: { s: string; e: string }, round: { s: string; e: string } | null): string | null {
  if (!round || (n.s >= round.s && n.e <= round.e)) return null;
  return `회차 기간(${md(round.s)} – ${md(round.e)})을 벗어났어요`;
}

export type OwnerGroup = { ownerId: string; name: string; tone: Tone; items: LeafNode[]; done: number };

/** 회차 상세 "팀원 개인 목표" — 남의 것만, 소유자별(멤버 순서 → 서버 순서). 보관된 것은 그룹장에게만 */
export function groupOthers(round: ParentNode, meId: string | null, isLeader: boolean): OwnerGroup[] {
  const by = new Map<string, OwnerGroup & { rank: number }>();
  round.kids.forEach((k) => {
    if (!isPersonal(k) || !k.ownerId || k.ownerId === meId || (k.archived && !isLeader)) return;
    const owner = k.people.find((p) => p.userId === k.ownerId) ?? k.people[0];
    let g = by.get(k.ownerId);
    if (!g) {
      g = { ownerId: k.ownerId, name: owner?.name ?? "", tone: owner?.tone ?? "slate", items: [], done: 0, rank: k.ownerRank };
      by.set(k.ownerId, g);
    }
    g.items.push(k);
    if (isDone(ownerCode(k))) g.done += 1;
  });
  return [...by.values()].sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...g }) => g); // eslint-disable-line @typescript-eslint/no-unused-vars
}

/** 서버 오류 코드 → 스펙 §6 문구 (서버 문구보다 자세한 것만) */
export const PERSONAL_ERROR_TEXT: Record<string, string> = {
  SUBMISSION_HAS_CONTENT: "제출 내용이 있는 목표는 완료를 취소할 수 없어요 · 상세에서 확인해 주세요",
};
