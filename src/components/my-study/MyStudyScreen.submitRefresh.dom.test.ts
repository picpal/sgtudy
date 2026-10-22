// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Curriculum, MeStudies, RoomDetail, Submission, TaskDetail } from "@/lib/api/types";
import { AWS, CHULSU } from "./fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView = () => {};

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: nav.refresh, push: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/lib/api/nodeFiles", async (orig) => ({ ...(await orig<object>()), fetchNodeFiles: () => Promise.resolve([]), fetchNodeFilesOrEmpty: () => Promise.resolve([]) }));
vi.mock("@/components/ui/markdown-editor", async () => {
  const { createElement: h } = await import("react");
  return { MarkdownEditor: (p: { value: string; onChange: (v: string) => void }) => h("textarea", { "data-md": "", value: p.value, onChange: (e: { target: { value: string } }) => p.onChange(e.target.value) }) };
});
const notices = vi.hoisted(() => ({ fetchNoticeInbox: vi.fn(), fetchNotices: vi.fn(), markNoticesRead: vi.fn() }));
vi.mock("@/lib/api/notices", async (orig) => ({ ...(await orig<object>()), ...notices }));
const comments = vi.hoisted(() => ({ fetchComments: vi.fn() }));
vi.mock("@/lib/api/comments", async (orig) => ({ ...(await orig<object>()), ...comments }));
const api = vi.hoisted(() => ({ fetchTask: vi.fn(), upsertSubmission: vi.fn(), fetchCurriculum: vi.fn() }));
vi.mock("@/lib/api/submission", async (orig) => ({ ...(await orig<object>()), fetchTask: api.fetchTask, upsertSubmission: api.upsertSubmission }));
vi.mock("@/lib/api/my-study", async (orig) => ({ ...(await orig<object>()), fetchCurriculum: api.fetchCurriculum }));

const { MeProvider } = await import("@/lib/me");
const { MyStudyScreen } = await import("./MyStudyScreen");
const { bumpProgress } = await import("@/lib/progressStale");

const detail = {
  today: AWS.today, id: "6", slug: "aws", title: "AWS SAA", intro: "", descriptionMd: "", rulesMd: "", status: "active", archived: false, isPublic: true, joinMode: "approval",
  startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 4, leader: { userId: "u2", nickname: "민수", tone: "mint" }, leaderDoesTasks: true, tags: [],
  members: [{ userId: "u1", nickname: "철수", tone: "blue", role: "member", status: "active", joinedAt: null }], me: { state: "active" }, currentRound: null, rounds: [],
  stats: { roundCount: 0, leafCount: 0, commonCount: 0, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [] },
  myProgress: null, invite: null, pendingCount: 0, myPermissions: { canEditCurriculum: false },
} as unknown as RoomDetail;
const studies: MeStudies = { today: AWS.today, groups: [] };

// 21 "EC2 인스턴스 유형 정리" — 지정, 지은 제출 · 철수(나) 진행중 → 철수가 제출하면 1/2 → 2/2
const LEAF = "21";
const leafNode = AWS.nodes.find((n) => n.id === LEAF)!;
const taskDetail = (mine: Submission | null): TaskDetail =>
  ({ today: AWS.today, node: { ...leafNode, task: { ...leafNode.task!, submitted: mine ? 2 : 1 } }, path: [], mySubmission: mine, isAssignee: true, allSubmitted: !!mine, submissions: [] }) as unknown as TaskDetail;
const SUB: Submission = { id: "s1", bodyMd: "정리", links: [], files: [], firstSubmittedAt: "2026-10-12T03:00:00Z", isLate: false, updatedAt: "2026-10-12T03:00:00Z" };
const after: Curriculum = {
  ...AWS,
  nodes: AWS.nodes.map((n) => (n.id === LEAF ? { ...n, task: { ...n.task!, submitted: 2, people: n.task!.people.map((p) => (p.userId === CHULSU ? { ...p, status: "done" } : p)) } } : n)),
};

let root: Root | null = null;
let host: HTMLElement;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
beforeEach(() => {
  comments.fetchComments.mockResolvedValue({ items: [], people: {}, hasOlder: false, hasNewer: false, total: 0, canWrite: true, writeBlock: null, locked: null, target: null, limits: {} });
  notices.fetchNoticeInbox.mockResolvedValue({ unread: false, popups: [] });
  notices.fetchNotices.mockResolvedValue({ items: [], canWrite: false, limits: { total: 100, pinned: 3, popup: 5 }, counts: { total: 0, pinned: 0, popup: 0 } });
  api.fetchTask.mockReset();
  api.upsertSubmission.mockReset();
  api.fetchCurriculum.mockReset();
  nav.refresh.mockReset();
  window.history.replaceState(null, "", `/my-study/aws?tab=curriculum&item=${LEAF}`);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});
const mount = (item?: string) => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(MeProvider, { me: { id: CHULSU, nickname: "철수", tone: "blue", unreadCount: 0 } } as ComponentProps<typeof MeProvider>,
        createElement(MyStudyScreen, { key: "aws::curriculum", detail, curriculum: AWS, studies, initialTab: "curriculum", initialItem: item })),
    ),
  );
};
const rowCount = (title: string) => {
  const row = [...host.querySelectorAll("[role=treeitem]")].find((r) => r.textContent?.includes(title));
  return row?.textContent?.match(/(\d+)\/(\d+)/)?.[0] ?? null;
};

describe("제출 뒤 목록·현황이 새로 고침 없이 바뀐다", () => {
  it("과제 제출 → 진행목표 목록의 n/총 · 내 상태가 바로 바뀐다", async () => {
    api.fetchTask.mockResolvedValueOnce(taskDetail(null)).mockResolvedValue(taskDetail(SUB));
    api.upsertSubmission.mockResolvedValue(SUB);
    api.fetchCurriculum.mockResolvedValue(after);
    mount(LEAF);
    await flush();
    expect(api.fetchCurriculum).not.toHaveBeenCalled(); // 첫 마운트는 서버 props 그대로
    const ta = host.querySelector<HTMLTextAreaElement>("textarea[data-md]")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, "정리");
    act(() => {
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "제출하기")!;
    act(() => submit.click());
    await flush();
    expect(api.upsertSubmission).toHaveBeenCalled();
    expect(api.fetchCurriculum).toHaveBeenCalled();
    expect(nav.refresh).toHaveBeenCalled(); // 방 정보(개요 회차 수·이번 회차 사람별 상태)도 다시
    // 상세의 제출 현황
    expect(host.querySelector("#submissions h3")?.textContent).toContain("2/2");
    // 목록으로
    act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("진행목표") && !b.getAttribute("role"))!.click());
    await flush();
    expect(rowCount("EC2 인스턴스 유형 정리")).toBe("2/2");
  });
  it("뒤로 가기로 되살아난 화면(옛 서버 props)은 그 뒤 제출이 있었으면 마운트 때 한 번 다시 받는다", async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    bumpProgress();
    api.fetchCurriculum.mockResolvedValue(after);
    mount();
    await flush();
    expect(api.fetchCurriculum).toHaveBeenCalledTimes(1);
    expect(nav.refresh).toHaveBeenCalled();
    expect(rowCount("EC2 인스턴스 유형 정리")).toBe("2/2");
  });
});
