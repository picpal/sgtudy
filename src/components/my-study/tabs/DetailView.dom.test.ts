// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import { DetailView } from "./DetailView";
import { EMPTY_OVERRIDES, buildTree, type LeafNode } from "../model";
import { AWS, CHULSU, REF_DAY } from "../fixtures";
import type { RoomStatus } from "../submission";
import type { CurriculumApi } from "../useCurriculumApi";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), useSearchParams: () => new URLSearchParams() }));

const LEADER = "u2";
const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const leaf = (id: string) => tree.nodes.find((n) => n.id === id) as LeafNode;

function render(n: LeafNode, meId: string, isLeader: boolean, roomStatus: RoomStatus = "active") {
  const view = createElement(DetailView, {
    n, nodes: tree.nodes, canEdit: isLeader, onOpen: () => {}, onBack: () => {}, onEdit: () => {}, slug: "aws", roomStatus, focus: null, onFocused: () => {}, onSubmitted: () => {}, toast: () => {},
    viewerPending: false, isLeader, quietNotAssigned: false, roots: tree.roots, period: { start: "2026-10-01", end: "2026-11-30" }, personal: { canAdd: true, perRound: 20 }, api: {} as CurriculumApi,
  });
  const me = { id: meId, nickname: "x", tone: "mint" } as unknown as Parameters<typeof MeProvider>[0]["me"];
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(TodayProvider, { today: REF_DAY } as Parameters<typeof TodayProvider>[0], createElement(MeProvider, { me } as Parameters<typeof MeProvider>[0], view)));
  return root;
}
const labels = (root: HTMLElement) => Array.from(root.querySelectorAll("section > div button")).map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());

describe("DetailView 개인 목표 머리 버튼 (스펙 §4.6)", () => {
  it("소유자·진행 중: 완료로 표시 · 편집 · ⋯", () => {
    const l = labels(render(leaf("32"), CHULSU, false));
    expect(l).toEqual(expect.arrayContaining(["완료로 표시", "편집", "더 보기"]));
  });
  it("소유자·모집 중: 완료 버튼은 비활성 + 이유를 aria-describedby 로", () => {
    const root = render(leaf("32"), CHULSU, false, "recruit");
    const btn = root.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    expect(btn.disabled).toBe(true);
    expect(root.querySelector(`#${btn.getAttribute("aria-describedby")}`)?.textContent).toBe("스터디가 진행 중일 때 완료할 수 있어요");
    // 이유는 버튼 밖 — 접근 가능한 이름에 섞여 두 번 읽히지 않게 (최종 리뷰 Minor 6)
    expect(btn.textContent?.trim()).toBe("완료로 표시");
  });
  it("그룹장·남의 것: ⋯ 만 (완료·편집 없음)", () => {
    const l = labels(render(leaf("32"), LEADER, true));
    expect(l).toContain("더 보기");
    expect(l).not.toContain("편집");
    expect(l).not.toContain("완료로 표시");
  });
  it("그룹장·이탈한 팀원의 보관 목표 (제출 없음): ⋯ 은 삭제만 — 보관 해제는 personalActions 에서 빠진다", () => {
    const l = labels(render({ ...leaf("32"), archived: true, ownerLeft: true }, LEADER, true));
    expect(l).toContain("더 보기");
  });
  it("보관 배지 — 이탈한 소유자면 '보관됨 · 이탈'", () => {
    expect(render({ ...leaf("33"), archived: true, ownerLeft: true }, LEADER, true).querySelector("[data-archived-badge]")?.textContent).toBe("보관됨 · 이탈");
  });
});

// 시나리오 QA #13: 팀원이 추가한 과제 — 누가 추가했는지 보인다 (0024 createdBy). 알림은 담당자에게만(서버)
describe("DetailView 작성자 표시", () => {
  it("createdBy 가 있으면 'OO 님이 추가', 없으면 표시 없음", () => {
    const t = buildTree({ ...AWS, nodes: AWS.nodes.map((n) => (n.id === "21" ? { ...n, createdBy: { userId: "u3", nickname: "지은", tone: "peach" as const } } : n)) }, EMPTY_OVERRIDES, REF_DAY);
    const withBy = t.nodes.find((n) => n.id === "21") as LeafNode;
    expect(render(withBy, LEADER, true).querySelector("[data-created-by]")?.textContent).toBe("지은 님이 추가");
    expect(render(leaf("22"), LEADER, true).querySelector("[data-created-by]")).toBeNull();
  });
});

describe("개인 목표 편집 폼 — 저장 안 한 수정이면 앱 안 링크 이동 전에 묻는다 (최종 리뷰 Minor 8)", () => {
  it("편집 중 제목을 고친 뒤 헤더 링크 → 이동을 막고 '저장하지 않은 수정이 있어요'", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { guardNavigate } = await import("@/lib/leaveGuard");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = () => {};
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    const view = createElement(DetailView, {
      n: leaf("32"), nodes: tree.nodes, canEdit: false, onOpen: () => {}, onBack: () => {}, onEdit: () => {}, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted: () => {}, toast: () => {},
      viewerPending: false, isLeader: false, quietNotAssigned: false, roots: tree.roots, period: { start: "2026-10-01", end: "2026-11-30" }, personal: { canAdd: true, perRound: 20 }, api: {} as CurriculumApi,
    });
    const me = { id: CHULSU, nickname: "x", tone: "mint" } as unknown as Parameters<typeof MeProvider>[0]["me"];
    act(() => root.render(createElement(TodayProvider, { today: REF_DAY } as Parameters<typeof TodayProvider>[0], createElement(MeProvider, { me } as Parameters<typeof MeProvider>[0], view))));
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === "편집")!.click());
    const title = host.querySelector<HTMLInputElement>("form input[type=text]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "고친 제목");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const e = { preventDefault: vi.fn() };
    act(() => guardNavigate("/tasks", e));
    expect(e.preventDefault).toHaveBeenCalled();
    expect(host.textContent).toContain("저장하지 않은 수정이 있어요");
    act(() => root.unmount());
    host.remove();
  });
});

// 회차 시험 Task 9: 시험 리프 머리 — 경로 끝 "시험" · 시험 배지 · 메타 줄 "· n문항 m점" · 본문은 응시 영역(제출 카드 대신)
describe("DetailView 시험 리프 머리", () => {
  const exam = (e: LeafNode["exam"]) => ({ ...leaf("311"), exam: e }) as LeafNode;
  it("발행된 시험: 시험 · 4문항 5점", () => {
    const root = render(exam({ status: "published", questionCount: 4, totalPoints: 5, reveal: "after_submit" }), CHULSU, false);
    expect(root.querySelector("nav[aria-label=경로]")?.textContent).toMatch(/시험$/);
    expect(root.querySelector("[data-exam-badge]")?.textContent).toBe("시험");
    expect(root.textContent).toContain("· 4문항 5점");
    expect(root.querySelector('[aria-label="시험 불러오는 중"]')).not.toBeNull();
    expect(root.querySelector('[aria-label="과제 제출 불러오는 중"]')).toBeNull();
  });
  it("편집자 아닌 사람의 초안 요약(상태만): 수 없음 · 초안 배지", () => {
    const root = render(exam({ status: "draft" }), CHULSU, false);
    expect(root.querySelector("[data-exam-badge]")?.textContent).toBe("시험초안");
    expect(root.textContent).not.toContain("문항");
  });
  it("일반 과제는 그대로 '과제'", () => {
    expect(render(leaf("311"), CHULSU, false).querySelector("nav[aria-label=경로]")?.textContent).toMatch(/과제$/);
  });
});
