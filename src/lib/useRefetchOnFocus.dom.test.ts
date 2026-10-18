// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useRefetchOnFocus } from "./useRefetchOnFocus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ on, fn }: { on: boolean; fn: () => void }) {
  useRefetchOnFocus(on, fn);
  return null;
}

// 시나리오 QA #9: 승인 대기 화면을 열어 둔 채 다른 탭에서 승인 알림을 보고 돌아오면 새로 불러 "참가중" 으로
describe("useRefetchOnFocus", () => {
  it("켜져 있을 때만, 창으로 돌아오면(포커스·보이기) 다시 부른다", () => {
    const fn = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(Probe, { on: true, fn })));
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fn).toHaveBeenCalledTimes(1);
    // 탭으로 돌아오면 focus 와 visibilitychange 가 같이 온다 — 한 번만 (최종 리뷰 Minor 2)
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(fn).toHaveBeenCalledTimes(1);
    now.mockReturnValue(12_000);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(fn).toHaveBeenCalledTimes(2);
    act(() => root.render(createElement(Probe, { on: false, fn })));
    now.mockReturnValue(20_000);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fn).toHaveBeenCalledTimes(2);
    now.mockRestore();
    act(() => root.unmount());
  });
});
