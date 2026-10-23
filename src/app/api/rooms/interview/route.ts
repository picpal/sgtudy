import { ApiException, rpc, type Db } from "@/lib/api/errors";
import { openaiCallModel } from "@/lib/ai/client";
import { aiInterviewEnabled, aiMock } from "@/lib/ai/env";
import { failJson, MAX_INTERVIEW_BODY, MSG, sameOrigin } from "@/lib/ai/http";
import { isStart, runTurn, turnLimitExceeded } from "@/lib/ai/interview";
import { mockCallModel } from "@/lib/ai/interview-mock";
import { InterviewRequest } from "@/lib/ai/schema";
import { loadTagDict } from "@/lib/ai/tags";
import { kstToday } from "@/lib/kst";
import { readJsonCapped } from "@/lib/mcp/http";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 서버 로그 1줄(D18) — 사용자 id·대화·초안 없음 */
const log = (o: { turn?: number; ms: number; in?: number; out?: number; cached?: number; model?: string; status: number | string }) =>
  console.info(JSON.stringify({ evt: "ai_interview", ...o }));

// 순서(Review Focus 5): 같은 출처 → 크기 선검사 → 세션 → 본문(상한) → 모양 → 턴 상한 → 키 → ai_turn_check(사용량·상한, 모델 호출 전) → 모델 → 정규화 → ai_turn_done.
// 방은 만들지 않는다 — 생성은 사용자가 미리보기(수동 폼)에서 [방 만들기] 를 눌러야만(D11·Review Focus 1)
export async function POST(req: Request) {
  if (!sameOrigin(req)) return failJson(403, "ORIGIN_NOT_ALLOWED", MSG.ORIGIN_NOT_ALLOWED);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_INTERVIEW_BODY) return failJson(413, "PAYLOAD_TOO_LARGE", MSG.PAYLOAD_TOO_LARGE);
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return failJson(401, "AUTH_REQUIRED", MSG.AUTH_REQUIRED);
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const body = await readJsonCapped(req, MAX_INTERVIEW_BODY);
  if (!body.ok) return body.status === 413 ? failJson(413, "PAYLOAD_TOO_LARGE", MSG.PAYLOAD_TOO_LARGE) : failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const parsed = InterviewRequest.safeParse(body.value);
  if (!parsed.success) return failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const input = parsed.data;
  if (turnLimitExceeded(input)) return failJson(409, "AI_TURN_LIMIT", MSG.AI_TURN_LIMIT);
  if (!aiInterviewEnabled()) return failJson(503, "AI_UNAVAILABLE", MSG.AI_UNAVAILABLE);

  let usageId: number;
  try {
    usageId = (await rpc<{ id: number }>("ai_turn_check", { p_kind: "room_interview", p_started: isStart(input) }, db as unknown as Db)).id;
  } catch (e) {
    if (e instanceof ApiException) {
      if (e.code === "RATE_LIMITED" || e.code === "AI_BUDGET_EXCEEDED") return failJson(429, e.code, e.message, e.details);
      if (e.code === "AUTH_REQUIRED") return failJson(401, e.code, MSG.AUTH_REQUIRED);
      if (e.code === "ONBOARDING_REQUIRED") return failJson(403, e.code, e.message);
    }
    log({ ms: 0, status: "check_failed" });
    return failJson(503, "AI_UNAVAILABLE", MSG.AI_UNAVAILABLE);
  }

  const t0 = Date.now();
  const r = await runTurn(input, { callModel: aiMock() ? mockCallModel : openaiCallModel, today: kstToday(), tagDict: await loadTagDict() });
  const ms = Date.now() - t0;
  if (!r.ok) {
    log({ ms, status: r.status ?? "error" });
    return failJson(503, "AI_UNAVAILABLE", MSG.AI_UNAVAILABLE);
  }
  // 토큰 기록은 실패해도 응답에 영향 없음
  await rpc("ai_turn_done", { p_id: usageId, p_in: r.usage.in, p_out: r.usage.out, p_cached: r.usage.cached, p_model: r.model }, db as unknown as Db).catch(() => undefined);
  log({ turn: r.body.turn, ms, in: r.usage.in, out: r.usage.out, cached: r.usage.cached, model: r.model, status: 200 });
  return new Response(JSON.stringify(r.body), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

const notAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
