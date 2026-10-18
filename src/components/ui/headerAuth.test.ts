import { describe, expect, it } from "vitest";
import { anonAuthLinks } from "./headerAuth";

describe("anonAuthLinks — 비로그인 헤더: 회원가입 + 로그인 (시나리오 QA D4·#21)", () => {
  it("회원가입(보조)·로그인(주) 둘 다, 같은 복귀 주소", () => {
    expect(anonAuthLinks("/rooms/aws?tab=x")).toEqual([
      { key: "signup", label: "회원가입", href: "/signup?returnTo=%2Frooms%2Faws%3Ftab%3Dx", primary: false },
      { key: "login", label: "로그인", href: "/login?returnTo=%2Frooms%2Faws%3Ftab%3Dx", primary: true },
    ]);
  });
  it("허용 밖 주소는 / 로 (safeReturnTo)", () => {
    expect(anonAuthLinks("/zzz").map((l) => l.href)).toEqual(["/signup?returnTo=%2F", "/login?returnTo=%2F"]);
  });
});
