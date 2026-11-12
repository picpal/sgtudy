// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Toast, type ToastMsg } from "./Toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});
const render = (msg: ToastMsg, onClose: () => void) => {
  if (!root) root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root!.render(createElement(Toast, { msg, onClose })));
};
const box = () => document.querySelector<HTMLElement>('[role="status"],[role="alert"]')!;

describe("Toast", () => {
  it("글자만 있는 토스트는 4초 뒤 닫히고 클릭을 통과시킨다", () => {
    const onClose = vi.fn();
    render({ text: "저장했어요", tone: "ok" }, onClose);
    expect(box().className).toContain("pointer-events-none");
    act(() => void vi.advanceTimersByTime(3999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("버튼이 있으면 6초, 포커스가 안에 있는 동안은 닫히지 않는다", () => {
    const onClose = vi.fn();
    render({ text: "완료했어요", tone: "ok", action: { label: "되돌리기", onClick: () => {} } }, onClose);
    expect(box().className).toContain("pointer-events-auto");
    act(() => box().querySelector("button")!.focus());
    act(() => void vi.advanceTimersByTime(20000));
    expect(onClose).not.toHaveBeenCalled();
    act(() => box().querySelector("button")!.blur());
    act(() => void vi.advanceTimersByTime(5999));
    expect(onClose).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("마우스를 올린 동안도 닫히지 않는다", () => {
    const onClose = vi.fn();
    render({ text: "완료했어요", tone: "ok", action: { label: "되돌리기", onClick: () => {} } }, onClose);
    act(() => void box().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => void vi.advanceTimersByTime(20000));
    expect(onClose).not.toHaveBeenCalled();
  });
});
