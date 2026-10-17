// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { ApiException } from "@/lib/api/errors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const api = vi.hoisted(() => ({ startRoom: vi.fn(), updateRoomEndDate: vi.fn(), openRecruit: vi.fn() }));
vi.mock("@/lib/api/leader", async (orig) => ({ ...(await orig<typeof import("@/lib/api/leader")>()), ...api }));

const { LeaderPanel } = await import("./LeaderPanel");

const detail = { slug: "r1", status: "recruit" as const, archived: false, isPublic: true, joinMode: "direct" as const, pendingCount: 0, invite: null, startDate: "2026-11-01", endDate: "2027-10-31" };
const flush = () => act(async () => {});
const btn = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// 0016: 예정보다 일찍 "지금 시작" → 시작일이 오늘로 당겨져 1년 상한(PERIOD_TOO_LONG)에 막히면 전용 안내 + 종료일 바꾸기
describe("LeaderPanel 지금 시작 — 기간 1년 초과", () => {
  it("전용 문구를 패널에 남기고, 종료일 바꾸기 → 상한으로 채운 날짜를 저장한다", async () => {
    api.startRoom.mockRejectedValue(new ApiException({ code: "PERIOD_TOO_LONG", message: "기간은 최대 1년이에요", details: { field: "endDate", maxEndDate: "2027-10-16" } }));
    api.updateRoomEndDate.mockResolvedValue({ ...detail, endDate: "2027-10-16", warnings: [] });
    const toast = vi.fn();
    const onDetail = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(LeaderPanel, { detail, toast, onDetail })));

    act(() => btn(host, "지금 시작")[0].click()); // 패널 버튼 → 확인 대화상자
    await act(async () => btn(host, "지금 시작").at(-1)!.click()); // 대화상자 확인
    await flush();

    const alert = host.querySelector("[data-start-block]")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("지금 시작하면 기간이 1년을 넘어요 · 종료일을 2027.10.16까지로 앞당긴 뒤 시작해 주세요");
    expect(toast).not.toHaveBeenCalled(); // 일반 오류 토스트로 흘려보내지 않는다

    act(() => btn(host, "종료일 바꾸기")[0].click());
    const input = host.querySelector<HTMLInputElement>("input[type=date]")!;
    expect(input.value).toBe("2027-10-16");
    expect(input.max).toBe("2027-10-16");
    expect(document.activeElement).toBe(input);

    await act(async () => btn(host, "저장")[0].click());
    await flush();
    expect(api.updateRoomEndDate).toHaveBeenCalledWith("r1", "2027-10-16");
    expect(onDetail).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ text: "종료일을 바꿨어요 · 이제 지금 시작할 수 있어요", tone: "ok" });
    expect(host.querySelector("[data-start-block]")).toBeNull();
    act(() => root.unmount());
  });

  it("다른 시작 오류는 그대로 토스트", async () => {
    api.startRoom.mockRejectedValue(new ApiException({ code: "ROOM_STATUS_INVALID", message: "x" }));
    const toast = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(LeaderPanel, { detail, toast })));
    act(() => btn(host, "지금 시작")[0].click());
    await act(async () => btn(host, "지금 시작").at(-1)!.click());
    await flush();
    expect(toast).toHaveBeenCalledWith({ text: "방 상태가 바뀌었어요 · 새로고침해 주세요", tone: "bad" });
    expect(host.querySelector("[data-start-block]")).toBeNull();
    act(() => root.unmount());
  });
});

// Q3-3: "모집 시작"은 공개된다는 안내와 함께 확인을 받는다
describe("LeaderPanel 모집 시작 — 확인 단계", () => {
  it("버튼은 확인 대화상자를 열고, 확인해야 room_open_recruit", async () => {
    api.openRecruit.mockResolvedValue({ ...detail, status: "recruit" });
    const toast = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(LeaderPanel, { detail: { ...detail, status: "draft" as const }, toast })));
    act(() => btn(host, "모집 시작")[0].click());
    expect(api.openRecruit).not.toHaveBeenCalled();
    const dialog = host.querySelector('[role="dialog"], [role="alertdialog"]')!;
    expect(dialog.textContent).toContain("모집을 시작할까요?");
    expect(dialog.textContent).toContain("전체 공개 방 목록에 보이고 누구나 바로 참가할 수 있어요");
    await act(async () => btn(host, "모집 시작").at(-1)!.click());
    await flush();
    expect(api.openRecruit).toHaveBeenCalledWith("r1");
    expect(toast).toHaveBeenCalledWith({ text: "모집을 시작했어요", tone: "ok" });
    act(() => root.unmount());
  });

  it("방 설정 링크", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(LeaderPanel, { detail, toast: vi.fn() })));
    expect(host.querySelector<HTMLAnchorElement>('a[href="/rooms/r1/settings"]')?.textContent).toContain("방 설정");
    act(() => root.unmount());
  });
});
