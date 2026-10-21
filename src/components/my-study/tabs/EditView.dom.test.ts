// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ExamView, FileMeta } from "@/lib/api/types";
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
const ex = vi.hoisted(() => ({ fetch: vi.fn(), put: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/api/exam", async (orig) => ({ ...(await orig<typeof import("@/lib/api/exam")>()), fetchExam: ex.fetch, putExam: ex.put, publishExam: ex.publish }));
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
  const api = { save, discard: vi.fn(), toast: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined) } as unknown as CurriculumApi;
  return createElement(
    TodayProvider,
    { today: REF_DAY } as Parameters<typeof TodayProvider>[0],
    createElement(EditView, { n, parent: null, nodes: tree.nodes, roots: tree.roots, period: { start: "2026-10-01", end: "2026-11-30" }, members: tree.members, S, update, api, go, request, toast, slug: "aws" }),
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

  // 주소창 이동·새로고침·탭 닫기는 앱 안 확인을 거치지 않는다 — 브라우저 확인(beforeunload)이 첨부 미저장도 덮어야 한다
  const unloadBlocked = () => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it("beforeunload — 고친 것이 없으면 묻지 않는다", async () => {
    await mount(leaf);
    expect(unloadBlocked()).toBe(false);
  });

  it("beforeunload — 올리는 중인 첨부가 있으면 묻는다", async () => {
    m.upload.mockReturnValue(new Promise(() => {}));
    await mount(leaf);
    await pick("a.pdf");
    expect(unloadBlocked()).toBe(true);
  });

  it("beforeunload — 올렸지만 저장하지 않은 첨부가 있으면 묻는다", async () => {
    m.upload.mockResolvedValue(undefined);
    m.register.mockResolvedValue(meta("new1"));
    await mount(leaf);
    await pick("new1.pdf");
    expect(live.S.uploading).toBeNull();
    expect(unloadBlocked()).toBe(true);
  });

  it("beforeunload — 붙은 첨부를 빼고 저장하지 않았으면 묻는다", async () => {
    await mount(leaf);
    act(() => button("빼기").click());
    expect(live.S.ov.files["21"]).toEqual([]);
    expect(unloadBlocked()).toBe(true);
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

describe("EditView 시험 리프 — 「문제」 섹션 · 미저장 가드 (Review Focus 10)", () => {
  const examLeaf = { ...leaf, exam: { status: "draft" as const, questionCount: 1, totalPoints: 1, reveal: "after_submit" as const } };
  const examView = (answer: number) =>
    ({
      today: "2026-10-12",
      node: { id: "21", title: leaf.title, startDate: "2026-10-15", endDate: "2026-10-21", archived: false },
      exam: { status: "draft", questionCount: 1, totalPoints: 1, reveal: "after_submit", publishedAt: null, closed: false, locked: false, submittedCount: 0 },
      viewer: { canEdit: true, isAssignee: false, canTake: false, reason: "not_assignee" },
      questions: [{ id: "9", ord: 0, type: "single", prompt: "IAM?", choices: ["a", "b"], points: 1, answer, explanation: "" }],
      attempt: null,
    }) as unknown as ExamView;
  const pickSecond = () => act(() => host.querySelectorAll<HTMLInputElement>('input[name="exam-q-0-answer"]')[1].click());

  beforeEach(() => {
    ex.fetch.mockReset().mockResolvedValue(examView(0));
    ex.put.mockReset().mockResolvedValue(examView(1));
    ex.publish.mockReset();
  });

  it("시험 아님 — 「문제」 섹션 없음, exam_get 도 부르지 않는다", async () => {
    await mount(leaf);
    expect(host.querySelector("[data-exam-editor]")).toBeNull();
    expect(ex.fetch).not.toHaveBeenCalled();
    expect(host.querySelector("#edit-view-title")?.textContent).toContain("항목 편집 · 과제");
  });

  it("시험 리프 — 머리·경로는 「시험」(상세와 같게, E2E I-4)", async () => {
    await mount(examLeaf);
    expect(host.querySelector("#edit-view-title")?.textContent).toContain("항목 편집 · 시험");
    expect(host.textContent).not.toMatch(/› ?과제/);
  });

  it("시험 리프 — 담당자 아래 「문제」 섹션", async () => {
    await mount(examLeaf);
    const sec = host.querySelector("[data-exam-editor]")!;
    expect(sec).toBeTruthy();
    expect(ex.fetch).toHaveBeenCalledWith("aws", "21");
    const assignee = Array.from(host.querySelectorAll("span")).find((x) => x.textContent?.startsWith("담당자"))!;
    expect(assignee.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("문항을 고치면 S.examDirty — '진행목표'(뒤로)·경로(다른 항목)가 '저장하지 않은 수정이 있어요' 로 보류, 버리기 → 이동·해제", async () => {
    await mount(examLeaf);
    expect(live.S.examDirty).toBeNull();
    pickSecond();
    expect(live.S.examDirty).toBe("21");
    act(() => button("진행목표").click());
    expect(live.S.leave).toEqual({ sel: null });
    expect(went).toEqual([]);
    expect(host.textContent).toContain("저장하지 않은 수정이 있어요. 저장할까요?");
    act(() => button("계속 편집").click());
    // 경로의 조상 = 다른 항목으로 이동
    const anc = host.querySelector<HTMLButtonElement>('nav[aria-label="경로"] button')!;
    act(() => anc.click());
    expect(live.S.leave).toEqual({ sel: leaf.parentId });
    act(() => button("버리기").click());
    await flush();
    expect(went).toEqual([{ sel: leaf.parentId }]);
    expect(live.S.examDirty).toBeNull();
    expect(ex.put).not.toHaveBeenCalled();
  });

  it("'저장하고 이동' — 문항을 저장(exam_put)하고 이동, 바뀌지 않은 제목은 node_update 없이", async () => {
    await mount(examLeaf);
    pickSecond();
    act(() => button("진행목표").click());
    await act(async () => button("저장하고 이동").click());
    await flush();
    expect(ex.put).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(went).toEqual([{ sel: null }]);
    expect(live.S.examDirty).toBeNull();
  });

  it("위쪽 [저장] — 고친 문항을 버리지 않고 저장한 뒤 돌아간다", async () => {
    await mount(examLeaf, { editFrom: "list" });
    pickSecond();
    expect(button("임시저장").disabled).toBe(false);
    await act(async () => button("저장").click());
    await flush();
    expect(ex.put).toHaveBeenCalledTimes(1);
    expect(went).toEqual([{ sel: null }]);
    expect(toast).toHaveBeenCalledWith({ text: "문제를 저장했어요", tone: "ok" });
  });

  it("위쪽 [저장] — 문항 저장이 거절되면 머문다(제목 저장도 하지 않는다)", async () => {
    ex.put.mockRejectedValue(new Error("x"));
    await mount(examLeaf, { editFrom: "list" });
    pickSecond();
    await act(async () => button("저장").click());
    await flush();
    expect(ex.put).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(went).toEqual([]);
    expect(live.S.examDirty).toBe("21");
  });
});

describe("EditView 기간·유형·회차 줄", () => {
  const row = () => host.querySelector<HTMLElement>("[data-meta-row]")!;
  const heads = () => Array.from(row().children).map((c) => c.firstChild?.textContent?.trim());

  it("과제 — 시작일·마감일·과제 유형·회차 네 칸, 칸 안에는 라벨과 조절기만 (안내 글은 줄 밖)", async () => {
    await mount(leaf);
    expect(heads()).toEqual(["시작일", "마감일", "과제 유형", "회차"]);
    const select = row().querySelector("select")!;
    expect(select.parentElement!.children).toHaveLength(1);
    const help = host.querySelector(`#${select.getAttribute("aria-describedby")}`)!;
    expect(help.textContent).toContain("다른 회차로 옮기면");
    expect(row().contains(help)).toBe(false);
  });
});
