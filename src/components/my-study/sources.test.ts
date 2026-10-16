import { describe, expect, it } from "vitest";
import { AWS, CHULSU, JIEUN, REF_DAY } from "./fixtures";
import { buildTree } from "./model";
import { EMPTY_OVERRIDES } from "./model";
import { boardSource, calendarSource, calendarStart } from "./sources";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const ids = (ls: { id: string }[]) => ls.map((l) => l.id);

describe("boardSource", () => {
  it("팀 칸반 = 팀 리프만 (개인 제외)", () => {
    const r = boardSource(tree, false, CHULSU);
    expect(r).toEqual(tree.leaves);
    expect(r.some((l) => l.personal)).toBe(false);
  });
  it("내 칸반 = 내 배정 리프 + 내 개인 (남의 개인 제외)", () => {
    const r = boardSource(tree, true, CHULSU);
    expect(ids(r)).toContain("32");
    expect(ids(r)).not.toContain("33");
    expect(r.filter((l) => !l.personal).every((l) => l.people.some((p) => p.userId === CHULSU))).toBe(true);
  });
  it("meId null 이면 개인 없음", () => {
    expect(boardSource(tree, true, null)).toEqual([]);
  });
});

describe("calendarSource", () => {
  it("all = 팀 리프 + 내 개인", () => {
    const r = calendarSource(tree, "all", CHULSU);
    expect(r.length).toBe(tree.leaves.length + tree.personal.filter((p) => p.ownerId === CHULSU).length);
    expect(ids(r)).toContain("32");
    expect(ids(r)).not.toContain("33");
  });
  it("me = 내 배정 리프 + 내 개인", () => {
    const r = calendarSource(tree, "me", CHULSU);
    expect(ids(r)).toContain("32");
    expect(r.filter((l) => !l.personal).every((l) => l.people.some((p) => p.userId === CHULSU))).toBe(true);
  });
  it("userId X = X 배정 리프 + X 의 개인", () => {
    const r = calendarSource(tree, JIEUN, CHULSU);
    expect(ids(r)).toContain("33");
    expect(ids(r)).not.toContain("32");
    expect(r.filter((l) => !l.personal).every((l) => l.people.some((p) => p.userId === JIEUN))).toBe(true);
  });
});

describe("calendarStart — 첫 화면 기준 날짜에 내 개인 목표도 넣는다", () => {
  it("팀 과제 없이 내 개인 목표만 있으면 그 기간", () => {
    const only = buildTree({ ...AWS, nodes: AWS.nodes.filter((n) => !n.task || n.task.type === "personal").filter((n) => n.id !== "31") }, EMPTY_OVERRIDES, REF_DAY);
    expect(only.leaves).toEqual([]);
    expect(calendarStart(only, CHULSU, "2026-09-01")).toBe("2026-10-15");
  });
  it("오늘이 팀·내 개인 목표 범위 안이면 오늘", () => expect(calendarStart(tree, CHULSU, "2026-10-12")).toBe("2026-10-12"));
});
