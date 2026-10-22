import { describe, expect, it } from "vitest";
import { bumpProgress, progressChangedSince } from "./progressStale";

describe("progressStale", () => {
  it("쓰기 전에는 그대로, 쓰기 뒤 처음 마운트하는 화면만 한 번 다시 받는다", () => {
    expect(progressChangedSince("a")).toBe(false);
    bumpProgress();
    expect(progressChangedSince("a")).toBe(true);
    expect(progressChangedSince("a")).toBe(false);
    expect(progressChangedSince("b")).toBe(true);
  });
});
