/**
 * 개인 목표 상세·편집 폼·회차 상세 섹션의 순수 로직 (스펙 §4.5·§4.6·§5.4·§6). React 와 무관.
 */
import type { PersonalPatch } from "@/lib/api/personal";
import type { Tone } from "@/lib/palette";
import { rangeShort } from "@/lib/api/format";
import { CODE_COLOR, codeLabel, isDoneCode, isPersonal, roundStatus, type Code, type LeafNode, type ParentNode, type Person } from "./model";
import { movedPeriod } from "./rounds";
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
  // 이탈한 팀원의 보관 목표는 해제할 수 없다(서버 OWNER_NOT_ACTIVE — 해제해도 다시 보관된다)
  return { edit: false, complete: false, archive: canArchive && !(n.archived && n.ownerLeft), remove: !hasSub, ...(hasSub ? { removeOff: "완료 기록이 있어 보관만 할 수 있어요" } : {}), note: LEADER_NOTE };
}

export const isDone = isDoneCode;

/** 개인 목표 소유자 — people = [소유자] (서버 task_node_json). 진행목표·간트·상세·회차 섹션 공용 */
export const ownerOf = (n: LeafNode): Person | null => n.people.find((p) => p.userId === n.ownerId) ?? n.people[0] ?? null;

/** 소유자의 코드 */
export const ownerCode = (n: LeafNode): Code => ownerOf(n)?.c ?? "P";

/** 상세 기간 줄 끝의 상태 — 완료·미완료는 코드로, 그 밖에는 기간 상태(시작 전 / 진행 중 · 마감 D-n) */
export function statusText(n: LeafNode, today: string): string {
  const c = ownerCode(n);
  return isDone(c) || c === "M" ? codeLabel(n, c) : roundStatus(n, today);
}

/** 상태 글자색 — CODE_COLOR(보드·/tasks 와 같은 색): 기한내 초록 · 늦게 완료 호박 · 기한 지남 빨강. 진행·예정은 기본색 */
export const statusColor = (c: Code): string | undefined => (isDone(c) || c === "M" ? CODE_COLOR[c] : undefined);

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
export function movePreview(label: string, period: { s: string; e: string } | null, sameRound: boolean, today?: string): string {
  if (sameRound) return "";
  // 날짜 표기는 rangeShort (Q2-13 — 오늘과 다른 해면 연도). today 생략 = 기간 시작 해 기준
  return period ? `${label}로 옮기면 기간이 ${rangeShort(period.s, period.e, today ?? period.s)} 로 바뀌어요` : `${label}로 옮겨도 기간은 그대로예요`;
}

/**
 * 편집 폼에서 회차를 골랐을 때 새 값·미리보기. 같은 회차면 null.
 * 원래 회차로 되돌아오면 원래 기간을 복원한다(중간 회차 기준 movedPeriod 는 원래 날짜를 못 돌려줄 수 있다).
 * 그 밖에는 팀 과제 이동과 같은 규칙(movedPeriod, 고르기 전 회차 기준)으로 기간을 제안한다.
 */
export function pickRound(n: LeafNode, d: PersonalDraft, roots: ParentNode[], id: string, today?: string): { draft: PersonalDraft; note: string } | null {
  if (id === d.roundId) return null;
  const to = roots.find((r) => r.id === id);
  if (!to) return null;
  if (id === n.roundId) return { draft: { ...d, roundId: id, s: n.s, e: n.e }, note: "" };
  const from = roots.find((r) => r.id === d.roundId);
  const p = from ? movedPeriod({ s: d.s, e: d.e, subAll: 0 }, from, to) : null;
  return { draft: { ...d, roundId: id, ...(p ? { s: p.s, e: p.e } : {}) }, note: movePreview(to.label ?? to.title, p, false, today) };
}

/**
 * 편집 폼을 열 때 화면으로 끌어올리나 (QA Q1-8) — top = 상세 섹션 머리의 화면 기준 위치.
 * 위로 지나갔거나 화면 위쪽 40% 아래에 있으면(390: 방 머리·아코디언·탭 아래 약 600px) 맨 위로 맞춘다.
 */
export const formScrollNeeded = (top: number, viewportH: number): boolean => top < 0 || top > viewportH * 0.4;

/** 회차 기간 밖 경고 (서버 PERIOD_OUTSIDE_PARENT 와 같은 판정) — 소유자 상세·폼 위 */
export function roundWarning(n: { s: string; e: string }, round: { s: string; e: string } | null, today?: string): string | null {
  if (!round || (n.s >= round.s && n.e <= round.e)) return null;
  return `회차 기간(${rangeShort(round.s, round.e, today ?? round.s)})을 벗어났어요`;
}

/** items = 보이는 줄(그룹장에게는 보관 포함), count·done = 보관 제외 (personalStats 와 같은 기준) */
export type OwnerGroup = { ownerId: string; name: string; tone: Tone; items: LeafNode[]; count: number; done: number };

/** 회차 상세 "팀원 개인 목표" — 남의 것만, 소유자별(멤버 순서 → 서버 순서). 보관된 것은 그룹장에게만 */
export function groupOthers(round: ParentNode, meId: string | null, isLeader: boolean): OwnerGroup[] {
  const by = new Map<string, OwnerGroup & { rank: number }>();
  round.kids.forEach((k) => {
    if (!isPersonal(k) || !k.ownerId || k.ownerId === meId || (k.archived && !isLeader)) return;
    const owner = ownerOf(k);
    let g = by.get(k.ownerId);
    if (!g) {
      g = { ownerId: k.ownerId, name: owner?.name ?? "", tone: owner?.tone ?? "slate", items: [], count: 0, done: 0, rank: k.ownerRank };
      by.set(k.ownerId, g);
    }
    g.items.push(k);
    if (k.archived) return;
    g.count += 1;
    if (isDone(ownerCode(k))) g.done += 1;
  });
  return [...by.values()].sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...g }) => g); // eslint-disable-line @typescript-eslint/no-unused-vars
}

/** 회차 상세 머리 개수 — 보관 제외. mine = 내 것 n·완료 d, others = 팀원 것 n (보관된 줄은 보여도 세지 않는다) */
export function sectionCounts(round: ParentNode, meId: string | null, isLeader: boolean): { mine: { total: number; done: number }; others: number; othersArchived: number } {
  const mine = { total: 0, done: 0 };
  round.kids.forEach((k) => {
    if (!isPersonal(k) || k.archived || meId === null || k.ownerId !== meId) return;
    mine.total += 1;
    if (isDone(ownerCode(k))) mine.done += 1;
  });
  const groups = groupOthers(round, meId, isLeader);
  const others = groups.reduce((a, g) => a + g.count, 0);
  return { mine, others, othersArchived: groups.reduce((a, g) => a + g.items.length, 0) - others };
}

/** 팀원 개인 목표 소제목 — "팀원 개인 목표 {n}{unit}" + 그룹장에게 보이는 보관 목표가 있으면 " · 보관 {m}" (시안 C-2·C-4) */
export const othersHeading = (n: number, archived: number, unit = ""): string => `팀원 개인 목표 ${n}${unit}${archived > 0 ? ` · 보관 ${archived}` : ""}`;

/** 제출 카드(LeafBody) 다시 받기 판단. skip = 카드에서 처음 제출한 그때의 코드(from)와 노드(at) */
export type CardSkip = { from: Code; at: unknown } | null;
/**
 * 소유자 코드가 카드 밖(체크·토스트 "되돌리기"·회차 섹션)에서 바뀌면 카드를 다시 받는다(remount).
 * 카드에서 처음 제출해 바뀐 한 번은 카드가 이미 최신이라 건너뛴다 — 저장 직전 코드(from)에서 바뀐 경우에만.
 * 저장 뒤 새 노드가 왔는데 코드가 그대로면(재조회 실패·같은 코드) 건너뛰기를 잊는다 — 다음 바깥 변화는 다시 받는다.
 */
export function cardSync(seen: Code | null, code: Code | null, skip: CardSkip, node: unknown): { remount: boolean; skip: CardSkip } {
  if (code !== seen) return { remount: !(skip && seen === skip.from), skip: null };
  if (skip && node !== skip.at) return { remount: false, skip: null };
  return { remount: false, skip };
}

/** 서버 오류 코드 → 스펙 §6 문구 (서버 문구보다 자세한 것만) */
export const PERSONAL_ERROR_TEXT: Record<string, string> = {
  // 상세 안(완료 취소 버튼)·회차 섹션·/tasks 어디서 나도 맞는 문구 — 빠져나갈 방법(기록 비우기, QA Q1-2)까지 알린다
  SUBMISSION_HAS_CONTENT: "기록이 있는 목표는 완료를 취소할 수 없어요 · 상세의 기록에서 내용·링크·파일을 모두 비워 저장한 뒤 취소해 주세요",
};
/** 개인 목표 RPC 실패 문구 — my-study·/tasks 공용 (같은 오류는 같은 문구) */
export const personalErrorText = (e: { code: string; message: string }): string => PERSONAL_ERROR_TEXT[e.code] ?? e.message;
