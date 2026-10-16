// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import type { Me } from "@/lib/api/types";
import { GanttTab } from "./GanttTab";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { INITIAL_STATE, type ScreenState } from "../state";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const me = { id: CHULSU, nickname: "철수" } as Me;

function render(patch: Partial<ScreenState> = {}, isLeader = false) {
  const S = { ...INITIAL_STATE, tab: "gantt" as const, ...patch };
  const html = renderToStaticMarkup(
    // children 은 세 번째 인자로 — props 타입의 children 필수만 단언으로 맞춘다
    createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(GanttTab, { tree, S, update: () => {}, goLeaf: () => {}, isLeader }))),
  );
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}
const rowIds = (doc: HTMLElement) => Array.from(doc.querySelectorAll<HTMLElement>("[data-gantt-row]")).map((r) => r.dataset.ganttRow);

describe("GanttTab 개인 목표", () => {
  it("기본: 내 개인 목표만, 회차 안 팀 과제 다음 · 남의 것 숨김", () => {
    const ids = rowIds(render());
    expect(ids.filter((id) => ["3", "31", "311", "32", "33"].includes(id!))).toEqual(["3", "31", "311", "32"]);
  });
  it("팀원 목표 켜면 남의 개인 목표가 내 것 뒤에 · 소유자 이름 표시", () => {
    const doc = render({ othersPersonal: true });
    const ids = rowIds(doc);
    expect(ids.filter((id) => ["3", "31", "311", "32", "33"].includes(id!))).toEqual(["3", "31", "311", "32", "33"]);
    const other = doc.querySelector('[data-gantt-row="33"]')!;
    expect(other.querySelector("[data-owner]")?.textContent).toContain("지은");
    expect(doc.querySelector('[data-gantt-row="32"] [data-owner]')).toBeNull();
  });
  it("개인 막대 = 점선 slate, data-personal · 팀 막대는 아님", () => {
    const doc = render();
    const bar = doc.querySelector<HTMLElement>('[data-gantt-row="32"] [data-bar]')!;
    expect(bar.dataset.personal).toBe("true");
    expect(bar.style.border).toContain("dashed");
    expect(doc.querySelector<HTMLElement>('[data-gantt-row="311"] [data-bar]')!.dataset.personal).toBeUndefined();
  });
  it("개인 막대 툴팁 상태 = 내 과제·진행목표와 같은 문구(codeLabel)", () => {
    const doc = render({ othersPersonal: true });
    expect(doc.querySelector('[data-gantt-row="33"] [title]')!.getAttribute("title")).toContain("기한내 완료");
    expect(doc.querySelector('[data-gantt-row="32"] [title]')!.getAttribute("title")).toContain("예정");
  });
  it("두 칩 = 진행목표와 같은 state (aria-pressed)", () => {
    const doc = render({ mineOnly: true });
    const chips = Array.from(doc.querySelectorAll('[aria-label="보기 필터"] button'));
    expect(chips.map((c) => [c.textContent, c.getAttribute("aria-pressed")])).toEqual([["내 것만", "true"], ["팀원 목표", "false"]]);
  });
  it("회차 pct 는 팀만 (개인 제외)", () => {
    const doc = render({ othersPersonal: true });
    expect(doc.querySelector('[data-gantt-row="3"] [data-pct]')!.textContent).toBe("0%");
    expect(doc.querySelector('[data-gantt-row="1"] [data-pct]')!.textContent).toBe(`${tree.roots[0].pct}%`);
  });
});
