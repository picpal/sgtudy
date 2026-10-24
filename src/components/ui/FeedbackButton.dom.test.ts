// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ calls: [] as unknown[][], fail: null as unknown }));
vi.mock("@/lib/api/feedback", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/feedback")>()),
  submitFeedback: (...a: unknown[]) => {
    api.calls.push(a);
    return api.fail ? Promise.reject(api.fail) : Promise.resolve({ id: "1", createdAt: "2026-10-22T01:00:00Z" });
  },
}));

const { FeedbackButton } = await import("./FeedbackButton");

// 대화상자는 body 로 포털된다 — innerHTML 로 지우기 전에 언마운트해야 이펙트 정리(스크롤 잠금 해제)가 돈다
const roots: Root[] = [];
const mount = async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(createElement(FeedbackButton)));
  return host;
};
const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="의견 보내기"]')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
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
  api.fail = null;
  window.history.replaceState(null, "", "/");
});

describe("FeedbackButton", () => {
  it("열면 내용칸에 포커스 · 함께 보내는 정보에 경로가 보이고 비밀 쿼리는 없다", async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=tasks&invite=SECRET");
    await mount();
    await act(async () => trigger().click());
    expect(dialog()).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(document.querySelector("textarea"));
    const info = dialog()!.querySelector("details")!.textContent!;
    expect(info).toContain("/my-study/aws?tab=tasks");
    expect(info).not.toContain("SECRET");
    expect(info).toContain("aws");
  });

  it("짧은 내용은 보내지 않고 문구를 띄운다", async () => {
    await mount();
    await act(async () => trigger().click());
    await type("짧음");
    await act(async () => byText("보내기").click());
    expect(api.calls).toEqual([]);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe("내용은 5~2,000자예요");
  });

  it("종류를 골라 보내면 닫히고 토스트 · 버튼으로 포커스", async () => {
    await mount();
    await act(async () => trigger().click());
    await act(async () => byText("제안").click());
    expect(byText("제안").getAttribute("aria-checked")).toBe("true");
    await type("  다크 모드가 있으면 좋겠어요  ");
    await act(async () => byText("보내기").click());
    expect(api.calls).toHaveLength(1);
    const [kind, msg, ctx] = api.calls[0] as [string, string, Record<string, string>];
    expect([kind, msg, ctx.path, ctx.appVersion]).toEqual(["IDEA", "다크 모드가 있으면 좋겠어요", "/", "dev"]);
    expect(dialog()).toBeNull();
    expect(document.querySelector('[role="status"]')!.textContent).toContain("보내 주셔서 고마워요");
    expect(document.activeElement).toBe(trigger());
  });

  it("서버 오류는 대화상자 안에 보여 주고 입력은 남긴다", async () => {
    api.fail = { message: "RATE_LIMITED", details: "의견을 너무 자주 보내고 있어요 · 잠시 후 다시 보내 주세요", hint: "{}", code: "P0001" };
    await mount();
    await act(async () => trigger().click());
    await type("버튼이 안 눌려요");
    await act(async () => byText("보내기").click());
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe("의견을 너무 자주 보내고 있어요 · 잠시 후 다시 보내 주세요");
    expect(document.querySelector("textarea")!.value).toBe("버튼이 안 눌려요");
  });

  it("Esc 로 닫는다", async () => {
    await mount();
    await act(async () => trigger().click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(dialog()).toBeNull();
  });

  it("모바일 시트 구조 — 머리(제목·닫기) / 가운데 스크롤(칩·내용·정보) / 아래 보내기 줄", async () => {
    await mount();
    await act(async () => trigger().click());
    const d = dialog()!;
    const head = d.querySelector("[data-sheet-head]")!;
    const body = d.querySelector("[data-sheet-body]")!;
    const foot = d.querySelector("[data-sheet-foot]")!;
    expect(head.querySelector("h2")!.textContent).toBe("의견 보내기");
    expect(head.querySelector('button[aria-label="닫기"]')).not.toBeNull();
    expect(body.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(body.querySelector("textarea")).not.toBeNull();
    expect(body.querySelector("details")).not.toBeNull();
    expect(foot.contains(byText("보내기"))).toBe(true);
    expect(body.className).toContain("overflow-y-auto");
    await act(async () => head.querySelector<HTMLButtonElement>('button[aria-label="닫기"]')!.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("열린 동안 바탕 스크롤을 잠그고 시트를 visualViewport(키보드 뺀 칸)에 맞춘다", async () => {
    const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
    try {
      await mount();
      await act(async () => trigger().click());
      const d = dialog()!;
      expect(document.body.style.overflow).toBe("hidden");
      expect(d.style.getPropertyValue("--vv-h")).toBe("844px");
      expect(d.hasAttribute("data-kb")).toBe(false);
      // 키보드가 올라와 보이는 칸이 줄고 페이지가 밀린 상황
      Object.assign(vv, { height: 480, offsetTop: 120 });
      await act(async () => vv.dispatchEvent(new Event("resize")));
      expect(d.style.getPropertyValue("--vv-h")).toBe("480px");
      expect(d.style.getPropertyValue("--vv-top")).toBe("120px");
      expect(d.hasAttribute("data-kb")).toBe(true);
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      expect(document.body.style.overflow).toBe("");
    } finally {
      delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });
});
