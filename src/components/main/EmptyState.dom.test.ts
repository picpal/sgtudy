// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "./EmptyState";

const labels = (q: string, status: "all" | "recruit", tagLabels: string[]) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(EmptyState, { q, tab: "public", status, tagLabels, onReset: () => {}, onClearQuery: () => {}, onBrowse: () => {} }));
  return Array.from(root.querySelectorAll("button")).map((b) => b.textContent);
};

describe("EmptyState 초기화 버튼 (Q3-5)", () => {
  it("검색어만: '검색어 지우기'", () => expect(labels("aws", "all", [])).toEqual(["검색어 지우기"]));
  it("검색어 + 필터: 둘 다 지운다고 말한다", () => expect(labels("aws", "recruit", ["SQL"])).toEqual(["필터·검색어 초기화"]));
  it("필터만: 필터 초기화", () => expect(labels("", "recruit", [])).toEqual(["필터 초기화"]));
});
