// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { useRefocusOnClose } from "./useRefocusOnClose";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 열림 → 입력, 닫힘 → "＋ 추가" 버튼. 닫으면 버튼이 다시 그려진 뒤(effect) 그쪽으로 포커스 */
function Harness({ stealTo }: { stealTo?: HTMLElement }) {
  const [open, setOpen] = useState(true);
  const refocus = useRefocusOnClose(open);
  const close = () => {
    refocus(() => document.querySelector<HTMLButtonElement>("[data-add]"));
    if (stealTo) stealTo.focus();
    setOpen(false);
  };
  return open
    ? createElement("input", { "data-input": true, onKeyDown: close })
    : createElement("button", { "data-add": true, type: "button" }, "추가");
}

const mount = (stealTo?: HTMLElement) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(Harness, { stealTo })));
  return { host, root };
};

describe("useRefocusOnClose (빠른 추가 닫기 포커스 — /tasks·my-study 공용)", () => {
  it("닫은 뒤 포커스가 body 로 떨어지면 다시 그려진 대상으로", () => {
    const { host, root } = mount();
    const input = host.querySelector<HTMLInputElement>("[data-input]")!;
    input.focus();
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement?.hasAttribute("data-add")).toBe(true);
    act(() => root.unmount());
    host.remove();
  });
  it("사용자가 이미 다른 곳으로 옮겼으면(탭·클릭) 건드리지 않는다", () => {
    const other = document.body.appendChild(document.createElement("button"));
    const { host, root } = mount(other);
    const input = host.querySelector<HTMLInputElement>("[data-input]")!;
    input.focus();
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(other);
    act(() => root.unmount());
    host.remove();
    other.remove();
  });
});
