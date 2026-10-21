import { rpc, type ApiError, type Db } from "./errors";
import type { Notice, NoticeInbox, NoticeInput, NoticeList, NoticePatch } from "./types";

/* 그룹장 공지 어댑터 (0040_room_notices.sql). 컴포넌트는 이 파일만 부른다 */
const num = (id: string) => Number(id);

/** 서버 notice_validate 와 같은 상한 — 폼 사전 검사·카운터용 */
export const NOTICE_LIMITS = { title: 80, bodyMd: 10_000 } as const;

export const fetchNotices = (slug: string, client?: Db) => rpc<NoticeList>("notice_list", { p_slug: slug }, client);
export const fetchNoticeInbox = (slug: string, client?: Db) => rpc<NoticeInbox>("notice_inbox", { p_slug: slug }, client);
export const createNotice = (slug: string, input: NoticeInput, client?: Db) =>
  rpc<Notice>("notice_create", { p_slug: slug, p_input: input }, client);
export const updateNotice = (slug: string, id: string, patch: NoticePatch, client?: Db) =>
  rpc<Notice>("notice_update", { p_slug: slug, p_id: num(id), p_patch: patch }, client);
export const deleteNotice = (slug: string, id: string, client?: Db) =>
  rpc<null>("notice_delete", { p_slug: slug, p_id: num(id) }, client).then(() => undefined);
/** 팝업 [확인]·탭 펼침 공용(멱등). 다른 방·지워진 id 는 서버가 건너뛴다. 응답 unread → 탭 미읽음 점 */
export const markNoticesRead = (slug: string, ids: string[], client?: Db) =>
  rpc<{ unread: boolean }>("notice_read", { p_slug: slug, p_ids: ids.map(num) }, client);

/** 저장 전 클라이언트 검증 — 서버 notice_validate 와 같은 규칙·문구. 첫 오류만 */
export function validateNotice(v: Pick<NoticeInput, "title" | "bodyMd">): { field: "title" | "bodyMd"; text: string } | null {
  const t = v.title.trim().length;
  if (t < 1 || t > NOTICE_LIMITS.title) return { field: "title", text: "제목은 1~80자예요" };
  if (v.bodyMd.trim() === "" || v.bodyMd.length > NOTICE_LIMITS.bodyMd) return { field: "bodyMd", text: "본문은 1~10,000자예요" };
  return null;
}

/** 0040 오류 코드 기본 문구(서버 문구가 정본 — 문구가 비었을 때만) */
export const NOTICE_ERROR_KO: Record<string, string> = {
  NOTICE_NOT_FOUND: "공지를 찾을 수 없어요 · 이미 삭제됐을 수 있어요",
  NOTICE_LIMIT: "공지 개수 상한에 닿았어요",
  ROOM_NOT_EDITABLE: "종료되었거나 보관된 방은 편집할 수 없어요",
  NOT_LEADER: "그룹장만 할 수 있어요",
  NOT_MEMBER: "참가 중인 방이 아니에요",
  ROOM_NOT_FOUND: "방을 찾을 수 없어요",
  VALIDATION_FAILED: "입력 내용을 확인해 주세요",
};
/** NOTICE_LIMIT details.kind 별 문구(스펙 §6.6) */
const LIMIT_KO: Record<string, string> = {
  total: "공지는 100개까지예요",
  pinned: "고정은 3개까지예요",
  popup: "팝업 공지는 5개까지예요 · 오래된 공지의 팝업을 꺼 주세요",
};

/** notice_* 실패 → 화면 문구 */
export function noticeErrorText(e: ApiError): string {
  if (e.code === "NOTICE_LIMIT" && e.details?.kind && LIMIT_KO[e.details.kind]) return LIMIT_KO[e.details.kind];
  if (e.code === "NOT_MEMBER" && e.details?.state === "pending") return "참가가 승인되면 공지를 볼 수 있어요";
  if (e.message && e.message !== e.code) return e.message;
  return NOTICE_ERROR_KO[e.code] ?? "처리하지 못했어요 · 잠시 후 다시 시도해 주세요";
}
