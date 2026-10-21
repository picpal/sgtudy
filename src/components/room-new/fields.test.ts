import { describe, expect, it } from "vitest";
import { DATE_FIELD_CLASS, FIELD_CLASS } from "./fields";

describe("DATE_FIELD_CLASS — 방 만들기·방 설정 날짜 칸 공용", () => {
  it("일반 칸 모양 그대로 + iOS 기본 모양 끄기(border-box 적용) + 값 왼쪽 정렬", () => {
    expect(DATE_FIELD_CLASS.startsWith(FIELD_CLASS)).toBe(true);
    expect(DATE_FIELD_CLASS.split(/\s+/)).toEqual(expect.arrayContaining(["appearance-none", "[&::-webkit-date-and-time-value]:text-left"]));
  });
});
