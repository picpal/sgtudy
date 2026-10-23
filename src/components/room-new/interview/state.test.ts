import { describe, expect, it } from "vitest";
import { INITIAL, isDirty, reduce, toMessages, userLines } from "./state";

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

describe("회차·모집 로컬 질문 (2단계 D33·D36)", () => {
  const done = { ...res, done: true, ask: null, missing: [] };
  it("style 칩 답을 기억 · done 이면 asking · 예 → busy → recruitAsking → 답 → settled", () => {
    let s = reduce(INITIAL, { type: "send", text: "매주 과제, 시험", answer: { field: "style", value: "weekly-task,exam" } });
    expect(s.style).toEqual(["weekly-task", "exam"]);
    s = reduce(s, { type: "send", text: "x", answer: { field: "extra", value: "y" } });
    expect(s.style).toEqual(["weekly-task", "exam"]); // 다른 칩 답은 덮지 않는다
    s = reduce(s, { type: "turn", res });
    expect(s.rounds).toBe("idle");
    s = reduce(s, { type: "turn", res: done });
    expect(s.rounds).toBe("asking");
    s = reduce(s, { type: "roundsStart" });
    expect(s.rounds).toBe("busy");
    s = reduce(s, { type: "roundsFail", err: { error: "AI_UNAVAILABLE", message: "m", status: 503 } });
    expect([s.rounds, s.roundsError?.status]).toEqual(["error", 503]);
    s = reduce(s, { type: "roundsStart" });
    expect([s.rounds, s.roundsError]).toEqual(["busy", null]);
    s = reduce(s, { type: "roundsDone" });
    expect(s.rounds).toBe("recruitAsking");
    s = reduce(s, { type: "recruitAnswer", yes: false });
    expect([s.rounds, s.openRecruit]).toEqual(["settled", false]);
    // 답한 뒤 대화를 이어 가도 다시 묻지 않는다
    expect(reduce(s, { type: "turn", res: done }).rounds).toBe("settled");
  });
  it("아니요 → settled · 모집은 안 물음(null)", () => {
    const s = reduce(reduce(INITIAL, { type: "turn", res: done }), { type: "roundsSkip" });
    expect([s.rounds, s.openRecruit]).toEqual(["settled", null]);
  });
  it("userLines: user 줄만 뒤에서 12개", () => {
    let s = INITIAL;
    for (let i = 0; i < 15; i++) s = reduce(reduce(s, { type: "send", text: `u${i}`, answer: null }), { type: "turn", res });
    expect(userLines(s)).toEqual(Array.from({ length: 12 }, (_, i) => `u${i + 3}`));
  });
  it("로컬 질문·답(localAnswer)은 로그에 남지만 서버 대화·회차 발화에서는 빠진다", () => {
    let s = reduce(INITIAL, { type: "turn", res: { ...res, say: "요약", done: true, ask: null, missing: [] } });
    s = reduce(s, { type: "localAnswer", question: "회차 초안도 잡아 드릴까요?", answer: "네, 잡아 주세요" });
    expect(s.lines.map((l) => [l.id, l.role, l.text, !!l.local])).toEqual([[1, "assistant", "요약", false], [2, "assistant", "회차 초안도 잡아 드릴까요?", true], [3, "user", "네, 잡아 주세요", true]]);
    expect(toMessages(s)).toEqual([{ role: "assistant", text: "요약" }]);
    expect(userLines(s)).toEqual([]);
  });
});
