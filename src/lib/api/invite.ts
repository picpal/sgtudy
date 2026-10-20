import { rpc, type Db } from "@/lib/api/errors";
import { closedAction } from "@/lib/api/room-view";
import type { InvitePreview, MembershipResult } from "@/lib/api/types";

export type InviteAction = "login" | "owner" | "joined" | "pending" | "inactive" | "ended" | "activeClosed" | "full" | "apply" | "join";

export const fetchInvitePreview = (token: string, client?: Db) => rpc<InvitePreview>("invite_preview", { p_token: token }, client);
/** message: 승인제 방이면 참가 신청 한마디로 전달(바로 참가 방은 서버가 무시 — 0024 D4) */
export const joinByInvite = (token: string, message?: string, client?: Db) => rpc<MembershipResult>("invite_join", { p_token: token, p_message: message?.trim() || null }, client);

/** 03-api §3 CTA 결정 순서. 초대 화면은 '참가 취소' 를 제공하지 않으므로 active 멤버는 모두 joined.
 *  비로그인이라도 종료·진행중·정원 마감이면 로그인 대신 그 상태를 먼저 보여 준다 (Q2-11). */
/** 0032: 서버 join 을 따른다. join 이 없으면(0032 전 응답) 기존 규칙 */
function inviteClosed(p: InvitePreview): "ended" | "activeClosed" | "full" | null {
  const r = p.room;
  if (!p.join) return closedAction(r);
  if (!p.join.mode) return r.status === "ended" ? "ended" : "activeClosed";
  return r.memberCount >= r.maxMembers ? "full" : null;
}

export function inviteActionOf(p: InvitePreview): InviteAction {
  const r = p.room;
  if (!p.me) return inviteClosed(p) ?? "login";
  if (p.me.state === "leader") return "owner";
  if (p.me.state === "active") return "joined";
  // 바로 참가 초대면 승인 대기 중이어도 바로 참가로 승격된다(서버 room_join_by_invite)
  if (p.me.state === "pending") return p.join?.via === "invite" && p.join.mode ? inviteClosed(p) ?? "join" : "pending";
  // 이탈 처리된 멤버는 서버가 MEMBER_NOT_ACTIVE 로 막는다 → 참가 버튼 대신 비활성 안내
  if (p.me.state === "inactive") return "inactive";
  const mode = p.join ? p.join.mode : r.joinMode;
  return inviteClosed(p) ?? (mode === "approval" ? "apply" : "join");
}
