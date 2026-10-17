import { describe, expect, it } from "vitest";
import { codeBlock, enterPastInline, heading, insertRule, insertTable, link, linesIn, mergeListMarker, tableTemplate, toggleLines, wrapInline, type Edit } from "./commands";
import { parseGfmTable } from "@/lib/markdown/gfmTable";

/** 편집 결과 문서 (changes 는 원문 좌표 기준, 뒤에서부터 적용) */
function apply(doc: string, e: Edit): string {
  return [...e.changes].sort((a, b) => b.from - a.from).reduce((d, c) => d.slice(0, c.from) + c.insert + d.slice(c.to), doc);
}
const sel = (doc: string, e: Edit) => apply(doc, e).slice(e.anchor, e.head ?? e.anchor);

describe("wrapInline", () => {
  it("선택을 감싸고 안쪽을 선택한다", () => {
    const e = wrapInline("hello world", 6, 11, "**", "**", "굵게");
    expect(apply("hello world", e)).toBe("hello **world**");
    expect(sel("hello world", e)).toBe("world");
  });
  it("선택이 없으면 자리 글자를 넣고 선택", () => {
    const e = wrapInline("ab", 1, 1, "~~", "~~", "취소선");
    expect(apply("ab", e)).toBe("a~~취소선~~b");
    expect(sel("ab", e)).toBe("취소선");
  });
  it("이미 감싼 선택은 벗긴다 — 바깥 표식", () => {
    const doc = "a **b** c";
    const e = wrapInline(doc, 4, 5, "**", "**", "");
    expect(apply(doc, e)).toBe("a b c");
    expect(sel(doc, e)).toBe("b");
  });
  it("이미 감싼 선택은 벗긴다 — 안쪽 표식", () => {
    const doc = "a `code` c";
    const e = wrapInline(doc, 2, 8, "`", "`", "");
    expect(apply(doc, e)).toBe("a code c");
  });
  it("굵게 안쪽에 기울임을 누르면 굵게를 지키고 기울임을 더한다", () => {
    const doc = "**굵게**";
    const e = wrapInline(doc, 2, 4, "*", "*", "");
    expect(apply(doc, e)).toBe("***굵게***");
    expect(sel(doc, e)).toBe("굵게");
    expect(apply(doc, wrapInline(doc, 0, 6, "*", "*", ""))).toBe("***굵게***"); // 표식까지 잡아도 같다
  });
  it("굵은 기울임에서 기울임만 벗긴다", () => {
    const doc = "***x***";
    expect(apply(doc, wrapInline(doc, 3, 4, "*", "*", ""))).toBe("**x**");
    expect(apply(doc, wrapInline(doc, 3, 4, "**", "**", ""))).toBe("*x*");
    expect(apply("*x*", wrapInline("*x*", 1, 2, "*", "*", ""))).toBe("x");
  });
});

describe("줄 앞 블록 표식은 감싸지 않는다", () => {
  it("인용·목록·제목 줄을 통째로 잡아도 글자만", () => {
    expect(apply("> 문서", link("> 문서", 0, 4))).toBe("> [문서](https://)");
    expect(apply("- [ ] 할 일", wrapInline("- [ ] 할 일", 0, 10, "**", "**", ""))).toBe("- [ ] **할 일**");
    expect(apply("## 제목", wrapInline("## 제목", 0, 5, "~~", "~~", ""))).toBe("## ~~제목~~");
  });
  it("빈 목록 줄에서 캐럿만 있으면 표식 뒤에 자리 글자", () => {
    expect(apply("- ", wrapInline("- ", 0, 0, "**", "**", "굵게"))).toBe("**굵게**- ");
    expect(apply("- ", wrapInline("- ", 2, 2, "**", "**", "굵게"))).toBe("- **굵게**");
  });
});

describe("link", () => {
  it("글자를 링크로 만들고 주소 부분을 선택", () => {
    const e = link("문서 보기", 0, 5);
    expect(apply("문서 보기", e)).toBe("[문서 보기](https://)");
    expect(sel("문서 보기", e)).toBe("https://");
  });
  it("주소를 선택하면 주소는 그대로 두고 글자를 선택", () => {
    const doc = "https://a.io";
    const e = link(doc, 0, doc.length);
    expect(apply(doc, e)).toBe("[링크 텍스트](https://a.io)");
    expect(sel(doc, e)).toBe("링크 텍스트");
  });
});

describe("heading", () => {
  it("붙이고, 단계 바꾸고, 같은 단계면 뗀다", () => {
    expect(apply("제목", heading("제목", 1, 2))).toBe("## 제목");
    expect(apply("## 제목", heading("## 제목", 4, 1))).toBe("# 제목");
    expect(apply("# 제목", heading("# 제목", 3, 1))).toBe("제목");
  });
  it("캐럿 위치가 표식 길이만큼 옮겨간다", () => {
    const e = heading("a\n제목", 3, 3);
    expect(apply("a\n제목", e)).toBe("a\n### 제목");
    expect(e.anchor).toBe(7);
  });
});

describe("toggleLines", () => {
  it("한 줄 목록 토글", () => {
    expect(apply("할 일", toggleLines("할 일", 0, 0, "bullet"))).toBe("- 할 일");
    expect(apply("- 할 일", toggleLines("- 할 일", 3, 3, "bullet"))).toBe("할 일");
  });
  it("목록 ↔ 체크리스트 ↔ 번호 목록은 서로 갈아 끼운다", () => {
    expect(apply("- 할 일", toggleLines("- 할 일", 3, 3, "task"))).toBe("- [ ] 할 일");
    expect(apply("- [x] 할 일", toggleLines("- [x] 할 일", 7, 7, "ordered"))).toBe("1. 할 일");
    expect(apply("1. 할 일", toggleLines("1. 할 일", 4, 4, "bullet"))).toBe("- 할 일");
  });
  it("여러 줄은 줄마다, 번호는 1부터, 빈 줄은 건너뜀", () => {
    const doc = "가\n\n나\n다";
    const e = toggleLines(doc, 0, doc.length, "ordered");
    expect(apply(doc, e)).toBe("1. 가\n\n2. 나\n3. 다");
  });
  it("모든 줄이 이미 인용이면 벗긴다", () => {
    const doc = "> a\n> b";
    expect(apply(doc, toggleLines(doc, 0, doc.length, "quote"))).toBe("a\nb");
  });
  it("들여쓰기는 유지", () => {
    expect(apply("  - a", toggleLines("  - a", 4, 4, "task"))).toBe("  - [ ] a");
  });
});

describe("linesIn", () => {
  it("끝이 다음 줄 맨 앞이면 그 줄은 뺀다", () => {
    expect(linesIn("a\nb\nc", 0, 2).map((l) => l.text)).toEqual(["a"]);
    expect(linesIn("a\nb\nc", 0, 3).map((l) => l.text)).toEqual(["a", "b"]);
  });
});

describe("블록 삽입", () => {
  it("표 템플릿은 GFM 표로 파싱된다", () => {
    const m = parseGfmTable(tableTemplate(3, 2));
    expect(m?.header).toEqual(["제목 1", "제목 2", "제목 3"]);
    expect(m?.rows).toEqual([["", "", ""], ["", "", ""]]);
  });
  it("글이 있는 줄 다음에 빈 줄을 두고 넣고, 뒤 문단과도 빈 줄로 떼어 놓는다", () => {
    const doc = "소개\n다음 문단";
    const out = apply(doc, insertTable(doc, 1));
    expect(out).toBe(`소개\n\n${tableTemplate()}\n\n다음 문단`);
  });
  it("빈 줄에서는 그 자리에", () => {
    const doc = "a\n\n\nb";
    const e = insertRule(doc, 3);
    expect(apply(doc, e)).toBe("a\n\n---\n\nb");
  });
  it("문서 끝이면 블록 다음 빈 줄에 캐럿", () => {
    const e = insertRule("", 0);
    expect(apply("", e)).toBe("---\n");
    expect(e.anchor).toBe(4);
  });
  it("코드 블록: 빈 블록이면 안쪽에 캐럿, 선택이 있으면 감싼다", () => {
    const e = codeBlock("", 0, 0);
    expect(apply("", e)).toBe("```\n\n```\n");
    expect(e.anchor).toBe(4);
    expect(apply("x = 1\ny = 2", codeBlock("x = 1\ny = 2", 0, 11))).toBe("```\nx = 1\ny = 2\n```");
  });
});

describe("mergeListMarker — 자동으로 이어진 표식 뒤에 표식을 또 치면 하나로", () => {
  it("같은 글머리는 자동 표식 하나만 남긴다", () => {
    expect(mergeListMarker("- ", "- ")).toBe("- ");
    expect(mergeListMarker("- ", "* ")).toBe("- ");
    expect(mergeListMarker("  - ", "- ")).toBe("  - ");
  });
  it("번호 목록은 이어 매긴 번호를 지킨다", () => {
    expect(mergeListMarker("2. ", "1. ")).toBe("2. ");
    expect(mergeListMarker("3) ", "1. ")).toBe("3) ");
  });
  it("종류가 다르면 친 표식으로 바꾼다", () => {
    expect(mergeListMarker("- ", "1. ")).toBe("1. ");
    expect(mergeListMarker("  2. ", "- ")).toBe("  - ");
  });
  it("앞에 공백을 붙여 치면 한 단계 안쪽 항목", () => {
    expect(mergeListMarker("- ", "  - ")).toBe("  - ");
    expect(mergeListMarker("1. ", "  - ")).toBe("   - ");
    expect(mergeListMarker("  - ", "  - ")).toBe("    - ");
  });
  it("체크리스트 뒤 글머리는 체크리스트 그대로", () => {
    expect(mergeListMarker("- [ ] ", "- ")).toBe("- [ ] ");
  });
  it("표식이 아니면 합치지 않는다", () => {
    expect(mergeListMarker("- ", "a ")).toBeNull();
    expect(mergeListMarker("- ", "-")).toBeNull();
    expect(mergeListMarker("> ", "- ")).toBeNull();
    expect(mergeListMarker("", "- ")).toBeNull();
  });
});

describe("enterPastInline (Q3-12 — 닫는 표식 바로 앞 Enter 가 표식을 다음 줄로 흩지 않게)", () => {
  it("굵게 안에 쓰고 닫는 ** 앞에서 Enter → 캐럿을 줄 끝(표식 뒤)으로 옮긴다", () => {
    const doc = "- **굵은 글씨**";
    expect(enterPastInline(doc, doc.length - 2)).toEqual({ changes: [], anchor: doc.length });
  });
  it("여러 표식이 겹쳐 닫혀도(***, ~~ + **) 줄 끝으로", () => {
    const doc = "a ~~**b**~~";
    expect(enterPastInline(doc, doc.length - 4)).toEqual({ changes: [], anchor: doc.length });
  });
  it("아무것도 안 쓴 빈 표식 쌍(**|**)은 지운다", () => {
    const doc = "앞 ****";
    const e = enterPastInline(doc, 4)!;
    expect(apply(doc, e)).toBe("앞 ");
    expect(e.anchor).toBe(2);
  });
  it("뒤에 글이 더 있거나, 여는 표식이 없거나, 선택 자리 글자(굵게)가 있으면 그대로(null)", () => {
    expect(enterPastInline("**a** b", 3)).toBeNull();
    expect(enterPastInline("a**", 1)).toBeNull();
    expect(enterPastInline("plain", 5)).toBeNull();
    // 앞에 이미 닫힌 쌍만 있으면(**a** b|**) 여는 짝이 아니다
    expect(enterPastInline("**a** b**", 7)).toBeNull();
    expect(enterPastInline("**a** **b**", 9)).toEqual({ changes: [], anchor: 11 });
    // 캐럿이 닫는 표식 한가운데(**a*|*)
    expect(enterPastInline("**a**", 4)).toBeNull();
    expect(enterPastInline("x\n**a**\ny", 5)).toEqual({ changes: [], anchor: 7 });
  });
});
