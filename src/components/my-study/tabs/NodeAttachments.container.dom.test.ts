// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { FileMeta } from "@/lib/api/types";

const api = vi.hoisted(() => ({ fetchNodeFiles: vi.fn(), fetchNodeFilesOrEmpty: vi.fn(), setNodeFiles: vi.fn(), nodeImageUrls: vi.fn() }));
vi.mock("@/lib/api/nodeFiles", () => api);
vi.mock("@/lib/api/submission", () => ({ fileUrl: vi.fn() }));
import { NodeDescription } from "./NodeDescription";

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
  api.nodeImageUrls.mockImplementation(async (l: FileMeta[]) => new Map(l.map((x) => [x.id, `https://sb.test/sign/${x.id}`])));
  await act(async () => root.render(createElement(NodeDescription, { nodeId: "1", desc: "", emptyText: "설명 없음", canRemove: true, toast: vi.fn() })));
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

describe("NodeDescription — 설명 그림과 첨부 목록이 한 목록 (md-images §4.1)", () => {
  const img = (id: string, name: string, contentType = "image/png"): FileMeta => ({ id, name, contentType, size: 1, status: "ready" });
  /** 설명 속 그림(첨부 목록 썸네일 제외) */
  const descImgs = () => Array.from(host.querySelectorAll("img")).filter((i) => !i.closest("li"));
  it("목록을 한 번 받고, 이미지만 서명해 설명 그림으로 — 같은 이름은 마지막 것", async () => {
    act(() => root.unmount());
    api.fetchNodeFilesOrEmpty.mockReset().mockResolvedValue([img("old", "v.png"), f("doc"), img("new", "v.png"), img("s", "s.svg", "image/svg+xml")]);
    api.nodeImageUrls.mockClear();
    root = createRoot(host);
    await act(async () => root.render(createElement(NodeDescription, { nodeId: "9", desc: "![](attachment:v.png)\n\n![](attachment:s.svg)\n\n![](attachment:doc.pdf)", emptyText: "", canRemove: false, toast: vi.fn() })));
    await flush();
    await flush();
    expect(api.fetchNodeFilesOrEmpty).toHaveBeenCalledTimes(1);
    expect(api.nodeImageUrls).toHaveBeenCalledTimes(1);
    expect(api.nodeImageUrls.mock.calls[0][0].map((x: FileMeta) => x.id)).toEqual(["old", "new", "s"]);
    const srcs = descImgs().map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(["https://sb.test/sign/new", "https://sb.test/sign/s"]);
    expect(descImgs()[1].className).toContain("bg-white");
    // 첨부 목록 썸네일도 같은 서명 URL — 서명은 한 번
    expect(Array.from(host.querySelectorAll("li img")).map((i) => i.getAttribute("src"))).toEqual(["https://sb.test/sign/old", "https://sb.test/sign/new", "https://sb.test/sign/s"]);
    expect(host.textContent).toContain("그림을 찾을 수 없어요 · doc.pdf");
    expect(host.querySelector("h3")?.textContent).toBe("첨부 파일 4");
  });
  it("그림이 깨지면 그 파일만 다시 서명", async () => {
    act(() => root.unmount());
    api.fetchNodeFilesOrEmpty.mockReset().mockResolvedValue([img("a", "a.png")]);
    api.nodeImageUrls.mockReset().mockResolvedValueOnce(new Map([["a", "https://sb.test/old"]])).mockResolvedValueOnce(new Map([["a", "https://sb.test/new"]]));
    root = createRoot(host);
    await act(async () => root.render(createElement(NodeDescription, { nodeId: "9", desc: "![](attachment:a.png)", emptyText: "", canRemove: false, toast: vi.fn() })));
    await flush();
    await flush();
    expect(descImgs()[0].getAttribute("src")).toBe("https://sb.test/old");
    await act(async () => void descImgs()[0].dispatchEvent(new Event("error")));
    await flush();
    expect(api.nodeImageUrls).toHaveBeenCalledTimes(2);
    expect(descImgs()[0].getAttribute("src")).toBe("https://sb.test/new");
    expect(host.querySelector("li img")?.getAttribute("src")).toBe("https://sb.test/new");
  });
  it("설명 그림·썸네일을 누르면 라이트박스 하나 — 그 파일부터, 첨부 목록 순서로 넘긴다 (B3·D16)", async () => {
    act(() => root.unmount());
    api.fetchNodeFilesOrEmpty.mockReset().mockResolvedValue([img("a", "a.png"), f("doc"), img("b", "b.png")]);
    api.nodeImageUrls.mockReset().mockImplementation(async (l: FileMeta[]) => new Map(l.map((x) => [x.id, `https://sb.test/${x.id}`])));
    root = createRoot(host);
    await act(async () => root.render(createElement(NodeDescription, { nodeId: "9", desc: "본문 ![](attachment:b.png)", emptyText: "", canRemove: false, toast: vi.fn() })));
    await flush();
    await flush();
    const dlg = () => document.querySelector('[role="dialog"]');
    await act(async () => void descImgs()[0].closest("button")!.click());
    expect(dlg()?.getAttribute("aria-label")).toBe("b.png (2/2)");
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(dlg()?.getAttribute("aria-label")).toBe("a.png (1/2)");
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dlg()).toBeNull();
    await act(async () => void host.querySelector<HTMLButtonElement>('button[aria-label="a.png 크게 보기"]')!.click());
    expect(dlg()?.getAttribute("aria-label")).toBe("a.png (1/2)");
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  });
});
