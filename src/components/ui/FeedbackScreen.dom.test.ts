// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ calls: [] as unknown[][], nav: [] as string[] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (h: string) => api.nav.push(`push ${h}`), back: () => api.nav.push("back"), replace: (h: string) => api.nav.push(`replace ${h}`) }),
}));
vi.mock("@/lib/api/feedback", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/feedback")>()),
  submitFeedback: (...a: unknown[]) => {
    api.calls.push(a);
    return Promise.resolve({ id: "1", createdAt: "2026-10-22T01:00:00Z" });
  },
}));

const { FeedbackScreen } = await import("./FeedbackScreen");
const nav = await import("./feedbackNav");

const roots: Root[] = [];
const mount = async (from?: string) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(FeedbackScreen, { from })));
  return host;
};
const byText = (t: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === t)!;
const type = async (v: string) => {
  const ta = document.querySelector<HTMLTextAreaElement>("textarea")!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(ta, v);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  api.calls = [];
  api.nav = [];
  nav.clearFeedbackOpened();
  nav.takeFeedbackSent();
});

describe("FeedbackScreen (모바일 /feedback)", () => {
  it("함께 보내는 정보는 연 화면(from) 기준 · 비밀 쿼리 없음 · 모달 아님", async () => {
    await mount("/my-study/aws?tab=tasks&invite=SECRET");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector("h1")!.textContent).toBe("의견 보내기");
    const info = document.querySelector("details")!.textContent!;
    expect(info).toContain("/my-study/aws?tab=tasks");
    expect(info).not.toContain("SECRET");
  });

  it("보내기는 내용 바로 아래 문서 흐름(고정 아님)", async () => {
    await mount("/schedule");
    const actions = document.querySelector("[data-feedback-actions]")!;
    expect(actions.contains(byText("보내기"))).toBe(true);
    expect(actions.previousElementSibling!.querySelector("textarea")).not.toBeNull();
    expect(document.querySelector(".fixed")).toBeNull();
  });

  it("앱 안에서 열었으면 보낸 뒤 history.back + 돌아간 화면 토스트 표시", async () => {
    nav.markFeedbackOpened("/schedule");
    await mount("/schedule");
    await act(async () => byText("제안").click());
    await type("다크 모드가 있으면 좋겠어요");
    await act(async () => byText("보내기").click());
    const [kind, , ctx] = api.calls[0] as [string, string, Record<string, string>];
    expect([kind, ctx.path]).toEqual(["IDEA", "/schedule"]);
    expect(api.nav).toEqual(["back"]);
    expect(nav.takeFeedbackSent()).toBe(true);
  });

  it("직접 열었으면 뒤로는 검증된 from 으로 replace, 바깥 주소는 홈", async () => {
    await mount("/schedule");
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="뒤로"]')!.click());
    expect(api.nav).toEqual(["replace /schedule"]);
    api.nav = [];
    act(() => roots.splice(0).forEach((r) => r.unmount()));
    document.body.innerHTML = "";
    await mount("//evil.example/x");
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="뒤로"]')!.click());
    expect(api.nav).toEqual(["replace /"]);
    expect(document.querySelector("details")!.textContent).toContain("보던 화면/");
  });
});
