import { describe, expect, it } from "vitest";
import { loginUrl, MY_STUDY_TABS, routes, safeReturnTo, settingsBackOf } from "./routes";

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
    expect(routes.signup()).toBe("/signup");
    expect(routes.signup("/rooms/aws")).toBe("/signup?returnTo=%2Frooms%2Faws");
    expect(routes.resetPassword()).toBe("/reset-password");
    expect(routes.resetPassword("/invite/t")).toBe("/reset-password?returnTo=%2Finvite%2Ft");
    expect(routes.onboarding("/invite/t")).toBe("/onboarding?returnTo=%2Finvite%2Ft");
    expect(routes.me()).toBe("/me");
    expect(routes.invite("tok")).toBe("/invite/tok");
    expect(routes.createRoom()).toBe("/rooms/new");
    expect(routes.roomSettings("aws")).toBe("/rooms/aws/settings");
    expect(routes.myStudyEdit("aws")).toBe("/my-study/aws?tab=curriculum&mode=edit");
  });
});

describe("mock constants removed", () => {
  it("does not export TODAY / ME", async () => {
    const mod = (await import("./routes")) as Record<string, unknown>;
    expect(mod).not.toHaveProperty("TODAY");
    expect(mod).not.toHaveProperty("ME");
  });
  it("builds task routes", () => {
    expect(routes.task("aws", "12")).toBe("/my-study/aws?task=12");
    expect(routes.tasks()).toBe("/tasks");
    expect(routes.tasks({})).toBe("/tasks");
    expect(routes.tasks({ study: "aws", scope: "all" })).toBe("/tasks?scope=all&study=aws");
  });
});

// 방 설정 "이전 페이지" — ?from= 검증 (오픈 리다이렉트 차단, 없으면 내 스터디)
describe("roomSettings from · settingsBackOf", () => {
  it("from 을 인코딩해 싣고, 없으면 그대로", () => {
    expect(routes.roomSettings("aws", "/rooms/aws")).toBe("/rooms/aws/settings?from=%2Frooms%2Faws");
    expect(routes.roomSettings("aws", "/my-study/aws?tab=board")).toBe("/rooms/aws/settings?from=%2Fmy-study%2Faws%3Ftab%3Dboard");
    expect(routes.myStudyTab("aws", "overview")).toBe("/my-study/aws");
    expect(routes.myStudyTab("aws", "board")).toBe("/my-study/aws?tab=board");
  });
  it("같은 사이트 경로(방 보기·내 스터디)는 그대로 돌려준다", () => {
    expect(settingsBackOf("/rooms/aws", "aws")).toBe("/rooms/aws");
    expect(settingsBackOf("/my-study/aws?tab=board", "aws")).toBe("/my-study/aws?tab=board");
    // 링크가 만든 주소를 Next 가 풀어 준 값과 같다
    const from = new URL(routes.roomSettings("aws", "/my-study/aws?tab=board"), "http://x").searchParams.get("from");
    expect(settingsBackOf(from, "aws")).toBe("/my-study/aws?tab=board");
  });
  it("없음·외부·프로토콜 상대·허용 밖·우회·자기 자신·배열은 내 스터디로", () => {
    for (const raw of [undefined, null, "", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/me", "/rooms/%2e%2e/me", "/rooms/../me", "/rooms/aws/settings", "/rooms/aws/settings?from=/rooms/aws", ["/rooms/aws", "/rooms/aws"]]) {
      expect(settingsBackOf(raw as string | string[] | undefined, "aws")).toBe("/my-study/aws");
    }
  });
  it("이 방의 방 보기·내 스터디(알려진 탭)만 화이트리스트 — 정규형으로 돌려준다", () => {
    for (const t of MY_STUDY_TABS) expect(settingsBackOf(`/my-study/aws?tab=${t}`, "aws")).toBe(routes.myStudyTab("aws", t));
    expect(settingsBackOf("/my-study/aws?tab=overview", "aws")).toBe("/my-study/aws");
    expect(settingsBackOf("/my-study/aws", "aws")).toBe("/my-study/aws");
  });
  it("인코딩·세미콜론 우회, 다른 방, 허용 접두사의 다른 경로, 모르는 탭·추가 쿼리·해시는 내 스터디로", () => {
    for (const raw of [
      "/rooms/aws/%73ettings", "/rooms/aws/settings;a", "/rooms/aws;a", "/rooms/%61ws/settings", "/rooms/aws/", "/rooms/aws?x=1", "/rooms/aws#top",
      "/rooms/other", "/rooms/new", "/my-study/other?tab=board", "/my-study/aws/x", "/my-study", "/invite/abc", "/tasks", "/tasks?study=aws", "/schedule",
      "/my-study/aws?tab=evil", "/my-study/aws?tab=board&tab=gantt", "/my-study/aws?tab=board&x=1", "/my-study/aws?tab=", "/my-study/aws?mode=edit", "/my-study/aws?tab=board#x",
      "/my-study/aws?tab=%62oard%00", "/rooms/aws%3F", "/rooms/aws%E0%A4%A",
    ]) {
      expect(settingsBackOf(raw, "aws"), raw).toBe("/my-study/aws");
    }
  });
  it("길이 상한(200자)을 넘으면 내 스터디로", () => {
    const long = `/my-study/aws?tab=board${"&".repeat(200)}`;
    expect(long.length).toBeGreaterThan(200);
    expect(settingsBackOf(long, "aws")).toBe("/my-study/aws");
    expect(settingsBackOf(`/rooms/${"a".repeat(300)}`, "a".repeat(300))).toBe(`/my-study/${"a".repeat(300)}`);
  });
});
