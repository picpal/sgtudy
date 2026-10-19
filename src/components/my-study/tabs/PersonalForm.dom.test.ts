// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FileMeta } from "@/lib/api/types";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import { AWS, CHULSU, REF_DAY } from "../fixtures";
import { EMPTY_OVERRIDES, buildTree, type LeafNode } from "../model";
import type { CurriculumApi } from "../useCurriculumApi";
import { DetailView } from "./DetailView";
import { PersonalForm } from "./PersonalForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ fetch: vi.fn(), register: vi.fn(), discard: vi.fn(), upload: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/api/nodeFiles", async (orig) => ({ ...(await orig<object>()), fetchNodeFiles: m.fetch, fetchNodeFilesOrEmpty: m.fetch, registerNodeFile: m.register, discardNodeUnattached: m.discard, setNodeFiles: m.set }));
vi.mock("@/lib/api/submission", async (orig) => ({ ...(await orig<object>()), roomIdOfNode: () => Promise.resolve("7"), fetchTask: () => new Promise(() => {}) }));
vi.mock("@/lib/api/upload", () => ({ uploadAttachment: m.upload, uploadErrorText: () => "실패" }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), useSearchParams: () => new URLSearchParams() }));

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const goal = tree.nodes.find((n) => n.id === "32") as LeafNode;
const meta = (id: string): FileMeta => ({ id, name: `${id}.pdf`, contentType: "application/pdf", size: 3, status: "ready" });
const period = { start: "2026-10-01", end: "2026-11-30" };

let root: Root | null = null;
let host: HTMLElement;
const toast = vi.fn();
const updatePersonal = vi.fn();
const onBack = vi.fn();
const api = { updatePersonal } as unknown as CurriculumApi;
const me = { id: CHULSU, nickname: "x", tone: "mint" } as unknown as Parameters<typeof MeProvider>[0]["me"];
const wrap = (el: ReturnType<typeof createElement>) =>
  createElement(TodayProvider, { today: REF_DAY } as Parameters<typeof TodayProvider>[0], createElement(MeProvider, { me } as Parameters<typeof MeProvider>[0], el));
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const start = async (el: ReturnType<typeof createElement>) => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(wrap(el)));
  await flush();
};
const detail = () =>
  createElement(DetailView, {
    n: goal, nodes: tree.nodes, canEdit: false, onOpen: () => {}, onBack, onEdit: () => {}, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted: () => {}, toast,
    viewerPending: false, isLeader: false, quietNotAssigned: false, roots: tree.roots, period, personal: { canAdd: true, perRound: 20 }, api,
  });
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
const backBtn = () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes("진행목표"))!;
const pick = async (name: string) => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["abc"], name, { type: "application/pdf" })] });
  act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
  await flush();
};
const openEdit = async () => {
  await start(detail());
  act(() => button("편집").click());
  await flush();
};

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  m.fetch.mockReset().mockResolvedValue([meta("s1")]);
  m.register.mockReset();
  m.discard.mockReset().mockResolvedValue(true);
  m.upload.mockReset();
  m.set.mockReset();
  toast.mockReset();
  updatePersonal.mockReset().mockResolvedValue({});
  onBack.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("PersonalForm 첨부 파일", () => {
  it("저장된 목표 — 붙은 파일 줄 + 안내(끌어다 놓기 + 한도)", async () => {
    await openEdit();
    expect(m.fetch).toHaveBeenCalledWith("32");
    expect(host.textContent).toContain("s1.pdf");
    expect(host.textContent).toContain("첨부 파일 (선택)");
    expect(host.textContent).toContain("끌어다 놓아도 돼요 · PNG");
  });

  it("1. 올리는 중 — 떠나려 하면 '버리기'/'계속 편집' 만, 문구 고정", async () => {
    m.upload.mockReturnValue(new Promise(() => {}));
    await openEdit();
    await pick("a.pdf");
    expect(button("파일을 올리는 중이에요").disabled).toBe(true);
    act(() => backBtn().click());
    expect(host.textContent).toContain("파일을 올리는 중이에요. 지금 나가면 올리던 파일은 버려져요");
    const dialog = host.querySelector('[role="alertdialog"]')!;
    expect(Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent?.trim())).toEqual(["계속 편집", "버리기"]);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("2. 버리기 — 등록만 된 파일을 버리고(붙은 파일은 그대로) 이동", async () => {
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    await openEdit();
    await pick("new1.pdf");
    act(() => backBtn().click());
    expect(host.textContent).toContain("저장하지 않은 수정이 있어요");
    act(() => button("버리기").click());
    await flush();
    expect(m.discard).toHaveBeenCalledWith("new1");
    expect(m.discard).not.toHaveBeenCalledWith("s1");
    expect(m.set).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });

  it("2. 취소 버튼 — 등록만 된 파일을 버린다", async () => {
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    await openEdit();
    await pick("new1.pdf");
    act(() => button("취소").click());
    await flush();
    expect(m.discard).toHaveBeenCalledWith("new1");
    expect(host.querySelector("form")).toBeNull();
  });

  it("3. 목록을 못 불러오면 — 잠그고 안내, 제목만 고쳐 저장해도 node_files_set 은 부르지 않는다", async () => {
    m.fetch.mockRejectedValue(new Error("x"));
    await openEdit();
    expect(host.textContent).toContain("첨부 파일 목록을 불러오지 못했어요 · 새로 고침해 주세요");
    expect(button("파일 고르기").disabled).toBe(true);
    expect(toast).toHaveBeenCalledWith({ text: "첨부 파일 목록을 불러오지 못했어요 · 새로 고침해 주세요", tone: "bad" });
    const title = host.querySelector<HTMLInputElement>("form input[type=text]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "고친 제목");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("저장").click());
    await flush();
    expect(updatePersonal).toHaveBeenCalled();
    expect(m.set).not.toHaveBeenCalled();
  });

  it("4. 임시 행 — 고르기 비활성 + '저장한 뒤 파일을 붙일 수 있어요', 목록을 부르지 않고(실패 토스트도 없다) 올리지 않는다", async () => {
    m.fetch.mockRejectedValue(new Error("temp id"));
    await start(createElement(PersonalForm, { n: { ...goal, temp: true }, roots: tree.roots, period, api, onDone: () => {}, onDirtyChange: () => {}, toast }));
    expect(host.textContent).toContain("저장한 뒤 파일을 붙일 수 있어요");
    expect(button("파일 고르기").disabled).toBe(true);
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("저장하는 중에는 파일 고르기도 막힌다", async () => {
    m.set.mockReturnValue(new Promise(() => {}));
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    await openEdit();
    await pick("new1.pdf");
    act(() => button("저장").click());
    await flush();
    expect(button("파일 고르기").disabled).toBe(true);
  });

  it("첨부는 저장됐는데 내용 저장이 실패하면 '첨부 파일은 저장했어요 · ' 로 알린다, 폼 유지", async () => {
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    m.set.mockResolvedValue([meta("s1"), meta("new1")]);
    updatePersonal.mockResolvedValue(null);
    await openEdit();
    await pick("new1.pdf");
    const title = host.querySelector<HTMLInputElement>("form input[type=text]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "고친 제목");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("저장").click());
    await flush();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("첨부 파일은 저장했어요 · "), tone: "bad" }));
    expect(host.querySelector("form")).not.toBeNull();
  });

  it("저장 — 첨부를 먼저 node_files_set, 그다음 personal_update", async () => {
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    const order: string[] = [];
    m.set.mockImplementation(async () => {
      order.push("files");
      return [meta("s1"), meta("new1")];
    });
    updatePersonal.mockImplementation(async () => {
      order.push("node");
      return {};
    });
    await openEdit();
    await pick("new1.pdf");
    const title = host.querySelector<HTMLInputElement>("form input[type=text]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "고친 제목");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("저장").click());
    await flush();
    expect(m.set).toHaveBeenCalledWith("32", ["s1", "new1"]);
    expect(order).toEqual(["files", "node"]);
    expect(m.discard).not.toHaveBeenCalled();
    expect(host.querySelector("form")).toBeNull();
  });

  it("첨부 저장 실패 — 토스트 + 폼 유지, 내용은 저장하지 않는다", async () => {
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    m.set.mockRejectedValue(new Error("boom"));
    await openEdit();
    await pick("new1.pdf");
    act(() => button("저장").click());
    await flush();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "bad" }));
    expect(updatePersonal).not.toHaveBeenCalled();
    expect(host.querySelector("form")).not.toBeNull();
  });
});
