// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Inline, MarkdownView } from "./MarkdownView";

const html = (src: string) => renderToStaticMarkup(createElement(MarkdownView, { src }));

describe("MarkdownView 그림 — resolver 없음 (D4)", () => {
  it("첨부 그림은 자리표시 글자, <img> 없음", () => {
    const h = html("![구성도](attachment:vpc.svg)\n![](attachment:b.png)");
    expect(h).not.toContain("<img");
    expect(h).toContain("[그림: 구성도]");
    expect(h).toContain("[그림: b.png]");
  });
  it("외부 그림은 불러오지 않고 링크 (D2)", () => {
    const h = html("![트래커](https://t.io/p.png)");
    expect(h).not.toContain("<img");
    expect(h).toContain('<a href="https://t.io/p.png" target="_blank" rel="noopener noreferrer nofollow"');
    expect(h).toContain("그림 링크: 트래커");
  });
  it("댓글 등 Inline 만 쓰는 곳도 자리표시", () => {
    expect(renderToStaticMarkup(createElement(Inline, { text: "![a](attachment:x.png)" }))).toBe('<span class="text-muted">[그림: a]</span>');
  });
});

describe("MarkdownView 중첩 목록 (D10 · §4.4)", () => {
  it("하위 목록은 항목 안에, ul 단계별 기호, ol start", () => {
    const h = html("- a\n  - b\n    - c\n\n3. x\n   - [x] 끝");
    expect(h).toContain('<ul class="m-0 pl-5 list-disc"><li>a<div class="mt-[2px] flex flex-col gap-[2px]"><ul class="m-0 pl-5 list-[circle]"><li>b');
    expect(h).toContain("list-[square]");
    expect(h).toContain('<ol start="3"');
    expect(h).toContain("완료: </span>끝");
  });
  it("평탄 목록은 그대로 — start 없음", () => {
    expect(html("1. a\n2. b")).toBe('<div class="flex flex-col gap-[10px] text-ink-2 text-[14px] leading-[1.75]"><ol class="m-0 pl-5 list-decimal"><li>a</li><li>b</li></ol></div>');
  });
  it("이어진 줄은 <br>", () => expect(html("- a\n  이어짐")).toContain("<li>a<br/>이어짐</li>"));
});

describe("MarkdownView 접기 (D8·D9)", () => {
  it("<details><summary> — 기본 닫힘, 44px, 빈 제목은 「펼쳐 보기」", () => {
    const h = html(":::details 해설 **굵게**\n- a\n:::\n\n:::details\nb\n:::");
    expect(h).toMatch(/<details class="[^"]*"><summary class="[^"]*min-h-11/);
    expect(h).not.toContain("<details open");
    expect(h).toContain("<strong");
    expect(h).toContain("펼쳐 보기");
  });
  it("제목의 HTML·그림은 글자", () => {
    const h = html(":::details <script>x</script> ![a](attachment:p.png)\n:::");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<img");
    expect(h).toContain("[그림: a]");
  });
});
