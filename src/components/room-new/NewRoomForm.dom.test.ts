// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: () => {}, refresh: () => {} }), usePathname: () => "/rooms/new" }));
const rpcMock = vi.fn();
vi.mock("@/lib/api/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/api/errors")>()), rpc: (...a: unknown[]) => rpcMock(...a) }));
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

describe("방 만든 뒤 afterCreate(2단계 D22·Review Focus 1)", () => {
  const values = { ...EMPTY_VALUES, title: "AWS", intro: "소개", startDate: "2026-10-26", endDate: "2026-11-15" };
  const submit = async (afterCreate: (slug: string) => Promise<string | null>, submitLabel?: string) => {
    push.mockReset();
    rpcMock.mockReset().mockResolvedValue({ slug: "aws" });
    const host = document.body.appendChild(document.createElement("div"));
    act(() => createRoot(host).render(createElement(NewRoomForm, { ...props, values, afterCreate, submitLabel, beforeSubmit: createElement("p", { id: "bs" }, "섹션") })));
    const btn = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(btn.previousElementSibling?.id).toBe("bs");
    expect(btn.textContent).toBe(submitLabel ?? "방 만들기");
    await act(async () => btn.click());
    return btn;
  };
  it("room_create 뒤에 호출 · note 를 붙여 이동 · null 이면 그대로", async () => {
    const after = vi.fn(async () => {
      expect(rpcMock).toHaveBeenCalledWith("room_create", expect.anything());
      return "recruit-skipped";
    });
    await submit(after, "방 만들기 · 회차 3개 함께");
    expect(after).toHaveBeenCalledWith("aws");
    expect(push).toHaveBeenCalledWith("/my-study/aws?tab=curriculum&mode=edit&note=recruit-skipped");
    await submit(async () => null);
    expect(push).toHaveBeenCalledWith("/my-study/aws?tab=curriculum&mode=edit");
  });
  it("afterCreate 가 던져도(동기·비동기) 이동한다 — note=rounds-skipped", async () => {
    await submit(async () => {
      throw new Error("x");
    });
    expect(push).toHaveBeenCalledWith("/my-study/aws?tab=curriculum&mode=edit&note=rounds-skipped");
    await submit(() => {
      throw new Error("sync");
    });
    expect(push).toHaveBeenCalledWith("/my-study/aws?tab=curriculum&mode=edit&note=rounds-skipped");
  });
});
