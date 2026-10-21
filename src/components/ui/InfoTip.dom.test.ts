// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InfoTip } from "./InfoTip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root.render(createElement(InfoTip, { label: "진행목표 편집 권한 설명", text: "설명 문구" })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const btn = () => host.querySelector<HTMLButtonElement>('button[aria-label="진행목표 편집 권한 설명"]')!;
const tip = () => host.querySelector('[role="tooltip"]');

describe("InfoTip", () => {
  it("누르면 열리고 aria-describedby 로 연결, 다시 누르면 닫힌다", () => {
    expect(tip()).toBeNull();
    act(() => btn().click());
    expect(tip()?.textContent).toBe("설명 문구");
    expect(btn().getAttribute("aria-describedby")).toBe(tip()!.id);
    act(() => btn().click());
    expect(tip()).toBeNull();
  });
  it("Esc 로 닫고 버튼에 포커스", () => {
    act(() => btn().click());
    btn().focus();
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(tip()).toBeNull();
    expect(document.activeElement).toBe(btn());
  });
  it("바깥을 누르면 닫힌다", () => {
    act(() => btn().click());
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(tip()).toBeNull();
  });
});
