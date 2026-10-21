// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Notice } from "@/lib/api/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ markNoticesRead: vi.fn() }));
vi.mock("@/lib/api/notices", async (orig) => ({ ...(await orig<typeof import("@/lib/api/notices")>()), ...api }));
const { NoticePopup, laterKey } = await import("./NoticePopup");

const N = (id: string, o: Partial<Notice> = {}): Notice => ({
  id, title: `규칙 ${id}`, bodyMd: `본문 **${id}** [링크](https://x.test)`, popup: true, pinned: false, author: { userId: "u2", nickname: "민수", tone: "mint" },
  createdAt: "2026-10-20T01:00:00.000Z", updatedAt: "2026-10-20T01:00:00.000Z", edited: false, read: false, ...o,
});

let root: Root | null = null;
let page: HTMLElement;
const onAck = vi.fn();
function mount(popups: Notice[], hold = false) {
  page = document.body.appendChild(document.createElement("div"));
  const opener = page.appendChild(document.createElement("button"));
  opener.textContent = "연 곳";
  opener.focus();
  root = createRoot(page.appendChild(document.createElement("div")));
  const render = (p: Notice[], h: boolean) => act(() => root!.render(createElement(NoticePopup, { slug: "aws", popups: p, hold: h, onAck })));
  render(popups, hold);
  return { opener, render };
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const btn = (text: string) => [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text) as HTMLButtonElement;
const key = (k: string, shiftKey = false) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true })));

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe("NoticePopup", () => {
  it("모달 구조 — dialog·aria-modal·이름/설명, 흐린 배경, 제목으로 포커스, 바탕 inert·스크롤 잠금", () => {
    mount([N("1")]);
    const d = dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(d.getAttribute("aria-labelledby")!)?.textContent).toBe("규칙 1");
    expect(document.getElementById(d.getAttribute("aria-describedby")!)?.querySelector("strong")?.textContent).toBe("1");
    expect(d.parentElement!.className).toContain("backdrop-blur");
    expect(document.activeElement?.textContent).toBe("규칙 1");
    expect(page.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(d.textContent).not.toMatch(/\d\/\d/); // 하나면 1/1 을 보이지 않는다
  });

  it("큐 1/N — [확인] 은 notice_read 후 다음 장, 마지막이면 닫고 연 곳으로 포커스·바탕 복구", async () => {
    api.markNoticesRead.mockResolvedValueOnce({ unread: true }).mockResolvedValueOnce({ unread: false });
    const { opener } = mount([N("1"), N("2")]);
    expect(dialog()!.textContent).toContain("1/2");
    await act(async () => btn("확인").click());
    expect(api.markNoticesRead).toHaveBeenLastCalledWith("aws", ["1"]);
    expect(onAck).toHaveBeenLastCalledWith(true);
    expect(dialog()!.textContent).toContain("2/2");
    expect(document.activeElement?.textContent).toBe("규칙 2");
    await act(async () => btn("확인").click());
    expect(api.markNoticesRead).toHaveBeenLastCalledWith("aws", ["2"]);
    expect(onAck).toHaveBeenLastCalledWith(false);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(page.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("Esc·X·[나중에 보기] — 읽음 처리 없이 남은 큐를 이번 세션만 숨긴다", () => {
    for (const how of ["esc", "x", "later"] as const) {
      const { render } = mount([N("1"), N("2")]);
      if (how === "esc") key("Escape");
      else act(() => btn(how === "x" ? "닫기" : "나중에 보기").click());
      expect(dialog(), how).toBeNull();
      expect(api.markNoticesRead).not.toHaveBeenCalled();
      expect(JSON.parse(window.sessionStorage.getItem(laterKey("aws"))!)).toEqual(["1", "2"]);
      // 같은 세션에서 다시 들어와도(새 inbox) 그 공지는 뜨지 않고, 새 공지만
      render([N("1"), N("2"), N("3")], false);
      expect(dialog()?.textContent).toContain("규칙 3");
      act(() => root!.unmount());
      root = null;
      document.body.innerHTML = "";
      window.sessionStorage.clear();
    }
  });

  it("배경 클릭은 무반응", () => {
    mount([N("1")]);
    act(() => dialog()!.parentElement!.click());
    expect(dialog()).not.toBeNull();
  });

  it("포커스 트랩 — 링크·버튼 사이만 돈다", () => {
    mount([N("1")]);
    key("Tab", true); // 제목(첫 대상 아님)에서 Shift+Tab → 마지막 [확인]
    expect(document.activeElement?.textContent).toBe("확인");
    key("Tab");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("닫기");
  });

  it("[확인] 실패 — 닫지 않고 다시 시도 안내", async () => {
    api.markNoticesRead.mockRejectedValue(new Error("x"));
    mount([N("1")]);
    await act(async () => btn("확인").click());
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('[role="alert"]')?.textContent).toBe("확인 처리에 실패했어요. 다시 시도해 주세요");
    expect(onAck).not.toHaveBeenCalled();
  });

  it("다른 대화상자가 떠 있으면(hold) 기다렸다가 연다 · 빈 큐면 아무것도 없다", () => {
    const { render } = mount([N("1")], true);
    expect(dialog()).toBeNull();
    render([N("1")], false);
    // 같은 배열이 아니어도(다시 받은 inbox) 큐는 새로 — 여기선 hold 만 풀렸다
    expect(dialog()).not.toBeNull();
    render([], false);
    expect(dialog()).toBeNull();
  });

  it("sessionStorage 가 막혀도 동작", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mount([N("1")]);
    expect(dialog()).not.toBeNull();
    act(() => btn("나중에 보기").click());
    expect(dialog()).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});
