// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MeStudies, RoomDetail, Submission, TaskDetail } from "@/lib/api/types";
import { screenKeyOf } from "@/lib/leaveGuard";
import { AWS, CHULSU } from "./fixtures";
import { readFrom, readItem } from "./editUrl";
import type { TabId } from "./StudyHeaderInfo";

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

const detail = {
  today: AWS.today, id: "6", slug: "aws", title: "AWS SAA", intro: "", descriptionMd: "", rulesMd: "", status: "active", archived: false, isPublic: true, joinMode: "approval",
  startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 4, leader: { userId: "u2", nickname: "민수", tone: "mint" }, leaderDoesTasks: true, tags: [],
  members: [{ userId: "u1", nickname: "철수", tone: "blue", role: "member", status: "active", joinedAt: null }], me: { state: "active" }, rounds: [],
  // 개요 이번 회차 카드에 21
  currentRound: { id: "2", label: "2주차", title: "EC2·S3", startDate: "2026-10-08", endDate: "2026-10-14", leafCount: 1, assigned: 2, submitted: 1, pct: 50, tasks: [
    { id: "21", title: "EC2 인스턴스 유형 정리", type: "designated", startDate: "2026-10-08", endDate: "2026-10-14", people: [{ userId: "u3", nickname: "지은", tone: "peach", status: "done" }, { userId: "u1", nickname: "철수", tone: "blue", status: "open" }] },
  ] },
  stats: { roundCount: 0, leafCount: 0, commonCount: 0, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [] },
  myProgress: null, invite: null, pendingCount: 0, myPermissions: { canEditCurriculum: false },
} as unknown as RoomDetail;
const studies: MeStudies = { today: AWS.today, groups: [] };

// 21 "EC2 인스턴스 유형 정리" — 지정, 지은 제출 · 철수(나) 진행중 (1/2)
const LEAF = "21";
const leafNode = AWS.nodes.find((n) => n.id === LEAF)!;
const SUB: Submission = { id: "s1", bodyMd: "정리", links: [], files: [], firstSubmittedAt: "2026-10-12T03:00:00Z", isLate: false, updatedAt: "2026-10-12T03:00:00Z" };
const JIEUN_SUB = { ...SUB, id: "s0", author: { userId: "u3", nickname: "지은", tone: "mint" } };
const before: TaskDetail = {
  today: AWS.today,
  node: leafNode,
  path: [],
  mySubmission: null,
  isAssignee: true,
  allSubmitted: false,
  submissions: [JIEUN_SUB],
} as unknown as TaskDetail;

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
  api.fetchCurriculum.mockResolvedValue(AWS);
  nav.refresh.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

/** page.tsx 처럼 지금 주소로 화면을 그린다 — 처음 열기·새로고침·router.refresh 가 key 를 바꿔 다시 마운트한 경우 */
const mountFromUrl = () => {
  if (root) act(() => root!.unmount());
  document.body.innerHTML = "";
  const sp = new URLSearchParams(window.location.search);
  const key = screenKeyOf(sp);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(MeProvider, { me: { id: CHULSU, nickname: "철수", tone: "blue", unreadCount: 0 } } as ComponentProps<typeof MeProvider>,
        createElement(MyStudyScreen, {
          key: `aws:${key.task}:${key.tab}`, detail, curriculum: AWS, studies, initialTab: key.tab as TabId,
          initialItem: readItem(window.location.search) ?? undefined, initialFrom: readFrom(window.location.search) ?? undefined,
        })),
    ),
  );
};
const backButton = () => host.querySelector<HTMLButtonElement>("section[aria-labelledby=detail-title] > div > button");
const openFromOverview = async () => {
  window.history.replaceState(null, "", "/my-study/aws");
  mountFromUrl();
  await flush();
  const card = [...host.querySelectorAll<HTMLButtonElement>("button[data-card-open]")].find((b) => b.textContent?.includes("EC2"))!;
  act(() => card.click());
  await flush();
};
const submit = async () => {
  const ta = host.querySelector<HTMLTextAreaElement>("textarea[data-md]")!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, "정리");
  act(() => {
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "제출하기")!.click());
  await flush();
};

describe("과제 상세 [← …] 는 들어온 곳으로 — 진입 경로가 화면 안 동작·다시 마운트·뒤로/앞으로·새로고침에도 그대로", () => {
  it("개요 카드에서 열면 「개요」, 주소에 from=overview 가 실린다", async () => {
    api.fetchTask.mockResolvedValue(before);
    await openFromOverview();
    expect(backButton()?.textContent).toContain("개요");
    expect(new URLSearchParams(window.location.search).get("from")).toBe("overview");
    expect(readItem(window.location.search)).toBe(LEAF);
  });

  it("개요에서 연 상세 → 제출 → router.refresh 가 key 를 바꿔 다시 마운트해도 「개요」, 누르면 개요로", async () => {
    api.fetchTask.mockResolvedValue(before);
    api.upsertSubmission.mockResolvedValue(SUB);
    await openFromOverview();
    await submit();
    expect(nav.refresh).toHaveBeenCalled();
    mountFromUrl(); // router.refresh: 주소가 ?tab=curriculum 이 되어 서버 key 가 바뀌었다
    await flush();
    expect(backButton()?.textContent).toContain("개요");
    act(() => backButton()!.click());
    await flush();
    expect(backButton()).toBeNull();
    const sp = new URLSearchParams(window.location.search);
    expect(sp.get("tab")).toBe("overview");
    expect(sp.has("item")).toBe(false);
    expect(sp.has("from")).toBe(false);
  });

  it("다시 마운트된 화면에서 앞으로 가기로 돌아온 상세 기록도 그 주소의 연 곳(「개요」)", async () => {
    api.fetchTask.mockResolvedValue(before);
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    mountFromUrl();
    await flush();
    act(() => {
      window.history.pushState(null, "", `/my-study/aws?tab=curriculum&item=${LEAF}&from=overview`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await flush();
    expect(backButton()?.textContent).toContain("개요");
  });

  it("진행목표 목록에서 열면 「진행목표」 — 주소에 from 없음", async () => {
    api.fetchTask.mockResolvedValue(before);
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    mountFromUrl();
    await flush();
    const row = [...host.querySelectorAll("[role=treeitem]")].find((r) => r.textContent?.includes("EC2 인스턴스 유형 정리"))!;
    act(() => (row.querySelector("button") ?? (row as HTMLElement)).click());
    await flush();
    expect(backButton()?.textContent).toContain("진행목표");
    expect(new URLSearchParams(window.location.search).has("from")).toBe(false);
  });

  it("주소로 바로 열면(from 없음) 기본 「진행목표」", async () => {
    api.fetchTask.mockResolvedValue(before);
    window.history.replaceState(null, "", `/my-study/aws?tab=curriculum&item=${LEAF}`);
    mountFromUrl();
    await flush();
    expect(backButton()?.textContent).toContain("진행목표");
  });
});

describe("제출 성공 응답으로 위쪽 제출 현황도 같은 렌더에 바뀐다", () => {
  it("다시 받기(task_get)가 아직 안 와도 1/2 → 2/2, 내 줄은 제출", async () => {
    api.fetchTask.mockResolvedValueOnce(before).mockReturnValue(new Promise(() => {})); // 재조회는 끝나지 않는다
    api.upsertSubmission.mockResolvedValue(SUB);
    window.history.replaceState(null, "", `/my-study/aws?tab=curriculum&item=${LEAF}`);
    mountFromUrl();
    await flush();
    expect(host.querySelector("#submissions h3")?.textContent).toContain("1/2");
    await submit();
    expect(host.querySelector("#submissions h3")?.textContent).toContain("2/2");
    const mine = [...host.querySelectorAll("#submissions li")].find((li) => li.textContent?.includes("(나)"))!;
    expect(mine.textContent).not.toContain("진행중");
    expect(mine.textContent).toContain("제출");
  });
});
