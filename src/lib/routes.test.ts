import { describe, expect, it } from "vitest";
import { loginUrl, routes, safeReturnTo } from "./routes";

describe("safeReturnTo (re-export of plan 01 return-to.ts)", () => {
  it("is the same function as plan 01", async () => {
    const p01 = await import("./supabase/return-to");
    expect(safeReturnTo).toBe(p01.safeReturnTo);
    expect(loginUrl).toBe(p01.loginUrl);
  });
  it("allows the four prefixes", () => {
    expect(safeReturnTo("/rooms/aws")).toBe("/rooms/aws");
    expect(safeReturnTo("/my-study")).toBe("/my-study");
    expect(safeReturnTo("/my-study/aws?tab=board")).toBe("/my-study/aws?tab=board");
    expect(safeReturnTo("/schedule")).toBe("/schedule");
    expect(safeReturnTo("/invite/abc")).toBe("/invite/abc");
  });
  it("rejects open redirects and unknown paths", () => {
    expect(safeReturnTo("https://evil.com")).toBe("/");
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("/roomsx")).toBe("/");
    expect(safeReturnTo("/me")).toBe("/");
    expect(safeReturnTo("/\\evil.com")).toBe("/");
    expect(safeReturnTo("/rooms/../me")).toBe("/");
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
  });
});

describe("routes", () => {
  it("builds auth routes", () => {
    expect(routes.login()).toBe("/login");
    expect(routes.login("/rooms/aws")).toBe("/login?returnTo=%2Frooms%2Faws");
    expect(routes.onboarding("/invite/t")).toBe("/onboarding?returnTo=%2Finvite%2Ft");
    expect(routes.me()).toBe("/me");
    expect(routes.invite("tok")).toBe("/invite/tok");
    expect(routes.createRoom()).toBe("/rooms/new");
    expect(routes.myStudyEdit("aws")).toBe("/my-study/aws?tab=curriculum&mode=edit");
  });
});
