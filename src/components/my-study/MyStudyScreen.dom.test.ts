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
vi.mock("@/lib/api/nodeFiles", async (orig) => ({ ...(await orig<object>()), fetchNodeFiles: () => Promise.resolve([]), fetchNodeFilesOrEmpty: () => Promise.resolve([]) }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: () => null }));

const { MeProvider } = await import("@/lib/me");
const { announceItem } = await import("@/lib/hashTarget");
const { MyStudyScreen } = await import("./MyStudyScreen");
const { markTaskOrigin } = await import("@/lib/taskOrigin");

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

  // F 리뷰 n1 → 출발지 복귀: 보드 탭에서 연 상세는 화면 안 [← 보드]로 닫으면 보드 — 돌아온 목록 기록의 ?tab= 도 화면을 따른다
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
  it("보드에서 연 상세를 화면 안에서 닫으면 보드로, 주소 ?tab= 이 화면(보드)과 같다", async () => {
    const { host } = openFromBoard();
    const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    act(() => buttonByText(host.querySelector("#detail-title")!.closest("section")!, "보드").click());
    await act(async () => void (await popped));
    expect(detailTitle(host)).toBeNull();
    expect(selectedTab(host)).toContain("보드");
    expect(window.location.pathname + window.location.search).toBe("/my-study/aws?tab=board");
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

// 개요 이번 회차 과제 카드 → 진행목표 탭 그 과제의 보기 상세(보드 카드와 같은 goLeaf) — 주소는 ?tab=curriculum&item=, 다시 불러오지 않는다
describe("MyStudyScreen — 개요 과제 카드", () => {
  const withRound = {
    ...detail,
    currentRound: { id: "2", label: "2주차", title: "EC2·S3", startDate: "2026-10-08", endDate: "2026-10-14", leafCount: 1, assigned: 2, submitted: 1, pct: 50, tasks: [
      { id: "21", title: title("21"), type: "designated", startDate: "2026-10-08", endDate: "2026-10-14", people: [{ ...P("u3", "지은", "peach"), status: "done" }, { ...P("u1", "철수", "blue"), status: "open" }] },
    ] },
  } as RoomDetail;
  it("카드를 누르면 진행목표 탭 + 그 과제 상세, 주소 ?item=21", () => {
    window.history.replaceState(null, "", "/my-study/aws");
    const { host } = mount({ detail: withRound, initialTab: "overview" });
    const card = [...host.querySelectorAll("li")].find((li) => li.textContent?.includes(title("21")))!;
    act(() => void card.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("진행목표");
    expect(detailTitle(host)).toContain(title("21"));
    expect(new URLSearchParams(window.location.search).get("item")).toBe("21");
  });
});

// 상세 [← …] 는 상세를 연 곳으로 — 보드·개요 카드는 그 탭, 진행목표 목록·새로고침·알림 링크는 진행목표 목록, 내 과제·내 일정 링크는 그 화면(history.back).
// 브라우저 뒤로 가기와 같은 곳으로 가고, 화면 안 닫기 뒤 앞으로 가기가 기록을 겹쳐 쌓지 않는다
describe("MyStudyScreen — 상세 [← 연 곳]", () => {
  const backBtn = (host: HTMLElement) => host.querySelector("#detail-title")!.closest("section")!.querySelector("button")!;
  const selected = (host: HTMLElement) => host.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";
  const here = () => window.location.pathname + window.location.search;
  const pop = () => new Promise((r) => window.addEventListener("popstate", r, { once: true }));
  const withRound = {
    ...detail,
    currentRound: { id: "2", label: "2주차", title: "EC2·S3", startDate: "2026-10-08", endDate: "2026-10-14", leafCount: 1, assigned: 2, submitted: 1, pct: 50, tasks: [
      { id: "21", title: title("21"), type: "designated", startDate: "2026-10-08", endDate: "2026-10-14", people: [{ ...P("u3", "지은", "peach"), status: "done" }, { ...P("u1", "철수", "blue"), status: "open" }] },
    ] },
  } as RoomDetail;
  const openFromOverview = () => {
    window.history.replaceState(null, "", "/my-study/aws");
    const m = mount({ detail: withRound, initialTab: "overview" });
    const card = [...m.host.querySelectorAll("li")].find((li) => li.textContent?.includes(title("21")))!;
    act(() => void card.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(detailTitle(m.host)).toContain(title("21"));
    return m;
  };
  const openFromBoardCard = () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=board");
    const m = mount({ initialTab: "board" });
    const card = m.host.querySelector<HTMLButtonElement>('section[aria-label="예정"] button, section[aria-label="진행중"] button, section[aria-label="제출 완료"] button')!;
    const name = card.textContent!;
    act(() => card.click());
    expect(name).toContain(detailTitle(m.host)!.trim());
    return m;
  };

  it("개요 카드 → [← 개요] — 누르면 개요 탭, 쌓았던 상세 기록은 back 으로 걷는다", async () => {
    const { host } = openFromOverview();
    expect(backBtn(host).textContent).toBe("개요");
    const back = vi.spyOn(window.history, "back");
    const popped = pop();
    act(() => backBtn(host).click());
    expect(back).toHaveBeenCalledTimes(1);
    await act(async () => void (await popped));
    expect(detailTitle(host)).toBeNull();
    expect(selected(host)).toContain("개요");
    expect(here()).toBe("/my-study/aws");
    back.mockRestore();
  });
  it("개요 카드 → 브라우저 뒤로 가기도 개요 탭 (화면 안 단추와 같다)", async () => {
    const { host } = openFromOverview();
    const popped = pop();
    window.history.back();
    await act(async () => void (await popped));
    expect(detailTitle(host)).toBeNull();
    expect(selected(host)).toContain("개요");
    expect(here()).toBe("/my-study/aws");
  });
  it("보드 카드 → [← 보드] — 닫은 뒤 앞으로 가기는 같은 상세(같은 단추 글)로, 기록을 겹쳐 쌓지 않는다", async () => {
    const { host } = openFromBoardCard();
    const opened = detailTitle(host);
    expect(backBtn(host).textContent).toBe("보드");
    let popped = pop();
    act(() => backBtn(host).click());
    await act(async () => void (await popped));
    expect(selected(host)).toContain("보드");
    expect(here()).toBe("/my-study/aws?tab=board");
    const len = window.history.length;
    popped = pop();
    window.history.forward();
    await act(async () => void (await popped));
    expect(detailTitle(host)).toBe(opened);
    expect(backBtn(host).textContent).toBe("보드");
    expect(window.history.length).toBe(len);
    // 다시 화면 안 단추 → 보드 목록 기록으로 back (새 기록 없이)
    popped = pop();
    act(() => backBtn(host).click());
    await act(async () => void (await popped));
    expect(selected(host)).toContain("보드");
    expect(here()).toBe("/my-study/aws?tab=board");
    expect(window.history.length).toBe(len);
  });
  it("진행목표 목록 행 → [← 진행목표] — 진행목표 목록", async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const { host } = mount({});
    act(() => host.querySelector<HTMLButtonElement>("[data-row-main]")!.click());
    expect(detailTitle(host)).not.toBeNull();
    expect(backBtn(host).textContent).toBe("진행목표");
    const popped = pop();
    act(() => backBtn(host).click());
    await act(async () => void (await popped));
    expect(detailTitle(host)).toBeNull();
    expect(selected(host)).toContain("진행목표");
    expect(here()).toBe("/my-study/aws?tab=curriculum");
  });
  it("새로고침(?item=)으로 바로 연 상세 → [← 진행목표] — 앱 밖으로 back 하지 않고 지금 기록을 목록으로 바꾼다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum&item=31");
    const { host } = mount({ initialItem: "31" });
    expect(backBtn(host).textContent).toBe("진행목표");
    const back = vi.spyOn(window.history, "back");
    act(() => backBtn(host).click());
    expect(back).not.toHaveBeenCalled();
    expect(detailTitle(host)).toBeNull();
    expect(selected(host)).toContain("진행목표");
    expect(here()).toBe("/my-study/aws?tab=curriculum");
    back.mockRestore();
  });
  it("알림 링크(?task=)로 연 상세 → [← 진행목표]", () => {
    window.history.replaceState(null, "", "/my-study/aws?task=311");
    const { host } = mount({ initialLeaf: "311" });
    expect(backBtn(host).textContent).toBe("진행목표");
  });
  it("내 과제의 과제 링크로 연 상세 → [← 내 과제] — 누르면 브라우저 뒤로 가기(내 과제 기록)와 같게 back", () => {
    const a = document.body.appendChild(document.createElement("a"));
    a.setAttribute("href", "/my-study/aws?task=311");
    markTaskOrigin("tasks", { target: a, button: 0 });
    window.history.replaceState(null, "", "/my-study/aws?task=311");
    const { host } = mount({ initialLeaf: "311" });
    expect(backBtn(host).textContent).toBe("내 과제");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    act(() => backBtn(host).click());
    expect(back).toHaveBeenCalledTimes(1);
    // 화면은 그대로 — 내 과제 화면으로 가는 이동은 라우터 몫
    expect(detailTitle(host)).toContain(title("311"));
    back.mockRestore();
  });
  it("내 일정 링크 → [← 내 일정]. 다른 과제 링크의 기억은 쓰지 않는다", () => {
    const a = document.body.appendChild(document.createElement("a"));
    a.setAttribute("href", "/my-study/aws?task=21");
    markTaskOrigin("schedule", { target: a, button: 0 });
    window.history.replaceState(null, "", "/my-study/aws?task=311");
    const { host } = mount({ initialLeaf: "311" });
    expect(backBtn(host).textContent).toBe("진행목표");
    act(() => root!.unmount());
    markTaskOrigin("schedule", { target: a, button: 0 });
    window.history.replaceState(null, "", "/my-study/aws?task=21");
    const m = mount({ initialLeaf: "21" });
    expect(backBtn(m.host).textContent).toBe("내 일정");
  });
  it("내 과제에서 연 상세 → 탭을 옮겼다 돌아오면 연 곳은 그 탭 (뒤로 가기와 같다)", () => {
    const a = document.body.appendChild(document.createElement("a"));
    a.setAttribute("href", "/my-study/aws?task=311");
    markTaskOrigin("tasks", { target: a, button: 0 });
    window.history.replaceState(null, "", "/my-study/aws?task=311");
    const { host } = mount({ initialLeaf: "311" });
    const tab = (t: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.includes(t))!;
    act(() => tab("간트").click());
    act(() => tab("진행목표").click());
    expect(detailTitle(host)).toContain(title("311"));
    expect(backBtn(host).textContent).toBe("간트");
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

// 개인 목표 편집(보기 모드) — 미저장 수정이 있으면 탭 전환·브라우저 뒤로 가기도 묻는다 (Task 7 M-1)
describe("MyStudyScreen — 개인 목표 편집 폼 미저장", () => {
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  const openDirtyForm = async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const cur = { ...AWS, personal: { canAdd: true, perRound: 20 } };
    const m = mount({ curriculum: cur });
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=32");
    m.render({ curriculum: cur, initialItem: "32" });
    act(() => buttonByText(m.host.querySelector("#detail-title")!.closest("section")!, "편집").click());
    await flush();
    const input = m.host.querySelector<HTMLInputElement>("form input[type=text]")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "고친 제목");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    return m;
  };
  const tab = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.includes(name))!;

  it("방 탭을 누르면 탭은 그대로 두고 '저장하지 않은 수정이 있어요' — 버리기 하면 이동", async () => {
    const { host } = await openDirtyForm();
    act(() => tab(host, "보드").click());
    expect(host.textContent).toContain("저장하지 않은 수정이 있어요");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("진행목표");
    act(() => buttonByText(host.querySelector('[role="alertdialog"]')!, "버리기").click());
    await flush();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("보드");
  });

  it("방 탭 — '계속 고치기' 면 폼이 그대로", async () => {
    const { host } = await openDirtyForm();
    act(() => tab(host, "보드").click());
    act(() => buttonByText(host.querySelector('[role="alertdialog"]')!, "계속 고치기").click());
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("브라우저 뒤로 가기 → 주소를 되돌려 놓고 묻는다, 버리기 하면 목록", async () => {
    const { host } = await openDirtyForm();
    const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    window.history.back();
    await act(async () => void (await popped));
    expect(host.textContent).toContain("저장하지 않은 수정이 있어요");
    expect(window.location.search).toContain("item=32");
    expect(host.querySelector("form")).not.toBeNull();
    act(() => buttonByText(host.querySelector('[role="alertdialog"]')!, "버리기").click());
    await flush();
    expect(detailTitle(host)).toBeNull();
  });

  it("확인이 떠 있는 채로 폼이 깨끗해지면(제목을 되돌림) 보류했던 이동도 지운다 — 나중에 낡은 확인이 되살아나지 않는다", async () => {
    const { host } = await openDirtyForm();
    act(() => tab(host, "보드").click());
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    const input = host.querySelector<HTMLInputElement>("form input[type=text]")!;
    const orig = AWS.nodes.find((n) => n.id === "32")!.title;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, orig);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    // 다시 고쳐도 옛 목적지(보드)로 묻지 않는다
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "또 고침");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("진행목표");
  });
});

// 재리뷰 R-3: 다른 화면 주소로 돌아간 popstate(클라이언트 이동으로 들어온 경우)는 이 화면이 막거나 ?item= 을 쌓지 않는다
describe("MyStudyScreen — popstate 가 다른 화면 주소면 손대지 않는다", () => {
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  const typeInto = (input: HTMLInputElement, v: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const popTo = (href: string) =>
    act(() => {
      window.history.replaceState(null, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  const spyHistory = () => ({ push: vi.spyOn(window.history, "pushState"), replace: vi.spyOn(window.history, "replaceState") });
  afterEach(() => vi.restoreAllMocks());

  const openDirtyPersonal = async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const cur = { ...AWS, personal: { canAdd: true, perRound: 20 } };
    const m = mount({ curriculum: cur });
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=32");
    m.render({ curriculum: cur, initialItem: "32" });
    act(() => buttonByText(m.host.querySelector("#detail-title")!.closest("section")!, "편집").click());
    await flush();
    typeInto(m.host.querySelector<HTMLInputElement>("form input[type=text]")!, "고친 제목");
    await flush();
    return m;
  };
  const openDirtyTeamEdit = async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum&mode=edit&item=31");
    const m = mount({ curriculum: { ...AWS, myPermissions: { canEditCurriculum: true } }, initialMode: "edit", initialItem: "31" });
    await flush();
    typeInto(m.host.querySelector<HTMLInputElement>('section[aria-labelledby="edit-view-title"] input[type=text]')!, "고친 회차");
    await flush();
    return m;
  };

  it("개인 목표 폼 미저장 — 다른 주소로 popstate 면 history 를 건드리지 않고 묻지 않는다", async () => {
    const { host } = await openDirtyPersonal();
    const h = spyHistory();
    popTo("/notifications");
    await flush();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replace.mock.calls.filter((c) => c[2] !== "/notifications")).toEqual([]);
    expect(window.location.pathname + window.location.search).toBe("/notifications");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("팀 편집 화면 미저장 — 다른 주소로 popstate 면 history 를 건드리지 않고 묻지 않는다", async () => {
    const { host } = await openDirtyTeamEdit();
    expect(window.location.search).toContain("item=31");
    const h = spyHistory();
    popTo("/rooms/aws");
    await flush();
    expect(h.push).not.toHaveBeenCalled();
    expect(h.replace.mock.calls.filter((c) => c[2] !== "/rooms/aws")).toEqual([]);
    expect(window.location.pathname + window.location.search).toBe("/rooms/aws");
    expect(host.textContent).not.toContain("저장하지 않은 수정이 있어요");
  });

  it("팀 편집 화면 미저장 — 같은 화면 주소로 popstate 면 여전히 편집 기록을 되돌려 놓고 묻는다", async () => {
    const { host } = await openDirtyTeamEdit();
    const h = spyHistory();
    popTo("/my-study/aws?tab=curriculum");
    await flush();
    expect(h.push).toHaveBeenCalled();
    expect(window.location.search).toContain("item=31");
    expect(host.textContent).toContain("저장하지 않은 수정이 있어요");
  });

  // 재리뷰 nit: [목록, 31, 32] 에서 32 를 고치다 뒤로 → 확인 → 버리기 = 31 기록으로 돌아간다 (31 기록을 하나 더 만들지 않는다)
  it("개인 목표 폼 미저장 — 뒤로 가기 확인에서 버리기 하면 아래 기록으로 돌아가 그다음 뒤로 가기가 목록", async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const cur = { ...AWS, personal: { canAdd: true, perRound: 20 } };
    const m = mount({ curriculum: cur });
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=31");
    m.render({ curriculum: cur, initialItem: "31" });
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=32");
    m.render({ curriculum: cur, initialItem: "32" });
    expect(detailTitle(m.host)).toBe(title("32"));
    act(() => buttonByText(m.host.querySelector("#detail-title")!.closest("section")!, "편집").click());
    await flush();
    typeInto(m.host.querySelector<HTMLInputElement>("form input[type=text]")!, "고친 제목");
    await flush();
    const back = async () => {
      const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
      window.history.back();
      await act(async () => void (await popped));
      await flush();
    };
    await back();
    expect(m.host.textContent).toContain("저장하지 않은 수정이 있어요");
    // 고친 뒤에는 back 의 popstate 가 온다 — 없으면(고치기 전) 잠깐 기다리고 넘어가 아래 단언이 실패한다
    const popped = new Promise((r) => {
      window.addEventListener("popstate", r, { once: true });
      setTimeout(r, 200);
    });
    act(() => buttonByText(m.host.querySelector('[role="alertdialog"]')!, "버리기").click());
    await act(async () => void (await popped));
    await flush();
    expect(detailTitle(m.host)).toBe(title("31"));
    expect(window.location.search).toContain("item=31");
    await back();
    expect(window.location.search).not.toContain("item=");
    expect(detailTitle(m.host)).toBeNull();
  });
});
