import { describe, expect, it } from "vitest";
import { otpFlowStep, signupAccountKind } from "./flow";

describe("signupAccountKind (가입 코드 확인 직후)", () => {
  const now = Date.parse("2026-10-14T10:00:00Z");
  it("has_password flag wins", () => {
    expect(signupAccountKind({ created_at: "2026-10-14T09:59:00Z", user_metadata: { has_password: true } }, now)).toBe("has_password");
    expect(signupAccountKind({ created_at: "2025-01-01T00:00:00Z", user_metadata: { has_password: true } }, now)).toBe("has_password");
  });
  it("account created by this sign-up's code send is new", () => {
    expect(signupAccountKind({ created_at: "2026-10-14T09:51:00Z", user_metadata: {} }, now)).toBe("new");
  });
  it("older account without the flag is an existing code-only account", () => {
    expect(signupAccountKind({ created_at: "2026-10-13T09:00:00Z", user_metadata: {} }, now)).toBe("existing");
    expect(signupAccountKind({ created_at: "2026-10-14T09:40:00Z", user_metadata: null }, now)).toBe("existing");
    expect(signupAccountKind({ user_metadata: { has_password: "true" } }, now)).toBe("existing"); // 문자열은 플래그 아님
  });
});

describe("otpFlowStep", () => {
  it("email → code only with ?step=code and a sent address", () => {
    expect(otpFlowStep(null, false, null)).toBe("email");
    expect(otpFlowStep(null, true, null)).toBe("email"); // 새로고침: 보낸 주소 없음
    expect(otpFlowStep(null, false, "a@b.c")).toBe("email"); // 뒤로가기
    expect(otpFlowStep(null, true, "a@b.c")).toBe("otp");
  });
  it("after verify: password, or the already-has-password notice", () => {
    expect(otpFlowStep("new", true, "a@b.c")).toBe("password");
    expect(otpFlowStep("existing", false, "a@b.c")).toBe("password");
    expect(otpFlowStep("reset", true, "a@b.c")).toBe("password");
    expect(otpFlowStep("has_password", true, "a@b.c")).toBe("notice");
  });
});
