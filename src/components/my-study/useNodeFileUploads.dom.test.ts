// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FileMeta } from "@/lib/api/types";
import { useNodeFileUploads } from "./useNodeFileUploads";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  register: vi.fn(),
  discard: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/lib/api/nodeFiles", () => ({ registerNodeFile: api.register, discardNodeUnattached: api.discard }));
vi.mock("@/lib/api/submission", () => ({ roomIdOfNode: () => Promise.resolve("7") }));
vi.mock("@/lib/api/upload", () => ({ uploadAttachment: api.upload, uploadErrorText: () => "실패" }));

type Hook = ReturnType<typeof useNodeFileUploads>;
let root: Root | null = null;
const out = {} as { h: Hook; setNode: (n: string | null) => void };
afterEach(() => act(() => root?.unmount()));
beforeEach(() => {
  api.register.mockReset();
  api.discard.mockReset().mockResolvedValue(true);
  api.upload.mockReset();
});

const toastSpy = vi.fn();
const savedFile: FileMeta = { id: "s1", name: "기존.pdf", contentType: "application/pdf", size: 3, status: "ready" };
const file = (n: string) => new File(["abc"], n, { type: "application/pdf" });
const flush = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});

function Harness({ saved }: { saved: FileMeta[] }) {
  const [nodeId, sn] = useState<string | null>("21");
  const [selected, setSelected] = useState(saved.map((f) => f.id));
  const hook = useNodeFileUploads({ nodeId, saved, selected, onSelect: setSelected, toast: toastSpy });
  useEffect(() => {
    out.h = hook;
    out.setNode = sn;
  }, [hook, sn]);
  return null;
}
const mount = () => {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(createElement(Harness, { saved: [savedFile] })));
};

describe("useNodeFileUploads", () => {
  it("discardUnsaved discards registered-but-unsaved files only and clears them from rows", async () => {
    api.upload.mockResolvedValue(undefined);
    api.register.mockImplementation((_n: string, f: { name: string }) => Promise.resolve({ id: `new-${f.name}`, name: f.name, contentType: "application/pdf", size: 3, status: "ready" }));
    mount();
    act(() => out.h.pick([file("a.pdf"), file("b.pdf")]));
    await flush();
    expect(out.h.rows.map((r) => r.fileId)).toEqual(["s1", "new-a.pdf", "new-b.pdf"]);
    expect(api.upload.mock.calls[0][0]).toMatch(/^n\/7\/21\/.+\.pdf$/);

    act(() => out.h.discardUnsaved());
    expect(api.discard.mock.calls.map((c) => c[0]).sort()).toEqual(["new-a.pdf", "new-b.pdf"]);
    // 선택 id 정리는 호출자 몫 — 메타가 없는 id 는 줄에서 숨는다
    expect(out.h.rows.map((r) => r.fileId)).toEqual(["s1"]);
    expect(out.h.uploading).toBe(false);
  });

  it("abort right after upload skips register (N-3)", async () => {
    let finish!: () => void;
    api.upload.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    mount();
    act(() => out.h.pick([file("c.pdf")]));
    await flush();
    expect(out.h.uploading).toBe(true);
    act(() => out.h.discardUnsaved());
    expect(out.h.uploading).toBe(false);
    finish();
    await flush();
    expect(api.register).not.toHaveBeenCalled();
    expect(out.h.rows.map((r) => r.fileId)).toEqual(["s1"]);
  });

  it("abort while registering discards the file once registration finishes", async () => {
    let registered!: (m: FileMeta) => void;
    api.upload.mockResolvedValue(undefined);
    api.register.mockImplementation(() => new Promise<FileMeta>((r) => (registered = r)));
    mount();
    act(() => out.h.pick([file("c.pdf")]));
    await flush();
    expect(api.register).toHaveBeenCalled();
    act(() => out.h.discardUnsaved());
    registered({ id: "late", name: "c.pdf", contentType: "application/pdf", size: 3, status: "ready" });
    await flush();
    expect(api.discard).toHaveBeenCalledWith("late");
    expect(out.h.rows.map((r) => r.fileId)).toEqual(["s1"]);
  });

  it("discardUnsaved sees a file registered just before, even before re-render (N-2)", async () => {
    let registered!: (m: FileMeta) => void;
    api.upload.mockResolvedValue(undefined);
    api.register.mockImplementation(() => new Promise<FileMeta>((r) => (registered = r)));
    mount();
    act(() => out.h.pick([file("d.pdf")]));
    await flush();
    const stale = out.h; // 등록 완료 전 렌더의 훅 값
    await act(async () => {
      registered({ id: "fresh", name: "d.pdf", contentType: "application/pdf", size: 3, status: "ready" });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      stale.discardUnsaved(); // 같은 act 안 — 아직 다시 그려지지 않았다
    });
    expect(api.discard).toHaveBeenCalledWith("fresh");
  });

  it("an inline saved={[]} literal re-rendered many times does not loop (N-1)", () => {
    const host = document.createElement("div");
    root = createRoot(host);
    for (let i = 0; i < 5; i++) act(() => root!.render(createElement(Harness, { saved: [] })));
    expect(out.h.rows).toEqual([]);
    act(() => out.h.markError("x", "다시 올려 주세요"));
    for (let i = 0; i < 3; i++) act(() => root!.render(createElement(Harness, { saved: [] })));
    expect(out.h.uploading).toBe(false);
  });

  it("a queued file whose node became a temp row fails instead of sticking as uploading", async () => {
    const done: (() => void)[] = [];
    api.upload.mockImplementation(() => new Promise<void>((r) => done.push(r)));
    api.register.mockImplementation((_n: string, f: { name: string }) => Promise.resolve({ id: `new-${f.name}`, name: f.name, contentType: "application/pdf", size: 3, status: "ready" }));
    mount();
    act(() => out.h.pick([file("a.pdf"), file("b.pdf"), file("c.pdf")])); // 동시성 2 — c 는 큐에서 기다린다
    await flush();
    act(() => out.setNode(null));
    done.forEach((r) => r());
    await flush();
    const c = out.h.rows.find((r) => r.name === "c.pdf")!;
    expect(c.status).toBe("error");
    expect(c.error).toBe("저장한 뒤 파일을 붙일 수 있어요");
    expect(out.h.uploading).toBe(false);
    expect(out.h.canRetry(c)).toBe(true);
  });
});

describe("useNodeFileUploads — 그림 사전 검사·조각 복사 (B4)", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const png = (n: string, bytes: BlobPart) => new File([bytes], n, { type: "image/png" });
  beforeEach(() => toastSpy.mockReset());

  it("PNG 라고 고른 파일의 내용이 PNG 가 아니면 올리지 않고 줄 오류(다시 시도 없음)", async () => {
    mount();
    act(() => out.h.pick([png("가짜.png", "<!doctype html><script>x</script>")]));
    await flush();
    expect(api.upload).not.toHaveBeenCalled();
    const row = out.h.rows.find((r) => r.name === "가짜.png")!;
    expect(row.status).toBe("error");
    expect(row.error).toBe("파일 내용이 PNG 그림이 아니에요");
    expect(out.h.canRetry(row)).toBe(false);
  });

  it("진짜 PNG 는 올리고, 올린 그림 줄만 조각 복사 대상", async () => {
    api.upload.mockResolvedValue(undefined);
    api.register.mockImplementation((_n: string, f: { name: string; mime: string }) => Promise.resolve({ id: "img1", name: f.name, contentType: f.mime, size: 12, status: "ready" }));
    mount();
    act(() => out.h.pick([png("AWS VPC (1).png", PNG)]));
    await flush();
    expect(api.upload).toHaveBeenCalledTimes(1);
    const row = out.h.rows.find((r) => r.fileId === "img1")!;
    expect(out.h.canCopy(row)).toBe(true);
    expect(out.h.canCopy(out.h.rows.find((r) => r.fileId === "s1")!)).toBe(false); // PDF

    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    await act(async () => out.h.copySnippet(row));
    expect(write).toHaveBeenCalledWith("![](attachment:AWS%20VPC%20%281%29.png)");
    expect(toastSpy).toHaveBeenLastCalledWith({ text: "그림 조각을 복사했어요 · 설명에 붙여 넣으세요", tone: "ok" });

    write.mockRejectedValueOnce(new Error("denied"));
    await act(async () => out.h.copySnippet(row));
    expect(toastSpy.mock.lastCall?.[0].text).toContain("![](attachment:AWS%20VPC%20%281%29.png)");
  });
});

describe("useNodeFileUploads — SVG (0045)", () => {
  const svg = (n: string, text: string) => new File([text], n, { type: "image/svg+xml" });
  it("스크립트가 든 SVG 는 올리지 않고 걸린 규칙 문구로 줄 오류", async () => {
    mount();
    act(() => out.h.pick([svg("bad.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]));
    await flush();
    expect(api.upload).not.toHaveBeenCalled();
    const row = out.h.rows.find((r) => r.name === "bad.svg")!;
    expect([row.status, row.error]).toEqual(["error", "SVG 에 스크립트가 있어요(<script>)"]);
  });
  it("깨끗한 SVG 는 image/svg+xml 로 올린다", async () => {
    api.upload.mockResolvedValue(undefined);
    api.register.mockImplementation((_n: string, f: { name: string; mime: string }) => Promise.resolve({ id: "v1", name: f.name, contentType: f.mime, size: 9, status: "ready" }));
    mount();
    act(() => out.h.pick([svg("vpc.svg", '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>')]));
    await flush();
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload.mock.calls[0][0]).toMatch(/^n\/7\/21\/.+\.svg$/);
    expect(api.upload.mock.calls[0][2]).toBe("image/svg+xml");
    expect(out.h.rows.find((r) => r.fileId === "v1")?.status).toBe("ready");
  });
});
