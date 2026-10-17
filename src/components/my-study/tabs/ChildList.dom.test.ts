// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MeProvider } from "@/lib/me";
import { ChildList } from "./ChildList";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, REF_DAY } from "../fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const round = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).roots[0];
const edit = { onMove: () => {}, onRemove: () => {}, onAdd: async () => true, busy: null, canAdd: true };

// 회차 편집 화면 "이 회차의 과제" 빠른 추가 — 닫으면 "과제 추가" 줄로 포커스 (공용 훅 useRefocusOnClose: effect, rAF 아님)
describe("ChildList 빠른 추가 닫기 포커스", () => {
  it("Esc 로 닫으면 다시 그려진 '과제 추가' 버튼으로 (rAF 를 기다리지 않는다)", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(MeProvider, { me: null, children: createElement(ChildList, { parent: round, onOpen: () => {}, edit }) })));
    const add = () => host.querySelector<HTMLButtonElement>(`[data-add-task="${round.id}"]`);
    act(() => add()!.click());
    const input = host.querySelector<HTMLInputElement>("input")!;
    input.focus();
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(add());
    act(() => root.unmount());
    host.remove();
  });
});
