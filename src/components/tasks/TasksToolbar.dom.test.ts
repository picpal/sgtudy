// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MeTaskStudy } from "@/lib/api/types";
import { DEFAULT_FILTER } from "./calc";
import { TasksToolbar } from "./TasksToolbar";

const st = (slug: string, title: string): MeTaskStudy => ({ slug, title, tone: "mint", status: "active", membership: "joined", currentRoundId: null, canAddPersonal: true });
const render = (filter = DEFAULT_FILTER) => {
  const d = document.createElement("div");
  d.innerHTML = renderToStaticMarkup(createElement(TasksToolbar, { filter, studies: [st("a", "AWS"), st("b", "CS")], onChange: () => {} }));
  return d;
};

describe("TasksToolbar (QA Q1-6 · Q3-9)", () => {
  it("범위·유형·스터디의 '전체' 를 서로 다른 말로", () => {
    const d = render();
    const texts = Array.from(d.querySelectorAll("button")).map((b) => b.textContent);
    expect(texts).toContain("전체 회차");
    expect(texts).toContain("모든 유형모든 유형"); // 넓은/좁은 폭 두 조각
    expect(texts).toContain("모든 스터디");
    expect(texts).not.toContain("전체");
  });
  it("모든 칩·세그 버튼은 모든 폭에서 44px(h-11), 완료 숨기기 라벨도 44px", () => {
    const d = render();
    for (const b of Array.from(d.querySelectorAll("button"))) expect(b.className).toMatch(/(^|\s)h-11(\s|$)/);
    expect(d.querySelector("input[type=checkbox]")!.closest("label")!.className).toContain("min-h-11");
  });
  it("스터디 줄은 390 에서도 '스터디' 머리말이 보인다", () => {
    const d = render();
    const head = Array.from(d.querySelectorAll("[role=group][aria-label=스터디] span")).find((s) => s.textContent === "스터디")!;
    expect(head.className).not.toContain("max-sm:hidden");
  });
  it("보기 Seg 「과제 · 오답노트」 가 맨 앞 — 오답노트 보기는 기간·묶기·유형·완료 숨기기 없이 스터디 칩만", () => {
    const d = render();
    const view = d.querySelector("[role=group][aria-label=보기]")!;
    expect(d.querySelector("[role=group]")).toBe(view);
    expect(Array.from(view.querySelectorAll("button")).map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["과제", "true"], ["오답노트", "false"]]);
    const n = render({ ...DEFAULT_FILTER, view: "notes" });
    expect(n.querySelector("[aria-label=보기] button[aria-pressed=true]")!.textContent).toBe("오답노트");
    for (const g of ["기간", "묶기", "유형"]) expect(n.querySelector(`[aria-label=${g}]`)).toBeNull();
    expect(n.querySelector("select")).toBeNull();
    expect(n.textContent).not.toContain("완료 숨기기");
    expect(n.querySelector("[aria-label=스터디]")!.textContent).toContain("모든 스터디");
  });
});
