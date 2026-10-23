// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MeTasks, WrongNoteMine, WrongNoteStudy } from "@/lib/api/types";
import { routes } from "@/lib/routes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// useSearchParams 가 history.replaceState 를 따라가게(Next 의 Native History API 동기화 흉내)
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const sub = (cb: () => void) => {
    window.addEventListener("test-nav", cb);
    return () => window.removeEventListener("test-nav", cb);
  };
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(sub, () => window.location.search)),
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    usePathname: () => "/tasks",
  };
});
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
const m = vi.hoisted(() => ({ fetchMyTasks: vi.fn(), fetchWrongNoteMine: vi.fn(), practiceWrongNote: vi.fn(), masterWrongNote: vi.fn() }));
vi.mock("@/lib/api/personal", async (orig) => ({ ...(await orig<object>()), fetchMyTasks: m.fetchMyTasks }));
vi.mock("@/lib/api/wrongNote", async (orig) => ({ ...(await orig<object>()), fetchWrongNoteMine: m.fetchWrongNoteMine, practiceWrongNote: m.practiceWrongNote, masterWrongNote: m.masterWrongNote }));

const { TasksScreen } = await import("./TasksScreen");

const study = (slug: string, title: string) => ({ slug, title, tone: "mint" as const, status: "active" as const, membership: "joined" as const, currentRoundId: `${slug}3`, canAddPersonal: true });
const TASKS: MeTasks = {
  today: "2026-10-16",
  personalPerRound: 20,
  studies: [study("aws", "AWS"), study("spring", "Spring")],
  rounds: [{ id: "aws3", slug: "aws", label: "3주차", title: "r3", startDate: "2026-10-15", endDate: "2026-10-21", canAdd: true }],
  items: [{ id: "T", slug: "aws", roundId: "aws3", groupTitle: null, title: "ALB 실습", type: "common", startDate: "2026-10-15", endDate: "2026-10-21", st: "open", submittedAt: null }],
};
const T0 = { wrong: 0, retriedOk: 0, mastered: 0, locked: 0 };
const noteStudy = (slug: string, title: string, qid: string): WrongNoteStudy => ({
  slug, title, tone: "mint", status: "active", hasExam: true, totals: T0,
  rounds: [{
    id: `${slug}-r`, title: "3주차",
    exams: [{
      nodeId: `${slug}-x`, title: `${title} 시험`, endDate: "2026-10-21", reveal: "after_submit", score: 1, maxScore: 2, correctCount: 1, questionCount: 2, locked: false,
      items: [{ question: { id: qid, ord: 0, type: "ox", prompt: `${title} 문제`, choices: null, points: 1, answer: true, explanation: "해설" }, no: 1, mine: false, practice: null, mastered: false }],
    }],
  }],
});
// 「old」 = 이탈(INACTIVE) 방 — me_tasks 칩에는 없지만 오답노트에는 있다
const MINE: WrongNoteMine = { today: "2026-10-16", studies: [noteStudy("aws", "AWS", "1"), noteStudy("spring", "Spring", "2"), noteStudy("old", "Old", "3")] };

let root: Root | null = null;
const realReplace = window.history.replaceState.bind(window.history);
const realPush = window.history.pushState.bind(window.history);
const onPop = () => window.dispatchEvent(new Event("test-nav"));
beforeEach(() => {
  vi.spyOn(window.history, "replaceState").mockImplementation((d, u, url) => {
    realReplace(d, u, url);
    window.dispatchEvent(new Event("test-nav"));
  });
  vi.spyOn(window.history, "pushState").mockImplementation((d, u, url) => {
    realPush(d, u, url);
    window.dispatchEvent(new Event("test-nav"));
  });
  window.addEventListener("popstate", onPop);
  m.fetchWrongNoteMine.mockResolvedValue(MINE);
});
afterEach(() => {
  window.removeEventListener("popstate", onPop);
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  Object.values(m).forEach((f) => f.mockReset());
  realReplace(null, "", "/tasks");
});
const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});
async function mount(query: string, initial: MeTasks = TASKS) {
  realReplace(null, "", `/tasks${query}`);
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(TasksScreen, { initial })));
  await flush();
  return host;
}
const btn = (scope: ParentNode, label: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;
const click = async (el: Element | null) => {
  act(() => (el as HTMLElement).click());
  await flush();
};
const h2s = (host: HTMLElement) => [...host.querySelectorAll("h2")].map((h) => h.querySelector("span.min-w-0")?.textContent);
const view = (host: HTMLElement) => host.querySelector("[role=group][aria-label=보기]")!;

describe("TasksScreen — 「오답노트」 보기 (오답노트 D17~D21)", () => {
  it("?view=notes 로 열면 오답을 받아 스터디 h2 로 · 과제 필터·요약·「＋ 내 목표 추가」 없음 · 「오답노트 ›」 링크", async () => {
    const host = await mount("?view=notes");
    expect(m.fetchWrongNoteMine).toHaveBeenCalledTimes(1);
    expect(h2s(host)).toEqual(["AWS", "Spring", "Old"]);
    expect(host.querySelector("[aria-label=기간]")).toBeNull();
    expect(host.textContent).not.toContain("남은 팀 과제");
    expect(btn(host, "＋ 내 목표 추가＋ 목표")).toBeNull();
    expect(host.querySelector("h2 a")!.getAttribute("href")).toBe(routes.myStudyTab("aws", "wrong"));
    expect(host.textContent).toContain("오답 3문항");
  });

  it("과제 보기(기본)에서는 받지 않는다", async () => {
    const host = await mount("");
    expect(m.fetchWrongNoteMine).not.toHaveBeenCalled();
    expect(host.textContent).toContain("ALB 실습");
    expect(btn(view(host), "과제")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("?study=aws → aws 섹션만 · 이탈 방(old)도 칩이 있고 고를 수 있다", async () => {
    let host = await mount("?view=notes&study=aws");
    expect(h2s(host)).toEqual(["AWS"]);
    const chips = host.querySelector("[role=group][aria-label=스터디]")!;
    expect([...chips.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["모든 스터디", "AWS", "Spring", "Old"]);
    act(() => root!.unmount());
    host = await mount("?view=notes&study=old");
    expect(h2s(host)).toEqual(["Old"]);
    expect(new URLSearchParams(window.location.search).get("study")).toBe("old");
  });

  it("모르는 study 는 받은 뒤 「전체」 로 정리", async () => {
    const host = await mount("?view=notes&study=zzz");
    expect(h2s(host)).toEqual(["AWS", "Spring", "Old"]);
    expect(new URLSearchParams(window.location.search).get("study")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("notes");
  });

  it("Seg 전환은 replaceState — 과제로 가면 view 가 빠지고, 다시 오답노트로 와도 다시 받지 않는다", async () => {
    const host = await mount("?view=notes");
    await click(btn(view(host), "과제"));
    expect(new URLSearchParams(window.location.search).get("view")).toBeNull();
    expect(host.textContent).toContain("ALB 실습");
    expect(m.fetchMyTasks).not.toHaveBeenCalled();
    await click(btn(view(host), "오답노트"));
    expect(new URLSearchParams(window.location.search).get("view")).toBe("notes");
    expect(m.fetchWrongNoteMine).toHaveBeenCalledTimes(1);
    expect(h2s(host)).toEqual(["AWS", "Spring", "Old"]);
  });

  it("목록은 스터디 섹션 안 회차 카드 · 카드 → ?round= push(상세) · [회차 목록] → back(목록, 필터 그대로)", async () => {
    const host = await mount("?view=notes&study=spring");
    expect(host.querySelector("[data-wn-item]")).toBeNull();
    const section = host.querySelector<HTMLElement>("section[aria-label=Spring]")!;
    expect(section.querySelector("[data-round-card='spring-r']")).not.toBeNull();
    const before = window.history.length;
    await click(section.querySelector("[data-round-card='spring-r']"));
    expect(window.history.length).toBe(before + 1);
    const q = new URLSearchParams(window.location.search);
    expect([q.get("view"), q.get("study"), q.get("round")]).toEqual(["notes", "spring", "spring-r"]);
    expect(host.querySelector("[data-wn-item='2']")).not.toBeNull();
    expect(host.querySelector("header")!.textContent).toContain("Spring");
    act(() => btn(host, "회차 목록")!.click());
    await vi.waitFor(() => expect(new URLSearchParams(window.location.search).get("round")).toBeNull());
    await flush();
    expect(new URLSearchParams(window.location.search).get("study")).toBe("spring");
    expect(host.querySelector("[data-wn-item]")).toBeNull();
    expect(host.querySelector("[data-round-card='spring-r']")).not.toBeNull();
  });

  it("?round= 딥링크로 바로 연 상세 — [회차 목록] 은 replace(다른 화면으로 떠나지 않는다) · 과제 보기로 가면 round 가 빠진다", async () => {
    const host = await mount("?view=notes&round=aws-r");
    expect(host.querySelector("[data-wn-item='1']")).not.toBeNull();
    const before = window.history.length;
    await click(btn(host, "회차 목록"));
    expect(window.history.length).toBe(before);
    expect(new URLSearchParams(window.location.search).get("round")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("view")).toBe("notes");
    expect(host.querySelector("[data-round-card='aws-r']")).not.toBeNull();
    act(() => root!.unmount());
    const h2 = await mount("?view=notes&round=aws-r");
    await click(btn(view(h2), "과제"));
    expect(new URLSearchParams(window.location.search).get("round")).toBeNull();
  });

  it("spring 카드에서 다시 풀기 → practiceWrongNote(\"spring\", …)", async () => {
    m.practiceWrongNote.mockResolvedValue({ results: { "2": { correct: true, practice: { lastCorrect: true, correctCount: 1, wrongCount: 0, lastAnswer: true, lastAt: "2026-10-17T00:00:00.000Z" } } } });
    const host = await mount("?view=notes&round=spring-r");
    const li = host.querySelector<HTMLElement>("[data-wn-item='2']")!;
    await click(btn(li, "다시 풀기"));
    await click(btn(host.querySelector("[data-wn-item='2']")!, "O"));
    await click(btn(host.querySelector("[data-wn-item='2']")!, "채점"));
    expect(m.practiceWrongNote).toHaveBeenCalledWith("spring", [{ questionId: "2", answer: true }]);
    expect(host.textContent).toContain("✓ 맞혔어요");
  });

  it("스터디가 하나도 없으면 TasksEmpty noStudy", async () => {
    m.fetchWrongNoteMine.mockResolvedValue({ today: "2026-10-16", studies: [] });
    const host = await mount("?view=notes", { ...TASKS, studies: [], rounds: [], items: [] });
    expect(host.textContent).toContain("참여 중인 스터디가 없어요");
  });
});
