import { describe, expect, it, vi } from "vitest";
import { guardNavigate, setLeaveGuard } from "./leaveGuard";

describe("leaveGuard (Q2-1 — 저장하지 않은 편집이 있으면 앱 안 링크 이동을 보류)", () => {
  const ev = () => ({ preventDefault: vi.fn() });
  it("가드가 없으면 그대로 이동", () => {
    const e = ev();
    guardNavigate("/tasks", e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
  it("가드가 true 를 돌려주면 이동을 막고, 주소를 넘긴다", () => {
    const g = vi.fn(() => true);
    const off = setLeaveGuard(g);
    const e = ev();
    guardNavigate("/schedule", e);
    expect(g).toHaveBeenCalledWith("/schedule");
    expect(e.preventDefault).toHaveBeenCalled();
    off();
    const e2 = ev();
    guardNavigate("/schedule", e2);
    expect(e2.preventDefault).not.toHaveBeenCalled();
  });
  it("뒤에 건 가드가 이미 바뀌었으면 앞 가드의 해제는 뒤 가드를 지우지 않는다", () => {
    const off1 = setLeaveGuard(() => true);
    const off2 = setLeaveGuard(() => true);
    off1();
    const e = ev();
    guardNavigate("/", e);
    expect(e.preventDefault).toHaveBeenCalled();
    off2();
  });
});
