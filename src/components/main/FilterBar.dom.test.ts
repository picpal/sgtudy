// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar } from "./FilterBar";

const render = (tags: string[]) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(FilterBar, {
      tab: "public", tabCounts: { public: 3, mine: 0, created: 0 }, onTab: () => {}, status: "all", onStatus: () => {},
      tagCounts: [{ slug: "aws", tag: "AWS", count: 2 }, { slug: "sql", tag: "SQL", count: 1 }], tags, onToggleTag: () => {}, onResetTags: () => {},
    }),
  );
  return root;
};

describe("FilterBar 태그 안내 (Q3-4)", () => {
  it("태그를 둘 이상 고르면 '하나라도 있는 방' 이라는 OR 안내가 보인다", () => {
    expect(render(["aws", "sql"]).querySelector("[data-tag-hint]")?.textContent).toContain("하나라도");
  });
  it("0~1개일 때는 안내가 없다", () => {
    expect(render([]).querySelector("[data-tag-hint]")).toBeNull();
    expect(render(["aws"]).querySelector("[data-tag-hint]")).toBeNull();
  });
});

// 누르는 영역 44px — 보이는 크기(상태 칩 34px·태그 칩 32px)는 그대로, 가상 요소(before:h-11)로 영역만 키운다(bits.tsx 와 같은 방식).
// 줄바꿈되면 위아래 칩 영역이 겹치지 않도록 세로 간격 ≥ 44 − 보이는 높이
describe("FilterBar 누르는 영역 44px", () => {
  const hit44 = (b: Element) => b.classList.contains("before:h-11");
  it("상태 칩·태그 칩·초기화 버튼은 모두 44px 영역, 보이는 높이는 그대로", () => {
    const d = render(["aws"]);
    const status = [...d.querySelectorAll('[aria-label="상태 필터"] button')];
    const tag = [...d.querySelectorAll('[aria-label="태그 필터"] button')];
    expect(status.length).toBe(4);
    expect(tag.length).toBe(3);                                                // 태그 2 + 초기화
    expect([...status, ...tag].filter((b) => !hit44(b)).map((b) => b.textContent)).toEqual([]);
    expect(status.every((b) => b.classList.contains("h-[34px]"))).toBe(true);
    expect(tag.every((b) => b.classList.contains("h-8"))).toBe(true);
  });
  it("줄바꿈 간격: 상태 칩 줄 ≥ 10px(44−34), 태그 칩 줄 ≥ 12px(44−32)", () => {
    const d = render([]);
    expect(d.querySelector('[aria-label="상태 필터"]')!.classList.contains("gap-y-[10px]")).toBe(true);
    expect(d.querySelector('[aria-label="태그 필터"]')!.classList.contains("gap-y-3")).toBe(true);
  });
});
