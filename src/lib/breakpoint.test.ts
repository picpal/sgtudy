import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// "≤900" 규칙 (QA V2-01/V2-02): Tailwind 는 max-[901px] / min-[901px] (width < 901 / ≥ 901),
// JS 는 matchMedia("(max-width: 900px)"). 900 에서 CSS 와 JS 가 서로 다른 쪽을 보면 하이브리드 레이아웃이 된다.
const SRC = path.resolve(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });

describe("≤900 breakpoint", () => {
  const all = files(SRC).map((p) => [path.relative(SRC, p), readFileSync(p, "utf8")] as const);

  it("Tailwind variants use 901 (not 900/899) on both sides", () => {
    const bad = all.filter(([, s]) => /(max|min)-\[(899|900)(\.\d+)?px\]/.test(s)).map(([p]) => p);
    expect(bad).toEqual([]);
  });

  it("JS media queries use max-width: 900px / min-width: 901px", () => {
    const bad = all
      .flatMap(([p, s]) => [...s.matchAll(/(max|min)-width:\s*(\d+)px/g)].map((m) => [p, m[1], +m[2]] as const))
      .filter(([, k, n]) => (n >= 899 && n <= 901 ? (k === "max" ? n !== 900 : n !== 901) : false))
      .map(([p, k, n]) => `${p}: ${k}-width ${n}`);
    expect(bad).toEqual([]);
  });
});
