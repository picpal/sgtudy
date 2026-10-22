// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TaskDetail } from "@/lib/api/types";
import { draftKey } from "../submissionDraft";
import { MySubmissionCard, type SubmitDraft } from "./MySubmissionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
// 편집기는 textarea 로 — 값·onChange 만 본다
vi.mock("@/components/ui/markdown-editor", async () => {
  const { createElement: h } = await import("react");
  return { MarkdownEditor: (p: { value: string; onChange: (v: string) => void }) => h("textarea", { "data-md": "", value: p.value, onChange: (e: { target: { value: string } }) => p.onChange(e.target.value) }) };
});

const KEY = draftKey("125", "me");
const detail = (mine: TaskDetail["mySubmission"] = null): TaskDetail =>
  ({ today: "2026-10-16", node: { id: "125", startDate: "2026-10-12", endDate: "2026-10-18", archived: false, task: { type: "assigned", submitted: 0, assigned: 1 } }, path: [], mySubmission: mine, isAssignee: true, allSubmitted: false, submissions: [] }) as unknown as TaskDetail;

let root: Root | null = null;
let host: HTMLElement;
let last: SubmitDraft | null = null;
const onDraft = vi.fn((d: SubmitDraft | null) => {
  last = d;
});
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  onDraft.mockClear();
  last = null;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});
const mount = (mine: TaskDetail["mySubmission"] = null) => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const state = mine ? ({ kind: "submitted" } as const) : ({ kind: "compose" } as const);
  act(() =>
    root!.render(
      createElement(MySubmissionCard, { detail: detail(mine), nodeId: "125", userId: "me", state, badge: { status: "open", text: "제출 전" }, onSaved: () => {}, onRefetch: () => {}, onOpenFile: () => {}, toast: () => {}, onDraftChange: onDraft }),
    ),
  );
};
const setVal = (el: HTMLTextAreaElement | HTMLInputElement, v: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const body = () => host.querySelector<HTMLTextAreaElement>("textarea[data-md]")!;
const linkInput = () => host.querySelector<HTMLInputElement>('input[placeholder="https://"]')!;
const tick = () =>
  act(() => {
    vi.advanceTimersByTime(600);
  });
const button = (t: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === t);

describe("과제 제출 작성 — 나가기 전에 물을 내용(onDraftChange)", () => {
  it("공백만 쓰면 묻지 않고, 이 기기 임시본도 남기지 않는다", async () => {
    mount();
    setVal(body(), "   \n  ");
    setVal(linkInput(), "   ");
    await tick();
    expect(last).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
  it("내용을 쓰면 묻는다 — [임시저장](keep)은 이 기기 임시본을 쓰고, [버리기](discard)는 지운다", async () => {
    mount();
    setVal(body(), "정리한 내용");
    expect(last).not.toBeNull();
    expect(last!.uploading).toBe(false);
    expect(last!.keep()).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!).body).toBe("정리한 내용");
    act(() => last!.discard());
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(last).toBeNull();
    expect(body().value).toBe("");
  });
  it("입력칸에 남은 링크도 내용이다", () => {
    mount();
    setVal(linkInput(), "https://example.com");
    expect(last).not.toBeNull();
  });
  it("저장된 제출과 앞뒤 공백만 다르면 묻지 않는다", () => {
    mount({ id: "s", bodyMd: "회고", links: [], files: [], firstSubmittedAt: "2026-10-15T00:00:00Z", isLate: false, updatedAt: "2026-10-15T00:00:00Z" });
    act(() => button("수정하기")!.click());
    setVal(body(), "  회고  ");
    expect(last).toBeNull();
    setVal(body(), "회고 고침");
    expect(last).not.toBeNull();
  });
  it("임시본을 [이어 쓰기]로 열고 더 고치지 않았으면 묻지 않는다", () => {
    localStorage.setItem(KEY, JSON.stringify({ body: "어제 쓴 글", links: [], files: [], at: "2026-10-15T00:00:00Z" }));
    mount();
    act(() => button("이어 쓰기")!.click());
    expect(body().value).toBe("어제 쓴 글");
    expect(last).toBeNull();
    setVal(body(), "어제 쓴 글 + 오늘");
    expect(last).not.toBeNull();
  });
  it("keep 이 저장소에 못 쓰면 false", () => {
    mount();
    setVal(body(), "글");
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(last!.keep()).toBe(false);
    spy.mockRestore();
  });
});
