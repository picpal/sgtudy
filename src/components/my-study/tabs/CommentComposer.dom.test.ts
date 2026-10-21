// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommentComposer, type ComposerHandle, type MentionMember } from "./CommentComposer";
import { commentDraftKey } from "../commentDraft";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};

const ME = "00000000-0000-4000-8000-000000000001";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const M = (n: number, nickname: string): MentionMember => ({ userId: uid(n), nickname, tone: "mint" });
const MEMBERS = [M(1, "철수"), M(2, "김 하나"), M(3, "하나둘"), M(4, "민수")];

let root: Root | null = null;
let host: HTMLElement;
type P = Partial<ComponentProps<typeof CommentComposer>>;
function mount(p: P = {}) {
  const onSubmit = p.onSubmit ?? vi.fn(async () => true);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(CommentComposer, { members: MEMBERS, meId: ME, submitLabel: "등록", label: "댓글 쓰기", onSubmit, ...p })));
  return { onSubmit };
}
const area = () => host.querySelector("textarea")!;
const listbox = () => host.querySelector<HTMLElement>('[role="listbox"]');
// 아바타 머리글자는 빼고 이름(+ "(나)")만
const optText = (o: Element) => [...o.children].slice(1).map((c) => c.textContent).join("");
const options = () => [...host.querySelectorAll<HTMLElement>('[role="option"]')].map(optText);
const btn = (t: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === t) as HTMLButtonElement;
/** 값을 넣고 캐럿을 끝(또는 caret)에 둔 input 이벤트 — 조합 중 글자도 input 으로 온다 */
const typeIn = (v: string, caret = v.length) =>
  act(() => {
    const el = area();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, v);
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const key = (k: string, o: KeyboardEventInit & { keyCode?: number } = {}) => {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o });
  if (o.keyCode !== undefined) Object.defineProperty(e, "keyCode", { value: o.keyCode });
  act(() => {
    area().dispatchEvent(e);
  });
  return e;
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("CommentComposer — 멘션 자동완성(MentionPicker)", () => {
  it("@ 를 치면 그룹장·ACTIVE 후보가 열린다 — 본인은 빠진다, ARIA combobox/listbox", () => {
    mount();
    expect(area().getAttribute("role")).toBe("combobox");
    expect(area().getAttribute("aria-expanded")).toBe("false");
    typeIn("안녕 @");
    expect(options()).toEqual(["김 하나", "하나둘", "민수"]);
    expect(area().getAttribute("aria-expanded")).toBe("true");
    expect(area().getAttribute("aria-controls")).toBe(listbox()!.id);
    const first = host.querySelector('[role="option"]')!;
    expect(area().getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.getAttribute("aria-selected")).toBe("true");
  });
  it("한글 조합 중 글자(자모)로도 찾는다 — 접두 일치 먼저, 이메일 a@b 는 열지 않는다", () => {
    mount();
    typeIn("@ㅎ");
    expect(options()).toEqual(["하나둘", "김 하나"]);
    typeIn("@한");
    expect(options()).toEqual(["하나둘", "김 하나"]);
    typeIn("mail a@b");
    expect(listbox()).toBeNull();
  });
  it("↑↓ 순환 · Enter 선택 → 공백 있는 닉네임도 @닉네임 으로 넣고, 등록 때 <@uuid> 토큰", async () => {
    const { onSubmit } = mount();
    typeIn("@하나");
    expect(options()).toEqual(["하나둘", "김 하나"]);
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowUp");
    expect(optText(host.querySelector('[aria-selected="true"]')!)).toBe("김 하나");
    key("Enter");
    expect(area().value).toBe("@김 하나 ");
    expect(listbox()).toBeNull();
    typeIn("@김 하나 반가워요");
    await act(async () => btn("등록").click());
    expect(onSubmit).toHaveBeenCalledWith(`<@${uid(2)}> 반가워요`);
  });
  it("Tab 도 선택 · Esc 는 닫기만(글 유지), 새 @ 를 치면 다시 연다", () => {
    mount();
    typeIn("@민");
    const esc = key("Escape");
    expect(esc.defaultPrevented).toBe(true);
    expect([listbox(), area().value]).toEqual([null, "@민"]);
    typeIn("@민 @");
    expect(listbox()).not.toBeNull();
    key("Tab");
    expect(area().value).toBe("@민 @김 하나 ");
  });
  it("IME 조합 중(isComposing · keyCode 229)의 Enter·↓·Esc 는 처리하지 않는다 — 조합 확정이 선택으로 새지 않게", () => {
    mount();
    typeIn("@하");
    const a = key("Enter", { isComposing: true });
    const b = key("Enter", { keyCode: 229 });
    const c = key("ArrowDown", { keyCode: 229 });
    const d = key("Escape", { isComposing: true });
    expect([a, b, c, d].map((e) => e.defaultPrevented)).toEqual([false, false, false, false]);
    expect(area().value).toBe("@하");
    expect(listbox()).not.toBeNull();
    expect(optText(host.querySelector('[aria-selected="true"]')!)).toBe("하나둘");
    act(() => area().dispatchEvent(new Event("compositionend", { bubbles: true })));
    key("Enter");
    expect(area().value).toBe("@하나둘 ");
  });
  it("후보를 마우스로 고를 수 있다(입력창 포커스 유지)", () => {
    mount();
    typeIn("@");
    const opt = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => optText(o) === "민수")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      opt.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
    act(() => opt.click());
    expect(area().value).toBe("@민수 ");
  });
});

describe("CommentComposer — 등록·상한", () => {
  it("Enter 는 줄바꿈, Cmd/Ctrl+Enter 는 등록 — 후보가 열려 있어도 등록", async () => {
    const { onSubmit } = mount();
    typeIn("첫 줄");
    expect(key("Enter").defaultPrevented).toBe(false);
    typeIn("첫 줄\n@");
    await act(async () => {
      key("Enter", { metaKey: true });
    });
    expect(onSubmit).toHaveBeenCalledWith("첫 줄\n@");
    expect(area().value).toBe("");
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toBe("댓글을 등록했어요");
  });
  it("빈 글은 등록 단추가 꺼져 있다 · 공백뿐이면 안내", async () => {
    const { onSubmit } = mount();
    expect(btn("등록").disabled).toBe(true);
    typeIn("   ");
    key("Enter", { ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("댓글 내용을 입력해 주세요");
  });
  it("글자 수 — 1,800자 넘으면 n/2,000 표시, 2,000자 넘으면 등록 불가(멘션 토큰은 1자)", () => {
    mount();
    typeIn("가".repeat(1800));
    expect(host.querySelector("[data-count]")).toBeNull();
    typeIn("가".repeat(1801));
    expect(host.querySelector("[data-count]")!.textContent).toBe("1,801/2,000");
    typeIn("가".repeat(2001));
    expect(host.querySelector("[data-count]")!.className).toContain("text-warn");
    expect(btn("등록").disabled).toBe(true);
    expect(area().getAttribute("aria-invalid")).toBe("true");
  });
  it("멘션은 10명까지 — 11번째를 고르면 넣지 않고 안내", () => {
    const many = Array.from({ length: 11 }, (_, i) => M(10 + i, `멤버${String.fromCharCode(65 + i)}`));
    mount({ members: many });
    let text = "";
    for (let i = 0; i < 10; i++) {
      typeIn(`${text}@멤버${String.fromCharCode(65 + i)}`);
      key("Enter");
      text = area().value;
    }
    expect(text.match(/@멤버/g)).toHaveLength(10);
    typeIn(`${text}@멤버K`);
    key("Enter");
    expect(area().value).toBe(`${text}@멤버K`);
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("한 댓글에서 10명까지 부를 수 있어요");
  });
  it("미리 보기 — 인라인 md(parseInline) + 멘션 칩", () => {
    mount();
    typeIn("@");
    key("Enter"); // 김 하나
    typeIn("@김 하나 **굵게** `코드`");
    act(() => btn("미리 보기").click());
    const pv = host.querySelector("[data-comment-preview]")!;
    expect(pv.querySelector("strong")!.textContent).toBe("굵게");
    expect(pv.querySelector("code")!.textContent).toBe("코드");
    expect(pv.querySelector("[data-mention]")!.textContent).toBe("@김 하나");
  });
});

describe("CommentComposer — 임시 저장·답글·수정 모드", () => {
  it("노드별 localStorage 임시 저장 → 다시 열면 복원(멘션 포함), 등록하면 지운다", async () => {
    const k = commentDraftKey("3", ME);
    mount({ draftKey: k });
    typeIn("@");
    key("Enter");
    typeIn("@김 하나 다음에 봐요");
    expect(JSON.parse(localStorage.getItem(k)!)).toEqual({ text: "@김 하나 다음에 봐요", picks: [{ userId: uid(2), nickname: "김 하나" }], at: expect.any(Number) });
    act(() => root!.unmount());
    document.body.innerHTML = "";
    const { onSubmit } = mount({ draftKey: k });
    expect(area().value).toBe("@김 하나 다음에 봐요");
    await act(async () => btn("등록").click());
    expect(onSubmit).toHaveBeenCalledWith(`<@${uid(2)}> 다음에 봐요`);
    expect(localStorage.getItem(k)).toBeNull();
  });
  it("저장소가 던져도 동작한다", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    mount({ draftKey: "k" });
    typeIn("글");
    expect(area().value).toBe("글");
    spy.mockRestore();
  });
  it("[답글] 핸들 — 끝에 @작성자 를 넣고 포커스, 멘션으로 등록", async () => {
    const ref = createRef<ComposerHandle>();
    const { onSubmit } = mount({ ref });
    typeIn("좋아요");
    act(() => ref.current!.reply({ userId: uid(4), nickname: "민수" }));
    expect(area().value).toBe("좋아요 @민수 ");
    expect(document.activeElement).toBe(area());
    await act(async () => btn("등록").click());
    expect(onSubmit).toHaveBeenCalledWith(`좋아요 <@${uid(4)}>`);
  });
  it("수정 모드 — 처음 글·picks 로 시작, 실패하면 글 유지, Esc·취소는 onCancel", async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn(async () => false);
    mount({ initial: { text: "@민수 확인", picks: [{ userId: uid(4), nickname: "민수" }] }, onCancel, onSubmit, submitLabel: "저장" });
    await act(async () => btn("저장").click());
    expect(onSubmit).toHaveBeenCalledWith(`<@${uid(4)}> 확인`);
    expect(area().value).toBe("@민수 확인");
    key("Escape");
    act(() => btn("취소").click());
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("CommentComposer — 리뷰 후속", () => {
  it("M9: 한글 조합 중에 후보를 누르면 조합을 끝낸 뒤(compositionend) 확정 글로 한 번만 넣는다", () => {
    mount();
    typeIn("@하");
    const el = area();
    act(() => el.focus());
    act(() => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    const blur = vi.spyOn(el, "blur");
    const opt = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => optText(o) === "하나둘")!;
    act(() => opt.click());
    expect(blur).toHaveBeenCalled(); // 조합을 확정시킨다
    expect(area().value).toBe("@하"); // 조합 중에는 value 를 바꾸지 않는다
    // 브라우저가 조합을 확정 — 확정 글자("하나")로 끝난다
    typeIn("@하나");
    act(() => {
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    expect(area().value).toBe("@하나둘 ");
  });
  it("M9: compositionend 가 오지 않으면 잠시 뒤 DOM 값으로 넣는다", () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    mount();
    typeIn("@하");
    act(() => {
      area().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    const opt = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => optText(o) === "하나둘")!;
    act(() => opt.click());
    expect(area().value).toBe("@하");
    act(() => vi.advanceTimersByTime(350));
    expect(area().value).toBe("@하나둘 ");
    vi.useRealTimers();
  });
  it("M8: 등록 요청 중에 이어 친 글은 응답 뒤에도 남는다(보낸 앞부분만 지운다)", async () => {
    let resolve: (ok: boolean) => void = () => {};
    const onSubmit = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    mount({ onSubmit, draftKey: "k" });
    typeIn("첫 댓글");
    await act(async () => btn("등록").click());
    typeIn("첫 댓글 그리고 다음");
    await act(async () => resolve(true));
    expect(area().value).toBe("그리고 다음");
    expect(JSON.parse(localStorage.getItem("k")!).text).toBe("그리고 다음");
  });
  it("후보 창 — 입력창이 화면 위쪽이면 아래로, 아니면 위로 연다", () => {
    mount();
    const rect = vi.spyOn(area(), "getBoundingClientRect");
    rect.mockReturnValue({ top: 40, bottom: 100, left: 0, right: 300, width: 300, height: 60, x: 0, y: 40, toJSON: () => ({}) });
    typeIn("@");
    expect(listbox()!.dataset.below).toBe("true");
    expect(listbox()!.className).toContain("top-[calc(100%+6px)]");
    typeIn("");
    rect.mockReturnValue({ top: 600, bottom: 660, left: 0, right: 300, width: 300, height: 60, x: 0, y: 600, toJSON: () => ({}) });
    typeIn("@");
    expect(listbox()!.dataset.below).toBeUndefined();
    expect(listbox()!.className).toContain("bottom-[calc(100%+6px)]");
  });
  it("M14: 14일 지난 임시 저장은 읽지 않고 지운다", async () => {
    const { readCommentDraft, DRAFT_TTL_MS } = await import("../commentDraft");
    localStorage.setItem("old", JSON.stringify({ text: "옛 글", picks: [], at: 1000 }));
    expect(readCommentDraft(localStorage, "old", 1000 + DRAFT_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem("old")).toBeNull();
    localStorage.setItem("new", JSON.stringify({ text: "새 글", picks: [], at: 1000 }));
    expect(readCommentDraft(localStorage, "new", 2000)).toEqual({ text: "새 글", picks: [] });
  });
});
