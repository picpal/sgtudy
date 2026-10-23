import type { TurnErrorBody } from "./schema";

/* /api/rooms/interview 의 HTTP 경계(D7) — 같은 출처만 · 본문 64KB · 오류 본문 {error, message, details?}(키·모델 원문 없음) */

export const MAX_INTERVIEW_BODY = 64 * 1024;

/** 브라우저 fetch 는 Sec-Fetch-Site 를 보낸다. 없으면(오래된 브라우저) Origin 호스트 = 요청 호스트. 둘 다 없으면 거부 */
export function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function failJson(status: number, error: string, message: string, details?: Record<string, unknown>): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  const sec = details?.retryAfterSec;
  if (status === 429 && typeof sec === "number") headers["retry-after"] = String(sec);
  const body: TurnErrorBody = { error, message, ...(details ? { details } : {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

export const MSG = {
  ORIGIN_NOT_ALLOWED: "허용되지 않은 요청이에요",
  PAYLOAD_TOO_LARGE: "대화가 너무 길어요 · 직접 입력으로 이어서 해 주세요",
  AUTH_REQUIRED: "로그인이 필요해요",
  VALIDATION_FAILED: "요청 모양이 올바르지 않아요",
  AI_TURN_LIMIT: "인터뷰가 길어졌어요 · 미리보기나 직접 입력으로 이어서 해 주세요",
  AI_UNAVAILABLE: "지금은 AI 응답이 어려워요 · 직접 입력으로 이어서 할 수 있어요",
} as const;
