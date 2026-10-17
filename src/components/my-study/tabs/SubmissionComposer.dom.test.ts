// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SubmissionComposer } from "./SubmissionComposer";
import type { Composer } from "../useSubmissionComposer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: () => null }));
Element.prototype.scrollIntoView = () => {}; // jsdom 에 없다 — InlineConfirm 이 연다

let root: Root | null = null;
afterEach(() => act(() => root?.unmount()));
const fake = (dirty: boolean) =>
  ({ dirty, body: "본문", links: [], rows: [], linkInput: "", linkError: "", busy: false, blocker: null, label: "수정 저장", online: true, uploading: false, canRetry: false }) as unknown as Composer;
const mount = (dirty: boolean, onCancel = vi.fn()) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(SubmissionComposer, { c: fake(dirty), editing: true, late: false, onCancel })));
  const btn = (t: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === t);
  return { host, onCancel, btn };
};

describe("SubmissionComposer 취소 (Q1-11 — 바뀐 내용이 있으면 버리기 전에 묻는다)", () => {
  it("바뀐 게 없으면 바로 취소", () => {
    const { btn, onCancel } = mount(false);
    act(() => btn("취소")!.click());
    expect(onCancel).toHaveBeenCalled();
  });
  it("바뀐 게 있으면 확인 → 계속 편집은 그대로, 버리기는 취소", () => {
    const { btn, onCancel, host } = mount(true);
    act(() => btn("취소")!.click());
    expect(onCancel).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alertdialog]")?.textContent).toContain("저장하지 않은 수정이 있어요");
    act(() => btn("계속 편집")!.click());
    expect(host.querySelector("[role=alertdialog]")).toBeNull();
    act(() => btn("취소")!.click());
    act(() => btn("버리기")!.click());
    expect(onCancel).toHaveBeenCalled();
  });
});
