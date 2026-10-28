import "server-only";
import { createHash } from "node:crypto";
import { ApiException, rpc, type Db } from "@/lib/api/errors";
import { openaiCallExplain } from "@/lib/ai/client";
import { aiExplainEnabled, aiMock } from "@/lib/ai/env";
import { runExplain } from "@/lib/ai/explain/explain";
import { mockCallExplain } from "@/lib/ai/explain/explain-mock";
import { isTermLength, normTerm } from "@/lib/ai/explain/normalize";
import { sanitizeExplain } from "@/lib/ai/explain/sanitize";
import { ExplainOut, ExplainRequest, MAX_EXPLAIN_BODY, NO_SHARE_SOURCES, type ExplainResponse, type RoomMeta } from "@/lib/ai/explain/schema";
import { failJson, MSG, sameOrigin } from "@/lib/ai/http";
import { readJsonCapped } from "@/lib/mcp/http";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// 모델 호출 한 번(timeout 25s, 재시도 없음, D10) + 앞뒤 RPC
export const maxDuration = 30;

type Begin = { hit: true; body: unknown } | { hit: false; id: number; room: RoomMeta };

/** 서버 로그 1줄(D19) — 사용자 id·선택 텍스트·문맥 없음 */
const log = (o: { hit: boolean; ms: number; in?: number; out?: number; cached?: number; model?: string; status: number | string }) =>
  console.info(JSON.stringify({ evt: "ai_explain", ...o }));

const ok = (body: ExplainResponse) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// 순서는 인터뷰·회차 라우트와 같다: 같은 출처 → 크기 선검사 → 세션 → content-type → 본문(상한) → 모양 → 용어 길이 → 키 →
// ai_explain_begin(권한·응시 중·캐시·상한, 모델 호출 전) → 적중이면 바로 → 모델 → 정제 → ai_explain_done(토큰·캐시, 실패 무시)
export async function POST(req: Request) {
  if (!sameOrigin(req)) return failJson(403, "ORIGIN_NOT_ALLOWED", MSG.ORIGIN_NOT_ALLOWED);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_EXPLAIN_BODY) return failJson(413, "PAYLOAD_TOO_LARGE", MSG.VALIDATION_FAILED);
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub) return failJson(401, "AUTH_REQUIRED", MSG.AUTH_REQUIRED);
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const raw = await readJsonCapped(req, MAX_EXPLAIN_BODY);
  if (!raw.ok) return raw.status === 413 ? failJson(413, "PAYLOAD_TOO_LARGE", MSG.VALIDATION_FAILED) : failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const parsed = ExplainRequest.safeParse(raw.value);
  if (!parsed.success) return failJson(400, "VALIDATION_FAILED", MSG.VALIDATION_FAILED);
  const { slug, term, source, context } = parsed.data;
  if (!isTermLength(term)) return failJson(400, "VALIDATION_FAILED", MSG.EXPLAIN_TOO_LONG, { field: "term" });
  if (!aiExplainEnabled()) return failJson(503, "AI_UNAVAILABLE", MSG.EXPLAIN_UNAVAILABLE);

  const norm = normTerm(term);
  const termKey = createHash("sha256").update(norm, "utf8").digest("hex");
  const t0 = Date.now();
  let begin: Begin;
  try {
    begin = await rpc<Begin>("ai_explain_begin", { p_slug: slug, p_term_key: termKey }, db as unknown as Db);
  } catch (e) {
    if (e instanceof ApiException) {
      if (e.code === "RATE_LIMITED" || e.code === "AI_BUDGET_EXCEEDED") return failJson(429, e.code, e.message, e.details);
      if (e.code === "AUTH_REQUIRED") return failJson(401, e.code, MSG.AUTH_REQUIRED);
      if (e.code === "ROOM_NOT_FOUND") return failJson(404, e.code, e.message);
      if (e.code === "EXAM_IN_PROGRESS") return failJson(403, e.code, MSG.EXPLAIN_IN_PROGRESS);
      if (e.code === "NOT_MEMBER") return failJson(403, e.code, MSG.EXPLAIN_NOT_MEMBER);
      if (e.code === "ONBOARDING_REQUIRED") return failJson(403, e.code, e.message);
      if (e.code === "VALIDATION_FAILED") return failJson(400, e.code, MSG.VALIDATION_FAILED);
    }
    log({ hit: false, ms: Date.now() - t0, status: "begin_failed" });
    return failJson(503, "AI_UNAVAILABLE", MSG.EXPLAIN_UNAVAILABLE);
  }
  if (begin.hit) {
    // 캐시 행은 authenticated RPC(ai_explain_done)로 멤버가 직접 쓸 수 있다 — 내보내기 전에 모양 검사·정제를 다시 한다(링크·URL·HTML·상한)
    const cached = ExplainOut.safeParse(begin.body);
    if (!cached.success) {
      log({ hit: true, ms: Date.now() - t0, status: "cache_invalid" });
      return failJson(503, "AI_UNAVAILABLE", MSG.EXPLAIN_UNAVAILABLE);
    }
    log({ hit: true, ms: Date.now() - t0, status: 200 });
    return ok({ hit: true, body: sanitizeExplain(cached.data, term) });
  }

  const r = await runExplain({ room: begin.room, source, context, term }, { callExplain: aiMock() ? mockCallExplain : openaiCallExplain });
  const ms = Date.now() - t0;
  if (!r.ok) {
    log({ hit: false, ms, status: r.status ?? "error" });
    return failJson(503, "AI_UNAVAILABLE", MSG.EXPLAIN_UNAVAILABLE);
  }
  // 토큰 기록·캐시 저장은 실패해도 응답에 영향 없음(not_term 은 RPC 가 저장하지 않는다). 시험·오답 문맥은 body 를 넘기지 않는다(토큰만)
  await rpc(
    "ai_explain_done",
    { p_id: begin.id, p_slug: slug, p_term_key: termKey, p_norm_term: norm, p_body: NO_SHARE_SOURCES.has(source) ? null : r.body, p_in: r.usage.in, p_out: r.usage.out, p_cached: r.usage.cached, p_model: r.model },
    db as unknown as Db,
  ).catch(() => undefined);
  log({ hit: false, ms, in: r.usage.in, out: r.usage.out, cached: r.usage.cached, model: r.model, status: 200 });
  return ok({ hit: false, body: r.body });
}

const notAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
