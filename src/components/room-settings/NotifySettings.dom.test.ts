// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ fetchNotifySettings: vi.fn(), putNotifySettings: vi.fn() }));
vi.mock("@/lib/api/leader", async (orig) => ({ ...(await orig<typeof import("@/lib/api/leader")>()), ...api }));
const { NotifySettingsSection } = await import("./NotifySettings");

const S = { reminderD1: true, reminderD3: true, taskAssigned: true, scheduleChanged: true, roomStartEnd: true, completionMode: "daily" as const, submissionDigest: true };
const flush = () => act(async () => {});
afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// 0025·오케스트레이터 결정: 그룹장이 "제출 하루 요약" 알림을 끌 수 있다 — 방 설정의 알림 설정
describe("NotifySettingsSection", () => {
  it("불러온 값으로 스위치를 그리고, 제출 하루 요약을 끄면 전체 값을 저장한다", async () => {
    api.fetchNotifySettings.mockResolvedValue(S);
    api.putNotifySettings.mockImplementation(async (_s: string, v: typeof S) => v);
    const toast = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(NotifySettingsSection, { slug: "r1", toast })));
    await flush();
    const sw = host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="팀원 제출 하루 요약"]')!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await act(async () => sw.click());
    await flush();
    expect(api.putNotifySettings).toHaveBeenCalledWith("r1", { ...S, submissionDigest: false });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(toast).toHaveBeenCalledWith({ text: "팀원 제출 하루 요약을 껐어요", tone: "ok" });
    act(() => root.unmount());
  });
  it("저장에 실패하면 되돌린다", async () => {
    api.fetchNotifySettings.mockResolvedValue(S);
    api.putNotifySettings.mockRejectedValue(new Error("x"));
    const toast = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(NotifySettingsSection, { slug: "r1", toast })));
    await flush();
    const sw = host.querySelector<HTMLButtonElement>('[role="switch"][aria-label="마감 하루 전 알림"]')!;
    await act(async () => sw.click());
    await flush();
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "bad" }));
    act(() => root.unmount());
  });
});
