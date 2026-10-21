// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ROOMS, ROOM_IDS } from "@/data/room-view";
import { RoomInfo } from "./RoomInfo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

// 방 화면(/rooms/[slug])에는 내 스터디 탭과 똑같이 생긴 "개요·진행목표·보드·캘린더·간트" 줄이 있었다 — 눌러도 아무 일도 없는 장식이라
// "탭이 클릭이 안 된다" 로 보였다. 방 화면은 탭이 없는 소개 화면 → 탭 모양 줄을 그리지 않는다
describe("RoomInfo — 누를 수 없는 탭 모양 줄을 그리지 않는다", () => {
  it("개요·진행목표·보드·캘린더·간트 줄이 없다", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(RoomInfo, { room: ROOMS[ROOM_IDS[0]], onShare: () => {}, more: [] })));
    expect(host.querySelector('[aria-label="방 상세 보기"]')).toBeNull();
    const spans = Array.from(host.querySelectorAll("span")).map((s) => s.textContent?.trim());
    for (const t of ["진행목표", "보드", "캘린더", "간트"]) expect(spans).not.toContain(t);
    act(() => root.unmount());
  });
});
