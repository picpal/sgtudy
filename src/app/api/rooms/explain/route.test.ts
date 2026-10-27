import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* POST /api/rooms/explain — 경계 순서·캐시 적중·응시 중 거부·상한·로그(스펙 2026-10-27-ask-ai-term-explain-design §4.3) */
vi.mock("server-only", () => ({}));
const claims = vi.fn();
const dbRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: claims }, rpc: dbRpc }) }));
const callExplain = vi.fn();
vi.mock("@/lib/ai/client", () => ({ openaiCallExplain: (x: unknown) => callExplain(x) }));
const { POST, GET } = await import("./route");

const URL_ = "http://localhost:3700/api/rooms/explain";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request(URL_, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const pgFail = (code: string, details: object = {}) => ({ data: null, error: { message: code, details: "문구", hint: JSON.stringify(details), code: "P0001" } });
const okBody = { slug: "aws", term: "“CIDR 블록”", source: "node", context: "VPC 의 CIDR 블록을 정해요" };
const room = { title: "AWS SAA", intro: "합격", description: "", tags: ["AWS"], round: { label: "2주차", title: "EC2·S3", goal: "" } };
const out = { kind: "term", term: "CIDR 블록", oneLiner: "IP 범위를 적는 방식이에요", inContext: "- VPC 설계", points: ["/16 ~ /28"], related: ["서브넷", "CIDR 블록"] };
const KEY = createHash("sha256").update("cidr 블록").digest("hex");

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  claims.mockReset().mockResolvedValue({ data: { claims: { sub: "u-1" } } });
  dbRpc.mockReset().mockImplementation(async (name: string) => (name === "ai_explain_begin" ? { data: { hit: false, id: 7, room }, error: null } : { data: null, error: null }));
  callExplain.mockReset().mockResolvedValue({ ok: true, output: out, usage: { in: 500, out: 450, cached: 300 }, model: "gpt-6-luna" });
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("AI_INTERVIEW_MOCK", "");
  vi.stubEnv("AI_EXPLAIN_OFF", "");
  info = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  info.mockRestore();
});

describe("POST /api/rooms/explain — 경계", () => {
  it("다른 출처 → 403 (세션 전)", async () => {
    const r = await post(okBody, { "sec-fetch-site": "cross-site" });
    expect([r.status, (await r.json()).error]).toEqual([403, "ORIGIN_NOT_ALLOWED"]);
    expect(claims).not.toHaveBeenCalled();
  });
  it("16KB 초과 → 413 (선검사·스트림)", async () => {
    expect((await post(okBody, { "content-length": String(16 * 1024 + 1) })).status).toBe(413);
    expect(claims).not.toHaveBeenCalled();
    expect((await post({ ...okBody, context: "x".repeat(20_000) })).status).toBe(413);
  });
  it("비로그인 → 401", async () => {
    claims.mockResolvedValue({ data: null });
    expect((await post(okBody)).status).toBe(401);
  });
  it("모양 틀림·41cp 용어·줄바꿈 2개·영역 밖 → 400 · RPC 없음", async () => {
    expect((await post({ ...okBody, source: "comment" })).status).toBe(400);
    expect((await post({ ...okBody, term: "가".repeat(41) })).status).toBe(400);
    expect((await post({ ...okBody, term: "a\nb\nc" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post(okBody, { "content-type": "text/plain" })).status).toBe(400);
    expect(dbRpc).not.toHaveBeenCalled();
    expect((await post({ ...okBody, term: "가".repeat(40) })).status).toBe(200);
  });
  it("키 없음 · AI_EXPLAIN_OFF=1 → 503 (RPC 전)", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await post(okBody)).status).toBe(503);
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("AI_EXPLAIN_OFF", "1");
    const r = await post(okBody);
    expect([r.status, (await r.json()).message]).toEqual([503, "지금은 AI 해설이 어려워요 · 잠시 후 다시 해 주세요"]);
    expect(dbRpc).not.toHaveBeenCalled();
  });
  it("GET 405", () => {
    expect(GET().status).toBe(405);
  });
});

describe("POST /api/rooms/explain — 흐름", () => {
  it("캐시 적중 → 200 hit:true · 모델·done 없음", async () => {
    dbRpc.mockImplementation(async () => ({ data: { hit: true, body: out }, error: null }));
    const r = await post(okBody);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ hit: true, body: out });
    expect(callExplain).not.toHaveBeenCalled();
    expect(dbRpc).toHaveBeenCalledTimes(1);
    expect(dbRpc.mock.calls[0]).toEqual(["ai_explain_begin", { p_slug: "aws", p_term_key: KEY }]);
  });
  it("미스 → 모델(시험 데이터 없음, <term> 포함) → 정제 → done(정규화 용어·토큰) → 200 hit:false", async () => {
    const r = await post(okBody);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.hit).toBe(false);
    expect(j.body.related).toEqual(["서브넷"]); // 용어 자신 제거(sanitize)
    const arg = callExplain.mock.calls[0][0];
    expect(arg.messages[0].content).toContain("<term>“CIDR 블록”</term>");
    expect(arg.messages[0].content).toContain("AWS SAA");
    expect(arg.messages[0].content).not.toMatch(/정답|answer|explanation/i);
    const done = dbRpc.mock.calls.find((c) => c[0] === "ai_explain_done")![1];
    expect(done).toMatchObject({ p_id: 7, p_slug: "aws", p_term_key: KEY, p_norm_term: "cidr 블록", p_in: 500, p_out: 450, p_cached: 300, p_model: "gpt-6-luna" });
    expect(done.p_body.kind).toBe("term");
  });
  it("done 실패해도 200", async () => {
    dbRpc.mockImplementation(async (name: string) => (name === "ai_explain_begin" ? { data: { hit: false, id: 7, room }, error: null } : pgFail("INTERNAL")));
    expect((await post(okBody)).status).toBe(200);
  });
  it("RPC 코드 매핑: EXAM_IN_PROGRESS·NOT_MEMBER 403 · ROOM_NOT_FOUND 404 · RATE_LIMITED 429 + retry-after · AI_BUDGET_EXCEEDED 429", async () => {
    const run = async (code: string, details: object = {}) => {
      dbRpc.mockImplementation(async () => pgFail(code, details));
      return post(okBody);
    };
    let r = await run("EXAM_IN_PROGRESS");
    expect([r.status, (await r.json()).message]).toEqual([403, "시험을 제출한 뒤에 쓸 수 있어요"]);
    r = await run("NOT_MEMBER");
    expect([r.status, (await r.json()).message]).toEqual([403, "참가가 승인되면 쓸 수 있어요"]);
    expect((await run("ROOM_NOT_FOUND")).status).toBe(404);
    r = await run("RATE_LIMITED", { retryAfterSec: 120, window: "explainTenMin" });
    expect([r.status, r.headers.get("retry-after")]).toEqual([429, "120"]);
    expect((await r.json()).details).toEqual({ retryAfterSec: 120, window: "explainTenMin" });
    expect((await run("AI_BUDGET_EXCEEDED")).status).toBe(429);
    expect((await run("SOMETHING")).status).toBe(503);
    expect(callExplain).not.toHaveBeenCalled();
  });
  it("모델 실패·스키마 밖 → 503 · done 없음", async () => {
    callExplain.mockResolvedValueOnce({ ok: false, status: 429 });
    expect((await post(okBody)).status).toBe(503);
    callExplain.mockResolvedValueOnce({ ok: true, output: { nope: 1 }, usage: { in: 0, out: 0, cached: 0 }, model: "m" });
    expect((await post(okBody)).status).toBe(503);
    expect(dbRpc.mock.calls.some((c) => c[0] === "ai_explain_done")).toBe(false);
  });
  it("목 모드 → 키 없이 대본", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_INTERVIEW_MOCK", "1");
    const r = await post(okBody);
    expect(r.status).toBe(200);
    expect(callExplain).not.toHaveBeenCalled();
    expect((await r.json()).body.kind).toBe("term");
  });
  it("로그 한 줄 — 용어·문맥·사용자 id 없음", async () => {
    await post(okBody);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ evt: "ai_explain", hit: false, in: 500, out: 450, status: 200 });
    expect(line).not.toMatch(/CIDR|cidr|VPC|u-1|aws/);
  });
});
