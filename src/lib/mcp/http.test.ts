import { describe, expect, it } from "vitest";
import { deny, MAX_BODY_BYTES, readJsonCapped } from "./http";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://x/api/mcp", { method: "POST", body, headers, duplex: "half" } as RequestInit);
const streamOf = (bytes: number, chunk = 64 * 1024) => {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= bytes) return c.close();
      const n = Math.min(chunk, bytes - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(0x20));
    },
  });
};

describe("readJsonCapped", () => {
  it("Content-Length 600KB → 413, 본문을 읽지 않는다", async () => {
    const boom = new ReadableStream({ pull() { throw new Error("본문을 읽으면 안 됨"); } });
    const r = await readJsonCapped(post(boom, { "content-length": String(600 * 1024) }));
    expect(r).toEqual({ ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" });
  });
  it("Content-Length 없이 600KB 스트림 → 413", async () => {
    expect(await readJsonCapped(post(streamOf(600 * 1024)))).toMatchObject({ ok: false, status: 413 });
  });
  it("상한 정확히 = 허용(공백만이면 JSON 아님 → 400)", async () => {
    expect(await readJsonCapped(post(streamOf(MAX_BODY_BYTES)))).toMatchObject({ ok: false, status: 400 });
  });
  it("깨진 JSON → 400 PARSE_ERROR · 빈 본문도", async () => {
    expect(await readJsonCapped(post("{nope"))).toEqual({ ok: false, status: 400, code: "PARSE_ERROR" });
    expect(await readJsonCapped(new Request("http://x", { method: "POST" }))).toMatchObject({ status: 400 });
  });
  it("정상 → value(한국어 멀티바이트가 청크 경계에 걸려도)", async () => {
    const v = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { arguments: { title: "회차".repeat(50_000) } } };
    expect(await readJsonCapped(post(JSON.stringify(v)))).toEqual({ ok: true, value: v });
  });
});

describe("deny", () => {
  it("401 → WWW-Authenticate Bearer invalid_token", async () => {
    const r = deny(401, "API_TOKEN_INVALID");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe('Bearer realm="sgtudy", error="invalid_token"');
    expect(await r.json()).toEqual({ error: "API_TOKEN_INVALID" });
  });
  it("AUTH_REQUIRED(자격 없음) → error 파라미터 없음", () =>
    expect(deny(401, "AUTH_REQUIRED").headers.get("www-authenticate")).toBe('Bearer realm="sgtudy"'));
  it("429 → Retry-After", () => {
    const r = deny(429, "API_RATE_LIMITED", 60);
    expect([r.status, r.headers.get("retry-after")]).toEqual([429, "60"]);
  });
  it("어떤 응답 본문에도 sgt_pat_ 없음", async () => {
    for (const [s, c] of [[401, "API_TOKEN_INVALID"], [403, "ORIGIN_NOT_ALLOWED"], [413, "PAYLOAD_TOO_LARGE"], [429, "API_RATE_LIMITED"], [503, "INTERNAL"]] as const) {
      const r = deny(s, c, 60);
      expect(await r.text()).not.toContain("sgt_pat_");
      expect([...r.headers.values()].join(" ")).not.toContain("sgt_pat_");
    }
  });
});
