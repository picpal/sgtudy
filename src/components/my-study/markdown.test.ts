import { describe, expect, it } from "vitest";
import { headingTag, parseInline, parseMarkdown } from "./markdown";

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

describe("headingTag (V2-06)", () => {
  it("nests markdown headings under the section h3", () => {
    expect([1, 2, 3].map((l) => headingTag(l as 1 | 2 | 3))).toEqual(["h4", "h5", "h6"]);
  });
});

describe("parseMarkdown — 에디터가 만드는 블록", () => {
  it("GFM 표 (정렬·셀 안 파이프·줄바꿈)", () => {
    expect(parseMarkdown("| 항목 | 설명 |\n| :--- | ---: |\n| a\\|b | 1<br>2 |\n\n끝")).toEqual([
      { type: "table", table: { align: ["left", "right"], header: ["항목", "설명"], rows: [["a|b", "1\n2"]] } },
      { type: "p", lines: ["끝"] },
    ]);
  });
  it("파이프가 있어도 구분 행이 없으면 문단", () => {
    expect(parseMarkdown("a | b\nc")).toEqual([{ type: "p", lines: ["a | b", "c"] }]);
  });
  it("체크리스트는 목록과 따로 묶는다", () => {
    expect(parseMarkdown("- [ ] 할 일\n- [x] 끝남\n- 그냥")).toEqual([
      { type: "task", items: [{ text: "할 일", done: false }, { text: "끝남", done: true }] },
      { type: "ul", items: ["그냥"] },
    ]);
  });
  it("인용은 안쪽을 다시 파싱", () => {
    expect(parseMarkdown("> 참고\n> - 하나")).toEqual([{ type: "quote", blocks: [{ type: "p", lines: ["참고"] }, { type: "ul", items: ["하나"] }] }]);
  });
  it("코드 블록은 들여쓰기·마크다운을 그대로 둔다, 닫는 펜스가 없으면 끝까지", () => {
    expect(parseMarkdown("```ts\n  **x**\n```\n본문")).toEqual([{ type: "code", lang: "ts", text: "  **x**" }, { type: "p", lines: ["본문"] }]);
    expect(parseMarkdown("```\na")).toEqual([{ type: "code", lang: "", text: "a" }]);
  });
  it("구분선, 깊은 제목은 ###", () => {
    expect(parseMarkdown("a\n\n---\n\n#### 깊음")).toEqual([{ type: "p", lines: ["a"] }, { type: "hr" }, { type: "h", level: 3, text: "깊음" }]);
  });
});

describe("parseInline — 취소선·밑줄 기울임", () => {
  it("~~취소~~ 와 _기울임_, 단어 속 밑줄은 글자", () => {
    expect(parseInline("~~취소~~ _기울임_ snake_case_name")).toEqual([
      { t: "s", v: "취소" }, { t: "text", v: " " }, { t: "i", v: "기울임" }, { t: "text", v: " snake_case_name" },
    ]);
  });
});

describe("에디터와 같은 모양 (Q1-11)", () => {
  it("글자 없는 체크리스트 줄(- [ ])도 체크리스트 — 인용 안에서도", () => {
    expect(parseMarkdown("- [ ]")).toEqual([{ type: "task", items: [{ text: "", done: false }] }]);
    expect(parseMarkdown("> - [ ] a\n> - [x]")).toEqual([{ type: "quote", blocks: [{ type: "task", items: [{ text: "a", done: false }, { text: "", done: true }] }] }]);
  });
});
