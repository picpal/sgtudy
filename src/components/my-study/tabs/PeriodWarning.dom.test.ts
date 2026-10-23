// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const api = vi.hoisted(() => ({ updateRoomEndDate: vi.fn(), updateRoomStartDate: vi.fn() }));
vi.mock("@/lib/api/leader", async (orig) => ({ ...(await orig<typeof import("@/lib/api/leader")>()), ...api }));

const { PeriodWarning } = await import("./PeriodWarning");
const { TodayProvider } = await import("@/lib/today");

const gap = { count: 3, text: "회차 3개가 스터디 기간(10.15 – 10.23)을 벗어나요", fitEnd: "2026-11-25", fitStart: null, before: false, key: "b:|a:r7,r8" };
const beforeGap = { count: 5, text: "회차 1개·과제 4개가 스터디 기간(10.08 – 12.31)을 벗어나요", fitEnd: null, fitStart: "2026-10-01", before: true, key: "b:r1|a:" };
type P = Parameters<typeof PeriodWarning>[0];
const base: P = { gap, slug: "aws", roomStatus: "active", canEdit: false, isLeader: false, onEditRounds: () => {}, toast: () => {} };

const mount = (p: Partial<P>) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(TodayProvider, { today: "2026-10-12" } as Parameters<typeof TodayProvider>[0], createElement(PeriodWarning, { ...base, ...p }))));
  return { host, root };
};
const labels = (host: HTMLElement) => Array.from(host.querySelectorAll("button")).map((b) => b.textContent?.trim());

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("PeriodWarning (방 기간을 벗어난 회차)", () => {
  it("팀원에게는 경고 줄만", () => {
    const { host } = mount({});
    expect(host.querySelector("[data-period-warning]")?.textContent).toContain("회차 3개가 스터디 기간(10.15 – 10.23)을 벗어나요");
    expect(labels(host)).toEqual([]);
    // 낭독 영역은 문구 span 만 — 버튼·폼(hint·오류 alert)까지 감싸지 않는다
    const status = host.querySelectorAll("[role=status]");
    expect(status.length).toBe(1);
    expect(status[0].textContent).toBe("회차 3개가 스터디 기간(10.15 – 10.23)을 벗어나요");
  });
  it("편집자: 회차 편집으로 (보기·개요에서). 편집 모드 안에서는 버튼 대신 안내", () => {
    const onEditRounds = vi.fn();
    const { host } = mount({ canEdit: true, onEditRounds });
    expect(labels(host)).toEqual(["회차 기간 고치기", "그대로 두기"]);
    act(() => host.querySelector("button")!.click());
    expect(onEditRounds).toHaveBeenCalled();
    document.body.innerHTML = "";
    const inEdit = mount({ canEdit: true, onEditRounds: undefined });
    expect(labels(inEdit.host)).toEqual(["그대로 두기"]);
    expect(inEdit.host.textContent).toContain("회차를 눌러 기간을 고쳐 주세요");
  });
  it("그룹장: 종료일 늘리기 → 마지막 마감으로 채운 폼 → 저장", async () => {
    api.updateRoomEndDate.mockResolvedValue({});
    const toast = vi.fn();
    const { host } = mount({ canEdit: true, isLeader: true, toast });
    expect(labels(host)).toEqual(["회차 기간 고치기", "그대로 두기", "종료일 늘리기"]);
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "종료일 늘리기")!.click());
    const input = host.querySelector<HTMLInputElement>("input[type=date]")!;
    expect(input.value).toBe("2026-11-25");
    expect(input.min).toBe("2026-11-25");
    expect(host.textContent).toContain("진행중에는 마지막 마감 이후로만 바꿀 수 있어요");
    expect(host.querySelector("[role=status]")?.contains(input)).toBe(false);
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "저장")!.click());
    expect(api.updateRoomEndDate).toHaveBeenCalledWith("aws", "2026-11-25");
    expect(toast).toHaveBeenCalledWith({ text: "종료일을 바꿨어요 · 일정이 스터디 기간 안에 들어와요", tone: "ok" });
  });
  it("모집중 방: 진행중 전제 문구 없이, 앞당길 날이 지났으면 시작일 앞 일정은 회차 기간을 고치라고", () => {
    const { host } = mount({ gap: { ...gap, before: true, fitStart: "2026-10-10" }, roomStatus: "recruit", canEdit: true, isLeader: true });
    expect(host.textContent).toContain("시작일 앞에 걸친 일정은 회차 기간을 고쳐 맞춰 주세요");
    expect(host.textContent).not.toContain("진행중");
    expect(labels(host)).not.toContain("시작일 앞당기기");
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "종료일 늘리기")!.click());
    expect(host.textContent).toContain("마지막 마감 11.25");
    expect(host.textContent).not.toContain("진행중");
  });
  it("진행중 방 + 시작일 앞 일정 · 그룹장: 시작일 앞당기기 → 가장 이른 시작으로 채운 폼(오늘까지) → 저장", async () => {
    api.updateRoomStartDate.mockResolvedValue({});
    const toast = vi.fn();
    const { host } = mount({ gap: beforeGap, canEdit: true, isLeader: true, toast });
    expect(host.textContent).not.toContain("시작일을 바꿀 수 없어요");
    expect(host.textContent).toContain("이미 진행해 온 스터디라면 시작일을 앞당겨 지난 주차까지 기간에 넣어 주세요");
    expect(labels(host)).toEqual(["회차 기간 고치기", "그대로 두기", "시작일 앞당기기"]);
    act(() => host.querySelector<HTMLButtonElement>("[data-pull-start]")!.click());
    const input = host.querySelector<HTMLInputElement>("input[type=date]")!;
    expect(host.textContent).toContain("새 시작일");
    expect([input.value, input.max, input.min]).toEqual(["2026-10-01", "2026-10-12", ""]);
    expect(host.textContent).toContain("가장 이른 일정 10.01");
    expect(host.textContent).toContain("지금 제출하면 지각으로 표시돼요");
    await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "저장")!.click());
    expect(api.updateRoomStartDate).toHaveBeenCalledWith("aws", "2026-10-01");
    expect(api.updateRoomEndDate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ text: "시작일을 바꿨어요 · 일정이 스터디 기간 안에 들어와요", tone: "ok" });
  });
  it("진행중 방 + 시작일 앞 일정 · 그룹장 아닌 편집자: 버튼 없이 그룹장이 앞당길 수 있다고", () => {
    const { host } = mount({ gap: beforeGap, canEdit: true });
    expect(labels(host)).toEqual(["회차 기간 고치기", "그대로 두기"]);
    expect(host.textContent).toContain("시작일 앞에 걸친 일정은 회차 기간을 고쳐 맞춰 주세요 · 시작일은 그룹장이 앞당길 수 있어요");
  });
  it("종료일로 못 맞추면(fitEnd null) 그룹장에게도 회차 편집만", () => {
    const { host } = mount({ gap: { ...gap, fitEnd: null }, canEdit: true, isLeader: true });
    expect(labels(host)).toEqual(["회차 기간 고치기", "그대로 두기"]);
  });
  it("그대로 두기: 이 브라우저에서 숨기고, 벗어난 회차(key)가 바뀌면 다시 보인다", () => {
    const toast = vi.fn();
    const { host, root } = mount({ canEdit: true, toast });
    act(() => host.querySelector<HTMLButtonElement>("[data-keep-period]")!.click());
    expect(host.querySelector("[data-period-warning]")).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "ok" }));
    expect(window.localStorage.getItem("sgtudy:period-kept:aws")).toBe(gap.key);
    // 팀원(편집 권한 없음)에게는 숨김이 적용되지 않는다 — 버튼도 없다
    act(() => root.render(createElement(TodayProvider, { today: "2026-10-12" } as Parameters<typeof TodayProvider>[0], createElement(PeriodWarning, { ...base }))));
    expect(host.querySelector("[data-period-warning]")).not.toBeNull();
    document.body.innerHTML = "";
    const changed = mount({ canEdit: true, gap: { ...gap, key: "b:|a:r6,r7,r8" } });
    expect(changed.host.querySelector("[data-period-warning]")).not.toBeNull();
  });
  // 회귀(2026-10-23 사용자 보고): 「그대로 두기」 뒤 과제를 더하거나 종료일을 늘리면 문구(개수·기간)가 바뀌어 들어올 때마다 다시 떴다
  it("그대로 두기: 같은 회차에서 개수·기간 문구만 바뀌면 숨김 유지 (다시 들어와도)", () => {
    const first = mount({ canEdit: true });
    act(() => first.host.querySelector<HTMLButtonElement>("[data-keep-period]")!.click());
    act(() => first.root.unmount());
    document.body.innerHTML = "";
    const again = mount({ canEdit: true, gap: { ...gap, count: 9, text: "회차 3개·과제 6개가 스터디 기간(10.15 – 2027.01.03)을 벗어나요" } });
    expect(again.host.querySelector("[data-period-warning]")).toBeNull();
  });
  it("서버 렌더에서는 편집자에게 그리지 않는다 — 숨긴 경고가 하이드레이션 동안 번쩍이지 않게. 하이드레이션 뒤 숨기지 않았으면 보인다", async () => {
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const el = (p: Partial<P>) => createElement(TodayProvider, { today: "2026-10-12" } as Parameters<typeof TodayProvider>[0], createElement(PeriodWarning, { ...base, ...p }));
    expect(renderToString(el({ canEdit: true }))).not.toContain("data-period-warning");
    expect(renderToString(el({}))).toContain("data-period-warning");
    window.localStorage.setItem("sgtudy:period-kept:aws", gap.key);
    const host = document.body.appendChild(document.createElement("div"));
    host.innerHTML = renderToString(el({ canEdit: true }));
    await act(async () => void hydrateRoot(host, el({ canEdit: true })));
    expect(host.querySelector("[data-period-warning]")).toBeNull();
    window.localStorage.clear();
    const host2 = document.body.appendChild(document.createElement("div"));
    host2.innerHTML = renderToString(el({ canEdit: true }));
    await act(async () => void hydrateRoot(host2, el({ canEdit: true })));
    expect(host2.querySelector("[data-period-warning]")).not.toBeNull();
  });
});
