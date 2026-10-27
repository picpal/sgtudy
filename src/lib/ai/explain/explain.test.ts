import { describe, expect, it, vi } from "vitest";
import { runExplain, type CallExplain } from "./explain";
import { mockCallExplain } from "./explain-mock";
import type { RoomMeta } from "./schema";

const room: RoomMeta = { title: "AWS", intro: "", description: "", tags: [], round: null };
const p = { room, source: "node" as const, context: "VPC 안의 서브넷", term: "서브넷" };

describe("runExplain", () => {
  it("mock success → term body, sanitized (related excludes the term)", async () => {
    const r = await runExplain(p, { callExplain: mockCallExplain });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.kind).toBe("term");
    expect(r.body.related).toEqual(["VPC"]); // "서브넷" 자신은 빠진다
    expect(r.model).toBe("mock");
  });
  it("passes system + messages to the model", async () => {
    const call = vi.fn<CallExplain>(async () => ({ ok: true, output: { kind: "not_term", term: "", oneLiner: "x", inContext: "y", points: ["a"], related: [] }, usage: { in: 1, out: 2, cached: 0 }, model: "m" }));
    const r = await runExplain(p, { callExplain: call });
    const arg = call.mock.calls[0][0];
    expect(arg.system).toContain("슥터디");
    expect(arg.messages[0].content).toContain("<term>서브넷</term>");
    expect(r.ok && r.body).toEqual({ kind: "not_term", term: "서브넷", oneLiner: "x", inContext: "", points: [], related: [] });
  });
  it("schema mismatch → ok:false", async () => {
    const r = await runExplain(p, { callExplain: async () => ({ ok: true, output: { kind: "term", answer: 1 }, usage: { in: 0, out: 0, cached: 0 }, model: "m" }) });
    expect(r).toEqual({ ok: false, status: 200 });
  });
  it("model failure → status passed through", async () => {
    expect(await runExplain(p, { callExplain: async () => ({ ok: false, status: 429 }) })).toEqual({ ok: false, status: 429 });
    expect(await runExplain({ ...p, term: "실패" }, { callExplain: mockCallExplain })).toEqual({ ok: false, status: 500 });
  });
});
