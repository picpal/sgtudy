import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown (Q2-10) — 블록", () => {
  it("headings, paragraphs with line breaks, lists", () => {
    expect(parseMarkdown("## 소개\n**굵게** 테스트\n둘째 줄\n\n- 항목\n- 둘\n\n1. 하나\n2. 둘")).toEqual([
      { type: "h", level: 2, text: "소개" },
      { type: "p", lines: ["**굵게** 테스트", "둘째 줄"] },
      { type: "ul", items: ["항목", "둘"] },
      { type: "ol", items: ["하나", "둘"] },
    ]);
  });
  it("list right after a paragraph line starts a new block; # without space is text", () => {
    expect(parseMarkdown("소개\n* a\n#태그")).toEqual([{ type: "p", lines: ["소개"] }, { type: "ul", items: ["a"] }, { type: "p", lines: ["#태그"] }]);
  });
  it("empty → []", () => expect(parseMarkdown("  \n")).toEqual([]));
});

describe("parseInline", () => {
  it("bold, italic, code, http(s) links only", () => {
    expect(parseInline("**굵게** 와 *기울임* `코드` [링크](https://a.com) [나쁜](javascript:alert(1))")).toEqual([
      { t: "b", v: "굵게" }, { t: "text", v: " 와 " }, { t: "i", v: "기울임" }, { t: "text", v: " " }, { t: "code", v: "코드" }, { t: "text", v: " " },
      { t: "a", v: "링크", href: "https://a.com" }, { t: "text", v: " [나쁜](javascript:alert(1))" },
    ]);
  });
  it("raw html stays text", () => expect(parseInline("<img src=x onerror=1>")).toEqual([{ t: "text", v: "<img src=x onerror=1>" }]));
});
