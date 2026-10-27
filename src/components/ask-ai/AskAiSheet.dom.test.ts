// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AskAiSheet, type SheetState } from "./AskAiSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BODY = { kind: "term" as const, term: "CIDR 블록", oneLiner: "IP 범위를 적는 방식이에요", inContext: "- VPC 설계에 써요", points: ["/16~/28"], related: ["VPC", "서브넷"] };
const ok: SheetState = { phase: "ok", body: BODY };
let root: Root;
let host: HTMLDivElement;
let opener: HTMLButtonElement;
const props = (state: SheetState, o: Partial<Parameters<typeof AskAiSheet>[0]> = {}) => ({ term: "CIDR 블록", state, onClose: vi.fn(), onAskRelated: vi.fn(), returnFocus: opener, ...o });
const render = (p: ReturnType<typeof props>) => act(() => root.render(createElement(AskAiSheet, p)));

beforeEach(() => {
  opener = document.createElement("button");
  document.body.appendChild(opener);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  document.body.style.overflow = "auto";
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("AskAiSheet", () => {
  it("dialog semantics · loading status switches after 3s", () => {
    vi.useFakeTimers();
    render(props({ phase: "loading" }));
    const d = document.querySelector('[role="dialog"]')!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-busy")).toBe("true");
    expect(document.getElementById(d.getAttribute("aria-labelledby")!)!.textContent).toBe("CIDR 블록");
    expect(document.querySelector('[role="status"]')!.textContent).toBe("이 스터디 맥락을 읽는 중…");
    act(() => void vi.advanceTimersByTime(3000));
    expect(document.querySelector('[role="status"]')!.textContent).toBe("해설을 쓰는 중…");
    expect(document.body.style.overflow).toBe("hidden");
  });
  it("ok: 4 sections, related chip → onAskRelated, footnote", () => {
    const p = props(ok);
    render(p);
    const heads = [...document.querySelectorAll("h3")].map((h) => h.textContent);
    expect(heads).toEqual(["한 줄 요약", "이 스터디에서는", "시험·실무 포인트", "관련 용어"]);
    const chip = [...document.querySelectorAll("button")].find((b) => b.textContent === "VPC")!;
    act(() => chip.click());
    expect(p.onAskRelated).toHaveBeenCalledWith("VPC");
    expect(document.body.textContent).toContain("AI 가 쓴 글이라 틀릴 수 있어요");
    expect(document.querySelector('[role="dialog"]')!.getAttribute("aria-busy")).toBe("false");
  });
  it("not_term: notice only, no sections", () => {
    render(props({ phase: "ok", body: { ...BODY, kind: "not_term" } }));
    expect(document.querySelectorAll("h3")).toHaveLength(0);
    expect(document.body.textContent).toContain("용어나 짧은 구를 선택해 주세요");
  });
  it("error: message + retry hint", () => {
    render(props({ phase: "error", code: "RATE_LIMITED", message: "AI 해설을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요", retryAfterSec: 90 }));
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("2분 뒤에 다시 쓸 수 있어요");
  });
  it("Esc / backdrop / close button → onClose", () => {
    const p = props(ok);
    render(p);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    act(() => (document.querySelector("[data-ask-ai-backdrop]") as HTMLElement).click());
    act(() => (document.querySelector('button[aria-label="닫기"]') as HTMLElement).click());
    expect(p.onClose).toHaveBeenCalledTimes(3);
    act(() => (document.querySelector('[role="dialog"]') as HTMLElement).click()); // 상자 안 클릭은 닫지 않는다
    expect(p.onClose).toHaveBeenCalledTimes(3);
  });
  it("Esc closes only the sheet — an underlying document keydown listener (NoticePopup) doesn't see it", () => {
    const under = vi.fn();
    document.addEventListener("keydown", under);
    try {
      const p = props(ok);
      render(p);
      act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(p.onClose).toHaveBeenCalledTimes(1);
      expect(under).not.toHaveBeenCalled();
      act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
      expect(under).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", under);
    }
  });
  it("sits above NoticePopup (z-[45])", () => {
    render(props(ok));
    expect((document.querySelector("[data-ask-ai-backdrop]") as HTMLElement).className).toContain("z-[60]");
  });
  it("unmount restores focus to returnFocus and body overflow", () => {
    render(props(ok));
    expect(document.activeElement?.tagName).toBe("H2");
    act(() => root.render(createElement("div")));
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("auto");
  });
});
