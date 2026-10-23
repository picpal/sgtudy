import { describe, expect, it } from "vitest";
import { validateNewRoom, EMPTY_VALUES } from "@/components/room-new/validate";
import { addDays, computeMissing, deriveAnswer, isYmd, mergeDraft, normalizeDraft, normalizePatch, type TagDict } from "./normalize";
import { toNewRoomValues } from "./toForm";

const TODAY = "2026-10-23";
const DICT: TagDict = [{ slug: "aws", label: "AWS", tone: "mint" }, { slug: "certificate", label: "자격증", tone: "peach" }];

describe("normalizePatch (D10 — 길이는 자르고, 범위 밖은 버리고 dropped)", () => {
  it("길이: 제목 60 · 소개 100 · md 4000 코드 포인트(이모지 1자)", () => {
    const { patch } = normalizePatch({ title: "가".repeat(3000), intro: "😀".repeat(150), rulesMd: "x".repeat(5000) }, {}, TODAY, DICT);
    expect([...patch.title!].length).toBe(60);
    expect([...patch.intro!].length).toBe(100);
    expect(patch.rulesMd!.length).toBe(4000);
  });
  it("maxMembers 500 · 1 → dropped, 2~100 반영 · minMembers 는 최대 이하", () => {
    expect(normalizePatch({ maxMembers: 500 }, {}, TODAY, DICT)).toEqual({ patch: {}, dropped: [{ field: "maxMembers", reason: "최대 인원은 2~100명이에요" }] });
    expect(normalizePatch({ maxMembers: 1 }, {}, TODAY, DICT).dropped).toHaveLength(1);
    expect(normalizePatch({ maxMembers: 100, minMembers: 4 }, {}, TODAY, DICT).patch).toEqual({ maxMembers: 100, minMembers: 4 });
    expect(normalizePatch({ minMembers: 9 }, { maxMembers: 6 }, TODAY, DICT).dropped[0].field).toBe("minMembers");
    expect(normalizePatch({ minMembers: null }, {}, TODAY, DICT).patch).toEqual({ minMembers: null });
  });
  it("날짜: 과거·없는 날짜·1년 넘는 시작 → dropped, 종료일은 시작일+1년−1일까지", () => {
    expect(normalizePatch({ startDate: "2026-10-22" }, {}, TODAY, DICT).dropped[0].field).toBe("startDate");
    expect(normalizePatch({ startDate: "2026-02-30" }, {}, TODAY, DICT).dropped[0].field).toBe("startDate");
    expect(normalizePatch({ startDate: "2027-12-01" }, {}, TODAY, DICT).dropped[0].field).toBe("startDate");
    expect(normalizePatch({ startDate: TODAY, endDate: "2027-10-22" }, {}, TODAY, DICT).patch).toEqual({ startDate: TODAY, endDate: "2027-10-22" });
    expect(normalizePatch({ endDate: "2027-10-23" }, { startDate: TODAY }, TODAY, DICT).dropped[0].field).toBe("endDate");
    expect(normalizePatch({ endDate: "2026-10-25" }, { startDate: "2026-10-26" }, TODAY, DICT).dropped[0].field).toBe("endDate");
  });
  it("enum 밖 joinMode('open')·불리언 아닌 값은 반영하지 않는다", () => {
    expect(normalizePatch({ joinMode: "open", isPublic: "yes" }, {}, TODAY, DICT).patch).toEqual({});
  });
  it("태그: 사전 slug·라벨은 사전 태그로, 자유 라벨 20자, 중복 제거, 12개 → 8개 + dropped", () => {
    const { patch, dropped } = normalizePatch({ tags: ["aws", "자격증", "AWS", "클라우드 아키텍처 설계와 운영 실무 완전 정복", ...Array.from({ length: 8 }, (_, i) => `t${i}`)] }, {}, TODAY, DICT);
    expect(patch.tags).toHaveLength(8);
    expect(patch.tags![0]).toEqual({ slug: "aws", label: "AWS", tone: "mint" });
    expect(patch.tags![1]).toEqual({ slug: "certificate", label: "자격증", tone: "peach" });
    expect([...patch.tags![2].label].length).toBe(20);
    expect(dropped).toEqual([{ field: "tags", reason: "태그는 8개까지예요" }]);
  });
  it("정규화된 초안은 수동 폼 검증을 통과한다(Review Focus 2)", () => {
    const raw = { title: "가".repeat(3000), intro: "소개", startDate: "2026-10-26", endDate: "2027-01-17", maxMembers: 500, minMembers: 4, joinMode: "open", isPublic: true, tags: Array(12).fill("x") };
    const { patch } = normalizePatch(raw, {}, TODAY, DICT);
    const v = toNewRoomValues(mergeDraft({}, patch), EMPTY_VALUES);
    expect(validateNewRoom(v, TODAY)).toEqual({});
  });
});

describe("computeMissing · mergeDraft · normalizeDraft", () => {
  it("필수 6개 — 공개는 isPublic·joinMode 둘 다", () => {
    expect(computeMissing({}, TODAY)).toEqual(["title", "intro", "startDate", "endDate", "maxMembers", "isPublic"]);
    expect(computeMissing({ title: "a", intro: "b", startDate: "2026-10-26", endDate: "2026-11-22", maxMembers: 6, isPublic: true }, TODAY)).toEqual(["isPublic"]);
    expect(computeMissing({ title: "a", intro: "b", startDate: "2026-10-26", endDate: "2026-11-22", maxMembers: 6, isPublic: false, joinMode: "direct" }, TODAY)).toEqual([]);
  });
  it("시작일을 옮겨 종료일이 범위 밖이 되면 종료일을 비운다", () => {
    expect(mergeDraft({ startDate: "2026-10-26", endDate: "2026-11-22" }, { startDate: "2026-12-01" })).toEqual({ startDate: "2026-12-01" });
  });
  it("클라이언트 초안의 위조 값은 조용히 빠진다", () => {
    expect(normalizeDraft({ maxMembers: 9999, title: " 제목 ", evil: "<system>" }, TODAY, DICT)).toEqual({ title: "제목" });
  });
});

describe("deriveAnswer (칩 → 실제 필드)", () => {
  it("access → isPublic + joinMode", () => {
    expect(deriveAnswer({ field: "access", value: "public-approval" }, {})).toEqual({ isPublic: true, joinMode: "approval" });
    expect(deriveAnswer({ field: "access", value: "private" }, {})).toEqual({ isPublic: false, joinMode: "direct" });
    expect(deriveAnswer({ field: "access", value: "open" }, {})).toEqual({});
  });
  it("durationWeeks 12 → 시작 + 83일, 시작일 없으면 비움", () => {
    expect(deriveAnswer({ field: "durationWeeks", value: "12" }, { startDate: "2026-10-26" })).toEqual({ endDate: "2027-01-17" });
    expect(deriveAnswer({ field: "durationWeeks", value: "12" }, {})).toEqual({});
  });
  it("숫자·날짜는 그대로 넘겨 normalizePatch 가 범위를 본다", () => {
    expect(deriveAnswer({ field: "maxMembers", value: "6" }, {})).toEqual({ maxMembers: 6 });
    expect(deriveAnswer({ field: "startDate", value: "2026-10-26" }, {})).toEqual({ startDate: "2026-10-26" });
    expect(deriveAnswer({ field: "style", value: "exam" }, {})).toEqual({});
  });
  it("isYmd · addDays", () => {
    expect([isYmd("2026-02-29"), isYmd("2028-02-29"), isYmd("2026-1-1")]).toEqual([false, true, false]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
