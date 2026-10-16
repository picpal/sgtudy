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
