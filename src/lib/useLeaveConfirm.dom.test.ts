// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { guardNavigate } from "./leaveGuard";
import { useLeaveConfirm } from "./useLeaveConfirm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => act(() => root?.unmount()));
const box: { api: ReturnType<typeof useLeaveConfirm> | null } = { api: null };
const keep = (a: ReturnType<typeof useLeaveConfirm>) => {
  box.api = a;
};
function Probe({ dirty, go }: { dirty: boolean; go: (href: string) => void }) {
  keep(useLeaveConfirm(dirty, go));
  return null;
}
const mount = (dirty: boolean, go = vi.fn()) => {
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Probe, { dirty, go })));
  return go;
};
const nav = (href: string) => {
  const e = { preventDefault: vi.fn() };
  act(() => guardNavigate(href, e));
  return e.preventDefault;
};

describe("useLeaveConfirm (방 설정 등 폼 화면 — 저장 안 한 수정이 있으면 앱 안 링크 이동 전에 묻는다, Q2-1)", () => {
  it("수정이 없으면 막지 않는다", () => {
    mount(false);
    expect(nav("/tasks")).not.toHaveBeenCalled();
    expect(box.api!.pending).toBeNull();
  });
  it("수정이 있으면 막고 목적지를 보류 → 버리기 = 그 주소로, 계속 편집 = 보류 해제", () => {
    const go = mount(true);
    expect(nav("/schedule")).toHaveBeenCalled();
    expect(box.api!.pending).toBe("/schedule");
    act(() => box.api!.stay());
    expect(box.api!.pending).toBeNull();
    nav("/tasks");
    act(() => box.api!.leave());
    expect(go).toHaveBeenCalledWith("/tasks");
    expect(box.api!.pending).toBeNull();
  });
});
