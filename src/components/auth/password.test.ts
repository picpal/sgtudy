import { describe, expect, it } from "vitest";
import { PASSWORD_MIN, passwordFormError, passwordProblem } from "./password";

describe("passwordProblem (config.toml minimum_password_length = 8, letters_digits)", () => {
  it("needs at least 8 characters", () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(passwordProblem("")).toBe("length");
    expect(passwordProblem("abc1234")).toBe("length");
    expect(passwordProblem("abcd1234")).toBeNull();
  });
  it("needs both a letter and a digit", () => {
    expect(passwordProblem("abcdefgh")).toBe("letters_digits");
    expect(passwordProblem("12345678")).toBe("letters_digits");
    expect(passwordProblem("한글비밀번호12")).toBe("letters_digits"); // 서버 letters 는 [a-zA-Z]
    expect(passwordProblem("한글pw비밀번호12")).toBeNull();
    expect(passwordProblem("ABCD!@#1")).toBeNull();
  });
  it("counts code points, not UTF-16 units", () => {
    expect(passwordProblem("a1😀😀😀😀😀")).toBe("length");
  });
});

describe("passwordFormError", () => {
  it("reports policy first, then confirmation", () => {
    expect(passwordFormError("abc", "abc")).toBe("비밀번호는 8자 이상이어야 해요");
    expect(passwordFormError("abcdefgh", "abcdefgh")).toBe("비밀번호에 영문과 숫자를 함께 써 주세요");
    expect(passwordFormError("abcd1234", "abcd1235")).toBe("비밀번호 확인이 맞지 않아요");
    expect(passwordFormError("abcd1234", "abcd1234")).toBeNull();
  });
});
