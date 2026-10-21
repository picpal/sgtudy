// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }), usePathname: () => "/rooms/new" }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: () => null }));
vi.mock("@/lib/today", () => ({ useToday: () => "2026-10-21" }));
vi.mock("./tags", async (orig) => ({ ...(await orig<typeof import("./tags")>()), searchTags: () => Promise.resolve([]) }));

const { NewRoomForm } = await import("./NewRoomForm");
const { DATE_FIELD_CLASS } = await import("./fields");

describe("방 만들기 — 기간 두 날짜 칸이 서로 겹치지 않는다(iOS Safari)", () => {
  it("시작일·종료일은 DATE_FIELD_CLASS(기본 모양 끔), 같은 grid-cols-2 그리드 안", () => {
    const host = document.body.appendChild(document.createElement("div"));
    act(() => createRoot(host).render(createElement(NewRoomForm)));
    const start = host.querySelector<HTMLInputElement>('input[name="startDate"]')!;
    const end = host.querySelector<HTMLInputElement>('input[name="endDate"]')!;
    expect(start.className).toBe(DATE_FIELD_CLASS);
    expect(end.className).toBe(DATE_FIELD_CLASS);
    const grid = start.closest("label")!.parentElement!;
    expect(end.closest("label")!.parentElement).toBe(grid);
    expect(grid.className.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "max-sm:grid-cols-1"]));
  });
});
