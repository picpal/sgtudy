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

describe("NodeAttachmentsView 썸네일 (D13)", () => {
  const thumbs = new Map<string, string | null>([
    ["p", "https://sb.test/s/p"],
    ["v", "https://sb.test/s/v"],
    ["x", null],
  ]);
  const preview = { thumbs, onPreview: () => {} };
  const files = [f("d", "자료.pdf"), f("p", "구성도.png", "image/png"), f("v", "흐름.svg", "image/svg+xml"), f("x", "깨짐.png", "image/png"), f("w", "받는중.webp", "image/webp")];
  it("그림 줄만 56×56 썸네일 버튼(이름 크게 보기), 서명이 없거나 받는 중이면 IMG 배지", () => {
    const d = html({ files, onOpen: () => {}, preview });
    const btns = [...d.querySelectorAll('button[aria-label$="크게 보기"]')];
    expect(btns.map((b) => b.getAttribute("aria-label"))).toEqual(["구성도.png 크게 보기", "흐름.svg 크게 보기"]);
    expect(btns[0].className).toContain("h-14 w-14");
    expect(btns[0].querySelector("img")?.getAttribute("src")).toBe("https://sb.test/s/p");
    expect(btns[0].querySelector("img")?.className).toContain("object-cover");
    expect(d.textContent).toContain("PDF");
    expect(d.textContent?.match(/IMG/g)).toHaveLength(2); // 깨짐·받는중
  });
  it("SVG 는 object-contain + 흰 바탕, 그림은 <img> 로만", () => {
    const d = html({ files, onOpen: () => {}, preview });
    const b = d.querySelector('button[aria-label="흐름.svg 크게 보기"]')!;
    expect(b.className).toContain("bg-white");
    expect(b.querySelector("img")?.className).toContain("object-contain");
    // 파일 SVG 를 문서에 심지 않는다 — 눌러서 확대 힌트의 장식 아이콘(aria-hidden)만 있다
    expect(d.querySelectorAll("svg:not([aria-hidden]), object, embed, iframe").length).toBe(0);
  });
  it("썸네일에 「눌러서 확대」 돋보기 — 손가락 화면만(pointer-coarse), 장식", () => {
    const d = html({ files, onOpen: () => {}, preview });
    const hint = d.querySelector('button[aria-label="흐름.svg 크게 보기"] > span[aria-hidden="true"]')!;
    expect(hint.className).toMatch(/\bhidden\b.*pointer-coarse:flex/);
    expect(hint.className).toContain("pointer-events-none");
  });
  it("preview 가 없으면(편집 등) 지금처럼 배지만", () => {
    const d = html({ files, onOpen: () => {} });
    expect(d.querySelector("img")).toBeNull();
    expect(d.textContent?.match(/IMG/g)).toHaveLength(4);
  });
});
