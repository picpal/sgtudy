import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
const block = (sel: string) => css.match(new RegExp(`${sel.replace(/[[\]().:]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

describe("상태바 띠 덮개 색 (globals.css)", () => {
  it("기본은 막대와 같은 --surface", () => {
    expect(block("[data-band-plate]")).toMatch(/background:\s*var\(--surface\);/);
  });
  it("전체 화면 막이 떠 있으면 html 바탕과 같은 막 색", () => {
    expect(css).toMatch(/html:has\(\[data-notice-popup\]\),\s*html:has\(\[data-notice-popup\]\) \[data-band-plate\] \{\s*background: #92979d;/);
    expect(css).toMatch(/html:has\(\[data-image-lightbox\]\),\s*html:has\(\[data-image-lightbox\]\) \[data-band-plate\] \{\s*background: #0b0f17;/);
  });
});
