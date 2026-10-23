// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { followDelta, isNear, scrollStep, useFollowBottom, viewBottom } from "./follow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("따라가기 계산", () => {
  it("보이는 아래 끝 = 막대 윗변과 화면 끝 중 위", () => {
    expect(viewBottom(700, 800)).toBe(700);
    expect(viewBottom(700, 500)).toBe(500); // 키보드가 올라와 visualViewport 가 더 짧다
    expect(viewBottom(null, 800)).toBe(800);
  });
  it("내릴 거리 — 막대에 가려진 만큼 + 여백, 이미 보이면 0 이하", () => {
    expect(followDelta(900, 700, 12)).toBe(212);
    expect(followDelta(600, 700, 12)).toBe(-88);
  });
  it("하단 근처 = 80px 안쪽만 가려짐", () => {
    expect(isNear(780, 700)).toBe(true);
    expect(isNear(781, 700)).toBe(false);
    expect(isNear(300, 700)).toBe(true);
  });
  it("문서 끝을 넘지 않고 위로는 올리지 않는다", () => {
    expect(scrollStep(200, 0, 1000)).toBe(200);
    expect(scrollStep(200, 900, 1000)).toBe(100);
    expect(scrollStep(-50, 0, 1000)).toBe(0);
  });
});

describe("useFollowBottom", () => {
  let host: HTMLDivElement;
  let root: Root;
  let endBottom = 0;
  let now = 0;
  let force: () => void = () => {};
  const scrollBy = vi.fn();
  const rect = (bottom: number, top = bottom) => ({ top, bottom, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

  function Probe({ signal }: { signal: string }) {
    const end = useRef<HTMLDivElement>(null);
    const bar = useRef<HTMLDivElement>(null);
    force = useFollowBottom(end, bar, signal);
    return createElement("section", null, createElement("div", { ref: end, "data-end": "" }), createElement("div", { ref: bar, "data-bar": "" }));
  }
  const render = (signal: string) => act(() => root.render(createElement(Probe, { signal })));
  /** 휠로 스크롤(사용자) — wheel 없이 생긴 scroll 은 브라우저 보정으로 본다 */
  const userScroll = (top: number, wheel = true) => {
    now += 5000;
    if (wheel) window.dispatchEvent(new Event("wheel"));
    document.documentElement.scrollTop = top;
    act(() => window.dispatchEvent(new Event("scroll")));
  };

  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5000 });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 800 });
    document.documentElement.scrollTop = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-bar") ? rect(700) : rect(endBottom);
    });
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    endBottom = 600;
    scrollBy.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("새 말·칩이 막대에 가려지면 그만큼 부드럽게 내린다", () => {
    render("1");
    expect(scrollBy).not.toHaveBeenCalled(); // 이미 보임
    endBottom = 950;
    render("2");
    expect(scrollBy).toHaveBeenCalledWith({ top: 262, behavior: "smooth" });
  });

  it("prefers-reduced-motion 이면 바로 이동", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q }));
    render("1");
    endBottom = 900;
    render("2");
    expect(scrollBy).toHaveBeenCalledWith({ top: 212, behavior: "auto" });
  });

  it("위로 올려 보고 있으면 따라가지 않고, 직접 보낸 순간엔 따라간다", () => {
    render("1");
    userScroll(1000);
    endBottom = 1500; // 맨 아래가 800px 아래 — 이전 대화를 보는 중
    userScroll(400);
    render("2");
    expect(scrollBy).not.toHaveBeenCalled();
    force();
    render("3");
    expect(scrollBy).toHaveBeenCalledWith({ top: 812, behavior: "smooth" });
  });

  it("하단 근처(80px 안)에서는 계속 따라간다", () => {
    render("1");
    endBottom = 760;
    userScroll(100);
    endBottom = 1000;
    render("2");
    expect(scrollBy).toHaveBeenCalledWith({ top: 312, behavior: "smooth" });
  });

  it("사용자 입력 없이 생긴 스크롤(높이 줄어 보정)로는 따라가기를 끄지 않는다", () => {
    render("1");
    userScroll(1000);
    endBottom = 1500;
    userScroll(400, false);
    render("2");
    expect(scrollBy).toHaveBeenCalledWith({ top: 812, behavior: "smooth" });
  });
});
