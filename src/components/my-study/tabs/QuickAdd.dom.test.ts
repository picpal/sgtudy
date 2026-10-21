// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QuickAdd } from "./QuickAdd";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, REF_DAY } from "../fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const round = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).roots[0];

const mount = (onClose = vi.fn(), onAdd = vi.fn(async () => true)) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(QuickAdd, { round, indent: 0, onAdd, onClose })));
  const input = host.querySelector<HTMLInputElement>("input")!;
  const btn = (t: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === t)!;
  const done = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, input, btn, onClose, onAdd, done };
};

/** 실제 마우스 클릭 순서 — mousedown 의 기본 동작으로 포커스가 옮겨진다.
 *  Safari·macOS Firefox 는 버튼을 눌러도 버튼에 포커스를 주지 않아 입력의 blur 가 relatedTarget=null 로 온다 */
const realClick = (el: HTMLElement, focusesButton: boolean) => {
  act(() => {
    const ok = el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    if (ok) {
      if (focusesButton) el.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
  });
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.click();
  });
};

describe("QuickAdd 공통/지정 전환", () => {
  for (const [name, focusesButton] of [["Safari·Firefox(버튼에 포커스 없음)", false], ["Chromium(버튼에 포커스)", true]] as const) {
    it(`${name}: 빈 입력에서 '지정' 을 눌러도 닫히지 않고 유형이 바뀐다`, () => {
      const t = mount();
      t.input.focus();
      realClick(t.btn("지정"), focusesButton);
      expect(t.onClose).not.toHaveBeenCalled();
      expect(t.host.querySelector("input")).not.toBeNull();
      expect(t.btn("지정").getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(t.host.querySelector("input"));
      t.done();
    });
  }

  it("키보드: Tab 으로 '지정' 에 가서 Space/Enter(click) 해도 닫히지 않는다", () => {
    const t = mount();
    t.input.focus();
    act(() => t.btn("지정").focus());
    expect(t.onClose).not.toHaveBeenCalled();
    act(() => t.btn("지정").click());
    expect(t.btn("지정").getAttribute("aria-pressed")).toBe("true");
    expect(t.onClose).not.toHaveBeenCalled();
    t.done();
  });

  it("빈 입력에서 줄 밖으로 포커스가 나가면 닫힌다", () => {
    const t = mount();
    const outside = document.body.appendChild(document.createElement("button"));
    t.input.focus();
    act(() => outside.focus());
    expect(t.onClose).toHaveBeenCalledTimes(1);
    outside.remove();
    t.done();
  });

  it("Esc 로 닫힌다", () => {
    const t = mount();
    t.input.focus();
    act(() => t.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(t.onClose).toHaveBeenCalledTimes(1);
    t.done();
  });

  it("'지정' 으로 바꾼 뒤 Enter 로 만든 과제는 지정 유형", async () => {
    const t = mount();
    t.input.focus();
    realClick(t.btn("지정"), false);
    const input = t.host.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "새 과제");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(t.onAdd).toHaveBeenCalledWith("새 과제", "지정");
    t.done();
  });
});
