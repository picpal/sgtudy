import { describe, expect, it } from "vitest";
import { badgeText, relativeTime } from "./notifications";

// now = 2026-10-12 12:00 KST
const NOW = new Date("2026-10-12T03:00:00Z");

describe("relativeTime (cross-cutting §3)", () => {
  it("방금 / N분 전 / N시간 전", () => {
    expect(relativeTime("2026-10-12T02:59:40Z", NOW)).toBe("방금");
    expect(relativeTime("2026-10-12T02:57:00Z", NOW)).toBe("3분 전");
    expect(relativeTime("2026-10-12T01:00:00Z", NOW)).toBe("2시간 전");
  });
  it("어제 is decided by KST calendar date, not by 24h", () => {
    // 2026-10-11 05:00 KST (31h ago) → 어제
    expect(relativeTime("2026-10-10T20:00:00Z", NOW)).toBe("어제");
  });
  it("older → M월 D일 (KST)", () => {
    // 2026-10-03 00:30 KST
    expect(relativeTime("2026-10-02T15:30:00Z", NOW)).toBe("10월 3일");
  });
});

describe("badgeText", () => {
  it("caps at 99+", () => {
    expect(badgeText(3)).toBe("3");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});
