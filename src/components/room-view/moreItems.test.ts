import { describe, expect, it } from "vitest";
import { cancelConfirmBody, menuItemsOf, roomMoreItems, studyMoreItems } from "./moreItems";

describe("roomMoreItems — 방 상세 더보기 (링크 복사는 옆 공유 버튼)", () => {
  it("비로그인·비참가자·이탈·종료 등은 메뉴 없음 → 버튼을 숨긴다", () => {
    for (const a of ["login", "join", "apply", "inactive", "full", "activeClosed", "ended"] as const) expect(roomMoreItems(a)).toEqual([]);
  });
  it("그룹장: 내 스터디에서 관리 + 방 설정", () => {
    expect(roomMoreItems("owner")).toEqual(["myStudy", "settings"]);
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
  it("맨 앞은 늘 방 정보 — 그룹장은 방 설정, 모집 기간 참가자는 참가 취소, 승인 대기는 신청 취소", () => {
    expect(studyMoreItems("owner")).toEqual(["roomInfo", "settings"]);
    expect(studyMoreItems("joined")).toEqual(["roomInfo"]);
    expect(studyMoreItems("closed")).toEqual(["roomInfo"]);
    expect(studyMoreItems("leave")).toEqual(["roomInfo", "leave"]);
    expect(studyMoreItems("pending")).toEqual(["roomInfo", "cancel"]);
  });
  it("방 정보는 공개 방 화면 링크", () => {
    expect(menuItemsOf(["roomInfo"], "aws", () => {})).toEqual([{ key: "roomInfo", label: "방 정보", href: "/rooms/aws" }]);
  });
});

// 시나리오 QA D3 (#4 — 은지가 더보기에서 나가기를 찾았다): 진행 중 참가자는 더보기에서도 탈퇴 요청·요청 취소
describe("studyMoreItems — 진행 중 탈퇴 요청", () => {
  it("참가 중이면 탈퇴 요청, 요청 중이면 요청 취소", () => {
    expect(studyMoreItems("joined", { canRequestLeave: true })).toEqual(["roomInfo", "leaveRequest"]);
    expect(studyMoreItems("joined", { canRequestLeave: true, leaveRequested: true })).toEqual(["roomInfo", "leaveRequestCancel"]);
    expect(studyMoreItems("closed", { canRequestLeave: false })).toEqual(["roomInfo"]);
  });
  it("메뉴 항목 — 탈퇴 요청은 위험 동작, 요청 취소는 일반", () => {
    const picked: string[] = [];
    const items = menuItemsOf(["leaveRequest", "leaveRequestCancel"], "aws", (k) => picked.push(k));
    expect(items.map((i) => [i.label, !!i.danger])).toEqual([["탈퇴 요청", true], ["탈퇴 요청 취소", false]]);
    items.forEach((i) => i.onSelect?.());
    expect(picked).toEqual(["leaveRequest", "leaveRequestCancel"]);
  });
});

describe("menuItemsOf — 메뉴 항목으로 (링크는 href, 취소는 확인 대화상자)", () => {
  it("내 스터디·방 설정은 링크, 참가/신청 취소는 위험 동작", () => {
    const picked: string[] = [];
    const items = menuItemsOf(["myStudy", "settings", "leave", "cancel"], "aws", (k) => picked.push(k));
    expect(items.map((i) => [i.key, i.label, i.href ?? null, !!i.danger])).toEqual([
      ["myStudy", "내 스터디에서 보기", "/my-study/aws", false],
      ["settings", "방 설정", "/rooms/aws/settings", false],
      ["leave", "참가 취소", null, true],
      ["cancel", "신청 취소", null, true],
    ]);
    items[2].onSelect?.();
    items[3].onSelect?.();
    expect(picked).toEqual(["leave", "cancel"]);
  });
});

describe("menuItemsOf — 방 설정 링크에 지금 화면(from)을 싣는다", () => {
  it("방 보기에서 열면 설정의 '이전 페이지' 가 방 보기로, 다른 링크는 그대로", () => {
    const items = menuItemsOf(["myStudy", "settings"], "aws", () => {}, "/rooms/aws");
    expect(items.map((i) => i.href)).toEqual(["/my-study/aws", "/rooms/aws/settings?from=%2Frooms%2Faws"]);
  });
});

// 백로그 F 리뷰 I2: 방 화면·내 스터디 공용 신청 취소 확인 본문
describe("cancelConfirmBody", () => {
  it("보관된 방은 다시 신청할 수 없다고, 아니면 기존 문구", () => {
    expect(cancelConfirmBody(true)).toBe("보관된 스터디라 취소하면 다시 신청할 수 없어요.");
    expect(cancelConfirmBody(false)).toBe("취소해도 모집 중이면 다시 신청할 수 있어요.");
  });
});
