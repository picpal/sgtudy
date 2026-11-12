// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmDialog } from "./ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
const host = () => {
  const h = document.body.appendChild(document.createElement("div"));
  root = createRoot(h);
  return h;
};
const props = (over: Partial<Parameters<typeof ConfirmDialog>[0]>) => ({ open: true, title: "t", body: "b", confirmLabel: "확인", onConfirm: () => {}, onCancel: () => {}, ...over });
const esc = () => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
const backdrop = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!.parentElement!;

describe("ConfirmDialog", () => {
  it("처리 중(busy)에는 Esc·바깥 클릭으로 닫히지 않는다", () => {
    const onCancel = vi.fn();
    host();
    act(() => root!.render(createElement(ConfirmDialog, props({ busy: true, onCancel }))));
    esc();
    act(() => backdrop().click());
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("처리 중이 아니면 Esc·바깥 클릭이 onCancel, 상자 안 클릭은 닫지 않는다", () => {
    const onCancel = vi.fn();
    host();
    act(() => root!.render(createElement(ConfirmDialog, props({ onCancel }))));
    act(() => document.querySelector<HTMLElement>('[role="alertdialog"]')!.click());
    expect(onCancel).not.toHaveBeenCalled();
    esc();
    act(() => backdrop().click());
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("열리면 돌아가기에 포커스, busy 재렌더로 옮겨지지 않고, 닫히면 연 버튼으로 돌아간다", () => {
    const trigger = document.body.appendChild(document.createElement("button"));
    trigger.focus();
    host();
    const input = createElement("input", { name: "reason" });
    act(() => root!.render(createElement(ConfirmDialog, props({}), input)));
    expect(document.activeElement?.textContent).toBe("돌아가기");
    const field = document.querySelector<HTMLInputElement>('input[name="reason"]')!;
    field.focus();
    act(() => root!.render(createElement(ConfirmDialog, props({ busy: true }), input)));
    expect(document.activeElement).toBe(field);
    act(() => root!.render(createElement(ConfirmDialog, props({ open: false }), input)));
    expect(document.activeElement).toBe(trigger);
  });
});
