// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomListResponse } from "@/lib/api/types";
import { MeProvider } from "@/lib/me";
import { HomeSkeleton } from "@/components/ui/Skeleton";
import { DEFAULT_FILTERS } from "./homeUrl";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, refresh: () => {}, prefetch: () => {} }) }));
vi.mock("@/lib/api/rooms", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/rooms")>()),
  fetchRooms: () => new Promise(() => {}),
}));
const { MainScreen } = await import("./MainScreen");

const initial = { items: [], today: "2026-10-12", tabCounts: { public: 0, mine: 0, created: 0 }, tagFacets: [] } as unknown as RoomListResponse;
const ANON = { me: null } as ComponentProps<typeof MeProvider>;
const screen = () => createElement(MeProvider, ANON, createElement(MainScreen, { initial, filters: DEFAULT_FILTERS }));

// ≤640 은 검색을 본문에, 그 위는 헤더에 둔다 — 헤더 높이가 화면마다 달라지면 메뉴를 누를 때마다 메뉴·본문이 움찔한다
describe("방 둘러보기 검색 위치", () => {
  const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(el);
    return root;
  };

  it("헤더에 끼운 요소는 ≤640 에서 줄째 사라지고, 본문 검색은 ≤640 에서만 보인다", () => {
    const d = render(screen());
    const inHeader = d.querySelector('header input[type="search"]')!;
    const inBody = d.querySelector('main input[type="search"]')!;
    expect(inHeader.closest("label")!.parentElement!.classList.contains("max-sm:hidden")).toBe(true);
    expect(inBody.closest("label")!.classList.contains("sm:hidden")).toBe(true);
    expect(inBody.closest("label")!.classList.contains("h-11")).toBe(true); // 누르는 영역 44px
  });

  it("골격도 같은 자리에 — 헤더 줄이 잠깐 생겼다 사라지지 않는다", () => {
    const d = render(createElement(MeProvider, ANON, createElement(HomeSkeleton)));
    expect(d.querySelector("header nav")!.parentElement!.querySelector(":scope > .max-sm\\:hidden")).not.toBeNull();
    expect(d.querySelector("main .sm\\:hidden.h-11")).not.toBeNull();
  });

  it("본문 검색에 친 글자는 헤더 검색과 같은 값이다(폭이 바뀌어도 검색어 유지)", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(screen()));
    const body = host.querySelector<HTMLInputElement>('main input[type="search"]')!;
    const header = host.querySelector<HTMLInputElement>('header input[type="search"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(body, "리액트");
      body.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(header.value).toBe("리액트");
    expect(body.value).toBe("리액트");
    await act(async () => root.unmount());
    host.remove();
  });
});
