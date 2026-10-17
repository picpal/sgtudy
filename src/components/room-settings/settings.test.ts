import { describe, expect, it } from "vitest";
import type { RoomDetail } from "@/lib/api/types";
import { buildPatch, dangerOf, lockedOf, valuesOf, validateSettings } from "./settings";

const TODAY = "2026-10-12";
type D = Pick<RoomDetail, "title" | "intro" | "descriptionMd" | "rulesMd" | "startDate" | "endDate" | "maxMembers" | "minMembers" | "isPublic" | "joinMode" | "leaderDoesTasks" | "status" | "archived" | "memberCount">;
const base: D = {
  title: "AWS SAA",
  intro: "3개월 완주",
  descriptionMd: "소개",
  rulesMd: "- 규칙",
  startDate: "2026-10-20",
  endDate: "2026-12-20",
  maxMembers: 6,
  minMembers: null,
  isPublic: true,
  joinMode: "direct",
  leaderDoesTasks: true,
  status: "recruit",
  archived: false,
  memberCount: 3,
};

describe("valuesOf — RoomDetail → 폼 값 (방 만들기 폼과 같은 모양)", () => {
  it("숫자는 문자열, 최소 인원 없음은 빈칸", () => {
    expect(valuesOf(base)).toEqual({
      title: "AWS SAA", intro: "3개월 완주", descriptionMd: "소개", rulesMd: "- 규칙", startDate: "2026-10-20", endDate: "2026-12-20",
      maxMembers: "6", minMembers: "", isPublic: true, joinMode: "direct", leaderDoesTasks: true,
    });
    expect(valuesOf({ ...base, minMembers: 2 }).minMembers).toBe("2");
  });
});

describe("lockedOf — 서버 room_update 의 상태별 잠금과 같다", () => {
  it("준비중·모집중: 잠긴 칸 없음", () => {
    expect(lockedOf({ status: "draft", archived: false }).size).toBe(0);
    expect(lockedOf({ status: "recruit", archived: false }).size).toBe(0);
  });
  it("진행중: 시작일·최소 인원·공개·참가 방식·그룹장 과제 수행", () => {
    expect([...lockedOf({ status: "active", archived: false })].sort()).toEqual(["isPublic", "joinMode", "leaderDoesTasks", "minMembers", "startDate"]);
  });
  it("종료·보관: 전부", () => {
    expect(lockedOf({ status: "ended", archived: false }).size).toBe(11);
    expect(lockedOf({ status: "active", archived: true }).size).toBe(11);
  });
});

describe("buildPatch — 바뀐 칸만 서버 이름으로 (안 바뀐 기간은 보내지 않아 '시작일은 오늘 이후' 검사를 건드리지 않는다)", () => {
  it("아무것도 안 바꾸면 빈 객체", () => {
    expect(buildPatch(valuesOf(base), valuesOf(base))).toEqual({});
  });
  it("문자열은 앞뒤 공백을 떼고 비교·전송", () => {
    expect(buildPatch(valuesOf(base), { ...valuesOf(base), title: "  AWS SAA  " })).toEqual({});
    expect(buildPatch(valuesOf(base), { ...valuesOf(base), title: " 새 제목 ", rulesMd: "- 하나\n- 둘\n" })).toEqual({ title: "새 제목", rulesMd: "- 하나\n- 둘" });
  });
  it("숫자·불리언·참가 방식·날짜", () => {
    expect(
      buildPatch(valuesOf(base), { ...valuesOf(base), maxMembers: "8", minMembers: "2", isPublic: false, joinMode: "approval", leaderDoesTasks: false, endDate: "2026-12-31" }),
    ).toEqual({ maxMembers: 8, minMembers: 2, isPublic: false, joinMode: "approval", leaderDoesTasks: false, endDate: "2026-12-31" });
  });
  it("최소 인원을 비우면 null(제한 없음)", () => {
    expect(buildPatch(valuesOf({ ...base, minMembers: 2 }), valuesOf(base))).toEqual({ minMembers: null });
  });
  it("소개·규칙을 비우는 것도 바뀐 것", () => {
    expect(buildPatch(valuesOf(base), { ...valuesOf(base), descriptionMd: "", rulesMd: "  " })).toEqual({ descriptionMd: "", rulesMd: "" });
  });
});

describe("validateSettings — 방 만들기 검사 + 바뀐 칸 기준", () => {
  it("안 바꾼 기간은 검사하지 않는다 — 시작일이 지난 모집중 방도 제목을 고칠 수 있다", () => {
    const d = { ...base, startDate: "2026-10-01" };
    expect(validateSettings(valuesOf(d), { ...valuesOf(d), title: "새 제목" }, TODAY, d)).toEqual({});
  });
  it("시작일을 바꾸면 오늘 이후여야", () => {
    expect(validateSettings(valuesOf(base), { ...valuesOf(base), startDate: "2026-10-01" }, TODAY, base).startDate).toBe("시작일은 오늘 이후여야 해요");
  });
  it("종료일만 바꿔도 시작일 이후·1년 상한", () => {
    expect(validateSettings(valuesOf(base), { ...valuesOf(base), endDate: "2026-10-19" }, TODAY, base).endDate).toBe("종료일은 시작일 이후여야 해요");
    expect(validateSettings(valuesOf(base), { ...valuesOf(base), endDate: "2027-10-20" }, TODAY, base).endDate).toBe("기간은 최대 1년이에요");
  });
  it("진행중 종료일은 오늘 이후", () => {
    const d = { ...base, status: "active" as const, startDate: "2026-10-01" };
    expect(validateSettings(valuesOf(d), { ...valuesOf(d), endDate: "2026-10-11" }, TODAY, d).endDate).toBe("진행중에는 종료일을 오늘 이후로만 바꿀 수 있어요");
    expect(validateSettings(valuesOf(d), { ...valuesOf(d), endDate: "2026-10-12" }, TODAY, d)).toEqual({});
  });
  it("제목·한 줄 소개 필수", () => {
    const e = validateSettings(valuesOf(base), { ...valuesOf(base), title: " ", intro: "" }, TODAY, base);
    expect(e.title).toBe("제목을 입력해 주세요");
    expect(e.intro).toBe("한 줄 소개를 입력해 주세요");
  });
  it("최대 인원은 지금 참가자 수보다 적을 수 없다", () => {
    expect(validateSettings(valuesOf(base), { ...valuesOf(base), maxMembers: "2" }, TODAY, base).maxMembers).toBe("지금 참가자(3명)보다 적게 줄일 수 없어요");
  });
});

describe("dangerOf — 삭제·보관 (서버 room_delete 는 준비중·모집중만, 그 뒤는 room_archive)", () => {
  it("준비중·모집중 → 삭제", () => {
    expect(dangerOf({ status: "draft", archived: false })).toBe("delete");
    expect(dangerOf({ status: "recruit", archived: false })).toBe("delete");
  });
  it("진행중·종료 → 보관, 보관됨 → 보관 풀기", () => {
    expect(dangerOf({ status: "active", archived: false })).toBe("archive");
    expect(dangerOf({ status: "ended", archived: false })).toBe("archive");
    expect(dangerOf({ status: "ended", archived: true })).toBe("unarchive");
  });
});
