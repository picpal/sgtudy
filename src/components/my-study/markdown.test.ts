import { describe, expect, it } from "vitest";
import { headingTag, parseInline, parseMarkdown, type MdBlock } from "./markdown";

const li = (text: string, sub: MdBlock[] = []) => ({ text, sub });
const t = (text: string, done: boolean, sub: MdBlock[] = []) => ({ text, done, sub });

describe("parseMarkdown (Q2-10) — 블록", () => {
  it("headings, paragraphs with line breaks, lists", () => {
    expect(parseMarkdown("## 소개\n**굵게** 테스트\n둘째 줄\n\n- 항목\n- 둘\n\n1. 하나\n2. 둘")).toEqual([
      { type: "h", level: 2, text: "소개" },
      { type: "p", lines: ["**굵게** 테스트", "둘째 줄"] },
      { type: "ul", items: [li("항목"), li("둘")] },
      { type: "ol", items: [li("하나"), li("둘")] },
    ]);
  });
  it("list right after a paragraph line starts a new block; # without space is text", () => {
    expect(parseMarkdown("소개\n* a\n#태그")).toEqual([{ type: "p", lines: ["소개"] }, { type: "ul", items: [li("a")] }, { type: "p", lines: ["#태그"] }]);
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
      { type: "task", items: [t("할 일", false), t("끝남", true)] },
      { type: "ul", items: [li("그냥")] },
    ]);
  });
  it("인용은 안쪽을 다시 파싱", () => {
    expect(parseMarkdown("> 참고\n> - 하나")).toEqual([{ type: "quote", blocks: [{ type: "p", lines: ["참고"] }, { type: "ul", items: [li("하나")] }] }]);
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
    expect(parseMarkdown("- [ ]")).toEqual([{ type: "task", items: [t("", false)] }]);
    expect(parseMarkdown("> - [ ] a\n> - [x]")).toEqual([{ type: "quote", blocks: [{ type: "task", items: [t("a", false), t("", true)] }] }]);
  });
});

describe("중첩 목록 (D10·D11)", () => {
  const ul = (...items: ReturnType<typeof li>[]): MdBlock => ({ type: "ul", items });
  it("2칸 들여쓰기 · 표식 폭+1(에디터가 만드는 값) 둘 다 하위", () => {
    expect(parseMarkdown("- a\n  - b\n- c")).toEqual([ul(li("a", [ul(li("b"))]), li("c"))]);
    expect(parseMarkdown("1. a\n   - b\n2. c")).toEqual([{ type: "ol", items: [li("a", [ul(li("b"))]), li("c")] }]);
    expect(parseMarkdown("1. a\n  - b")).toEqual([{ type: "ol", items: [li("a", [ul(li("b"))])] }]);
  });
  it("1칸 들여쓰기는 형제", () => expect(parseMarkdown("- a\n - b")).toEqual([ul(li("a"), li("b"))]));
  it("탭 = 공백 4", () => expect(parseMarkdown("- a\n\t- b\n\t\t- c")).toEqual([ul(li("a", [ul(li("b", [ul(li("c"))]))]))]));
  it("ul·ol·task 섞임 — 하위 종류가 바뀌면 새 하위 목록", () => {
    expect(parseMarkdown("- a\n  1. b\n  2. c\n  - [x] d\n- e")).toEqual([
      ul(li("a", [{ type: "ol", items: [li("b"), li("c")] }, { type: "task", items: [t("d", true)] }]), li("e")),
    ]);
  });
  it("얕은 줄로 돌아오면 그 단계의 형제", () => {
    expect(parseMarkdown("- a\n  - b\n    - c\n  - d\n- e")).toEqual([ul(li("a", [ul(li("b", [ul(li("c"))]), li("d"))]), li("e"))]);
  });
  it("깊이 5 이상은 4단계에 붙인다", () => {
    const deep = ["- 1", "  - 2", "    - 3", "      - 4", "        - 5", "          - 6"].join("\n");
    expect(parseMarkdown(deep)).toEqual([ul(li("1", [ul(li("2", [ul(li("3", [ul(li("4"), li("5"), li("6"))]))]))]))]);
  });
  it("들여쓴 목록 아닌 줄은 그 항목의 이어진 줄(줄바꿈 유지)", () => {
    expect(parseMarkdown("- a\n  이어짐\n  - b\n    b 이어짐")).toEqual([ul(li("a\n이어짐", [ul(li("b\nb 이어짐"))]))]);
  });
  it("들여쓰지 않은 목록 아닌 줄은 목록을 끝내고 문단", () => {
    expect(parseMarkdown("- a\n  - b\n문단")).toEqual([ul(li("a", [ul(li("b"))])), { type: "p", lines: ["문단"] }]);
  });
  it("번호 목록은 첫 번호를 start 로, 1 이면 생략", () => {
    expect(parseMarkdown("3. a\n4. b")).toEqual([{ type: "ol", start: 3, items: [li("a"), li("b")] }]);
    expect(parseMarkdown("- a\n  5. b")).toEqual([ul(li("a", [{ type: "ol", start: 5, items: [li("b")] }]))]);
  });
  it("인용 안 중첩", () => expect(parseMarkdown("> - a\n>   - b")).toEqual([{ type: "quote", blocks: [ul(li("a", [ul(li("b"))]))] }]));
});

describe("접기 블록 :::details (D8)", () => {
  const det = (title: string, blocks: MdBlock[]): MdBlock => ({ type: "details", title, blocks });
  it("제목과 안쪽 전체 마크다운(목록·표·코드·그림)", () => {
    expect(parseMarkdown(":::details 해설 **보기**\n- a\n  - b\n\n| x |\n| - |\n| 1 |\n\n```\n:::\n```\n![](attachment:a.png)\n:::\n뒤")).toEqual([
      det("해설 **보기**", [
        { type: "ul", items: [li("a", [{ type: "ul", items: [li("b")] }])] },
        { type: "table", table: { align: ["none"], header: ["x"], rows: [["1"]] } },
        { type: "code", lang: "", text: ":::" },
        { type: "p", lines: ["![](attachment:a.png)"] },
      ]),
      { type: "p", lines: ["뒤"] },
    ]);
  });
  it("빈 제목은 빈 글자(화면이 「펼쳐 보기」)", () => expect(parseMarkdown(":::details\na\n:::")).toEqual([det("", [{ type: "p", lines: ["a"] }])]));
  it("닫지 않으면 문서 끝에서 닫는다", () => expect(parseMarkdown("앞\n:::details 쓰다 만\n- a")).toEqual([{ type: "p", lines: ["앞"] }, det("쓰다 만", [{ type: "ul", items: [li("a")] }])]));
  it("중첩 3단계까지, 4단계 여는 줄은 글자", () => {
    const src = [":::details 1", ":::details 2", ":::details 3", ":::details 4", "x", ":::", ":::", ":::", ":::"].join("\n");
    expect(parseMarkdown(src)).toEqual([det("1", [det("2", [det("3", [{ type: "p", lines: [":::details 4", "x", ":::"] }])])])]);
  });
  it("코드 펜스 안의 :::details 는 무시", () => {
    expect(parseMarkdown("```\n:::details x\n:::\n```")).toEqual([{ type: "code", lang: "", text: ":::details x\n:::" }]);
  });
  it("인용 안에서도", () => expect(parseMarkdown("> :::details 팁\n> 내용\n> :::")).toEqual([{ type: "quote", blocks: [det("팁", [{ type: "p", lines: ["내용"] }])] }]));
  it(":::note · 혼자 있는 ::: 는 글자", () => expect(parseMarkdown(":::note\n:::")).toEqual([{ type: "p", lines: [":::note", ":::"] }]));
  it("목록을 끊고 시작한다", () => expect(parseMarkdown("- a\n:::details b\nc\n:::")).toEqual([{ type: "ul", items: [li("a")] }, det("b", [{ type: "p", lines: ["c"] }])]));
});
