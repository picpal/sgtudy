import { describe, expect, it } from "vitest";
import { EMPTY_DIGITS, applyBackspace, applyDigit, applyPaste, authErrorMessage, isComplete, isResetNoAccount, rateLimitWait } from "./otp";

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
  it("maps password login / password policy codes", () => {
    expect(authErrorMessage({ name: "AuthApiError", code: "invalid_credentials", message: "Invalid login credentials" })).toBe("이메일 또는 비밀번호가 맞지 않아요");
    expect(authErrorMessage({ name: "AuthWeakPasswordError", code: "weak_password", message: "x" })).toBe("비밀번호는 8자 이상, 영문과 숫자를 함께 써 주세요");
    expect(authErrorMessage({ name: "AuthApiError", code: "same_password", message: "x" })).toBe("지금 쓰는 비밀번호와 다른 비밀번호를 정해 주세요");
    expect(authErrorMessage({ name: "AuthApiError", code: "over_request_rate_limit", message: "x" })).toBe("요청이 너무 많아요 · 잠시 후 다시 시도해 주세요");
  });
  it("reset flow: unknown email does not reveal whether an account exists", () => {
    const noSignup = { name: "AuthApiError", code: "otp_disabled", message: "Signups not allowed for otp" };
    expect(authErrorMessage(noSignup, "reset")).toBe("가입된 계정이 없거나 코드를 보낼 수 없어요");
    expect(authErrorMessage(noSignup)).toBe("이메일 로그인이 꺼져 있어요 · 관리자에게 문의해 주세요");
    expect(authErrorMessage({ name: "AuthApiError", code: "otp_expired", message: "x" }, "reset")).toBe("코드가 맞지 않거나 만료됐어요");
  });
  it("reset flow: no-account errors are treated as sent (isResetNoAccount)", () => {
    expect(isResetNoAccount({ name: "AuthApiError", code: "otp_disabled", message: "Signups not allowed for otp" })).toBe(true);
    expect(isResetNoAccount({ name: "AuthApiError", code: "user_not_found", message: "x" })).toBe(true);
    expect(isResetNoAccount({ name: "AuthApiError", code: "over_email_send_rate_limit", message: "x" })).toBe(false);
    expect(isResetNoAccount(new Error("x"))).toBe(false);
    expect(isResetNoAccount(null)).toBe(false);
  });
  it("maps reauthentication codes (password change on /me)", () => {
    expect(authErrorMessage({ name: "AuthApiError", code: "reauthentication_not_valid", message: "x" })).toBe("코드가 맞지 않거나 만료됐어요");
    expect(authErrorMessage({ name: "AuthApiError", code: "reauthentication_needed", message: "x" })).toBe("보안을 위해 이메일 인증을 다시 해 주세요");
  });
  it("falls back to a generic message", () => {
    expect(authErrorMessage(new TypeError("Failed to fetch"))).toBe("로그인에 실패했어요 · Failed to fetch");
    expect(authErrorMessage("??")).toBe("로그인에 실패했어요");
  });
});

describe("rateLimitWait (Q2-08/Q2-30)", () => {
  const rl = (message: string) => ({ name: "AuthApiError", code: "over_email_send_rate_limit", message });
  it("reads the seconds GoTrue puts in the message", () => {
    expect(rateLimitWait(rl("For security purposes, you can only request this after 47 seconds."), null, 0)).toBe(47);
  });
  it("falls back to the time since our own send, then to a full minute", () => {
    expect(rateLimitWait(rl("email rate limit exceeded"), 10_000, 25_500)).toBe(45);
    expect(rateLimitWait(rl("email rate limit exceeded"), null, 0)).toBe(60);
  });
  it("other errors are not a send rate limit", () => {
    expect(rateLimitWait({ name: "AuthApiError", code: "otp_expired", message: "after 3 seconds" }, null, 0)).toBeNull();
    expect(rateLimitWait(new Error("x"), null, 0)).toBeNull();
  });
});
