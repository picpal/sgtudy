import { describe, expect, it } from "vitest";
import { AVATAR_PAL, PAL, avatarColors, contrastRatio, type Tone } from "./palette";

const TONES = Object.keys(PAL) as Tone[];

describe("avatarColors", () => {
  it("id 가 없으면 기존 tone 팔레트 그대로", () => {
    expect(avatarColors("mint")).toEqual(PAL.mint);
    expect(avatarColors("blue", { strong: true })).toEqual(AVATAR_PAL.blue);
  });

  it("같은 id 는 늘 같은 색 (결정적)", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(avatarColors("mint", { id })).toEqual(avatarColors("mint", { id }));
  });

  it("같은 tone 이라도 id 에 따라 연한/진한 두 가지로 갈린다", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const seen = new Set(ids.map((id) => JSON.stringify(avatarColors("peach", { id }))));
    expect(seen.size).toBe(2);
    expect(seen.has(JSON.stringify(PAL.peach))).toBe(true);
  });

  it("모든 변형의 글자 대비 4.5:1 이상 (WCAG AA)", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `u-${i}`);
    for (const tone of TONES)
      for (const strong of [false, true])
        for (const id of ids) {
          const c = avatarColors(tone, { id, strong });
          expect(contrastRatio(c.fg, c.bg), `${tone} ${strong} ${id}`).toBeGreaterThanOrEqual(4.5);
        }
  });
});

describe("contrastRatio", () => {
  it("흑백 21:1, 같은 색 1:1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#2F5BC2", "#2F5BC2")).toBeCloseTo(1, 5);
  });
});
