// @vitest-environment jsdom
// 막대 끝 상태 아이콘 — 좁은 칸(모바일 일요일 1칸 조각 등)에서 3개 + "+N" 이 막대 밖으로 삐져 옆 막대를 덮던 버그.
// jsdom 은 컨테이너 쿼리를 계산하지 않으므로 "좁을 때 보일 한 개"와 "넓을 때만 보일 전체"가 같이 그려지는지를 본다.
// 실제 폭 측정은 verify-sgtudy 증거(측정 스크립트)에 있다.
import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import type { Me } from "@/lib/api/types";
import { CalendarTab } from "./CalendarTab";
import { statusLabelOf } from "../bits";
import { CODE_STATUS, EMPTY_OVERRIDES, buildTree, urgentCode, type LeafNode, type TreeNode } from "../model";
import { INITIAL_STATE } from "../state";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const leaves: LeafNode[] = [];
const walk = (n: TreeNode): void => void (n.leaf ? leaves.push(n) : n.kids.forEach(walk));
tree.roots.forEach(walk);
const me = { id: CHULSU, nickname: "철수" } as Me;
const render = () => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(CalendarTab, { tree, S: { ...INITIAL_STATE, tab: "calendar" as const }, update: () => {}, goLeaf: () => {} }))),
  );
  return root;
};

describe("urgentCode — 좁은 칸에 하나만 보일 때 고르는 상태", () => {
  it("기한 지남 > 진행 > 예정 > 늦게 완료 > 완료", () => {
    expect(urgentCode(["D", "L", "O", "M"])).toBe("M");
    expect(urgentCode(["D", "P", "O"])).toBe("O");
    expect(urgentCode(["D", "L", "P"])).toBe("P");
    expect(urgentCode(["D", "L", "D"])).toBe("L");
    expect(urgentCode(["D"])).toBe("D");
    expect(urgentCode([])).toBeNull();
  });
});

describe("캘린더 막대 끝 상태 아이콘", () => {
  it("막대가 폭 컨테이너이고, 여럿이면 전체는 넓을 때만 · 좁을 땐 가장 급한 하나만", () => {
    const bars = [...render().querySelectorAll<HTMLElement>("[data-cal-bar]")];
    const withIcons = bars.filter((b) => b.querySelector('svg[role="img"]'));
    const multi = withIcons.filter((b) => b.querySelectorAll('[data-cal-icons="all"] svg[role="img"]').length > 1);
    expect(multi.length).toBeGreaterThan(0);
    for (const b of withIcons) expect(b.classList).toContain("@container");
    for (const b of multi) {
      const all = b.querySelector('[data-cal-icons="all"]')!;
      const one = b.querySelector('[data-cal-icons="one"]')!;
      expect(all.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(all.className).toMatch(/@\[\d+px\]:flex/);
      expect(one.className).toMatch(/@\[\d+px\]:hidden/);
      expect(one.querySelectorAll('svg[role="img"]').length).toBe(1);
      expect(one.textContent).not.toMatch(/\+/);
      // "+N" 로 가려진 사람까지 포함해 고른다
      const leaf = leaves.find((l) => String(l.id) === b.dataset.calBar)!;
      expect(one.querySelector("svg")!.getAttribute("aria-label")).toBe(statusLabelOf(CODE_STATUS[urgentCode(leaf.people.map((p) => p.c))!]));
    }
  });
});
