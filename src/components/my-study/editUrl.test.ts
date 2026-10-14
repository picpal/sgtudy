import { describe, expect, it } from "vitest";
import { isUrlItem, itemTarget, readItem, urlStep, withItem } from "./editUrl";

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
