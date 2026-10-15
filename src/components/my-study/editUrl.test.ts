import { describe, expect, it } from "vitest";
import { isUrlItem, itemFromUrl, itemTarget, readItem, readMode, syncStep, urlStep, withItem } from "./editUrl";

describe("edit view URL (?item=)", () => {
  it("reads only numeric server ids", () => {
    expect(readItem("?tab=curriculum&mode=edit&item=42")).toBe("42");
    expect(readItem("?item=root.new0")).toBeNull();
    expect(readItem("?item=")).toBeNull();
    expect(readItem("")).toBeNull();
    expect(isUrlItem("root.new0")).toBe(false);
  });

  it("opening an item also pins tab=curriculum&mode=edit; closing keeps the other params", () => {
    expect(withItem("/my-study/aws?tab=overview", "7")).toBe("/my-study/aws?tab=curriculum&mode=edit&item=7");
    expect(withItem("/my-study/aws", "7")).toBe("/my-study/aws?tab=curriculum&mode=edit&item=7");
    expect(withItem("/my-study/aws?tab=curriculum&mode=edit&item=7", null)).toBe("/my-study/aws?tab=curriculum&mode=edit");
    expect(withItem("/my-study/aws?item=7#x", null)).toBe("/my-study/aws#x");
  });

  it("list → item pushes, item → item replaces, item → list goes back only over its own entry", () => {
    expect(urlStep(null, "7", false)).toBe("push");
    expect(urlStep("7", "8", true)).toBe("replace");
    expect(urlStep("7", null, true)).toBe("back");
    expect(urlStep("7", null, false)).toBe("replace"); // 새로고침·링크로 바로 들어온 편집 화면
    expect(urlStep("7", "7", true)).toBe("none");
    expect(urlStep(null, null, false)).toBe("none");
  });

  it("temp (optimistic) nodes never reach the URL", () => {
    expect(urlStep(null, "root.new0", false)).toBe("none");
    expect(urlStep("7", "7.new0", true)).toBe("none");
  });

  it("unknown or deleted ids fall back to the list", () => {
    const has = (id: string) => id === "7";
    expect(itemTarget("7", has)).toBe("7");
    expect(itemTarget("99", has)).toBeNull();
    expect(itemTarget(null, has)).toBeNull();
  });
});

describe("detail view URL (보기 ?item=)", () => {
  it("view items drop mode; edit items pin mode=edit", () => {
    expect(withItem("/my-study/aws?tab=board", "7", "view")).toBe("/my-study/aws?tab=curriculum&item=7");
    expect(withItem("/my-study/aws?tab=curriculum&mode=edit&item=7", "7", "view")).toBe("/my-study/aws?tab=curriculum&item=7");
    expect(withItem("/my-study/aws?tab=curriculum&item=7", "7", "edit")).toBe("/my-study/aws?tab=curriculum&item=7&mode=edit");
  });
  it("readMode", () => {
    expect(readMode("?tab=curriculum&mode=edit&item=7")).toBe("edit");
    expect(readMode("?tab=curriculum&item=7")).toBe("view");
  });
  it("보기 상세 → 편집은 push (뒤로 = 상세), 그 편집에서 보기로는 back, 닫기·다른 항목은 replace", () => {
    expect(syncStep("7", "view", "7", "edit", true)).toBe("push");
    expect(syncStep("7", "view", "7", "edit", false)).toBe("push");
    expect(syncStep("7", "edit", "7", "view", true, false, true)).toBe("back");
    expect(syncStep("7", "edit", null, "edit", true, false, true)).toBe("replace");
    expect(syncStep("7", "edit", "8", "edit", true, false, true)).toBe("replace");
    expect(syncStep("7", "edit", "7", "edit", true, false, true)).toBe("none");
  });
  it("same item, edit → view (not over a detail) → replace; otherwise urlStep", () => {
    expect(syncStep("7", "edit", "7", "view", true)).toBe("replace");
    expect(syncStep("7", "edit", "7", "edit", true)).toBe("none");
    expect(syncStep(null, "view", "7", "view", false)).toBe("push");
    expect(syncStep("7", "view", null, "view", true)).toBe("back");
    expect(syncStep("7", "view", "8", "view", true)).toBe("replace");
  });
  it("알림·일정 링크(?task=) 진입: task 는 지우고, 첫 열기는 push 가 아니라 replace (외부 링크 진입과 같다)", () => {
    expect(withItem("/my-study/aws?task=21", "21", "view")).toBe("/my-study/aws?tab=curriculum&item=21");
    expect(withItem("/my-study/aws?task=21&tab=curriculum&item=21", null)).toBe("/my-study/aws?tab=curriculum");
    expect(syncStep(null, "view", "21", "view", false, true)).toBe("replace");
    expect(syncStep("7", "view", "8", "view", true, true)).toBe("replace");
    expect(syncStep(null, "view", null, "view", false, true)).toBe("none");
  });
  it("itemFromUrl: edit only for editors, missing ids → list", () => {
    const has = (id: string) => id === "7";
    expect(itemFromUrl("?item=7&mode=edit", has, true)).toEqual({ id: "7", mode: "edit" });
    expect(itemFromUrl("?item=7&mode=edit", has, false)).toEqual({ id: "7", mode: "view" });
    expect(itemFromUrl("?item=7", has, true)).toEqual({ id: "7", mode: "view" });
    expect(itemFromUrl("?item=9", has, true)).toEqual({ id: null, mode: "view" });
  });
});
