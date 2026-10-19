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
const { announceItem } = await import("@/lib/hashTarget");
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
const buttonByText = (el: Element, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
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

  // 재리뷰 m2: 알림으로 연 상세를 닫으면 알림 이동이 쌓은 기록을 back — 원래 목록 주소·탭으로 돌아온다
  it("알림으로 연 상세를 닫으면 history.back 으로 원래 목록 주소로 돌아온다", async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const { host, render } = mount({});
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=31");
    render({ initialItem: "31" });
    expect(detailTitle(host)).toContain(title("31"));
    const back = vi.spyOn(window.history, "back");
    const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    act(() => buttonByText(host.querySelector("#detail-title")!.closest("section")!, "진행목표").click());
    expect(back).toHaveBeenCalledTimes(1);
    await act(async () => void (await popped));
    expect(window.location.pathname + window.location.search).toBe("/my-study/aws?tab=curriculum");
    expect(detailTitle(host)).toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("진행목표");
    back.mockRestore();
  });

  // F 리뷰 n1: 보드 탭에서 연 상세를 화면 안 [← 진행목표]로 닫으면 화면은 진행목표 목록 — 돌아온 목록 기록의 ?tab= 도 화면을 따른다
  const selectedTab = (host: HTMLElement) => host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";
  const openFromBoard = () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=board");
    const m = mount({ initialTab: "board" });
    expect(selectedTab(m.host)).toContain("보드");
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=31");
    m.render({ initialTab: "board", initialItem: "31" });
    expect(detailTitle(m.host)).toContain(title("31"));
    return m;
  };
  it("보드에서 연 상세를 화면 안에서 닫으면 주소 ?tab= 이 화면(진행목표)과 같다", async () => {
    const { host } = openFromBoard();
    const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    act(() => buttonByText(host.querySelector("#detail-title")!.closest("section")!, "진행목표").click());
    await act(async () => void (await popped));
    expect(detailTitle(host)).toBeNull();
    expect(selectedTab(host)).toContain("진행목표");
    expect(window.location.pathname + window.location.search).toBe("/my-study/aws?tab=curriculum");
  });
  // F 리뷰 n2: 브라우저 뒤로 가기는 상세를 연 목록 기록의 탭(보드)으로 — backTab 회귀를 잡는다
  it("보드에서 연 상세에서 브라우저 뒤로 가기 → 보드 탭", async () => {
    const { host } = openFromBoard();
    const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    window.history.back();
    await act(async () => void (await popped));
    expect(detailTitle(host)).toBeNull();
    expect(selectedTab(host)).toContain("보드");
    expect(window.location.pathname + window.location.search).toBe("/my-study/aws?tab=board");
  });

  // F 리뷰 m1: 개요 목록 → (알림 등으로) 진행목표 목록 주소로 이동 → 브라우저 뒤로. 이 화면이 닫은 back 이 아니므로 돌아온 ?tab=overview 를 curriculum 으로 고치지 않는다
  it("다른 목록 주소에서 뒤로 가기로 돌아오면 ?tab= 을 이 화면 탭으로 고치지 않는다", async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=overview");
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum");
    const { host } = mount({ initialTab: "curriculum" });
    expect(selectedTab(host)).toContain("진행목표");
    const replace = vi.spyOn(window.history, "replaceState");
    const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    window.history.back();
    await act(async () => void (await popped));
    expect(window.location.pathname + window.location.search).toBe("/my-study/aws?tab=overview");
    expect(replace).not.toHaveBeenCalled();
    replace.mockRestore();
  });

  // 재리뷰 m1: 벨로 item=31 → 상세 안에서 상위(3회차)로 이동 → 같은 알림을 다시 누름. initialItem 은 그대로 31 이지만 벨이 알린 item 을 연다
  it("상세 안에서 다른 항목으로 옮긴 뒤 같은 알림을 다시 누르면 그 항목이 다시 열린다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const { host, render } = mount({});
    announceItem("/my-study/aws?tab=curriculum&item=31");
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=31");
    render({ initialItem: "31" });
    expect(detailTitle(host)).toContain(title("31"));
    // 경로의 상위 회차로 — 주소는 replace 로 item=3
    act(() => buttonByText(host.querySelector('nav[aria-label="경로"]')!, title("3")).click());
    expect(detailTitle(host)).toContain(title("3"));
    expect(new URLSearchParams(window.location.search).get("item")).toBe("3");
    // 같은 알림 — 벨이 알리고 router.push 가 주소를 바꾸며, 서버는 같은 initialItem 을 넘긴다
    announceItem("/my-study/aws?tab=curriculum&item=31");
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=31");
    render({ initialItem: "31" });
    expect(detailTitle(host)).toContain(title("31"));
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

// 백로그 F 리뷰(1319cc2) #6: 내 스터디에서 방 설정으로 가는 링크는 지금 탭을 ?from= 으로 싣는다 → 설정 "이전 페이지" 가 그 탭으로
const { routes, MY_STUDY_TABS } = await import("@/lib/routes");
const { TABS } = await import("./StudyHeaderInfo");
describe("MyStudyScreen — 방 설정 링크의 from", () => {
  const leaderDetail = { ...detail, me: { state: "leader" } } as RoomDetail;
  const want = routes.roomSettings("aws", "/my-study/aws?tab=board");

  it("탭 키는 routes 의 MY_STUDY_TABS 와 같다 (from 검증 화이트리스트)", () => {
    expect(TABS.map(([id]) => id)).toEqual([...MY_STUDY_TABS]);
  });
  it("헤더 '태그 편집' 링크 (방 정보 칸은 개요 탭에만 있어 from 은 개요 = 쿼리 없는 내 스터디)", () => {
    const { host } = mount({ detail: leaderDetail, initialTab: "overview" });
    const a = [...host.querySelectorAll("a")].find((x) => x.textContent?.trim() === "태그 편집");
    expect(a?.getAttribute("href")).toBe(routes.roomSettings("aws", "/my-study/aws"));
  });
  it("더보기 '방 설정' 메뉴 링크", () => {
    const { host } = mount({ detail: leaderDetail, initialTab: "board" });
    act(() => (host.querySelector('button[aria-haspopup="menu"][aria-label="더보기"]') as HTMLButtonElement).click());
    const a = [...host.querySelectorAll('a[role="menuitem"]')].find((x) => x.getAttribute("href")?.includes("/settings"));
    expect(a?.getAttribute("href")).toBe(want);
  });
});
