import { describe, expect, it } from "vitest";
import { EMPTY_DIGITS, applyBackspace, applyDigit, applyPaste, authErrorMessage, isComplete } from "./otp";

describe("OTP digit model (§4.1 자동 포커스 이동)", () => {
  it("typing a digit fills the box and moves focus right", () => {
    const r = applyDigit(EMPTY_DIGITS, 0, "7");
    expect(r.digits).toEqual(["7", "", "", "", "", ""]);
    expect(r.focus).toBe(1);
  });
  it("keeps only the last digit typed into a box and ignores non-digits", () => {
    expect(applyDigit(EMPTY_DIGITS, 2, "ab3")).toEqual({ digits: ["", "", "3", "", "", ""], focus: 3 });
    expect(applyDigit(EMPTY_DIGITS, 2, "x")).toEqual({ digits: EMPTY_DIGITS, focus: 2 });
  });
  it("one-time-code autofill (6 digits into one box) fills all boxes like a paste", () => {
    expect(applyDigit(EMPTY_DIGITS, 0, "123456")).toEqual({ digits: ["1", "2", "3", "4", "5", "6"], focus: 5 });
    expect(applyDigit(["9", "", "", "", "", ""], 3, "654321")).toEqual({ digits: ["6", "5", "4", "3", "2", "1"], focus: 5 });
  });
  it("last box keeps focus at 5", () => {
    expect(applyDigit(EMPTY_DIGITS, 5, "9").focus).toBe(5);
  });
  it("paste fills from the current box and focuses the last filled box", () => {
    expect(applyPaste(EMPTY_DIGITS, "123456", 0)).toEqual({ digits: ["1", "2", "3", "4", "5", "6"], focus: 5 });
    expect(applyPaste(EMPTY_DIGITS, "12-34", 2)).toEqual({ digits: ["", "", "1", "2", "3", "4"], focus: 5 });
  });
  it("backspace on an empty box clears the previous box and moves left", () => {
    const d: typeof EMPTY_DIGITS = ["1", "2", "", "", "", ""];
    expect(applyBackspace(d, 2)).toEqual({ digits: ["1", "", "", "", "", ""], focus: 1 });
    expect(applyBackspace(d, 1)).toEqual({ digits: ["1", "", "", "", "", ""], focus: 1 });
    expect(applyBackspace(EMPTY_DIGITS, 0).focus).toBe(0);
  });
  it("isComplete", () => {
    expect(isComplete(["1", "2", "3", "4", "5", "6"])).toBe(true);
    expect(isComplete(["1", "2", "3", "4", "5", ""])).toBe(false);
  });
});

describe("authErrorMessage", () => {
  it("maps Supabase auth codes", () => {
    expect(authErrorMessage({ name: "AuthApiError", code: "over_email_send_rate_limit", message: "x" })).toBe("잠시 후 다시 시도해 주세요 · 인증 코드는 1분에 한 번만 보낼 수 있어요");
    expect(authErrorMessage({ name: "AuthApiError", code: "otp_expired", message: "x" })).toBe("코드가 맞지 않거나 만료됐어요");
    expect(authErrorMessage({ name: "AuthApiError", code: "otp_disabled", message: "x" })).toBe("이메일 로그인이 꺼져 있어요 · 관리자에게 문의해 주세요");
  });
  it("falls back to a generic message", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"))).toBe("로그인에 실패했어요 · Failed to fetch");
    expect(authErrorMessage("??")).toBe("로그인에 실패했어요");
  });
});
