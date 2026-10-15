import { describe, expect, it } from "vitest";
import { AWS, REF_DAY } from "./fixtures";
import { EMPTY_OVERRIDES, buildTree, visibleNodes, type ParentNode } from "./model";
import { currentRoundId, moveNote, movedPeriod, normalizeTitle, reorderIndex, roundOf, roundOptions, shouldSubmitQuickAdd, siblingIndex, withAddRows } from "./rounds";

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
    expect(kinds({})).toEqual(["1", "11", "12", "+1", "2", "21", "22", "+2", "3", "31", "311", "+3", "4", "41", "+4", "5", "51", "52", "+5"]));
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

describe("moveNote (회차 선택 미리보기)", () => {
  it("same round", () => expect(moveNote({ s: "2026-10-01", e: "2026-10-03", subAll: 0 }, null, true)).toBe(""));
  it("submissions keep dates", () => expect(moveNote({ s: "2026-10-01", e: "2026-10-03", subAll: 1 }, null, false)).toBe("제출이 있어 기간은 그대로예요"));
  it("inside the new round", () => expect(moveNote({ s: "2026-10-10", e: "2026-10-12", subAll: 0 }, null, false)).toBe("기간은 그대로예요"));
  it("shifted", () => expect(moveNote({ s: "2026-10-04", e: "2026-10-07", subAll: 0 }, { s: "2026-10-11", e: "2026-10-14" }, false)).toBe("옮기면 기간이 10.11 – 10.14 로 바뀌어요"));
});
