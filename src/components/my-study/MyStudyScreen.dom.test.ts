// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MeStudies, RoomDetail } from "@/lib/api/types";
import { AWS, CHULSU } from "./fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView = () => {};

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));

const { MeProvider } = await import("@/lib/me");
const { MyStudyScreen } = await import("./MyStudyScreen");

const P = (userId: string, nickname: string, tone: RoomDetail["leader"]["tone"]) => ({ userId, nickname, tone });
const detail: RoomDetail = {
  today: AWS.today, id: "6", slug: "aws", title: "AWS SAA", intro: "", descriptionMd: "", rulesMd: "",
  status: "active", archived: false, isPublic: true, joinMode: "approval", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 4,
  leader: P("u2", "민수", "mint"), leaderDoesTasks: true, tags: [],
  members: [
    { ...P("u2", "민수", "mint"), role: "leader", status: "active", joinedAt: null }, { ...P("u3", "지은", "peach"), role: "member", status: "active", joinedAt: null },
    { ...P("u1", "철수", "blue"), role: "member", status: "active", joinedAt: null }, { ...P("u4", "하나", "lav"), role: "member", status: "active", joinedAt: null },
  ],
  me: { state: "active" }, currentRound: null, rounds: [],
  stats: { roundCount: 0, leafCount: 0, commonCount: 0, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [] },
  myProgress: null, invite: null, pendingCount: 0, myPermissions: { canEditCurriculum: false },
} as RoomDetail;
const studies: MeStudies = { today: AWS.today, groups: [] };
type Props = ComponentProps<typeof MyStudyScreen>;

let root: Root | null = null;
const mount = (p: Partial<Props>) => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const render = (q: Partial<Props>) =>
    act(() =>
      root!.render(
        createElement(MeProvider, { me: { id: CHULSU, nickname: "철수", tone: "blue", unreadCount: 0 } } as ComponentProps<typeof MeProvider>,
          createElement(MyStudyScreen, { key: "aws::curriculum", detail, curriculum: AWS, studies, initialTab: "curriculum", ...q })),
      ),
    );
  render(p);
  return { host, render };
};
const title = (id: string) => AWS.nodes.find((n) => n.id === id)!.title;
const detailTitle = (host: HTMLElement) => host.querySelector("#detail-title")?.textContent ?? null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

// 백로그 F 리뷰 I1: 같은 방 진행목표 탭(같은 key)에서 묶음 알림 ?tab=curriculum&item= 을 누르면 그 항목 상세가 열린다
describe("MyStudyScreen — 같은 화면에서 ?item= 알림", () => {
  it("목록 → 같은 화면에서 ?item= 로 바뀌면 보기 상세가 열린다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const { host, render } = mount({});
    expect(detailTitle(host)).toBeNull();
    // 벨의 router.push 가 주소를 바꾸고 서버 페이지가 새 initialItem 을 넘긴다 — key 는 그대로라 다시 마운트되지 않는다
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=2");
    render({ initialItem: "2" });
    expect(detailTitle(host)).toContain(title("2"));
    // 다른 항목 상세를 보던 중에도 — 새 알림 항목으로 바뀐다
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=3");
    render({ initialItem: "3" });
    expect(detailTitle(host)).toContain(title("3"));
    // 같은 값으로 다시 그려져도(router.refresh) 화면은 그대로
    render({ initialItem: "3" });
    expect(detailTitle(host)).toContain(title("3"));
  });
});

// 백로그 F 리뷰 I2: 보관된 방의 신청 취소 확인 — 다시 신청할 수 없다고 알린다 (보관 아닌 방은 그대로)
describe("MyStudyScreen — 신청 취소 확인 문구", () => {
  const confirmBody = (archived: boolean) => {
    const pendingDetail = { ...detail, archived, status: "recruit", me: { state: "pending" } } as RoomDetail;
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() =>
      root!.render(
        createElement(MeProvider, { me: { id: CHULSU, nickname: "철수", tone: "blue", unreadCount: 0 } } as ComponentProps<typeof MeProvider>,
          createElement(MyStudyScreen, { detail: pendingDetail, curriculum: AWS, studies })),
      ),
    );
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "신청 취소");
    act(() => btn!.click());
    return document.querySelector('[role="dialog"], [role="alertdialog"]')?.textContent ?? "";
  };
  it("보관된 방", () => {
    expect(confirmBody(true)).toContain("보관된 스터디라 취소하면 다시 신청할 수 없어요.");
  });
  it("보관 아닌 방", () => {
    const body = confirmBody(false);
    expect(body).toContain("취소해도 모집 중이면 다시 신청할 수 있어요.");
    expect(body).not.toContain("보관된 스터디라");
  });
});
