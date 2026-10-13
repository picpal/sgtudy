import { describe, expect, it } from "vitest";
import { nicknameProblem } from "./me";

describe("nicknameProblem (03-api §1 닉네임 규칙의 클라이언트 선검사)", () => {
  it("accepts 2~16 chars of 한글/영문/숫자/_/./single space", () => {
    expect(nicknameProblem("철수")).toBeNull();
    expect(nicknameProblem("chul_soo.99")).toBeNull();
    expect(nicknameProblem("철 수")).toBeNull();
    expect(nicknameProblem("a".repeat(16))).toBeNull();
  });
  it("rejects length outside 2~16 (after trim)", () => {
    expect(nicknameProblem("a")).toBe("length");
    expect(nicknameProblem(" 철 ")).toBe("length");
    expect(nicknameProblem("a".repeat(17))).toBe("length");
  });
  it("rejects disallowed characters", () => {
    expect(nicknameProblem("chul-soo")).toBe("chars");
    expect(nicknameProblem("철수!")).toBe("chars");
  });
  it("rejects consecutive spaces", () => {
    expect(nicknameProblem("철  수")).toBe("spaces");
  });
});
