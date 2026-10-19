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
    const sw = [...host.querySelectorAll<HTMLElement>('[role="switch"]')];
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
