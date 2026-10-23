import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * 사용자 파일 임베드 금지 게이트 (md-images 스펙 D15·T2) — SVG 는 <img src> 로만 그린다.
 * 화면 코드에 HTML 주입·문서 임베드가 들어오면 여기서 막는다(A0 기록: 0건).
 */

const SRC = path.resolve(__dirname, "../..");
const sources = (exts: string[]) =>
  (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => exts.some((e) => f.endsWith(e)) && !/\.test\.tsx?$/.test(f) && !f.includes("__fixtures__"))
    .map((f) => ({ file: f.split(path.sep).join("/"), text: readFileSync(path.join(SRC, f), "utf8") }));

// 고정 문자열 아이콘만 넣는 곳 — 사용자 문자열이 닿지 않는다
const INNER_HTML_OK = new Set(["components/ui/markdown-editor/cm.ts"]);

describe("사용자 파일 임베드 금지", () => {
  it("화면(.tsx)에 dangerouslySetInnerHTML·<object>·<embed>·<iframe> 0건", () => {
    const tsx = sources([".tsx"]);
    expect(tsx.length).toBeGreaterThan(50); // 빈 목록으로 통과하지 않게
    const hits = tsx.flatMap(({ file, text }) => [...text.matchAll(/dangerouslySetInnerHTML|<object\b|<embed\b|<iframe\b/g)].map((m) => `${file}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
  it("innerHTML·insertAdjacentHTML 대입은 고정 아이콘 자리만", () => {
    const hits = sources([".ts", ".tsx"]).filter(({ file, text }) => /\.(?:inner|outer)HTML\s*=|insertAdjacentHTML\(/.test(text) && !INNER_HTML_OK.has(file));
    expect(hits.map((h) => h.file)).toEqual([]);
  });
  it("문서 요소를 코드로 만들지 않는다(createElement 로 iframe·object·embed)", () => {
    const hits = sources([".ts", ".tsx"]).filter(({ text }) => /createElement\(\s*["'](?:iframe|object|embed)["']/.test(text));
    expect(hits.map((h) => h.file)).toEqual([]);
  });
});
