import { describe, expect, it } from "vitest";
import { EMPTY_VALUES } from "@/components/room-new/validate";
import { changedKeys, draftKeys, fromNewRoomValues, toNewRoomValues, toTagItems } from "./toForm";

describe("toForm (D13 초안 ↔ 폼 값)", () => {
  it("초안 → 폼 값: 없는 칸은 base 그대로, 숫자는 문자열", () => {
    const v = toNewRoomValues({ title: "t", maxMembers: 10, minMembers: null, isPublic: false, joinMode: "approval" }, { ...EMPTY_VALUES, intro: "남김" });
    expect(v).toEqual({ ...EMPTY_VALUES, title: "t", intro: "남김", maxMembers: "10", minMembers: "", isPublic: false, joinMode: "approval" });
  });
  it("태그: 사전/자유 + 알 수 없는 tone 은 버림", () => {
    expect(toTagItems({ tags: [{ slug: "aws", label: "AWS", tone: "mint" }, { label: "자유", tone: "neon" }] }, [])).toEqual([{ slug: "aws", label: "AWS", tone: "mint" }, { label: "자유" }]);
    expect(toTagItems({}, [{ label: "x" }])).toEqual([{ label: "x" }]);
  });
  it("폼 → 초안: filled 칸만 (기본값 6명·공개는 '채움' 아님)", () => {
    expect(fromNewRoomValues(EMPTY_VALUES, [], new Set())).toEqual({});
    const v = { ...EMPTY_VALUES, title: "t", maxMembers: "8", joinMode: "approval" as const };
    expect(fromNewRoomValues(v, [{ slug: "aws", label: "AWS", tone: "mint" }], new Set(["title", "maxMembers", "joinMode"]))).toEqual({
      title: "t", maxMembers: 8, isPublic: true, joinMode: "approval", tags: [{ slug: "aws", label: "AWS" }],
    });
  });
  it("draftKeys · changedKeys", () => {
    expect(draftKeys({ title: "a", isPublic: true })).toEqual(["title", "isPublic"]);
    expect(changedKeys(EMPTY_VALUES, { ...EMPTY_VALUES, title: "a" })).toEqual(["title"]);
  });
});
