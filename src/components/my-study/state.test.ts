import { describe, expect, it } from "vitest";
import { INITIAL_STATE, goLeafPatch, modeSwitchPatch } from "./state";

describe("goLeafPatch", () => {
  it("opens the task detail view instead of an inline row", () =>
    expect(goLeafPatch("21")).toEqual({ tab: "curriculum", curMode: "view", viewSel: "21", viewFocus: "submission", editSel: null, closed: {}, calPick: null }));
});

describe("viewFocus", () => {
  it("INITIAL_STATE has no pending focus", () => expect(INITIAL_STATE.viewFocus).toBeNull());
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
