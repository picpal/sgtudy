import { describe, expect, it } from "vitest";
import { AWS, CHULSU, REF_DAY } from "./fixtures";
import { EMPTY_OVERRIDES, buildTree, visibleNodes, type LeafNode, type ParentNode, type TreeNode } from "./model";
import { currentRoundId, dropPlan, moveNote, movedPeriod, movedPlan, normalizeTitle, reorderIndex, roundOf, roundOptions, shouldSubmitQuickAdd, siblingIndex, withAddRows, withEmptyRounds, withPersonalAddRows, type ListEntry } from "./rounds";

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
