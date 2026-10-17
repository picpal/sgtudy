import { rpc } from "@/lib/api/errors";
import type { RoomDetail } from "@/lib/api/types";
import { validateNewRoom, type NewRoomValues } from "@/components/room-new/validate";

/**
 * 방 설정 (QA Q3-1·Q2-2) — 방 만들기 폼과 같은 값 모양(NewRoomValues). 서버 규칙(0018 room_update · 0004 room_delete/room_archive)을 그대로 비춘다:
 * - 준비중·모집중: 모두 수정, 삭제 가능
 * - 진행중: 시작일·최소 인원·공개·참가 방식·그룹장 과제 수행은 잠김, 종료일은 오늘(과 마지막 과제 마감) 이후로만. 삭제 대신 보관
 * - 종료·보관: 수정 불가. 종료는 보관, 보관은 풀기만
 */
type Src = Pick<RoomDetail, "title" | "intro" | "descriptionMd" | "rulesMd" | "startDate" | "endDate" | "maxMembers" | "minMembers" | "isPublic" | "joinMode" | "leaderDoesTasks">;
type State = Pick<RoomDetail, "status" | "archived">;
type Field = keyof NewRoomValues;

export function valuesOf(d: Src): NewRoomValues {
  return {
    title: d.title, intro: d.intro, descriptionMd: d.descriptionMd ?? "", rulesMd: d.rulesMd ?? "", startDate: d.startDate, endDate: d.endDate,
    maxMembers: String(d.maxMembers), minMembers: d.minMembers === null ? "" : String(d.minMembers), isPublic: d.isPublic, joinMode: d.joinMode, leaderDoesTasks: d.leaderDoesTasks,
  };
}

const ALL: Field[] = ["title", "intro", "descriptionMd", "rulesMd", "startDate", "endDate", "maxMembers", "minMembers", "isPublic", "joinMode", "leaderDoesTasks"];
const ACTIVE_LOCKED: Field[] = ["startDate", "minMembers", "isPublic", "joinMode", "leaderDoesTasks"];

export function lockedOf(d: State): Set<Field> {
  if (d.archived || d.status === "ended") return new Set(ALL);
  if (d.status === "active") return new Set(ACTIVE_LOCKED);
  return new Set();
}

/** 잠긴 칸 아래 한 줄 — 왜 못 바꾸는지 */
export function lockReason(d: State): string {
  if (d.archived) return "보관된 방은 고칠 수 없어요 · 보관을 풀면 다시 고칠 수 있어요";
  if (d.status === "ended") return "종료된 방은 고칠 수 없어요";
  if (d.status === "active") return "진행중에는 바꿀 수 없어요";
  return "";
}

const num = (s: string) => Number(s.trim());

/** 바뀐 칸만 room_update patch(camelCase)로. 문자열은 trim 해서 비교 — 안 바뀐 기간은 보내지 않는다(서버가 기간을 바꿀 때만 검사) */
export function buildPatch(initial: NewRoomValues, v: NewRoomValues): Record<string, string | number | boolean | null> {
  const p: Record<string, string | number | boolean | null> = {};
  for (const k of ["title", "intro", "descriptionMd", "rulesMd"] as const) if (v[k].trim() !== initial[k].trim()) p[k] = v[k].trim();
  for (const k of ["startDate", "endDate"] as const) if (v[k] !== initial[k]) p[k] = v[k];
  if (v.maxMembers.trim() !== initial.maxMembers.trim()) p.maxMembers = num(v.maxMembers);
  if (v.minMembers.trim() !== initial.minMembers.trim()) p.minMembers = v.minMembers.trim() ? num(v.minMembers) : null;
  for (const k of ["isPublic", "joinMode", "leaderDoesTasks"] as const) if (v[k] !== initial[k]) p[k] = v[k];
  return p;
}

/** 방 만들기 검사를 쓰되, 기간은 바꿨을 때만 본다. 진행중 종료일은 오늘 이후, 최대 인원은 지금 참가자 수 이상 */
export function validateSettings(initial: NewRoomValues, v: NewRoomValues, today: string, d: State & Pick<RoomDetail, "memberCount">): Partial<Record<Field, string>> {
  const e = validateNewRoom(v, today);
  const startChanged = v.startDate !== initial.startDate;
  const endChanged = v.endDate !== initial.endDate;
  if (!startChanged) delete e.startDate;
  if (!startChanged && !endChanged) delete e.endDate;
  if (d.status === "active" && endChanged && !e.endDate && v.endDate < today) e.endDate = "진행중에는 종료일을 오늘 이후로만 바꿀 수 있어요";
  const max = num(v.maxMembers);
  if (!e.maxMembers && Number.isFinite(max) && max < d.memberCount) e.maxMembers = `지금 참가자(${d.memberCount}명)보다 적게 줄일 수 없어요`;
  return e;
}

export type Danger = "delete" | "archive" | "unarchive";
export function dangerOf(d: State): Danger {
  if (d.archived) return "unarchive";
  return d.status === "draft" || d.status === "recruit" ? "delete" : "archive";
}

/* ── RPC (그룹장 전용 — 서버가 NOT_LEADER·상태를 다시 검사) ── */
export const updateRoom = (slug: string, patch: Record<string, unknown>) => rpc<RoomDetail>("room_update", { p_slug: slug, p_patch: patch });
export const deleteRoom = (slug: string) => rpc<null>("room_delete", { p_slug: slug });
export const archiveRoom = (slug: string, archived: boolean) => rpc<RoomDetail>(archived ? "room_archive" : "room_unarchive", { p_slug: slug });
