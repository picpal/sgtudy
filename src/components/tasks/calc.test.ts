import { describe, expect, it } from "vitest";
import type { MeTaskItem, MeTasks } from "@/lib/api/types";
import { DEFAULT_FILTER, addBlockReason, studyNote, addableRounds, checkMode, addableStudies, applyFilter, atLimit, defaultCollapsed, defaultRound, emptyKind, normalizeFilter, personalCount, rowState, filterQuery, curriculumCmp, groupByDue, groupByRound, parseFilter, statusText, summary, type TasksFilter } from "./calc";

const item = (o: Partial<MeTaskItem> & { id: string }): MeTaskItem => ({
  slug: "aws", roundId: "a3", groupTitle: null, title: o.id, type: "common", startDate: "2026-10-15", endDate: "2026-10-21", st: "open", submittedAt: null, ...o,
});

const fx = (): MeTasks => ({
  today: "2026-10-16",
  personalPerRound: 20,
  studies: [
    { slug: "aws", title: "AWS", tone: "mint", status: "active", membership: "joined", currentRoundId: "a3", canAddPersonal: true },
    { slug: "old", title: "Old", tone: "mint", status: "ended", membership: "joined", currentRoundId: "o1", canAddPersonal: false },
  ],
  rounds: [
    { id: "a2", slug: "aws", label: "2주차", title: "r2", startDate: "2026-10-08", endDate: "2026-10-14", canAdd: true },
    { id: "a3", slug: "aws", label: "3주차", title: "r3", startDate: "2026-10-15", endDate: "2026-10-21", canAdd: true },
    { id: "o1", slug: "old", label: "1주차", title: "o1", startDate: "2026-09-01", endDate: "2026-09-07", canAdd: false },
  ],
  items: [
    item({ id: "t-late", title: "나", endDate: "2026-10-18" }),
    item({ id: "t-early", title: "다", endDate: "2026-10-17", type: "designated" }),
    item({ id: "p-open", title: "가", type: "personal", endDate: "2026-10-17" }),
    item({ id: "p-done", title: "라", type: "personal", endDate: "2026-10-16", st: "done" }),
    item({ id: "old-1", slug: "old", roundId: "o1", endDate: "2026-09-07", st: "missed" }),
  ],
});
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("filter", () => {
  it("parse/query 왕복, 기본값은 키 없음", () => {
    expect(filterQuery(DEFAULT_FILTER)).toEqual({});
    const f: TasksFilter = { scope: "all", group: "due", type: "personal", hideDone: true, study: "aws" };
    const q = filterQuery(f);
    expect(q).toEqual({ scope: "all", group: "due", type: "personal", done: "hide", study: "aws" });
    expect(parseFilter(new URLSearchParams(q))).toEqual(f);
    expect(parseFilter(new URLSearchParams("scope=x&group=y&type=z&done=q"))).toEqual(DEFAULT_FILTER);
  });
  it("scope current 는 종료 방을 뺀다", () => {
    const m = fx();
    expect(ids(applyFilter(m, DEFAULT_FILTER)).sort()).toEqual(["p-done", "p-open", "t-early", "t-late"]);
    expect(applyFilter(m, { ...DEFAULT_FILTER, scope: "all" })).toHaveLength(5);
  });
  it("hideDone / type / study", () => {
    const m = fx();
    expect(ids(applyFilter(m, { ...DEFAULT_FILTER, hideDone: true }))).not.toContain("p-done");
    expect(ids(applyFilter(m, { ...DEFAULT_FILTER, type: "personal" })).sort()).toEqual(["p-done", "p-open"]);
    expect(ids(applyFilter(m, { ...DEFAULT_FILTER, type: "team" })).sort()).toEqual(["t-early", "t-late"]);
    expect(ids(applyFilter(m, { ...DEFAULT_FILTER, scope: "all", study: "old" }))).toEqual(["old-1"]);
  });
});

describe("groupByRound", () => {
  it("정렬: 미완료 → 마감 → 팀 → 제목", () => {
    const m = fx();
    const g = groupByRound(m, applyFilter(m, DEFAULT_FILTER), DEFAULT_FILTER);
    expect(g).toHaveLength(1); // a3 만 (a2 는 현재 아님)
    expect(ids(g[0].items)).toEqual(["t-early", "p-open", "t-late", "p-done"]);
    expect(g[0].done).toBe(1);
    expect(g[0].canAdd).toBe(true);
  });
  it("빈 현재 회차도 그룹으로", () => {
    const m = fx();
    m.items = m.items.filter((i) => i.slug === "old");
    const g = groupByRound(m, applyFilter(m, DEFAULT_FILTER), DEFAULT_FILTER);
    expect(g.map((x) => x.round?.id)).toEqual(["a3"]);
    expect(g[0].items).toEqual([]);
  });
  it("scope all 은 회차 순, 종료 방은 canAdd false", () => {
    const m = fx();
    const f: TasksFilter = { ...DEFAULT_FILTER, scope: "all" };
    const g = groupByRound(m, applyFilter(m, f), f);
    expect(g.map((x) => x.round?.id)).toEqual(["a3", "o1"]);
    expect(g[1].canAdd).toBe(false);
  });
  it("개인 목표 한도 도달 시 canAdd false", () => {
    const m = fx();
    m.personalPerRound = 2;
    const g = groupByRound(m, applyFilter(m, DEFAULT_FILTER), DEFAULT_FILTER);
    expect(g[0].canAdd).toBe(false);
  });
});

describe("minor 보강", () => {
  it("없는 study slug 는 all 로 취급 (applyFilter·groupByRound)", () => {
    const m = fx();
    const f: TasksFilter = { ...DEFAULT_FILTER, study: "nope" };
    expect(applyFilter(m, f)).toHaveLength(4);
    expect(groupByRound(m, applyFilter(m, f), f)).toHaveLength(1);
  });
  it("회차는 시작일이 아니라 서버 배열 순서", () => {
    const m = fx();
    m.rounds = [m.rounds[1], m.rounds[0], m.rounds[2]]; // a3(10-15), a2(10-08)
    m.items.push(item({ id: "r2-item", roundId: "a2" }));
    const f: TasksFilter = { ...DEFAULT_FILTER, scope: "all" };
    expect(groupByRound(m, applyFilter(m, f), f).map((x) => x.round?.id)).toEqual(["a3", "a2", "o1"]);
  });
  it("type=team 이면 빈 현재 회차 그룹을 만들지 않는다", () => {
    const m = fx();
    m.items = m.items.filter((i) => i.slug === "old");
    const f: TasksFilter = { ...DEFAULT_FILTER, type: "team" };
    expect(groupByRound(m, applyFilter(m, f), f)).toEqual([]);
  });
  it("summary.left 는 종료된 방의 미완료를 세지 않는다", () => {
    const m = fx();
    const all = applyFilter(m, { ...DEFAULT_FILTER, scope: "all" });
    expect(summary(m, all).left).toBe(2); // 팀 과제만 (개인 목표는 따로 — 시나리오 QA #16)
  });
  it("round 를 못 찾은 항목은 round:null 그룹", () => {
    const m = fx();
    m.items.push(item({ id: "orph", roundId: "zz" }));
    const f: TasksFilter = { ...DEFAULT_FILTER, scope: "all" };
    const g = groupByRound(m, applyFilter(m, f), f);
    const o = g.find((x) => x.round === null)!;
    expect(ids(o.items)).toEqual(["orph"]);
    expect(o.canAdd).toBe(false);
  });
  it("스터디 순서는 slug 순이 아니라 서버 배열 순서", () => {
    const m = fx();
    m.studies = [m.studies[1], m.studies[0]]; // old, aws
    const f: TasksFilter = { ...DEFAULT_FILTER, scope: "all" };
    expect(groupByRound(m, applyFilter(m, f), f).map((x) => x.study.slug)).toEqual(["old", "aws", ]);
  });
});

/** 진행목표 트리(aws 3주차): 묶음 B(0) [L0(0) 완료, L1(1)] · 리프 T(1) · 내 개인 P1(2) · P2(3). 2주차 리프 Z, old 1주차 리프 W */
const ordFx = (): MeTasks => ({
  ...fx(),
  items: [
    item({ id: "P2", type: "personal", endDate: "2026-10-16", ord: [[3, 15]] }),
    item({ id: "T", endDate: "2026-10-16", ord: [[1, 13]] }),
    item({ id: "P1", type: "personal", endDate: "2026-10-18", ord: [[2, 14]] }),
    item({ id: "L1", groupTitle: "B", endDate: "2026-10-20", ord: [[0, 10], [1, 12]] }),
    item({ id: "L0", groupTitle: "B", endDate: "2026-10-21", st: "done", ord: [[0, 10], [0, 11]] }),
    item({ id: "Z", roundId: "a2", endDate: "2026-10-20", ord: [[0, 5]] }),
    item({ id: "W", slug: "old", roundId: "o1", endDate: "2026-10-20", ord: [[0, 1]] }),
  ],
});

describe("진행목표 순서 (ord, 0042)", () => {
  it("curriculumCmp: 형제 sort_order → 같으면 id, 조상이 먼저, 개인 목표는 팀 뒤", () => {
    const a = item({ id: "a", ord: [[1, 9]] });
    const b = item({ id: "b", ord: [[1, 3]] });
    const parent = item({ id: "p", ord: [[0, 50]] });
    const child = item({ id: "c", ord: [[0, 50], [0, 1]] });
    const mine = item({ id: "m", type: "personal", ord: [[0, 2]] });
    expect(ids([a, mine, child, b, parent].sort(curriculumCmp))).toEqual(["p", "c", "b", "a", "m"]);
  });
  it("회차별: 묶음 깊이 우선 → 팀 → 내 개인 목표(sort_order). 완료·마감일과 무관", () => {
    const m = ordFx();
    const g = groupByRound(m, applyFilter(m, DEFAULT_FILTER), DEFAULT_FILTER);
    expect(ids(g[0].items)).toEqual(["L0", "L1", "T", "P1", "P2"]);
  });
  it("마감일 묶기: 구간 → 마감일 → 스터디 → 회차 → 진행목표 순서", () => {
    const m = ordFx();
    const all = { ...DEFAULT_FILTER, scope: "all" as const, group: "due" as const };
    const secs = groupByDue(m, applyFilter(m, all), m.today);
    expect(Object.fromEntries(secs.map((s) => [s.key, ids(s.items)]))).toEqual({
      today: ["T", "P2"],
      next: ["P1", "Z", "L1", "W"],
      done: ["L0"],
    });
  });
  it("ord 없는 옛 서버 응답은 옛 정렬(미완료 → 마감 → 팀 → 제목)", () => {
    const m = ordFx();
    m.items = m.items.map(({ ord: _o, ...it }) => it); // eslint-disable-line @typescript-eslint/no-unused-vars
    const g = groupByRound(m, applyFilter(m, DEFAULT_FILTER), DEFAULT_FILTER);
    expect(ids(g[0].items)).toEqual(["T", "P2", "P1", "L1", "L0"]);
  });
});

describe("groupByDue", () => {
  const today = "2026-10-16";
  const mk = (id: string, endDate: string, st: MeTaskItem["st"] = "open") => item({ id, endDate, st });
  it("경계", () => {
    const secs = groupByDue(
      fx(),
      [mk("od", "2026-10-15"), mk("td", "2026-10-16"), mk("sat", "2026-10-17"), mk("sun", "2026-10-18"), mk("nsat", "2026-10-24"), mk("later", "2026-10-25"), mk("dn", "2026-10-10", "done"), mk("ln", "2026-10-10", "late")],
      today,
    );
    const by = Object.fromEntries(secs.map((s) => [s.key, ids(s.items)]));
    expect(by).toEqual({ overdue: ["od"], today: ["td"], week: ["sat"], next: ["sun", "nsat"], later: ["later"], done: ["dn", "ln"] });
    expect(secs.map((s) => s.key)).toEqual(["overdue", "today", "week", "next", "later", "done"]);
  });
  it("오늘이 토요일: week 는 비고 next = 다음 일~토", () => {
    const secs = groupByDue(fx(), [mk("t", "2026-10-17"), mk("sun", "2026-10-18"), mk("nsat", "2026-10-24"), mk("later", "2026-10-25")], "2026-10-17");
    expect(Object.fromEntries(secs.map((s) => [s.key, ids(s.items)]))).toEqual({ today: ["t"], next: ["sun", "nsat"], later: ["later"] });
  });
  it("오늘이 일요일: week = 월~토", () => {
    const secs = groupByDue(fx(), [mk("t", "2026-10-18"), mk("mon", "2026-10-19"), mk("sat", "2026-10-24"), mk("nsun", "2026-10-25"), mk("later", "2026-11-02")], "2026-10-18");
    expect(Object.fromEntries(secs.map((s) => [s.key, ids(s.items)]))).toEqual({ today: ["t"], week: ["mon", "sat"], next: ["nsun"], later: ["later"] });
  });
  it("빈 섹션은 뺀다", () => {
    expect(groupByDue(fx(), [mk("a", "2026-10-16")], today).map((s) => s.key)).toEqual(["today"]);
  });
});

describe("summary / statusText", () => {
  it("집계", () => {
    const m = fx();
    expect(summary(m, applyFilter(m, DEFAULT_FILTER))).toEqual({ left: 2, dueToday: 0, personalDone: 1, personalTotal: 2 });
  });
  it("남은 과제는 팀 과제만 센다 — 개인 목표는 '개인 목표 d/t' 로 따로 (시나리오 QA #16)", () => {
    const m = fx();
    m.items = m.items.filter((it) => it.type === "personal");
    expect(summary(m, applyFilter(m, DEFAULT_FILTER)).left).toBe(0);
  });
  it("상태 문구", () => {
    expect(statusText(item({ id: "a", type: "personal", st: "done" }))).toBe("기한내 완료");
    expect(statusText(item({ id: "a", type: "personal", st: "late" }))).toBe("늦게 완료");
    expect(statusText(item({ id: "a", st: "late" }))).toBe("지각 제출");
    expect(statusText(item({ id: "a", st: "open" }))).toBe("진행중");
    // 마감 지난 미완료 개인 = "기한 지남" (Ruling — model.codeLabel 과 같은 출처), 팀은 그대로 "미제출"
    expect(statusText(item({ id: "a", type: "personal", st: "missed" }))).toBe("기한 지남");
    expect(statusText(item({ id: "a", st: "missed" }))).toBe("미제출");
  });
});

describe("화면 판단 (Task 12 수정 1)", () => {
  it("normalizeFilter: 모르는 study 는 all, 아는 건 그대로", () => {
    const m = fx();
    expect(normalizeFilter(m, { ...DEFAULT_FILTER, study: "zzz" })).toEqual(DEFAULT_FILTER);
    expect(normalizeFilter(m, { ...DEFAULT_FILTER, study: "aws" }).study).toBe("aws");
  });
  it("personalCount / addableRounds / addableStudies / defaultRound", () => {
    const m = fx();
    expect(personalCount(m, "a3")).toBe(2);
    expect(personalCount(m, "a2")).toBe(0);
    expect(addableRounds(m, "aws").map((r) => r.id)).toEqual(["a2", "a3"]);
    expect(addableRounds(m, "old")).toEqual([]);
    expect(addableStudies(m).map((s) => s.slug)).toEqual(["aws"]);
    expect(defaultRound(m, "aws")).toBe("a3");
    expect(defaultRound(m, "old")).toBe("");
    const full = { ...m, personalPerRound: 2 };
    expect(addableRounds(full, "aws").map((r) => r.id)).toEqual(["a2"]); // 가득 찬 현재 회차는 빠진다
    expect(defaultRound(full, "aws")).toBe("a2");
    const none = { ...m, personalPerRound: 0 };
    expect(addableStudies(none)).toEqual([]);
  });
  it("atLimit: 추가 가능한 방·회차인데 개수만 찼을 때만", () => {
    const m = { ...fx(), personalPerRound: 2 };
    const gs = groupByRound(m, applyFilter(m, { ...DEFAULT_FILTER, scope: "all" }), { ...DEFAULT_FILTER, scope: "all" });
    const a3 = gs.find((g) => g.round?.id === "a3")!;
    const o1 = gs.find((g) => g.round?.id === "o1")!;
    expect(atLimit(m, a3)).toBe(true);
    expect(atLimit(m, o1)).toBe(false); // 종료 방은 안내 없음
    expect(atLimit(fx(), groupByRound(fx(), applyFilter(fx(), DEFAULT_FILTER), DEFAULT_FILTER)[0])).toBe(false);
  });
  it("defaultCollapsed: scope all 의 지난 회차만", () => {
    const m = fx();
    const all = { ...DEFAULT_FILTER, scope: "all" as const };
    const gs = groupByRound(m, applyFilter(m, all), all);
    const by = (id: string) => gs.find((g) => g.round?.id === id)!;
    expect(defaultCollapsed(by("o1"), all, m.today)).toBe(true);
    expect(defaultCollapsed(by("a3"), all, m.today)).toBe(false);
    expect(defaultCollapsed(by("o1"), DEFAULT_FILTER, m.today)).toBe(false);
    expect(defaultCollapsed({ ...by("o1"), round: null }, all, m.today)).toBe(false);
  });
  it("emptyKind", () => {
    const m = fx();
    expect(emptyKind({ ...m, studies: [] }, DEFAULT_FILTER, [])).toBe("noStudy");
    expect(emptyKind(m, DEFAULT_FILTER, [])).toBe("noTasks");
    expect(emptyKind(m, { ...DEFAULT_FILTER, group: "due", scope: "all" }, [])).toBe("noTasks");
    expect(emptyKind(m, { ...DEFAULT_FILTER, study: "zzz" }, [])).toBe("noTasks"); // 모르는 스터디 = 필터 없음
    expect(emptyKind(m, { ...DEFAULT_FILTER, type: "team" }, [])).toBe("filtered");
    expect(emptyKind(m, { ...DEFAULT_FILTER, hideDone: true }, [])).toBe("filtered");
    expect(emptyKind(m, { ...DEFAULT_FILTER, study: "aws" }, [])).toBe("filtered");
    expect(emptyKind(m, DEFAULT_FILTER, m.items)).toBeNull();
  });
  it("rowState: 상태 톤과 마감 강조", () => {
    const t = "2026-10-16";
    expect(rowState(item({ id: "a", st: "done" }), t)).toEqual({ tone: "done", dueHot: false });
    expect(rowState(item({ id: "a", st: "late", endDate: "2026-10-10" }), t)).toEqual({ tone: "late", dueHot: false });
    expect(rowState(item({ id: "a", st: "missed", endDate: "2026-10-10" }), t)).toEqual({ tone: "missed", dueHot: true });
    expect(rowState(item({ id: "a", st: "open", endDate: t }), t)).toEqual({ tone: "hot", dueHot: true });
    expect(rowState(item({ id: "a", st: "open", endDate: "2026-10-12", type: "personal" }), t)).toEqual({ tone: "plain", dueHot: true });
    expect(rowState(item({ id: "a", st: "planned", endDate: "2026-10-20" }), t)).toEqual({ tone: "plain", dueHot: false });
  });
});

describe("checkMode (오케스트레이터 결정: 종료 방은 숨김)", () => {
  it("active = 누를 수 있음, recruit/draft = 비활성, ended = 숨김", () => {
    const s = fx().studies[0];
    expect(checkMode({ ...s, status: "active" })).toBe("enabled");
    expect(checkMode({ ...s, status: "recruit" })).toBe("disabled");
    expect(checkMode({ ...s, status: "draft" })).toBe("disabled");
    expect(checkMode({ ...s, status: "ended" })).toBe("hidden");
  });
});

describe("addBlockReason / studyNote — 추가 못 하는 방은 이유 안내 (QA Q3-2)", () => {
  const draft = (): MeTasks => {
    const m = fx();
    m.studies.push({ slug: "mine", title: "내 방", tone: "lav", status: "draft", membership: "leader", currentRoundId: "m1", canAddPersonal: false });
    m.rounds.push({ id: "m1", slug: "mine", label: "1주차", title: "m1", startDate: "2026-11-01", endDate: "2026-11-07", canAdd: false });
    return m;
  };
  it("추가할 수 있는 방은 null", () => expect(addBlockReason(fx(), "aws")).toBeNull());
  it("준비중(모집 전) 방 · 종료 방 · 회차 없음 · 한도", () => {
    expect(addBlockReason(draft(), "mine")).toBe("모집을 시작하면 개인 목표를 추가할 수 있어요");
    expect(addBlockReason(fx(), "old")).toBe("종료된 스터디에는 내 목표를 추가할 수 없어요");
    const none = fx();
    none.rounds = none.rounds.filter((r) => r.slug !== "aws");
    expect(addBlockReason(none, "aws")).toBe("아직 회차가 없어 내 목표를 추가할 수 없어요");
    const full = fx();
    full.personalPerRound = 1;
    full.items.push(item({ id: "p-a2", roundId: "a2", type: "personal" }));
    expect(addBlockReason(full, "aws")).toBe("모든 회차에 내 목표가 1개씩 있어 더 추가할 수 없어요");
  });
  it("종료가 아닌데 추가 자격이 없으면(서버 canAddPersonal 거짓) '종료' 라고 하지 않는다 (최종 리뷰 Minor 7)", () => {
    const m = fx();
    m.studies = m.studies.map((x) => (x.slug === "aws" ? { ...x, canAddPersonal: false } : x));
    expect(addBlockReason(m, "aws")).toBe("지금은 이 스터디에 내 목표를 추가할 수 없어요");
  });
  it("studyNote: 준비중 방만 스터디 묶음 머리 아래 안내", () => {
    const m = draft();
    expect(studyNote(m.studies.find((s) => s.slug === "mine")!)).toBe("모집을 시작하면 개인 목표를 추가할 수 있어요");
    expect(studyNote(m.studies[0])).toBeNull();
    expect(studyNote(m.studies[1])).toBeNull(); // 종료 방은 읽기 전용 — 안내 없음(시안 E-4)
  });
});
