// @vitest-environment jsdom
// 캘린더 막대엔 사람별 상태(아이콘·밑줄·"N명 중 …")를 싣지 않는다 — 막대를 눌러 여는 팝오버에서 사람별로 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import type { Me } from "@/lib/api/types";
import { CalendarTab } from "./CalendarTab";
import { EMPTY_OVERRIDES, codeLabel, buildTree, type LeafNode, type TreeNode } from "../model";
import { INITIAL_STATE, type ScreenState } from "../state";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me = { id: CHULSU, nickname: "철수" } as Me;
const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const leaves: LeafNode[] = [];
const walk = (n: TreeNode): void => void (n.leaf ? leaves.push(n) : n.kids.forEach(walk));
tree.roots.forEach(walk);
const byId = new Map(leaves.map((l) => [String(l.id), l]));

function Harness({ init }: { init: Partial<ScreenState> }) {
  const [S, setS] = useState<ScreenState>({ ...INITIAL_STATE, tab: "calendar", ...init });
  return createElement(CalendarTab, { tree, S, update: (p: Partial<ScreenState>) => setS((s) => ({ ...s, ...p })), goLeaf: () => {} } as ComponentProps<typeof CalendarTab>);
}

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const mount = (init: Partial<ScreenState>) => {
  root = createRoot(host);
  act(() => root!.render(createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(Harness, { init })))));
  return [...host.querySelectorAll<HTMLButtonElement>("[data-cal-bar]")];
};

describe.each([["월간", "month"], ["주간", "week"]] as const)("캘린더 막대 — %s", (_, calMode) => {
  it("상태 아이콘·밑줄·「명 중」 인원 문구가 없다", () => {
    const bars = mount({ calMode });
    expect(bars.filter((b) => byId.get(b.dataset.calBar!)?.people.length).length).toBeGreaterThan(0);
    expect(bars.some((b) => byId.get(b.dataset.calBar!)?.personal)).toBe(true);
    for (const b of bars) {
      expect(b.querySelector("svg")).toBeNull();
      expect(b.querySelector("[data-status]")).toBeNull();
      expect(b.querySelector("[data-share]")).toBeNull();
      expect(b.getAttribute("aria-label") ?? "").not.toContain("명 중");
      expect(b.title).not.toContain("명 중");
      const l = byId.get(b.dataset.calBar!)!;
      expect(b.title).toContain(l.title);
      expect([l.title, `${l.title} (계속)`].map((t) => `${l.personal ? "[개인] " : ""}${t}`)).toContain(b.getAttribute("aria-label"));
    }
  });
});

describe("막대를 누르면", () => {
  it("팝오버가 열리고 사람마다 상태를 보인다", () => {
    const bar = mount({ calMode: "month" }).find((b) => (byId.get(b.dataset.calBar!)?.people.length ?? 0) > 1)!;
    const l = byId.get(bar.dataset.calBar!)!;
    act(() => bar.click());
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dlg).not.toBeNull();
    const rows = [...dlg.querySelectorAll("li")];
    expect(rows).toHaveLength(l.people.length);
    l.people.forEach((p, i) => {
      expect(rows[i].textContent).toContain(p.name);
      expect(rows[i].textContent).toContain(codeLabel(l, p.c));
    });
  });
});

describe("범례", () => {
  it("아이콘·밑줄 설명이 없다", () => {
    mount({});
    expect(host.textContent).not.toContain("막대 끝 아이콘");
    expect(host.textContent).not.toContain("밑줄");
  });
});
