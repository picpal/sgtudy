// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { RoomDetail } from "@/lib/api/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), usePathname: () => "/rooms/aws/settings" }));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; onNavigate?: unknown; children?: unknown }) => {
      delete rest.onNavigate;
      return h("a", { ...rest, href }, children as never);
    },
  };
});
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: () => null }));
vi.mock("./NotifySettings", () => ({ NotifySettingsSection: () => null }));
vi.mock("@/lib/today", () => ({ useToday: () => "2026-10-19" }));

const recruitApi = vi.hoisted(() => ({ openExtraRecruit: vi.fn(), closeExtraRecruit: vi.fn(), setInviteBypass: vi.fn(), fetchInvite: vi.fn(), rotateInvite: vi.fn() }));
vi.mock("@/lib/api/recruit", async (orig) => ({ ...(await orig<typeof import("@/lib/api/recruit")>()), openExtraRecruit: recruitApi.openExtraRecruit, closeExtraRecruit: recruitApi.closeExtraRecruit, setInviteBypass: recruitApi.setInviteBypass }));
vi.mock("@/lib/api/leader", async (orig) => ({ ...(await orig<typeof import("@/lib/api/leader")>()), fetchInvite: recruitApi.fetchInvite, rotateInvite: recruitApi.rotateInvite }));
recruitApi.fetchInvite.mockResolvedValue({ today: "2026-10-19", token: "t", url: "/invite/t", code: "K7QM3XPA", bypass: null });

const { RoomSettingsForm } = await import("./RoomSettingsForm");

const base = {
  today: "2026-10-19", id: "aws", slug: "aws", title: "AWS 스터디", intro: "한 줄", descriptionMd: "", rulesMd: "", status: "active", archived: false,
  isPublic: true, joinMode: "approval", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 10, minMembers: null, memberCount: 3,
  leaderDoesTasks: true, tags: [], members: [], me: { state: "leader" }, currentRound: null, rounds: [], invite: null, pendingCount: 0,
} as unknown as RoomDetail;

afterEach(() => {
  document.body.innerHTML = "";
});

const mount = (d: Partial<RoomDetail>, back?: string) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(RoomSettingsForm, { detail: { ...base, ...d } as RoomDetail, back })));
  const input = (n: string) => host.querySelector<HTMLInputElement>(`input[name="${n}"]`)!;
  return { host, root, input };
};

describe("방 설정 — 진행중에 잠긴 칸도 지금 값을 보인다", () => {
  it("최소 인원이 없으면(null) 빈 칸이 아니라 '제한 없음', 시작일·최대 인원은 값 그대로", () => {
    const { root, input } = mount({});
    const min = input("minMembers");
    expect(min.disabled).toBe(true);
    expect(min.value).toBe("");
    expect(min.placeholder).toBe("제한 없음");
    expect(min.className).toContain("disabled:placeholder:text-muted");
    expect(input("startDate").disabled).toBe(true);
    expect(input("startDate").value).toBe("2026-10-01");
    expect(input("maxMembers").value).toBe("10");
    act(() => root.unmount());
  });
  it("최소 인원이 있으면 잠겨도 그 숫자", () => {
    const { root, input } = mount({ minMembers: 4 });
    expect(input("minMembers").disabled).toBe(true);
    expect(input("minMembers").value).toBe("4");
    act(() => root.unmount());
  });
  it("잠긴 스위치(공개·그룹장 과제)·참가 방식도 지금 상태를 보인다", () => {
    const { host, root } = mount({ isPublic: false, leaderDoesTasks: true, joinMode: "approval" });
    const sw = [...host.querySelector("form")!.querySelectorAll<HTMLElement>('[role="switch"]')];
    expect(sw.map((s) => [s.getAttribute("aria-label") ?? s.textContent, s.getAttribute("aria-checked")])).toEqual([
      [expect.stringContaining("공개 방"), "false"],
      [expect.stringContaining("그룹장도 과제 수행"), "true"],
    ]);
    const checked = host.querySelector('[role="radiogroup"] [aria-checked="true"]');
    expect(checked?.textContent).toContain("승인");
    act(() => root.unmount());
  });
});

describe("방 설정 — 돌아가기 목적지", () => {
  it("back(검증된 from)이 있으면 옆 '이전 페이지' 만 그리로, 위쪽은 내 스터디", () => {
    const { host, root } = mount({}, "/rooms/aws");
    const links = [...host.querySelectorAll("a")];
    expect(links.find((a) => a.textContent === "내 스터디로")?.getAttribute("href")).toBe("/my-study/aws");
    expect(links.find((a) => a.textContent === "이전 페이지")?.getAttribute("href")).toBe("/rooms/aws");
    act(() => root.unmount());
  });
  it("back 이 없으면(바로 들어옴) 둘 다 내 스터디", () => {
    const { host, root } = mount({});
    expect([...host.querySelectorAll("a")].filter((a) => a.textContent === "이전 페이지" || a.textContent === "내 스터디로").map((a) => a.getAttribute("href"))).toEqual(["/my-study/aws", "/my-study/aws"]);
    act(() => root.unmount());
  });
});

/* 추가 모집 · 초대 섹션의 바로 저장이 폼 기준값·현재값에 서버가 바꾼 칸만 반영한다 (Codex #8·2-4) */
describe("방 설정 — 추가 모집 결과가 폼과 맞물린다", () => {
  const typeIn = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const flush = () => act(async () => {});
  const button = (host: ParentNode, label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  const live = { recruit: { open: true, extraUntil: "2026-10-27" }, invite: { url: "/invite/t", token: "t", code: "K7QM3XPA", bypass: null } } as Partial<RoomDetail>;

  it("'지금 마감' 해도 저장 안 한 최대 인원 수정은 그대로", async () => {
    recruitApi.closeExtraRecruit.mockResolvedValue({ ...base, recruit: { open: false, extraUntil: null } });
    const { host, root, input } = mount(live);
    typeIn(input("maxMembers"), "12");
    act(() => button(host, "지금 마감").click());
    act(() => button(document.body, "마감").click());
    await flush();
    expect(recruitApi.closeExtraRecruit).toHaveBeenCalled();
    expect(input("maxMembers").value).toBe("12");
    expect(host.textContent).toContain("바뀐 항목 1개");
    expect(host.textContent).toContain("추가 모집 시작");
    act(() => root.unmount());
  });

  it("추가 모집 요청 중에 고친 칸은 남고, 서버가 바꾼 정원은 기준값·현재값 모두에 들어간다", async () => {
    let resolve!: (d: RoomDetail) => void;
    recruitApi.openExtraRecruit.mockReturnValue(new Promise<RoomDetail>((r) => (resolve = r)));
    const { host, root, input } = mount({ ...live, recruit: { open: false, extraUntil: null } });
    act(() => button(host, "추가 모집 시작").click());
    typeIn(input("intro"), "요청 중에 고친 소개");
    await act(async () => resolve({ ...base, maxMembers: 12, recruit: { open: true, extraUntil: "2026-10-26" } } as RoomDetail));
    expect(input("intro").value).toBe("요청 중에 고친 소개");
    expect(input("maxMembers").value).toBe("12");
    expect(host.textContent).toContain("바뀐 항목 1개");
    act(() => root.unmount());
  });
});

describe("방 설정 — 기간 두 날짜 칸이 서로 겹치지 않는다(iOS Safari)", () => {
  // iOS Safari 는 기본 모양(appearance:auto) date input 에 border-box 를 적용하지 않아 칸보다 34px 넓게 그린다 → 시작일이 종료일을 덮음
  const dateSafe = (el: HTMLInputElement) => {
    const cls = el.className.split(/\s+/);
    expect(cls).toContain("appearance-none");
    expect(cls).toContain("w-full");
    expect(cls).toContain("min-w-0");
    expect(cls).toContain("h-12");
  };
  it.each([
    ["모집중(수정 가능)", { status: "recruit" }],
    ["진행중(시작일 잠김)", { status: "active" }],
  ] as const)("%s — 시작일·종료일 모두 기본 모양을 끈 날짜 칸, 같은 minmax 그리드 안", (_, d) => {
    const { input } = mount(d as Partial<RoomDetail>);
    const start = input("startDate");
    const end = input("endDate");
    dateSafe(start);
    dateSafe(end);
    const grid = start.closest("label")!.parentElement!;
    expect(end.closest("label")!.parentElement).toBe(grid);
    expect(grid.className.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "max-sm:grid-cols-1"]));
  });
});
