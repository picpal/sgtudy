import { describe, expect, it } from "vitest";
import { isUrgent } from "./calc";

describe("isUrgent", () => {
  it("open and mine (or mine unset) → urgent", () => {
    expect(isUrgent({ st: "open" })).toBe(true);
    expect(isUrgent({ st: "open", mine: true })).toBe(true);
  });
  it("leader-only task (mine:false) never urgent, even if open", () => {
    expect(isUrgent({ st: "open", mine: false })).toBe(false);
  });
  it("other statuses are not urgent", () => {
    expect(isUrgent({ st: "planned" })).toBe(false);
    expect(isUrgent({ st: "done" })).toBe(false);
  });
});
