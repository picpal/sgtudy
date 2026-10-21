import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const invoke = vi.fn();
vi.mock("@/lib/mcp/invoke", () => ({ authenticatePat: (t: string) => auth(t), patInvoker: () => invoke }));
const { POST } = await import("./route");

const PAT = "sgt_pat_" + "a".repeat(64);
const rpc = (method: string, params: unknown = {}, id: number | null = 1) =>
  new Request("http://localhost:3700/api/mcp", { method: "POST",
    headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json", accept: "application/json, text/event-stream",
               "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify(id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }) });
const init = () => rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
const ok = { ok: true, who: { nickname: "민수", tokenName: "t", scopes: ["read"], expiresAt: "2027-01-01T00:00:00Z" } };

beforeEach(() => { auth.mockReset(); invoke.mockReset(); });

describe("POST /api/mcp", () => {
  it("헤더 없음 → 401 + WWW-Authenticate, DB 호출 없음", async () => {
    const r = await POST(new Request("http://x/api/mcp", { method: "POST", body: "{}" }));
    expect([r.status, r.headers.get("www-authenticate")?.startsWith("Bearer")]).toEqual([401, true]);
    expect(auth).not.toHaveBeenCalled();
  });
  it.each([["API_TOKEN_INVALID", 401], ["API_TOKEN_EXPIRED", 401]])("initialize + %s(잘못된·폐기·만료) → %d · transport 에 닿지 않음", async (code, status) => {
    auth.mockResolvedValue({ ok: false, status, code });
    const r = await POST(init());
    expect(r.status).toBe(status);
    expect(r.headers.get("www-authenticate")).toMatch(/invalid_token/);
    expect(await r.text()).not.toContain("sgt_pat_");
  });
  it("분당 한도 → 429 + Retry-After", async () => {
    auth.mockResolvedValue({ ok: false, status: 429, code: "API_RATE_LIMITED", retryAfterSec: 60 });
    const r = await POST(rpc("tools/list"));
    expect([r.status, r.headers.get("retry-after")]).toEqual([429, "60"]);
  });
  it("정상 initialize → 200 JSON-RPC 결과(serverInfo sgtudy) · tools/list → 9개", async () => {
    auth.mockResolvedValue(ok);
    const a = await POST(init());
    expect(a.status).toBe(200);
    expect((await a.json()).result.serverInfo.name).toBe("sgtudy");
    const b = await POST(rpc("tools/list", {}, 2));
    expect((await b.json()).result.tools).toHaveLength(9);
    expect(auth).toHaveBeenCalledTimes(2);   // HTTP 요청마다 1회
  });
  it("연결 중 폐기: 첫 요청 200 → 토큰 폐기 → 다음 tools/call 은 401(도구 isError 가 아님)", async () => {
    auth.mockResolvedValueOnce(ok).mockResolvedValueOnce({ ok: false, status: 401, code: "API_TOKEN_INVALID" });
    expect((await POST(rpc("tools/list"))).status).toBe(200);
    const r = await POST(rpc("tools/call", { name: "list_my_studies", arguments: {} }, 3));
    expect(r.status).toBe(401);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("본문 600KB → 413, DB 호출 없음(Content-Length 선검사)", async () => {
    const big = new Request("http://x/api/mcp", { method: "POST", body: "x".repeat(600 * 1024),
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json", "content-length": String(600 * 1024) } });
    expect((await POST(big)).status).toBe(413);
    expect(auth).not.toHaveBeenCalled();
  });
  it("허용 목록 밖 Origin → 403, DB 호출 없음", async () => {
    const r = await POST(new Request("http://x/api/mcp", { method: "POST", body: "{}", headers: { origin: "https://evil.example", authorization: `Bearer ${PAT}` } }));
    expect(r.status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
  });
  it("인증 단계 DB 장애 → 503", async () => {
    auth.mockResolvedValue({ ok: false, status: 503, code: "INTERNAL" });
    expect((await POST(rpc("tools/list"))).status).toBe(503);
  });
  it("tools/call: 인증 때 받은 whoami 를 재사용(me_studies 1회) · 줄 형식 텍스트", async () => {
    auth.mockResolvedValue(ok);
    invoke.mockResolvedValue({ ok: true, data: { today: "2026-10-21", items: [] } });
    const r = await POST(rpc("tools/call", { name: "list_my_studies", arguments: {} }, 4));
    const res = (await r.json()).result;
    expect(invoke.mock.calls).toEqual([["me_studies", {}]]);
    expect(res.content[0].text).toMatch(/^나: 민수 · 토큰 "t"/);
    expect(res.isError).toBeUndefined();
  });
  it("tools/call 인자: SDK 검증을 거쳐도 계획서의 하위 항목·추가 키가 그대로 서버로", async () => {
    auth.mockResolvedValue(ok);
    invoke.mockResolvedValue({ ok: true, data: { ok: false, diff: [], warnings: [], notifications: null, errors: [{ path: "ops[0]", code: "INVALID_TITLE", message: "x" }] } });
    const plan = { schema: "sgtudy.plan/v1", ops: [{ op: "create", parent: null, title: "R", assigneeIds: ["u"],
      children: [{ title: "T", taskType: "designated", assignees: ["지은"] }] }] };
    const r = await POST(rpc("tools/call", { name: "preview_curriculum_plan", arguments: { study: "aws", plan } }, 5));
    expect(invoke).toHaveBeenCalledWith("curriculum_plan_preview", { study: "aws", plan });
    expect((await r.json()).result.isError).toBe(true);
  });
  it("prompts/list → draft-curriculum·draft-exam · notifications/initialized → 202", async () => {
    auth.mockResolvedValue(ok);
    expect((await (await POST(rpc("prompts/list", {}, 6))).json()).result.prompts.map((p: { name: string }) => p.name)).toEqual(["draft-curriculum", "draft-exam"]);
    expect((await POST(rpc("notifications/initialized", {}, null))).status).toBe(202);
  });
  it("〔리뷰 I1〕 JSON-RPC 배치(배열) → 400 + JSON-RPC 오류 · 도구 호출 없음", async () => {
    auth.mockResolvedValue(ok);
    const one = { jsonrpc: "2.0", method: "tools/call", params: { name: "list_my_studies", arguments: {} } };
    const r = await POST(new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify([{ ...one, id: 1 }, { ...one, id: 2 }]),
      headers: { authorization: `Bearer ${PAT}`, "content-type": "application/json", accept: "application/json, text/event-stream" } }));
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe(-32600);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("Authorization 없음 → error 파라미터 없는 Bearer 챌린지(RFC 6750 §3.1) · 형식 틀린 PAT → invalid_token", async () => {
    const none = await POST(new Request("http://x/api/mcp", { method: "POST", body: "{}" }));
    expect(none.headers.get("www-authenticate")).toBe('Bearer realm="sgtudy"');
    const bad = await POST(new Request("http://x/api/mcp", { method: "POST", body: "{}", headers: { authorization: "Bearer sgt_pat_xyz" } }));
    expect([bad.status, bad.headers.get("www-authenticate")]).toEqual([401, 'Bearer realm="sgtudy", error="invalid_token"']);
  });
  it("GET → 405", async () => {
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(405);
  });
});
