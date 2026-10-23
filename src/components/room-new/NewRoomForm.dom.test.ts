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
const { EMPTY_VALUES } = await import("./validate");
const props = { values: EMPTY_VALUES, tags: [], onChange: () => {}, onTagsChange: () => {} };

describe("방 만들기 — 기간 두 날짜 칸이 서로 겹치지 않는다(iOS Safari)", () => {
  it("시작일·종료일은 DATE_FIELD_CLASS(기본 모양 끔), 같은 grid-cols-2 그리드 안", () => {
    const host = document.body.appendChild(document.createElement("div"));
    act(() => createRoot(host).render(createElement(NewRoomForm, props)));
    const start = host.querySelector<HTMLInputElement>('input[name="startDate"]')!;
    const end = host.querySelector<HTMLInputElement>('input[name="endDate"]')!;
    expect(start.className).toBe(DATE_FIELD_CLASS);
    expect(end.className).toBe(DATE_FIELD_CLASS);
    const grid = start.closest("label")!.parentElement!;
    expect(end.closest("label")!.parentElement).toBe(grid);
    expect(grid.className.split(/\s+/)).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "max-sm:grid-cols-1"]));
  });
});

describe("방 만들기 폼 — 값은 밖에서(controlled, D13)", () => {
  it("values 를 그리고 입력은 onChange 로 올린다 · banner · initialMore 로 더 설정 펼침", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const onChange = vi.fn();
    const values = { ...EMPTY_VALUES, title: "AWS", rulesMd: "- 규칙" };
    act(() => createRoot(host).render(createElement(NewRoomForm, { ...props, values, onChange, initialMore: true, banner: createElement("p", { id: "b" }, "AI 초안") })));
    expect(host.querySelector<HTMLInputElement>('input[name="title"]')!.value).toBe("AWS");
    expect(host.querySelector("#b")?.textContent).toBe("AI 초안");
    expect(host.querySelector('button[aria-expanded="true"]')?.textContent).toBe("접기");
    const input = host.querySelector<HTMLInputElement>('input[name="intro"]')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "소개");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ ...values, intro: "소개" });
  });
});
