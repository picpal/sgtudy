// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { RoomDetail } from "@/lib/api/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ openExtraRecruit: vi.fn(), closeExtraRecruit: vi.fn(), setInviteBypass: vi.fn(), fetchInvite: vi.fn(), rotateInvite: vi.fn() }));
vi.mock("@/lib/api/recruit", async (orig) => ({ ...(await orig<typeof import("@/lib/api/recruit")>()), openExtraRecruit: api.openExtraRecruit, closeExtraRecruit: api.closeExtraRecruit, setInviteBypass: api.setInviteBypass }));
vi.mock("@/lib/api/leader", async (orig) => ({ ...(await orig<typeof import("@/lib/api/leader")>()), fetchInvite: api.fetchInvite, rotateInvite: api.rotateInvite }));
const { RecruitInviteSection } = await import("./RecruitInviteSection");
const { ApiException } = await import("@/lib/api/errors");

const base = {
  today: "2026-10-12", slug: "aws", status: "active", archived: false, isPublic: true, joinMode: "approval",
  startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, memberCount: 4, pendingCount: 1,
  recruit: { open: false, extraUntil: null },
  invite: { url: "/invite/seed-aws", token: "seed-aws", code: "K7QM3XPA", bypass: null },
} as unknown as RoomDetail;
const html = (d: Partial<RoomDetail>) => renderToStaticMarkup(createElement(RecruitInviteSection, { detail: { ...base, ...d } as RoomDetail, toast: () => {}, onDetail: () => {} }));

describe("RecruitInviteSection", () => {
  it("active closed: start form with defaults, code shown formatted", () => {
    const h = html({});
    expect(h).toContain("추가 모집 시작");
    expect(h).toContain('value="2026-10-19"'); // 오늘+7
    expect(h).toContain('max="2026-11-11"'); // 오늘+30
    expect(h).toContain("K7QM-3XPA");
    expect(h).toContain("모집이 끝나도 이 초대로 바로 참가");
  });
  it("open window: status line and close button", () => {
    const h = html({ recruit: { open: true, extraUntil: "2026-10-27" } });
    expect(h).toContain("10.27"); // mmdd() 표기
    expect(h).toContain("지금 마감");
    expect(h).toContain("승인 대기 1명");
  });
  it("recruit room: invite card only; archived/ended: nothing", () => {
    expect(html({ status: "recruit", recruit: { open: true, extraUntil: null } })).not.toContain("추가 모집 시작");
    expect(html({ status: "ended" })).toBe("");
    expect(html({ archived: true })).toBe("");
  });
  it("bypass on but inactive → warning", () => {
    expect(html({ invite: { ...base.invite!, bypass: { until: "2026-10-11", max: 2, used: 2, active: false } } })).toContain("기한이 지났거나 인원이 찼어요 · 기한·인원을 늘리거나 새 코드로 바꿔 주세요");
  });
  it("code is mono, no-wrap; buttons are 44px", () => {
    const h = html({});
    expect(h).toMatch(/class="[^"]*font-mono[^"]*whitespace-nowrap[^"]*"[^>]*>K7QM-3XPA/);
    const buttons = h.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) if (!b.includes('role="switch"')) expect(b).toMatch(/h-11|min-h-11/);
  });
});

/* ── 동작 ── */
const flush = () => act(async () => {});
afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});
const mount = (d: Partial<RoomDetail> = {}) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const toast = vi.fn();
  const onDetail = vi.fn();
  act(() => root.render(createElement(RecruitInviteSection, { detail: { ...base, ...d } as RoomDetail, toast, onDetail })));
  const btn = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label) as HTMLButtonElement;
  const input = (n: string) => host.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
  return { host, root, toast, onDetail, btn, input };
};
const type = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("RecruitInviteSection — 추가 모집", () => {
  it("시작: 입력값으로 openExtraRecruit → onDetail(next, open 칸) + 토스트", async () => {
    const next = { ...base, maxMembers: 7, recruit: { open: true, extraUntil: "2026-10-19" } } as RoomDetail;
    api.openExtraRecruit.mockResolvedValue(next);
    const m = mount();
    expect(m.input("recruitMax").value).toBe("6");
    type(m.input("recruitMax"), "7");
    act(() => m.btn("추가 모집 시작").click());
    await flush();
    expect(api.openExtraRecruit).toHaveBeenCalledWith("aws", { until: "2026-10-19", maxMembers: 7, joinMode: "approval" });
    expect(m.onDetail).toHaveBeenCalledWith(next, ["maxMembers", "joinMode"]);
    expect(m.toast).toHaveBeenCalledWith({ text: "추가 모집을 시작했어요 · 10.19까지", tone: "ok" });
    act(() => m.root.unmount());
  });
  it("위 폼이 정원·방식을 저장하면(props 변경) 카드 칸도 새 값으로 — 고른 마감일은 그대로 (리뷰 I-1)", async () => {
    api.openExtraRecruit.mockResolvedValue(base);
    const m = mount();
    type(m.input("recruitUntil"), "2026-10-25");
    type(m.input("recruitMax"), "7");
    act(() => m.root.render(createElement(RecruitInviteSection, { detail: { ...base, maxMembers: 9, joinMode: "direct" } as RoomDetail, toast: m.toast, onDetail: m.onDetail })));
    expect(m.input("recruitMax").value).toBe("9");
    expect(m.input("recruitUntil").value).toBe("2026-10-25");
    act(() => m.btn("추가 모집 시작").click());
    await flush();
    expect(api.openExtraRecruit).toHaveBeenCalledWith("aws", { until: "2026-10-25", maxMembers: 9, joinMode: "direct" });
    act(() => m.root.unmount());
  });
  it("같은 props 로 다시 그려도 카드에서 고친 정원은 남는다", () => {
    const m = mount();
    type(m.input("recruitMax"), "8");
    act(() => m.root.render(createElement(RecruitInviteSection, { detail: { ...base } as RoomDetail, toast: m.toast, onDetail: m.onDetail })));
    expect(m.input("recruitMax").value).toBe("8");
    act(() => m.root.unmount());
  });
  it("INVALID_PERIOD·CAPACITY_NO_SEAT 는 해당 칸 아래 줄 오류", async () => {
    api.openExtraRecruit.mockRejectedValueOnce(new ApiException({ code: "CAPACITY_NO_SEAT", message: "빈자리가 없어요 · 정원을 늘려 주세요", details: { field: "maxMembers" } }));
    const m = mount();
    act(() => m.btn("추가 모집 시작").click());
    await flush();
    const err = m.input("recruitMax").closest("div")!.parentElement!.querySelector('[role="alert"]');
    expect(err?.textContent).toBe("빈자리가 없어요 · 정원을 늘려 주세요");
    expect(m.onDetail).not.toHaveBeenCalled();
    api.openExtraRecruit.mockRejectedValueOnce(new ApiException({ code: "INVALID_PERIOD", message: "추가 모집 마감일은 오늘부터 30일 안, 스터디 종료일까지예요", details: { field: "recruitUntil" } }));
    act(() => m.btn("추가 모집 시작").click());
    await flush();
    expect(m.host.textContent).toContain("추가 모집 마감일은 오늘부터 30일 안, 스터디 종료일까지예요");
    act(() => m.root.unmount());
  });
  it("지금 마감: 확인 창 → closeExtraRecruit → onDetail(next, [])", async () => {
    const next = { ...base, recruit: { open: false, extraUntil: null }, pendingCount: 0 } as RoomDetail;
    api.closeExtraRecruit.mockResolvedValue(next);
    const m = mount({ recruit: { open: true, extraUntil: "2026-10-27" } });
    act(() => m.btn("지금 마감").click());
    expect(document.body.textContent).toContain("추가 모집을 마감할까요?");
    expect(document.body.textContent).toContain("승인 대기 1명의 신청은 만료돼요");
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === "마감") as HTMLButtonElement;
    act(() => confirm.click());
    await flush();
    expect(api.closeExtraRecruit).toHaveBeenCalledWith("aws");
    expect(m.onDetail).toHaveBeenCalledWith(next, []);
    act(() => m.root.unmount());
  });
});

describe("RecruitInviteSection — 초대", () => {
  it("코드가 없으면 마운트 때 fetchInvite 로 채운다", async () => {
    api.fetchInvite.mockResolvedValue({ today: "2026-10-12", token: "t", url: "/invite/t", code: "ABCD2345", bypass: null });
    const m = mount({ invite: null });
    await flush();
    expect(api.fetchInvite).toHaveBeenCalledWith("aws");
    expect(m.host.textContent).toContain("ABCD-2345");
    act(() => m.root.unmount());
  });
  it("코드 복사 · 링크 복사", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const m = mount();
    act(() => m.btn("초대 코드 복사").click());
    await flush();
    expect(writeText).toHaveBeenLastCalledWith("K7QM-3XPA");
    act(() => m.btn("초대 링크 복사").click());
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/invite/seed-aws`);
    act(() => m.root.unmount());
  });
  it("바로 참가: 켜면 기본 기한으로 펼치고 [저장] → setInviteBypass, 끄면 즉시 null", async () => {
    api.setInviteBypass.mockResolvedValueOnce({ today: "2026-10-12", token: "seed-aws", url: "/invite/seed-aws", code: "K7QM3XPA", bypass: { until: "2026-10-19", max: 3, used: 0, active: true } });
    const m = mount();
    act(() => m.host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(m.input("bypassUntil").value).toBe("2026-10-19");
    type(m.input("bypassMax"), "3");
    act(() => m.btn("바로 참가 저장").click());
    await flush();
    expect(api.setInviteBypass).toHaveBeenCalledWith("aws", "2026-10-19", 3);
    expect(m.host.textContent).toContain("0명 사용 / 3명 · 승인 없이 바로 참가해요");
    api.setInviteBypass.mockResolvedValueOnce({ today: "2026-10-12", token: "seed-aws", url: "/invite/seed-aws", code: "K7QM3XPA", bypass: null });
    act(() => m.host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await flush();
    expect(api.setInviteBypass).toHaveBeenLastCalledWith("aws", null, null);
    expect(m.host.querySelector('input[name="bypassUntil"]')).toBeNull();
    act(() => m.root.unmount());
  });
  it("끄기 실패 → 스위치 되돌림", async () => {
    api.setInviteBypass.mockRejectedValueOnce(new ApiException({ code: "UNKNOWN", message: "실패" }));
    const m = mount({ invite: { ...base.invite!, bypass: { until: "2026-10-19", max: null, used: 1, active: true } } });
    const sw = () => m.host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    act(() => sw().click());
    await flush();
    expect(sw().getAttribute("aria-checked")).toBe("true");
    expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "bad" }));
    act(() => m.root.unmount());
  });
  it("새 코드로 바꾸기: 확인 창(바로 참가도 꺼져요) → rotateInvite → 새 코드", async () => {
    api.rotateInvite.mockResolvedValue({ today: "2026-10-12", token: "n", url: "/invite/n", code: "NEWC0DE9", bypass: null });
    const m = mount({ invite: { ...base.invite!, bypass: { until: "2026-10-19", max: null, used: 1, active: true } } });
    act(() => m.btn("새 코드로 바꾸기").click());
    expect(document.body.textContent).toContain("바로 참가 설정도 꺼져요");
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === "새 코드 만들기") as HTMLButtonElement;
    act(() => confirm.click());
    await flush();
    expect(api.rotateInvite).toHaveBeenCalledWith("aws");
    expect(m.host.textContent).toContain("NEWC-0DE9");
    expect(m.host.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
    act(() => m.root.unmount());
  });
});
