// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { guardNavigate } from "@/lib/leaveGuard";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import { AWS, CHULSU, REF_DAY } from "../fixtures";
import { EMPTY_OVERRIDES, buildTree, type LeafNode } from "../model";
import type { CurriculumApi } from "../useCurriculumApi";
import type { SubmitDraft } from "./MySubmissionCard";
import { DetailView } from "./DetailView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};
const m = vi.hoisted(() => ({ push: vi.fn(), report: null as null | ((d: SubmitDraft | null) => void) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: m.push }), useSearchParams: () => new URLSearchParams() }));
// 제출 카드 대신 — 상세가 넘긴 onDraftChange 만 잡는다
vi.mock("./LeafBody", () => ({
  LeafBody: (p: { onDraftChange?: (d: SubmitDraft | null) => void }) => {
    m.report = p.onDraftChange ?? null;
    return null;
  },
}));

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const leaf = tree.leaves.find((l) => !l.personal && !l.exam) as LeafNode;

let root: Root | null = null;
let host: HTMLElement;
const onBack = vi.fn();
const onUnsaved = vi.fn();
let draft: { uploading: boolean; keep: ReturnType<typeof vi.fn<() => boolean>>; discard: ReturnType<typeof vi.fn<() => void>> };
beforeEach(() => {
  onBack.mockClear();
  onUnsaved.mockClear();
  m.push.mockClear();
  draft = { uploading: false, keep: vi.fn(() => true), discard: vi.fn() };
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});
const view = (pendingLeave: { go: () => void; cancel: () => void } | null = null) =>
  createElement(
    TodayProvider,
    { today: REF_DAY } as Parameters<typeof TodayProvider>[0],
    createElement(
      MeProvider,
      { me: { id: CHULSU, nickname: "x", tone: "mint" } } as unknown as Parameters<typeof MeProvider>[0],
      createElement(DetailView, {
        n: leaf, nodes: tree.nodes, canEdit: false, onOpen: () => {}, onBack, onEdit: () => {}, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted: () => {}, toast: () => {},
        viewerPending: false, isLeader: false, quietNotAssigned: false, roots: tree.roots, period: { start: "2026-10-01", end: "2026-11-30" }, personal: { canAdd: true, perRound: 20 }, api: {} as CurriculumApi,
        onUnsavedChange: onUnsaved, pendingLeave,
      }),
    ),
  );
const mount = (dirty: boolean) => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(view()));
  if (dirty) act(() => m.report!(draft));
};
const btn = (t: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === t);
const confirmBox = () => host.querySelector("[role=alertdialog]");
const back = () => act(() => btn("진행목표")!.click());

describe("과제 제출 작성 중 나가기 확인", () => {
  it("바뀐 내용이 없으면 [← 진행목표]는 바로 나간다", () => {
    mount(false);
    back();
    expect(onBack).toHaveBeenCalled();
    expect(confirmBox()).toBeNull();
  });
  it("바뀐 내용이 있으면 묻는다 — 방 화면에도 이 항목을 막으라고 알린다(탭·뒤로 가기)", () => {
    mount(true);
    expect(onUnsaved).toHaveBeenLastCalledWith(leaf.id);
    back();
    expect(onBack).not.toHaveBeenCalled();
    expect(confirmBox()?.textContent).toContain("제출하지 않은 작성 내용이 있어요");
    expect(["계속 쓰기", "버리기", "이 기기에 임시저장"].every((t) => btn(t))).toBe(true);
  });
  it("[계속 쓰기] → 머문다", () => {
    mount(true);
    back();
    act(() => btn("계속 쓰기")!.click());
    expect(confirmBox()).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
    expect(draft.keep).not.toHaveBeenCalled();
    expect(draft.discard).not.toHaveBeenCalled();
  });
  it("[임시저장] → 임시본을 남기고 나간다", () => {
    mount(true);
    vi.spyOn(window.history, "back").mockImplementation(() => window.dispatchEvent(new PopStateEvent("popstate")));
    back();
    act(() => btn("이 기기에 임시저장")!.click());
    expect(draft.keep).toHaveBeenCalled();
    expect(draft.discard).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });
  it("[임시저장] 이 실패하면 머물고 오류를 알린다", () => {
    draft.keep = vi.fn(() => false);
    mount(true);
    back();
    act(() => btn("이 기기에 임시저장")!.click());
    expect(onBack).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("임시저장하지 못했어요");
    expect(confirmBox()).not.toBeNull();
  });
  it("[버리기] → 임시본을 지우고 나간다", () => {
    mount(true);
    vi.spyOn(window.history, "back").mockImplementation(() => window.dispatchEvent(new PopStateEvent("popstate")));
    back();
    act(() => btn("버리기")!.click());
    expect(draft.discard).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });
  it("탭 전환(방 화면이 보류한 pendingLeave) → 같은 확인, 고르면 보류한 곳으로", () => {
    mount(true);
    const go = vi.fn();
    const cancel = vi.fn();
    act(() => root!.render(view({ go, cancel })));
    expect(confirmBox()?.textContent).toContain("제출하지 않은 작성 내용이 있어요");
    act(() => btn("계속 쓰기")!.click());
    expect(cancel).toHaveBeenCalled();
    vi.spyOn(window.history, "back").mockImplementation(() => window.dispatchEvent(new PopStateEvent("popstate")));
    act(() => btn("버리기")!.click());
    expect(go).toHaveBeenCalled();
    expect(draft.discard).toHaveBeenCalled();
  });
  it("헤더·옆 목록 링크(leaveGuard) → 같은 확인, [임시저장] 뒤 그 주소로", () => {
    mount(true);
    const e = { preventDefault: vi.fn() };
    act(() => guardNavigate("/tasks", e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(confirmBox()).not.toBeNull();
    vi.spyOn(window.history, "back").mockImplementation(() => window.dispatchEvent(new PopStateEvent("popstate")));
    act(() => btn("이 기기에 임시저장")!.click());
    expect(m.push).toHaveBeenCalledWith("/tasks");
  });
  it("브라우저 뒤로 가기 → 기록을 다시 쌓고 묻는다 · [버리기] 면 쌓은 기록을 걷고 한 번 더 뒤로", () => {
    const pushes = vi.spyOn(window.history, "pushState");
    mount(true);
    expect(pushes).toHaveBeenCalledTimes(1); // 바뀐 내용이 생기면 같은 주소 기록 하나
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(pushes).toHaveBeenCalledTimes(2);
    expect(confirmBox()).not.toBeNull();
    const backs = vi.spyOn(window.history, "back").mockImplementation(() => window.dispatchEvent(new PopStateEvent("popstate")));
    act(() => btn("버리기")!.click());
    expect(draft.discard).toHaveBeenCalled();
    expect(backs).toHaveBeenCalledTimes(2);
  });
  it("바뀐 내용이 없어지면(제출·취소) 쌓았던 기록을 조용히 걷고 방 화면 막기도 푼다", () => {
    mount(true);
    const backs = vi.spyOn(window.history, "back").mockImplementation(() => window.dispatchEvent(new PopStateEvent("popstate")));
    act(() => m.report!(null));
    expect(backs).toHaveBeenCalledTimes(1);
    expect(onUnsaved).toHaveBeenLastCalledWith(null);
    back();
    expect(onBack).toHaveBeenCalled();
  });
});
