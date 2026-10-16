import { describe, expect, it } from "vitest";
import { scheduleWindow, sortUpcoming, toScheduleData } from "./schedule";
import type { ScheduleResponse } from "./types";

const TODAY = "2026-10-12";

describe("scheduleWindow (schedule §5·§7-8) — 2026년 10월 격자는 09-27(일) ~ 10-31(토)", () => {
  it("sel inside the grid → grid as is", () => {
    expect(scheduleWindow(2026, 9, TODAY)).toEqual({ from: "2026-09-27", to: "2026-10-31", sel: TODAY });
  });
  it("sel outside but within 62 days → extend", () => {
    expect(scheduleWindow(2026, 9, "2026-11-20")).toEqual({ from: "2026-09-27", to: "2026-11-20", sel: "2026-11-20" });
    expect(scheduleWindow(2026, 9, "2026-09-10")).toEqual({ from: "2026-09-10", to: "2026-10-31", sel: "2026-09-10" });
  });
  it("sel too far (> 62 days) → reset sel to the grid's first day", () => {
    expect(scheduleWindow(2026, 9, "2026-12-15")).toEqual({ from: "2026-09-27", to: "2026-10-31", sel: "2026-09-27" });
  });
});

const res: ScheduleResponse = {
  today: TODAY,
  studies: [
    { slug: "aws", title: "AWS SAA 자격증 3개월 완주", membership: "joined", tone: "mint", status: "active", startDate: "2026-10-01", endDate: "2026-12-31" },
    { slug: "spring", title: "Spring 김영한 로드맵 완강", membership: "joined", tone: "lav", status: "active", startDate: "2026-10-05", endDate: "2027-01-31" },
    { slug: "sqld", title: "SQLD 4주 벼락치기", membership: "pending", tone: "amber", status: "recruit", startDate: "2026-10-26", endDate: "2026-11-22" },
  ],
  tasks: [
    { id: "21", slug: "aws", title: "EC2 인스턴스 유형 정리", s: "2026-10-08", e: "2026-10-14", st: "open", round: "2주차" },
    { id: "90", slug: "docker", title: "리더 전용", s: "2026-10-08", e: "2026-10-14", st: null, round: "1주차" },
    { id: "91", slug: "docker", title: "리더 전용 2", s: "2026-10-20", e: "2026-10-24", st: null, round: "2주차" },
  ],
  markers: [{ date: "2026-10-12", slug: "spring", round: "2주차" }],
  upcoming: [
    { id: "b", slug: "spring", title: "싱글톤 컨테이너 실습 코드", s: "2026-10-15", e: "2026-10-18", st: "planned", round: "2주차" },
    { id: "a", slug: "spring", title: "섹션 6~7 정리 노트", s: "2026-10-12", e: "2026-10-18", st: "open", round: "2주차" },
    { id: "21", slug: "aws", title: "EC2 인스턴스 유형 정리", s: "2026-10-08", e: "2026-10-14", st: "open", round: "2주차" },
    { id: "90", slug: "docker", title: "리더 전용", s: "2026-10-08", e: "2026-10-14", st: null, round: "1주차" },   // leaderDoesTasks=false 방 — upcoming 에서 빠져야 한다
  ],
};

describe("toScheduleData (schedule §6)", () => {
  const d = toScheduleData(res);
  it("studies: tone → palette, pending suffix", () => {
    expect(d.studies[0]).toEqual({ id: "aws", name: "AWS SAA 자격증 3개월 완주", bg: "#DDF4EE", fg: "#0B6553", dot: "#12A386", pending: undefined, membership: "joined" });
    expect(d.studies[2]).toMatchObject({ id: "sqld", name: "SQLD 4주 벼락치기 · 승인 대기중", pending: true, bg: "#FBEFD3", fg: "#7A4F00", dot: "#C98A00" });
    expect(d.studyMap.spring.dot).toBe("#7C5BD0");
    expect(d.today).toBe(TODAY);
  });
  it("tasks: st null → planned/open by date with mine=false (Review Focus 3)", () => {
    expect(d.tasks.map((t) => [t.id, t.st, t.mine])).toEqual([["21", "open", true], ["90", "open", false], ["91", "planned", false]]);
    expect(d.tasks[0]).toMatchObject({ study: "aws", round: "2주차", s: "2026-10-08", e: "2026-10-14" });
  });
  it("markers pass through with study=slug", () => {
    expect(d.markers).toEqual([{ date: "2026-10-12", study: "spring", round: "2주차" }]);
  });
  it("upcoming is sorted e ASC then study, title (schedule §3-4)", () => {
    expect(d.upcoming.map((t) => t.title)).toEqual(["EC2 인스턴스 유형 정리", "섹션 6~7 정리 노트", "싱글톤 컨테이너 실습 코드"]);
  });
  it("upcoming drops st:null items even if the server sent them (Review Focus 3, S17)", () => {
    expect(res.upcoming.some((t) => t.st === null)).toBe(true);                // 픽스처에 null 항목이 실제로 있다
    expect(d.upcoming.map((t) => t.id)).not.toContain("90");
    expect(d.upcoming).toHaveLength(3);
  });
});

describe("sortUpcoming", () => {
  it("ties on e → study slug", () => {
    const a = { id: "1", study: "b", title: "가", s: "", e: "2026-10-18", st: "open" as const, round: "" };
    const b = { id: "2", study: "a", title: "나", s: "", e: "2026-10-18", st: "open" as const, round: "" };
    expect(sortUpcoming([a, b]).map((t) => t.id)).toEqual(["2", "1"]);
  });
});
