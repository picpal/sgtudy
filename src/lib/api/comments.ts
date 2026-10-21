import { displayLength, mentionIds } from "@/lib/mention";
import { rpc, type ApiError, type Db } from "./errors";
import type { CommentPage, CommentSaved } from "./types";

/* 회차·과제 댓글 어댑터 (0041_node_comments.sql). 컴포넌트는 이 파일만 부른다 */
const num = (id: string) => Number(id);

/** 서버 comment_limits 와 같은 상한 — 입력 사전 검사·카운터용 */
export const COMMENT_LIMITS = { bodyMax: 2000, mentionsMax: 10 } as const;

/** 기본 = 최신 50 · before = 그 id 보다 오래된 50 · from = 그 댓글부터 최신까지(딥링크, D17) */
export const fetchComments = (slug: string, node: string, opts: { before?: string; from?: string } = {}, client?: Db) =>
  rpc<CommentPage>("comment_list", {
    p_slug: slug, p_node: num(node),
    p_before: opts.before ? num(opts.before) : null, p_from: opts.from ? num(opts.from) : null,
  }, client);
/** body = 저장 본문(lib/mention toTokens 결과) */
export const createComment = (slug: string, node: string, body: string, client?: Db) =>
  rpc<CommentSaved>("comment_create", { p_slug: slug, p_node: num(node), p_body: body }, client);
export const updateComment = (slug: string, id: string, body: string, client?: Db) =>
  rpc<CommentSaved>("comment_update", { p_slug: slug, p_id: num(id), p_body: body }, client);
export const deleteComment = (slug: string, id: string, client?: Db) =>
  rpc<null>("comment_delete", { p_slug: slug, p_id: num(id) }, client).then(() => undefined);

/** 저장 전 클라이언트 검증 — 서버 comment_validate 와 같은 규칙·문구(앞뒤 공백 정리 뒤 센다). 첫 오류만 */
export function validateComment(body: string): { field: "body" | "mentions"; text: string } | null {
  const b = body.trim();
  if (b === "") return { field: "body", text: "댓글 내용을 입력해 주세요" };
  if (displayLength(b) > COMMENT_LIMITS.bodyMax) return { field: "body", text: "댓글은 2,000자까지예요" };
  if (mentionIds(b).length > COMMENT_LIMITS.mentionsMax) return { field: "mentions", text: "한 댓글에서 10명까지 부를 수 있어요" };
  return null;
}

/** 0041 오류 코드 기본 문구(서버 문구가 정본 — 문구가 비었을 때만) */
export const COMMENT_ERROR_KO: Record<string, string> = {
  COMMENT_NOT_FOUND: "댓글을 찾을 수 없어요 · 이미 삭제됐을 수 있어요",
  NOT_AUTHOR: "내가 쓴 댓글만 고칠 수 있어요",
  COMMENT_LIMIT: "이 항목의 댓글이 가득 찼어요",
  COMMENT_LOCKED: "시험을 제출하면 댓글을 볼 수 있어요",
  RATE_LIMITED: "댓글을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요",
  ROOM_NOT_EDITABLE: "종료된 스터디는 댓글을 쓸 수 없어요",
  NODE_NOT_FOUND: "댓글을 달 수 없는 항목이에요",
  NOT_MEMBER: "참가 중인 방이 아니에요",
  ROOM_NOT_FOUND: "방을 찾을 수 없어요",
  VALIDATION_FAILED: "입력 내용을 확인해 주세요",
};

/** comment_* 실패 → 화면 문구 */
export function commentErrorText(e: ApiError): string {
  if (e.code === "NOT_MEMBER" && e.details?.state === "pending") return "참가가 승인되면 댓글을 볼 수 있어요";
  if (e.code === "NOT_MEMBER" && e.details?.state === "inactive") return "이탈한 스터디에는 댓글을 쓸 수 없어요";
  if (e.code === "ROOM_NOT_EDITABLE" && e.details?.reason === "archived_node") return "보관된 항목에는 댓글을 쓸 수 없어요";
  if (e.code === "RATE_LIMITED") return COMMENT_ERROR_KO.RATE_LIMITED;
  if (e.message && e.message !== e.code) return e.message;
  return COMMENT_ERROR_KO[e.code] ?? "처리하지 못했어요 · 잠시 후 다시 시도해 주세요";
}
