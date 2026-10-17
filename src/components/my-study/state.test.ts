import { describe, expect, it } from "vitest";
import { INITIAL_STATE, SHOW_OTHERS_PATCH, blocksLeave, goLeafPatch, modeSwitchPatch, tabPatch, toggleMinePatch, toggleOthersPatch } from "./state";

describe("goLeafPatch", () => {
  it("opens the task detail view instead of an inline row", () =>
    expect(goLeafPatch("21")).toEqual({ tab: "curriculum", curMode: "view", viewSel: "21", viewFocus: "submission", editSel: null, closed: {}, calPick: null }));
});

describe("viewFocus", () => {
  it("INITIAL_STATE has no pending focus", () => expect(INITIAL_STATE.viewFocus).toBeNull());
  it("진행목표 필터 칩은 둘 다 꺼진 채 시작", () => expect([INITIAL_STATE.mineOnly, INITIAL_STATE.othersPersonal]).toEqual([false, false]));
  it("modeSwitchPatch clears a pending focus", () =>
    expect(modeSwitchPatch({ ...INITIAL_STATE, viewSel: "7", viewFocus: "submission" }, "edit")).toMatchObject({ viewFocus: null }));
});

describe("modeSwitchPatch", () => {
  it("view detail → edit opens the same item's edit view", () =>
    expect(modeSwitchPatch({ ...INITIAL_STATE, viewSel: "7" }, "edit")).toMatchObject({ curMode: "edit", editSel: "7", viewSel: null, quickAdd: null }));
  it("edit view → view opens the same item's detail", () =>
    expect(modeSwitchPatch({ ...INITIAL_STATE, curMode: "edit", editSel: "7" }, "view")).toMatchObject({ curMode: "view", viewSel: "7", editSel: null, quickAdd: null }));
  it("list stays list", () => expect(modeSwitchPatch(INITIAL_STATE, "edit")).toMatchObject({ curMode: "edit", editSel: null, viewSel: null }));
  it("temp (optimistic) items are not carried over", () =>
    expect(modeSwitchPatch({ ...INITIAL_STATE, curMode: "edit", editSel: "1.new0" }, "view")).toMatchObject({ viewSel: null }));
});

describe("진행목표·간트 필터 칩 — 두 칩은 서로 끈다", () => {
  const S = (mineOnly: boolean, othersPersonal: boolean) => ({ ...INITIAL_STATE, mineOnly, othersPersonal });
  it("내 것만 켜면 팀원 목표는 꺼진다, 끄면 그대로", () => {
    expect(toggleMinePatch(S(false, true))).toEqual({ mineOnly: true, othersPersonal: false });
    expect(toggleMinePatch(S(true, false))).toEqual({ mineOnly: false, othersPersonal: false });
  });
  it("팀원 목표 켜면 내 것만은 꺼진다", () => {
    expect(toggleOthersPatch(S(true, false))).toEqual({ othersPersonal: true, mineOnly: false });
    expect(toggleOthersPatch(S(false, true))).toEqual({ othersPersonal: false, mineOnly: false });
  });
});

describe("SHOW_OTHERS_PATCH (개요 '팀원 개인 목표 보기 →')", () => {
  it("열린 상세를 닫고 진행목표 보기 + 팀원 목표 칩", () =>
    expect(SHOW_OTHERS_PATCH).toMatchObject({ tab: "curriculum", curMode: "view", othersPersonal: true, mineOnly: false, viewSel: null, editSel: null, viewFocus: null, calPick: null }));
});

describe("tabPatch (Q2-1 — 저장하지 않은 편집이 있으면 탭을 바꾸기 전에 묻는다)", () => {
  const dirty = { ...INITIAL_STATE, tab: "curriculum" as const, curMode: "edit" as const, editSel: "7", ov: { ...INITIAL_STATE.ov, titles: { "7": "고친 제목" } } };
  it("편집 화면에 미저장 수정 → 탭은 그대로, 목적지를 보류", () => expect(tabPatch(dirty, "board", true)).toEqual({ leave: { tab: "board" }, confirm: false }));
  it("수정 없음·보기 모드·편집 권한 없음·같은 탭 → 바로 바꾼다", () => {
    expect(tabPatch({ ...dirty, ov: INITIAL_STATE.ov }, "board", true)).toEqual({ tab: "board", calPick: null });
    expect(tabPatch({ ...dirty, curMode: "view" }, "board", true)).toEqual({ tab: "board", calPick: null });
    expect(tabPatch(dirty, "board", false)).toEqual({ tab: "board", calPick: null });
    expect(tabPatch(dirty, "curriculum", true)).toEqual({ tab: "curriculum", calPick: null });
  });
});

describe("blocksLeave (헤더 메뉴 등 다른 화면으로 — 미저장 편집)", () => {
  it("편집 모드 + 열린 항목에 미저장 수정일 때만", () => {
    const S = { ...INITIAL_STATE, tab: "curriculum" as const, curMode: "edit" as const, editSel: "7", ov: { ...INITIAL_STATE.ov, descs: { "7": "x" } } };
    expect(blocksLeave(S, true)).toBe(true);
    expect(blocksLeave(S, false)).toBe(false);
    expect(blocksLeave({ ...S, tab: "board" }, true)).toBe(false);
    expect(blocksLeave({ ...S, ov: INITIAL_STATE.ov }, true)).toBe(false);
  });
});
