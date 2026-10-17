// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RowMenu } from "./RowMenu";
import type { RowMove } from "../rounds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MOVES: RowMove[] = [
  { key: "up", label: "위로", parentId: "1", index: 0, cross: false },
  { key: "down", label: "아래로", parentId: "1", index: 2, cross: false },
  { key: "round:2", label: "2주차로 옮기기", parentId: "2", cross: true },
];

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});
const mount = (onMove = vi.fn(), moves = MOVES) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(RowMenu, { title: "VPC 실습", moves, onMove })));
  return { onMove, btn: host.querySelector<HTMLButtonElement>("[data-row-menu]")! };
};
const key = (el: Element, k: string) => act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

describe("RowMenu (편집 목록 ⋯ 옮기기 — Q2-4)", () => {
  it("이름 있는 메뉴 버튼, 열면 첫 항목에 포커스 · 다른 회차 앞 소제목", () => {
    const { btn } = mount();
    expect(btn.getAttribute("aria-label")).toBe("VPC 실습 옮기기");
    act(() => btn.click());
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items.map((i) => i.textContent)).toEqual(["위로", "아래로", "2주차로 옮기기"]);
    expect(document.activeElement).toBe(items[0]);
    expect(document.querySelector('[role="menu"]')!.textContent).toContain("다른 회차로");
  });
  it("키보드: ↓ 로 열고 ↓·End 이동, Enter(클릭)로 실행하고 닫으며 버튼으로", () => {
    const { btn, onMove } = mount();
    btn.focus();
    key(btn, "ArrowDown");
    const menu = document.querySelector('[role="menu"]')!;
    key(menu, "End");
    expect(document.activeElement?.textContent).toBe("2주차로 옮기기");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(onMove).toHaveBeenCalledWith(MOVES[2]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
  it("Esc 는 닫고 버튼으로", () => {
    const { btn } = mount();
    act(() => btn.click());
    key(document.querySelector('[role="menu"]')!, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
  it("옮길 곳이 없으면 비활성", () => expect(mount(vi.fn(), []).btn.disabled).toBe(true));
});
