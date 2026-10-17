import { describe, expect, it } from "vitest";
import { badgeText, panelShift, pollGuard, relativeTime, visibleBody } from "./notifications";

// now = 2026-10-12 12:00 KST
const NOW = new Date("2026-10-12T03:00:00Z");

describe("relativeTime (cross-cutting §3)", () => {
  it("방금 / N분 전 / N시간 전", () => {
    expect(relativeTime("2026-10-12T02:59:40Z", NOW)).toBe("방금");
    expect(relativeTime("2026-10-12T02:57:00Z", NOW)).toBe("3분 전");
    expect(relativeTime("2026-10-12T01:00:00Z", NOW)).toBe("2시간 전");
  });
  it("어제 is decided by KST calendar date, not by 24h — 시각을 함께 (같은 문구 알림 구분, Q1-9)", () => {
    // 2026-10-11 05:00 KST (31h ago) → 어제 05:00
    expect(relativeTime("2026-10-10T20:00:00Z", NOW)).toBe("어제 05:00");
  });
  it("older → M월 D일 HH:mm (KST)", () => {
    // 2026-10-03 00:30 KST
    expect(relativeTime("2026-10-02T15:30:00Z", NOW)).toBe("10월 3일 00:30");
    expect(relativeTime("2026-10-05T05:07:00Z", NOW)).toBe("10월 5일 14:07");
  });
  it("올해가 아니면 연도도 (Q3-8)", () => {
    expect(relativeTime("2025-12-31T14:59:00Z", NOW)).toBe("2025년 12월 31일 23:59");
    // 연말·연초 경계: 2027-01-01 00:10 KST 의 '지금'에서 2026-12-30 은 올해가 아님
    expect(relativeTime("2026-12-30T03:00:00Z", new Date("2027-01-02T03:00:00Z"))).toBe("2026년 12월 30일 12:00");
  });
});

describe("badgeText", () => {
  it("caps at 99+", () => {
    expect(badgeText(3)).toBe("3");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});

describe("panelShift (Q1-02 · 390 폭에서 패널을 화면 안으로)", () => {
  it("no shift when the panel already fits", () => {
    expect(panelShift(1200, 1280)).toBe(0);
  });
  it("390: bell right edge at 318 (avatar to its right) → shift so the left edge sits at 16", () => {
    // w = min(360, 390-32) = 358, left = 318-358 = -40 → shift 56
    expect(panelShift(318, 390)).toBe(56);
    expect(318 + 56 - 358).toBe(16);
  });
});

describe("visibleBody (Q1-14)", () => {
  const n = (body: string | null, room: string | null) => ({ body, room: room === null ? null : { slug: "s", title: room } });
  it("hides a body that just repeats the room title (it is already in the meta line)", () => {
    expect(visibleBody(n("Spring 김영한 로드맵 완강", "Spring 김영한 로드맵 완강"))).toBe("");
    expect(visibleBody(n(" Spring ", "Spring"))).toBe("");
  });
  it("keeps other bodies", () => {
    expect(visibleBody(n("3주차가 시작됐어요", "Spring"))).toBe("3주차가 시작됐어요");
    expect(visibleBody(n("본문", null))).toBe("본문");
    expect(visibleBody(n(null, "Spring"))).toBe("");
  });
});

describe("pollGuard (Q1-13 · 폴링이 낙관적 감소를 덮어쓰지 않게)", () => {
  it("a poll started before a local change is dropped", async () => {
    const g = pollGuard();
    let resolve!: (n: number) => void;
    const p = g.run(new Promise<number>((r) => (resolve = r)));
    g.bump();
    resolve(2);
    expect(await p).toEqual({ fresh: false, value: 2 });
  });
  it("a poll started after the last change is applied", async () => {
    const g = pollGuard();
    g.bump();
    expect(await g.run(Promise.resolve(1))).toEqual({ fresh: true, value: 1 });
  });
});
