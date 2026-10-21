// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { FileMeta } from "@/lib/api/types";
import { TodayProvider } from "@/lib/today";
import { AWS, REF_DAY } from "../fixtures";
import { EMPTY_OVERRIDES, buildTree, type TreeNode } from "../model";
import { INITIAL_STATE, editUnsaved, type Leave, type ScreenState, type Update } from "../state";
import type { CurriculumApi } from "../useCurriculumApi";
import { EditView } from "./EditView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ fetch: vi.fn(), register: vi.fn(), discard: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/api/nodeFiles", () => ({ fetchNodeFiles: m.fetch, registerNodeFile: m.register, discardNodeUnattached: m.discard, setNodeFiles: vi.fn() }));
vi.mock("@/lib/api/submission", () => ({ roomIdOfNode: () => Promise.resolve("7") }));
vi.mock("@/lib/api/upload", () => ({ uploadAttachment: m.upload, uploadErrorText: () => "실패" }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const leaf = tree.nodes.find((n) => n.id === "21")!;
const meta = (id: string): FileMeta => ({ id, name: `${id}.pdf`, contentType: "application/pdf", size: 3, status: "ready" });

let root: Root | null = null;
let host: HTMLElement;
const live = {} as { S: ScreenState };
const went: Leave[] = [];
const save = vi.fn();
const toast = vi.fn();

function Harness({ n, init }: { n: TreeNode; init?: Partial<ScreenState> }) {
  const [S, setS] = useState<ScreenState>({ ...INITIAL_STATE, tab: "curriculum", curMode: "edit", editSel: n.id, ...init });
  useEffect(() => {
    live.S = S;
  });
  const update: Update = useCallback((p) => setS((prev) => ({ ...prev, ...(typeof p === "function" ? p(prev) : p) })), []); // MyStudyScreen 과 같이 안정된 참조
  const go = (to: Leave) => {
    went.push(to);
    update({ leave: null });
  };
  // CurriculumTab.request 와 같은 규칙
  const request = (to: Leave) => (editUnsaved(S, S.editSel) ? update({ leave: to, confirm: false }) : go(to));
  const api = { save, discard: vi.fn(), toast: vi.fn() } as unknown as CurriculumApi;
  return createElement(
    TodayProvider,
    { today: REF_DAY } as Parameters<typeof TodayProvider>[0],
    createElement(EditView, { n, parent: null, nodes: tree.nodes, roots: tree.roots, period: { start: "2026-10-01", end: "2026-11-30" }, members: tree.members, S, update, api, go, request, toast }),
  );
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const mount = async (n: TreeNode, init?: Partial<ScreenState>) => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(Harness, { n, init })));
  await flush();
};
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text)!;
const pick = async (name: string) => {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["abc"], name, { type: "application/pdf" })] });
  act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
  await flush();
};

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = () => {};
  m.fetch.mockReset().mockResolvedValue([meta("s1")]);
  m.register.mockReset();
  m.discard.mockReset().mockResolvedValue(true);
  m.upload.mockReset();
  save.mockReset().mockResolvedValue(true);
  toast.mockReset();
  went.length = 0;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("EditView 첨부 파일", () => {
  it("임시 행(서버에 만드는 중) — 고르기 비활성 + '저장한 뒤 파일을 붙일 수 있어요', 목록을 부르지 않는다", async () => {
    await mount({ ...leaf, id: "2.new0", temp: true });
    expect(host.textContent).toContain("저장한 뒤 파일을 붙일 수 있어요");
    expect(button("파일 고르기").disabled).toBe(true);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("저장된 항목 — 붙은 파일 줄 + 끌어다 놓기 안내", async () => {
    await mount(leaf);
    expect(m.fetch).toHaveBeenCalledWith("21");
    expect(host.textContent).toContain("s1.pdf");
    expect(host.textContent).toContain("끌어다 놓아도 돼요 · PNG");
    expect(button("파일 고르기").disabled).toBe(false);
  });

  it("올리는 중 — 저장 비활성 + 떠나려 하면 묻는다 (ov 수정이 없어도)", async () => {
    m.upload.mockReturnValue(new Promise(() => {}));
    await mount(leaf);
    await pick("a.pdf");
    expect(live.S.uploading).toBe("21");
    const saveBtn = button("파일을 올리는 중이에요");
    expect(saveBtn.disabled).toBe(true);
    act(() => button("진행목표").click());
    expect(live.S.leave).toEqual({ sel: null });
    expect(went).toEqual([]);
    expect(host.textContent).toContain("파일을 올리는 중이에요. 지금 나가면");
  });

  it("'버리기' — 저장 안 한 첨부를 버리고 ov.files 도 지운 뒤 이동", async () => {
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    await mount(leaf);
    await pick("new1.pdf");
    expect(live.S.ov.files["21"]).toEqual(["s1", "new1"]);
    act(() => button("진행목표").click());
    expect(live.S.leave).toEqual({ sel: null });
    act(() => button("버리기").click());
    await flush();
    expect(m.discard).toHaveBeenCalledWith("new1");
    expect(m.discard).not.toHaveBeenCalledWith("s1");
    expect("21" in live.S.ov.files).toBe(false);
    expect(went).toEqual([{ sel: null }]);
  });

  it("저장 — api.save 에 onFiles 를 넘긴다", async () => {
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    await mount(leaf);
    await pick("new1.pdf");
    await act(async () => button("저장").click());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].files["21"]).toEqual(["s1", "new1"]);
    expect(typeof save.mock.calls[0][2].onFiles).toBe("function");
  });

  it("목록을 못 불러오면 빈 목록으로 보지 않는다 — 첨부 비활성 + 토스트, 저장은 첨부를 빼고 (I-1)", async () => {
    m.fetch.mockRejectedValue(new Error("net"));
    await mount(leaf);
    expect(button("파일 고르기").disabled).toBe(true);
    expect(toast).toHaveBeenCalledWith({ text: "첨부 파일 목록을 불러오지 못했어요 · 새로 고침해 주세요", tone: "bad" });
    expect(host.textContent).toContain("첨부 파일 목록을 불러오지 못했어요");
    const title = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "새 제목");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("임시저장").click());
    expect(save.mock.calls[0][2].skipFiles).toBe(true);
  });

  it("올리는 중 떠나기 확인 — '올리던 파일은 버려져요', 버리기·계속 편집만 (I-2)", async () => {
    m.upload.mockReturnValue(new Promise(() => {}));
    await mount(leaf);
    await pick("a.pdf");
    act(() => button("진행목표").click());
    expect(host.textContent).toContain("파일을 올리는 중이에요. 지금 나가면 올리던 파일은 버려져요");
    expect(host.textContent).not.toContain("저장할까요?");
    const labels = Array.from(host.querySelectorAll('[role="alertdialog"] button')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(["계속 편집", "버리기"]);
    expect(host.textContent).not.toContain("저장하지 않은 수정은 버려져요");
  });

  it("올리는 중 + 고친 내용도 있으면 — '올리던 파일과 저장하지 않은 수정은 버려져요'", async () => {
    m.upload.mockReturnValue(new Promise(() => {}));
    await mount(leaf);
    const title = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "새 제목");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pick("a.pdf");
    act(() => button("진행목표").click());
    expect(host.textContent).toContain("파일을 올리는 중이에요. 지금 나가면 올리던 파일과 저장하지 않은 수정은 버려져요");
  });
});

describe("EditView [임시저장]·[저장]", () => {
  const typeTitle = (v: string) => {
    const title = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, v);
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const order = () => Array.from(host.querySelectorAll("button")).map((b) => b.textContent?.trim());

  it("[임시저장] 은 [저장] 왼쪽", async () => {
    await mount(leaf);
    const o = order();
    expect(o.indexOf("임시저장")).toBeGreaterThanOrEqual(0);
    expect(o.indexOf("임시저장")).toBe(o.indexOf("저장") - 1);
  });

  it("[임시저장] — 저장하고 편집 화면에 머문다", async () => {
    await mount(leaf, { editFrom: "list" });
    typeTitle("새 제목");
    await act(async () => button("임시저장").click());
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].titles["21"]).toBe("새 제목");
    expect(went).toEqual([]);
  });

  it("[저장] — 저장한 뒤 들어온 곳(목록)으로 돌아간다 + 저장 토스트", async () => {
    await mount(leaf, { editFrom: "list" });
    typeTitle("새 제목");
    await act(async () => button("저장").click());
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(went).toEqual([{ sel: null }]);
    expect(toast).toHaveBeenCalledWith({ text: "저장했어요", tone: "ok" });
  });

  it("[저장] — 상세에서 들어왔으면 편집을 연 항목의 보기 상세로", async () => {
    await mount(leaf, { editFrom: { view: "2" } });
    typeTitle("새 제목");
    await act(async () => button("저장").click());
    await flush();
    expect(went).toEqual([{ view: "2" }]);
  });

  it("[저장] — 들어온 곳을 모르면(새로고침) 같은 항목의 보기 상세로", async () => {
    await mount(leaf);
    typeTitle("새 제목");
    await act(async () => button("저장").click());
    await flush();
    expect(went).toEqual([{ mode: "view" }]);
  });

  it("저장 중 — 두 번 눌러도 요청은 한 번, 두 저장 버튼·파일 고르기 비활성", async () => {
    let done!: (v: boolean) => void;
    save.mockReturnValue(new Promise<boolean>((r) => (done = r)));
    await mount(leaf, { editFrom: "list" });
    typeTitle("새 제목");
    act(() => {
      button("저장").click();
      button("저장").click();
    });
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(button("저장").disabled).toBe(true);
    expect(button("임시저장").disabled).toBe(true);
    expect(button("파일 고르기").disabled).toBe(true);
    await act(async () => done(true));
    await flush();
    expect(went).toEqual([{ sel: null }]);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("저장 중에 또 고쳤으면 — 저장이 끝나도 떠나지 않는다", async () => {
    let done!: (v: boolean) => void;
    save.mockReturnValue(new Promise<boolean>((r) => (done = r)));
    await mount(leaf, { editFrom: "list" });
    typeTitle("새 제목");
    act(() => button("저장").click());
    await flush();
    typeTitle("또 고친 제목");
    await act(async () => done(true));
    await flush();
    expect(went).toEqual([]);
    expect(live.S.leave).toBeNull();
    expect(button("저장").disabled).toBe(false);
  });

  it("[저장] 실패 — 머문다 (오류는 api 가 알린다)", async () => {
    save.mockResolvedValue(false);
    await mount(leaf, { editFrom: "list" });
    typeTitle("새 제목");
    await act(async () => button("저장").click());
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(went).toEqual([]);
    expect(live.S.leave).toBeNull();
  });

  it("올리는 중 — [임시저장]·[저장] 둘 다 비활성", async () => {
    m.upload.mockReturnValue(new Promise(() => {}));
    await mount(leaf);
    await pick("a.pdf");
    expect(button("임시저장").disabled).toBe(true);
    expect(button("파일을 올리는 중이에요").disabled).toBe(true);
  });

  it("바뀐 것 없음 — [임시저장] 비활성, [저장] 은 저장 없이 돌아간다", async () => {
    await mount(leaf, { editFrom: "list" });
    expect(button("임시저장").disabled).toBe(true);
    act(() => button("저장").click());
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(went).toEqual([{ sel: null }]);
  });

  it("[저장] 뒤 이동 — '저장하지 않은 수정' 확인을 거치지 않는다 (가드가 걸리지 않는다)", async () => {
    await mount(leaf, { editFrom: "list" });
    typeTitle("새 제목");
    // 실제 api.save 처럼 성공하면 수정(ov)을 지운다
    save.mockImplementation(async () => true);
    await act(async () => button("저장").click());
    await flush();
    expect(live.S.leave).toBeNull();
    expect(host.textContent).not.toContain("저장하지 않은 수정이 있어요");
    expect(went).toEqual([{ sel: null }]);
  });
});
