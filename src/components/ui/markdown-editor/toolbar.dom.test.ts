// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownEditor, Toolbar, revealLeft } from "./MarkdownEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
      // 스크롤 영역(overflow)에 잘리지 않게 포커스 링은 안쪽으로
      expect(cls(b)).toContain("focus-visible:-outline-offset-2");
    }
  });
  it("좁은 폭·터치만 한 줄 가로 스크롤, 데스크톱은 줄바꿈 — 크게 쓰기는 늘 스크롤 밖 오른쪽", () => {
    const root = render(true);
    const bar = root.querySelector("[role=toolbar]")!;
    expect(cls(bar)).not.toContain("flex-wrap");
    const scroller = bar.querySelector("[data-toolbar-scroll]")!;
    // 좁은 폭(max-sm)·터치(pointer-coarse)만 한 줄 + 가로 스크롤. 데스크톱 마우스는 줄바꿈으로 전부 보인다(숨긴 스크롤바엔 휠로 닿기 어렵다)
    expect(cls(scroller)).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1", "flex-wrap", "max-sm:flex-nowrap", "max-sm:overflow-x-auto", "pointer-coarse:flex-nowrap", "pointer-coarse:overflow-x-auto", "[scrollbar-width:none]"]),
    );
    expect(cls(scroller)).not.toContain("overflow-x-auto");
    expect(cls(scroller)).not.toContain("flex-nowrap");
    // 서식 버튼 15개는 스크롤 안, 크게 쓰기는 툴바의 마지막 직계 자식(스크롤 밖)
    expect(scroller.querySelectorAll("button").length).toBe(15);
    const expand = bar.querySelector("button[aria-label='크게 쓰기']")!;
    expect(scroller.contains(expand)).toBe(false);
    expect(bar.lastElementChild).toBe(expand);
    expect(cls(expand)).toContain("shrink-0");
    root.querySelectorAll("[role=toolbar] [role=group]").forEach((g) => expect(cls(g)).toEqual(expect.arrayContaining(["gap-0", "shrink-0"])));
  });
  it("크게 쓰기 창 '완료' 버튼도 44px 높이", () => {
    const done = Array.from(render(true).querySelectorAll("dialog button")).find((b) => b.textContent === "완료")!;
    expect(cls(done)).toContain("h-11");
  });
});

describe("revealLeft (방향키로 옮긴 버튼이 보이게 — 오른쪽 페이드 폭만큼 여유)", () => {
  const view = { left: 0, width: 200 };
  it("이미 다 보이면 그대로", () => expect(revealLeft(view, { left: 44, width: 44 }, 24)).toBe(0));
  it("오른쪽으로 가려지면 끝 + 여유가 보이게", () => expect(revealLeft(view, { left: 176, width: 44 }, 24)).toBe(44));
  it("왼쪽으로 가려지면 앞 - 여유, 0 아래로는 안 간다", () => {
    expect(revealLeft({ left: 300, width: 200 }, { left: 264, width: 44 }, 24)).toBe(240);
    expect(revealLeft({ left: 10, width: 200 }, { left: 0, width: 44 }, 24)).toBe(0);
  });
});

describe("Toolbar 키보드 이동 + 가로 스크롤", () => {
  it("End → 마지막 서식 버튼에 포커스 + 스크롤이 그 버튼까지 따라간다", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(Toolbar, { groups: [[{ cmd: "h1", label: "제목 1" }, { cmd: "h2", label: "제목 2" }, { cmd: "h3", label: "제목 3" }, { cmd: "bold", label: "굵게" }, { cmd: "italic", label: "기울임" }, { cmd: "strike", label: "취소선" }]], view: { current: null } })));
    const scroller = host.querySelector<HTMLElement>("[data-toolbar-scroll]")!;
    Object.defineProperty(scroller, "clientWidth", { value: 100 });
    const btns = Array.from(host.querySelectorAll<HTMLButtonElement>("button"));
    btns.forEach((b, i) => {
      Object.defineProperty(b, "offsetLeft", { value: i * 44 });
      Object.defineProperty(b, "offsetWidth", { value: 44 });
    });
    btns[0].focus();
    act(() => btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(btns[5]);
    expect(scroller.scrollLeft).toBe(5 * 44 + 44 - 100 + 24);
    act(() => btns[5].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(btns[0]);
    expect(scroller.scrollLeft).toBe(0);
    act(() => root.unmount());
    host.remove();
  });
});
