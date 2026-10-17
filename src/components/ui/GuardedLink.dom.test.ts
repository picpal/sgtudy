// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setLeaveGuard } from "@/lib/leaveGuard";

// next/link 의 onNavigate(클라이언트 이동 직전)를 잡아 직접 부른다
const seen: { onNavigate?: (e: { preventDefault: () => void }) => void } = {};
vi.mock("next/link", () => ({
  default: (p: { onNavigate?: (e: { preventDefault: () => void }) => void; children?: unknown }) => {
    seen.onNavigate = p.onNavigate;
    return null;
  },
}));

describe("GuardedLink", async () => {
  const { GuardedLink } = await import("./GuardedLink");
  it("이동 직전 가드에 자기 주소를 묻고, 가드가 막으면 이동을 취소한다 · 넘겨준 onNavigate 도 부른다", () => {
    const own = vi.fn();
    renderToStaticMarkup(createElement(GuardedLink, { href: "/rooms/aws/settings", onNavigate: own }, "방 설정"));
    const g = vi.fn(() => true);
    const off = setLeaveGuard(g);
    const e = { preventDefault: vi.fn() };
    seen.onNavigate!(e);
    expect(g).toHaveBeenCalledWith("/rooms/aws/settings");
    expect(e.preventDefault).toHaveBeenCalled();
    expect(own).toHaveBeenCalled();
    off();
  });
});
