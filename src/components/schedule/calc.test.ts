import { describe, expect, it } from "vitest";
import { barLook, isUrgent, monthSel, statusLabel, taskHref } from "./calc";

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

describe("barLook (내 일정 막대 — 시안 A-8)", () => {
  const S = { id: "aws", name: "AWS", bg: "#DDF4EE", fg: "#0B6553", dot: "#12A386" } as const;
  const T = (over: Partial<Parameters<typeof barLook>[0]>) => ({ st: "open" as const, mine: true, personal: false, ...over });
  it("개인 목표: 흰 바탕 + slate 글자 + 1.5px slate 점선 (채움은 스터디 색이 아니다)", () => {
    expect(barLook(T({ personal: true, st: "planned" }), S)).toMatchObject({ fill: "var(--surface)", color: "var(--personal-ink)", line: "1.5px dashed var(--personal-line)", badge: true });
  });
  it("개인 목표가 임박(진행 중·내 것)이면 굵은 글자로 강조 — 점선은 유지", () => {
    expect(barLook(T({ personal: true }), S)).toMatchObject({ weight: 700, line: "1.5px dashed var(--personal-line)" });
  });
  it("시작 전 팀 과제는 1px 스터디색 점선 + 배지 없음 — 개인과 굵기·색·배지로 구분", () => {
    expect(barLook(T({ st: "planned" }), S)).toMatchObject({ fill: "#FFFFFF", color: S.fg, line: `1px dashed ${S.dot}`, badge: false, weight: 500 });
  });
  it("임박 팀 과제는 1.5px 실선", () => expect(barLook(T({}), S)).toMatchObject({ fill: S.bg, line: `1.5px solid ${S.dot}`, weight: 700 }));
});

describe("statusLabel (개인 목표는 완료 문구 — 내 과제·진행목표와 같은 값)", () => {
  it("개인: 늦게 완료 / 기한내 완료 / 기한 지남", () => {
    expect(statusLabel({ st: "late", personal: true })).toBe("늦게 완료");
    expect(statusLabel({ st: "done", personal: true })).toBe("기한내 완료");
    expect(statusLabel({ st: "missed", personal: true })).toBe("기한 지남");
  });
  it("팀 과제: 제출 문구 그대로", () => expect(statusLabel({ st: "late" })).toBe("지각 제출"));
});
