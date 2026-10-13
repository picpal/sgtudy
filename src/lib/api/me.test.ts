import { describe, expect, it } from "vitest";
import { NICK_PROBLEM_TEXT, nicknameProblem } from "./me";

describe("nicknameProblem (0002 nickname_problem 의 클라이언트 거울)", () => {
  it("accepts 2~16 chars of 한글/영문/숫자/_/./single space", () => {
    expect(nicknameProblem("철수")).toBeNull();
    expect(nicknameProblem("chul_soo.99")).toBeNull();
    expect(nicknameProblem("철 수")).toBeNull();
    expect(nicknameProblem("a".repeat(16))).toBeNull();
  });
  it("checks the NFC form (NFD 한글도 완성형으로 본다)", () => {
    expect(nicknameProblem("철수".normalize("NFD"))).toBeNull();
  });
  it("rejects length outside 2~16", () => {
    expect(nicknameProblem("a")).toBe("length");
    expect(nicknameProblem("a".repeat(17))).toBe("length");
  });
  it("does not trim: surrounding whitespace is invalid like the server", () => {
    expect(nicknameProblem(" 철 ")).toBe("invalid");
    expect(nicknameProblem("철수 ")).toBe("invalid");
  });
  it("rejects jamo-only Hangul (server accepts 가-힣 syllables only)", () => {
    expect(nicknameProblem("ㅋㅋ")).toBe("jamo");
  });
  it("rejects disallowed characters", () => {
    expect(nicknameProblem("chul-soo")).toBe("chars");
    expect(nicknameProblem("철수!")).toBe("chars");
  });
  it("jamo / edge-space copy stays on its own topic (Q2-17)", () => {
    expect(NICK_PROBLEM_TEXT.jamo).not.toContain("공백");
    expect(NICK_PROBLEM_TEXT.jamo).toContain("완성된 한글");
    expect(NICK_PROBLEM_TEXT.invalid).not.toContain("한글");
  });
  it("rejects consecutive spaces", () => {
    expect(nicknameProblem("철  수")).toBe("spaces");
  });
});
