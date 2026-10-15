import { describe, expect, it } from "vitest";
import { CAPTCHA_FAILED_TEXT, CAPTCHA_MISSING_TEXT, captchaBlock, captchaOptions, captchaSiteKey } from "./captcha";
import { authErrorMessage } from "./otp";

describe("Turnstile 기능 플래그", () => {
  it("site key 가 없거나 비어 있으면 꺼짐", () => {
    expect(captchaSiteKey(undefined)).toBeNull();
    expect(captchaSiteKey("")).toBeNull();
    expect(captchaSiteKey("   ")).toBeNull();
  });
  it("site key 가 있으면 앞뒤 공백을 떼고 켜짐", () => {
    expect(captchaSiteKey(" 1x00000000000000000000AA\n")).toBe("1x00000000000000000000AA");
  });
});

describe("보내기 전 토큰 확인", () => {
  it("꺼져 있으면 토큰 없이도 막지 않는다(지금 동작 그대로)", () => {
    expect(captchaBlock(false, null)).toBeNull();
  });
  it("켜져 있는데 토큰이 없으면(아직·만료) 한국어 안내로 막는다", () => {
    expect(captchaBlock(true, null)).toBe(CAPTCHA_MISSING_TEXT);
    expect(captchaBlock(true, "")).toBe(CAPTCHA_MISSING_TEXT);
  });
  it("토큰이 있으면 보낸다", () => {
    expect(captchaBlock(true, "XXXX.DUMMY.TOKEN.XXXX")).toBeNull();
  });
});

describe("captchaToken 옵션", () => {
  it("토큰이 없으면 options 에 아무것도 더하지 않는다", () => {
    expect(captchaOptions(null)).toEqual({});
    expect({ shouldCreateUser: true, ...captchaOptions(null) }).toEqual({ shouldCreateUser: true });
  });
  it("토큰이 있으면 captchaToken 으로 넣는다", () => {
    expect({ shouldCreateUser: false, ...captchaOptions("tok") }).toEqual({ shouldCreateUser: false, captchaToken: "tok" });
  });
});

describe("GoTrue captcha_failed → 한국어", () => {
  const err = Object.assign(new Error("captcha protection: request disallowed (timeout-or-duplicate)"), { code: "captcha_failed", status: 400 });
  it("모든 흐름에서 같은 안내(원문 영어를 그대로 보이지 않는다)", () => {
    for (const flow of ["login", "signup", "reset", "change"] as const) expect(authErrorMessage(err, flow)).toBe(CAPTCHA_FAILED_TEXT);
  });
});
