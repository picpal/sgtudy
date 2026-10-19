import { describe, expect, it } from "vitest";
import { toRoomCard } from "./rooms";
import type { RoomCardDto } from "./types";

const TODAY = "2026-10-12";
const leader = (nickname: string): RoomCardDto["leader"] => ({ userId: `u-${nickname}`, nickname, tone: "mint" });
const dto = (o: Partial<RoomCardDto>): RoomCardDto => ({
  id: "1", slug: "x", title: "t", intro: "i", status: "recruit", isFull: false, isPublic: true, joinMode: "direct",
  memberCount: 2, maxMembers: 8, leader: leader("서연"), tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }],
  startDate: "2026-11-02", endDate: "2026-12-27", membership: null, progress: { kind: "recruit" }, ...o,
});

describe("toRoomCard (main §3)", () => {
  it("toeic recruit 2/8", () => {
    const r = toRoomCard(dto({ slug: "toeic" }), TODAY);
    expect(r.id).toBe("toeic");
    expect(r.status).toBe("recruit");
    expect(r.period).toBe("2026.11.02 – 12.27 · 8주");
    expect(r.tags).toEqual(["영어"]);
    expect(r.slot).toEqual({ label: "모집 현황", value: "2/8명", pct: 25, note: "11.02(월) 시작 · 6자리 남음", em: "D-21" });
    expect(r.created).toBe(false);
    expect(r.leaderTone).toBe("mint");
  });
  it("recruit card: start date passed but not started → 시작일 지남, start today → D-DAY", () => {
    expect(toRoomCard(dto({ startDate: "2026-10-11" }), TODAY).slot.em).toBe("시작일 지남");
    expect(toRoomCard(dto({ startDate: "2026-10-12" }), TODAY).slot.em).toBe("D-DAY");
  });
  it("aws mine 33% (철수 2/6, 전체 트리 — D5) with next OPEN task D-2", () => {
    // 목업 카드의 50%(2/4)는 폐기 — 시드·rooms_list 의 mine 분모는 전체 트리 기준 6 (D5, D14)
    const r = toRoomCard(dto({ slug: "aws", status: "active", joinMode: "approval", memberCount: 4, maxMembers: 6, leader: leader("민수"),
      startDate: "2026-10-01", endDate: "2026-12-31", membership: { role: "member", status: "active" },
      progress: { kind: "mine", submitted: 2, assigned: 6, nextTask: { nodeId: "21", title: "EC2 인스턴스 유형 정리", dueDate: "2026-10-14" } } }), TODAY);
    expect(r.status).toBe("active");
    expect(r.approval).toBe(true);
    expect(r.period).toBe("2026.10.01 – 12.31 · 13주");
    expect(r.slot).toEqual({ label: "내 진척률", value: "33%", pct: 33, note: "EC2 인스턴스 유형 정리", em: "D-2" });
  });
  it("mine with nothing left", () => {
    const r = toRoomCard(dto({ status: "active", membership: { role: "member", status: "active" }, progress: { kind: "mine", submitted: 4, assigned: 4, nextTask: null } }), TODAY);
    expect(r.slot).toEqual({ label: "내 진척률", value: "100%", pct: 100, note: "남은 과제가 없어요", em: "" });
  });
  it("mine with unfinished tasks but none OPEN now → not '남은 과제가 없어요' (Q3-23)", () => {
    const r = toRoomCard(dto({ status: "active", membership: { role: "leader", status: "active" }, progress: { kind: "mine", submitted: 2, assigned: 5, nextTask: null } }), TODAY);
    expect(r.slot).toEqual({ label: "내 진척률", value: "40%", pct: 40, note: "지금 진행 중인 과제가 없어요", em: "" });
  });
  it("algo final 87% — 'N주 완주' = period weeks 13 even though the seed has 3 rounds (D14, S10)", () => {
    const r = toRoomCard(dto({ slug: "algo", status: "ended", memberCount: 6, maxMembers: 6, startDate: "2026-07-01", endDate: "2026-09-30",
      membership: { role: "member", status: "active" }, progress: { kind: "final", submitted: 68, assigned: 78, totalRounds: 3 } }), TODAY);
    expect(r.status).toBe("ended");
    expect(r.slot).toEqual({ label: "최종 달성률", value: "87%", pct: 87, note: "13주 완주 · 제출 68/78건", em: "" });
  });
  it("react team progress 4/8주", () => {
    const r = toRoomCard(dto({ slug: "react", status: "active", memberCount: 5, startDate: "2026-09-21", endDate: "2026-11-15",
      progress: { kind: "team", currentRound: { index: 4, label: "4주차", title: "컴포넌트 상태 관리" }, totalRounds: 8 } }), TODAY);
    expect(r.slot).toEqual({ label: "전체 진행", value: "4/8주", pct: 50, note: "4주차 · 컴포넌트 상태 관리", em: "" });
  });
  it("team without current round", () => {
    const r = toRoomCard(dto({ status: "active", progress: { kind: "team", currentRound: null, totalRounds: 8 } }), TODAY);
    expect(r.slot).toEqual({ label: "전체 진행", value: "0/8주", pct: 0, note: "진행 중인 회차가 없어요", em: "" });
  });
  it("recruit note priority: pending > full > first > remaining", () => {
    expect(toRoomCard(dto({ slug: "sqld", memberCount: 1, maxMembers: 5, joinMode: "approval", startDate: "2026-10-26", endDate: "2026-11-22",
      membership: { role: "member", status: "pending" } }), TODAY).slot).toEqual({ label: "모집 현황", value: "1/5명", pct: 20, note: "10.26(월) 시작 · 승인 대기중", em: "D-14" });
    const jcg = toRoomCard(dto({ slug: "jcg", memberCount: 4, maxMembers: 4, isFull: true, joinMode: "approval", startDate: "2026-10-19", endDate: "2026-11-01" }), TODAY);
    expect(jcg.status).toBe("full");
    expect(jcg.slot).toEqual({ label: "모집 현황", value: "4/4명", pct: 100, note: "10.19(월) 시작 · 정원 마감", em: "D-7" });
    const docker = toRoomCard(dto({ slug: "docker", memberCount: 1, maxMembers: 6, startDate: "2026-11-09", endDate: "2026-12-20", membership: { role: "leader", status: "active" } }), TODAY);
    expect(docker.created).toBe(true);
    expect(docker.slot).toEqual({ label: "모집 현황", value: "1/6명", pct: 17, note: "11.09(월) 시작 · 첫 참가자를 기다려요", em: "D-28" });
  });
  it("draft room gets its own badge status (D2)", () => {
    const r = toRoomCard(dto({ status: "draft", memberCount: 1, membership: { role: "leader", status: "active" } }), TODAY);
    expect(r.status).toBe("draft");
    expect(r.slot.note).toBe("11.02(월) 시작 예정 · 모집 전");
  });
  it("private room → pub false", () => {
    expect(toRoomCard(dto({ isPublic: false }), TODAY).pub).toBe(false);
  });
});
