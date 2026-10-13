import { rpc, type Db } from "@/lib/api/errors";
import type { InvitePreview, MembershipResult } from "@/lib/api/types";

export type InviteAction = "login" | "owner" | "joined" | "pending" | "inactive" | "ended" | "activeClosed" | "full" | "apply" | "join";

export const fetchInvitePreview = (token: string, client?: Db) => rpc<InvitePreview>("invite_preview", { p_token: token }, client);
export const joinByInvite = (token: string) => rpc<MembershipResult>("invite_join", { p_token: token });

/** 03-api §3 CTA 결정 순서. 초대 화면은 '참가 취소' 를 제공하지 않으므로 active 멤버는 모두 joined. */
export function inviteActionOf(p: InvitePreview): InviteAction {
  const r = p.room;
  if (!p.me) return "login";
  if (p.me.state === "leader") return "owner";
  if (p.me.state === "active") return "joined";
  if (p.me.state === "pending") return "pending";
  // 이탈 처리된 멤버는 서버가 MEMBER_NOT_ACTIVE 로 막는다 → 참가 버튼 대신 비활성 안내
  if (p.me.state === "inactive") return "inactive";
  if (r.status === "ended") return "ended";
  if (r.status === "active") return "activeClosed";
  if (r.memberCount >= r.maxMembers) return "full";
  return r.joinMode === "approval" ? "apply" : "join";
}
