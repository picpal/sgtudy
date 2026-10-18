// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { announceHash, hashOf, useHashTarget } from "./hashTarget";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let scrolled: string[] = [];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  } as never;
});
afterEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

function Probe({ id, ready }: { id: string; ready: boolean }) {
  const hit = useHashTarget(id, ready);
  return createElement("section", { id, tabIndex: -1, "data-hit": String(hit) }, "x");
}
let setReady: (v: boolean) => void = () => {};
const mount = (id: string) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(Probe, { id, ready: false })));
  setReady = (v) => root.render(createElement(Probe, { id, ready: v }));
  return { host, root };
};

// 시나리오 QA #8·D4: 알림 딥링크(#applications · #submissions · #leave-requests) — 내용이 준비되면 그 영역으로 스크롤·포커스
describe("useHashTarget", () => {
  it("주소 해시가 맞으면 준비된 뒤에 한 번 스크롤하고 포커스한다", () => {
    window.history.replaceState(null, "", "/my-study/aws#applications");
    const { host, root } = mount("applications");
    expect(host.querySelector("section")!.dataset.hit).toBe("true");
    expect(scrolled).toEqual([]); // 아직 불러오는 중
    act(() => setReady(true));
    expect(scrolled).toEqual(["applications"]);
    expect(document.activeElement?.id).toBe("applications");
    act(() => root.unmount());
  });
  it("해시가 다르면 아무것도 안 한다", () => {
    window.history.replaceState(null, "", "/my-study/aws#submissions");
    const { root } = mount("applications");
    act(() => setReady(true));
    expect(scrolled).toEqual([]);
    act(() => root.unmount());
  });
  it("같은 화면에서 알림을 눌러도(announceHash) 다시 찾아간다", () => {
    const { root } = mount("leave-requests");
    act(() => setReady(true));
    expect(scrolled).toEqual([]);
    act(() => announceHash("/my-study/aws#leave-requests"));
    expect(scrolled).toEqual(["leave-requests"]);
    act(() => root.unmount());
  });
  it("hashOf: 링크의 해시(# 없이), 없으면 빈 값", () => {
    expect(hashOf("/my-study/aws?task=3#submissions")).toBe("submissions");
    expect(hashOf("/my-study/aws")).toBe("");
  });
});

describe("useHashTarget — 알림으로 다른 화면을 열 때", () => {
  it("주소 해시가 없어도 방금 알린 해시면 마운트 때 찾아간다(한 번만)", () => {
    announceHash("/my-study/aws#leave-requests"); // 아직 그 화면이 없다
    const { root } = mount("leave-requests");
    act(() => setReady(true));
    expect(scrolled).toEqual(["leave-requests"]);
    act(() => root.unmount());
    scrolled = [];
    const again = mount("leave-requests");
    act(() => setReady(true));
    expect(scrolled).toEqual([]);
    act(() => again.root.unmount());
  });
});
