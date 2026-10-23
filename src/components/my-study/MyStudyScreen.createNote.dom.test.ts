// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MeStudies, RoomDetail } from "@/lib/api/types";
import { AWS, CHULSU } from "./fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView = () => {};

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/lib/api/nodeFiles", async (orig) => ({ ...(await orig<object>()), fetchNodeFiles: () => Promise.resolve([]), fetchNodeFilesOrEmpty: () => Promise.resolve([]) }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: () => null }));
const notices = vi.hoisted(() => ({ fetchNoticeInbox: vi.fn(), fetchNotices: vi.fn(), markNoticesRead: vi.fn() }));
vi.mock("@/lib/api/notices", async (orig) => ({ ...(await orig<object>()), ...notices }));
const leader = vi.hoisted(() => ({ openRecruit: vi.fn(), fetchApplications: vi.fn() }));
vi.mock("@/lib/api/leader", async (orig) => ({ ...(await orig<object>()), ...leader }));

const { MeProvider } = await import("@/lib/me");
const { MyStudyScreen } = await import("./MyStudyScreen");

const P = (userId: string, nickname: string, tone: RoomDetail["leader"]["tone"]) => ({ userId, nickname, tone });
// 방 만들기 직후 — 준비중 방, 그룹장(나)만 있다
const draft: RoomDetail = {
  today: AWS.today, id: "6", slug: "aws", title: "AWS SAA", intro: "", descriptionMd: "", rulesMd: "",
  status: "draft", archived: false, isPublic: true, joinMode: "direct", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 1,
  leader: P(CHULSU, "철수", "blue"), leaderDoesTasks: true, tags: [],
  members: [{ ...P(CHULSU, "철수", "blue"), role: "leader", status: "active", joinedAt: null }],
  me: { state: "leader" }, currentRound: null, rounds: [],
  stats: { roundCount: 0, leafCount: 0, commonCount: 0, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [] },
  myProgress: null, invite: null, pendingCount: 0, myPermissions: { canEditCurriculum: true },
} as RoomDetail;
const studies: MeStudies = { today: AWS.today, groups: [] };
type Props = ComponentProps<typeof MyStudyScreen>;

let root: Root | null = null;
const mount = (d: Partial<RoomDetail>, p: Partial<Props> = {}) => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(MeProvider, { me: { id: CHULSU, nickname: "철수", tone: "blue", unreadCount: 0 } } as ComponentProps<typeof MeProvider>,
        createElement(MyStudyScreen, { detail: { ...draft, ...d }, curriculum: AWS, studies, initialTab: "overview", ...p })),
    ),
  );
  return host;
};
const banner = (host: HTMLElement) => host.querySelector<HTMLElement>("[data-draft-banner]");
const pageText = () => document.body.textContent; // 토스트 포함

beforeEach(() => {
  notices.fetchNoticeInbox.mockResolvedValue({ unread: false, popups: [] });
  notices.fetchNotices.mockResolvedValue({ items: [], canWrite: false, limits: { total: 100, pinned: 3, popup: 5 }, counts: { total: 0, pinned: 0, popup: 0 } });
  leader.fetchApplications.mockResolvedValue({ items: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// 방 만들기 AI 2단계 D22·D35 — 회차 적용·모집 시작이 실패하면 생성 화면이 ?note= 로 넘긴다
describe("MyStudyScreen — 방 만들기 직후 안내(?note=)", () => {
  it("rounds-skipped · recruit-skipped → 각 토스트 · 준비중 막대는 그대로", () => {
    let host = mount({}, { initialNote: "rounds-skipped" });
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("회차 초안은 적용하지 못했어요 · 진행목표에서 직접 추가해 주세요");
    expect(banner(host)).not.toBeNull();
    act(() => root!.unmount());
    document.body.innerHTML = "";
    host = mount({}, { initialNote: "recruit-skipped" });
    expect(pageText()).toContain("모집은 시작하지 못했어요 · 위의 [모집 시작] 으로 할 수 있어요");
    expect(banner(host)).not.toBeNull();
  });
  it("note 없으면 토스트 없음 · 주소의 ?note= 는 지운다(새로고침 때 다시 안 뜸)", () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum&mode=edit&note=rounds-skipped");
    mount({}, { initialTab: "curriculum", initialMode: "edit" });
    expect(pageText()).not.toContain("회차 초안은 적용하지 못했어요");
    expect(window.location.pathname + window.location.search).toBe("/my-study/aws?tab=curriculum&mode=edit");
  });
});
