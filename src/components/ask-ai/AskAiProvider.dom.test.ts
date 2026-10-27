// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 200, left: 200, right: 260, bottom: 220, width: 60, height: 20, toJSON: () => ({}) }) as DOMRect;
}

const m = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), postExplain: m.post }));
const { AskAiProvider } = await import("./AskAiProvider");

const BODY = { kind: "term", term: "CIDR 블록", oneLiner: "IP 범위", inContext: "- a", points: [], related: ["VPC"] };
let root: Root;
let host: HTMLDivElement;
const content = () =>
  createElement("div", null,
    createElement("div", { "data-ask-ai": "node" }, createElement("p", { id: "p" }, "VPC 의 CIDR 블록을 정해요")),
    createElement("div", { "data-ask-ai": "off" }, createElement("p", { id: "off" }, "응시 중 문항")),
  );
const render = (enabled = true) => act(() => root.render(createElement(AskAiProvider, { slug: "aws", enabled }, content())));
function select(id: string, s: number, e: number) {
  const t = document.getElementById(id)!.firstChild!;
  const r = document.createRange();
  r.setStart(t, s);
  r.setEnd(t, e);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(r);
  act(() => void document.dispatchEvent(new Event("selectionchange")));
  act(() => void vi.advanceTimersByTime(250));
}
const pill = () => document.querySelector<HTMLButtonElement>('button[aria-label="선택한 용어 AI에게 물어보기"]');
const dialog = () => document.querySelector('[role="dialog"]');
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  m.post.mockReset().mockResolvedValue({ ok: true, data: { hit: false, body: BODY } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AskAiProvider", () => {
  it("select → pill → click → loading → ok body", async () => {
    let resolve!: (v: unknown) => void;
    m.post.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render();
    select("p", 6, 13);
    expect(pill()).not.toBeNull();
    act(() => pill()!.click());
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    expect(pill()).toBeNull();
    expect(m.post.mock.calls[0][0]).toEqual({ slug: "aws", term: "CIDR 블록", source: "node", context: "VPC 의 CIDR 블록을 정해요" });
    await act(async () => resolve({ ok: true, data: { hit: false, body: BODY } }));
    expect(document.body.textContent).toContain("IP 범위");
  });
  it("same term again → served from session memory (one fetch)", async () => {
    render();
    select("p", 6, 13);
    act(() => pill()!.click());
    await flush();
    act(() => (document.querySelector('button[aria-label="닫기"]') as HTMLElement).click());
    expect(dialog()).toBeNull();
    select("p", 6, 13);
    act(() => pill()!.click());
    expect(document.body.textContent).toContain("IP 범위");
    expect(m.post).toHaveBeenCalledTimes(1);
  });
  it("enabled=false → no pill", () => {
    render(false);
    select("p", 6, 13);
    expect(pill()).toBeNull();
  });
  it("off area → no pill", () => {
    render();
    select("off", 0, 3);
    expect(pill()).toBeNull();
  });
  it("Alt+Shift+A opens the sheet when there is a pick", async () => {
    render();
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", altKey: true, shiftKey: true })));
    expect(dialog()).toBeNull();
    select("p", 0, 3);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", altKey: true, shiftKey: true })));
    expect(dialog()).not.toBeNull();
    await flush();
  });
  it("while open, new selections are ignored (no pill)", async () => {
    render();
    select("p", 6, 13);
    act(() => pill()!.click());
    await flush();
    select("p", 0, 3);
    expect(pill()).toBeNull();
  });
  it("closing during a request aborts it", async () => {
    let signal: AbortSignal | undefined;
    m.post.mockImplementationOnce((_b: unknown, o: { signal?: AbortSignal }) => {
      signal = o.signal;
      return new Promise(() => {});
    });
    render();
    select("p", 6, 13);
    act(() => pill()!.click());
    expect(signal?.aborted).toBe(false);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(signal?.aborted).toBe(true);
    expect(dialog()).toBeNull();
  });
  it("related chip → new question with same source/context", async () => {
    render();
    select("p", 6, 13);
    act(() => pill()!.click());
    await flush();
    const chip = [...document.querySelectorAll("button")].find((b) => b.textContent === "VPC")!;
    act(() => chip.click());
    await flush();
    expect(m.post).toHaveBeenCalledTimes(2);
    expect(m.post.mock.calls[1][0]).toMatchObject({ term: "VPC", source: "node", context: "VPC 의 CIDR 블록을 정해요" });
  });
  it("error → §6 message", async () => {
    m.post.mockResolvedValueOnce({ ok: false, err: { error: "EXAM_IN_PROGRESS", message: "x", status: 403 } });
    render();
    select("p", 6, 13);
    act(() => pill()!.click());
    await flush();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("시험을 제출한 뒤에 쓸 수 있어요");
  });
});
