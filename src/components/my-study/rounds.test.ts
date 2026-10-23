import { describe, expect, it } from "vitest";
import { AWS, CHULSU, REF_DAY } from "./fixtures";
import { EMPTY_OVERRIDES, buildTree, findNode, visibleNodes, type LeafNode, type ParentNode, type TreeNode } from "./model";
import { currentRoundId, sameShiftAsk, shiftAskOf, shiftAskText, shiftedText, designatedHint, dropPlan, roundsOutsidePeriod, moveNote, movedPeriod, movedPlan, normalizeTitle, reorderIndex, roundOf, roundOptions, rowMoves, shouldSubmitQuickAdd, siblingIndex, withAddRows, withEmptyRounds, withPersonalAddRows, type ListEntry } from "./rounds";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const root = (id: string) => tree.roots.find((r) => r.id === id)!;
const node = (id: string) => tree.nodes.find((n) => n.id === id)!;
const archivedTree = buildTree({ ...AWS, nodes: AWS.nodes.map((n) => (n.id === "2" || n.parentId === "2" ? { ...n, archived: true } : n)) }, EMPTY_OVERRIDES, REF_DAY);

describe("currentRoundId", () => {
  it("round containing today", () => expect(currentRoundId(tree.roots, REF_DAY)).toBe("2"));
  it("before all rounds → first upcoming", () => expect(currentRoundId(tree.roots, "2026-09-01")).toBe("1"));
  it("after all rounds → last round", () => expect(currentRoundId(tree.roots, "2026-12-01")).toBe("5"));
  it("skips archived rounds", () => expect(currentRoundId(archivedTree.roots, REF_DAY)).toBe("3"));
  it("no rounds → all", () => expect(currentRoundId([], REF_DAY)).toBe("all"));
});

describe("roundOptions", () => {
  it("label · title (period) for every live round", () => {
    const o = roundOptions(tree.roots);
    expect(o.map((x) => x.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(o[0].text).toBe("1주차 · IAM·VPC (10.01 – 10.07)");
  });
  it("excludes archived rounds", () => expect(roundOptions(archivedTree.roots).map((x) => x.id)).toEqual(["1", "3", "4", "5"]));
  // F 리뷰 n1: 라벨 없는 회차는 앞에 " · " 를 남기지 않는다
  it("no label → title (period) without a leading separator", () => {
    const [r] = tree.roots;
    expect(roundOptions([{ ...r, label: null }])[0].text).toBe("IAM·VPC (10.01 – 10.07)");
  });
});

describe("roundOf", () => {
  it("task directly under a round", () => expect(roundOf(tree.nodes, node("21"))?.id).toBe("2"));
  it("task inside a legacy 묶음 still resolves to its round", () => expect(roundOf(tree.nodes, node("311"))?.id).toBe("3"));
  it("a round is its own round", () => expect(roundOf(tree.nodes, node("4"))?.id).toBe("4"));
});

describe("movedPeriod", () => {
  const r1 = { s: "2026-10-01", e: "2026-10-07" };
  const r2 = { s: "2026-10-08", e: "2026-10-14" };
  it("keeps dates when the task has submissions", () => expect(movedPeriod({ s: "2026-10-01", e: "2026-10-03", subAll: 2 }, r1, r2)).toBeNull());
  it("keeps dates already inside the new round", () => expect(movedPeriod({ s: "2026-10-10", e: "2026-10-12", subAll: 0 }, r1, r2)).toBeNull());
  it("shifts by the offset from the round start, keeping the length", () =>
    expect(movedPeriod({ s: "2026-10-04", e: "2026-10-07", subAll: 0 }, r1, r2)).toEqual({ s: "2026-10-11", e: "2026-10-14" }));
  it("clamps the end to a shorter round", () =>
    expect(movedPeriod({ s: "2026-10-01", e: "2026-10-07", subAll: 0 }, r1, { s: "2026-10-08", e: "2026-10-10" })).toEqual({ s: "2026-10-08", e: "2026-10-10" }));
  it("clamps the start when the offset runs past the round", () =>
    expect(movedPeriod({ s: "2026-10-06", e: "2026-10-07", subAll: 0 }, r1, { s: "2026-10-08", e: "2026-10-09" })).toEqual({ s: "2026-10-09", e: "2026-10-09" }));
  it("a task that started before its old round starts at the new round start", () =>
    expect(movedPeriod({ s: "2026-09-29", e: "2026-10-02", subAll: 0 }, r1, r2)).toEqual({ s: "2026-10-08", e: "2026-10-11" }));
});

describe("movedPlan (묶음째 다른 회차로 — 서브트리 기간)", () => {
  const r3 = { s: "2026-10-15", e: "2026-10-21" };
  const r4 = { s: "2026-10-22", e: "2026-10-28" };
  const shortR = { s: "2026-10-22", e: "2026-10-24" };
  const leafN = (id: string, s: string, e: string, subAll = 0, archived = false) => ({ id, s, e, subAll, archived, leaf: true as const });
  const group = (kids: ReturnType<typeof leafN>[], s = "2026-10-15", e = "2026-10-21") => ({ id: "g", s, e, subAll: kids.reduce((a, k) => a + k.subAll, 0), archived: false, leaf: false as const, kids });
  it("a single task = movedPeriod", () => {
    expect(movedPlan(leafN("t", "2026-10-17", "2026-10-18"), r3, r4)).toEqual([{ id: "t", s: "2026-10-24", e: "2026-10-25" }]);
    expect(movedPlan(leafN("t", "2026-10-17", "2026-10-18", 1), r3, r4)).toEqual([]);
  });
  it("fixture 묶음 31 → 4주차: the 묶음 and its task both shift (묶음 first)", () =>
    expect(movedPlan(node("31"), root("3"), root("4"))).toEqual([
      { id: "31", s: "2026-10-22", e: "2026-10-28" },
      { id: "311", s: "2026-10-22", e: "2026-10-28" },
    ]));
  it("every descendant keeps its offset from the round start, clamped to the new round", () =>
    expect(movedPlan(group([leafN("a", "2026-10-15", "2026-10-16"), leafN("b", "2026-10-19", "2026-10-21")]), r3, shortR)).toEqual([
      { id: "g", s: "2026-10-22", e: "2026-10-24" },
      { id: "a", s: "2026-10-22", e: "2026-10-23" },
      { id: "b", s: "2026-10-24", e: "2026-10-24" },
    ]));
  it("a task with submissions keeps its dates; the 묶음 itself still moves (its own subAll is the kids')", () =>
    expect(movedPlan(group([leafN("a", "2026-10-15", "2026-10-16", 2), leafN("b", "2026-10-17", "2026-10-18")]), r3, r4)).toEqual([
      { id: "g", s: "2026-10-22", e: "2026-10-28" },
      { id: "b", s: "2026-10-24", e: "2026-10-25" },
    ]));
  it("skips archived descendants (node_update refuses them) and nodes already inside the new round", () =>
    expect(movedPlan(group([leafN("a", "2026-10-15", "2026-10-16", 0, true), leafN("b", "2026-10-23", "2026-10-24")], "2026-10-15", "2026-10-28"), r3, r4)).toEqual([
      { id: "g", s: "2026-10-22", e: "2026-10-28" },
    ]));
});

describe("siblingIndex / reorderIndex", () => {
  it("index among the parent's kids", () => {
    expect(siblingIndex(root("1"), "11")).toBe(0);
    expect(siblingIndex(root("1"), "12")).toBe(1);
  });
  it("up/down targets, null at the edges", () => {
    expect(reorderIndex(root("1"), "11", -1)).toBeNull();
    expect(reorderIndex(root("1"), "11", 1)).toBe(1);
    expect(reorderIndex(root("1"), "12", -1)).toBe(0);
    expect(reorderIndex(root("1"), "12", 1)).toBeNull();
  });
});

describe("withAddRows", () => {
  const kinds = (closed: Record<string, boolean>, t = tree) =>
    withAddRows(visibleNodes(t.roots, closed), t.roots, closed).map((e) => (e.kind === "node" ? e.n.id : `+${e.round.id}`));
  it("an add row after the last visible row of every open round (묶음 children included)", () =>
    expect(kinds({})).toEqual(["1", "11", "12", "+1", "2", "21", "22", "+2", "3", "31", "311", "33", "32", "+3", "4", "41", "+4", "5", "51", "52", "+5"]));
  it("closed round → no add row", () => expect(kinds({ "1": true }).slice(0, 3)).toEqual(["1", "2", "21"]));
  it("empty open round still gets an add row", () => {
    const t = buildTree({ ...AWS, nodes: AWS.nodes.filter((n) => n.roundId !== "4" || n.id === "4") }, EMPTY_OVERRIDES, REF_DAY);
    expect(kinds({}, t)).toContain("+4");
    expect(kinds({}, t).slice(kinds({}, t).indexOf("4"), kinds({}, t).indexOf("4") + 2)).toEqual(["4", "+4"]);
  });
  it("archived round → no add row", () => expect(kinds({}, archivedTree)).not.toContain("+2"));
});

describe("normalizeTitle", () => {
  it("trims, rejects blank, caps at 80", () => {
    expect(normalizeTitle("  VPC 실습 ")).toBe("VPC 실습");
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle("가".repeat(90))).toHaveLength(80);
  });
});

// 타입 확인용 — ParentNode 를 실제로 쓴다
const _r: ParentNode = root("1");
void _r;

describe("shouldSubmitQuickAdd (IME)", () => {
  it("plain Enter submits", () => expect(shouldSubmitQuickAdd({ key: "Enter", isComposing: false })).toBe(true));
  it("Enter that confirms a Hangul composition does not", () => expect(shouldSubmitQuickAdd({ key: "Enter", isComposing: true })).toBe(false));
  it("Safari reports composition Enter as keyCode 229", () => expect(shouldSubmitQuickAdd({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(false));
  it("other keys never submit", () => expect(shouldSubmitQuickAdd({ key: "a", isComposing: false })).toBe(false));
});

describe("moveNote (회차 이동 뒤 안내)", () => {
  it("same round", () => expect(moveNote({ s: "2026-10-01", e: "2026-10-03", subAll: 0 }, null, true)).toBe(""));
  it("submissions keep dates", () => expect(moveNote({ s: "2026-10-01", e: "2026-10-03", subAll: 1 }, null, false)).toBe("제출이 있어 기간은 그대로예요"));
  it("inside the new round", () => expect(moveNote({ s: "2026-10-10", e: "2026-10-12", subAll: 0 }, null, false)).toBe("기간은 그대로예요"));
  it("shifted", () => expect(moveNote({ s: "2026-10-04", e: "2026-10-07", subAll: 0 }, { s: "2026-10-11", e: "2026-10-14" }, false)).toBe("기간이 10.11 – 10.14 로 바뀌었어요"));
});

describe("dropPlan (드래그 놓기 → node_move)", () => {
  const ns = tree.nodes;
  it("reorder inside a round", () => {
    expect(dropPlan(ns, "12", "11", "top")).toEqual({ parentId: "1", index: 0 });
    expect(dropPlan(ns, "11", "12", "bottom")).toEqual({ parentId: "1", index: 1 });
  });
  it("no-op drops return null", () => {
    expect(dropPlan(ns, "11", "11", "top")).toBeNull();
    expect(dropPlan(ns, "11", "12", "top")).toBeNull();
  });
  it("onto a task of another round → that position", () => expect(dropPlan(ns, "11", "21", "top")).toEqual({ parentId: "2", index: 0 }));
  it("onto a round row → end of that round", () => expect(dropPlan(ns, "11", "4", "bottom")).toEqual({ parentId: "4", index: 1 }));
  it("rounds are not draggable; a node never drops into itself", () => {
    expect(dropPlan(ns, "1", "21", "top")).toBeNull();
    expect(dropPlan(ns, "31", "311", "top")).toBeNull();
  });
  it("archived targets are refused", () => {
    const t = buildTree({ ...AWS, nodes: AWS.nodes.map((n) => (n.id === "4" || n.parentId === "4" ? { ...n, archived: true } : n)) }, EMPTY_OVERRIDES, REF_DAY);
    expect(dropPlan(t.nodes, "11", "4", "bottom")).toBeNull();
    expect(dropPlan(t.nodes, "11", "41", "top")).toBeNull();
  });
});

describe("개인 목표 — 순서·드래그·추가 줄", () => {
  const nb = { parentId: "R", roundId: "R", d: 1, desc: "", s: "2026-10-15", e: "2026-10-21", archived: false, archivedByParent: false, subAll: 0, crumb: "", roundLabel: "3주차", temp: false };
  const team = (id: string): LeafNode => ({ ...nb, id, title: id, leaf: true, type: "공통", people: [], asg: 0, sub: 0, state: "unassigned", ownerId: null, personal: false, ownerRank: -1, ownerLeft: false });
  const personal = (id: string, owner: string): LeafNode => ({ ...team(id), type: "개인", ownerId: owner, personal: true, ownerRank: 0 });
  const mkRound = (kids: TreeNode[]): ParentNode => ({ ...nb, id: "R", parentId: null, d: 0, title: "R", leaf: false, label: "3주차", kids, childCount: kids.length, asg: 0, sub: 0, pct: 0 });

  it("reorderIndex: 개인 목표를 건너뛴 이웃 팀 과제와 자리를 바꾼다", () => {
    // 서버 순서 [T0, P, T1] 인 회차를 픽스처로 만든다 — T1 을 위로 → index 0, T0 를 아래로 → index 2(자기 뺀 [P, T1] 에서 T1 뒤)
    const round = mkRound([team("T0"), personal("P", CHULSU), team("T1")]);
    expect(reorderIndex(round, "T1", -1)).toBe(0);
    expect(reorderIndex(round, "T0", 1)).toBe(2);
    expect(reorderIndex(round, "T0", -1)).toBeNull();
  });
  it("reorderIndex: 팀 이웃이 개인뿐이면 null", () => {
    const round = mkRound([team("T0"), personal("P", CHULSU)]);
    expect(reorderIndex(round, "T0", 1)).toBeNull();
  });
  it("dropPlan: 개인 행은 끌 수도, 놓을 자리도 아니다", () => {
    const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
    const p = t.personal[0];
    const ec2 = t.leaves.find((l) => l.title === "EC2 인스턴스 유형 정리")!;
    expect(dropPlan(t.nodes, p.id, ec2.id, "top")).toBeNull();
    expect(dropPlan(t.nodes, ec2.id, p.id, "top")).toBeNull();
  });
  it("dropPlan: index 는 서버 순서 kids 기준(개인 포함)", () => {
    // 3주차 서버 순서 [33(개인), 31, 32(개인)] — 21 을 31 아래로 → index 2, 회차 행 위 → 끝(3)
    expect(dropPlan(tree.nodes, "21", "31", "bottom")).toEqual({ parentId: "3", index: 2 });
    expect(dropPlan(tree.nodes, "21", "3", "bottom")).toEqual({ parentId: "3", index: 3 });
  });
  it("dropPlan: 개인 목표를 뺀 팀 순서가 그대로면 제자리(null)", () => {
    // 1주차 서버 순서 [11, 개인, 12] — 12 를 11 아래로 놓아도 화면(팀 → 개인)은 같다
    const p = AWS.nodes.find((n) => n.id === "32")!;
    const cur = { ...AWS, nodes: [...AWS.nodes, { ...p, id: "1p", parentId: "1", roundId: "1", sortOrder: 1.5 }] };
    const ns = buildTree(cur, EMPTY_OVERRIDES, REF_DAY).nodes;
    expect(dropPlan(ns, "12", "11", "bottom")).toBeNull();
    expect(dropPlan(ns, "12", "1", "bottom")).toBeNull();
    expect(dropPlan(ns, "12", "11", "top")).toEqual({ parentId: "1", index: 0 });
    expect(dropPlan(ns, "11", "12", "bottom")).toEqual({ parentId: "1", index: 2 });
  });
  const label = (e: ListEntry) => (e.kind === "node" ? e.n.id : e.kind === "padd" ? `p${e.round.id}` : e.kind === "others" ? `o${e.round.id}:${e.count}` : e.kind === "empty" ? `e${e.round.id}` : `+${e.round.id}`);
  const sc = { meId: CHULSU, mineOnly: false, others: false, isEdit: false, isLeader: false };
  it("withPersonalAddRows: 회차 → 팀 → 내 개인 → padd (팀원 목표 끔), canAdd false 면 padd 없음", () => {
    const kinds = (closed: Record<string, boolean>, canAdd: boolean, t = tree) => withPersonalAddRows(visibleNodes(t.roots, closed, sc), t.roots, closed, canAdd, CHULSU).map(label);
    expect(kinds({}, true)).toEqual(["1", "11", "12", "p1", "2", "21", "22", "p2", "3", "31", "311", "32", "p3", "4", "41", "p4", "5", "51", "52", "p5"]);
    expect(kinds({ "1": true }, true).slice(0, 3)).toEqual(["1", "2", "21"]);
    expect(kinds({}, true, archivedTree)).not.toContain("p2");
    expect(kinds({}, false).some((k) => k.startsWith("p"))).toBe(false);
  });
  it("withPersonalAddRows: 팀원 목표 켜면 padd 는 내 목표 뒤, 소제목 '팀원 개인 목표 n' 다음 남의 것 (C-2)", () => {
    const rows = visibleNodes(tree.roots, {}, { ...sc, others: true });
    const r3 = (canAdd: boolean) => withPersonalAddRows(rows, tree.roots, {}, canAdd, CHULSU).map(label).filter((k) => /^(3|31|311|32|33|p3|o3:\d|4)$/.test(k));
    expect(r3(true)).toEqual(["3", "31", "311", "32", "p3", "o3:1", "33", "4"]);
    // 추가 자격이 없어도 소제목은 나온다
    expect(r3(false)).toEqual(["3", "31", "311", "32", "o3:1", "33", "4"]);
  });
  it("withPersonalAddRows: 소제목 개수는 보관 제외, 그룹장에게 보이는 보관 목표는 따로 (C-4 '5 · 보관 2')", () => {
    const cur = { ...AWS, nodes: AWS.nodes.map((n) => (n.id === "33" ? { ...n, archived: true } : n)) };
    const t = buildTree(cur, EMPTY_OVERRIDES, REF_DAY);
    const rows = visibleNodes(t.roots, {}, { ...sc, others: true, isLeader: true });
    const head = withPersonalAddRows(rows, t.roots, {}, false, CHULSU).find((e) => e.kind === "others");
    expect(head).toMatchObject({ kind: "others", count: 0, archived: 1 });
  });
  it("withEmptyRounds: 펼친 회차 아래 보이는 노드가 없으면 회차 바로 뒤에 안내 줄", () => {
    // 도윤(u5) — 배정·개인 목표 없음. 접힌 회차는 안내 없음
    const dy = { ...sc, meId: "u5", mineOnly: true };
    const closed = { "2": true };
    const entries = withEmptyRounds(withPersonalAddRows(visibleNodes(tree.roots, closed, dy), tree.roots, closed, true, "u5"), closed);
    expect(entries.map(label)).toEqual(["1", "e1", "p1", "2", "3", "e3", "p3", "4", "e4", "p4", "5", "e5", "p5"]);
    // 내 항목이 있는 회차는 안내 없음
    const mine = withEmptyRounds(withPersonalAddRows(visibleNodes(tree.roots, {}, { ...sc, mineOnly: true }), tree.roots, {}, false, CHULSU), {});
    expect(mine.map(label).filter((k) => k.startsWith("e"))).toEqual([]);
  });
});

// 방 기간 밖 일정 (서버 PERIOD_OUTSIDE_ROOM 과 같은 판정 — 보관 제외 모든 노드가 시작일 앞 또는 종료일 뒤로 걸치면).
// 서버는 수정 응답에만 경고를 실어 화면이 직접 본다. 입력 = 서버가 준 노드 그대로(화면 필터·미저장 수정과 무관)
describe("roundsOutsidePeriod", () => {
  const n = (id: string, parentId: string | null, s: string, e: string, archived = false) => ({ id, parentId, startDate: `2026-${s}`, endDate: `2026-${e}`, archived });
  const nodes = [
    n("r1", null, "10-15", "10-21"),
    n("t1", "r1", "10-15", "10-21"),
    n("r2", null, "10-22", "10-28"),
    n("t2", "r2", "10-22", "11-25"), // 과제가 자기 회차·방 기간 밖
    n("r3", null, "11-01", "12-30", true), // 보관 — 세지 않고 마지막 마감에도 넣지 않는다
  ];
  it("모두 기간 안이면 null", () => expect(roundsOutsidePeriod(nodes, { start: "2026-10-15", end: "2026-11-25" })).toBeNull());
  it("회차는 안인데 과제만 밖이어도 잡는다", () => {
    expect(roundsOutsidePeriod(nodes, { start: "2026-10-15", end: "2026-10-28" })).toEqual({ count: 1, text: "과제 1개가 스터디 기간(10.15 – 10.28)을 벗어나요", fitEnd: "2026-11-25", fitStart: null, before: false, key: "b:|a:r2" });
  });
  it("회차·과제를 나눠 센다, 늘릴 종료일 = 보관 제외 전체 노드의 마지막 마감", () => {
    expect(roundsOutsidePeriod(nodes, { start: "2026-10-15", end: "2026-10-23" })).toEqual({ count: 2, text: "회차 1개·과제 1개가 스터디 기간(10.15 – 10.23)을 벗어나요", fitEnd: "2026-11-25", fitStart: null, before: false, key: "b:|a:r2" });
  });
  it("시작일 앞에 걸친 일정이 있으면 before + 앞당길 시작일 = 보관 제외 전체 노드의 가장 이른 시작", () => {
    expect(roundsOutsidePeriod(nodes, { start: "2026-10-16", end: "2026-10-23" })).toEqual({ count: 4, text: "회차 2개·과제 2개가 스터디 기간(10.16 – 10.23)을 벗어나요", fitEnd: "2026-11-25", fitStart: "2026-10-15", before: true, key: "b:r1|a:r2" });
  });
  it("시작일 앞만 걸치면 fitEnd null", () => {
    expect(roundsOutsidePeriod(nodes, { start: "2026-10-16", end: "2026-11-25" })).toEqual({ count: 2, text: "회차 1개·과제 1개가 스터디 기간(10.16 – 11.25)을 벗어나요", fitEnd: null, fitStart: "2026-10-15", before: true, key: "b:r1|a:" });
  });
  it("늘린 종료일이 1년 상한을 넘으면 fitEnd null, 해를 넘는 기간은 끝을 YYYY.MM.DD 로", () => {
    expect(roundsOutsidePeriod(nodes, { start: "2025-11-30", end: "2026-10-23" })?.fitEnd).toBe("2026-11-25");
    expect(roundsOutsidePeriod(nodes, { start: "2025-11-01", end: "2026-10-23" })).toEqual({ count: 2, text: "회차 1개·과제 1개가 스터디 기간(11.01 – 2026.10.23)을 벗어나요", fitEnd: null, fitStart: null, before: false, key: "b:|a:r2" });
  });
  it("앞당긴 시작일로 지금 종료일이 1년 상한을 넘으면 fitStart null", () => {
    expect(roundsOutsidePeriod(nodes, { start: "2026-10-16", end: "2027-10-14" })?.fitStart).toBe("2026-10-15");
    expect(roundsOutsidePeriod(nodes, { start: "2026-10-16", end: "2027-10-15" })?.fitStart).toBeNull();
  });
  // 「그대로 두기」 기억 키 — 렌더·날짜·개수에 흔들리지 않고, 벗어난 회차 집합이 바뀔 때만 달라진다 (사용자 보고 2026-10-23)
  it("key: 같은 회차에 과제를 더하거나 종료일만 늘려도 그대로", () => {
    const base = roundsOutsidePeriod(nodes, { start: "2026-10-16", end: "2026-11-25" })!;
    const moreTasks = roundsOutsidePeriod([...nodes, n("t1b", "r1", "10-15", "10-18"), n("g1", "r1", "10-15", "10-21"), n("t1c", "g1", "10-15", "10-16")], { start: "2026-10-16", end: "2026-11-25" })!;
    expect(moreTasks.text).not.toBe(base.text);
    expect(moreTasks.key).toBe(base.key);
    expect(roundsOutsidePeriod(nodes, { start: "2026-10-16", end: "2026-12-31" })!.key).toBe(base.key);
    expect(roundsOutsidePeriod([...nodes].reverse(), { start: "2026-10-16", end: "2026-11-25" })!.key).toBe(base.key);
  });
  it("key: 새 회차가 밖으로 나가거나 걸친 쪽이 바뀌면 달라진다", () => {
    const base = roundsOutsidePeriod(nodes, { start: "2026-10-16", end: "2026-11-25" })!;
    expect(roundsOutsidePeriod([...nodes, n("r0", null, "10-08", "10-14")], { start: "2026-10-16", end: "2026-11-25" })!.key).toBe("b:r0,r1|a:");
    expect(roundsOutsidePeriod(nodes, { start: "2026-10-16", end: "2026-11-20" })!.key).not.toBe(base.key);
  });
});

describe("rowMoves (편집 목록 행 메뉴 — 위로·아래로·내어쓰기·다른 회차로, Q2-4)", () => {
  const keys = (id: string, t = tree) => rowMoves(t.nodes, t.roots, id).map((m) => m.key);
  const find = (id: string, key: string, t = tree) => rowMoves(t.nodes, t.roots, id).find((m) => m.key === key);
  it("위로·아래로 = reorderIndex (서버 index: 자기를 뺀 새 형제 기준)", () => {
    expect(find("11", "up")).toBeUndefined();
    expect(find("11", "down")).toMatchObject({ parentId: "1", index: 1 });
    expect(find("12", "up")).toMatchObject({ parentId: "1", index: 0 });
    expect(find("12", "down")).toBeUndefined();
  });
  it("다른 회차로 = 보관 아닌 다른 회차마다 그 끝(index 없음), 지금 회차는 빠진다", () => {
    expect(keys("11").filter((k) => k.startsWith("round:"))).toEqual(["round:2", "round:3", "round:4", "round:5"]);
    expect(find("11", "round:2")).toMatchObject({ parentId: "2", label: "2주차로 옮기기", cross: true });
    expect(find("11", "round:2")?.index).toBeUndefined();
    expect(keys("11", archivedTree)).not.toContain("round:2");
  });
  it("묶음 안 과제: 내어쓰기 = 회차 바로 아래, 묶음 바로 다음 (node_outdent 와 같은 자리)", () => {
    // 3주차 서버 순서 [33, 31, 32] — 묶음 31 바로 다음 = index 2
    expect(find("311", "outdent")).toMatchObject({ parentId: "3", index: 2, cross: false });
    // 묶음 안에서 지금 회차(3)로 옮기기는 내어쓰기가 맡는다
    expect(keys("311")).not.toContain("round:3");
  });
  it("회차 바로 아래 과제에는 내어쓰기·들여쓰기가 없다 (2단계 — 묶음을 새로 만들지 않는다)", () => {
    expect(keys("33")).not.toContain("outdent");
    expect(keys("33")).not.toContain("indent");
  });
  it("회차·보관·임시·개인 행은 메뉴가 비어 있다", () => {
    expect(keys("1")).toEqual([]);
    const t = buildTree({ ...AWS, nodes: AWS.nodes.map((n) => (n.id === "11" ? { ...n, archived: true } : n)) }, EMPTY_OVERRIDES, REF_DAY);
    expect(keys("11", t)).toEqual([]);
    expect(keys(tree.personal[0].id)).toEqual([]);
  });
});

describe("designatedHint — 모집 전 지정 과제 안내 (시나리오 QA #12)", () => {
  it("준비·모집 중에만 안내", () => {
    expect(designatedHint("draft")).toMatch(/참가자가 들어온 뒤/);
    expect(designatedHint("recruit")).toMatch(/공통 과제는/);
    expect(designatedHint("active")).toBeNull();
    expect(designatedHint("ended")).toBeNull();
  });
});

// 시나리오 QA D2: 회차 시작일을 바꾸면 하위 과제·개인 목표도 같은 날수만큼 옮길지 묻는다 (0024 node_update shiftDescendants)
describe("shiftAskOf · shiftAskText · shiftedText", () => {
  const withStart = (id: string, s: string) => buildTree(AWS, { ...EMPTY_OVERRIDES, dates: { [id]: { s } } }, REF_DAY);
  it("시작일이 바뀐 회차 → 날수와 하위(보관 제외) 과제·개인 목표·묶음 수", () => {
    const t = withStart("3", "2026-10-22");
    expect(shiftAskOf(findNode(t.nodes, "3")!, t.nodes)).toEqual({ days: 7, tasks: 1, personal: 2, groups: 1 });
  });
  it("시작일이 그대로(종료일만)·리프·하위 없음이면 묻지 않는다", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, dates: { "3": { e: "2026-10-28" } } }, REF_DAY);
    expect(shiftAskOf(findNode(t.nodes, "3")!, t.nodes)).toBeNull();
    const t2 = withStart("311", "2026-10-16");
    expect(shiftAskOf(findNode(t2.nodes, "311")!, t2.nodes)).toBeNull();
  });
  it("보관된 하위는 세지 않는다", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, dates: { "2": { s: "2026-10-06" } }, archived: { "22": true } }, REF_DAY);
    expect(shiftAskOf(findNode(t.nodes, "2")!, t.nodes)).toEqual({ days: -2, tasks: 1, personal: 0, groups: 0 });
  });
  it("문구 — 방향·개수", () => {
    expect(shiftAskText({ days: 7, tasks: 1, personal: 2, groups: 1 })).toBe("시작일을 7일 뒤로 옮겨요. 과제 1개·개인 목표 2개도 같은 날수만큼 옮길까요?");
    expect(shiftAskText({ days: -2, tasks: 3, personal: 0, groups: 0 })).toBe("시작일을 2일 앞으로 옮겨요. 과제 3개도 같은 날수만큼 옮길까요?");
    expect(shiftAskText({ days: 3, tasks: 0, personal: 0, groups: 2 })).toBe("시작일을 3일 뒤로 옮겨요. 묶음 2개도 같은 날수만큼 옮길까요?");
    expect(shiftedText({ days: 7, tasks: 1, personal: 2, groups: 1, archived: 0 })).toBe("저장했어요 · 과제 1개·개인 목표 2개도 7일 뒤로 옮겼어요");
    expect(shiftedText({ days: 0, tasks: 0, personal: 0, groups: 0, archived: 0 })).toBe("저장했어요");
    expect(shiftedText(undefined)).toBe("저장했어요");
  });
});

// 최종 리뷰 Minor 4: 확인이 떠 있는 동안 날짜를 또 바꾸면 그 확인(n일)은 낡았다 — 같은 질문일 때만 그대로 둔다
describe("sameShiftAsk", () => {
  it("날수·개수가 같을 때만 같다", () => {
    const a = { days: 7, tasks: 1, personal: 2, groups: 1 };
    expect(sameShiftAsk(a, { ...a })).toBe(true);
    expect(sameShiftAsk(a, { ...a, days: 8 })).toBe(false);
    expect(sameShiftAsk(a, null)).toBe(false);
  });
});
