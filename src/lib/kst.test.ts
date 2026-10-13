import { describe, expect, it } from "vitest";
import { kstToday } from "./kst";

describe("kstToday", () => {
  it("uses Asia/Seoul, not the host timezone", () => {
    expect(kstToday(new Date("2026-10-11T15:30:00Z"))).toBe("2026-10-12");   // KST 10/12 00:30
    expect(kstToday(new Date("2026-10-11T14:59:59Z"))).toBe("2026-10-11");   // KST 10/11 23:59:59
  });
});
