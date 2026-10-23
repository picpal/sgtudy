import { ApiException, rpc, type Db } from "@/lib/api/errors";
import { openaiCallRounds } from "@/lib/ai/client";
import { aiInterviewEnabled, aiMock } from "@/lib/ai/env";
import { failJson, MAX_INTERVIEW_BODY, MSG, sameOrigin } from "@/lib/ai/http";
import { prepareRounds, runRounds } from "@/lib/ai/rounds/rounds";
import { mockCallRounds } from "@/lib/ai/rounds/rounds-mock";
import { RoundsRequest } from "@/lib/ai/rounds/schema";
import { kstToday } from "@/lib/kst";
import { readJsonCapped } from "@/lib/mcp/http";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// 모델 호출 합계 ≤ 55s(첫 요청 timeout 50s + 모자란 회차 재요청은 남은 시간만, D40) + 앞뒤 RPC. Vercel Hobby 함수 상한 안(2026-10-23 확인)
export const maxDuration = 60;

/** 서버 로그 1줄(§6) — 사용자 id·발화·초안·회차 글 없음 */
const log = (o: { n?: number; ms: number; in?: number; out?: number; cached?: number; model?: string; refill?: number; padded?: number; status: number | string }) =>
  console.info(JSON.stringify({ evt: "ai_rounds", ...o }));

// 순서는 인터뷰 라우트와 같다(Review Focus 3): 같은 출처 → 크기 선검사 → 세션 → 본문(상한) → 모양 → 초안 재검증(날짜 없으면 400) → 키 →
// ai_turn_check(room_rounds, 모델 호출 전 — 다시 생성도 센다) → 모델(모자라면 그 회차만 1회 더 — 상한은 1회로 센다) → 계획서 서버 조립 → ai_turn_done(두 호출 합산).
// 계획서를 저장·적용하지 않는다 — 적용은 사용자가 [방 만들기] 를 누른 뒤 클라이언트가 curriculum_plan_preview → apply 로(D21)
export async function POST(req: Request) {
  if (!sameOrigin(req)) return failJson(403, "ORIGIN_NOT_ALLOWED", MSG.ORIGIN_NOT_ALLOWED);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_INTERVIEW_BODY) return failJson(413, "PAYLOAD_TOO_LARGE", MSG.PAYLOAD_TOO_LARGE);
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return failJson(401, "AUTH_REQUIRED", MSG.AUTH_REQUIRED);
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const body = await readJsonCapped(req, MAX_INTERVIEW_BODY);
  if (!body.ok) return body.status === 413 ? failJson(413, "PAYLOAD_TOO_LARGE", MSG.PAYLOAD_TOO_LARGE) : failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const parsed = RoundsRequest.safeParse(body.value);
  if (!parsed.success) return failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const prepared = prepareRounds(parsed.data, kstToday());
  if (!prepared) return failJson(400, "VALIDATION_FAILED", MSG.ROUNDS_NO_PERIOD);
  if (!aiInterviewEnabled()) return failJson(503, "AI_UNAVAILABLE", MSG.ROUNDS_UNAVAILABLE);

  let usageId: number;
  try {
    usageId = (await rpc<{ id: number }>("ai_turn_check", { p_kind: "room_rounds", p_started: false }, db as unknown as Db)).id;
  } catch (e) {
    if (e instanceof ApiException) {
      if (e.code === "RATE_LIMITED" || e.code === "AI_BUDGET_EXCEEDED") return failJson(429, e.code, e.message, e.details);
      if (e.code === "AUTH_REQUIRED") return failJson(401, e.code, MSG.AUTH_REQUIRED);
      if (e.code === "ONBOARDING_REQUIRED") return failJson(403, e.code, e.message);
    }
    log({ ms: 0, status: "check_failed" });
    return failJson(503, "AI_UNAVAILABLE", MSG.ROUNDS_UNAVAILABLE);
  }

  const t0 = Date.now();
  const r = await runRounds(prepared, { callRounds: aiMock() ? mockCallRounds : openaiCallRounds });
  const ms = Date.now() - t0;
  if (!r.ok) {
    log({ n: prepared.schedule.rounds.length, ms, status: r.status ?? "error" });
    return failJson(503, "AI_UNAVAILABLE", MSG.ROUNDS_UNAVAILABLE);
  }
  // 토큰 기록은 실패해도 응답에 영향 없음
  await rpc("ai_turn_done", { p_id: usageId, p_in: r.usage.in, p_out: r.usage.out, p_cached: r.usage.cached, p_model: r.model }, db as unknown as Db).catch(() => undefined);
  log({ n: r.body.stats.rounds, ms, in: r.usage.in, out: r.usage.out, cached: r.usage.cached, model: r.model, refill: r.refill, padded: r.body.padded, status: 200 });
  return new Response(JSON.stringify(r.body), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

const notAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
