// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImageLightbox, type LightboxItem } from "./ImageLightbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

const item = (id: string, svg = false, url: string | null = `https://sb.test/s/${id}`): LightboxItem => ({ id, name: `${id}.${svg ? "svg" : "png"}`, sizeLabel: "84 KB", url, svg });
const ITEMS = [item("a"), item("b", true), item("c")];

/** 연 버튼 + 라이트박스 — 버튼을 누르면 열린다(포커스 복귀 확인용) */
function mount(items = ITEMS, start = 0, spies: { onDownload?: (id: string) => void; onRefresh?: (id: string) => void } = {}) {
  function Host() {
    const [open, setOpen] = useState<number | null>(null);
    return createElement(
      "div",
      null,
      createElement("button", { type: "button", id: "opener", onClick: () => setOpen(start) }, "열기"),
      open !== null && createElement(ImageLightbox, { items, index: open, onIndex: setOpen, onClose: () => setOpen(null), onDownload: spies.onDownload ?? (() => {}), onRefresh: spies.onRefresh }),
    );
  }
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(Host)));
  const opener = document.getElementById("opener") as HTMLButtonElement;
  opener.focus();
  act(() => opener.click());
  return opener;
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const key = (k: string, shiftKey = false) => act(() => void (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true })));
const btn = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const img = () => dialog()?.querySelector("img");

describe("ImageLightbox (스펙 §4.3)", () => {
  it("열면 닫기에 포커스 · aria-label·aria-live 문구 · body 스크롤 잠금", () => {
    document.body.style.overflow = "auto";
    mount();
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(dialog()?.getAttribute("aria-label")).toBe("a.png (1/3)");
    expect(dialog()?.querySelector('[aria-live="polite"]')?.textContent).toBe("1/3 a.png");
    expect(document.activeElement).toBe(btn("닫기"));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("Esc 로 닫히고 연 버튼으로 포커스 복귀 · 스크롤 원래 값", () => {
    document.body.style.overflow = "auto";
    const opener = mount();
    key("Escape");
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("Tab 은 대화상자 안에서 돈다 — 닫기·이전·다음·받기, 끝에서 처음으로", () => {
    mount(ITEMS, 1);
    const order = () => document.activeElement?.getAttribute("aria-label");
    const els = [...dialog()!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(els).toEqual(["닫기", "이전 그림", "다음 그림", "b.svg 받기"]);
    expect(order()).toBe("닫기");
    key("Tab", true);
    expect(order()).toBe("b.svg 받기");
    key("Tab");
    expect(order()).toBe("닫기");
  });

  it("←/→ 와 버튼으로 넘기고 끝에서 멈춘다(순환 없음)", () => {
    mount();
    key("ArrowLeft");
    expect(dialog()?.getAttribute("aria-label")).toBe("a.png (1/3)");
    key("ArrowRight");
    expect(dialog()?.getAttribute("aria-label")).toBe("b.svg (2/3)");
    expect(dialog()?.querySelector('[aria-live="polite"]')?.textContent).toBe("2/3 b.svg");
    act(() => btn("다음 그림")!.click());
    expect(dialog()?.getAttribute("aria-label")).toBe("c.png (3/3)");
    expect(btn("다음 그림")!.getAttribute("aria-disabled")).toBe("true");
    act(() => btn("다음 그림")!.click());
    expect(dialog()?.getAttribute("aria-label")).toBe("c.png (3/3)");
  });

  it("1장이면 이전/다음이 없다", () => {
    mount([item("a")]);
    expect(btn("이전 그림")).toBeNull();
    expect(btn("다음 그림")).toBeNull();
  });

  it("그림은 <img> 로만 — 서명 URL·alt=이름, SVG 는 흰 바탕", () => {
    mount(ITEMS, 1);
    expect(img()?.getAttribute("src")).toBe("https://sb.test/s/b");
    expect(img()?.getAttribute("alt")).toBe("b.svg");
    expect(img()?.className).toContain("bg-white");
    expect(dialog()!.querySelectorAll("object, embed, iframe").length).toBe(0);
    expect(dialog()!.textContent).not.toContain("원본 열기");
  });

  it("배경 클릭은 닫고 그림 클릭은 닫지 않는다", () => {
    mount();
    act(() => img()!.click());
    expect(dialog()).not.toBeNull();
    act(() => dialog()!.click());
    expect(dialog()).toBeNull();
  });

  it("받기는 그 파일 id 로", () => {
    const onDownload = vi.fn();
    mount(ITEMS, 2, { onDownload });
    act(() => btn("c.png 받기")!.click());
    expect(onDownload).toHaveBeenCalledWith("c");
  });

  it("못 불러오면 한 번 다시 서명, 서명이 없으면 실패 상자", () => {
    const onRefresh = vi.fn();
    mount([item("a"), item("b", false, null)], 0, { onRefresh });
    act(() => void img()!.dispatchEvent(new Event("error")));
    expect(onRefresh).toHaveBeenCalledWith("a");
    key("ArrowRight");
    expect(img()).toBeNull();
    expect(dialog()!.textContent).toContain("그림을 불러올 수 없어요");
  });

  it("가로 스와이프 50px 이상이면 넘기고, 세로가 더 크면 무시", () => {
    mount();
    const area = img()!.parentElement!;
    const swipe = (dx: number, dy: number) =>
      act(() => {
        area.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 200 }), { isPrimary: true }));
        area.dispatchEvent(Object.assign(new MouseEvent("pointerup", { bubbles: true, clientX: 200 + dx, clientY: 200 + dy }), { isPrimary: true }));
      });
    swipe(-80, 10);
    expect(dialog()?.getAttribute("aria-label")).toBe("b.svg (2/3)");
    swipe(-80, 120);
    expect(dialog()?.getAttribute("aria-label")).toBe("b.svg (2/3)");
    swipe(40, 0);
    expect(dialog()?.getAttribute("aria-label")).toBe("b.svg (2/3)");
    swipe(90, 0);
    expect(dialog()?.getAttribute("aria-label")).toBe("a.png (1/3)");
  });
});
