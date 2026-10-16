import { describe, expect, it } from "vitest";
import { EMPTY_OVERRIDES, buildTree, type LeafNode, type ParentNode } from "./model";
import { AWS, CHULSU, JIEUN, REF_DAY } from "./fixtures";
import { groupOthers, pickRound, sectionCounts, movePreview, ownerCode, personalActions, personalPatch, removeText, roundWarning, statusText } from "./personal";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const leaf = (id: string) => tree.nodes.find((n) => n.id === id) as LeafNode;
const round = (id: string) => tree.roots.find((r) => r.id === id) as ParentNode;
const LEADER = "u2";
const HANA = "u4";
const mine = leaf("32"); // 철수 · planned · 제출 없음
const jieun = leaf("33"); // 지은 · done · 제출 있음

describe("personalActions", () => {
  it("owner in an active room: edit · complete · archive · remove", () => {
    expect(personalActions(mine, CHULSU, false, "active")).toEqual({ edit: true, complete: true, archive: true, remove: true });
  });

  it("leader on someone else's goal without submissions: archive · remove, with a note", () => {
    const a = personalActions(mine, LEADER, true, "active");
    expect(a).toMatchObject({ edit: false, complete: false, archive: true, remove: true });
    expect(a.note).toBe("팀원이 만든 목표예요 · 그룹장은 보관·삭제만 할 수 있어요");
  });

  it("other member: nothing", () => {
    expect(personalActions(mine, HANA, false, "active")).toEqual({ edit: false, complete: false, archive: false, remove: false });
    expect(personalActions(mine, null, false, "active")).toEqual({ edit: false, complete: false, archive: false, remove: false });
  });

  it("recruiting room: owner can manage but not complete", () => {
    expect(personalActions(mine, CHULSU, false, "recruit")).toEqual({ edit: true, complete: false, archive: true, remove: true });
  });

  it("ended room: nothing for anyone", () => {
    expect(personalActions(mine, CHULSU, false, "ended")).toEqual({ edit: false, complete: false, archive: false, remove: false });
    expect(personalActions(mine, LEADER, true, "ended")).toMatchObject({ edit: false, complete: false, archive: false, remove: false });
  });

  it("leader on a goal with submissions: archive only (remove off with a reason)", () => {
    expect(jieun.subAll).toBeGreaterThan(0);
    const a = personalActions(jieun, LEADER, true, "active");
    expect(a).toMatchObject({ edit: false, complete: false, archive: true, remove: false, removeOff: "완료 기록이 있어 보관만 할 수 있어요" });
  });

  it("owner who lost eligibility (left the team): nothing", () => {
    expect(personalActions(mine, CHULSU, false, "active", false)).toEqual({ edit: false, complete: false, archive: false, remove: false });
  });

  it("archived own goal: no edit · no complete, can unarchive and delete", () => {
    const n = { ...mine, archived: true };
    expect(personalActions(n, CHULSU, false, "active")).toEqual({ edit: false, complete: false, archive: true, remove: true });
    // 회차째 보관된 목표는 여기서 해제할 수 없다
    expect(personalActions({ ...n, archivedByParent: true }, CHULSU, false, "active").archive).toBe(false);
  });

  it("leader who owns the goal is treated as owner (no note)", () => {
    const n = { ...mine, ownerId: LEADER };
    expect(personalActions(n, LEADER, true, "active")).toEqual({ edit: true, complete: true, archive: true, remove: true });
  });
});

describe("ownerCode / statusText (문구 출처 = model.codeLabel)", () => {
  it("ownerCode reads the owner's code", () => {
    expect(ownerCode(mine)).toBe("P");
    expect(ownerCode(jieun)).toBe("D");
  });

  it("detail status: done/missed by code, otherwise period status", () => {
    expect(statusText(jieun, REF_DAY)).toBe("기한내 완료");
    expect(statusText({ ...mine, people: [{ ...mine.people[0], c: "M" }] }, REF_DAY)).toBe("기한 지남");
    expect(statusText(mine, "2026-10-20")).toBe("진행 중 · 마감 D-1");
    expect(statusText(mine, REF_DAY)).toBe("시작 D-3");
  });
});

describe("removeText", () => {
  it("no submissions", () => expect(removeText(mine)).toBe("이 목표를 삭제할까요? 되돌릴 수 없어요."));
  it("owner with submissions", () => expect(removeText(jieun)).toBe("완료 기록과 제출 내용까지 함께 지워져요. 삭제할까요?"));
});

describe("personalPatch", () => {
  const base = { title: mine.title, desc: mine.desc, s: mine.s, e: mine.e, roundId: mine.roundId };
  it("unchanged → empty", () => expect(personalPatch(mine, base)).toEqual({}));
  it("only changed fields, title trimmed", () => {
    expect(personalPatch(mine, { ...base, title: "  새 제목  ", e: "2026-10-20" })).toEqual({ title: "새 제목", endDate: "2026-10-20" });
  });
  it("round move + dates + description in one patch", () => {
    expect(personalPatch(mine, { ...base, roundId: "4", s: "2026-10-22", e: "2026-10-28", desc: "메모" })).toEqual({ roundId: "4", startDate: "2026-10-22", endDate: "2026-10-28", descriptionMd: "메모" });
  });
  it("whitespace-only title change is not a change", () => expect(personalPatch(mine, { ...base, title: ` ${mine.title} ` })).toEqual({}));
});

describe("movePreview", () => {
  it("same round → nothing", () => expect(movePreview("3주차", null, true)).toBe(""));
  it("moved with new period", () => expect(movePreview("4주차", { s: "2026-10-22", e: "2026-10-28" }, false)).toBe("4주차로 옮기면 기간이 10.22 – 10.28 로 바뀌어요"));
  it("moved, period kept", () => expect(movePreview("4주차", null, false)).toBe("4주차로 옮겨도 기간은 그대로예요"));
});

describe("roundWarning", () => {
  const r3 = round("3");
  it("inside → null", () => expect(roundWarning(mine, r3)).toBeNull());
  it("outside → warning with the round period", () => expect(roundWarning({ s: "2026-10-14", e: "2026-10-21" }, r3)).toBe("회차 기간(10.15 – 10.21)을 벗어났어요"));
  it("no round → null", () => expect(roundWarning(mine, null)).toBeNull());
});

describe("groupOthers", () => {
  it("groups others' goals by owner in member order, excluding mine", () => {
    const g = groupOthers(round("3"), CHULSU, false);
    expect(g.map((x) => [x.ownerId, x.name, x.items.map((i) => i.id), x.done])).toEqual([[JIEUN, "지은", ["33"], 1]]);
  });
  it("archived others only for the leader — shown but not counted", () => {
    const r = { ...round("3"), kids: round("3").kids.map((k) => (k.id === "33" ? { ...k, archived: true } : k)) } as ParentNode;
    expect(groupOthers(r, CHULSU, false)).toEqual([]);
    expect(groupOthers(r, CHULSU, true).map((x) => [x.items.length, x.count, x.done])).toEqual([[1, 0, 0]]);
  });
});

describe("sectionCounts — 보관 제외 (personalStats 와 같은 기준)", () => {
  const withArchived = (ids: string[]) => ({ ...round("3"), kids: round("3").kids.map((k) => (ids.includes(k.id) ? { ...k, archived: true } : k)) }) as ParentNode;
  it("counts mine and others", () => {
    expect(sectionCounts(round("3"), CHULSU, false)).toEqual({ mine: { total: 1, done: 0 }, others: 1 });
    expect(sectionCounts(round("3"), JIEUN, false)).toEqual({ mine: { total: 1, done: 1 }, others: 1 });
  });
  it("archived goals drop out of the counts (leader still sees the rows)", () => {
    expect(sectionCounts(withArchived(["32"]), CHULSU, false)).toEqual({ mine: { total: 0, done: 0 }, others: 1 });
    expect(sectionCounts(withArchived(["33"]), CHULSU, true)).toEqual({ mine: { total: 1, done: 0 }, others: 0 });
    expect(sectionCounts(withArchived(["33"]), JIEUN, false).mine).toEqual({ total: 0, done: 0 });
  });
});

describe("pickRound — 편집 폼 회차 선택", () => {
  const base = { title: mine.title, desc: mine.desc, s: mine.s, e: mine.e, roundId: mine.roundId };
  it("moving suggests the new round's period and a preview", () => {
    expect(pickRound(mine, base, tree.roots, "4")).toEqual({ draft: { ...base, roundId: "4", s: "2026-10-22", e: "2026-10-28" }, note: "4주차로 옮기면 기간이 10.22 – 10.28 로 바뀌어요" });
  });
  it("going back to the original round restores the original dates, no preview", () => {
    const moved = { ...base, roundId: "5", s: "2026-10-29", e: "2026-11-04" };
    expect(pickRound(mine, moved, tree.roots, "3")).toEqual({ draft: { ...moved, roundId: "3", s: mine.s, e: mine.e }, note: "" });
  });
  it("same round → null", () => expect(pickRound(mine, base, tree.roots, "3")).toBeNull());
});
