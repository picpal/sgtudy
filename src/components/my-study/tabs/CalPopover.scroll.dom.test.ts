// @vitest-environment jsdom
// PC 캘린더 팝오버: 바탕 스크롤을 따라가지 않고, 누적 SCROLL_CLOSE_PX 를 넘거나 막대가 화면 밖으로 나가면 닫힌다. 팝오버 안 스크롤은 무시.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CalPopover } from "./CalendarTab";
import { SCROLL_CLOSE_PX } from "./calPopover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
let bar: HTMLButtonElement;
let barTop = 200;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
  Object.defineProperty(document.documentElement, "clientWidth", { value: 1280, configurable: true });
  barTop = 200;
  host = document.createElement("div");
  bar = document.createElement("button");
  bar.dataset.calBar = "n1";
  bar.getBoundingClientRect = () => ({ top: barTop, bottom: barTop + 20, left: 100, right: 200, width: 100, height: 20, x: 100, y: barTop, toJSON() {} }) as DOMRect;
  document.body.append(host, bar);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const open = () => {
  const onClose = vi.fn();
  root = createRoot(host);
  act(() => root!.render(createElement(CalPopover, { anchor: { el: bar, id: "n1", x: null }, onClose } as unknown as ComponentProps<typeof CalPopover>, createElement("p", null, "상세"))));
  return { onClose, dlg: document.querySelector<HTMLElement>('[role="dialog"]')! };
};
/** 바탕 스크롤 — 막대가 dy 만큼 위로 올라간다 */
const scrollPage = (dy: number) =>
  act(() => {
    barTop -= dy;
    document.dispatchEvent(new Event("scroll"));
  });

describe("CalPopover — PC 스크롤", () => {
  it("살짝(30px) 스크롤하면 열린 채 처음 자리에 머문다", () => {
    const { onClose, dlg } = open();
    const top = dlg.style.getPropertyValue("--pt");
    expect(top).toBe("226px");
    scrollPage(30);
    expect(onClose).not.toHaveBeenCalled();
    expect(dlg.style.getPropertyValue("--pt")).toBe(top);
  });

  it(`누적 ${SCROLL_CLOSE_PX}px 를 넘으면 닫힌다(포커스는 막대로)`, () => {
    const { onClose } = open();
    scrollPage(40);
    scrollPage(-40); // 위아래로 오가도 누적
    expect(onClose).not.toHaveBeenCalled();
    scrollPage(30);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
    scrollPage(30);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("막대가 화면 밖으로 나가면 바로 닫힌다", () => {
    barTop = 30;
    const { onClose } = open();
    scrollPage(60);
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it("팝오버 안 스크롤은 무시한다", () => {
    const { onClose, dlg } = open();
    barTop -= 500; // 막대가 움직였다고 해도 안쪽 스크롤 이벤트면 재지 않는다
    act(() => dlg.dispatchEvent(new Event("scroll")));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("모바일 시트는 바탕 스크롤로 닫지 않는다", () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q })) as unknown as typeof window.matchMedia;
    const { onClose } = open();
    scrollPage(500);
    expect(onClose).not.toHaveBeenCalled();
  });
});
