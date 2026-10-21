// @vitest-environment jsdom
// 과제 카드 아바타 줄 — 4명 이하는 다 보이고, 5명 이상은 더 작게 3명 + "+N". 누르면 펼치고 3초 뒤 저절로 접힌다.
// 펼치기 버튼 클릭은 카드(누르면 과제로 가는 영역)로 올라가지 않는다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AUTO_COLLAPSE_MS, TaskAvatars, type TaskAvatar } from "./TaskAvatars";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NAMES = ["지은", "철수", "영희", "민수", "수진", "도윤", "하준"];
const people = (n: number): TaskAvatar[] => NAMES.slice(0, n).map((name) => ({ key: name, name, status: "done", title: `${name} · 제출` }));

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
  vi.useRealTimers();
});

function mount(n: number) {
  const onCard = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // 카드처럼 클릭을 받는 부모
  act(() => root!.render(createElement("div", { onClick: onCard }, createElement(TaskAvatars, { people: people(n), size: 28, iconSize: 14, compactSize: 26, compactIconSize: 13, ring: "#FFFFFF" }))));
  const toggle = () => host!.querySelector<HTMLButtonElement>("button[data-avatar-toggle]");
  const faces = () => [...host!.querySelectorAll<HTMLElement>("[data-avatar]")];
  const visible = () => faces().filter((f) => !f.hasAttribute("data-hidden"));
  const avatarSize = () => faces()[0].querySelector<HTMLElement>("[title] > span")!.style.width;
  return { onCard, toggle, faces, visible, avatarSize };
}
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const pointer = (el: Element, type: "pointerover" | "pointerout") => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true })));

describe("TaskAvatars", () => {
  it("4명 이하 — 기본 크기로 다 보이고 펼치기 버튼·+N 이 없다, 툴팁은 이름 · 상태", () => {
    const { toggle, faces, visible, avatarSize } = mount(4);
    expect(toggle()).toBeNull();
    expect(faces()).toHaveLength(4);
    expect(visible()).toHaveLength(4);
    expect(avatarSize()).toBe("28px");
    expect(faces()[1].querySelector("[title]")!.getAttribute("title")).toBe("철수 · 제출");
    expect(host!.textContent).not.toContain("+");
  });

  it("5명 이상 — 한 단계 작게, 3명 + '+N', 버튼은 접힌 상태", () => {
    const { toggle, visible, avatarSize } = mount(7);
    expect(avatarSize()).toBe("26px");
    expect(visible()).toHaveLength(3);
    const btn = toggle()!;
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-label")).toBe("참가자 7명 모두 보기");
    expect(btn.querySelector("[data-avatar-more]")!.textContent).toBe("+4");
    expect(btn.className).toContain("focus-visible:outline-2");
  });

  it("누르면 펼치고 다시 누르면 바로 접는다 — 카드 클릭으로 올라가지 않는다, 펼쳐도 툴팁 유지", () => {
    const { onCard, toggle, visible } = mount(5);
    click(toggle()!);
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    expect(toggle()!.getAttribute("aria-label")).toBe("접기");
    expect(visible()).toHaveLength(5);
    expect(visible()[4].querySelector("[title]")!.getAttribute("title")).toBe("수진 · 제출");
    click(toggle()!);
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
    expect(visible()).toHaveLength(3);
    expect(onCard).not.toHaveBeenCalled();
  });

  it("펼친 뒤 3초면 저절로 접힌다", () => {
    vi.useFakeTimers();
    const { toggle } = mount(6);
    click(toggle()!);
    act(() => void vi.advanceTimersByTime(AUTO_COLLAPSE_MS - 1));
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    act(() => void vi.advanceTimersByTime(1));
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("포인터가 올라가 있는 동안은 멈추고, 떠나면 다시 3초", () => {
    vi.useFakeTimers();
    const { toggle } = mount(6);
    click(toggle()!);
    pointer(toggle()!, "pointerover");
    act(() => void vi.advanceTimersByTime(AUTO_COLLAPSE_MS * 3));
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    pointer(toggle()!, "pointerout");
    act(() => void vi.advanceTimersByTime(AUTO_COLLAPSE_MS));
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("키보드 포커스가 있는 동안은 멈추고, 빠지면 다시 3초", () => {
    vi.useFakeTimers();
    const { toggle } = mount(6);
    act(() => toggle()!.focus());
    act(() => toggle()!.click()); // 브라우저는 Enter·Space 를 click 으로 바꾼다
    act(() => void vi.advanceTimersByTime(AUTO_COLLAPSE_MS * 2));
    expect(toggle()!.getAttribute("aria-expanded")).toBe("true");
    act(() => toggle()!.blur());
    act(() => void vi.advanceTimersByTime(AUTO_COLLAPSE_MS));
    expect(toggle()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("펼친 채 사라지면 타이머를 지운다", () => {
    vi.useFakeTimers();
    const { toggle } = mount(6);
    click(toggle()!);
    expect(vi.getTimerCount()).toBe(1);
    act(() => root!.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("줄임 동작 설정이면 애니메이션 없이 바로 — motion-reduce:transition-none", () => {
    const { faces, toggle } = mount(5);
    expect(faces().every((f) => f.className.includes("motion-reduce:transition-none"))).toBe(true);
    expect(toggle()!.querySelector("[data-avatar-more]")!.className).toContain("motion-reduce:transition-none");
  });
});
