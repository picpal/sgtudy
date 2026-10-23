// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

/* 방 만들기 화면 — 세그먼트·값 유지·인터뷰 흐름·대체 경로 (스펙 D12·D13·§9·§10). fetch 는 목 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: () => {}, refresh: () => {} }), usePathname: () => "/rooms/new" }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/ui/markdown-editor", () => ({ MarkdownEditor: ({ value }: { value: string }) => createElement("textarea", { "data-md": "", defaultValue: value }) }));
vi.mock("@/lib/today", () => ({ useToday: () => "2026-10-23" }));
vi.mock("./tags", async (orig) => ({ ...(await orig<typeof import("./tags")>()), searchTags: () => Promise.resolve([]) }));

const { NewRoomScreen } = await import("./NewRoomScreen");

const turn = (o: object = {}) => ({ say: "어떤 공부를 함께 하고 싶어요?", patch: {}, draft: {}, ask: { field: "title", kind: "text" }, missing: ["title", "intro", "startDate", "endDate", "maxMembers", "isPublic"], dropped: [], done: false, turn: 1, turnsLeft: 12, ...o });
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => json(200, turn()));
  vi.stubGlobal("fetch", fetchMock);
  push.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function mount(aiEnabled: boolean, initialMode: "manual" | "ai" = "manual") {
  const host = document.body.appendChild(document.createElement("div"));
  await act(async () => createRoot(host).render(createElement(NewRoomScreen, { aiEnabled, initialMode })));
  await act(async () => {});
  return host;
}
const q = <T extends Element = HTMLElement>(host: Element, sel: string) => host.querySelector<T & HTMLElement>(sel);
const byText = (host: Element, text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const typeInto = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

describe("세그먼트 (D12)", () => {
  it("aiEnabled=false → tablist 없이 지금 폼 그대로 · 인터뷰 요청 없음", async () => {
    const host = await mount(false, "ai");
    expect(q(host, '[role="tablist"]')).toBeNull();
    expect(q(host, 'input[name="title"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("aiEnabled=true → 탭 2개(기본 직접 입력), ←/→ 로 전환", async () => {
    const host = await mount(true);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => [t.textContent, t.getAttribute("aria-selected")])).toEqual([["직접 입력", "true"], ["AI 인터뷰", "false"]]);
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(q(host, '[role="log"]')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("인터뷰 흐름", () => {
  it("첫 렌더 = 빈 대화로 첫 질문 · 대화는 role=log aria-live · 안내 문구", async () => {
    const host = await mount(true, "ai");
    expect(bodyOf(0)).toEqual({ draft: {}, messages: [], answer: null });
    const log = q(host, '[role="log"]')!;
    expect([log.getAttribute("aria-live"), log.getAttribute("aria-relevant")]).toEqual(["polite", "additions"]);
    expect(log.textContent).toContain("어떤 공부를 함께 하고 싶어요?");
    expect(host.textContent).toContain("대화는 저장되지 않고 AI 응답 생성에만 쓰여요");
  });
  it("자유 글 → 사용자 말풍선 + 요청 · 칩 클릭 → answer 와 함께", async () => {
    const host = await mount(true, "ai");
    fetchMock.mockImplementationOnce(() => json(200, turn({ say: "언제 시작할까요?", draft: { title: "AWS", intro: "소개" }, ask: { field: "startDate", kind: "single", options: [{ label: "다음 주 월요일 (10/26)", value: "2026-10-26" }], allowOther: "date" }, missing: ["startDate", "endDate", "maxMembers", "isPublic"] })));
    const input = q<HTMLInputElement>(host, "#interview-input")!;
    await act(async () => typeInto(input, "aws saa"));
    await act(async () => byText(host, "보내기")!.click());
    expect(bodyOf(1).messages).toEqual([{ role: "assistant", text: "어떤 공부를 함께 하고 싶어요?" }, { role: "user", text: "aws saa" }]);
    expect(q(host, '[role="log"]')!.textContent).toContain("aws saa");
    // 초안 카드가 갱신된다
    expect(q(host, "aside")!.textContent).toContain("AWS");
    await act(async () => q<HTMLButtonElement>(host, '[role="radio"]')!.click());
    expect(bodyOf(2).answer).toEqual({ field: "startDate", value: "2026-10-26" });
    expect(bodyOf(2).draft).toMatchObject({ title: "AWS", intro: "소개" });
  });
  it("503 → 오류 말풍선(role=alert) + [다시 시도]·[직접 입력으로 이어서] — 다시 시도는 같은 요청", async () => {
    fetchMock.mockImplementationOnce(() => json(503, { error: "AI_UNAVAILABLE", message: "지금은 AI 응답이 어려워요 · 직접 입력으로 이어서 할 수 있어요" }));
    const host = await mount(true, "ai");
    const alert = q(host, '[role="alert"]')!;
    expect(alert.textContent).toContain("지금은 AI 응답이 어려워요");
    expect([...alert.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["다시 시도", "직접 입력으로 이어서"]);
    await act(async () => byText(alert, "다시 시도")!.click());
    expect(bodyOf(1)).toEqual(bodyOf(0));
    expect(q(host, '[role="alert"]')).toBeNull();
  });
  it("429 RATE_LIMITED → 카운트다운 버튼", async () => {
    fetchMock.mockImplementationOnce(() => json(429, { error: "RATE_LIMITED", message: "AI 인터뷰를 너무 빨리 쓰고 있어요", details: { retryAfterSec: 30, window: "tenMin" } }));
    const host = await mount(true, "ai");
    expect(byText(q(host, '[role="alert"]')!, "30초 뒤 다시 시도")?.disabled).toBe(true);
  });
  it("429 AI_BUDGET_EXCEEDED → 세그먼트 숨김 + 직접 입력 + 안내", async () => {
    fetchMock.mockImplementationOnce(() => json(429, { error: "AI_BUDGET_EXCEEDED", message: "오늘은 AI 인터뷰를 더 쓸 수 없어요 · 직접 입력으로 만들어 주세요" }));
    const host = await mount(true, "ai");
    expect(q(host, '[role="tablist"]')).toBeNull();
    expect(q(host, 'input[name="title"]')).not.toBeNull();
    expect(q(host, '[role="status"]')!.textContent).toContain("오늘은 AI 인터뷰를 더 쓸 수 없어요");
  });
  it("401 → 로그인으로(돌아올 곳 = ?mode=ai)", async () => {
    fetchMock.mockImplementationOnce(() => json(401, { error: "AUTH_REQUIRED", message: "로그인이 필요해요" }));
    await mount(true, "ai");
    expect(push.mock.calls[0][0]).toContain(encodeURIComponent("/rooms/new?mode=ai"));
  });
  it("done → [미리보기로] → 직접 입력 모드 · 폼에 값 · banner · 더 설정하기 펼침 · 방은 만들지 않음", async () => {
    const draft = { title: "AWS SAA", intro: "소개", startDate: "2026-10-26", endDate: "2027-01-17", maxMembers: 6, minMembers: 4, isPublic: true, joinMode: "approval", rulesMd: "- 규칙", tags: [{ slug: "aws", label: "AWS", tone: "mint" }] };
    fetchMock.mockImplementationOnce(() => json(200, turn({ say: "정리했어요.", draft, ask: null, missing: [], done: true })));
    const host = await mount(true, "ai");
    await act(async () => byText(host, "미리보기로")!.click());
    expect(q(host, '[role="tab"][aria-selected="true"]')!.textContent).toBe("직접 입력");
    expect(q<HTMLInputElement>(host, 'input[name="title"]')!.value).toBe("AWS SAA");
    expect(q<HTMLInputElement>(host, 'input[name="maxMembers"]')!.value).toBe("6");
    expect(q<HTMLInputElement>(host, 'input[name="minMembers"]')!.value).toBe("4");
    expect(q(host, '[role="radio"][aria-checked="true"]')!.textContent).toContain("승인");
    expect(q(host, '[aria-label="고른 태그"]')!.textContent).toContain("AWS");
    expect(q(host, '[role="status"]')!.textContent).toBe("AI 인터뷰로 채운 초안이에요 · 확인하고 만들어 주세요");
    expect(byText(host, "접기")).toBeDefined();
    expect(fetchMock.mock.calls.every((c) => c[0] === "/api/rooms/interview")).toBe(true);
  });
});

describe("값 유지 (D13)", () => {
  it("직접 입력에서 쓴 제목은 인터뷰 초안으로 가고(채운 칸만), 인터뷰 값은 돌아와도 남는다 · 대화도 유지", async () => {
    const host = await mount(true);
    await act(async () => typeInto(q<HTMLInputElement>(host, 'input[name="title"]')!, "토익 900"));
    fetchMock.mockImplementationOnce(() => json(200, turn({ say: "언제 시작할까요?", draft: { title: "토익 900", maxMembers: 10 } })));
    await act(async () => byText(host, "AI 인터뷰")!.click());
    expect(bodyOf(0).draft).toEqual({ title: "토익 900" }); // 기본값(6명·공개)은 보내지 않는다
    await act(async () => byText(host, "직접 입력")!.click());
    expect(q<HTMLInputElement>(host, 'input[name="title"]')!.value).toBe("토익 900");
    expect(q<HTMLInputElement>(host, 'input[name="maxMembers"]')!.value).toBe("10");
    await act(async () => byText(host, "AI 인터뷰")!.click());
    expect(q(host, '[role="log"]')!.textContent).toContain("언제 시작할까요?");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 다시 들어와도 첫 질문을 또 받지 않는다
  });
});
