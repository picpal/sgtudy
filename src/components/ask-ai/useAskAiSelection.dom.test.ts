// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAskAiSelection } from "./useAskAiSelection";
import type { SelectionPick } from "./selection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
}

const box: { v?: { pick: SelectionPick | null; clear: () => void } } = {};
function Probe({ enabled }: { enabled: boolean }) {
  const r = useAskAiSelection(enabled);
  useEffect(() => {
    box.v = r;
  });
  return null;
}
const out = () => box.v!;
let root: Root;
let host: HTMLDivElement;
const render = (enabled: boolean) => act(() => root.render(createElement(Probe, { enabled })));
function select(id: string, s: number, e: number) {
  const t = document.getElementById(id)!.firstChild!;
  const r = document.createRange();
  r.setStart(t, s);
  r.setEnd(t, e);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(r);
}
const fire = () => act(() => void document.dispatchEvent(new Event("selectionchange")));

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `<div data-ask-ai="node"><p id="p">VPC 의 CIDR 블록</p></div>`;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.getSelection()?.removeAllRanges();
});

describe("useAskAiSelection", () => {
  it("debounces selectionchange 250ms (last one only)", async () => {
    render(true);
    select("p", 6, 13);
    fire();
    act(() => void vi.advanceTimersByTime(249));
    expect(out().pick).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(out().pick?.term).toBe("CIDR 블록");
  });
  it("a new event cancels the previous timer (only the last one reads)", async () => {
    render(true);
    select("p", 0, 3);
    fire();
    act(() => void vi.advanceTimersByTime(200));
    fire();
    act(() => void vi.advanceTimersByTime(200)); // 첫 타이머(250)가 살아 있었다면 여기서 읽었다
    expect(out().pick).toBeNull();
    act(() => void vi.advanceTimersByTime(50));
    expect(out().pick?.term).toBe("VPC");
  });
  it("keyup with Shift reads immediately", () => {
    render(true);
    select("p", 0, 3);
    act(() => void document.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", shiftKey: true })));
    expect(out().pick?.term).toBe("VPC");
  });
  it("first scroll hides (no re-measure) · clear empties state", () => {
    render(true);
    select("p", 0, 3);
    fire();
    act(() => void vi.advanceTimersByTime(250));
    expect(out().pick).not.toBeNull();
    act(() => void window.dispatchEvent(new Event("scroll")));
    expect(out().pick).toBeNull();
    fire();
    act(() => void vi.advanceTimersByTime(250));
    expect(out().pick).not.toBeNull();
    act(() => out().clear());
    expect(out().pick).toBeNull();
    expect(document.getSelection()!.toString()).toBe("VPC"); // 선택은 그대로
  });
  it("scroll listener is capture+passive+once, only while picked", () => {
    const add = vi.spyOn(window, "addEventListener");
    render(true);
    expect(add.mock.calls.some((c) => c[0] === "scroll")).toBe(false);
    select("p", 0, 3);
    fire();
    act(() => void vi.advanceTimersByTime(250));
    const sc = add.mock.calls.find((c) => c[0] === "scroll")!;
    expect(sc[2]).toEqual({ capture: true, passive: true, once: true });
  });
  it("mobile bar: scroll·resize don't hide (no listeners) · collapsing the selection hides", () => {
    const mm = vi.fn(() => ({ matches: true }) as MediaQueryList);
    vi.stubGlobal("matchMedia", mm);
    const add = vi.spyOn(window, "addEventListener");
    try {
      render(true);
      select("p", 0, 3);
      fire();
      act(() => void vi.advanceTimersByTime(250));
      expect(out().pick?.term).toBe("VPC");
      act(() => void window.dispatchEvent(new Event("scroll")));
      act(() => void window.dispatchEvent(new Event("resize")));
      expect(out().pick?.term).toBe("VPC");
      expect(add.mock.calls.some((c) => c[0] === "scroll" || c[0] === "resize")).toBe(false);
      select("p", 0, 5); // 핸들 드래그로 선택을 넓혀도 그대로 이어진다
      fire();
      act(() => void vi.advanceTimersByTime(250));
      expect(out().pick?.term).toBe("VPC 의");
      act(() => void document.getSelection()!.removeAllRanges());
      fire();
      act(() => void vi.advanceTimersByTime(250));
      expect(out().pick).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("enabled=false → no document listeners", () => {
    const add = vi.spyOn(document, "addEventListener");
    render(false);
    expect(add.mock.calls.some((c) => c[0] === "selectionchange" || c[0] === "keyup")).toBe(false);
    select("p", 0, 3);
    fire();
    act(() => void vi.advanceTimersByTime(300));
    expect(out().pick).toBeNull();
  });
});
