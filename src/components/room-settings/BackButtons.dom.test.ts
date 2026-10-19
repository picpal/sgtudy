// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { setLeaveGuard } from "@/lib/leaveGuard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// next/link → <a>. 클릭하면 클라이언트 이동 직전처럼 onNavigate 를 부르고, 막히지 않았을 때만 이동을 기록한다
const moved = vi.hoisted(() => [] as string[]);
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, onNavigate, children, ...rest }: { href: string; onNavigate?: (e: { preventDefault: () => void }) => void; children?: unknown }) =>
      h(
        "a",
        {
          ...rest,
          href,
          onClick: (ev: MouseEvent) => {
            ev.preventDefault();
            let blocked = false;
            onNavigate?.({ preventDefault: () => (blocked = true) });
            if (!blocked) moved.push(href);
          },
        },
        children as never,
      ),
  };
});
const { SideBackRail, TopBackLink, backLabelOf } = await import("./BackButtons");

afterEach(() => {
  document.body.innerHTML = "";
  moved.length = 0;
});

const mount = (prev = "/my-study/aws") => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement("main", null, createElement(TopBackLink, { href: "/my-study/aws" }), createElement(SideBackRail, { href: prev })),
    ),
  );
  const links = [...host.querySelectorAll("a")];
  return { root, top: links.find((a) => a.textContent === "내 스터디로")!, side: links.find((a) => a.textContent === "이전 페이지")! };
};

describe("방 설정 돌아가기 버튼", () => {
  it("위쪽 '내 스터디로' 와 오른쪽 '이전 페이지' 가 둘 다 내 스터디로 가고, 44px 둥근 버튼 모양이다", () => {
    const { root, top, side } = mount();
    for (const a of [top, side]) {
      expect(a.getAttribute("href")).toBe("/my-study/aws");
      expect(a.className).toContain("h-11");
      expect(a.className).toContain("rounded-[22px]");
    }
    // 오른쪽 버튼은 카드 바깥 레일 끝에 sticky bottom, 좁은 화면에서는 레일째 숨긴다
    expect(side.className).toContain("sticky");
    const rail = document.querySelector('[data-testid="side-back-rail"]')!;
    expect(rail.className).toContain("right-full");
    expect(rail.className).toContain("hidden");
    act(() => root.unmount());
  });

  it("저장 안 한 수정이 있으면(가드) 두 버튼 모두 이동을 보류하고 가드에 목적지를 넘긴다", () => {
    const { root, top, side } = mount();
    const g = vi.fn(() => true);
    const off = setLeaveGuard(g);
    act(() => top.click());
    act(() => side.click());
    expect(g).toHaveBeenNthCalledWith(1, "/my-study/aws");
    expect(g).toHaveBeenNthCalledWith(2, "/my-study/aws");
    expect(moved).toEqual([]);
    off();
    act(() => side.click());
    expect(moved).toEqual(["/my-study/aws"]);
    act(() => root.unmount());
  });

  it("옆 '이전 페이지' 는 설정을 연 화면(방 보기)으로, 위쪽은 내 스터디 그대로 — 스크린리더에 목적지를 알린다", () => {
    const { root, top, side } = mount("/rooms/aws");
    expect(top.getAttribute("href")).toBe("/my-study/aws");
    expect(side.getAttribute("href")).toBe("/rooms/aws");
    expect(side.getAttribute("aria-label")).toBe("이전 페이지 — 방 보기로");
    expect(backLabelOf("/my-study/aws?tab=board")).toBe("이전 페이지 — 내 스터디로");
    // 방 보기는 /rooms/{slug} 정확히만 — 방 만들기·설정·쿼리는 방 보기로 읽지 않는다
    for (const h of ["/rooms/new", "/rooms/aws/settings", "/rooms/aws?x=1", "/my-study/aws"]) expect(backLabelOf(h), h).toBe("이전 페이지 — 내 스터디로");
    act(() => root.unmount());
  });

  it("가드가 있으면 방 보기로 가는 '이전 페이지' 도 보류되고, 가드는 그 목적지를 받는다 (확인 뒤 같은 곳으로)", () => {
    const { root, side } = mount("/rooms/aws");
    const g = vi.fn(() => true);
    const off = setLeaveGuard(g);
    act(() => side.click());
    expect(g).toHaveBeenCalledWith("/rooms/aws");
    expect(moved).toEqual([]);
    off();
    act(() => side.click());
    expect(moved).toEqual(["/rooms/aws"]);
    act(() => root.unmount());
  });
});
