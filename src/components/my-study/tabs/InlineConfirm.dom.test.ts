// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InlineConfirm } from "./InlineConfirm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tab = (shiftKey = false) =>
  act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true })));
const label = () => document.activeElement?.textContent?.trim();

describe("InlineConfirm Tab 가두기", () => {
  it("비활성 버튼은 건너뛴다 — 앞뒤로 돌아도 활성 버튼에만 머문다", () => {
    act(() =>
      root.render(
        createElement(InlineConfirm, {
          text: "확인",
          onCancel: vi.fn(),
          cancelLabel: "계속 편집",
          actions: [
            { label: "함께 옮기기", onClick: vi.fn(), disabled: true },
            { label: "이 묶음만 바꾸기", onClick: vi.fn(), disabled: true },
            { label: "버리기", onClick: vi.fn() },
          ],
        }),
      ),
    );
    expect(label()).toBe("계속 편집");
    tab();
    expect(label()).toBe("버리기");
    tab();
    expect(label()).toBe("계속 편집");
    tab(true);
    expect(label()).toBe("버리기");
  });
});
