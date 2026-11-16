// @vitest-environment jsdom
// 간트 행 상태 표시 — 캘린더와 같은 꼴: 가장 급한 아이콘 하나 + 막대 밑줄(상태별 몫) + 이름·막대에 상태별 인원
import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import type { Me } from "@/lib/api/types";
import { GanttTab } from "./GanttTab";
import { EMPTY_OVERRIDES, buildTree, statusBreakdown, urgentCode, type LeafNode, type TreeNode } from "../model";
import { INITIAL_STATE } from "../state";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

const me = { id: CHULSU, nickname: "철수" } as Me;
const leavesOf = (t: ReturnType<typeof buildTree>) => {
  const out: LeafNode[] = [];
  const walk = (n: TreeNode): void => void (n.leaf ? out.push(n) : n.kids.forEach(walk));
  t.roots.forEach(walk);
  return out;
};
/** 팀 과제마다 사람을 n 명으로 늘린 트리 — 상태는 원래 사람들 것을 돌려 쓴다 */
const treeWith = (n: number) => {
  const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
  for (const l of leavesOf(t)) {
    if (!l.people.length || l.personal) continue;
    const base = l.people;
    l.people = Array.from({ length: n }, (_, i) => ({ ...base[i % base.length], userId: `u${i}`, name: `사람${i}` }));
  }
  return t;
};
const render = (tree: ReturnType<typeof buildTree>) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(GanttTab, { tree, S: { ...INITIAL_STATE, tab: "gantt" as const, othersPersonal: true }, update: () => {}, goLeaf: () => {}, isLeader: false }))),
  );
  return root;
};

describe.each([3, 10, 20])("간트 행 상태 표시 — %i명", (n) => {
  it("팀 과제: 아이콘 하나(가장 급한 상태)·이름 버튼과 막대에 상태별 인원 / 모든 리프: 막대 밑줄 100%, \"+N\" 없음", () => {
    const tree = treeWith(n);
    const byId = new Map(leavesOf(tree).map((l) => [String(l.id), l]));
    const rows = [...render(tree).querySelectorAll<HTMLElement>("[data-gantt-row]")].filter((r) => byId.get(r.dataset.ganttRow!)?.people.length);
    expect(rows.some((r) => !byId.get(r.dataset.ganttRow!)!.personal)).toBe(true);
    for (const r of rows) {
      const l = byId.get(r.dataset.ganttRow!)!;
      const codes = l.people.map((p) => p.c);
      const label = statusBreakdown(l, codes);
      const bar = r.querySelector<HTMLElement>("[data-bar]")!;
      // 개인 목표는 1명이라 기존 문구(「개인 목표 · 기한내 완료」)를 그대로 쓴다
      if (!l.personal) {
        expect(bar.title).toContain(label);
        expect(r.querySelector("button")!.getAttribute("aria-label")).toContain(label);
      }
      expect(r.textContent).not.toMatch(/\+\d/);
      const shares = bar.querySelectorAll<HTMLElement>("[data-share] > *");
      expect([...shares].reduce((s, x) => s + parseFloat(x.style.width), 0)).toBeCloseTo(100, 6);
      if (!l.personal) {
        expect(r.querySelectorAll("[data-status] svg").length).toBe(1);
        expect(r.querySelector("[data-status]")?.getAttribute("data-status")).toBe(urgentCode(codes));
        // 이름 버튼 aria-label 이 상태별 인원을 이미 말한다 — 옆 아이콘이 따로 읽히면 두 번 들린다
        expect(r.querySelector('[role="img"]')).toBeNull();
      } else {
        expect(r.querySelector("[data-status]")).toBeNull();
      }
      // 주 단위(하루 = 10px)에서도 밑줄이 0 폭이 되지 않게 — 막대 폭에 비례해 줄어드는 여백
      expect(bar.querySelector("[data-share]")!.className).not.toMatch(/inset-x-\[\d+px\]/);
    }
  });
});
