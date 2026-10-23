// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MultiChips, otherLabel, SingleChips } from "./Chips";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mount = (el: ReturnType<typeof createElement>) => {
  const host = document.body.appendChild(document.createElement("div"));
  act(() => createRoot(host).render(el));
  return host;
};
const ask = { field: "maxMembers" as const, kind: "single" as const, options: [{ label: "4명", value: "4" }, { label: "6명", value: "6" }, { label: "10명", value: "10" }] };

describe("칩 (§9.1·§9.3)", () => {
  it("단일: radiogroup · roving tabindex · ←/→ 로 고르고 Enter(클릭)로 보냄 · 44px", () => {
    const onPick = vi.fn();
    const host = mount(createElement(SingleChips, { ask, onPick }));
    const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] [role="radio"]')];
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    expect(radios[0].className).toContain("min-h-11");
    act(() => radios[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(document.activeElement).toBe(radios[1]);
    expect(onPick).not.toHaveBeenCalled();
    act(() => radios[1].click());
    expect(onPick).toHaveBeenCalledWith("6명", "6");
  });
  it("복수: aria-pressed 토글 + [선택 완료]", () => {
    const onDone = vi.fn();
    const host = mount(createElement(MultiChips, { options: [{ label: "매주 과제 제출", value: "weekly-task" }, { label: "회차별 시험", value: "exam" }], onDone }));
    const [a, b] = host.querySelectorAll<HTMLButtonElement>('[role="group"] button');
    const done = [...host.querySelectorAll("button")].find((x) => x.textContent?.startsWith("선택 완료"))!;
    expect(done.disabled).toBe(true);
    act(() => a.click());
    act(() => b.click());
    expect([a.getAttribute("aria-pressed"), b.getAttribute("aria-pressed")]).toEqual(["true", "true"]);
    act(() => done.click());
    expect(onDone).toHaveBeenCalledWith([{ label: "매주 과제 제출", value: "weekly-task" }, { label: "회차별 시험", value: "exam" }]);
  });
  it("직접 입력 라벨에 단위", () => {
    expect([otherLabel("durationWeeks", "10"), otherLabel("maxMembers", "8"), otherLabel("startDate", "2026-11-02")]).toEqual(["10주", "8명", "2026-11-02"]);
  });
});
