// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MeStudies, RoomDetail } from "@/lib/api/types";
import { ApiException } from "@/lib/api/errors";
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
// 준비중 방 — 그룹장(나)만 있다
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
const flush = () => act(async () => {});
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

// 방을 만들면 곧바로 내 스터디(진행목표 편집)로 와 방 페이지의 「모집 시작」을 놓친다 — 공개방이 둘러보기에 안 보인다는 신고(2026-10-23)
describe("MyStudyScreen — 준비중 방 모집 시작 막대", () => {
  it("공개방 그룹장: 둘러보기 문구 + 모집 시작 버튼 (개요·진행목표 모두)", () => {
    const host = mount({});
    const b = banner(host)!;
    expect(b.getAttribute("aria-label")).toBe("모집 시작 안내");
    expect(b.querySelector('[role="status"]')!.textContent).toBe("아직 준비중이라 둘러보기에 보이지 않아요 · 회차를 준비한 뒤 모집을 시작하세요");
    expect(b.querySelector("button")!.textContent).toBe("모집 시작");
    act(() => root!.unmount());
    const cur = mount({}, { initialTab: "curriculum" });
    expect(banner(cur)).not.toBeNull();
  });

  it("비공개방 그룹장: 초대 링크 문구", () => {
    const host = mount({ isPublic: false });
    expect(banner(host)!.textContent).toContain("아직 준비중이라 초대 링크를 받아도 참가할 수 없어요");
    expect(banner(host)!.textContent).not.toContain("둘러보기");
  });

  it("그룹장이 아니거나 준비중이 아니면(모집중·보관) 그리지 않는다", () => {
    for (const d of [{ me: { state: "active" } }, { status: "recruit" }, { archived: true }] as Partial<RoomDetail>[]) {
      const host = mount(d);
      expect(banner(host)).toBeNull();
      act(() => root!.unmount());
      host.remove();
    }
  });

  it("버튼 → 그룹장 패널과 같은 확인 창 → room_open_recruit → 토스트·refresh·막대 사라짐", async () => {
    leader.openRecruit.mockResolvedValue({ ...draft, status: "recruit" });
    const host = mount({});
    act(() => banner(host)!.querySelector("button")!.click());
    const dialog = document.body.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("모집을 시작할까요?");
    expect(dialog.textContent).toContain("전체 공개 방 목록에 보이고 누구나 바로 참가할 수 있어요");
    expect(leader.openRecruit).not.toHaveBeenCalled();
    const ok = [...dialog.querySelectorAll("button")].find((x) => x.textContent === "모집 시작")!;
    await act(async () => ok.click());
    await flush();
    expect(leader.openRecruit).toHaveBeenCalledWith("aws");
    expect(refresh).toHaveBeenCalled();
    expect(pageText()).toContain("모집을 시작했어요");
    expect(banner(host)).toBeNull();
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("실패하면 오류 토스트 · 막대는 남는다", async () => {
    leader.openRecruit.mockRejectedValue(new ApiException({ code: "ROOM_NO_LEAF_TASK", message: "x" }));
    const host = mount({});
    act(() => banner(host)!.querySelector("button")!.click());
    const ok = [...document.body.querySelector('[role="alertdialog"]')!.querySelectorAll("button")].find((x) => x.textContent === "모집 시작")!;
    await act(async () => ok.click());
    await flush();
    expect(pageText()).toContain("진행목표에 과제를 1개 이상 만들어야 모집을 시작할 수 있어요");
    expect(refresh).not.toHaveBeenCalled();
    expect(banner(host)).not.toBeNull();
  });
});
