import { describe, expect, it } from "vitest";
import { INITIAL, isDirty, reduce, toMessages } from "./state";

const res = { say: "언제 시작할까요?", patch: {}, draft: {}, ask: { field: "startDate" as const, kind: "single" as const }, missing: ["startDate" as const], dropped: [], done: false, turn: 1, turnsLeft: 12 };

describe("인터뷰 상태 리듀서", () => {
  it("start → turn → send → fail → retry → turn", () => {
    let s = reduce(INITIAL, { type: "start" });
    expect([s.started, s.busy]).toEqual([true, true]);
    s = reduce(s, { type: "turn", res });
    expect([s.busy, s.ask?.field, s.lines]).toEqual([false, "startDate", [{ id: 1, role: "assistant", text: "언제 시작할까요?" }]]);
    expect(isDirty(s)).toBe(false);
    s = reduce(s, { type: "send", text: "다음 주 월요일", answer: { field: "startDate", value: "2026-10-26" } });
    expect([s.busy, s.ask, s.lastAnswer?.value, isDirty(s)]).toEqual([true, null, "2026-10-26", true]);
    expect(toMessages(s)).toEqual([{ role: "assistant", text: "언제 시작할까요?" }, { role: "user", text: "다음 주 월요일" }]);
    s = reduce(s, { type: "fail", err: { error: "AI_UNAVAILABLE", message: "m", status: 503 } });
    expect([s.busy, s.error?.error, s.limit]).toEqual([false, "AI_UNAVAILABLE", false]);
    s = reduce(s, { type: "retry" });
    expect([s.busy, s.error]).toEqual([true, null]);
    s = reduce(s, { type: "turn", res: { ...res, done: true, ask: null, missing: [] } });
    expect([s.done, s.lines.length, s.lines[2].id]).toEqual([true, 3, 3]);
  });
  it("409 AI_TURN_LIMIT 는 limit 을 켠다", () => {
    expect(reduce(INITIAL, { type: "fail", err: { error: "AI_TURN_LIMIT", message: "m", status: 409 } }).limit).toBe(true);
  });
});
