// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ROOMS } from "@/data/my-study";
import { ROOMS as VIEW_ROOMS, ROOM_IDS } from "@/data/room-view";
import { RoomInfo } from "@/components/room-view/RoomInfo";
import type { StudyRoom } from "@/lib/api/my-study";
import { META_OPEN_KEY, StudyHeaderInfo, type TabId } from "./StudyHeaderInfo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const room = { ...ROOMS.aws, action: "joined", draft: false, archived: false, leaveRequest: null } as StudyRoom;
const header = (tab: TabId = "overview") => createElement(StudyHeaderInfo, { room, tab, onTab: () => {}, onShare: () => {}, more: [] });

const mount = (tab?: TabId) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(header(tab)));
  return { host, root };
};
const toggle = (host: HTMLElement) => host.querySelector<HTMLButtonElement>("button[aria-controls=my-study-room-meta]")!;
const meta = (host: HTMLElement) => host.querySelector<HTMLElement>("#my-study-room-meta")!;

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
});

// 참가한 뒤엔 기간·참가 방식·공개 범위가 덜 중요하다 — 기본은 접고 상태·D-day 만, 이번 회차 카드가 위로 올라오게
describe("StudyHeaderInfo 방 정보 접기", () => {
  it("기본은 접힘 — 목록은 숨기고 상태 배지·D-day 한 줄만, 공유 버튼은 그대로", () => {
    const { host } = mount();
    const b = toggle(host);
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.getAttribute("aria-label")).toBe("방 정보 펼치기");
    expect(b.classList.contains("size-11")).toBe(true);
    expect(meta(host).hidden).toBe(true);
    const summary = host.querySelector("[data-room-meta-summary]");
    expect(summary?.textContent).toContain("진행중");
    expect(summary?.textContent).toContain(room.dday);
    expect(host.querySelector('button[aria-label="공유"]')).not.toBeNull();
  });

  it("서버 렌더도 접힌 상태(저장소를 읽지 않는다)", () => {
    window.localStorage.setItem(META_OPEN_KEY, "1");
    const d = document.createElement("div");
    d.innerHTML = renderToStaticMarkup(header());
    expect(d.querySelector("#my-study-room-meta")?.hasAttribute("hidden")).toBe(true);
  });

  it("누르면 펼치고(요약 줄 사라짐) 다시 누르면 접는다", () => {
    const { host } = mount();
    act(() => toggle(host).click());
    expect(toggle(host).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(host).getAttribute("aria-label")).toBe("방 정보 접기");
    expect(meta(host).hidden).toBe(false);
    expect(meta(host).textContent).toContain("참가 방식");
    expect(host.querySelector("[data-room-meta-summary]")).toBeNull();
    act(() => toggle(host).click());
    expect(meta(host).hidden).toBe(true);
    expect(window.localStorage.getItem(META_OPEN_KEY)).toBeNull();
  });

  it("펼친 선택은 이 브라우저에 하나로 기억 — 다른 방·다시 열어도 펼친 채", () => {
    const first = mount();
    act(() => toggle(first.host).click());
    expect(window.localStorage.getItem(META_OPEN_KEY)).toBe("1");
    act(() => first.root.unmount());
    const { host } = mount();
    expect(toggle(host).getAttribute("aria-expanded")).toBe("true");
    expect(meta(host).hidden).toBe(false);
  });

  it("개요 탭이 아니면 방 정보 줄·토글이 없다", () => {
    const { host } = mount("board");
    expect(host.querySelector("#my-study-room-meta")).toBeNull();
    expect(host.querySelector("button[aria-controls=my-study-room-meta]")).toBeNull();
  });

  it("방 둘러보기 방 화면(RoomInfo)은 저장값과 상관없이 늘 펼친 그대로 — 토글 없음", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(RoomInfo, { room: VIEW_ROOMS[ROOM_IDS[0]], onShare: () => {}, more: [] })));
    const dl = host.querySelector("dl")!;
    expect(dl.hidden).toBe(false);
    expect(dl.textContent).toContain("참가 방식");
    expect(host.querySelector("[aria-expanded]")).toBeNull();
    act(() => root.unmount());
  });
});
