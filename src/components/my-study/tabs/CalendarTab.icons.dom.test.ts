// @vitest-environment jsdom
// 막대 끝 상태 표시 — 인원이 늘어도 폭이 같아야 한다(가장 급한 아이콘 하나 + 막대 폭을 쓰는 밑줄).
// 예전엔 아이콘 3개 + "+N" 이 좁은 칸(모바일 일요일 1칸 조각 등) 밖으로 삐져 옆 막대를 덮었고, 넓은 칸에선 "+N" 뒤에 미제출이 숨었다.
// jsdom 은 레이아웃을 계산하지 않는다 — 실제 폭 측정은 verify-sgtudy 증거(측정 스크립트)에 있다.
import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import type { Me } from "@/lib/api/types";
import { CalendarTab } from "./CalendarTab";
import { EMPTY_OVERRIDES, buildTree, statusBreakdown, urgentCode, type Code, type LeafNode, type TreeNode } from "../model";
import { INITIAL_STATE, type ScreenState } from "../state";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

const me = { id: CHULSU, nickname: "철수" } as Me;
const leavesOf = (t: ReturnType<typeof buildTree>) => {
  const out: LeafNode[] = [];
  const walk = (n: TreeNode): void => void (n.leaf ? out.push(n) : n.kids.forEach(walk));
  t.roots.forEach(walk);
  return out;
};
/** 담당자가 있는 과제마다 사람을 n 명으로 늘린 트리 — 상태는 원래 사람들 것을 돌려 쓴다 */
const treeWith = (n: number) => {
  const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
  for (const l of leavesOf(t)) {
    if (!l.people.length) continue;
    const base = l.people;
    l.people = Array.from({ length: n }, (_, i) => ({ ...base[i % base.length], userId: `u${i}`, name: `사람${i}` }));
  }
  return t;
};
const render = (tree: ReturnType<typeof buildTree>, S: Partial<ScreenState> = {}) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(
    createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(CalendarTab, { tree, S: { ...INITIAL_STATE, tab: "calendar" as const, ...S }, update: () => {}, goLeaf: () => {} }))),
  );
  return root;
};

describe("urgentCode — 막대 끝 아이콘 하나로 보일 상태", () => {
  it("미제출 > 진행 > 예정 > 지각 제출 > 기한내 제출", () => {
    expect(urgentCode(["D", "L", "O", "M"])).toBe("M");
    expect(urgentCode(["D", "P", "O"])).toBe("O");
    expect(urgentCode(["D", "L", "P"])).toBe("P");
    expect(urgentCode(["D", "L", "D"])).toBe("L");
    expect(urgentCode(["D"])).toBe("D");
    expect(urgentCode([])).toBeNull();
  });
});

describe("statusBreakdown — 막대 aria·title 의 상태별 인원", () => {
  it("상태 문구 순서대로, 0명은 뺀다", () => {
    const codes: Code[] = ["O", "D", "D", "M", "D", "L", "D", "O", "D", "D"];
    expect(statusBreakdown({ personal: false }, codes)).toBe("10명 중 기한내 제출 6, 지각 제출 1, 미제출 1, 진행중 2");
    expect(statusBreakdown({ personal: true }, ["M"])).toBe("1명 중 기한 지남 1");
  });
});

describe.each([3, 10, 20])("캘린더 막대 상태 표시 — %i명", (n) => {
  const tree = treeWith(n);
  const people = new Map(leavesOf(tree).map((l) => [String(l.id), l]));
  for (const [view, S] of [["월간", { calMode: "month" as const }], ["주간", { calMode: "week" as const }]] as const) {
    it(`${view}: 끝 조각엔 아이콘이 꼭 하나(가장 급한 상태), 모든 조각에 100% 로 나뉜 밑줄, aria·title 에 상태별 인원`, () => {
      const bars = [...render(tree, S).querySelectorAll<HTMLElement>("[data-cal-bar]")].filter((b) => people.get(b.dataset.calBar!)?.people.length);
      expect(bars.length).toBeGreaterThan(0);
      for (const b of bars) {
        const l = people.get(b.dataset.calBar!)!;
        const codes = l.people.map((p) => p.c);
        const label = statusBreakdown(l, codes);
        expect(b.getAttribute("aria-label")).toContain(label);
        expect(b.title).toContain(label);
        expect(b.textContent).not.toMatch(/\+\d/);

        const shares = b.querySelectorAll<HTMLElement>("[data-share] > *");
        expect(shares.length).toBeGreaterThan(0);
        expect([...shares].reduce((s, x) => s + parseFloat(x.style.width), 0)).toBeCloseTo(100, 6);

        const icons = b.querySelectorAll("svg");
        if (icons.length > 0) {
          expect(icons.length).toBe(1);
          expect(b.querySelector("[data-status]")?.getAttribute("data-status")).toBe(urgentCode(codes));
          // 막대 aria-label 이 상태별 인원을 이미 말한다 — 아이콘이 따로 읽히면 두 번 들린다
          expect(icons[0].getAttribute("aria-hidden")).toBe("true");
          expect(b.querySelector('[role="img"]')).toBeNull();
        }
      }
      expect(bars.some((b) => b.querySelectorAll("svg").length === 1)).toBe(true);
      // 여러 주에 걸친 과제: 아이콘은 마지막(끝) 조각에만, 밑줄은 모든 조각에
      const pieces = Map.groupBy(bars, (b) => b.dataset.calBar!);
      const multi = [...pieces.values()].filter((ps) => ps.length > 1);
      if (view === "월간") expect(multi.length).toBeGreaterThan(0);
      for (const ps of multi) {
        ps.slice(0, -1).forEach((b) => expect(b.querySelector("svg")).toBeNull());
        ps.forEach((b) => expect(b.querySelector("[data-share]")).not.toBeNull());
      }
    });
  }
});

describe("참가자 필터(calWho) — 그 사람 상태만", () => {
  it("아이콘·밑줄·aria 가 고른 사람 하나 기준", () => {
    const tree = treeWith(10);
    const leaves = leavesOf(tree);
    const who = leaves.find((l) => !l.personal && l.people.length)!.people[0].userId;
    const byId = new Map(leaves.map((l) => [String(l.id), l]));
    const bars = [...render(tree, { calWho: who }).querySelectorAll<HTMLElement>("[data-cal-bar]")].filter((b) => !byId.get(b.dataset.calBar!)!.personal);
    expect(bars.length).toBeGreaterThan(0);
    for (const b of bars) {
      const l = byId.get(b.dataset.calBar!)!;
      const mine = l.people.find((p) => p.userId === who)!.c;
      expect(b.getAttribute("aria-label")).toContain(statusBreakdown(l, [mine]));
      expect(b.querySelectorAll("[data-share] > *").length).toBe(1);
      const st = b.querySelector("[data-status]");
      if (st) expect(st.getAttribute("data-status")).toBe(mine);
    }
  });
});

describe("범례", () => {
  it("개인 목표도 아이콘을 받으므로 「제출」 상태로만 부르지 않는다", () => {
    const legend = [...render(treeWith(3)).querySelectorAll("span")].find((s) => s.textContent?.startsWith("· 막대 끝 아이콘"))!;
    expect(legend.textContent).not.toMatch(/제출 상태/);
  });
});
