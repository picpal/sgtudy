// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownEditor } from "./MarkdownEditor";

/** jsdom 은 레이아웃이 없다 — 누르는 자리를 정하는 클래스로 본다. 실측(elementFromPoint)은 브라우저에서 */
const render = (expandable: boolean) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(MarkdownEditor, { value: "", onChange: () => {}, label: "설명", expandable }));
  return root;
};
const cls = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

// 서식 툴바 — 버튼 상자 자체가 44×44, 버튼 사이·줄 사이 틈 0 (::before 로 넓힌 영역이 이웃과 겹치면 실제로는 28~36px 만 그 버튼 몫이었다)
describe("MarkdownEditor 툴바 누르는 자리 44px", () => {
  it("툴바의 모든 버튼(서식·크게 쓰기)이 44×44 상자, 겹치는 ::before 확장 없음", () => {
    const root = render(true);
    const bars = root.querySelectorAll("[role=toolbar]");
    expect(bars.length).toBe(2); // 본 편집 면 + 크게 쓰기 창
    const btns = Array.from(root.querySelectorAll("[role=toolbar] button"));
    expect(btns.length).toBeGreaterThan(15);
    for (const b of btns) {
      expect(cls(b), b.getAttribute("aria-label") ?? "").toEqual(expect.arrayContaining(["h-11", "w-11", "shrink-0"]));
      expect(cls(b).some((c) => c.startsWith("before:"))).toBe(false);
    }
  });
  it("버튼 사이·줄 사이 틈 0 — 줄바꿈해도 누르는 자리가 겹치거나 빈 곳이 없다", () => {
    const root = render(false);
    const bar = root.querySelector("[role=toolbar]")!;
    expect(cls(bar)).toEqual(expect.arrayContaining(["gap-0", "py-0"]));
    root.querySelectorAll("[role=toolbar] [role=group]").forEach((g) => expect(cls(g)).toContain("gap-0"));
  });
  it("크게 쓰기 창 '완료' 버튼도 44px 높이", () => {
    const done = Array.from(render(true).querySelectorAll("dialog button")).find((b) => b.textContent === "완료")!;
    expect(cls(done)).toContain("h-11");
  });
});
