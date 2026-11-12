import { describe, expect, it } from "vitest";
import { toRoomCard } from "./rooms";
import type { RoomCardDto } from "./types";

const TODAY = "2026-10-12";
const dto = (o: Partial<RoomCardDto>): RoomCardDto => ({
  id: "1", slug: "x", title: "t", intro: "i", status: "recruit", isFull: false, isPublic: true, joinMode: "approval",
  memberCount: 2, maxMembers: 8, leader: { userId: "u-l", nickname: "l", tone: "mint" }, tags: [],
  startDate: "2026-11-02", endDate: "2026-12-27", membership: null, progress: { kind: "recruit" }, ...o,
});
const tail = (o: Partial<RoomCardDto>) => toRoomCard(dto(o), TODAY).slot.note.split(" · ").pop();

describe("모집 현황 꼬리 우선순위: 모집 전 > 승인 대기중 > 정원 마감 > 첫 참가자 > N자리 남음", () => {
  const pending = { role: "member", status: "pending" } as const;
  it("준비중이면 승인 대기·정원 마감이어도 모집 전", () => {
    expect(tail({ status: "draft", membership: pending, memberCount: 8, maxMembers: 8 })).toBe("모집 전");
  });
  it("승인 대기중이 정원 마감보다 먼저", () => {
    expect(tail({ membership: pending, memberCount: 8, maxMembers: 8, isFull: true })).toBe("승인 대기중");
  });
  it("정원 마감이 첫 참가자보다 먼저(정원 1명)", () => {
    expect(tail({ memberCount: 1, maxMembers: 1, isFull: true })).toBe("정원 마감");
  });
  it("그 밖은 첫 참가자 · N자리 남음", () => {
    expect(tail({ memberCount: 1 })).toBe("첫 참가자를 기다려요");
    expect(tail({ memberCount: 3 })).toBe("5자리 남음");
  });
});
