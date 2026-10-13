import { describe, expect, it } from "vitest";
import { isUrgent, monthSel, taskHref } from "./calc";

describe("isUrgent", () => {
  it("open and mine (or mine unset) → urgent", () => {
    expect(isUrgent({ st: "open" })).toBe(true);
    expect(isUrgent({ st: "open", mine: true })).toBe(true);
  });
  it("leader-only task (mine:false) never urgent, even if open", () => {
    expect(isUrgent({ st: "open", mine: false })).toBe(false);
  });
  it("other statuses are not urgent", () => {
    expect(isUrgent({ st: "planned" })).toBe(false);
    expect(isUrgent({ st: "done" })).toBe(false);
  });
});

describe("monthSel — 달을 옮기면 선택일은 그 달의 오늘, 아니면 1일 (Q1-19/Q3-20)", () => {
  it("today's month → today", () => {
    expect(monthSel(2026, 9, "2026-10-12")).toBe("2026-10-12");
  });
  it("other month → that month's 1st (never the previous month's grid cell)", () => {
    expect(monthSel(2026, 10, "2026-10-12")).toBe("2026-11-01");
    expect(monthSel(2026, 7, "2026-10-12")).toBe("2026-08-01");
    expect(monthSel(2027, 0, "2026-10-12")).toBe("2027-01-01");
  });
});

describe("taskHref — 과제는 내 스터디의 그 리프로 (Q1-09/Q1-20)", () => {
  it("joined study → /my-study/<slug>?task=<id>", () => {
    expect(taskHref({ id: "21", study: "aws" }, { pending: undefined })).toBe("/my-study/aws?task=21");
  });
  it("pending study → public room view (spec §표: 승인 대기는 RoomView)", () => {
    expect(taskHref({ id: "21", study: "sqld" }, { pending: true })).toBe("/rooms/sqld");
  });
});
