import { describe, expect, it } from "vitest";
import { z } from "zod";
import { planDoc } from "./plan-schema";

describe("planDoc", () => {
  it("create(중첩·닉네임·{round})·update·move·shift 를 받는다", () => {
    const r = planDoc.safeParse({
      schema: "sgtudy.plan/v1",
      ops: [
        { op: "create", parent: null, label: "1주차", title: "IAM", startDate: "2026-11-01", endDate: "2026-11-07",
          children: [{ title: "정책 실습", taskType: "designated", assignees: ["지은"] }] },
        { op: "create", parent: { round: "current" }, title: "추가 과제" },
        { op: "update", id: "203", set: { endDate: "2026-11-09", shiftDescendants: true } },
        { op: "move", id: "@a", parent: "201", index: 0 },
        { op: "shift", from: "3주차", days: 7 },
      ],
    });
    expect(r.success).toBe(true);
  });
  it("알 수 없는 op · 빈 ops · 날짜 형식 · days 범위 거부", () => {
    expect(planDoc.safeParse({ schema: "sgtudy.plan/v1", ops: [{ op: "archive", id: "1" }] }).success).toBe(false);
    expect(planDoc.safeParse({ schema: "sgtudy.plan/v1", ops: [] }).success).toBe(false);
    expect(planDoc.safeParse({ schema: "sgtudy.plan/v1", ops: [{ op: "create", title: "x", startDate: "11/01" }] }).success).toBe(false);
    expect(planDoc.safeParse({ schema: "sgtudy.plan/v1", ops: [{ op: "shift", from: 1, days: 400 }] }).success).toBe(false);
  });
  it("op 객체는 추가 키 허용(서버가 최종 검증)", () =>
    expect(planDoc.safeParse({ schema: "sgtudy.plan/v1", ops: [{ op: "create", title: "x", assigneeIds: ["u"] }] }).success).toBe(true));
  it("JSON Schema 로 바꿀 수 있고 설명은 영어", () => {
    const s = JSON.stringify(z.toJSONSchema(planDoc));
    expect(s).toContain("nicknames or userIds");
    expect(s.replaceAll("3주차", "")).not.toMatch(/[가-힣]/);   // 예시 라벨 "3주차" 외 한국어 없음
  });
});
