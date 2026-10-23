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
