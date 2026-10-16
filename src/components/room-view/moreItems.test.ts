import { describe, expect, it } from "vitest";
import { roomMoreItems, studyMoreItems } from "./moreItems";

describe("roomMoreItems — 방 상세 더보기 (링크 복사는 옆 공유 버튼)", () => {
  it("비로그인·비참가자·이탈·종료 등은 메뉴 없음 → 버튼을 숨긴다", () => {
    for (const a of ["login", "join", "apply", "inactive", "full", "activeClosed", "ended"] as const) expect(roomMoreItems(a)).toEqual([]);
  });
  it("그룹장: 내 스터디에서 관리", () => {
    expect(roomMoreItems("owner")).toEqual(["myStudy"]);
  });
  it("모집 기간 참가자: 내 스터디 + 참가 취소", () => {
    expect(roomMoreItems("leave")).toEqual(["myStudy", "leave"]);
  });
  it("진행·종료 참가자: 내 스터디", () => {
    expect(roomMoreItems("joined")).toEqual(["myStudy"]);
  });
  it("승인 대기: 내 스터디 + 신청 취소", () => {
    expect(roomMoreItems("pending")).toEqual(["myStudy", "cancel"]);
  });
});

describe("studyMoreItems — 내 스터디 더보기", () => {
  it("모두 방 정보 보기, 모집 기간 참가자는 참가 취소, 승인 대기는 신청 취소", () => {
    expect(studyMoreItems("owner")).toEqual(["room"]);
    expect(studyMoreItems("joined")).toEqual(["room"]);
    expect(studyMoreItems("closed")).toEqual(["room"]);
    expect(studyMoreItems("leave")).toEqual(["room", "leave"]);
    expect(studyMoreItems("pending")).toEqual(["room", "cancel"]);
  });
});
