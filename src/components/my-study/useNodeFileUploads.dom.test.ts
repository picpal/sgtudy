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

const savedFile: FileMeta = { id: "s1", name: "기존.pdf", contentType: "application/pdf", size: 3, status: "ready" };
const file = (n: string) => new File(["abc"], n, { type: "application/pdf" });
const flush = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});

function Harness({ saved }: { saved: FileMeta[] }) {
  const [nodeId, sn] = useState<string | null>("21");
  const [selected, setSelected] = useState(saved.map((f) => f.id));
  const hook = useNodeFileUploads({ nodeId, saved, selected, onSelect: setSelected, toast: () => {} });
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

  it("discardUnsaved aborts in-flight uploads and discards ones that finish registering afterwards", async () => {
    let finish!: () => void;
    api.upload.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    api.register.mockResolvedValue({ id: "late", name: "c.pdf", contentType: "application/pdf", size: 3, status: "ready" });
    mount();
    act(() => out.h.pick([file("c.pdf")]));
    await flush();
    expect(out.h.uploading).toBe(true);
    act(() => out.h.discardUnsaved());
    expect(out.h.uploading).toBe(false);
    finish();
    await flush();
    expect(api.discard).toHaveBeenCalledWith("late");
    expect(out.h.rows.map((r) => r.fileId)).toEqual(["s1"]);
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
