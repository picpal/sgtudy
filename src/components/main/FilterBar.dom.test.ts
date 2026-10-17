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
