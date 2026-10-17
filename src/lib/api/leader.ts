import { rpc, type ApiError, type Db } from "@/lib/api/errors";
import { ymd } from "@/lib/api/format";
import type { MembershipResult, Person, RoomDetail, RoomStatusDto } from "@/lib/api/types";

/* 그룹장 패널(plan 06 P0) — 상태 액션 · 초대 링크 · 승인 대기. 모든 RPC 는 그룹장 전용(NOT_LEADER) */

export type Applicant = Person & { appliedAt: string };
export type Applications = { today: string; items: Applicant[] };
export type InviteLink = { today: string; token: string; url: string };
export type StartWarning = { code: "UNASSIGNED_TASK"; nodeId: string };

export const openRecruit = (slug: string, client?: Db) => rpc<RoomDetail>("room_open_recruit", { p_slug: slug }, client);
export const startRoom = (slug: string, client?: Db) => rpc<RoomDetail & { warnings: StartWarning[] }>("room_start", { p_slug: slug }, client);
export const fetchInvite = (slug: string, client?: Db) => rpc<InviteLink>("invite_get", { p_slug: slug }, client);
export const rotateInvite = (slug: string, client?: Db) => rpc<InviteLink>("invite_rotate", { p_slug: slug }, client);
export const fetchApplications = (slug: string, client?: Db) => rpc<Applications>("room_applications", { p_slug: slug }, client);
export const approveApplicant = (slug: string, userId: string, client?: Db) => rpc<MembershipResult>("room_approve", { p_slug: slug, p_user: userId }, client);
/** 종료일만 바꾼다(room_update, 그룹장 전용). 모집 전·중엔 1년 상한, 진행중엔 오늘·마지막 과제 마감 이후만 — 서버가 검사 */
export const updateRoomEndDate = (slug: string, endDate: string, client?: Db) =>
  rpc<RoomDetail & { warnings: { code: string; nodeId: string }[] }>("room_update", { p_slug: slug, p_patch: { endDate } }, client);
export const rejectApplicant = (slug: string, userId: string, client?: Db) => rpc<MembershipResult>("room_reject", { p_slug: slug, p_user: userId }, client);

export type StatusAction = "openRecruit" | "start";

/** 준비중 → 모집 시작, 모집중 → 지금 시작, 진행중·종료(·보관) → 없음 */
export function statusActionOf(d: Pick<RoomDetail, "status" | "archived">): StatusAction | null {
  if (d.archived) return null;
  if (d.status === "draft") return "openRecruit";
  if (d.status === "recruit") return "start";
  return null;
}

/** 모집 시작 버튼 아래 안내 — 공개 범위·참가 방식에 따라 누가 어떻게 들어오는지 */
export function openRecruitNote(d: Pick<RoomDetail, "isPublic" | "joinMode">): string {
  const who = d.isPublic ? "전체 공개 방 목록에 보이고 누구나" : "목록에는 안 보이고 초대 링크를 받은 사람만";
  return `${who} ${d.joinMode === "approval" ? "참가 신청할 수 있어요 · 신청은 여기서 승인해요" : "바로 참가할 수 있어요"}`;
}

/** 승인 대기 목록을 보여 줄지 — 모집중이고 승인제이거나, 대기자가 남아 있을 때(참가 방식을 바꾼 뒤에도 처리할 수 있게) */
export const showApplications = (d: Pick<RoomDetail, "status" | "joinMode" | "pendingCount" | "archived">) =>
  !d.archived && d.status === "recruit" && (d.joinMode === "approval" || d.pendingCount > 0);

/** /invite/{token} → 이 사이트의 절대 주소 */
export const absoluteUrl = (path: string, origin: string) => new URL(path, origin).href;

const STATUS_STEP: Record<RoomStatusDto, string> = { draft: "준비중", recruit: "모집중", active: "진행중", ended: "종료" };
export const statusStepLabel = (s: RoomStatusDto) => STATUS_STEP[s];

/** 그룹장 패널 RPC 오류 → 토스트 문구. 서버 한국어 문구가 있으면 그대로, 몇몇 코드는 다음 할 일까지 */
export function leaderErrorText(code: string, message: string): string {
  switch (code) {
    case "ROOM_NO_LEAF_TASK":
      return "진행목표에 과제를 1개 이상 만들어야 모집을 시작할 수 있어요";
    case "ROOM_STATUS_INVALID":
      return "방 상태가 바뀌었어요 · 새로고침해 주세요";
    case "ROOM_FULL":
      return "정원이 가득 차서 승인할 수 없어요";
    case "ALREADY_DECIDED":
      return "이미 처리된 신청이에요";
    case "ROOM_NOT_RECRUITING":
      return "모집중인 방에서만 신청을 처리할 수 있어요";
    default:
      return message || "처리하지 못했어요 · 잠시 후 다시 시도해 주세요";
  }
}

/**
 * "지금 시작"이 기간 1년 상한에 막혔나 (0016: 예정보다 일찍 시작하면 시작일이 오늘로 당겨져 기간이 늘어난다 → PERIOD_TOO_LONG).
 * 막혔으면 전용 문구와 줄여야 할 종료일 상한(서버 detail.maxEndDate) — 그룹장 패널이 종료일 바꾸기로 잇는다. 그 밖의 오류는 null
 */
export function startBlockOf(err: ApiError): { text: string; maxEndDate: string | null } | null {
  if (err.code !== "PERIOD_TOO_LONG") return null;
  const max = err.details?.maxEndDate ?? null;
  return { text: `지금 시작하면 기간이 1년을 넘어요 · 종료일을 ${max ? `${ymd(max)}까지로 ` : ""}앞당긴 뒤 시작해 주세요`, maxEndDate: max };
}
