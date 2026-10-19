// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { FileMeta } from "@/lib/api/types";

const api = vi.hoisted(() => ({ fetchNodeFiles: vi.fn(), fetchNodeFilesOrEmpty: vi.fn(), setNodeFiles: vi.fn() }));
vi.mock("@/lib/api/nodeFiles", () => api);
vi.mock("@/lib/api/submission", () => ({ fileUrl: vi.fn() }));
import { NodeAttachments } from "./NodeAttachments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const f = (id: string): FileMeta => ({ id, name: `${id}.pdf`, contentType: "application/pdf", size: 1, status: "ready" });
let host: HTMLDivElement;
let root: Root;
const flush = () => act(async () => { await Promise.resolve(); });
const click = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });

beforeEach(async () => {
  Object.values(api).forEach((m) => m.mockReset());
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.fetchNodeFilesOrEmpty.mockResolvedValue([f("a"), f("b")]);
  await act(async () => root.render(createElement(NodeAttachments, { nodeId: "1", canRemove: true, toast: vi.fn() })));
  await flush();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const confirmRemove = async (name: string) => {
  await click(host.querySelector(`button[aria-label="${name} 빼기"]`));
  await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "빼기" && !b.getAttribute("aria-label")) ?? null);
};

describe("NodeAttachments container", () => {
  it("sends fresh list minus f (keeps a file added after mount)", async () => {
    api.fetchNodeFiles.mockResolvedValue([f("a"), f("b"), f("c")]);
    api.setNodeFiles.mockResolvedValue([f("b"), f("c")]);
    await confirmRemove("a.pdf");
    await flush();
    expect(api.setNodeFiles).toHaveBeenCalledWith("1", ["b", "c"]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("‘a.pdf’을 뺐어요");
    expect(host.querySelector("h3")?.textContent).toBe("첨부 파일 2");
  });
  it("if f is already gone, just refreshes without writing", async () => {
    api.fetchNodeFiles.mockResolvedValue([f("b")]);
    await confirmRemove("a.pdf");
    await flush();
    expect(api.setNodeFiles).not.toHaveBeenCalled();
    expect(host.querySelector("h3")?.textContent).toBe("첨부 파일 1");
  });
  it("빼기 뒤 포커스 — 남은 파일이 있으면 제목, 마지막 파일을 빼면 알림 영역 (body 로 떨어지지 않게)", async () => {
    api.fetchNodeFiles.mockResolvedValueOnce([f("a"), f("b")]);
    api.setNodeFiles.mockResolvedValueOnce([f("b")]);
    await confirmRemove("a.pdf");
    await flush();
    expect(document.activeElement).toBe(host.querySelector("h3"));
    api.fetchNodeFiles.mockResolvedValueOnce([f("b")]);
    api.setNodeFiles.mockResolvedValueOnce([]);
    await confirmRemove("b.pdf");
    await flush();
    expect(host.querySelector("h3")).toBeNull();
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toBe("‘b.pdf’을 뺐어요");
    expect(document.activeElement).toBe(status);
    expect(document.activeElement).not.toBe(document.body);
  });
  it("disables every 빼기 while a removal is in flight", async () => {
    let done!: (v: FileMeta[]) => void;
    api.fetchNodeFiles.mockResolvedValue([f("a"), f("b")]);
    api.setNodeFiles.mockReturnValue(new Promise<FileMeta[]>((r) => (done = r)));
    await confirmRemove("a.pdf");
    await flush();
    const btns = Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-label$="빼기"]'));
    expect(btns.length).toBe(2);
    expect(btns.every((b) => b.disabled)).toBe(true);
    await act(async () => done([f("b")]));
    expect(api.setNodeFiles).toHaveBeenCalledTimes(1);
  });
});
