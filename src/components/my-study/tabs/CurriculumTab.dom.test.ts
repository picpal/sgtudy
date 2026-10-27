// @vitest-environment jsdom
// 진행목표 「이번 회차로」 — 오늘이 든 회차가 있을 때만 보이고, 누르면 그 회차를 펼쳐 그 행으로 스크롤·포커스한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import type { Me } from "@/lib/api/types";
import { CurriculumTab } from "./CurriculumTab";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { INITIAL_STATE, type ScreenState } from "../state";
import type { CurriculumApi } from "../useCurriculumApi";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me = { id: CHULSU, nickname: "철수" } as Me;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let scrolled: Element[] = [];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

function mount(today: string, start: Partial<ScreenState> = {}, canEdit = false) {
  const tree = buildTree(AWS, EMPTY_OVERRIDES, today);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const Live = () => {
    const [S, setS] = useState<ScreenState>({ ...INITIAL_STATE, tab: "curriculum" as const, ...start });
    const update = ((p: Partial<ScreenState> | ((o: ScreenState) => Partial<ScreenState>)) => setS((o) => ({ ...o, ...(typeof p === "function" ? p(o) : p) }))) as ComponentProps<typeof CurriculumTab>["update"];
    return createElement(CurriculumTab, {
      tree,
      S,
      update,
      api: { recheckEdit: async () => true } as unknown as CurriculumApi,
      canEdit,
      isLeader: canEdit,
      period: { start: "2026-09-01", end: "2026-12-31" },
      slug: "aws",
      roomStatus: "active",
      viewerPending: false,
      toast: () => {},
    });
  };
  act(() => root!.render(createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today } as ComponentProps<typeof TodayProvider>, createElement(Live)))));
  return { host, tree };
}
const goBtn = (h: HTMLElement) => h.querySelector<HTMLButtonElement>("[data-go-round]");

describe("CurriculumTab 이번 회차로", () => {
  it("오늘이 든 회차가 있으면 버튼이 보이고, 누르면 접힌 그 회차를 펼쳐 회차 행으로 스크롤·포커스", () => {
    const { host, tree } = mount(REF_DAY);
    const cur = tree.roots.find((r) => r.s <= REF_DAY && REF_DAY <= r.e)!;
    // 일부러 접어 둔다 — 「모두 접기」
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent === "모두 접기")!.click());
    expect(host.querySelector(`[data-node="${cur.id}"]`)!.getAttribute("aria-expanded")).toBe("false");
    const b = goBtn(host)!;
    expect(b.getAttribute("aria-label")).toContain(cur.label || cur.title);
    act(() => b.click());
    const row = host.querySelector(`[data-node="${cur.id}"]`)!;
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(scrolled).toEqual([host.querySelector(`[data-round-anchor="${cur.id}"]`)]);
    expect(document.activeElement).toBe(row.querySelector("[data-row-main]"));
  });

  it("편집 모드에서도 보인다", () => {
    const { host } = mount(REF_DAY, { curMode: "edit" }, true);
    expect(host.querySelector('[role="tree"]')).not.toBeNull();
    expect(goBtn(host)).not.toBeNull();
  });

  it("시작 전·종료 뒤(오늘이 든 회차 없음)에는 숨긴다", () => {
    expect(goBtn(mount("2020-01-01").host)).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    expect(goBtn(mount("2099-01-01").host)).toBeNull();
  });
});
