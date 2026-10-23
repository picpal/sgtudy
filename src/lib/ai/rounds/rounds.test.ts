import { describe, expect, it, vi } from "vitest";
import { planDoc } from "@/lib/mcp/plan-schema";
import { prepareRounds, runRounds, type CallRounds } from "./rounds";
import { mockCallRounds } from "./rounds-mock";
import { RoundsRequest } from "./schema";

/* 회차 초안 한 번 — 검증 · 모델 실패 · 목 대본 */
const TODAY = "2026-10-23";
const draft = { title: "AWS SAA 자격증 3개월 완주", intro: "소개", startDate: "2026-10-26", endDate: "2027-01-17" };
const req = (o: Record<string, unknown> = {}) => RoundsRequest.parse({ draft, userLines: ["aws saa"], style: ["weekly-task", "exam"], ...o });

describe("RoundsRequest", () => {
  it("발화 12줄·각 500자 · style 은 STYLE_VALUES 만", () => {
    expect(RoundsRequest.safeParse({ draft, userLines: Array(13).fill("a") }).success).toBe(false);
    expect(RoundsRequest.safeParse({ draft, userLines: ["가".repeat(501)] }).success).toBe(false);
    expect(RoundsRequest.safeParse({ draft, style: ["hack"] }).success).toBe(false);
    expect(RoundsRequest.parse({ draft })).toMatchObject({ userLines: [], style: [] });
  });
});

describe("prepareRounds", () => {
  it("제목·시작일·종료일이 없거나 무효면 null(→ 400)", () => {
    expect(prepareRounds(req({ draft: { ...draft, startDate: undefined } }), TODAY)).toBeNull();
    expect(prepareRounds(req({ draft: { ...draft, title: "" } }), TODAY)).toBeNull();
    expect(prepareRounds(req({ draft: { ...draft, startDate: "2026-10-01" } }), TODAY)).toBeNull(); // 오늘 이전
    expect(prepareRounds(req({ draft: { ...draft, endDate: "2028-01-01" } }), TODAY)).toBeNull(); // 1년 넘음
  });
  it("회차 표를 만든다(12주 = 12회차)", () => {
    const p = prepareRounds(req(), TODAY)!;
    expect(p.schedule.rounds).toHaveLength(12);
    expect(p.style).toEqual(["weekly-task", "exam"]);
  });
});

describe("runRounds", () => {
  const p = prepareRounds(req(), TODAY)!;
  it("목 대본 → planDoc 통과 · 12회차 · 과제 24 · 시험 12", async () => {
    const r = await runRounds(p, { callRounds: mockCallRounds });
    if (!r.ok) throw new Error("expected ok");
    expect(() => planDoc.parse(r.body.plan)).not.toThrow();
    expect(r.body.stats).toEqual({ rounds: 12, tasks: 24, exams: 12, cadenceDays: 7 });
    expect(r.body.padded).toBe(0);
    expect(r.model).toBe("mock");
    expect(r.body.rounds[0].goalMd).toMatch(/^이번 주 목표:/);
  });
  it("목 대본: 14일 회차면 '이번 회차 목표'", async () => {
    const year = prepareRounds(req({ draft: { ...draft, endDate: "2027-10-24" } }), TODAY)!;
    expect(year.schedule.cadenceDays).toBe(14);
    const r = await runRounds(year, { callRounds: mockCallRounds });
    expect(r.ok && r.body.rounds[0].goalMd).toMatch(/^이번 회차 목표:/);
  });
  it("목 '부족 테스트' → padded 2 · '장애 테스트' → AI_UNAVAILABLE", async () => {
    const short = await runRounds({ ...p, userLines: ["부족 테스트"] }, { callRounds: mockCallRounds });
    expect(short.ok && short.body.padded).toBe(2);
    expect(await runRounds({ ...p, userLines: ["장애 테스트"] }, { callRounds: mockCallRounds })).toEqual({ ok: false, error: "AI_UNAVAILABLE", status: 529 });
  });
  it("모델에 system·데이터 블록 전달 · 모양이 틀린 출력 → AI_UNAVAILABLE", async () => {
    const call = vi.fn<CallRounds>().mockResolvedValue({ ok: true, output: { rounds: "x" }, usage: { in: 1, out: 1, cached: 0 }, model: "m" });
    expect(await runRounds(p, { callRounds: call })).toEqual({ ok: false, error: "AI_UNAVAILABLE" });
    const arg = call.mock.calls[0][0];
    expect(arg.system).toContain("진행목표 설계 도우미");
    expect(arg.messages[0].content).toContain('<schedule n="12" cadence="7">');
  });
});
