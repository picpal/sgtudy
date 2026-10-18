// @vitest-environment jsdom
// Q1-5·Q2-5: 누르는 영역 44px — 보이는 크기는 그대로 두고 가상 요소(before:h-11)나 높이(h-11)로 영역만 키운다.
// jsdom 은 레이아웃을 계산하지 않으므로 "44px 영역을 만드는 클래스가 있는가"를 본다.
import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import type { Me } from "@/lib/api/types";
import { Chip, PillButton, Seg } from "./bits";
import { CalendarTab } from "./tabs/CalendarTab";
import { GanttTab } from "./tabs/GanttTab";
import { Toolbar } from "@/components/schedule/Toolbar";
import { EMPTY_OVERRIDES, buildTree } from "./model";
import { TreeRow } from "./tabs/TreeRow";
import { INITIAL_STATE } from "./state";
import { AWS, CHULSU, REF_DAY } from "./fixtures";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const me = { id: CHULSU, nickname: "철수" } as Me;

const dom = (el: ReturnType<typeof createElement>) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(el);
  return root;
};
const inCtx = (child: ReturnType<typeof createElement>) =>
  createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, child));

/** 44px 영역을 만드는 클래스: 가상 요소 높이 11(=44px) 또는 요소 자체 높이 11 이상 */
const hit44 = (b: Element) => b.classList.contains("before:h-11") || b.classList.contains("h-11") || b.classList.contains("min-h-11");
const names = (bs: Element[]) => bs.map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
const lacking = (bs: Element[]) => names(bs.filter((b) => !hit44(b)));

describe("bits — 누르는 영역 44px", () => {
  it("Seg: 모든 세그 버튼", () => {
    const d = dom(createElement(Seg<"a" | "b">, { label: "x", value: "a", onChange: () => {}, options: [["a", "가"], ["b", "나"]] }));
    expect(lacking([...d.querySelectorAll("button")])).toEqual([]);
  });
  it("Chip · PillButton", () => {
    const c = dom(createElement(Chip, { on: false, onClick: () => {} } as ComponentProps<typeof Chip>, "칩"));
    const p = dom(createElement(PillButton, { onClick: () => {} } as ComponentProps<typeof PillButton>, "모두 펼치기"));
    expect(lacking([...c.querySelectorAll("button"), ...p.querySelectorAll("button")])).toEqual([]);
  });
});

describe("진행목표 탭 보기·캘린더·간트 토글", () => {
  it("캘린더: 이전·다음·오늘·보기 단위·참가자 칩", () => {
    const d = dom(inCtx(createElement(CalendarTab, { tree, S: { ...INITIAL_STATE, tab: "calendar" as const }, update: () => {}, goLeaf: () => {} })));
    const btns = [...d.querySelectorAll("button")].filter((b) => b.closest('[aria-label="보기 단위"], [aria-label="참가자 필터"]') || ["이전", "다음"].includes(b.getAttribute("aria-label") ?? "") || b.textContent?.trim() === "오늘");
    expect(btns.length).toBeGreaterThanOrEqual(7);
    expect(lacking(btns)).toEqual([]);
  });
  it("캘린더: 일정 막대 버튼(보이는 26px) — 44px 영역, 줄 간격 18px 이상이라 위아래 막대 영역이 겹치지 않는다", () => {
    const d = dom(inCtx(createElement(CalendarTab, { tree, S: { ...INITIAL_STATE, tab: "calendar" as const }, update: () => {}, goLeaf: () => {} })));
    const bars = [...d.querySelectorAll("button[title]")].filter((b) => (b as HTMLElement).style.gridRow);
    expect(bars.length).toBeGreaterThan(0);
    expect(lacking(bars)).toEqual([]);
    const lanes = bars.map((b) => b.parentElement as HTMLElement);
    for (const g of new Set(lanes)) {
      expect(parseFloat(g.style.gridAutoRows)).toBe(26);                       // 보이는 높이 그대로
      expect(parseFloat(g.style.rowGap)).toBeGreaterThanOrEqual(44 - 26);
    }
  });
  it("간트: 확대 단위·칩·행 접기 chevron·행 버튼", () => {
    const d = dom(inCtx(createElement(GanttTab, { tree, S: { ...INITIAL_STATE, tab: "gantt" as const }, update: () => {}, goLeaf: () => {}, isLeader: false })));
    const btns = [...d.querySelectorAll("button")];
    expect(btns.length).toBeGreaterThan(5);
    expect(lacking(btns)).toEqual([]);
  });
});

describe("내 일정 툴바", () => {
  it("이전·다음·오늘·스터디 칩·보기 방식", () => {
    const studies = [{ id: "a", name: "AWS", dot: "#000", bg: "#fff", fg: "#000" }] as ComponentProps<typeof Toolbar>["studies"];
    const d = dom(createElement(Toolbar, { y: 2026, m: 9, view: "month", off: [], studies, onPrev: () => {}, onNext: () => {}, onToday: () => {}, onToggle: () => {}, onView: () => {} }));
    const btns = [...d.querySelectorAll("button")];
    expect(btns.length).toBe(1 + 2 + 1 + 2);
    expect(lacking(btns)).toEqual([]);
  });
});

describe("진행목표 목록 행", () => {
  it("회차 접기 chevron = 높이 44px 영역(보이는 아이콘 14px 그대로)", () => {
    const n = tree.roots[0];
    const d = dom(createElement("div", { role: "tree" }, createElement(TreeRow, { n, isEdit: false, open: true, onToggle: () => {}, onClick: () => {} })));
    const chev = d.querySelector('button[aria-label$="접기"]')!;
    expect(chev).toBeTruthy();
    expect(lacking([chev])).toEqual([]);
  });
});
