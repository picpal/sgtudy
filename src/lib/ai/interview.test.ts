import { describe, expect, it, vi } from "vitest";
import { runTurn, turnLimitExceeded, isStart, type CallModel } from "./interview";
import { mockCallModel } from "./interview-mock";
import { InterviewRequest, type ModelTurn } from "./schema";

const TODAY = "2026-10-23";
const DICT = [{ slug: "aws", label: "AWS", tone: "mint" }];
const req = (r: Partial<InterviewRequest> = {}) => InterviewRequest.parse({ draft: {}, messages: [], ...r });
const model = (turn: Partial<ModelTurn> | unknown): CallModel => vi.fn(async () => ({ ok: true as const, turn: { say: "다음", patch: {}, ask: null, done: false, ...(turn as object) }, usage: { in: 10, out: 5, cached: 0 }, model: "m" }));
const FULL = { title: "AWS", intro: "소개", startDate: "2026-10-26", endDate: "2027-01-17", maxMembers: 6, isPublic: true, joinMode: "direct" };

describe("runTurn", () => {
  it("모델이 범위 밖 값을 내도 응답 draft 는 정규화 · dropped 표시", async () => {
    const r = await runTurn(req(), { callModel: model({ patch: { maxMembers: 500, startDate: "2020-01-01", tags: Array(12).fill(0).map((_, i) => `t${i}`), title: "가".repeat(3000) } }), today: TODAY, tagDict: DICT });
    if (!r.ok) throw new Error("expected ok");
    expect(r.body.draft.maxMembers).toBeUndefined();
    expect(r.body.draft.startDate).toBeUndefined();
    expect(r.body.draft.tags).toHaveLength(8);
    expect([...r.body.draft.title!].length).toBe(60);
    expect(r.body.dropped.map((d) => d.field).sort()).toEqual(["maxMembers", "startDate", "tags"]);
  });
  it("done:true 인데 missing 이 있으면 false + 첫 빈 칸 기본 칩", async () => {
    const r = await runTurn(req(), { callModel: model({ done: true }), today: TODAY, tagDict: DICT });
    if (!r.ok) throw new Error();
    expect(r.body.done).toBe(false);
    expect(r.body.ask?.field).toBe("title");
  });
  it("missing 이 비고 done 이면 done:true · ask null", async () => {
    const r = await runTurn(req({ draft: FULL, messages: [{ role: "assistant", text: "요약" }, { role: "user", text: "좋아요" }] }), { callModel: model({ done: true, ask: { field: "title", kind: "text" } }), today: TODAY, tagDict: DICT });
    if (!r.ok) throw new Error();
    expect([r.body.done, r.body.ask, r.body.missing]).toEqual([true, null, []]);
    expect([r.body.turn, r.body.turnsLeft]).toEqual([2, 11]);
  });
  it("칩 답(access·durationWeeks)은 모델 전에 반영되어 모델 입력 draft 에 들어간다", async () => {
    const cm = model({});
    const r = await runTurn(req({ draft: { startDate: "2026-10-26" }, messages: [{ role: "user", text: "12주" }], answer: { field: "durationWeeks", value: "12" } }), { callModel: cm, today: TODAY, tagDict: DICT });
    if (!r.ok) throw new Error();
    expect(r.body.draft.endDate).toBe("2027-01-17");
    expect(r.body.patch).toEqual({ endDate: "2027-01-17" });
    expect(vi.mocked(cm).mock.calls[0][0].state.draft.endDate).toBe("2027-01-17");
  });
  it("모델 실패·스키마 밖 출력 → AI_UNAVAILABLE", async () => {
    const fail: CallModel = async () => ({ ok: false, status: 529 });
    expect(await runTurn(req(), { callModel: fail, today: TODAY, tagDict: DICT })).toEqual({ ok: false, error: "AI_UNAVAILABLE", status: 529 });
    const bad: CallModel = async () => ({ ok: true, turn: { say: 1 }, usage: { in: 0, out: 0, cached: 0 }, model: "m" });
    expect((await runTurn(req(), { callModel: bad, today: TODAY, tagDict: DICT })).ok).toBe(false);
  });
  it("say 는 600자로 자르고 제어문자 제거", async () => {
    const r = await runTurn(req(), { callModel: model({ say: "\u0000" + "가".repeat(700) }), today: TODAY, tagDict: DICT });
    if (!r.ok) throw new Error();
    expect([...r.body.say].length).toBe(600);
  });
  it("턴 상한·시작 판정", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: "a" }));
    expect(turnLimitExceeded(req({ messages: many }))).toBe(true);
    expect(turnLimitExceeded(req({ messages: many.slice(0, 24) }))).toBe(false);
    expect(isStart(req())).toBe(true);
    expect(isStart(req({ messages: [{ role: "assistant", text: "q" }, { role: "user", text: "a" }] }))).toBe(false);
  });
});

describe("InterviewRequest", () => {
  it("메시지 500자 초과·모르는 role 은 거부", () => {
    expect(InterviewRequest.safeParse({ messages: [{ role: "user", text: "가".repeat(501) }] }).success).toBe(false);
    expect(InterviewRequest.safeParse({ messages: [{ role: "system", text: "x" }] }).success).toBe(false);
    expect(InterviewRequest.safeParse({ messages: [] }).success).toBe(true);
  });
});

describe("목 대본(AI_INTERVIEW_MOCK) — 처음부터 끝까지 결정적으로 완주", () => {
  it("주제 → 시작 → 기간 → 인원(500 → 다시) → 공개 → 진행 방식 → 추가 → 요약 done", async () => {
    let draft: Record<string, unknown> = {};
    const messages: { role: "user" | "assistant"; text: string }[] = [];
    const turn = async (text?: string, answer?: { field: string; value: string }) => {
      if (text) messages.push({ role: "user", text });
      const r = await runTurn(req({ draft, messages: [...messages], answer: answer as never }), { callModel: mockCallModel, today: TODAY, tagDict: DICT });
      if (!r.ok) throw new Error("mock failed");
      draft = r.body.draft;
      messages.push({ role: "assistant", text: r.body.say });
      return r.body;
    };
    expect((await turn()).ask?.field).toBe("title");
    expect((await turn("aws saa 자격증 3개월")).ask?.field).toBe("startDate");
    expect((await turn("다음 주 월요일", { field: "startDate", value: "2026-10-26" })).ask?.field).toBe("durationWeeks");
    expect((await turn("12주", { field: "durationWeeks", value: "12" })).ask?.field).toBe("maxMembers");
    const over = await turn("500명");
    expect([over.ask?.field, over.dropped[0]?.field]).toEqual(["maxMembers", "maxMembers"]);
    expect((await turn("6명", { field: "maxMembers", value: "6" })).ask?.field).toBe("access");
    expect((await turn("공개 · 승인 후 참가", { field: "access", value: "public-approval" })).ask?.field).toBe("style");
    expect((await turn("매주 과제 제출, 회차별 시험", { field: "style", value: "weekly-task,exam" })).ask?.field).toBe("extra");
    const last = await turn("최소 4명은 모였으면");
    expect([last.done, last.missing]).toEqual([true, []]);
    expect(last.draft).toMatchObject({ title: "aws saa 자격증 3개월", startDate: "2026-10-26", endDate: "2027-01-17", maxMembers: 6, isPublic: true, joinMode: "approval", minMembers: 4 });
    expect(last.draft.tags?.[0]).toEqual({ slug: "aws", label: "AWS", tone: "mint" });
  });
  it("「장애 테스트」 → 실패", async () => {
    const r = await runTurn(req({ messages: [{ role: "user", text: "장애 테스트" }] }), { callModel: mockCallModel, today: TODAY, tagDict: DICT });
    expect(r.ok).toBe(false);
  });
});
