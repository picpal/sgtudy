import { rpc, type ApiError, type Db } from "@/lib/api/errors";
import { mmdd, ymd } from "@/lib/api/format";
import { diffDays } from "@/lib/date";
import type { MembershipResult, Person, RoomDetail, RoomStatusDto } from "@/lib/api/types";

/* 그룹장 패널(plan 06 P0) — 상태 액션 · 초대 링크 · 승인 대기. 모든 RPC 는 그룹장 전용(NOT_LEADER) */

/** message: 참가 신청 한마디(0024 D4 — 없으면 null) */
export type Applicant = Person & { appliedAt: string; message?: string | null };
export type Applications = { today: string; items: Applicant[] };
export type InviteLink = { today: string; token: string; url: string };
/** room_start 경고 — 담당자 없는 지정 과제 · (일정을 당겼을 때) 방 기간 밖 노드 */
export type StartWarning = { code: "UNASSIGNED_TASK" | "PERIOD_OUTSIDE_ROOM" | (string & {}); nodeId: string };
/** 0024 D1 — 실제로 당긴 날수(0 = 안 당김)·옮긴 노드 수(보관 포함) */
export type StartShift = { days: number; nodes: number };
export type StartResult = RoomDetail & { warnings: StartWarning[]; shift?: StartShift };

export const openRecruit = (slug: string, client?: Db) => rpc<RoomDetail>("room_open_recruit", { p_slug: slug }, client);
/** shift: 예정보다 일찍 시작할 때 일정(회차·과제·개인 목표·종료일)을 오늘로 당긴다 (0024·0025). 안 주면 지금과 같다(일정 그대로) */
export const startRoom = (slug: string, opts: { shift?: boolean } = {}, client?: Db) =>
  rpc<StartResult>("room_start", opts.shift ? { p_slug: slug, p_shift: true } : { p_slug: slug }, client);
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

/** 예정 시작일보다 며칠 일찍 시작하나 — 모집중이고 오늘 < 시작일일 때만 (그때만 "일정을 당길지" 묻는다) */
export const earlyStartDays = (d: Pick<RoomDetail, "status" | "today" | "startDate">): number =>
  d.status === "recruit" ? Math.max(0, diffDays(d.today, d.startDate)) : 0;

/** "지금 시작" 확인 창의 두 선택지 (시나리오 QA D1 — 기본값은 당기기) */
export function shiftChoiceText(days: number, startDate: string): Record<"shift" | "keep", { label: string; note: string }> {
  return {
    shift: { label: "일정을 오늘부터 당기기", note: `모든 회차·과제·개인 목표와 종료일도 ${days}일 당겨져요 · 전체 기간은 그대로예요` },
    keep: { label: "일정 그대로", note: `시작일만 오늘로 바뀌어요 · ${mmdd(startDate)} 전까지는 진행 중인 회차가 없어요` },
  };
}

/** 시작 성공 토스트 — 당긴 날수 + 담당자 없는 지정 과제 수 (기간 밖 경고는 개요의 기간 경고 줄이 따로 보인다) */
export function startDoneText(r: Pick<StartResult, "warnings" | "shift">): string {
  const unassigned = r.warnings.filter((w) => w.code === "UNASSIGNED_TASK").length;
  const days = r.shift?.days ?? 0;
  return ["스터디를 시작했어요", days > 0 ? `일정을 ${days}일 당겼어요` : "", unassigned > 0 ? `담당자 없는 과제 ${unassigned}개` : ""].filter(Boolean).join(" · ");
}

/* ---------- 방 알림 설정 (settings_get/put — 그룹장 전용, 방 참가자 모두에게 적용. 0025 submissionDigest) ---------- */
export type NotifySettings = {
  reminderD1: boolean;
  reminderD3: boolean;
  taskAssigned: boolean;
  scheduleChanged: boolean;
  roomStartEnd: boolean;
  completionMode: "daily" | "immediate";
  submissionDigest: boolean;
};
export type NotifyToggleKey = Exclude<keyof NotifySettings, "completionMode">;

export const fetchNotifySettings = (slug: string, client?: Db) => rpc<NotifySettings>("settings_get", { p_slug: slug }, client);
/** 전체 교체 — 서버는 6키 필수 + submissionDigest 선택 */
export const putNotifySettings = (slug: string, s: NotifySettings, client?: Db) => rpc<NotifySettings>("settings_put", { p_slug: slug, p_settings: s }, client);

export const NOTIFY_ROWS: { key: NotifyToggleKey; title: string; desc: string }[] = [
  { key: "reminderD3", title: "마감 3일 전 알림", desc: "아직 제출하지 않은 담당자에게 알려요" },
  { key: "reminderD1", title: "마감 하루 전 알림", desc: "아직 제출하지 않은 담당자에게 알려요" },
  { key: "taskAssigned", title: "담당 지정·해제 알림", desc: "지정 과제 담당이 바뀐 사람에게 알려요" },
  { key: "scheduleChanged", title: "일정 변경 알림", desc: "과제·회차·방 기간이 바뀌면 참가자에게 알려요" },
  { key: "roomStartEnd", title: "스터디 시작·종료 알림", desc: "스터디가 시작되거나 끝나면 참가자에게 알려요" },
  { key: "submissionDigest", title: "팀원 제출 하루 요약", desc: "어제 들어온 팀원 제출을 매일 오전 9시에 그룹장에게 한 번에 알려요" },
];
