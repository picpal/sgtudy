// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
const api = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/lib/api/notifications", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/notifications")>()),
  fetchNotifications: () => Promise.resolve({ items: api.items, nextCursor: null }),
  fetchUnreadCount: () => Promise.resolve(0),
  markAllRead: () => Promise.resolve(0),
  markRead: () => Promise.resolve(),
}));

const { MeProvider } = await import("@/lib/me");
const { NotificationBell } = await import("./NotificationBell");

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
