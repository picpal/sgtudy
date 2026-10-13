import { describe, expect, it } from "vitest";
import { AWS } from "@/components/my-study/fixtures";
import { EMPTY_OVERRIDES, buildTree } from "@/components/my-study/model";
import type { MeStudies, RoomDetail } from "./types";
import { filterSidebarGroups, patchOf, toSidebarGroups, toStudyRoom } from "./my-study";

const TODAY = "2026-10-12";
const P = (userId: string, nickname: string, tone: RoomDetail["leader"]["tone"]) => ({ userId, nickname, tone });
const aws: RoomDetail = {
  today: TODAY, id: "6", slug: "aws", title: "AWS SAA 자격증 3개월 완주", intro: "IAM부터", descriptionMd: "소개", rulesMd: "- 마감은 23:59\n- 2회 연속 미제출",
  status: "active", archived: false, isPublic: true, joinMode: "approval", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 4,
  leader: P("u2", "민수", "mint"), leaderDoesTasks: true, tags: [{ slug: "aws", label: "AWS", tone: "mint", auto: true }],
  members: [
    { ...P("u2", "민수", "mint"), role: "leader", status: "active", joinedAt: null }, { ...P("u3", "지은", "peach"), role: "member", status: "active", joinedAt: null },
    { ...P("u1", "철수", "blue"), role: "member", status: "active", joinedAt: null }, { ...P("u4", "하나", "lav"), role: "member", status: "active", joinedAt: null },
    { ...P("u5", "도윤", "slate"), role: "member", status: "inactive", joinedAt: null },
  ],
  me: { state: "active" },
  currentRound: { id: "2", label: "2주차", title: "EC2·S3", startDate: "2026-10-08", endDate: "2026-10-14", leafCount: 2, assigned: 3, submitted: 1, pct: 33, tasks: [
    { id: "21", title: "EC2 인스턴스 유형 정리", type: "designated", startDate: "2026-10-08", endDate: "2026-10-14", people: [{ ...P("u3", "지은", "peach"), status: "done" }, { ...P("u1", "철수", "blue"), status: "open" }] },
  ] },
  rounds: [
    { id: "1", label: "1주차", title: "IAM·VPC", startDate: "2026-10-01", endDate: "2026-10-07", leafCount: 2, assigned: 8, submitted: 5, pct: 63 },
    { id: "2", label: "2주차", title: "EC2·S3", startDate: "2026-10-08", endDate: "2026-10-14", leafCount: 2, assigned: 3, submitted: 1, pct: 33 },
    { id: "3", label: "3주차", title: "고가용성 아키텍처", startDate: "2026-10-15", endDate: "2026-10-21", leafCount: 1, assigned: 4, submitted: 0, pct: 0 },
    { id: "4", label: "4주차", title: "오토스케일링", startDate: "2026-10-22", endDate: "2026-10-28", leafCount: 1, assigned: 4, submitted: 0, pct: 0 },
    { id: "5", label: "5주차", title: "데이터베이스", startDate: "2026-10-29", endDate: "2026-11-04", leafCount: 2, assigned: 6, submitted: 0, pct: 0 },
  ],
  stats: { roundCount: 5, leafCount: 8, commonCount: 5, designatedCount: 3, totalAssignments: 25, totalSubmissions: 6, overallPct: 24, unassignedCount: 0, startWeekdays: [4] },
  myProgress: { submitted: 2, assigned: 6, nextDue: { nodeId: "21", title: "EC2 인스턴스 유형 정리", roundLabel: "2주차", dueDate: "2026-10-14" } },
  invite: null, pendingCount: 0,
};
const tree = buildTree(AWS, EMPTY_OVERRIDES, TODAY);

describe("toStudyRoom (mystudy §1.2–1.4)", () => {
  const r = toStudyRoom(aws, tree, TODAY, "u1");
  it("header fields", () => {
    expect(r).toMatchObject({ id: "aws", status: "active", period: "2026.10.01(목) – 12.31(목)", dday: "D-80", ddayLong: "종료까지 D-80", joinMode: "그룹장 승인 후 참가", visibility: "공개", leader: "민수", leaderTone: "mint", capCur: 4, capMax: 6, minText: "최소 3명 · 충족", minOk: true, action: "joined" });
    expect(r.rules).toEqual(["마감은 23:59", "2회 연속 미제출"]);
  });
  it("members incl. 이탈·me flags by userId", () => {
    expect(r.members.map((m) => [m.name, !!m.me, !!m.left])).toEqual([["민수", false, false], ["지은", false, false], ["철수", true, false], ["하나", false, false], ["도윤", false, true]]);
    expect(r.members[0]).toMatchObject({ leader: true, noBar: false, userId: "u2", tone: "mint" });
  });
  it("current round card and next due", () => {
    expect(r.cur.pill).toBe("2주차 · 진행중");
    expect(r.cur.meta).toBe("10.08(목) – 10.14(수) · 마감 D-2");
    expect(r.cur.tasks[0]).toEqual({ title: "EC2 인스턴스 유형 정리", type: "지정", dates: "10.08 – 10.14", people: [["지은", "done"], ["철수", "open"]], tones: { 지은: "peach", 철수: "blue" } });
    expect(r.next).toEqual({ nodeId: "21", title: "EC2 인스턴스 유형 정리", path: "2주차 EC2·S3 · 지정 과제", due: "10.14(수) 23:59 마감", dday: "D-2" });
  });
  it("rounds window with roundId for tree lookup", () => {
    expect(r.rounds.map((x) => [x.label, x.state, x.roundId, !!x.current])).toEqual([["1주차", "기간 종료", "1", false], ["2주차", "진행중", "2", true], ["3주차", "예정", "3", false]]);
    expect(r.moreRounds).toBe("이후 2개 회차가 더 있어요 · 커리큘럼 탭에서 전체 보기");
  });
  it("sqld pending: minText 2명 더 필요, action pending, recruit rounds use alt", () => {
    const sqld: RoomDetail = { ...aws, slug: "sqld", status: "recruit", joinMode: "approval", startDate: "2026-10-26", endDate: "2026-11-22", maxMembers: 5, minMembers: 3, memberCount: 1, leader: P("u9", "가은", "amber"), leaderDoesTasks: false,
      members: [{ ...P("u9", "가은", "amber"), role: "leader", status: "active", joinedAt: null }, { ...P("u1", "철수", "blue"), role: "member", status: "pending", joinedAt: null }], me: { state: "pending" }, currentRound: null, myProgress: null,
      rounds: [{ id: "s1", label: "1주차", title: "데이터 모델링의 이해", startDate: "2026-10-26", endDate: "2026-11-01", leafCount: 2, assigned: 0, submitted: 0, pct: null }] };
    const s = toStudyRoom(sqld, tree, TODAY, "u1");
    expect(s).toMatchObject({ minText: "최소 3명 · 2명 더 필요해요", minOk: false, action: "pending", dday: "D-14", next: null });
    expect(s.members).toEqual([{ name: "가은", done: 0, total: 0, leader: true, me: false, left: false, pending: false, noBar: true, userId: "u9", tone: "amber" }, { name: "철수", done: 0, total: 0, leader: false, me: true, left: false, pending: true, noBar: false, userId: "u1", tone: "blue" }]);
    expect(s.rounds[0]).toMatchObject({ state: "예정", alt: "과제 2개", sub: 0, total: 0 });
  });
  it("action by room status and role (Q1-12/Q2-13)", () => {
    expect(toStudyRoom({ ...aws, status: "recruit" }, tree, TODAY, "u1").action).toBe("leave");
    expect(toStudyRoom({ ...aws, status: "draft" }, tree, TODAY, "u1").action).toBe("leave");
    expect(toStudyRoom(aws, tree, TODAY, "u1").action).toBe("joined");
    expect(toStudyRoom({ ...aws, me: { state: "leader" } }, tree, TODAY, "u2").action).toBe("owner");
    expect(toStudyRoom({ ...aws, status: "recruit", me: { state: "leader" } }, tree, TODAY, "u2").action).toBe("owner");
  });
  it("draft room → 준비중 · 모집 전, not 모집중 (Q2-03)", () => {
    const d = toStudyRoom({ ...aws, status: "draft", startDate: "2026-11-01", endDate: "2026-11-30", me: { state: "leader" } }, tree, TODAY, "u2");
    expect(d).toMatchObject({ status: "recruit", draft: true, dday: "D-20", ddayLong: "모집 전 · 시작까지 D-20" });
    expect(toStudyRoom({ ...aws, status: "recruit" }, tree, TODAY, "u1").draft).toBe(false);
  });
  it("ended + member → closed; no minMembers → empty minText", () => {
    expect(toStudyRoom({ ...aws, status: "ended", minMembers: null }, tree, TODAY, "u1")).toMatchObject({ action: "closed", minText: "", minOk: true });
  });
  it("designated task with 0 assignees in the current round → people [] (OverviewTab shows 담당자 미정, no NaN — S15)", () => {
    const cr = aws.currentRound!;
    const noOne = { id: "23", title: "담당자 없는 과제", type: "designated" as const, startDate: "2026-10-08", endDate: "2026-10-14", people: [] };
    const r0 = toStudyRoom({ ...aws, currentRound: { ...cr, tasks: [...cr.tasks!, noOne] } }, tree, TODAY, "u1");
    expect(r0.cur.tasks[1]).toEqual({ title: "담당자 없는 과제", type: "지정", dates: "10.08 – 10.14", people: [], tones: {} });
  });
  it("gap between rounds: server currentRound = previous ended round → no current card/row (preflight C2)", () => {
    const gap = [
      { id: "g1", label: "1주차", title: "IAM·VPC", startDate: "2026-10-01", endDate: "2026-10-07", leafCount: 2, assigned: 8, submitted: 5, pct: 63 },
      { id: "g2", label: "2주차", title: "EC2·S3", startDate: "2026-10-20", endDate: "2026-10-26", leafCount: 2, assigned: 3, submitted: 0, pct: 0 },
    ];
    const g = toStudyRoom({ ...aws, rounds: gap, currentRound: gap[0] }, tree, TODAY, "u1");
    expect(g.cur.title).toBe("진행 중인 회차가 없어요");
    expect(g.cur.tasks).toEqual([]);
    expect(g.rounds.some((x) => x.current)).toBe(false);
  });
});

describe("toSidebarGroups (mystudy §1.1)", () => {
  it("labels, when, left", () => {
    const ms: MeStudies = { today: TODAY, groups: [
      { kind: "active", items: [{ slug: "aws", title: "AWS", intro: "a", membership: "joined", when: { kind: "deadline", date: "2026-10-14" } }, { slug: "spring", title: "Spring", intro: "s", membership: "joined", when: { kind: "deadline", date: "2026-10-18" } }] },
      { kind: "recruit", items: [{ slug: "sqld", title: "SQLD", intro: "q", membership: "pending", when: { kind: "start", date: "2026-10-26" } }] },
      { kind: "ended", items: [{ slug: "algo", title: "알고", intro: "l", membership: "joined", when: { kind: "end", date: "2026-09-30" } }] },
    ] };
    expect(toSidebarGroups(ms, TODAY)).toEqual([
      { label: "진행중", items: [{ id: "aws", title: "AWS", intro: "a", when: "10.14 마감", left: 2 }, { id: "spring", title: "Spring", intro: "s", when: "10.18 마감", left: 6 }] },
      { label: "모집중 · 신청한 방", items: [{ id: "sqld", title: "SQLD", intro: "q", when: "10.26 시작" }] },
      { label: "종료", items: [{ id: "algo", title: "알고", intro: "l", when: "09.30 종료" }] },
    ]);
    expect(toSidebarGroups({ today: TODAY, groups: [{ kind: "ended", items: [] }] }, TODAY)).toEqual([]);
  });
  it("rooms I lead are grouped as 내가 만든 방, not 신청한 방 (Q2-27)", () => {
    const ms: MeStudies = { today: TODAY, groups: [
      { kind: "recruit", items: [
        { slug: "mine", title: "내 방", intro: "m", membership: "leader", when: { kind: "start", date: "2026-11-01" } },
        { slug: "sqld", title: "SQLD", intro: "q", membership: "pending", when: { kind: "start", date: "2026-10-26" } },
      ] },
    ] };
    expect(toSidebarGroups(ms, TODAY)).toEqual([
      { label: "내가 만든 방 · 시작 전", items: [{ id: "mine", title: "내 방", intro: "m", when: "11.01 시작" }] },
      { label: "모집중 · 신청한 방", items: [{ id: "sqld", title: "SQLD", intro: "q", when: "10.26 시작" }] },
    ]);
  });
  it("active room without an open task (when.kind end) → \"MM.DD 까지\" (preflight C5)", () => {
    const ms: MeStudies = { today: TODAY, groups: [{ kind: "active", items: [{ slug: "aws", title: "AWS", intro: "a", membership: "joined", when: { kind: "end", date: "2026-12-31" } }] }] };
    expect(toSidebarGroups(ms, TODAY)).toEqual([{ label: "진행중", items: [{ id: "aws", title: "AWS", intro: "a", when: "12.31 까지" }] }]);
  });
});

describe("patchOf", () => {
  it("collects only overridden fields of a node", () => {
    const n = tree.nodes.find((x) => x.id === "21")!;
    expect(patchOf(n, { ...EMPTY_OVERRIDES, titles: { "21": "EC2 정리" }, dates: { "21": { e: "2026-10-15" } }, typeOv: { "21": "공통" } })).toEqual({ title: "EC2 정리", endDate: "2026-10-15", taskType: "common" });
    expect(patchOf(n, { ...EMPTY_OVERRIDES, assignOv: { "21": ["u1"] }, descs: { "21": "설명" } })).toEqual({ assigneeIds: ["u1"], descriptionMd: "설명" });
    expect(patchOf(n, EMPTY_OVERRIDES)).toEqual({});
  });
});

describe("filterSidebarGroups (Q3-06)", () => {
  const groups = [
    { label: "진행중", items: [{ id: "aws", title: "AWS SAA", intro: "IAM부터", when: "10.14 마감" }, { id: "spring", title: "Spring", intro: "JPA", when: "10.18 마감" }] },
    { label: "종료", items: [{ id: "algo", title: "알고리즘", intro: "백준", when: "09.30 종료" }] },
  ];
  it("empty query → unchanged", () => expect(filterSidebarGroups(groups, "  ")).toBe(groups));
  it("matches title or intro, case-insensitive; drops empty groups", () => {
    expect(filterSidebarGroups(groups, "aws")).toEqual([{ label: "진행중", items: [groups[0].items[0]] }]);
    expect(filterSidebarGroups(groups, "백준")).toEqual([groups[1]]);
    expect(filterSidebarGroups(groups, "zzzz")).toEqual([]);
  });
});
