import { describe, expect, it } from "vitest";
import { clampCp, cpLength, firstErrorKey, serverFieldError, toCreateRoom, validateNewRoom, type NewRoomValues } from "./validate";

const TODAY = "2026-10-12";
const ok: NewRoomValues = { title: "Docker·K8s 입문 6주", intro: "컨테이너 기초부터", startDate: "2026-11-09", endDate: "2026-12-20", maxMembers: "6", isPublic: true, joinMode: "direct", descriptionMd: "", rulesMd: "", minMembers: "", leaderDoesTasks: true };

describe("validateNewRoom (main §2-2 검증 규칙)", () => {
  it("valid → {}", () => expect(validateNewRoom(ok, TODAY)).toEqual({}));
  it("title/intro required and bounded", () => {
    expect(validateNewRoom({ ...ok, title: "   " }, TODAY).title).toBe("제목을 입력해 주세요");
    expect(validateNewRoom({ ...ok, title: "a".repeat(61) }, TODAY).title).toBe("제목은 60자까지예요");
    expect(validateNewRoom({ ...ok, intro: "" }, TODAY).intro).toBe("한 줄 소개를 입력해 주세요");
    expect(validateNewRoom({ ...ok, intro: "a".repeat(101) }, TODAY).intro).toBe("한 줄 소개는 100자까지예요");
  });
  it("period: start ≥ today, end ≥ start", () => {
    expect(validateNewRoom({ ...ok, startDate: "2026-10-11" }, TODAY).startDate).toBe("시작일은 오늘 이후여야 해요");
    expect(validateNewRoom({ ...ok, startDate: TODAY }, TODAY).startDate).toBeUndefined();
    expect(validateNewRoom({ ...ok, endDate: "2026-11-08" }, TODAY).endDate).toBe("종료일은 시작일 이후여야 해요");
    expect(validateNewRoom({ ...ok, startDate: "" }, TODAY).startDate).toBe("시작일을 선택해 주세요");
    expect(validateNewRoom({ ...ok, endDate: "" }, TODAY).endDate).toBe("종료일을 선택해 주세요");
  });
  it("lengths count code points like Postgres length() (emoji = 1)", () => {
    expect(cpLength("😀")).toBe(1);
    expect(validateNewRoom({ ...ok, title: "😀".repeat(60) }, TODAY).title).toBeUndefined();
    expect(validateNewRoom({ ...ok, title: "😀".repeat(61) }, TODAY).title).toBe("제목은 60자까지예요");
    expect(validateNewRoom({ ...ok, intro: "😀".repeat(100) }, TODAY).intro).toBeUndefined();
    expect(validateNewRoom({ ...ok, intro: "😀".repeat(101) }, TODAY).intro).toBe("한 줄 소개는 100자까지예요");
  });
  it("members: max 2~100 integer, min ≤ max", () => {
    expect(validateNewRoom({ ...ok, maxMembers: "1" }, TODAY).maxMembers).toBe("최대 인원은 2~100명이에요");
    expect(validateNewRoom({ ...ok, maxMembers: "2.5" }, TODAY).maxMembers).toBe("최대 인원은 2~100명이에요");
    expect(validateNewRoom({ ...ok, minMembers: "7" }, TODAY).minMembers).toBe("최소 인원은 최대 인원 이하여야 해요");
    expect(validateNewRoom({ ...ok, minMembers: "0" }, TODAY).minMembers).toBe("최소 인원은 1명 이상이에요");
  });
});

describe("serverFieldError", () => {
  it("maps details.field to a form field, else null", () => {
    expect(serverFieldError({ field: "startDate" }, "시작일은 오늘 이후여야 해요")).toEqual({ startDate: "시작일은 오늘 이후여야 해요" });
    expect(serverFieldError({ field: "minMembers" }, "x")).toEqual({ minMembers: "x" });
    expect(serverFieldError({ field: "tagSlugs" }, "x")).toBeNull();
    expect(serverFieldError(undefined, "x")).toBeNull();
  });
});

describe("toCreateRoom", () => {
  it("trims and converts numbers, omits empty optionals", () => {
    expect(toCreateRoom({ ...ok, title: " Docker ", minMembers: "", descriptionMd: " " })).toEqual({
      title: "Docker", intro: "컨테이너 기초부터", startDate: "2026-11-09", endDate: "2026-12-20", maxMembers: 6, isPublic: true, joinMode: "direct", leaderDoesTasks: true,
    });
    expect(toCreateRoom({ ...ok, minMembers: "2", descriptionMd: "소개", rulesMd: "- 규칙" })).toMatchObject({ minMembers: 2, descriptionMd: "소개", rulesMd: "- 규칙" });
  });
});

describe("clampCp (Q2-16 · 입력 한도 = 서버 코드 포인트 한도)", () => {
  it("cuts at N code points, not UTF-16 units", () => {
    const s = "🚀" + "가".repeat(70);
    expect(cpLength(clampCp(s, 60))).toBe(60);
    expect(clampCp(s, 60).startsWith("🚀")).toBe(true);
    expect(clampCp("abc", 60)).toBe("abc");
  });
});

describe("firstErrorKey (Q2-19 · 제출 시 첫 오류 칸으로 포커스)", () => {
  it("follows the form order", () => {
    expect(firstErrorKey({ maxMembers: "x", intro: "y" })).toBe("intro");
    expect(firstErrorKey({ minMembers: "x" })).toBe("minMembers");
    expect(firstErrorKey({})).toBeNull();
  });
});
