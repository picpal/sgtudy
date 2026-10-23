// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SubmitSlotProvider } from "../submitSlot";
import { SubmitPanel } from "./SubmitPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const els: HTMLElement[] = [];
const div = () => {
  const d = document.body.appendChild(document.createElement("div"));
  els.push(d);
  return d;
};
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  els.splice(0).forEach((e) => e.remove());
});
const panel = createElement(SubmitPanel, { id: "my-sub-title", title: "과제 제출", icon: "submit" }, createElement("p", null, "본문"));
const mount = (slot: HTMLElement | null | undefined) => {
  const host = div();
  root = createRoot(host);
  act(() => root!.render(slot === undefined ? panel : createElement(SubmitSlotProvider, { value: slot }, panel)));
  return host;
};

describe("SubmitPanel 자리", () => {
  it("방 화면이 연 자리가 있으면 그 자리(본문 카드 아래 형제)로 포털한다", () => {
    const slot = div();
    const host = mount(slot);
    expect(host.querySelector("section")).toBeNull();
    const s = slot.querySelector("section")!;
    expect(s.getAttribute("aria-labelledby")).toBe("my-sub-title");
    expect(s.querySelector("h2")?.textContent).toBe("과제 제출");
    expect(s.textContent).toContain("본문");
  });
  it("sub 는 기본 제목 아래 줄, subPlacement=inline 이면 제목과 같은 줄(ml-auto)", () => {
    for (const placement of ["below", "inline"] as const) {
      const el = createElement(SubmitPanel, { id: "x-title", title: "제목", sub: "요약", subPlacement: placement, icon: "exam" });
      const h = document.body.appendChild(document.createElement("div"));
      const r = createRoot(h);
      act(() => r.render(el));
      const p = h.querySelector("h2#x-title")!.nextElementSibling as HTMLElement;
      expect(p.textContent).toBe("요약");
      expect(p.classList.contains("ml-auto")).toBe(placement === "inline");
      expect(p.parentElement!.classList.contains("flex-col")).toBe(placement === "below");
      act(() => r.unmount());
      h.remove();
    }
  });
  it("자리가 아직 붙지 않았으면(null) 그리지 않는다", () => {
    const host = mount(null);
    expect(host.querySelector("section")).toBeNull();
  });
  it("자리를 여는 화면이 없으면 제자리에 그린다", () => {
    expect(mount(undefined).querySelector("section h2")?.textContent).toBe("과제 제출");
  });
});
