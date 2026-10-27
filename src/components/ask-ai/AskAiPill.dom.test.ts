// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskAiPill, PILL_W, pillPosition } from "./AskAiPill";
import type { SelectionPick } from "./selection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mq = (matches: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} }));
const rect = (o: Partial<DOMRect>) => ({ top: 300, bottom: 320, left: 400, width: 80, height: 20, right: 480, x: 400, y: 300, toJSON: () => ({}), ...o }) as DOMRect;
const pick = (term: string, r = rect({})): SelectionPick => ({ term, source: "node", context: "", rect: r, container: document.body });

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("pillPosition", () => {
  it("above the selection, centered", () => {
    expect(pillPosition(rect({}), 1024)).toEqual({ top: 300 - 44 - 8, left: 400 + 40 - PILL_W / 2 });
  });
  it("below when no room above · clamped horizontally", () => {
    expect(pillPosition(rect({ top: 20, bottom: 40 }), 1024).top).toBe(48);
    expect(pillPosition(rect({ left: 0, width: 10 }), 1024).left).toBe(8);
    expect(pillPosition(rect({ left: 1010, width: 10 }), 1024).left).toBe(1024 - PILL_W - 8);
  });
});

describe("AskAiPill", () => {
  it("desktop: one floating button with clamped style; click → onAsk; pointerdown prevented", () => {
    mq(false);
    const onAsk = vi.fn();
    act(() => root.render(createElement(AskAiPill, { pick: pick("CIDR 블록", rect({ left: 1000, width: 20 })), onAsk })));
    const b = document.querySelectorAll<HTMLButtonElement>("[data-ask-ai-pill] , [data-ask-ai-pill] button");
    const btn = document.querySelector<HTMLButtonElement>('button[aria-label="선택한 용어 AI에게 물어보기"]')!;
    expect(b.length).toBeGreaterThan(0);
    expect(btn.dataset.askAiPill).toBe("float");
    expect(btn.textContent).toBe("AI에게 물어보기");
    expect(parseFloat(btn.style.left)).toBeLessThanOrEqual(1024 - PILL_W - 8);
    expect(btn.style.top).toBe(`${300 - 52}px`);
    const ev = new Event("pointerdown", { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    act(() => btn.click());
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
  it("mobile: bottom bar with term, ellipsis past 18cp", () => {
    mq(true);
    act(() => root.render(createElement(AskAiPill, { pick: pick("CIDR 블록"), onAsk: () => {} })));
    expect(document.querySelector('[data-ask-ai-pill="bar"]')!.textContent).toBe("“CIDR 블록” AI에게 물어보기");
    act(() => root.render(createElement(AskAiPill, { pick: pick("가".repeat(20)), onAsk: () => {} })));
    expect(document.querySelector('[data-ask-ai-pill="bar"]')!.textContent).toBe(`“${"가".repeat(18)}…” AI에게 물어보기`);
  });
});
