import { rpc, type Db } from "@/lib/api/errors";
import { dateShort } from "@/lib/api/format";
import type { MembershipResult, Person, RoomMemberDto } from "@/lib/api/types";
import { kstToday } from "@/lib/kst";

/* 시나리오 QA D3 — 진행 중 나가기 (0024 계약 §3).
 * 멤버: 탈퇴 요청·취소 → 그룹장: 요청 목록에서 내보내기(기존 member_deactivate_preview → 재배정 결정 → member_deactivate) 또는 반려.
 * 제출 기록은 남는다(서버). 모집 중 참가 취소는 기존 room_leave 그대로 */

export type LeaveRequestItem = Person & { requestedAt: string; reason: string | null; pendingTaskCount: number };
export type LeaveRequests = { today: string; items: LeaveRequestItem[] };
export type DeactivateTask = { nodeId: string; title: string; roundLabel: string | null; currentAssignees: Person[] };
export type DeactivatePreview = { today: string; tasks: DeactivateTask[] };
/** 0027: unassign = 이 사람만 빼고 재지정하지 않는다(담당 0명 = 담당 미정 허용) */
export type LeaveDecision = { nodeId: string; action: "exclude" | "unassign" } | { nodeId: string; action: "reassign"; assigneeIds: string[] };

const reasonOf = (r?: string | null) => r?.trim() || null;

export const requestLeave = (slug: string, reason?: string | null, client?: Db) =>
  rpc<MembershipResult>("member_leave_request", { p_slug: slug, p_reason: reasonOf(reason) }, client);
export const cancelLeaveRequest = (slug: string, client?: Db) => rpc<MembershipResult>("member_leave_request_cancel", { p_slug: slug }, client);
export const fetchLeaveRequests = (slug: string, client?: Db) => rpc<LeaveRequests>("room_leave_requests", { p_slug: slug }, client);
export const dismissLeaveRequest = (slug: string, userId: string, client?: Db) =>
  rpc<LeaveRequests>("member_leave_request_dismiss", { p_slug: slug, p_user: userId }, client);
export const previewDeactivate = (slug: string, userId: string, client?: Db) =>
  rpc<DeactivatePreview>("member_deactivate_preview", { p_slug: slug, p_user: userId }, client);
export const deactivateMember = (slug: string, userId: string, decisions: LeaveDecision[], client?: Db) =>
  rpc<MembershipResult>("member_deactivate", { p_slug: slug, p_user: userId, p_decisions: decisions }, client);

/** 요청 시각(ISO) → KST 날짜(앱 날짜 규칙 dateShort) */
export const requestedOn = (iso: string, today: string): string => dateShort(kstToday(new Date(iso)), today);

/** 재배정 후보 — 내보낼 사람을 뺀 참가 중 팀원. 그룹장은 과제를 하는 방(leaderDoesTasks)일 때만 (서버 ASSIGNEE_NOT_MEMBER 와 같은 규칙) */
export const reassignCandidates = (members: RoomMemberDto[], target: string, leaderDoesTasks: boolean): Person[] =>
  members
    .filter((x) => x.status === "active" && x.userId !== target && (x.role === "member" || leaderDoesTasks))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "leader" ? -1 : 1))
    .map(({ userId, nickname, tone }) => ({ userId, nickname, tone }));

/** 과제별 선택 값: "exclude"(담당에서 빼기) | "unassign"(담당 미정으로 두기) | userId(이 사람에게 맡기기) | ""(아직 안 고름) */
export type LeaveChoices = Record<string, string>;

/**
 * 다른 담당자가 있으면 빼기만 해도 된다 → 기본 "exclude". 혼자 맡은 과제는 맡길 사람을 고르게 비워 두고,
 * 맡길 사람이 아예 없으면 "unassign"(담당 미정, 0027)을 기본으로 — 내보내기가 막히지 않게
 */
export const initialChoices = (p: DeactivatePreview, candidatesOf: (t: DeactivateTask) => Person[] = () => [{} as Person]): LeaveChoices =>
  Object.fromEntries(p.tasks.map((t) => [t.nodeId, t.currentAssignees.length > 0 ? "exclude" : candidatesOf(t).length === 0 ? "unassign" : ""]));

export const missingChoices = (p: DeactivatePreview, c: LeaveChoices): string[] => p.tasks.filter((t) => !c[t.nodeId]).map((t) => t.nodeId);

export const decisionsOf = (p: DeactivatePreview, c: LeaveChoices): LeaveDecision[] =>
  p.tasks.map((t) =>
    c[t.nodeId] === "exclude" || c[t.nodeId] === "unassign" ? { nodeId: t.nodeId, action: c[t.nodeId] as "exclude" | "unassign" } : { nodeId: t.nodeId, action: "reassign", assigneeIds: [c[t.nodeId]] },
  );

/** 탈퇴 요청·내보내기 RPC 오류 → 토스트 문구 */
export function leaveErrorText(code: string, message: string): string {
  switch (code) {
    case "LEAVE_ALREADY_REQUESTED":
      return "이미 탈퇴를 요청했어요 · 그룹장이 처리할 때까지 기다려 주세요";
    case "REASSIGN_REQUIRED":
      return "담당자가 없어지는 과제는 다른 참가자에게 맡기거나 담당 미정으로 두기를 골라 주세요";
    case "LEAVE_DECISION_MISSING":
      return "미제출 과제마다 처리 방법을 골라 주세요 · 그새 과제가 바뀌었을 수 있어요";
    case "ASSIGNEE_NOT_MEMBER":
      return "참가 중인 팀원에게만 맡길 수 있어요 · 목록을 새로 불러와 주세요";
    case "MEMBER_NOT_ACTIVE":
      return "이미 참가 중이 아닌 멤버예요";
    default:
      return message || "처리하지 못했어요 · 잠시 후 다시 시도해 주세요";
  }
}
