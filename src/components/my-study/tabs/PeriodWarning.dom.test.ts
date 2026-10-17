// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
const api = vi.hoisted(() => ({ updateRoomEndDate: vi.fn() }));
vi.mock("@/lib/api/leader", async (orig) => ({ ...(await orig<typeof import("@/lib/api/leader")>()), ...api }));

const { PeriodWarning } = await import("./PeriodWarning");

const gap = { count: 3, text: "회차 3개가 스터디 기간(10.15 – 10.23)을 벗어나요", fitEnd: "2026-11-25", before: false };
type P = Parameters<typeof PeriodWarning>[0];
const base: P = { gap, slug: "aws", roomStatus: "active", canEdit: false, isLeader: false, onEditRounds: () => {}, toast: () => {} };

const mount = (p: Partial<P>) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(PeriodWarning, { ...base, ...p })));
  return { host, root };
};
const labels = (host: HTMLElement) => Array.from(host.querySelectorAll("button")).map((b) => b.textContent?.trim());

afterEach(() => {
  document.body.innerHTML = "";
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
    expect(labels(host)).toEqual(["회차 기간 고치기"]);
    act(() => host.querySelector("button")!.click());
    expect(onEditRounds).toHaveBeenCalled();
    document.body.innerHTML = "";
    const inEdit = mount({ canEdit: true, onEditRounds: undefined });
    expect(labels(inEdit.host)).toEqual([]);
    expect(inEdit.host.textContent).toContain("회차를 눌러 기간을 고쳐 주세요");
  });
  it("그룹장: 종료일 늘리기 → 마지막 마감으로 채운 폼 → 저장", async () => {
    api.updateRoomEndDate.mockResolvedValue({});
    const toast = vi.fn();
    const { host } = mount({ canEdit: true, isLeader: true, toast });
    expect(labels(host)).toEqual(["회차 기간 고치기", "종료일 늘리기"]);
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
  it("모집중 방: 진행중 전제 문구 없이, 시작일 앞 일정은 회차 기간을 고치라고", () => {
    const { host } = mount({ gap: { ...gap, before: true }, roomStatus: "recruit", canEdit: true, isLeader: true });
    expect(host.textContent).toContain("시작일 앞에 걸친 일정은 회차 기간을 고쳐 맞춰 주세요");
    expect(host.textContent).not.toContain("진행중");
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "종료일 늘리기")!.click());
    expect(host.textContent).toContain("마지막 마감 11.25");
    expect(host.textContent).not.toContain("진행중");
  });
  it("진행중 방 + 시작일 앞 일정: 시작일은 바꿀 수 없다고", () => {
    const { host } = mount({ gap: { ...gap, before: true }, canEdit: true });
    expect(host.textContent).toContain("시작일 앞에 걸친 일정은 회차 기간을 고쳐 맞춰 주세요 · 진행중에는 시작일을 바꿀 수 없어요");
  });
  it("종료일로 못 맞추면(fitEnd null) 그룹장에게도 회차 편집만", () => {
    const { host } = mount({ gap: { ...gap, fitEnd: null }, canEdit: true, isLeader: true });
    expect(labels(host)).toEqual(["회차 기간 고치기"]);
  });
});
