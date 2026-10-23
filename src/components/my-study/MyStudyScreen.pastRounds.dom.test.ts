// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const notices = vi.hoisted(() => ({ fetchNoticeInbox: vi.fn(), fetchNotices: vi.fn(), markNoticesRead: vi.fn() }));
vi.mock("@/lib/api/notices", async (orig) => ({ ...(await orig<object>()), ...notices }));
const comments = vi.hoisted(() => ({ fetchComments: vi.fn() }));
vi.mock("@/lib/api/comments", async (orig) => ({ ...(await orig<object>()), ...comments }));

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

beforeEach(() => {
  comments.fetchComments.mockResolvedValue({ items: [], people: {}, hasOlder: false, hasNewer: false, total: 0, canWrite: true, writeBlock: null, locked: null, target: null, limits: {} });
  notices.fetchNoticeInbox.mockResolvedValue({ unread: false, popups: [] });
  notices.fetchNotices.mockResolvedValue({ items: [], canWrite: false, limits: { total: 100, pinned: 3, popup: 5 }, counts: { total: 0, pinned: 0, popup: 0 } });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});


// 끝난 회차(종료일 < 오늘)는 기본 접힘 — REF_DAY 10-12: 1주차(10-01~10-07) 끝남, 2주차(10-08~10-14) 진행, 3주차 이후 예정
const has = (host: HTMLElement, t: string) => [...host.querySelectorAll("[data-node]")].some((r) => r.textContent?.includes(t));
const toggleOf = (host: HTMLElement, round: string) => host.querySelector<HTMLButtonElement>(`button[aria-label^="${round} "][aria-expanded]`)!;

describe("진행목표 — 끝난 회차 기본 접힘", () => {
  it("끝난 회차는 접혀 있고, 진행·예정 회차는 펼쳐져 있다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const { host } = mount({});
    expect(toggleOf(host, title("1")).getAttribute("aria-expanded")).toBe("false");
    expect(has(host, title("11"))).toBe(false);
    expect(toggleOf(host, title("2")).getAttribute("aria-expanded")).toBe("true");
    expect(has(host, title("21"))).toBe(true);
    expect(has(host, title("41"))).toBe(true);
  });
  it("끝난 회차를 펼치면 화면에 있는 동안 펼친 채로 — 다시 누르면 접힌다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const { host } = mount({});
    act(() => toggleOf(host, title("1")).click());
    expect(has(host, title("11"))).toBe(true);
    act(() => buttonByText(host, "보드").click());
    act(() => buttonByText(host, "진행목표").click());
    expect(has(host, title("11"))).toBe(true);
    act(() => toggleOf(host, title("1")).click());
    expect(has(host, title("11"))).toBe(false);
  });
  it("모두 펼치기는 끝난 회차도 펼친다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const { host } = mount({});
    act(() => buttonByText(host, "모두 펼치기").click());
    expect(has(host, title("11"))).toBe(true);
  });
  it("끝난 회차 안 과제를 바로 열면(딥링크) 그 회차를 펼쳐 둔다 — 목록으로 돌아오면 그 과제가 보인다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum&item=11");
    const { host } = mount({ initialItem: "11" });
    expect(detailTitle(host)).toBe(title("11"));
    act(() => buttonByText(host.querySelector("main .sticky")!, "진행목표").click());
    expect(detailTitle(host)).toBeNull();
    expect(has(host, title("11"))).toBe(true);
    expect(toggleOf(host, title("1")).getAttribute("aria-expanded")).toBe("true");
  });
});

const ganttHas = (host: HTMLElement, id: string) => !!host.querySelector(`[data-gantt-row="${id}"]`);
describe("간트 — 끝난 회차 기본 접힘(진행목표와 같은 규칙)", () => {
  it("끝난 회차는 접혀 있고 진행 회차는 펼쳐져 있다 · 펼치면 그대로 유지", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=gantt");
    const { host } = mount({ initialTab: "gantt", key: "aws::gantt" } as Partial<Props>);
    expect(ganttHas(host, "11")).toBe(false);
    expect(ganttHas(host, "21")).toBe(true);
    act(() => toggleOf(host, title("1")).click());
    expect(ganttHas(host, "11")).toBe(true);
    act(() => buttonByText(host, "보드").click());
    act(() => buttonByText(host, "간트").click());
    expect(ganttHas(host, "11")).toBe(true);
  });
  it("끝난 회차 안 과제를 연 뒤 간트로 오면 그 회차가 펼쳐져 있다", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum&item=11");
    const { host } = mount({ initialItem: "11" });
    expect(detailTitle(host)).toBe(title("11"));
    act(() => buttonByText(host, "간트").click());
    expect(ganttHas(host, "11")).toBe(true);
  });
});

