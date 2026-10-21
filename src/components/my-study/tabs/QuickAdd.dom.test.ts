// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QuickAdd } from "./QuickAdd";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, REF_DAY } from "../fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const round = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).roots[0];

const mount = (onClose = vi.fn(), onAdd = vi.fn(async () => true), tone: "team" | "personal" = "team") => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(QuickAdd, { round, indent: 0, onAdd, onClose, tone })));
  const input = host.querySelector<HTMLInputElement>("input")!;
  const btn = (t: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === t)!;
  const done = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, input, btn, onClose, onAdd, done };
};

/** 실제 마우스 클릭 순서 — mousedown 의 기본 동작으로 포커스가 옮겨진다.
 *  Safari·macOS Firefox 는 버튼을 눌러도 버튼에 포커스를 주지 않아 입력의 blur 가 relatedTarget=null 로 온다 */
const realClick = (el: HTMLElement, focusesButton: boolean) => {
  act(() => {
    const ok = el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    if (ok) {
      if (focusesButton) el.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    }
  });
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.click();
  });
};

describe("QuickAdd 공통/지정 전환", () => {
  for (const [name, focusesButton] of [["Safari·Firefox(버튼에 포커스 없음)", false], ["Chromium(버튼에 포커스)", true]] as const) {
    it(`${name}: 빈 입력에서 '지정' 을 눌러도 닫히지 않고 유형이 바뀐다`, () => {
      const t = mount();
      t.input.focus();
      realClick(t.btn("지정"), focusesButton);
      expect(t.onClose).not.toHaveBeenCalled();
      expect(t.host.querySelector("input")).not.toBeNull();
      expect(t.btn("지정").getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(t.host.querySelector("input"));
      t.done();
    });
  }

  it("키보드: Tab 으로 '지정' 에 가서 Space/Enter(click) 해도 닫히지 않는다", () => {
    const t = mount();
    t.input.focus();
    act(() => t.btn("지정").focus());
    expect(t.onClose).not.toHaveBeenCalled();
    act(() => t.btn("지정").click());
    expect(t.btn("지정").getAttribute("aria-pressed")).toBe("true");
    expect(t.onClose).not.toHaveBeenCalled();
    t.done();
  });

  it("빈 입력에서 줄 밖으로 포커스가 나가면 닫힌다", () => {
    const t = mount();
    const outside = document.body.appendChild(document.createElement("button"));
    t.input.focus();
    act(() => outside.focus());
    expect(t.onClose).toHaveBeenCalledTimes(1);
    outside.remove();
    t.done();
  });

  it("Esc 로 닫힌다", () => {
    const t = mount();
    t.input.focus();
    act(() => t.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(t.onClose).toHaveBeenCalledTimes(1);
    t.done();
  });

  it("'지정' 으로 바꾼 뒤 Enter 로 만든 과제는 지정 유형", async () => {
    const t = mount();
    t.input.focus();
    realClick(t.btn("지정"), false);
    const input = t.host.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "새 과제");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(t.onAdd).toHaveBeenCalledWith("새 과제", "지정", "task");
    t.done();
  });
});

const typeAndEnter = async (host: HTMLElement, text: string) => {
  const input = host.querySelector<HTMLInputElement>("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
};

describe("QuickAdd 종류(과제/시험)", () => {
  const EXAM_NOTE = "시험은 초안으로 만들어져요 · 문제를 쓰고 발행해야 팀원에게 열려요";

  it("종류 세그먼트가 유형 세그먼트 앞에, 기본은 과제", () => {
    const t = mount();
    const groups = Array.from(t.host.querySelectorAll('[role="group"]')).map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["추가할 종류", "추가할 과제 유형"]);
    expect(t.btn("과제").getAttribute("aria-pressed")).toBe("true");
    expect(t.input.placeholder).toBe("과제 제목을 쓰고 Enter · Esc 닫기");
    expect(t.host.textContent).not.toContain(EXAM_NOTE);
    t.done();
  });

  for (const [name, focusesButton] of [["Safari·Firefox(버튼에 포커스 없음)", false], ["Chromium(버튼에 포커스)", true]] as const) {
    it(`${name}: 빈 입력에서 '시험' 을 눌러도 닫히지 않고, mousedown 은 기본 동작이 막힌다`, () => {
      const t = mount();
      t.input.focus();
      const notCancelled = t.btn("시험").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      expect(notCancelled).toBe(false); // preventDefault — 입력이 blur 되지 않는다
      realClick(t.btn("시험"), focusesButton);
      expect(t.onClose).not.toHaveBeenCalled();
      expect(t.btn("시험").getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(t.host.querySelector("input"));
      t.done();
    });
  }

  it("'시험' 을 고르면 placeholder·안내 줄이 바뀌고 Enter 는 onAdd(t, '공통', 'exam')", async () => {
    const t = mount();
    t.input.focus();
    realClick(t.btn("시험"), false);
    expect(t.host.querySelector("input")!.placeholder).toBe("시험 제목을 쓰고 Enter · Esc 닫기");
    expect(t.host.textContent).toContain(EXAM_NOTE);
    await typeAndEnter(t.host, "3주차 정리 시험");
    expect(t.onAdd).toHaveBeenCalledWith("3주차 정리 시험", "공통", "exam");
    t.done();
  });

  it("개인 목표 빠른 추가에는 종류 세그먼트가 없고 onAdd 는 제목만", async () => {
    const t = mount(undefined, undefined, "personal");
    expect(t.host.querySelector('[aria-label="추가할 종류"]')).toBeNull();
    expect(t.btn("시험")).toBeUndefined();
    await typeAndEnter(t.host, "내 목표");
    expect(t.onAdd).toHaveBeenCalledWith("내 목표");
    t.done();
  });
});
