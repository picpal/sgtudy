// @vitest-environment jsdom
// Listbox — 기본 select 대신 쓰는 단일 선택 드롭다운. 열기/고르기/키보드/바깥 누름.
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Listbox, type ListboxOption } from "./Listbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTS: ListboxOption[] = [
  { value: "all", label: "전체" },
  { value: "a", label: "Alpha", sub: "10/1 – 10/7" },
  { value: "b", label: "Beta", tag: { text: "이번 회차", tone: "mint" } },
  { value: "c", label: "Charlie" },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(value = "a") {
  const picked: string[] = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Listbox, { label: "회차 필터", prefix: "회차", value, options: OPTS, onChange: (v: string) => picked.push(v) })));
  const btn = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
  const list = () => host!.querySelector<HTMLElement>('[role="listbox"]');
  const activeText = () => document.getElementById(list()!.getAttribute("aria-activedescendant")!)?.textContent;
  return { btn, list, activeText, picked };
}
const key = (el: Element, k: string) => act(() => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));

describe("Listbox", () => {
  it("버튼 — aria-haspopup=listbox, 닫힘 상태, 고른 항목 글", () => {
    const { btn, list } = mount("b");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.textContent).toContain("Beta");
    expect(btn.textContent).toContain("이번 회차");
    expect(list()).toBeNull();
  });

  it.each(["Enter", " ", "ArrowDown"])("%j 로 열면 고른 항목이 활성, 목록에 포커스", (k) => {
    const { btn, list, activeText } = mount("a");
    key(btn, k);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe(list()!.id);
    expect(document.activeElement).toBe(list());
    expect(activeText()).toContain("Alpha");
  });

  it("↑/↓/Home/End 이동(끝에서 멈춤), Enter 로 고르면 닫히고 버튼에 포커스", () => {
    const { btn, list, activeText, picked } = mount("a");
    key(btn, "ArrowDown");
    key(list()!, "ArrowDown");
    expect(activeText()).toContain("Beta");
    key(list()!, "End");
    expect(activeText()).toContain("Charlie");
    key(list()!, "ArrowDown");
    expect(activeText()).toContain("Charlie");
    key(list()!, "Home");
    expect(activeText()).toContain("전체");
    key(list()!, "ArrowUp");
    expect(activeText()).toContain("전체");
    key(list()!, "ArrowDown");
    key(list()!, "ArrowDown");
    key(list()!, "Enter");
    expect(picked).toEqual(["b"]);
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("같은 항목을 다시 고르면 onChange 없음", () => {
    const { btn, list, picked } = mount("a");
    key(btn, "Enter");
    key(list()!, "Enter");
    expect(picked).toEqual([]);
    expect(list()).toBeNull();
  });

  it("Esc 는 고르지 않고 닫고 버튼으로", () => {
    const { btn, list, picked } = mount("a");
    key(btn, "ArrowDown");
    key(list()!, "ArrowDown");
    key(list()!, "Escape");
    expect(picked).toEqual([]);
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("글자를 치면 그 글자로 시작하는 항목으로", () => {
    const { btn, list, activeText } = mount("all");
    key(btn, "Enter");
    key(list()!, "c");
    expect(activeText()).toContain("Charlie");
  });

  it("클릭으로 열고 항목 클릭으로 고르기 · aria-selected 는 고른 항목만", () => {
    const { btn, list, picked } = mount("a");
    act(() => btn.click());
    const opts = Array.from(list()!.querySelectorAll('[role="option"]'));
    expect(opts.map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
    act(() => (opts[3] as HTMLElement).click());
    expect(picked).toEqual(["c"]);
    expect(list()).toBeNull();
  });

  it("바깥을 누르면 닫힌다", () => {
    const { btn, list } = mount("a");
    act(() => btn.click());
    expect(list()).not.toBeNull();
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(list()).toBeNull();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});
