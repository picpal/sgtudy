import { rpc, type Db } from "@/lib/api/errors";
import { closedAction } from "@/lib/api/room-view";
import type { InvitePreview, MembershipResult } from "@/lib/api/types";

export type InviteAction = "login" | "owner" | "joined" | "pending" | "inactive" | "ended" | "activeClosed" | "full" | "apply" | "join";

export const fetchInvitePreview = (token: string, client?: Db) => rpc<InvitePreview>("invite_preview", { p_token: token }, client);
/** message: 승인제 방이면 참가 신청 한마디로 전달(바로 참가 방은 서버가 무시 — 0024 D4) */
export const joinByInvite = (token: string, message?: string, client?: Db) => rpc<MembershipResult>("invite_join", { p_token: token, p_message: message?.trim() || null }, client);

/** 03-api §3 CTA 결정 순서. 초대 화면은 '참가 취소' 를 제공하지 않으므로 active 멤버는 모두 joined.
 *  비로그인이라도 종료·진행중·정원 마감이면 로그인 대신 그 상태를 먼저 보여 준다 (Q2-11). */
export function inviteActionOf(p: InvitePreview): InviteAction {
  const r = p.room;
  if (!p.me) return closedAction(r) ?? "login";
  if (p.me.state === "leader") return "owner";
  if (p.me.state === "active") return "joined";
  if (p.me.state === "pending") return "pending";
  // 이탈 처리된 멤버는 서버가 MEMBER_NOT_ACTIVE 로 막는다 → 참가 버튼 대신 비활성 안내
  if (p.me.state === "inactive") return "inactive";
  return closedAction(r) ?? (r.joinMode === "approval" ? "apply" : "join");
}
