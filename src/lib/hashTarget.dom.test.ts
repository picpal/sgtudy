// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { announceHash, commentIdOfHash, hashOf, peekHashPrefix, useHashPrefixTarget, useHashTarget } from "./hashTarget";

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
    window.history.replaceState(null, "", "/my-study/aws");
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
    window.history.replaceState(null, "", "/my-study/aws?tab=board");
    announceHash("/my-study/aws#leave-requests"); // 아직 그 화면이 없다(주소가 바뀌기 전)
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

// 최종 리뷰 I1: 해시는 한 번 쓰면 주소에서 지운다 — 탭을 갔다 와서 다시 마운트돼도 또 스크롤·포커스하지 않는다
describe("useHashTarget — 한 번만", () => {
  it("찾아간 뒤 주소 해시를 지우고, 다시 마운트되면 아무것도 안 한다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=overview#applications");
    const first = mount("applications");
    act(() => setReady(true));
    expect(scrolled).toEqual(["applications"]);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname + window.location.search).toBe("/my-study/aws?tab=overview");
    act(() => first.root.unmount());
    const again = mount("applications");
    act(() => setReady(true));
    expect(scrolled).toEqual(["applications"]);
    expect(again.host.querySelector("section")!.dataset.hit).toBe("false");
    act(() => again.root.unmount());
  });
  it("찾아간 뒤에는 hit 를 끈다 — ?task=N#submissions 뒤 다른 과제는 내 카드로", () => {
    window.history.replaceState(null, "", "/my-study/aws?task=3#submissions");
    const { host, root } = mount("submissions");
    expect(host.querySelector("section")!.dataset.hit).toBe("true");
    act(() => setReady(true));
    expect(host.querySelector("section")!.dataset.hit).toBe("false");
    act(() => root.unmount());
  });
});

// 최종 리뷰 Minor 1: 다른 방 화면이 알린 해시를 가로채지 않는다
describe("useHashTarget — 다른 방의 알림", () => {
  it("지금 화면 경로와 다른 링크의 알림은 무시하고, 그 방 화면이 마운트될 때 쓴다", () => {
    window.history.replaceState(null, "", "/my-study/a");
    const a = mount("leave-requests");
    act(() => setReady(true));
    act(() => announceHash("/my-study/b#leave-requests"));
    expect(scrolled).toEqual([]);
    act(() => a.root.unmount());
    window.history.replaceState(null, "", "/my-study/b");
    const b = mount("leave-requests");
    act(() => setReady(true));
    expect(scrolled).toEqual(["leave-requests"]);
    act(() => b.root.unmount());
  });
});

// 재리뷰 Minor A: 벨로 다른 화면에 들어와 주소 해시로 hit 되면 남은 pending 도 비운다 — 늦은 재확인·재마운트가 다시 찾아가지 않게
describe("useHashTarget — 해시로 hit 되면 pending 도 비운다", () => {
  it("주소 해시 + pending 이 함께 있을 때 한 번만 찾아가고, 다시 마운트돼도 안 간다", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/my-study/aws?tab=board");
    announceHash("/my-study/aws#leave-requests");
    window.history.replaceState(null, "", "/my-study/aws#leave-requests");
    const first = mount("leave-requests");
    act(() => setReady(true));
    expect(scrolled).toEqual(["leave-requests"]);
    act(() => vi.advanceTimersByTime(200)); // 늦은 재확인
    expect(scrolled).toEqual(["leave-requests"]);
    act(() => first.root.unmount());
    const again = mount("leave-requests");
    act(() => setReady(true));
    expect(scrolled).toEqual(["leave-requests"]);
    act(() => again.root.unmount());
    vi.useRealTimers();
  });
});

// 댓글 스펙 D15·D16: #comment-{id} — 고정 id 가 아니라 접두사로 받아 찾은 id 를 돌려준다(화면이 from=id 로 불러온 뒤 ready)
let scrolledBlock: (string | undefined)[] = [];
function PrefixProbe({ ready, ids }: { ready: boolean; ids: string[] }) {
  const hit = useHashPrefixTarget("comment-", ready, { fallbackId: "comments" });
  return createElement("section", { id: "comments", tabIndex: -1, "data-hit": hit ?? "" },
    ids.map((id) => createElement("li", { key: id, id, tabIndex: -1 }, id)));
}
const mountPrefix = (ids: string[]) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const render = (ready: boolean) => root.render(createElement(PrefixProbe, { ready, ids }));
  act(() => render(false));
  return { host, root, ready: () => act(() => render(true)), hit: () => host.querySelector("section")!.dataset.hit };
};

describe("useHashPrefixTarget — 댓글 앵커", () => {
  beforeEach(() => {
    scrolledBlock = [];
    Element.prototype.scrollIntoView = function (this: Element, o?: ScrollIntoViewOptions | boolean) {
      scrolled.push(this.id);
      scrolledBlock.push(typeof o === "object" ? o.block : undefined);
    } as never;
  });
  it("주소 해시 comment-{id} → 찾은 id 를 돌려주고, ready 뒤 그 댓글로 가운데 스크롤·포커스, 해시 제거, null", () => {
    window.history.replaceState(null, "", "/my-study/aws?task=3#comment-12");
    const p = mountPrefix(["comment-11", "comment-12"]);
    expect(p.hit()).toBe("comment-12");
    expect(scrolled).toEqual([]);
    p.ready();
    expect([scrolled, scrolledBlock]).toEqual([["comment-12"], ["center"]]);
    expect(document.activeElement?.id).toBe("comment-12");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?task=3");
    expect(p.hit()).toBe("");
    act(() => p.root.unmount());
  });
  it("그 댓글이 없으면(지워짐·없음) fallbackId 섹션으로", () => {
    window.history.replaceState(null, "", "/my-study/aws?task=3#comment-99");
    const p = mountPrefix(["comment-11"]);
    p.ready();
    expect(scrolled).toEqual(["comments"]);
    expect(document.activeElement?.id).toBe("comments");
    act(() => p.root.unmount());
  });
  it("같은 화면 재클릭(announceHash)도 다시 찾아간다 · 다른 접두사·다른 경로는 무시", () => {
    window.history.replaceState(null, "", "/my-study/aws?task=3");
    const p = mountPrefix(["comment-11", "comment-12"]);
    p.ready();
    expect(scrolled).toEqual([]);
    act(() => announceHash("/my-study/aws?task=3#submissions"));
    act(() => announceHash("/my-study/other?task=3#comment-11"));
    expect([scrolled, p.hit()]).toEqual([[], ""]);
    act(() => announceHash("/my-study/aws?task=3#comment-11"));
    expect(scrolled).toEqual(["comment-11"]);
    act(() => announceHash("/my-study/aws?task=3#comment-11"));
    expect(scrolled).toEqual(["comment-11", "comment-11"]);
    act(() => p.root.unmount());
  });
  it("다른 화면으로 넘어올 때: pending 해시를 마운트 때 한 번만 쓴다 · 'comment-' 만은 아님", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=board");
    announceHash("/my-study/aws?task=5#comment-");
    const none = mountPrefix([]);
    expect(none.hit()).toBe("");
    act(() => none.root.unmount());
    announceHash("/my-study/aws?task=5#comment-7");
    expect(peekHashPrefix("comment-")).toBe("comment-7");   // 보기만 — 꺼내지 않는다
    const p = mountPrefix(["comment-7"]);
    expect(p.hit()).toBe("comment-7");
    expect(peekHashPrefix("comment-")).toBeNull();
    p.ready();
    expect(scrolled).toEqual(["comment-7"]);
    act(() => p.root.unmount());
    const again = mountPrefix(["comment-7"]);
    again.ready();
    expect(scrolled).toEqual(["comment-7"]);
    act(() => again.root.unmount());
  });
  it("peekHashPrefix · commentIdOfHash", () => {
    window.history.replaceState(null, "", "/my-study/aws?task=3#comment-31");
    expect(peekHashPrefix("comment-")).toBe("comment-31");
    expect(peekHashPrefix("x-")).toBeNull();
    expect(commentIdOfHash("comment-31")).toBe("31");
    expect(commentIdOfHash("comment-")).toBeNull();
    expect(commentIdOfHash("submissions")).toBeNull();
  });
});
