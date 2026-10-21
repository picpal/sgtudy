// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmDialog } from "./ConfirmDialog";
import { useFocusTrap } from "./useFocusTrap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const mount = (el: ReturnType<typeof createElement>) => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
const tab = (shiftKey = false) =>
  act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true })));
const label = () => document.activeElement?.textContent?.trim() || (document.activeElement as HTMLInputElement | null)?.name;

// 대화상자 포커스 트랩 공용화 (공지 팝업 스펙 §6.4) — ConfirmDialog 동작은 그대로
describe("useFocusTrap", () => {
  it("ConfirmDialog — 마지막에서 Tab 은 처음으로, 처음에서 Shift+Tab 은 마지막으로 (입력칸 포함)", () => {
    mount(createElement(ConfirmDialog, { open: true, title: "t", body: "b", confirmLabel: "확인", onConfirm: () => {}, onCancel: () => {} }, createElement("input", { name: "reason" })));
    expect(label()).toBe("돌아가기"); // 열리면 돌아가기
    ([...document.querySelectorAll("button")].find((b) => b.textContent === "확인") as HTMLElement).focus();
    tab(); // 본문 아래 입력칸이 처음, [확인] 이 끝
    expect(label()).toBe("reason");
    tab(true);
    expect(label()).toBe("확인");
  });

  it("링크·버튼을 가두고 비활성·tabindex=-1 은 건너뛴다", () => {
    function Box() {
      const box = useRef<HTMLDivElement>(null);
      const onKeyDown = useFocusTrap(box);
      return createElement(
        "div",
        { ref: box, onKeyDown },
        createElement("h2", { tabIndex: -1, id: "h" }, "제목"),
        createElement("a", { href: "https://x.test" }, "링크"),
        createElement("button", { type: "button" }, "가운데"),
        createElement("button", { type: "button", disabled: true }, "꺼짐"),
        createElement("button", { type: "button" }, "끝"),
      );
    }
    const host = mount(createElement(Box));
    (host.querySelector("#h") as HTMLElement).focus();
    tab(true); // 처음 요소(제목)는 트랩 대상이 아니다 — 첫 대상 앞이라 마지막으로
    expect(label()).toBe("끝");
    tab();
    expect(label()).toBe("링크");
    tab(true);
    expect(label()).toBe("끝");
  });
});
