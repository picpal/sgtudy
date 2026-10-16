import { describe, expect, it } from "vitest";
import { isProtectedPath, loginUrl, safeReturnTo } from "./return-to";

describe("isProtectedPath", () => {
  it("protects my-study, schedule, tasks, me, rooms/new", () => {
    for (const p of ["/my-study", "/my-study/aws", "/schedule", "/tasks", "/me", "/rooms/new"]) expect(isProtectedPath(p)).toBe(true);
  });
  it("leaves public pages alone", () => {
    for (const p of ["/", "/rooms", "/rooms/aws", "/login", "/invite/abc", "/onboarding"]) expect(isProtectedPath(p)).toBe(false);
  });
});

describe("safeReturnTo", () => {
  it("accepts allow-listed prefixes", () => {
    expect(safeReturnTo("/rooms/aws")).toBe("/rooms/aws");
    expect(safeReturnTo("/my-study/aws?task=3")).toBe("/my-study/aws?task=3");
    expect(safeReturnTo("/schedule")).toBe("/schedule");
    expect(safeReturnTo("/tasks")).toBe("/tasks");
    expect(safeReturnTo("/tasks?group=due&scope=all")).toBe("/tasks?group=due&scope=all");
    expect(safeReturnTo("/invite/abc123")).toBe("/invite/abc123");
  });
  it("falls back to / for anything else (Review Focus 2)", () => {
    for (const bad of [null, undefined, "", "/", "/me", "//evil.com", "/\\evil.com", "https://evil.com", "/rooms/../me",
                       "javascript:alert(1)", "/roomsx", " /rooms/aws", "/rooms/aws\n",
                       "/rooms/%2e%2e/me", "/rooms%2Faws"]) {
      expect(safeReturnTo(bad)).toBe("/");
    }
  });
  it("404 paths: unknown top-level → / (by design), unknown room keeps its path (V1-03)", () => {
    expect(safeReturnTo("/zzz")).toBe("/");
    expect(safeReturnTo("/rooms/nope")).toBe("/rooms/nope");
  });
});

describe("loginUrl", () => {
  it("encodes returnTo", () => {
    expect(loginUrl("/my-study/aws?task=3")).toBe("/login?returnTo=%2Fmy-study%2Faws%3Ftask%3D3");
  });
});
