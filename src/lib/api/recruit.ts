import { rpc, type Db } from "@/lib/api/errors";
import { addDays } from "@/lib/date";
import { mmdd } from "@/lib/api/format";
import type { InviteLink } from "@/lib/api/leader";
import type { JoinMode, RoomDetail } from "@/lib/api/types";

/* 추가 모집 · 초대 코드(0032). 쓰기 RPC 는 모두 그룹장 전용 — 서버가 다시 검사한다 */

export const openExtraRecruit = (slug: string, v: { until: string; maxMembers: number; joinMode: JoinMode }, client?: Db) =>
  rpc<RoomDetail>("room_extra_recruit_open", { p_slug: slug, p_until: v.until, p_max_members: v.maxMembers, p_join_mode: v.joinMode }, client);
export const closeExtraRecruit = (slug: string, client?: Db) => rpc<RoomDetail>("room_extra_recruit_close", { p_slug: slug }, client);
/** until null = 끄기 */
export const setInviteBypass = (slug: string, until: string | null, max: number | null, client?: Db) =>
  rpc<InviteLink>("invite_bypass_set", { p_slug: slug, p_until: until, p_max: max }, client);
export type CodeLookup = { found: true; url: string } | { found: false; remaining: number };
export const lookupInviteCode = (code: string, client?: Db) => rpc<CodeLookup>("invite_code_lookup", { p_code: code }, client);

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** SQL invite_code_norm 과 같은 규칙 */
export const normalizeCode = (s: string) => s.replace(/[\s-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
export const isCodeShape = (s: string) => CODE_RE.test(normalizeCode(s));
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4, 8)}`;
/** 입력 중 표시 — 정규화 후 8자에서 자르고 4자 뒤 하이픈 */
export function codeInputView(raw: string): string {
  const c = normalizeCode(raw).replace(/[^0-9A-Z]/g, "").slice(0, 8);
  return c.length > 4 ? formatCode(c) : c;
}

type RecruitSrc = Pick<RoomDetail, "today" | "endDate" | "maxMembers" | "memberCount" | "joinMode">;
/** 마감일 상한 = min(종료일, 오늘+30) (서버와 같은 규칙) */
export const recruitMaxDate = (d: Pick<RoomDetail, "today" | "endDate">) => {
  const cap = addDays(d.today, 30);
  return d.endDate < cap ? d.endDate : cap;
};
/** 처음 열 때 기본값: 마감 오늘+7(상한 안), 정원은 빈자리가 1개 이상 되게, 방식은 지금 방식 */
export function extraRecruitDefaults(d: RecruitSrc): { until: string; maxMembers: number; joinMode: JoinMode } {
  const week = addDays(d.today, 7);
  const max = recruitMaxDate(d);
  return { until: week < max ? week : max, maxMembers: Math.max(d.maxMembers, d.memberCount + 1), joinMode: d.joinMode };
}

export const extraRecruitNote = (d: Pick<RoomDetail, "isPublic">) =>
  (d.isPublic ? "공개 방이라 둘러보기에 '추가 모집'으로 보여요." : "비공개 방이라 목록에는 안 보여요 · 초대 링크·코드를 받은 사람만 참가할 수 있어요.") +
  " 들어온 사람은 오늘 이후 마감인 공통 과제부터 맡아요";

/** 그룹장 패널 초대 행 안내 */
export function inviteNote(d: Pick<RoomDetail, "status" | "isPublic" | "invite"> & { recruit?: RoomDetail["recruit"] }): string {
  const b = d.invite?.bypass;
  if (b?.active) return `${mmdd(b.until)}까지 이 링크·코드로 바로 참가할 수 있어요`;
  if (d.status === "draft") return "모집을 시작하면 이 링크로 들어올 수 있어요";
  if (d.status === "active" && !d.recruit?.open) return "진행중이라 지금은 이 링크로 참가할 수 없어요 · 방 설정에서 추가 모집이나 바로 참가를 켜 주세요";
  return d.isPublic ? "링크를 받은 사람은 바로 이 방으로 와요" : "비공개 방이라 이 링크를 받은 사람만 들어올 수 있어요";
}

export function recruitErrorText(code: string, message: string): string {
  switch (code) {
    case "CAPACITY_NO_SEAT": return "빈자리가 없어요 · 정원을 늘려 주세요";
    case "INVITE_EXPIRED": return "바로 참가 기한이 끝났거나 인원이 찼어요 · 그룹장에게 문의해 주세요";
    case "ROOM_NOT_RECRUITING": return "방금 모집이 마감됐어요 · 그룹장에게 새 초대를 받아 주세요";
    case "RATE_LIMITED": return "코드를 너무 많이 틀렸어요 · 1시간 뒤에 다시 시도해 주세요";
    default: return message || "처리하지 못했어요 · 잠시 후 다시 시도해 주세요";
  }
}
