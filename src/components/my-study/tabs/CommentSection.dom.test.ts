// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CommentDto, CommentPage } from "@/lib/api/types";
import { ApiException } from "@/lib/api/errors";
import { announceHash } from "@/lib/hashTarget";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let scrolled: string[] = [];
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
const api = vi.hoisted(() => ({ fetchComments: vi.fn(), createComment: vi.fn(), updateComment: vi.fn(), deleteComment: vi.fn() }));
vi.mock("@/lib/api/comments", async (orig) => ({ ...(await orig<typeof import("@/lib/api/comments")>()), ...api }));

const { CommentSection, mergeLatest } = await import("./CommentSection");

const ME = "00000000-0000-4000-8000-000000000001";
const MINSU = "00000000-0000-4000-8000-000000000002";
const person = (userId: string, nickname: string) => ({ userId, nickname, tone: "mint" as const });
const C = (id: string, o: Partial<CommentDto> = {}): CommentDto => ({
  id, body: `댓글 ${id}`, author: person(MINSU, "민수"), createdAt: "2026-10-21T01:00:00.000Z", updatedAt: "2026-10-21T01:00:00.000Z",
  edited: false, mine: false, canEdit: false, canDelete: false, ...o,
});
const P = (items: CommentDto[], o: Partial<CommentPage> = {}): CommentPage => ({
  items, people: {}, hasOlder: false, hasNewer: false, total: items.length, canWrite: true, writeBlock: null, locked: null, target: null,
  limits: { bodyMax: 2000, mentionsMax: 10, perNode: 1000, perMinute: 10, perHour: 120, page: 50, fromMax: 200 }, ...o,
});
const MEMBERS = [person(ME, "철수"), person(MINSU, "민수")];

let root: Root | null = null;
let host: HTMLElement;
const flush = () => act(async () => {});
async function mount(o: { pending?: boolean; node?: string } = {}) {
  const toast = vi.fn();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(CommentSection, { slug: "aws", nodeId: o.node ?? "3", members: MEMBERS, meId: ME, viewerPending: !!o.pending, toast })));
  await flush();
  await flush();
  return { toast };
}
const btn = (t: string, from: ParentNode = host) => [...from.querySelectorAll("button")].find((b) => b.textContent?.trim() === t || b.getAttribute("aria-label") === t) as HTMLButtonElement | undefined;
const items = () => [...host.querySelectorAll<HTMLElement>("li[data-comment]")];
const typeIn = (el: HTMLTextAreaElement, v: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, v);
    el.setSelectionRange(v.length, v.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const menuItem = (li: HTMLElement, label: string) => {
  act(() => li.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
  return [...li.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === label);
};

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  } as never;
  localStorage.clear();
  window.history.replaceState(null, "", "/my-study/aws?tab=curriculum&item=3");
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("CommentSection — 목록", () => {
  it("오래된 → 최신, 작성자·시간(절대 시각 title)·수정됨·인라인 md·멘션 칩, 제목에 총 개수", async () => {
    api.fetchComments.mockResolvedValue(
      P([C("1"), C("2", { body: `<@${ME}> **확인** 부탁`, edited: true }), C("3", { body: "<@00000000-0000-4000-8000-0000000000ff> 누구?" })], { people: { [ME]: person(ME, "철수") }, total: 3 }),
    );
    await mount();
    expect(api.fetchComments).toHaveBeenCalledWith("aws", "3");
    expect(items().map((li) => li.id)).toEqual(["comment-1", "comment-2", "comment-3"]);
    expect(host.querySelector("h3")!.textContent).toBe("댓글3");
    const second = items()[1];
    expect(second.textContent).toContain("민수");
    expect(second.textContent).toContain("· 수정됨");
    expect(second.querySelector("time")!.getAttribute("title")).toMatch(/2026년 10월 21일/);
    expect(second.querySelector("strong")!.textContent).toBe("확인");
    const chip = second.querySelector("[data-mention]")!;
    expect(chip.textContent).toBe("@철수");
    expect(chip.className).toContain("bg-mint-soft"); // 나를 부른 칩
    expect(items()[2].querySelector("[data-mention]")!.textContent).toBe("@알 수 없음");
  });
  it("빈 상태 — 쓸 수 있으면 「첫 댓글을 남겨 보세요」", async () => {
    api.fetchComments.mockResolvedValue(P([]));
    await mount();
    expect(host.textContent).toContain("첫 댓글을 남겨 보세요");
    expect(host.querySelector("textarea")).not.toBeNull();
  });
  it("[이전 댓글 n개 더 보기] — before=첫 id 로 받아 위에 붙인다", async () => {
    api.fetchComments.mockResolvedValueOnce(P([C("51"), C("52")], { hasOlder: true, total: 4 }));
    api.fetchComments.mockResolvedValueOnce(P([C("49"), C("50")], { hasOlder: false, total: 4 }));
    await mount();
    await act(async () => btn("이전 댓글 2개 더 보기")!.click());
    expect(api.fetchComments).toHaveBeenLastCalledWith("aws", "3", { before: "51" });
    expect(items().map((li) => li.dataset.comment)).toEqual(["49", "50", "51", "52"]);
    expect(btn("이전 댓글 더 보기")).toBeUndefined();
  });
  it("승인 대기는 부르지 않고 안내만", async () => {
    await mount({ pending: true });
    expect(api.fetchComments).not.toHaveBeenCalled();
    expect(host.textContent).toContain("참가가 승인되면 댓글을 볼 수 있어요");
  });
  it("시험 잠금 — 목록·입력창 대신 잠금 안내", async () => {
    api.fetchComments.mockResolvedValue(P([], { locked: { reason: "exam" }, canWrite: false, writeBlock: "exam_locked", total: 5 }));
    await mount();
    expect(host.textContent).toContain("시험을 제출하면 댓글을 볼 수 있어요");
    expect(host.querySelector("ol, textarea")).toBeNull();
    expect(host.querySelector("h3")!.textContent).toBe("댓글");   // 잠금이면 개수도 안 보인다(0043 전 서버가 숫자를 보내도)
  });
  it("시험 잠금 — 0043 서버는 total 을 null 로 준다: 머리글은 「댓글」만", async () => {
    api.fetchComments.mockResolvedValue(P([], { locked: { reason: "exam" }, canWrite: false, writeBlock: "exam_locked", total: null }));
    await mount();
    expect(host.querySelector("h3")!.textContent).toBe("댓글");
    expect(host.textContent).toContain("시험을 제출하면 댓글을 볼 수 있어요");
  });
  it.each([
    ["ended", "종료된 스터디는 댓글을 쓸 수 없어요"],
    ["inactive", "이탈한 스터디에는 댓글을 쓸 수 없어요"],
    ["archived_node", "보관된 항목에는 댓글을 쓸 수 없어요"],
  ] as const)("읽기 전용(%s) — 입력창 대신 안내, 답글 없음", async (block, text) => {
    api.fetchComments.mockResolvedValue(P([C("1")], { canWrite: false, writeBlock: block }));
    await mount();
    expect(host.textContent).toContain(text);
    expect(host.querySelector("textarea")).toBeNull();
    expect(btn("민수님에게 답글")).toBeUndefined();
  });
  it("불러오기 실패 — 문구 + [다시 시도]", async () => {
    api.fetchComments.mockRejectedValueOnce(new ApiException({ code: "NOT_MEMBER", message: "NOT_MEMBER", details: { state: "pending" } }));
    api.fetchComments.mockResolvedValueOnce(P([C("1")]));
    await mount();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("참가가 승인되면 댓글을 볼 수 있어요");
    await act(async () => btn("다시 시도")!.click());
    expect(items()).toHaveLength(1);
  });
});

describe("CommentSection — 권한", () => {
  it("내 댓글은 수정·삭제, 남의 댓글은 답글만, 그룹장은 남의 댓글 삭제만(중재 문구)", async () => {
    api.fetchComments.mockResolvedValue(P([C("1", { author: person(ME, "철수"), mine: true, canEdit: true, canDelete: true }), C("2"), C("3", { canDelete: true })]));
    await mount();
    const [mine, other, moderated] = items();
    expect(btn("민수님에게 답글", mine)).toBeUndefined();
    expect(btn("민수님에게 답글", other)).toBeDefined();
    expect(other.querySelector('button[aria-haspopup="menu"]')).toBeNull();
    expect(menuItem(mine, "수정")).toBeDefined();
    const del = menuItem(moderated, "삭제")!;
    expect([...moderated.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(["삭제"]);
    act(() => del.click());
    expect(moderated.querySelector('[role="alertdialog"]')!.textContent).toContain("그룹장 권한으로 이 댓글을 지울까요?");
  });
});

describe("CommentSection — 쓰기", () => {
  it("등록 → 토큰 본문으로 create, 목록 끝에 붙고 총 개수 +1, 입력창 비움", async () => {
    api.fetchComments.mockResolvedValue(P([C("1")]));
    await mount();
    api.createComment.mockResolvedValue({ comment: C("2", { body: `<@${MINSU}> 고마워요`, author: person(ME, "철수"), mine: true, canEdit: true, canDelete: true }), people: { [MINSU]: person(MINSU, "민수") } });
    act(() => btn("민수님에게 답글")!.click());
    const ta = host.querySelector("textarea")!;
    expect(ta.value).toBe("@민수 ");
    typeIn(ta, "@민수 고마워요");
    await act(async () => btn("등록")!.click());
    expect(api.createComment).toHaveBeenCalledWith("aws", "3", `<@${MINSU}> 고마워요`);
    expect(items().map((li) => li.dataset.comment)).toEqual(["1", "2"]);
    expect(items()[1].querySelector("[data-mention]")!.textContent).toBe("@민수");
    expect(host.querySelector("h3")!.textContent).toBe("댓글2");
    expect(ta.value).toBe("");
  });
  it("레이트 리밋 — 토스트, 글은 남는다", async () => {
    api.fetchComments.mockResolvedValue(P([]));
    const { toast } = await mount();
    api.createComment.mockRejectedValue(new ApiException({ code: "RATE_LIMITED", message: "too fast", details: { retryAfterSec: "30" } }));
    const ta = host.querySelector("textarea")!;
    typeIn(ta, "안녕");
    await act(async () => btn("등록")!.click());
    expect(toast).toHaveBeenCalledWith({ text: "댓글을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요", tone: "bad" });
    expect(ta.value).toBe("안녕");
  });
  it("쓰기가 막혔으면(종료 등) 토스트 + 목록 다시 받기", async () => {
    api.fetchComments.mockResolvedValueOnce(P([]));
    api.fetchComments.mockResolvedValueOnce(P([], { canWrite: false, writeBlock: "ended" }));
    const { toast } = await mount();
    api.createComment.mockRejectedValue(new ApiException({ code: "ROOM_NOT_EDITABLE", message: "ROOM_NOT_EDITABLE", details: { reason: "ended" } }));
    typeIn(host.querySelector("textarea")!, "안녕");
    await act(async () => btn("등록")!.click());
    await flush();
    expect(toast).toHaveBeenCalledWith({ text: "종료된 스터디는 댓글을 쓸 수 없어요", tone: "bad" });
    expect(api.fetchComments).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("종료된 스터디는 댓글을 쓸 수 없어요");
  });
  it("수정 — 토큰은 @닉네임 으로 펼쳐 고치고, 저장은 토큰 본문", async () => {
    api.fetchComments.mockResolvedValue(P([C("1", { body: `<@${MINSU}> 확인`, author: person(ME, "철수"), mine: true, canEdit: true, canDelete: true })], { people: { [MINSU]: person(MINSU, "민수") } }));
    await mount();
    const edit = menuItem(items()[0], "수정")!;
    act(() => edit.click());
    const ta = items()[0].querySelector("textarea")!;
    expect(ta.value).toBe("@민수 확인");
    typeIn(ta, "@민수 확인했어요");
    api.updateComment.mockResolvedValue({ comment: C("1", { body: `<@${MINSU}> 확인했어요`, edited: true, mine: true, canEdit: true, canDelete: true }), people: {} });
    await act(async () => btn("저장", items()[0])!.click());
    expect(api.updateComment).toHaveBeenCalledWith("aws", "1", `<@${MINSU}> 확인했어요`);
    expect(items()[0].querySelector("textarea")).toBeNull();
    expect(items()[0].textContent).toContain("@민수 확인했어요");
    expect(items()[0].textContent).toContain("수정됨");
  });
  it("삭제 — 확인 뒤 delete, 목록에서 빠지고 총 개수 -1", async () => {
    api.fetchComments.mockResolvedValue(P([C("1", { mine: true, canEdit: true, canDelete: true }), C("2")]));
    const { toast } = await mount();
    const del = menuItem(items()[0], "삭제")!;
    act(() => del.click());
    expect(items()[0].querySelector('[role="alertdialog"]')!.textContent).toContain("이 댓글을 지울까요?");
    api.deleteComment.mockResolvedValue(undefined);
    await act(async () => btn("삭제", items()[0].querySelector('[role="alertdialog"]')!)!.click());
    expect(api.deleteComment).toHaveBeenCalledWith("aws", "1");
    expect(items().map((li) => li.dataset.comment)).toEqual(["2"]);
    expect(host.querySelector("h3")!.textContent).toBe("댓글1");
    expect(toast).toHaveBeenCalledWith({ text: "댓글을 지웠어요", tone: "ok" });
  });
});

describe("CommentSection — 갱신", () => {
  it("창으로 돌아오면 30초 지났을 때만 최신 쪽을 다시 받는다", async () => {
    api.fetchComments.mockResolvedValue(P([C("1")]));
    await mount();
    expect(api.fetchComments).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.fetchComments).toHaveBeenCalledTimes(1);
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.fetchComments).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it("mergeLatest — 펼친 오래된 댓글은 남기고 최신 쪽만 바꾼다 · 딥링크 창이면 통째로", () => {
    const prev = P([C("10"), C("11"), C("60")], { hasOlder: true });
    const next = P([C("60"), C("61")], { hasOlder: true, total: 4 });
    expect(mergeLatest(prev, next).items.map((c) => c.id)).toEqual(["10", "11", "60", "61"]);
    expect(mergeLatest(prev, P([C("61")], { hasOlder: false })).items.map((c) => c.id)).toEqual(["61"]);
    expect(mergeLatest({ ...prev, hasNewer: true }, next).items.map((c) => c.id)).toEqual(["60", "61"]);
  });
});

describe("CommentSection — 딥링크 #comment-{id}", () => {
  it("from=id 로 불러 그 댓글로 스크롤·포커스, 2초 강조 후 해제, 해시 제거", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    window.history.replaceState(null, "", "/my-study/aws?task=3#comment-12");
    api.fetchComments.mockImplementation((_s: string, _n: string, o?: { from?: string }) =>
      Promise.resolve(o?.from ? P([C("12"), C("13")], { target: { id: "12", state: "ok" }, hasOlder: true }) : P([C("13")])),
    );
    await mount();
    await flush();
    expect(api.fetchComments).toHaveBeenCalledWith("aws", "3", { from: "12" });
    expect(items().map((li) => li.dataset.comment)).toEqual(["12", "13"]);
    expect(scrolled).toEqual(["comment-12"]);
    expect(document.activeElement?.id).toBe("comment-12");
    expect(items()[0].dataset.flash).toBe("true");
    expect(items()[0].className).toContain("motion-reduce:transition-none");
    expect(window.location.hash).toBe("");
    act(() => vi.advanceTimersByTime(2100));
    expect(items()[0].dataset.flash).toBeUndefined();
  });
  it("같은 화면에서 같은 노드 링크를 다시 누르면(announceHash) 다시 불러 찾아간다 · 다른 노드 링크는 무시", async () => {
    api.fetchComments.mockImplementation((_s: string, _n: string, o?: { from?: string }) =>
      Promise.resolve(P([C("12"), C("13")], o?.from ? { target: { id: o.from, state: "ok" } } : {})),
    );
    await mount();
    expect(scrolled).toEqual([]);
    await act(async () => announceHash("/my-study/aws?tab=curriculum&item=5#comment-12"));
    await flush();
    expect(scrolled).toEqual([]);
    expect(api.fetchComments).toHaveBeenCalledTimes(1);
    await act(async () => announceHash("/my-study/aws?task=3#comment-13"));
    await flush();
    expect(api.fetchComments).toHaveBeenLastCalledWith("aws", "3", { from: "13" });
    expect(scrolled).toEqual(["comment-13"]);
    await act(async () => announceHash("/my-study/aws?tab=curriculum&item=3#comment-13"));
    await flush();
    expect(scrolled).toEqual(["comment-13", "comment-13"]);
  });
  it.each([
    ["deleted", "삭제된 댓글이에요"],
    ["missing", "댓글을 찾을 수 없어요"],
  ] as const)("대상이 %s — 섹션으로 + 토스트", async (state, text) => {
    window.history.replaceState(null, "", "/my-study/aws?task=3#comment-12");
    api.fetchComments.mockResolvedValue(P([C("13")], { target: { id: "12", state } }));
    const { toast } = await mount();
    await flush();
    expect(scrolled).toEqual(["comments"]);
    expect(document.activeElement?.id).toBe("comments");
    expect(toast).toHaveBeenCalledWith({ text, tone: "bad" });
  });
  it("시험 잠금 — 섹션(잠금 안내)으로, 토스트 없음", async () => {
    window.history.replaceState(null, "", "/my-study/aws?task=3#comment-12");
    api.fetchComments.mockResolvedValue(P([], { locked: { reason: "exam" }, canWrite: false, writeBlock: "exam_locked", total: 2 }));
    const { toast } = await mount();
    await flush();
    expect(scrolled).toEqual(["comments"]);
    expect(host.textContent).toContain("시험을 제출하면 댓글을 볼 수 있어요");
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("CommentSection — 리뷰 후속", () => {
  it("M7: 딥링크 조회 중에 [새로 고침]이 끼어도 딥링크 목록으로 끝을 맺고(스크롤·해시 제거), 같은 링크를 다시 누르면 다시 부른다", async () => {
    window.history.replaceState(null, "", "/my-study/aws?task=3");
    let release: () => void = () => {};
    api.fetchComments.mockImplementation((_s: string, _n: string, o?: { from?: string }) =>
      o?.from
        ? new Promise((r) => (release = () => r(P([C("12"), C("13")], { target: { id: "12", state: "ok" } }))))
        : Promise.resolve(P([C("13")])),
    );
    await mount();
    expect(items().map((li) => li.dataset.comment)).toEqual(["13"]);
    await act(async () => announceHash("/my-study/aws?task=3#comment-12")); // 딥링크 조회 출발(응답 대기)
    await act(async () => btn("새로 고침")!.click()); // 끼어든 최신 쪽 조회 — 먼저 끝난다
    await flush();
    await act(async () => release());
    await flush();
    expect(items().map((li) => li.dataset.comment)).toEqual(["12", "13"]);
    expect(scrolled).toEqual(["comment-12"]);
    const calls = api.fetchComments.mock.calls.length;
    await act(async () => announceHash("/my-study/aws?task=3#comment-12"));
    await act(async () => release());
    await flush();
    expect(api.fetchComments.mock.calls.length).toBe(calls + 1);
    expect(scrolled).toEqual(["comment-12", "comment-12"]);
  });
  it("M12: 딥링크 창(hasNewer)에서는 「이전 댓글 더 보기」 에 숫자가 없다", async () => {
    window.history.replaceState(null, "", "/my-study/aws?task=3#comment-120");
    api.fetchComments.mockResolvedValue(P([C("120"), C("121")], { hasOlder: true, hasNewer: true, total: 300, target: { id: "120", state: "ok" } }));
    await mount();
    await flush();
    expect(btn("이전 댓글 더 보기")).toBeDefined();
  });
});
