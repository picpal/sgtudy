// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Room } from "@/data/room-view";
import { JoinCard } from "./JoinCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const room = {
  id: "sqld", archived: true, title: "SQLD", status: "recruit", draft: false, base: "archived", approval: true,
  ddayLong: "보관된 스터디 · 기록만 볼 수 있어요", capCur: 1, capMax: 6, minNeed: 0,
  members: [{ userId: "u1", name: "철수", tone: "blue", leader: false, me: true, pending: true }],
} as unknown as Room;
const btn = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

afterEach(() => {
  document.body.innerHTML = "";
});

// 백로그 F①: 보관된 방에서 승인 대기 중이면 "보관된 스터디" 안내와 함께 [신청 취소]
describe("JoinCard — 보관된 방의 승인 대기", () => {
  it("보관 안내 + 신청 취소 버튼", () => {
    const onCancel = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(JoinCard, { room, act: "pending", loginHref: "/login", onJoin: () => {}, onApply: () => {}, onCancel })));
    expect(btn(host, "보관된 스터디")?.disabled).toBe(true);
    expect(host.textContent).toContain("그룹장이 보관했어요 · 승인 대기 중인 신청은 취소할 수 있어요");
    expect(host.textContent).not.toContain("자동 만료");
    act(() => btn(host, "신청 취소")!.click());
    expect(onCancel).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
  it("보관 아닌 방의 승인 대기는 그대로", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(JoinCard, { room: { ...room, archived: false, base: "recruit" }, act: "pending", loginHref: "/login", onJoin: () => {}, onApply: () => {}, onCancel: () => {} })));
    expect(btn(host, "보관된 스터디")).toBeUndefined();
    expect(host.textContent).toContain("시작일까지 승인되지 않으면 신청이 자동 만료돼요");
    expect(btn(host, "신청 취소")).toBeDefined();
    act(() => root.unmount());
  });
});

// 0032: 진행중 방 참가 안내 (D12)
describe("JoinCard — 진행중 방 참가", () => {
  it("과제 안내 + 마감일 + 탈퇴 요청 안내", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(JoinCard, { room: { ...room, archived: false, status: "active", extraUntil: "2026-10-27" }, act: "join", loginHref: "/login", onJoin: () => {}, onApply: () => {}, onCancel: () => {} })));
    expect(host.textContent).toContain("진행중인 스터디예요 · 오늘 이후 마감인 과제부터 함께해요 · 10.27까지 모집");
    expect(host.textContent).toContain("참가 뒤에는 취소 대신 탈퇴 요청으로 나갈 수 있어요");
    act(() => root.unmount());
  });
});
