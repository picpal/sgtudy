import { describe, expect, it, vi } from "vitest";
import { errorMessage, postExplain } from "./api";

const body = { slug: "aws", term: "VPC", source: "node" as const, context: "" };
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

describe("postExplain", () => {
  it("200 → data · posts JSON same-origin with signal", async () => {
    const f = vi.fn(async () => json(200, { hit: true, body: { kind: "term" } }));
    const ac = new AbortController();
    const r = await postExplain(body, { fetcher: f as unknown as typeof fetch, signal: ac.signal });
    expect(r).toEqual({ ok: true, data: { hit: true, body: { kind: "term" } } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/rooms/explain");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", signal: ac.signal });
    expect(JSON.parse(String(init.body))).toEqual(body);
  });
  it("429 keeps details and status", async () => {
    const f = async () => json(429, { error: "RATE_LIMITED", message: "m", details: { retryAfterSec: 30, window: "explainTenMin" } });
    const r = await postExplain(body, { fetcher: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: false, err: { error: "RATE_LIMITED", message: "m", details: { retryAfterSec: 30, window: "explainTenMin" }, status: 429 } });
  });
  it("network throw / abort → AI_UNAVAILABLE status 0", async () => {
    const r = await postExplain(body, { fetcher: (async () => { throw new Error("x"); }) as unknown as typeof fetch });
    expect(r).toEqual({ ok: false, err: { error: "AI_UNAVAILABLE", message: "지금은 AI 해설이 어려워요 · 잠시 후 다시 해 주세요", status: 0 } });
  });
});

describe("errorMessage", () => {
  it("maps codes and windows to §6 copy", () => {
    expect(errorMessage({ error: "RATE_LIMITED", message: "", details: { window: "explainTenMin" } })).toBe("AI 해설을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요");
    expect(errorMessage({ error: "RATE_LIMITED", message: "", details: { window: "explain" } })).toBe("오늘은 AI 해설을 더 쓸 수 없어요 · 내일 다시 해 주세요");
    expect(errorMessage({ error: "EXAM_IN_PROGRESS", message: "" })).toBe("시험을 제출한 뒤에 쓸 수 있어요");
    expect(errorMessage({ error: "NOT_MEMBER", message: "" })).toBe("참가가 승인되면 쓸 수 있어요");
    expect(errorMessage({ error: "ROOM_NOT_FOUND", message: "방을 찾을 수 없어요" })).toBe("방을 찾을 수 없어요");
  });
});
