import { rpc, type ApiError, type Db } from "./errors";
import type { FeedbackContext, FeedbackKind, FeedbackSaved } from "./types";

/* 의견 보내기 어댑터 (0044_feedback.sql). 컴포넌트는 이 파일만 부른다 */

/** 서버 feedback_limits 와 같은 상한 — 폼 사전 검사·카운터용 */
export const FEEDBACK_LIMITS = { messageMin: 5, messageMax: 2000 } as const;

export const FEEDBACK_KINDS: { key: FeedbackKind; label: string }[] = [
  { key: "BUG", label: "버그 신고" },
  { key: "IDEA", label: "제안" },
  { key: "QUESTION", label: "문의" },
  { key: "OTHER", label: "기타" },
];

export const submitFeedback = (kind: FeedbackKind, message: string, context: FeedbackContext, client?: Db) =>
  rpc<FeedbackSaved>("feedback_submit", { p_kind: kind, p_message: message, p_context: context }, client);

/** 저장 전 클라이언트 검증 — 서버와 같은 규칙·문구(앞뒤 공백 뺀 길이) */
export function validateFeedback(message: string): string | null {
  const n = message.trim().length;
  return n < FEEDBACK_LIMITS.messageMin || n > FEEDBACK_LIMITS.messageMax ? "내용은 5~2,000자예요" : null;
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** 주소에 남겨도 되는 쿼리 — ?invite= 같은 비밀은 뺀다(스펙 D5) */
const SAFE_QUERY = ["tab", "item", "task", "mode"];

/**
 * 자동 첨부 정보(스펙 D5). path 는 pathname + 허용 쿼리만, /invite/{토큰} 은 가린다. room = /rooms/{slug}·/my-study/{slug} 의 slug.
 * appVersion = 빌드 커밋(NEXT_PUBLIC_APP_COMMIT, next.config 가 VERCEL_GIT_COMMIT_SHA 앞 7자로 채운다) — 없으면 dev
 */
export function feedbackContext(loc: { pathname: string; search: string }, ua: string, vw: number, vh: number, commit?: string): FeedbackContext {
  const pathname = loc.pathname.startsWith("/invite/") ? "/invite/…" : loc.pathname;
  const params = new URLSearchParams(loc.search);
  const kept = new URLSearchParams();
  for (const k of SAFE_QUERY) {
    const v = params.get(k);
    if (v !== null) kept.set(k, v);
  }
  const q = kept.toString();
  const m = /^\/(?:rooms|my-study)\/([^/?#]+)/.exec(pathname);
  const room = m && m[1] !== "new" ? safeDecode(m[1]) : undefined;
  return {
    path: (pathname + (q ? `?${q}` : "")).slice(0, 500),
    ...(room ? { room: room.slice(0, 500) } : {}),
    userAgent: ua.slice(0, 500),
    viewport: `${vw}x${vh}`,
    appVersion: commit || "dev",
  };
}

/** 0044 오류 → 화면 문구(서버 문구가 정본 — 문구가 비었을 때만 기본 문구) */
export const FEEDBACK_ERROR_KO: Record<string, string> = {
  AUTH_REQUIRED: "로그인이 필요해요",
  VALIDATION_FAILED: "입력 내용을 확인해 주세요",
  RATE_LIMITED: "의견을 너무 자주 보내고 있어요 · 잠시 후 다시 보내 주세요",
};
export function feedbackErrorText(e: ApiError): string {
  // UNKNOWN(네트워크 등)의 원문(Failed to fetch …)은 보이지 않는다
  if (e.code !== "UNKNOWN" && e.message && e.message !== e.code) return e.message;
  return FEEDBACK_ERROR_KO[e.code] ?? "보내지 못했어요 · 잠시 후 다시 시도해 주세요";
}
