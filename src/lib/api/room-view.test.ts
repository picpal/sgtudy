import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/date";
import { safeReturnTo } from "@/lib/routes";
import { roomStatusLabel } from "@/lib/types";
import { actionOf, applyMembership, firstParam, groupSidebar, roomReturnTo, toRoom, toSidebarRoom } from "./room-view";
import type { RoomCardDto, RoomDetail, RoundSummary } from "./types";

const TODAY = "2026-10-12";
const P = (userId: string, nickname: string, tone: RoomDetail["leader"]["tone"] = "mint") => ({ userId, nickname, tone });
const weekly = (n: number, start: string): RoundSummary[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i + 1), label: `${i + 1}주차`, title: `R${i + 1}`, startDate: addDays(start, i * 7), endDate: addDays(start, i * 7 + 6), leafCount: 2, assigned: 0, submitted: 0, pct: null }));
const stats = (o: Partial<RoomDetail["stats"]> = {}): RoomDetail["stats"] => ({ roundCount: 8, leafCount: 16, commonCount: 16, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [1], ...o });
const detail = (o: Partial<RoomDetail> = {}): RoomDetail => ({
  today: TODAY, id: "1", slug: "toeic", title: "토익 900 8주 챌린지", intro: "매일 LC·RC", descriptionMd: "8주 동안", rulesMd: "- 오답 노트\n- 모의고사는 120분",
  status: "recruit", archived: false, isPublic: true, joinMode: "direct", startDate: "2026-11-02", endDate: "2026-12-27", maxMembers: 8, minMembers: 4, memberCount: 2,
  leader: P("u-seoyeon", "서연", "blue"), leaderDoesTasks: true, tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }, { slug: "toeic", label: "토익", tone: "peach", auto: true }],
  members: [{ ...P("u-seoyeon", "서연", "blue"), role: "leader", status: "active", joinedAt: "2026-10-01T00:00:00.000Z" }, { ...P("u-dohyun", "도현"), role: "member", status: "active", joinedAt: "2026-10-02T00:00:00.000Z" }],
  me: { state: "none" }, currentRound: null, rounds: weekly(8, "2026-11-02"), stats: stats(), myProgress: null, invite: null, pendingCount: 0, myPermissions: { canEditCurriculum: false }, ...o,
});

describe("actionOf — inactive viewer (T7 rule)", () => {
  it("inactive member gets a disabled 'inactive' CTA instead of join/apply", () => {
    expect(actionOf(detail({ me: { state: "inactive" } }))).toBe("inactive");
    expect(actionOf(detail({ joinMode: "approval", me: { state: "inactive" } }))).toBe("inactive");
    expect(toRoom(detail({ me: { state: "inactive" } }), TODAY, "u-x").base).toBe("inactive");
  });
});

describe("actionOf — anonymous viewer sees the room state first (Q2-11/Q3-12)", () => {
  it("full / active / ended rooms show the disabled state instead of login", () => {
    expect(actionOf(detail({ me: null, memberCount: 8 }))).toBe("full");
    expect(actionOf(detail({ me: null, status: "active" }))).toBe("activeClosed");
    expect(actionOf(detail({ me: null, status: "ended" }))).toBe("ended");
    expect(toRoom(detail({ me: null, status: "ended" }), TODAY, null).base).toBe("ended");
  });
  it("joinable rooms still ask to log in", () => {
    expect(actionOf(detail({ me: null }))).toBe("login");
    expect(actionOf(detail({ me: null, joinMode: "approval" }))).toBe("login");
    expect(actionOf(detail({ me: null, status: "draft" }))).toBe("login");
  });
});

describe("roomReturnTo / firstParam (private invite entry)", () => {
  it("keeps the invite token and survives safeReturnTo", () => {
    expect(roomReturnTo("spring", "abc_DEF-123")).toBe("/rooms/spring?invite=abc_DEF-123");
    expect(safeReturnTo(roomReturnTo("spring", "abc_DEF-123"))).toBe("/rooms/spring?invite=abc_DEF-123");
    expect(roomReturnTo("spring")).toBe("/rooms/spring");
    expect(roomReturnTo("spring", "a b&c")).toBe("/rooms/spring?invite=a%20b%26c");
  });
  it("firstParam takes the first of repeated params", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam("x")).toBe("x");
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam("")).toBeUndefined();
  });
});

describe("actionOf (03-api §3 결정 순서, roomview §3.5 목업 대응)", () => {
  it("table", () => {
    expect(actionOf(detail({ me: null }))).toBe("login");
    expect(actionOf(detail())).toBe("join");                                                     // toeic
    expect(actionOf(detail({ joinMode: "approval", memberCount: 1, maxMembers: 5, me: { state: "pending" } }))).toBe("pending"); // sqld
    expect(actionOf(detail({ me: { state: "leader" } }))).toBe("owner");                         // docker
    expect(actionOf(detail({ joinMode: "approval", memberCount: 4, maxMembers: 4 }))).toBe("full"); // jcg
    expect(actionOf(detail({ status: "active", joinMode: "approval", me: { state: "active" } }))).toBe("joined"); // aws
    expect(actionOf(detail({ status: "active" }))).toBe("activeClosed");                          // react
    expect(actionOf(detail({ status: "ended", me: { state: "active" } }))).toBe("joined");         // algo — D14: ended+member → joined
    expect(actionOf(detail({ status: "ended" }))).toBe("ended");
    expect(actionOf(detail({ me: { state: "active" } }))).toBe("leave");                          // recruit + joined
    expect(actionOf(detail({ joinMode: "approval" }))).toBe("apply");
    expect(actionOf(detail({ status: "draft", me: { state: "leader" } }))).toBe("owner");
  });
});

describe("toRoom", () => {
  it("DRAFT → draft badge (준비중), RECRUIT → 모집중 — same as the home card and 내 스터디", () => {
    const d = toRoom(detail({ status: "draft" }), TODAY, null);
    expect([d.status, d.draft, roomStatusLabel(d.status, d.draft)]).toEqual(["recruit", true, "준비중"]);
    const r = toRoom(detail(), TODAY, null);
    expect([r.status, r.draft, roomStatusLabel(r.status, r.draft)]).toEqual(["recruit", false, "모집중"]);
  });
  it("toeic recruit: period/dday/members/glance/rounds window", () => {
    const r = toRoom(detail(), TODAY, null);
    expect(r.id).toBe("toeic");
    expect(r.status).toBe("recruit");
    expect(r.base).toBe("recruit");
    expect(r.period).toBe("2026.11.02(월) – 12.27(일)");
    expect(r.when).toBe("D-21");
    expect(r.ddayLong).toBe("시작까지 D-21");
    expect(r.capCur).toBe(2);
    expect(r.minNeed).toBe(4);
    expect(r.members).toEqual([{ userId: "u-seoyeon", name: "서연", tone: "blue", leader: true, me: false }, { userId: "u-dohyun", name: "도현", tone: "mint", leader: false, me: false }]);
    expect(r.cur.title).toBe("11월 2일(월) 첫 회차가 열려요");
    expect(r.rules).toEqual(["오답 노트", "모의고사는 120분"]);
    expect(r.rounds.map((x) => x.label)).toEqual(["1주차", "2주차", "3주차"]);
    expect(r.rounds[0].state).toBe("과제 2개");
    expect(r.moreRounds).toBe("이후 5개 회차가 더 있어요");
    expect(r.glance).toEqual({ rounds: "8회차 · 매주 월요일 시작", tasks: "16개 · 모두 공통 과제" });
  });
  it("aws active member: me flag by userId, 3-round window, 이후 10개", () => {
    const d = detail({ slug: "aws", status: "active", joinMode: "approval", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 4,
      leader: P("u2", "민수"), rounds: weekly(13, "2026-10-01"), stats: stats({ roundCount: 13, leafCount: 8, commonCount: 5, designatedCount: 3, startWeekdays: [4] }), me: { state: "active" },
      members: [{ ...P("u2", "민수"), role: "leader", status: "active", joinedAt: null }, { ...P("u3", "지은", "peach"), role: "member", status: "active", joinedAt: null }, { ...P("u1", "철수", "blue"), role: "member", status: "active", joinedAt: null }, { ...P("u4", "하나", "lav"), role: "member", status: "active", joinedAt: null }, { ...P("u5", "도윤", "slate"), role: "member", status: "inactive", joinedAt: null }] });
    const r = toRoom(d, TODAY, "u1");
    expect(r.base).toBe("joined");
    expect(r.dday).toBe("D-80");
    expect(r.members.map((m) => [m.name, !!m.me])).toEqual([["민수", false], ["지은", false], ["철수", true], ["하나", false]]); // 이탈자 제외
    expect(r.rounds.map((x) => x.label)).toEqual(["1주차", "2주차", "3주차"]);
    expect(r.rounds[1].current).toBe(true);
    expect(r.moreRounds).toBe("이후 10개 회차가 더 있어요");
    expect(r.glance.rounds).toBe("13회차 · 매주 목요일 시작");
  });
  it("react: 1~2주차 완료 · 이후 3개", () => {
    const r = toRoom(detail({ slug: "react", status: "active", startDate: "2026-09-21", endDate: "2026-11-15", rounds: weekly(8, "2026-09-21") }), TODAY, null);
    expect(r.rounds.map((x) => x.label)).toEqual(["3주차", "4주차", "5주차"]);
    expect(r.moreRounds).toBe("1~2주차 완료 · 이후 3개 회차가 더 있어요");
    expect(r.base).toBe("activeClosed");
  });
  it("gap between rounds, server shape currentRound = previous round (preflight C2): no current row", () => {
    const gap = [{ ...weekly(1, "2026-10-01")[0], endDate: "2026-10-05" }, { ...weekly(1, "2026-10-15")[0], id: "2", label: "2주차" }];
    const r = toRoom(detail({ status: "active", startDate: "2026-10-01", endDate: "2026-12-31", currentRound: gap[0], rounds: gap, stats: stats({ roundCount: 2 }) }), TODAY, null);
    expect(r.cur.title).toBe("진행 중인 회차가 없어요");
    expect(r.rounds.some((x) => x.current)).toBe(false);
  });
  it("my pending row is appended as pending member", () => {
    const d = detail({ slug: "sqld", joinMode: "approval", memberCount: 1, maxMembers: 5, me: { state: "pending" },
      members: [{ ...P("u-gaeun", "가은", "amber"), role: "leader", status: "active", joinedAt: null }, { ...P("u1", "철수", "blue"), role: "member", status: "pending", joinedAt: null }] });
    const r = toRoom(d, TODAY, "u1");
    expect(r.members).toEqual([{ userId: "u-gaeun", name: "가은", tone: "amber", leader: true, me: false }, { userId: "u1", name: "철수", tone: "blue", leader: false, me: true, pending: true }]);
    expect(r.capCur).toBe(1);
  });
});

describe("applyMembership", () => {
  it("replaces me/memberCount/members/pendingCount from MembershipResult (no optimistic +1)", () => {
    const d = detail();
    const next = applyMembership(d, { me: { state: "active" }, memberCount: 3, members: [...d.members, { ...P("u1", "철수", "blue"), role: "member", status: "active", joinedAt: null }], pendingCount: 0 });
    expect(next.memberCount).toBe(3);
    expect(actionOf(next)).toBe("leave");
    expect(toRoom(next, TODAY, "u1").members.at(-1)).toMatchObject({ name: "철수", me: true });
  });
});

describe("sidebar", () => {
  const card = (o: Partial<RoomCardDto>): RoomCardDto => ({ id: "1", slug: "toeic", title: "토익", intro: "", status: "recruit", isFull: false, isPublic: true, joinMode: "direct", memberCount: 2, maxMembers: 8, leader: P("u", "서연"), tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }], startDate: "2026-11-02", endDate: "2026-12-27", membership: null, progress: { kind: "recruit" }, ...o });
  it("toSidebarRoom", () => {
    expect(toSidebarRoom(card({}), TODAY)).toEqual({ id: "toeic", title: "토익", status: "recruit", draft: false, when: "D-21", period: "2026.11.02 – 12.27", tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }], capCur: 2, capMax: 8, mark: undefined });
    expect(toSidebarRoom(card({ membership: { role: "member", status: "pending" } }), TODAY).mark).toBe("pending");
    expect(toSidebarRoom(card({ membership: { role: "leader", status: "active" } }), TODAY).mark).toBe("owner");
    expect(toSidebarRoom(card({ membership: { role: "member", status: "active" } }), TODAY).mark).toBe("leave");
    expect(toSidebarRoom(card({ status: "active", membership: { role: "member", status: "active" } }), TODAY).mark).toBe("joined");
    expect(toSidebarRoom(card({ status: "ended", startDate: "2026-07-01", endDate: "2026-09-30" }), TODAY).when).toBe("종료");
  });
  it("groupSidebar orders 준비중 → 모집중 → 진행중 → 종료 and drops empty groups (DRAFT is not 모집중)", () => {
    const g = groupSidebar([toSidebarRoom(card({ status: "ended", slug: "algo" }), TODAY), toSidebarRoom(card({}), TODAY), toSidebarRoom(card({ status: "draft", slug: "d" }), TODAY)]);
    expect(g.map((x) => [x.key, x.label, x.status, x.items.map((i) => i.id)])).toEqual([["draft", "준비중", "recruit", ["d"]], ["recruit", "모집중", "recruit", ["toeic"]], ["ended", "종료", "ended", ["algo"]]]);
  });
});

// 시나리오 QA D4: 참가 신청 한마디 (0024 room_apply·invite_join p_message — 다듬고 빈 값은 null)
describe("참가 신청 한마디", () => {
  it("applyRoom·joinByInvite 가 p_message 를 넘긴다", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const client = { rpc: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return Promise.resolve({ data: {}, error: null }); } } as unknown as import("./errors").Db;
    const { applyRoom } = await import("./room-view");
    const { joinByInvite } = await import("./invite");
    await applyRoom("r1", undefined, "  잘 부탁드려요 ", client);
    await applyRoom("r1", "tok", "   ", client);
    await joinByInvite("tok", "안녕하세요", client);
    expect(calls).toEqual([
      ["room_apply", { p_slug: "r1", p_invite_token: null, p_message: "잘 부탁드려요" }],
      ["room_apply", { p_slug: "r1", p_invite_token: "tok", p_message: null }],
      ["invite_join", { p_token: "tok", p_message: "안녕하세요" }],
    ]);
  });
});

// 최종 수정 4: 방 화면(/rooms/[slug])도 보관 방은 "보관된 스터디" 로 — 종료·진행중·D-n 이 섞이지 않게 (내 스터디와 같은 규칙)
describe("toRoom · actionOf — 보관된 방", () => {
  const active = detail({ status: "active", archived: true, stats: stats({ roundCount: 4 }), startDate: "2026-10-01", endDate: "2026-12-31", rounds: weekly(4, "2026-10-01"), currentRound: weekly(4, "2026-10-01")[1] });
  it("표기를 보관으로 통일", () => {
    const r = toRoom(active, TODAY, "u-x");
    expect(r).toMatchObject({ archived: true, dday: "보관됨", ddayLong: "보관된 스터디 · 기록만 볼 수 있어요" });
    expect(r.cur).toMatchObject({ pill: "보관됨", title: "보관된 스터디예요", tasks: [] });
    expect(r.rounds.every((x) => x.state === "보관됨" && !x.current)).toBe(true);
    expect(r.glance.rounds).toBe("4회차 · 보관됨");
    expect(toRoom(detail(), TODAY, "u-x").archived).toBe(false);
  });
  it("참가 버튼 대신 보관 안내 — 그룹장은 관리, 참가자는 내 스터디", () => {
    expect(actionOf({ ...active, me: { state: "none" } })).toBe("archived");
    expect(actionOf({ ...active, me: { state: "leader" } })).toBe("owner");
    expect(actionOf({ ...active, me: { state: "active" } })).toBe("joined");
    expect(actionOf({ ...detail({ archived: true }), me: { state: "active" } })).toBe("joined"); // 모집 중 보관도 참가 취소 없음
    expect(actionOf({ ...active, me: null })).toBe("archived");
  });
});
