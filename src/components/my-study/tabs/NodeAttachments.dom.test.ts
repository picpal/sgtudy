// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NodeAttachmentsView } from "./NodeAttachments";

const f = (id: string, name: string, contentType = "application/pdf", size = 2048) => ({ id, name, contentType, size, status: "ready" as const });
const html = (p: Parameters<typeof NodeAttachmentsView>[0]) => {
  const d = document.createElement("div");
  d.innerHTML = renderToStaticMarkup(createElement(NodeAttachmentsView, p));
  return d;
};

describe("NodeAttachmentsView", () => {
  it("renders nothing when empty", () => expect(html({ files: [], onOpen: () => {} }).innerHTML).toBe(""));
  it("title with count, badge, size, 44px 받기 named by file", () => {
    const d = html({ files: [f("a", "1주차 자료.pdf"), f("b", "구성도.png", "image/png")], onOpen: () => {} });
    expect(d.querySelector("h3")?.textContent).toBe("첨부 파일 2");
    expect(d.textContent).toContain("PDF");
    expect(d.textContent).toContain("IMG");
    const b = d.querySelector('button[aria-label="1주차 자료.pdf 받기"]')!;
    expect(b.className).toMatch(/h-11|min-h-11/);
  });
  it("빼기 only when onRemove is given (leader moderation)", () => {
    expect(html({ files: [f("a", "x.pdf")], onOpen: () => {} }).querySelector('button[aria-label="x.pdf 빼기"]')).toBeNull();
    expect(html({ files: [f("a", "x.pdf")], onOpen: () => {}, onRemove: () => {} }).querySelector('button[aria-label="x.pdf 빼기"]')).not.toBeNull();
  });
  it("long names wrap (no horizontal scroll at 390)", () => {
    const d = html({ files: [f("a", "아주긴파일이름".repeat(20) + ".pdf")], onOpen: () => {} });
    expect(d.innerHTML).toContain("overflow-wrap:anywhere");
  });
});
