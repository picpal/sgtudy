// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MyPersonalLine } from "./OverviewTab";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, CHULSU, JIEUN, REF_DAY } from "../fixtures";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const render = (userId: string, roundId: string) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(MyPersonalLine, { tree, userId, roundId, slug: "aws" }));
  return root;
};

describe("OverviewTab 내 카드 개인 목표 줄", () => {
  it("이번 회차 d/t 완료 · 내 과제(/tasks?study=slug) 링크", () => {
    const doc = render(JIEUN, "3");
    expect(doc.textContent).toContain("개인 목표 이번 회차 1/1 완료");
    expect(doc.querySelector("a")?.getAttribute("href")).toBe("/tasks?study=aws");
    expect(render(CHULSU, "3").textContent).toContain("0/1 완료");
  });
  it("그 회차에 없으면 안내 문구", () => {
    expect(render(JIEUN, "2").textContent).toContain("이번 회차 개인 목표가 아직 없어요");
  });
});
