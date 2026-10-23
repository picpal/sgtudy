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
  it("목 '부족 테스트' → 첫 요청이 2개 모자라 빠진 회차만 재요청 → padded 0", async () => {
    const call = vi.fn<CallRounds>(mockCallRounds);
    const short = await runRounds({ ...p, userLines: ["부족 테스트"] }, { callRounds: call });
    if (!short.ok) throw new Error("expected ok");
    expect([short.body.padded, short.refill, call.mock.calls.length]).toEqual([0, 2, 2]);
    expect(call.mock.calls[1][0].write.map((r) => r.label)).toEqual(["11주차", "12주차"]);
    expect(call.mock.calls[1][0].messages[0].content).toContain('<write n="2">11,12</write><written>1주차: AWS SAA 자격증 1주차;');
    expect(short.body.rounds[11].title).toBe("AWS SAA 자격증 12주차");
  });
  it("목 '계속 부족 테스트' → 재요청도 모자라면 채움 회차(padded 2, 표시용 padded 표시) · '장애 테스트' → AI_UNAVAILABLE", async () => {
    const short = await runRounds({ ...p, userLines: ["계속 부족 테스트"] }, { callRounds: mockCallRounds });
    if (!short.ok) throw new Error("expected ok");
    expect([short.body.padded, short.refill]).toEqual([2, 2]);
    expect(short.body.rounds.filter((r) => r.padded).map((r) => [r.label, r.title, r.tasks.length])).toEqual([["11주차", "11주차 학습", 0], ["12주차", "12주차 학습", 0]]);
    expect(await runRounds({ ...p, userLines: ["장애 테스트"] }, { callRounds: mockCallRounds })).toEqual({ ok: false, error: "AI_UNAVAILABLE", status: 529 });
  });
  it("모델이 회차 번호를 섞어 보내도 번호 자리로 — '마지막 회차' 요청이 26회차에", async () => {
    const year = prepareRounds(req({ draft: { ...draft, endDate: "2027-10-24" } }), TODAY)!;
    const n = year.schedule.rounds.length;
    const items = year.schedule.rounds.map((r) => ({ index: r.index + 1, title: r.index === n - 1 ? "개인 프로젝트 발표" : `범위 ${r.index + 1}`, goalMd: "", tasks: [] }));
    const call = vi.fn<CallRounds>().mockResolvedValue({ ok: true, output: { rounds: [items[n - 1], ...items.slice(0, n - 1)] }, usage: { in: 1, out: 1, cached: 0 }, model: "m" });
    const r = await runRounds(year, { callRounds: call });
    if (!r.ok) throw new Error("expected ok");
    expect([r.body.rounds.at(-1)!.title, r.body.rounds[0].title, r.body.padded, r.refill]).toEqual(["개인 프로젝트 발표", "범위 1", 0, 0]);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("재요청은 시간이 남을 때만(라우트 60s 안) · 재요청 실패는 무시하고 채움", async () => {
    let t = 0;
    const call = vi.fn<CallRounds>(async (x) => {
      t += 50_000; // 첫 요청이 50초 걸렸다
      return mockCallRounds(x);
    });
    const r = await runRounds({ ...p, userLines: ["부족 테스트"] }, { callRounds: call, now: () => t });
    expect(r.ok && [r.body.padded, r.refill]).toEqual([2, 2]);
    expect(call).toHaveBeenCalledTimes(1);
    const fail = vi.fn<CallRounds>(mockCallRounds).mockImplementationOnce(mockCallRounds).mockResolvedValueOnce({ ok: false, status: 529 });
    const r2 = await runRounds({ ...p, userLines: ["부족 테스트"] }, { callRounds: fail });
    expect(r2.ok && r2.body.padded).toBe(2);
    expect(fail.mock.calls[1][0].timeoutMs).toBeLessThanOrEqual(53_000);
  });
  it("모델에 system·데이터 블록 전달 · 모양이 틀린 출력 → AI_UNAVAILABLE", async () => {
    const call = vi.fn<CallRounds>().mockResolvedValue({ ok: true, output: { rounds: "x" }, usage: { in: 1, out: 1, cached: 0 }, model: "m" });
    expect(await runRounds(p, { callRounds: call })).toEqual({ ok: false, error: "AI_UNAVAILABLE" });
    const arg = call.mock.calls[0][0];
    expect(arg.system).toContain("진행목표 설계 도우미");
    expect(arg.messages[0].content).toContain('<schedule n="12" cadence="7">');
  });
});
