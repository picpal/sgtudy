// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

/* 방 만들기 AI 2단계 — 회차 초안 질문 · 미리보기 섹션 · 바로 모집 · 생성 뒤 적용 (스펙 D21~D38). fetch·rpc 는 목 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: () => {}, refresh: () => {} }), usePathname: () => "/rooms/new" }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: ({ value }: { value: string }) => createElement("textarea", { "data-md": "", defaultValue: value }) }));
vi.mock("@/lib/today", () => ({ useToday: () => "2026-10-23" }));
vi.mock("./tags", async (orig) => ({ ...(await orig<typeof import("./tags")>()), searchTags: () => Promise.resolve([]) }));
const rpcMock = vi.fn();
vi.mock("@/lib/api/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/api/errors")>()), rpc: (...a: unknown[]) => rpcMock(...a) }));

const { NewRoomScreen } = await import("./NewRoomScreen");

const DRAFT = { title: "AWS SAA", intro: "소개", startDate: "2026-10-26", endDate: "2026-11-15", maxMembers: 6, isPublic: true, joinMode: "direct" };
const turn = (o: object = {}) => ({ say: "정리했어요.", patch: {}, draft: DRAFT, ask: null, missing: [], dropped: [], done: true, turn: 8, turnsLeft: 4, ...o });
const view = (i: number, tasks = ["과제 a", "과제 b"], exam = true) => ({ index: i, label: `${i + 1}주차`, startDate: "2026-10-26", endDate: "2026-11-01", title: `범위 ${i + 1}`, goalMd: "이번 주 목표: x", tasks, exam });
const roundsRes = (n = 3, o: object = {}) => ({
  plan: { schema: "sgtudy.plan/v1", ops: Array.from({ length: n }, (_, i) => ({ op: "create", parent: null, label: `${i + 1}주차`, title: `범위 ${i + 1}` })) },
  rounds: Array.from({ length: n }, (_, i) => view(i)),
  stats: { rounds: n, tasks: n * 2, exams: n, cadenceDays: 7 },
  padded: 0,
  ...o,
});
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
let fetchMock: ReturnType<typeof vi.fn>;
let roundsReply: () => Promise<Response>;
beforeEach(() => {
  roundsReply = () => json(200, roundsRes());
  fetchMock = vi.fn((url: string) => (url === "/api/rooms/rounds" ? roundsReply() : json(200, turn())));
  vi.stubGlobal("fetch", fetchMock);
  push.mockReset();
  rpcMock.mockReset().mockImplementation(async (name: string) => {
    if (name === "room_create") return { slug: "aws-saa" };
    if (name === "curriculum_plan_preview") return { ok: true, previewId: "pv1" };
    if (name === "curriculum_plan_apply") return { ok: true };
    if (name === "room_open_recruit") return { slug: "aws-saa", status: "recruit" };
    return null;
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function mount(initialMode: "manual" | "ai" = "ai") {
  const host = document.body.appendChild(document.createElement("div"));
  await act(async () => createRoot(host).render(createElement(NewRoomScreen, { aiEnabled: true, initialMode })));
  await act(async () => {});
  return host;
}
const q = <T extends Element = HTMLElement>(host: Element, sel: string) => host.querySelector<T & HTMLElement>(sel);
const radio = (host: Element, text: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === text);
const byText = (host: Element, text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const submitBtn = (host: Element) => q<HTMLButtonElement>(host, 'button[type="submit"]')!;
const recruitBox = (host: Element) => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => c.closest("label")?.textContent?.includes("바로 모집 시작"))!;
const roundBoxes = (host: Element) => [...host.querySelectorAll<HTMLInputElement>('section[aria-label="회차 초안"] input[type="checkbox"]')];
const roundsBody = () => JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/rooms/rounds")![1].body as string);
const click = async (el: HTMLElement | undefined) => act(async () => el!.click());

/** 인터뷰 끝 → 회차 예 → 모집 답 → 미리보기 */
async function throughInterview(recruit: "yes" | "no" = "yes") {
  const host = await mount();
  await click(radio(host, "네, 잡아 주세요"));
  await click(radio(host, recruit === "yes" ? "네, 바로 모집 시작" : "아니요, 나중에 할게요"));
  return host;
}

describe("인터뷰 끝 — 로컬 질문(D33·D36)", () => {
  it("done → 회차 질문(몇 주차인지) + 칩 2개 · 대화 log 에는 안 들어감", async () => {
    const host = await mount();
    const text = host.textContent!;
    expect(text).toContain("회차 초안도 자동으로 잡아 드릴까요? 10/26~11/15 을 3주차로 나누고");
    expect([radio(host, "네, 잡아 주세요"), radio(host, "아니요, 미리보기로")].every(Boolean)).toBe(true);
    expect(q(host, '[role="log"]')!.textContent).not.toContain("회차 초안도");
    expect(byText(host, "미리보기로")).toBeUndefined();
  });
  it("예 → 요청 본문(draft·userLines·style) → 모집 질문(공개 문구) → 네 → 미리보기 + 섹션 + 체크 켬 + 라벨", async () => {
    const host = await mount();
    await click(radio(host, "네, 잡아 주세요"));
    expect(roundsBody()).toMatchObject({ draft: { title: "AWS SAA", startDate: "2026-10-26", endDate: "2026-11-15" }, userLines: [], style: [] });
    expect(host.textContent).toContain("바로 모집도 시작할까요? 전체 공개 방 목록에 보이고 누구나 바로 참가할 수 있어요");
    await click(radio(host, "네, 바로 모집 시작"));
    expect(q(host, '[role="tab"][aria-selected="true"]')!.textContent).toBe("직접 입력");
    expect(q(host, 'section[aria-label="회차 초안"] summary')!.textContent).toBe("회차 초안 3개 · 과제 6개 · 시험 3개");
    expect(recruitBox(host).checked).toBe(true);
    expect(submitBtn(host).textContent).toBe("방 만들기 · 회차 3개 · 바로 모집");
  });
  it("모집 아니요 → 체크 꺼진 채 · 라벨 '… 함께'", async () => {
    const host = await throughInterview("no");
    expect(recruitBox(host).checked).toBe(false);
    expect(submitBtn(host).textContent).toBe("방 만들기 · 회차 3개 함께");
  });
  it("회차 아니요 → 모집은 묻지 않고 미리보기 · 섹션 없음 · 모집 체크 비활성 + 힌트", async () => {
    const host = await mount();
    await click(radio(host, "아니요, 미리보기로"));
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/rooms/rounds")).toBe(false);
    expect(q(host, 'section[aria-label="회차 초안"]')).toBeNull();
    const box = recruitBox(host);
    expect([box.disabled, box.checked]).toEqual([true, false]);
    expect(document.getElementById(box.getAttribute("aria-describedby")!)!.textContent).toContain("회차에 과제가 1개 이상 있어야");
    expect(submitBtn(host).textContent).toBe("방 만들기");
  });
  it("503 → alert [다시 시도][그냥 미리보기로] · 다시 시도는 같은 요청 · 모집 질문 없음", async () => {
    roundsReply = () => json(503, { error: "AI_UNAVAILABLE", message: "회차 초안은 지금 어려워요 · 방만 먼저 만들고 진행목표에서 채울 수 있어요" });
    const host = await mount();
    await click(radio(host, "네, 잡아 주세요"));
    const alert = q(host, '[role="alert"]')!;
    expect(alert.textContent).toContain("회차 초안은 지금 어려워요");
    expect([...alert.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["다시 시도", "그냥 미리보기로"]);
    await click(byText(alert, "다시 시도"));
    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/rooms/rounds")).toHaveLength(2);
    await click(byText(q(host, '[role="alert"]')!, "그냥 미리보기로"));
    expect(q(host, 'input[name="title"]')).not.toBeNull();
    expect(q(host, 'section[aria-label="회차 초안"]')).toBeNull();
  });
  it("429 window rounds → 다시 시도 없음", async () => {
    roundsReply = () => json(429, { error: "RATE_LIMITED", message: "오늘은 회차 초안을 더 만들 수 없어요", details: { window: "rounds", retryAfterSec: 3600 } });
    const host = await mount();
    await click(radio(host, "네, 잡아 주세요"));
    expect([...q(host, '[role="alert"]')!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["그냥 미리보기로"]);
  });
});

describe("미리보기 섹션(D30) · 기간 수정 무효화", () => {
  it("회차 체크 해제 → 요약·라벨 변화 · 안내 · 전부 빼면 방만 + 모집 비활성", async () => {
    const host = await throughInterview();
    await click(roundBoxes(host)[1]);
    expect(q(host, 'section[aria-label="회차 초안"] summary')!.textContent).toBe("회차 초안 2개 · 과제 4개 · 시험 2개");
    expect(host.textContent).toContain("뺀 회차 자리는 비워 둬요");
    expect(submitBtn(host).textContent).toBe("방 만들기 · 회차 2개 · 바로 모집");
    await click(roundBoxes(host)[0]);
    await click(roundBoxes(host)[2]);
    expect(host.textContent).toContain("회차 없이 방만 만들어요");
    expect(submitBtn(host).textContent).toBe("방 만들기");
    expect(recruitBox(host).disabled).toBe(true);
  });
  it("종료일을 바꾸면 stale 안내 · 라벨 '방 만들기' · 모집 비활성 → [다시 생성] → 새 초안·체크 복귀", async () => {
    const host = await throughInterview();
    const end = q<HTMLInputElement>(host, 'input[name="endDate"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(end, "2026-11-22");
      end.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("기간이 바뀌어 회차 초안을 다시 잡아야 해요");
    expect(submitBtn(host).textContent).toBe("방 만들기");
    expect(recruitBox(host).disabled).toBe(true);
    roundsReply = () => json(200, roundsRes(4));
    await click(byText(host, "다시 생성"));
    expect(JSON.parse(fetchMock.mock.calls.filter((c) => c[0] === "/api/rooms/rounds")[1][1].body as string).draft.endDate).toBe("2026-11-22");
    expect(host.textContent).not.toContain("기간이 바뀌어");
    expect(submitBtn(host).textContent).toBe("방 만들기 · 회차 4개 · 바로 모집");
    expect(recruitBox(host).checked).toBe(true);
  });
  it("padded > 0 → '일부 회차는 기본 제목이에요' · 과제 0 시험 0 회차만이면 모집 비활성", async () => {
    roundsReply = () => json(200, roundsRes(2, { padded: 2, rounds: [view(0, [], false), view(1, [], false)] }));
    const host = await throughInterview();
    expect(host.textContent).toContain("일부 회차는 기본 제목이에요");
    expect(recruitBox(host).disabled).toBe(true);
    expect(submitBtn(host).textContent).toBe("방 만들기 · 회차 2개 함께");
  });
});

describe("[방 만들기] — room_create 뒤 회차 적용 → 모집 시작(D21·D22·D35)", () => {
  const names = () => rpcMock.mock.calls.map((c) => c[0]);
  it("순서: room_create → preview(포함 회차만) → apply → room_open_recruit → 편집 화면", async () => {
    const host = await throughInterview();
    await click(roundBoxes(host)[0]);
    await act(async () => submitBtn(host).click());
    expect(names()).toEqual(["room_create", "curriculum_plan_preview", "curriculum_plan_apply", "room_open_recruit"]);
    expect(rpcMock.mock.calls[1][1].p_plan.ops.map((o: { title: string }) => o.title)).toEqual(["범위 2", "범위 3"]);
    expect(push).toHaveBeenCalledWith("/my-study/aws-saa?tab=curriculum&mode=edit");
  });
  it("모집 끔 → room_open_recruit 미호출", async () => {
    const host = await throughInterview("no");
    await act(async () => submitBtn(host).click());
    expect(names()).toEqual(["room_create", "curriculum_plan_preview", "curriculum_plan_apply"]);
  });
  it("preview 실패 → 모집 시도 안 함 · note=rounds-skipped 로 이동", async () => {
    rpcMock.mockImplementation(async (name: string) => (name === "room_create" ? { slug: "aws-saa" } : { ok: false, errors: [{ code: "X" }] }));
    const host = await throughInterview();
    await act(async () => submitBtn(host).click());
    expect(names()).toEqual(["room_create", "curriculum_plan_preview"]);
    expect(push).toHaveBeenCalledWith("/my-study/aws-saa?tab=curriculum&mode=edit&note=rounds-skipped");
  });
  it("모집 실패 → note=recruit-skipped", async () => {
    const base = rpcMock.getMockImplementation()!;
    rpcMock.mockImplementation(async (name: string, ...rest: unknown[]) => {
      if (name === "room_open_recruit") throw new Error("ROOM_NO_LEAF_TASK");
      return base(name, ...rest);
    });
    const host = await throughInterview();
    await act(async () => submitBtn(host).click());
    expect(push).toHaveBeenCalledWith("/my-study/aws-saa?tab=curriculum&mode=edit&note=recruit-skipped");
  });
  it("회차 없이(직접 입력만) → room_create 만", async () => {
    const host = await mount();
    await click(radio(host, "아니요, 미리보기로"));
    await act(async () => submitBtn(host).click());
    expect(names()).toEqual(["room_create"]);
    expect(push).toHaveBeenCalledWith("/my-study/aws-saa?tab=curriculum&mode=edit");
  });
});
