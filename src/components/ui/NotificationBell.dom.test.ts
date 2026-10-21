// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ items: [] as unknown[], read: [] as string[], pushed: [] as string[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (h: string) => api.pushed.push(h) }) }));
vi.mock("@/lib/api/notifications", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/notifications")>()),
  fetchNotifications: () => Promise.resolve({ items: api.items, nextCursor: null }),
  fetchUnreadCount: () => Promise.resolve(0),
  markAllRead: () => Promise.resolve(0),
  markRead: (id: string) => {
    api.read.push(id);
    return Promise.resolve();
  },
}));

const { MeProvider } = await import("@/lib/me");
const { NotificationBell } = await import("./NotificationBell");
const { setLeaveGuard } = await import("@/lib/leaveGuard");

const open = async (items: unknown[]) => {
  api.items = items;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(MeProvider, { me: { id: "u1", nickname: "철수", unreadCount: 0 } } as ComponentProps<typeof MeProvider>, createElement(NotificationBell)));
  });
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!.click());
  await act(async () => {});
  return host;
};
const item = (id: string, createdAt: string, readAt: string | null = null) => ({
  id, kind: "SCHEDULE_CHANGED", title: "일정이 변경됐어요", body: "ALB vs NLB 실습", room: { slug: "aws", title: "AWS SAA" }, link: "/my-study/aws", actor: null, createdAt, readAt,
});
const readAll = (host: HTMLElement) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === "모두 읽음");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NotificationBell", () => {
  it("빈 상태에서는 '모두 읽음' 버튼을 보이지 않는다 (Q3-8)", async () => {
    const host = await open([]);
    expect(host.textContent).toContain("아직 알림이 없어요");
    expect(readAll(host)).toBeUndefined();
  });
  it("알림이 있으면 '모두 읽음' 은 44px 누르는 영역, 읽지 않은 게 없으면 비활성", async () => {
    const host = await open([item("a", "2026-10-15T03:00:00Z", "2026-10-15T04:00:00Z")]);
    const b = readAll(host)!;
    expect(b.disabled).toBe(true);
    expect(b.classList.contains("before:h-11")).toBe(true);
  });
  it("같은 문구 알림은 시각으로 구분된다 (Q1-9)", async () => {
    const host = await open([item("a", "2026-10-15T03:00:00Z"), item("b", "2026-10-15T05:30:00Z")]);
    const metas = Array.from(host.querySelectorAll("a span.text-muted")).map((s) => s.textContent);
    expect(metas.length).toBe(2);
    expect(new Set(metas).size).toBe(2);
    expect(metas.every((m) => /\d{2}:\d{2}$|전$|방금$/.test(m ?? ""))).toBe(true);
  });
});

describe("NotificationBell 이탈 가드 (최종 리뷰 Minor 2)", () => {
  it("편집 화면이 이동을 보류하면 이동도 읽음 처리도 하지 않는다 — 가드가 없으면 둘 다", async () => {
    api.read = [];
    api.pushed = [];
    const host = await open([item("a", "2026-10-15T03:00:00Z")]);
    const off = setLeaveGuard(() => true);
    await act(async () => host.querySelector<HTMLAnchorElement>("a[href='/my-study/aws']")!.click());
    expect([api.read, api.pushed]).toEqual([[], []]);
    off();
    const host2 = await open([item("b", "2026-10-15T03:00:00Z")]);
    await act(async () => host2.querySelector<HTMLAnchorElement>("a[href='/my-study/aws']")!.click());
    expect(api.pushed).toEqual(["/my-study/aws"]);
    expect(api.read.length).toBe(1);
  });
});

// 최종 리뷰 I2: 깨끗한 편집 화면(가드 = EditView 와 같은 규칙)이 같은 화면 해시 알림을 삼키지 않는다 — 이동·앵커 알림·읽음까지
describe("NotificationBell 해시 알림 + 편집 화면 가드", () => {
  it("같은 화면 #applications 알림은 편집만 닫고 이동·읽음·앵커 알림을 이어 간다", async () => {
    const { holdSamePage, samePage, setScreenKey } = await import("@/lib/leaveGuard");
    api.read = [];
    api.pushed = [];
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum&item=3&mode=edit");
    const offKey = setScreenKey({ tab: "overview", task: "" });
    const closed: string[] = [];
    const off = setLeaveGuard((href) => {
      if (!samePage(href)) return false;
      closed.push(href);
      return holdSamePage(href);
    });
    const heard: string[] = [];
    const onHash = (e: Event) => heard.push((e as CustomEvent<{ hash: string }>).detail.hash);
    window.addEventListener("sgtudy:hash", onHash);
    const host = await open([{ ...item("c", "2026-10-15T03:00:00Z"), kind: "JOIN_REQUESTED", link: "/my-study/aws#applications" }]);
    await act(async () => host.querySelector<HTMLAnchorElement>("a[href='/my-study/aws#applications']")!.click());
    expect(closed).toEqual(["/my-study/aws#applications"]);
    expect(api.pushed).toEqual(["/my-study/aws#applications"]);
    expect(api.read).toEqual(["c"]);
    expect(heard).toEqual(["applications"]);
    window.removeEventListener("sgtudy:hash", onHash);
    off();
    offKey();
    window.history.replaceState(null, "", "/");
  });
  it("멘션 알림(#comment-) — 해시·과제를 알리고 그 링크로 이동한다(같은 과제 화면이 다른 탭을 보고 있어도 상세로)", async () => {
    api.read = [];
    api.pushed = [];
    window.history.replaceState(null, "", "/my-study/aws?tab=board");
    const heard: string[] = [];
    const onHash = (e: Event) => heard.push(`hash:${(e as CustomEvent<{ hash: string }>).detail.hash}`);
    const onTask = (e: Event) => heard.push(`task:${(e as CustomEvent<{ task: string }>).detail.task}`);
    window.addEventListener("sgtudy:hash", onHash);
    window.addEventListener("sgtudy:task", onTask);
    const link = "/my-study/aws?task=3#comment-9";
    const host = await open([{ ...item("m", "2026-10-21T03:00:00Z"), kind: "MENTIONED", title: "민수님이 댓글에서 회원님을 언급했어요", link }]);
    await act(async () => host.querySelector<HTMLAnchorElement>(`a[href='${link}']`)!.click());
    expect(heard).toEqual(["hash:comment-9", "task:3"]);
    expect(api.pushed).toEqual([link]);
    expect(api.read).toEqual(["m"]);
    window.removeEventListener("sgtudy:hash", onHash);
    window.removeEventListener("sgtudy:task", onTask);
    window.history.replaceState(null, "", "/");
  });
});
