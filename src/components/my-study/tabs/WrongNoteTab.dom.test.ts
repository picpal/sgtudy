// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WrongNote } from "@/lib/api/types";
import { ApiException } from "@/lib/api/errors";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// useSearchParams 가 history.pushState·replaceState·popstate 를 따라가게(Next 의 Native History API 동기화 흉내)
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const sub = (cb: () => void) => {
    window.addEventListener("test-nav", cb);
    window.addEventListener("popstate", cb);
    return () => {
      window.removeEventListener("test-nav", cb);
      window.removeEventListener("popstate", cb);
    };
  };
  return {
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(sub, () => window.location.search)),
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
  };
});
const api = vi.hoisted(() => ({ fetchWrongNote: vi.fn(), fetchWrongNoteMine: vi.fn(), practiceWrongNote: vi.fn(), masterWrongNote: vi.fn() }));
vi.mock("@/lib/api/wrongNote", async (orig) => ({ ...(await orig<typeof import("@/lib/api/wrongNote")>()), ...api }));

const { WrongNoteTab } = await import("./WrongNoteTab");

const T0 = { wrong: 0, retriedOk: 0, mastered: 0, locked: 0 };
const VIEW = (): WrongNote => ({
  today: "2026-10-16", viewer: "member", hasExam: true, totals: T0,
  rounds: [{
    id: "3", title: "3주차",
    exams: [{
      nodeId: "31", title: "3주차 정리 시험", endDate: "2026-10-21", reveal: "after_submit", score: 1, maxScore: 5, correctCount: 1, questionCount: 4, locked: false,
      items: [{ question: { id: "1", ord: 0, type: "ox", prompt: "IGW 는 VPC 에 붙는다", choices: null, points: 1, answer: true, explanation: "맞다" }, no: 1, mine: false, practice: null, mastered: false, bookmarked: false }],
    }],
  }],
});

let root: Root | null = null;
const flush = () => act(async () => {});
const realPush = window.history.pushState.bind(window.history);
const realReplace = window.history.replaceState.bind(window.history);
beforeEach(() => {
  for (const [k, real] of [["pushState", realPush], ["replaceState", realReplace]] as const)
    vi.spyOn(window.history, k).mockImplementation((d, u, url) => {
      real(d, u, url);
      window.dispatchEvent(new Event("test-nav"));
    });
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchWrongNote.mockResolvedValue(VIEW());
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  realReplace(null, "", "/my-study/aws");
});
// 기본은 3주차 상세(?round=3) — 문항 동작 테스트. 목록은 search 로
async function mount(viewerPending = false, search = "?tab=wrong&round=3") {
  realReplace(null, "", `/my-study/aws${search}`);
  const toast = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(WrongNoteTab, { slug: "aws", viewerPending, toast })));
  await flush();
  return { host, toast };
}
const btn = (scope: ParentNode, label: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;
const click = (el: Element | null) => act(() => (el as HTMLElement).click());

describe("WrongNoteTab", () => {
  it("목록은 회차 카드 · 카드 → ?tab=wrong&round=3 push · 기간 줄(커리큘럼 periods) · 뒤로 가기 → 목록", async () => {
    const toast = vi.fn();
    realReplace(null, "", "/my-study/aws?tab=wrong");
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() => root!.render(createElement(WrongNoteTab, { slug: "aws", viewerPending: false, toast, periods: { "3": { startDate: "2026-10-15", endDate: "2026-10-21" } } })));
    await flush();
    expect(host.querySelector("[data-wn-item]")).toBeNull();
    expect(host.textContent).toContain("10.15 ~ 10.21 · 시험 1개");
    click(host.querySelector("[data-round-card='3']"));
    await flush();
    expect(window.location.search).toBe("?tab=wrong&round=3");
    expect(host.querySelector("[data-wn-item='1']")).not.toBeNull();
    window.history.back();
    await vi.waitFor(() => expect(window.location.search).toBe("?tab=wrong"));
    await flush();
    expect(host.querySelector("[data-wn-item]")).toBeNull();
    expect(host.querySelector("[data-round-card='3']")).not.toBeNull();
  });

  it("마운트에 fetchWrongNote(slug) 한 번 → 목록", async () => {
    const { host } = await mount();
    expect(api.fetchWrongNote).toHaveBeenCalledTimes(1);
    expect(api.fetchWrongNote).toHaveBeenCalledWith("aws");
    expect(host.querySelector("h3")?.textContent).toBe("3주차");
  });

  it("불러오기 실패 → [다시 시도] 로 다시 받는다", async () => {
    api.fetchWrongNote.mockRejectedValueOnce(new Error("net"));
    const { host } = await mount();
    expect(host.querySelector("[role='alert']")?.textContent).toContain("오답노트를 불러오지 못했어요");
    click(btn(host, "다시 시도"));
    await flush();
    expect(api.fetchWrongNote).toHaveBeenCalledTimes(2);
    expect(host.querySelector("h3")?.textContent).toBe("3주차");
  });

  it("승인 대기 — 받지 않고 안내만 · 서버가 pending 이어도 같은 안내", async () => {
    let m = await mount(true);
    expect(api.fetchWrongNote).not.toHaveBeenCalled();
    expect(m.host.textContent).toContain("참가가 승인되면 오답노트를 볼 수 있어요");
    act(() => root!.unmount());
    api.fetchWrongNote.mockResolvedValue({ ...VIEW(), viewer: "pending", hasExam: false, rounds: [] });
    m = await mount(false);
    expect(m.host.textContent).toContain("참가가 승인되면 오답노트를 볼 수 있어요");
  });

  it("채점 중복 클릭은 한 번만 부른다 · 결과를 목록에 합친다(다시 받지 않음)", async () => {
    let resolve!: (v: unknown) => void;
    api.practiceWrongNote.mockReturnValue(new Promise((r) => (resolve = r)));
    const { host } = await mount();
    click(btn(host, "다시 풀기"));
    click(btn(host, "O"));
    const grade = btn(host, "채점")!;
    click(grade);
    click(grade);
    expect(api.practiceWrongNote).toHaveBeenCalledTimes(1);
    expect(api.practiceWrongNote).toHaveBeenCalledWith("aws", [{ questionId: "1", answer: true }]);
    await act(async () => resolve({ results: { "1": { correct: true, practice: { lastCorrect: true, correctCount: 1, wrongCount: 0, lastAnswer: true, lastAt: "2026-10-17T00:00:00.000Z" } } } }));
    expect(host.textContent).toContain("✓ 맞혔어요");
    expect(host.textContent).toContain("다시 풀어 맞힘 1");
    expect(api.fetchWrongNote).toHaveBeenCalledTimes(1);
  });

  it("WRONG_NOTE_LOCKED → 토스트 + 목록 다시 받기", async () => {
    api.practiceWrongNote.mockRejectedValue(new ApiException({ code: "WRONG_NOTE_LOCKED", message: "정답이 공개된 뒤에 다시 풀 수 있어요" }));
    const { host, toast } = await mount();
    click(btn(host, "다시 풀기"));
    click(btn(host, "채점"));
    await flush();
    expect(toast).toHaveBeenCalledWith({ text: "정답이 공개된 뒤에 다시 풀 수 있어요", tone: "bad" });
    expect(api.fetchWrongNote).toHaveBeenCalledTimes(2);
  });

  it("[외웠어요] → masterWrongNote(slug, id, true) · 토스트 · 목록에서 빠짐", async () => {
    api.masterWrongNote.mockResolvedValue({ mastered: true });
    const { host, toast } = await mount();
    click(btn(host, "외웠어요"));
    await flush();
    expect(api.masterWrongNote).toHaveBeenCalledWith("aws", "1", true);
    expect(toast).toHaveBeenCalledWith({ text: "외운 문제로 옮겼어요 · 「외운 문제 보기」로 되돌릴 수 있어요", tone: "ok" });
    expect(host.textContent).toContain("전부 외웠어요");
  });

  it("다시 받는 중에 연습 결과를 합쳤으면 늦게 온 목록은 버리고 한 번 더 받는다(리뷰 5)", async () => {
    const { host } = await mount();
    let late!: (v: WrongNote) => void;
    api.fetchWrongNote.mockReturnValueOnce(new Promise((r) => (late = r)));
    api.masterWrongNote.mockRejectedValue(new ApiException({ code: "WRONG_NOTE_NOT_IN", message: "오답노트에 없는 문항이에요" }));
    click(btn(host, "외웠어요"));
    await flush();
    expect(api.fetchWrongNote).toHaveBeenCalledTimes(2);       // 다시 받기 시작(아직 응답 없음)
    const done = { lastCorrect: true, correctCount: 1, wrongCount: 0, lastAnswer: true, lastAt: "2026-10-17T00:00:00.000Z" };
    api.practiceWrongNote.mockResolvedValue({ results: { "1": { correct: true, practice: done } } });
    click(btn(host, "다시 풀기"));
    click(btn(host, "O"));
    click(btn(host, "채점"));
    await flush();
    expect(host.textContent).toContain("다시 풀어 맞힘 1");
    const fresh = VIEW();
    fresh.rounds[0].exams[0].items![0].practice = done;
    api.fetchWrongNote.mockResolvedValue(fresh);
    await act(async () => late(VIEW()));                        // 연습 전 목록 — 버린다
    await flush();
    expect(api.fetchWrongNote).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("다시 풀어 맞힘 1");
  });
});
