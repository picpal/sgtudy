import { describe, expect, it } from "vitest";
import { fromPostgrest, httpStatusOf, nextStep, toolErrorText } from "./errors";

describe("fromPostgrest", () => {
  it("fail() 형식 → code·message·details", () =>
    expect(fromPostgrest({ message: "API_SCOPE_DENIED", details: "이 토큰으로는 할 수 없는 작업이에요", hint: '{"scope":"personal:write"}', code: "P0001" }))
      .toEqual({ code: "API_SCOPE_DENIED", message: "이 토큰으로는 할 수 없는 작업이에요", details: { scope: "personal:write" } }));
  it("그 밖 → INTERNAL(원문 비노출)", () =>
    expect(fromPostgrest({ message: "relation x does not exist", details: "", hint: "", code: "42P01" }))
      .toEqual({ code: "INTERNAL", message: "처리 중 오류가 났어요" }));
  it("hint 가 JSON 이 아니거나 빈 객체·배열 → details 없음", () => {
    expect(fromPostgrest({ message: "X_CODE", details: "문구", hint: "not json", code: "P0001" })).toEqual({ code: "X_CODE", message: "문구" });
    expect(fromPostgrest({ message: "X_CODE", details: null, hint: "{}", code: "P0001" })).toEqual({ code: "X_CODE", message: "X_CODE" });
    expect(fromPostgrest({ message: "X_CODE", details: "문구", hint: "[1]", code: "P0001" })).toEqual({ code: "X_CODE", message: "문구" });
  });
  it("P0001 이라도 코드 모양이 아니면 INTERNAL", () =>
    expect(fromPostgrest({ message: "some raise text", code: "P0001" }).code).toBe("INTERNAL"));
  it("〔C#12〕 57014(statement_timeout·취소) → TIMEOUT · 3초 안내", () => {
    const e = fromPostgrest({ message: "canceling statement due to statement timeout", code: "57014" });
    expect(e.code).toBe("TIMEOUT");
    expect(e.message).toContain("3초");
  });
});
describe("httpStatusOf", () => {
  it.each([["API_TOKEN_INVALID", 401], ["API_TOKEN_EXPIRED", 401], ["AUTH_REQUIRED", 401], ["API_AUTH_CONFLICT", 401], ["API_SCOPE_DENIED", 403],
           ["API_RATE_LIMITED", 429], ["PAYLOAD_TOO_LARGE", 413], ["NOT_CURRICULUM_EDITOR", 200]])("%s → %d", (c, s) => expect(httpStatusOf(c)).toBe(s));
});
describe("nextStep", () => {
  it.each(["PLAN_INVALID", "INVALID_TITLE", "INVALID_PERIOD", "VALIDATION_FAILED", "UNKNOWN_REF", "DUPLICATE_REF", "PLAN_TOO_LARGE",
           "ROUND_NOT_FOUND", "ROUND_AMBIGUOUS", "ASSIGNEE_NOT_MEMBER", "ASSIGNEE_AMBIGUOUS", "STUDY_NOT_FOUND", "STUDY_AMBIGUOUS",
           "NODE_NOT_FOUND", "NODE_DEPTH_EXCEEDED"])("%s → fix", (c) => expect(nextStep(c).kind).toBe("fix"));
  it.each(["STALE_VERSION", "PREVIEW_EXPIRED", "PREVIEW_NOT_FOUND"])("%s → reread(preview 다시)", (c) => {
    const s = nextStep(c);
    expect(s.kind).toBe("reread");
    expect(s.hint).toContain("preview_curriculum_plan");
  });
  it.each(["NOT_CURRICULUM_EDITOR", "API_TOKEN_EXPIRED", "API_TOKEN_INVALID", "API_RATE_LIMITED", "DESTRUCTIVE_OP_NOT_ALLOWED",
           "NODE_HAS_SUBMISSIONS", "NOTHING_TO_UNDO", "UNDO_STALE", "TIMEOUT", "PAYLOAD_TOO_LARGE", "SOMETHING_NEW"])("%s → stop", (c) =>
    expect(nextStep(c).kind).toBe("stop"));
  it("문구: 편집자 요청 · 토큰 재발급 · 웹에서 · 나눠 미리보기 · 스터디 묻기", () => {
    expect(nextStep("NOT_CURRICULUM_EDITOR").hint).toContain("그룹장");
    expect(nextStep("API_TOKEN_EXPIRED").hint).toContain("/me 「AI 연결」");
    expect(nextStep("API_TOKEN_INVALID").hint).toContain("폐기");
    expect(nextStep("DESTRUCTIVE_OP_NOT_ALLOWED").hint).toContain("웹에서");
    expect(nextStep("UNDO_STALE").hint).toContain("일정 변경만");
    expect(nextStep("TIMEOUT").hint).toContain("나눠");
    expect(nextStep("STUDY_AMBIGUOUS", { candidates: [{ slug: "aws" }] }).hint).toContain("사용자에게 어느 스터디");
  });
  it("후보가 있으면 후보 중 하나로 · 레이트리밋은 retryAfterSec", () => {
    expect(nextStep("ROUND_NOT_FOUND", { candidates: ["1주차"] }).hint).toContain("후보 중 하나");
    expect(nextStep("API_RATE_LIMITED", { retryAfterSec: 42 }).hint).toContain("42초 뒤");
  });
});
describe("toolErrorText", () => {
  it("한 줄 + 다음 행동", () =>
    expect(toolErrorText({ code: "STALE_VERSION", message: "미리본 뒤에 진행목표가 바뀌었어요" }))
      .toBe("오류 STALE_VERSION: 미리본 뒤에 진행목표가 바뀌었어요\n→ 다음: 같은 계획으로 preview_curriculum_plan 을 다시 부르세요(재시도 가능)"));
  it("경로별 오류 최대 20줄 + 외 N건", () => {
    const errors = Array.from({ length: 25 }, (_, i) => ({ path: `ops[${i}]`, code: "INVALID_TITLE", message: "제목을 넣어 주세요", field: "title" }));
    const lines = toolErrorText({ code: "PLAN_INVALID", message: "계획서에 고칠 곳이 있어요", details: { errors } }).split("\n");
    expect(lines[1]).toBe("- ops[0] title INVALID_TITLE: 제목을 넣어 주세요");
    expect(lines.filter((l) => l.startsWith("- ops["))).toHaveLength(20);
    expect(lines).toContain("- … 외 5건");
    expect(lines.at(-1)).toMatch(/^→ 다음: 표시한 경로를 고쳐/);
  });
  it("후보: 문자열 · {slug,title} 객체 모두 사람이 읽는 글로", () => {
    expect(toolErrorText({ code: "ROUND_AMBIGUOUS", message: "겹쳐요", details: { candidates: ["1번째 · 1주차 · A", "2번째 · 1주차 · B"] } }))
      .toContain("후보: 1번째 · 1주차 · A, 2번째 · 1주차 · B");
    const t = toolErrorText({ code: "STUDY_AMBIGUOUS", message: "둘 이상", details: { candidates: [{ slug: "aws", title: "AWS SAA" }, { slug: "aws2", title: "AWS 심화" }] } });
    expect(t).toContain("후보: aws(AWS SAA), aws2(AWS 심화)");
    expect(t).not.toContain("[object Object]");
  });
});
