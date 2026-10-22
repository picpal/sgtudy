import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { feedbackContext, feedbackErrorText, submitFeedback, validateFeedback } from "./feedback";

const fake = (data: unknown = {}) => {
  const calls: [string, unknown][] = [];
  const client = { rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve({ data, error: null }); } } as unknown as Db;
  return { calls, client };
};

describe("feedback adapter (0044)", () => {
  it("submitFeedback → feedback_submit(p_kind, p_message, p_context)", async () => {
    const f = fake({ id: "1", createdAt: "2026-10-22T01:00:00Z" });
    const ctx = { path: "/tasks", userAgent: "UA", viewport: "390x844", appVersion: "dev" };
    expect(await submitFeedback("BUG", "버튼이 안 눌려요", ctx, f.client)).toEqual({ id: "1", createdAt: "2026-10-22T01:00:00Z" });
    expect(f.calls).toEqual([["feedback_submit", { p_kind: "BUG", p_message: "버튼이 안 눌려요", p_context: ctx }]]);
  });

  it("validateFeedback: 앞뒤 공백 뺀 5~2,000자", () => {
    expect(validateFeedback("  넷글자요  ")).toBe("내용은 5~2,000자예요");
    expect(validateFeedback("다섯글자요")).toBeNull();
    expect(validateFeedback("가".repeat(2000))).toBeNull();
    expect(validateFeedback("가".repeat(2001))).toBe("내용은 5~2,000자예요");
  });

  it("feedbackContext: 허용 쿼리만 · invite 토큰 가림 · room slug", () => {
    expect(feedbackContext({ pathname: "/my-study/aws", search: "?tab=tasks&invite=SECRET&task=12" }, "UA", 390, 844, "abc1234")).toEqual({
      path: "/my-study/aws?tab=tasks&task=12", room: "aws", userAgent: "UA", viewport: "390x844", appVersion: "abc1234",
    });
    expect(feedbackContext({ pathname: "/invite/tok-123", search: "" }, "UA", 1, 1).path).toBe("/invite/…");
    expect(feedbackContext({ pathname: "/rooms/aws/settings", search: "?from=x" }, "UA", 1, 1).room).toBe("aws");
    const c = feedbackContext({ pathname: "/rooms/new", search: "" }, "U".repeat(600), 1, 1);
    expect([c.room, c.userAgent.length, c.appVersion]).toEqual([undefined, 500, "dev"]);
  });

  it("feedbackErrorText: 서버 문구 우선 · UNKNOWN 은 기본 문구", () => {
    expect(feedbackErrorText({ code: "RATE_LIMITED", message: "오늘은 의견을 더 보낼 수 없어요 · 내일 다시 보내 주세요" })).toBe("오늘은 의견을 더 보낼 수 없어요 · 내일 다시 보내 주세요");
    expect(feedbackErrorText({ code: "RATE_LIMITED", message: "RATE_LIMITED" })).toBe("의견을 너무 자주 보내고 있어요 · 잠시 후 다시 보내 주세요");
    expect(feedbackErrorText({ code: "UNKNOWN", message: "Failed to fetch" })).toBe("보내지 못했어요 · 잠시 후 다시 시도해 주세요");
  });
});
