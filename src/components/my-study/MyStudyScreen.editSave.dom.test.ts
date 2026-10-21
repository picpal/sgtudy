// @vitest-environment jsdom
// 진행목표 편집 화면 [저장] — 저장한 뒤 편집에 들어오기 전 화면(상세·목록)으로 돌아간다. [임시저장] 은 머문다
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Curriculum, MeStudies, RoomDetail } from "@/lib/api/types";
import { AWS, CHULSU } from "./fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView = () => {};

const CUR: Curriculum = { ...AWS, myPermissions: { canEditCurriculum: true } };
const m = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/lib/api/nodeFiles", async (orig) => ({ ...(await orig<object>()), fetchNodeFiles: () => Promise.resolve([]), fetchNodeFilesOrEmpty: () => Promise.resolve([]) }));
vi.mock("@/lib/api/submission", async (orig) => ({ ...(await orig<object>()), roomIdOfNode: () => Promise.resolve("7"), fetchTask: () => new Promise(() => {}) }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: () => null }));
vi.mock("@/lib/api/my-study", async (orig) => ({ ...(await orig<object>()), recheckCurriculumEdit: () => Promise.resolve({ allowed: true, cur: null }), nodeUpdate: m.update }));

const { MeProvider } = await import("@/lib/me");
const { MyStudyScreen } = await import("./MyStudyScreen");

const P = (userId: string, nickname: string, tone: RoomDetail["leader"]["tone"]) => ({ userId, nickname, tone });
const detail = {
  today: AWS.today, id: "6", slug: "aws", title: "AWS SAA", intro: "", descriptionMd: "", rulesMd: "",
  status: "active", archived: false, isPublic: true, joinMode: "approval", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, memberCount: 4,
  leader: P("u2", "민수", "mint"), leaderDoesTasks: true, tags: [],
  members: [{ ...P("u2", "민수", "mint"), role: "leader", status: "active", joinedAt: null }, { ...P("u1", "철수", "blue"), role: "member", status: "active", joinedAt: null }],
  me: { state: "active" }, currentRound: null, rounds: [],
  stats: { roundCount: 0, leafCount: 0, commonCount: 0, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [] },
  myProgress: null, invite: null, pendingCount: 0, myPermissions: { canEditCurriculum: true },
} as unknown as RoomDetail;
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
          createElement(MyStudyScreen, { key: "aws::curriculum", detail, curriculum: CUR, studies, initialTab: "curriculum", ...q })),
      ),
    );
  render(p);
  return { host, render };
};
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const btn = (el: Element, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
const editView = (host: HTMLElement) => host.querySelector('section[aria-labelledby="edit-view-title"]');
const typeTitle = (host: HTMLElement, v: string) =>
  act(() => {
    const input = editView(host)!.querySelector<HTMLInputElement>("input[type=text]")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
// history.back 의 popstate 를 기다린다 (없으면 잠깐 기다리고 넘어간다)
const clickAndSettle = async (b: HTMLButtonElement) => {
  const popped = new Promise((r) => {
    window.addEventListener("popstate", r, { once: true });
    setTimeout(r, 200);
  });
  await act(async () => b.click());
  await flush();
  await act(async () => void (await popped));
  await flush();
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  m.update.mockReset();
});

const saved = () => ({ ...CUR, nodes: CUR.nodes.map((n) => (n.id === "21" ? { ...n, title: "고친 제목" } : n)) });

describe("편집 화면 [저장] → 들어오기 전 화면으로", () => {
  const openFromDetail = async () => {
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const s = mount({});
    window.history.pushState(null, "", "/my-study/aws?tab=curriculum&item=21");
    s.render({ initialItem: "21" });
    expect(s.host.querySelector("#detail-title")).not.toBeNull();
    act(() => btn(s.host.querySelector("#detail-title")!.closest("section")!, "편집").click());
    await flush();
    expect(editView(s.host)).not.toBeNull();
    expect(window.location.search).toContain("mode=edit");
    return s;
  };

  it("상세 → 편집 → 고쳐서 [저장] = 같은 항목의 보기 상세, 편집 기록은 back 으로 걷힌다 · 미저장 확인 없음", async () => {
    m.update.mockResolvedValue(saved());
    const { host } = await openFromDetail();
    typeTitle(host, "고친 제목");
    await flush();
    await clickAndSettle(btn(editView(host)!, "저장"));
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(editView(host)).toBeNull();
    expect(host.querySelector("#detail-title")?.textContent).toBe("고친 제목");
    expect(window.location.search).toContain("item=21");
    expect(window.location.search).not.toContain("mode=edit");
    expect(host.textContent).not.toContain("저장하지 않은 수정이 있어요");
    // 뒤로 가기 한 번 = 목록 (쓸모없는 기록이 남지 않았다)
    const popped = new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    window.history.back();
    await act(async () => void (await popped));
    await flush();
    expect(window.location.search).not.toContain("item=");
  });

  it("편집 목록 → 항목 → [저장] = 편집 목록", async () => {
    m.update.mockResolvedValue(saved());
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum");
    const { host } = mount({ initialMode: "edit" });
    act(() => host.querySelector<HTMLButtonElement>('[data-node="21"] [data-row-main]')!.click());
    await flush();
    expect(editView(host)).not.toBeNull();
    typeTitle(host, "고친 제목");
    await flush();
    await clickAndSettle(btn(editView(host)!, "저장"));
    expect(editView(host)).toBeNull();
    expect(host.querySelector('[data-node="21"]')).not.toBeNull();
    expect(window.location.search).not.toContain("item=");
  });

  it("새로고침으로 바로 연 편집 — [저장] 은 같은 항목의 보기 상세로", async () => {
    m.update.mockResolvedValue(saved());
    window.history.replaceState(null, "", "/my-study/aws?tab=curriculum&mode=edit&item=21");
    const { host } = mount({ initialMode: "edit", initialItem: "21" });
    await flush();
    typeTitle(host, "고친 제목");
    await flush();
    await clickAndSettle(btn(editView(host)!, "저장"));
    expect(editView(host)).toBeNull();
    expect(host.querySelector("#detail-title")?.textContent).toBe("고친 제목");
    expect(window.location.search).toContain("item=21");
    expect(window.location.search).not.toContain("mode=edit");
  });

  it("[임시저장] — 저장하고 편집 화면에 머문다 (주소도 그대로)", async () => {
    m.update.mockResolvedValue(saved());
    const { host } = await openFromDetail();
    typeTitle(host, "고친 제목");
    await flush();
    await act(async () => btn(editView(host)!, "임시저장").click());
    await flush();
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(editView(host)).not.toBeNull();
    expect(window.location.search).toContain("mode=edit");
    expect(btn(editView(host)!, "임시저장").disabled).toBe(true);
  });

  it("[저장] 실패 — 편집 화면에 머문다", async () => {
    m.update.mockRejectedValue(new Error("boom"));
    const { host } = await openFromDetail();
    typeTitle(host, "고친 제목");
    await flush();
    await act(async () => btn(editView(host)!, "저장").click());
    await flush();
    expect(editView(host)).not.toBeNull();
    expect(window.location.search).toContain("mode=edit");
  });
});
