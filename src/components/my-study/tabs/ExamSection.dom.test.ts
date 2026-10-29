// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiException } from "@/lib/api/errors";
import type { ExamAttempt, ExamQuestion, ExamView, ExamViewerReason } from "@/lib/api/types";
import { MeProvider } from "@/lib/me";
import { EMPTY_OVERRIDES, buildTree, type LeafNode } from "../model";
import { AWS, REF_DAY } from "../fixtures";
import { SubmitSlotProvider } from "../submitSlot";
import { ExamSection } from "./ExamSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn(), submit: vi.fn(), task: vi.fn(), results: vi.fn() }));
vi.mock("@/lib/api/exam", async (orig) => ({ ...(await orig<typeof import("@/lib/api/exam")>()), fetchExam: m.fetch, saveExamAnswer: m.save, submitExam: m.submit, fetchExamResults: m.results }));
vi.mock("@/lib/api/submission", async (orig) => ({ ...(await orig<object>()), fetchTask: m.task }));

const BASE: ExamQuestion[] = [
  { id: "1", ord: 0, type: "single", prompt: "IAM 정책 평가 순서로 옳은 것은?", choices: ["명시적 Deny → Allow → 암묵 Deny", "Allow → Deny"], points: 1 },
  { id: "2", ord: 1, type: "multi", prompt: "VPC 구성 요소를 모두 고르세요", choices: ["서브넷", "IGW", "S3"], points: 2 },
  { id: "3", ord: 2, type: "ox", prompt: "S3 는 리전 서비스다.", choices: null, points: 1 },
  { id: "4", ord: 3, type: "short", prompt: "VPC 를 인터넷에 잇는 것은?", choices: null, points: 1 },
];
const KEYS: Record<string, { answer: unknown; explanation: string }> = {
  "1": { answer: 0, explanation: "명시적 Deny 가 이긴다" },
  "2": { answer: [0, 1], explanation: "S3 는 VPC 밖" },
  "3": { answer: true, explanation: "" },
  "4": { answer: ["인터넷 게이트웨이", "IGW"], explanation: "IGW" },
};
const revealed = BASE.map((q) => ({ ...q, ...KEYS[q.id] }));

type O = { reason?: ExamViewerReason | null; canTake?: boolean; questions?: ExamQuestion[] | null; attempt?: ExamAttempt | null; reveal?: "after_submit" | "after_deadline"; closed?: boolean };
const view = (o: O = {}): ExamView => ({
  today: "2026-10-16",
  node: { id: "311", title: "ALB vs NLB 실습", startDate: "2026-10-15", endDate: "2026-10-21", archived: false },
  exam: { status: "published", questionCount: 4, totalPoints: 5, reveal: o.reveal ?? "after_submit", publishedAt: "2026-10-14T00:00:00Z", closed: o.closed ?? false },
  viewer: { canEdit: false, isAssignee: true, canTake: o.canTake ?? o.reason == null, reason: o.reason ?? null },
  questions: o.questions === undefined ? BASE : o.questions,
  attempt: o.attempt ?? null,
});
const submitted = (results: ExamAttempt["results"]): ExamAttempt => ({
  status: "submitted",
  answers: { "1": 0, "2": [0, 2], "3": true, "4": "igw" },
  score: 4,
  maxScore: 5,
  correctCount: 3,
  submittedAt: "2026-10-18T12:03:00Z",
  isLate: false,
  results,
});
const RESULTS = { "1": { correct: true, earned: 1 }, "2": { correct: false, earned: 0 }, "3": { correct: true, earned: 1 }, "4": { correct: true, earned: 1 } };

const leaf = { ...buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).leaves.find((l) => l.title === "ALB vs NLB 실습")!, exam: { status: "published", questionCount: 4, totalPoints: 5, reveal: "after_submit" } } as LeafNode;

let root: Root | null = null;
let host: HTMLElement;
const toast = vi.fn();
const onSubmitted = vi.fn();
const onUnsaved = vi.fn();

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const mount = async (v: ExamView, quiet = false) => {
  m.fetch.mockResolvedValue(v);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const body = createElement(ExamSection, { n: leaf, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted, toast, viewerPending: false, quietNotAssigned: quiet, onUnsavedChange: onUnsaved });
  act(() => root!.render(createElement(MeProvider, { me: null } as Parameters<typeof MeProvider>[0], body)));
  await flush();
};
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
const typeInto = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tickSave = async () => {
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  await flush();
};
const bar = () => host.querySelector(".sticky.bottom-0")!.textContent ?? "";

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  vi.useFakeTimers();
  for (const f of Object.values(m)) f.mockReset();
  m.task.mockReturnValue(new Promise(() => {}));
  toast.mockReset();
  onSubmitted.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

describe("ExamSection — 상태 안내", () => {
  it.each([
    ["not_published", "아직 발행되지 않은 시험이에요"],
    ["not_started", "10.15 부터 풀 수 있어요"],
    ["archived", "보관된 시험이에요"],
    ["room_not_active", "스터디가 진행 중일 때 풀 수 있어요"],
    ["not_assignee", "담당 과제가 아니에요"],
    ["answers_seen", "정답·해설을 이미 본 시험은 응시할 수 없어요"],
  ] as const)("%s → 안내만, 문항·제출 없음", async (reason, text) => {
    await mount(view({ reason, questions: reason === "not_started" || reason === "not_published" ? null : BASE }));
    expect(host.querySelector("[role=note]")?.textContent).toContain(text);
    expect(host.querySelector("input")).toBeNull();
    expect(button("제출하기")).toBeUndefined();
    expect(host.textContent).toContain("제출 현황");
  });
  it("그룹장(담당 아님 문구 숨김) → 안내 없음", async () => {
    await mount(view({ reason: "not_assignee", questions: null }), true);
    expect(host.querySelector("[role=note]")).toBeNull();
  });
  it("closed(마감 뒤 정답 공개) → 안내 + 정답·해설, 제출 없음", async () => {
    await mount(view({ reason: "closed", reveal: "after_deadline", closed: true, questions: revealed }));
    expect(host.querySelector("[role=note]")?.textContent).toContain("마감이 지나 해설이 공개된 시험은 제출할 수 없어요");
    expect(button("제출하기")).toBeUndefined();
    expect(host.querySelectorAll("details").length).toBe(3);
    expect(host.textContent).toContain("인터넷 게이트웨이 / IGW");
    expect(host.textContent).toContain("답하지 않았어요");
  });
  it("불러오기 실패 → 다시 시도", async () => {
    m.fetch.mockRejectedValue(new ApiException({ code: "UNKNOWN", message: "x" }));
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() => root!.render(createElement(MeProvider, { me: null } as Parameters<typeof MeProvider>[0], createElement(ExamSection, { n: leaf, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted, toast, viewerPending: false }))));
    await flush();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("시험을 불러오지 못했어요");
    m.fetch.mockResolvedValue(view());
    act(() => button("다시 시도")!.click());
    await flush();
    expect(host.querySelectorAll("input[type=radio]").length).toBe(2);
  });
});

describe("ExamSection — 응시", () => {
  it("4유형 입력 · 정답 키가 와도(편집자 겸 담당자) 응시 화면엔 정답·해설이 없다", async () => {
    await mount(view({ questions: revealed }));
    expect(host.querySelectorAll("input[type=radio]").length).toBe(2);
    expect(host.querySelectorAll("input[type=checkbox]").length).toBe(3);
    const ox = Array.from(host.querySelectorAll("button[aria-pressed]"));
    expect(ox.map((b) => b.textContent)).toEqual(["O", "X"]);
    expect(ox.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    const short = host.querySelector<HTMLInputElement>("input[type=text]")!;
    expect(short.maxLength).toBe(200);
    expect(host.querySelector("details")).toBeNull();
    expect(host.textContent).not.toContain("명시적 Deny 가 이긴다");
    expect(bar()).toContain("0/4 답함");
    expect(button("제출하기")?.className).toContain("h-11");
  });
  it("저장된 답을 복원하고 n/총 은 서버 규칙(빈 칸·빈 배열은 답 아님)", async () => {
    await mount(view({ attempt: { status: "in_progress", answers: { "1": 1, "2": [], "4": "" }, score: null, maxScore: null, correctCount: null, submittedAt: null, isLate: null, results: null } }));
    expect(host.querySelectorAll<HTMLInputElement>("input[type=radio]")[1].checked).toBe(true);
    expect(bar()).toContain("1/4 답함");
  });
  it("400ms 디바운스 저장 — 고른 값 그대로, 단답은 다듬지 않는다 · 저장 중… → 저장됨", async () => {
    m.save.mockResolvedValue({ savedAt: "x", answered: 2, total: 4 });
    await mount(view());
    act(() => host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[2].click());
    act(() => typeInto(host.querySelector<HTMLInputElement>("input[type=text]")!, "  IGW "));
    expect(bar()).toContain("저장 중…");
    expect(bar()).toContain("2/4 답함");
    await act(async () => {
      vi.advanceTimersByTime(399);
    });
    expect(m.save).not.toHaveBeenCalled();
    await tickSave();
    expect(m.save.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["2", [2]],
      ["4", "  IGW "],
    ]);
    expect(bar()).toContain("저장됨");
    expect(m.fetch).toHaveBeenCalledTimes(1);
  });
  it("O/X 는 aria-pressed 로 고른다", async () => {
    m.save.mockResolvedValue({ savedAt: "x", answered: 1, total: 4 });
    await mount(view());
    act(() => button("X")!.click());
    expect(button("X")!.getAttribute("aria-pressed")).toBe("true");
    await tickSave();
    expect(m.save).toHaveBeenCalledWith("311", "3", false);
  });
  it("서버 answered 가 화면 수와 다르면 다시 받는다", async () => {
    m.save.mockResolvedValue({ savedAt: "x", answered: 3, total: 4 });
    await mount(view());
    act(() => host.querySelectorAll<HTMLInputElement>("input[type=radio]")[0].click());
    await tickSave();
    expect(m.fetch).toHaveBeenCalledTimes(2);
  });
  it("저장 실패 → 토스트 · 저장 실패 [다시 시도] · 나가기 확인 신호", async () => {
    m.save.mockRejectedValueOnce(new ApiException({ code: "UNKNOWN", message: "fetch failed" }));
    await mount(view());
    act(() => host.querySelectorAll<HTMLInputElement>("input[type=radio]")[0].click());
    await tickSave();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ tone: "bad" }));
    expect(bar()).toContain("저장 실패");
    expect(onUnsaved).toHaveBeenLastCalledWith(true);
    m.save.mockResolvedValue({ savedAt: "x", answered: 1, total: 4 });
    act(() => button("다시 시도")!.click());
    await flush();
    expect(m.save).toHaveBeenCalledTimes(2);
    expect(m.save).toHaveBeenLastCalledWith("311", "1", 0);
    expect(bar()).toContain("저장됨");
    expect(onUnsaved).toHaveBeenLastCalledWith(false);
  });
  it("EXAM_CLOSED 저장 실패 → 서버 문구 토스트 + 다시 불러오기", async () => {
    m.save.mockRejectedValue(new ApiException({ code: "EXAM_CLOSED", message: "마감이 지나 해설이 공개된 시험은 제출할 수 없어요" }));
    await mount(view());
    m.fetch.mockResolvedValue(view({ reason: "closed", closed: true, reveal: "after_deadline", questions: revealed }));
    act(() => host.querySelectorAll<HTMLInputElement>("input[type=radio]")[0].click());
    await tickSave();
    expect(toast).toHaveBeenCalledWith({ text: "마감이 지나 해설이 공개된 시험은 제출할 수 없어요", tone: "bad" });
    expect(m.fetch).toHaveBeenCalledTimes(2);
    expect(button("제출하기")).toBeUndefined();
  });
  it("나가면(언마운트) 기다리던 답을 바로 보낸다", async () => {
    m.save.mockResolvedValue({ savedAt: "x", answered: 1, total: 4 });
    await mount(view());
    act(() => host.querySelectorAll<HTMLInputElement>("input[type=radio]")[1].click());
    act(() => root!.unmount());
    root = null;
    expect(m.save).toHaveBeenCalledWith("311", "1", 1);
  });
  it("미답 2 → 확인 문구 · 제출은 한 번만 · 결과로 바뀌고 onSubmitted", async () => {
    m.save.mockResolvedValue({ savedAt: "x", answered: 2, total: 4 });
    await mount(view());
    act(() => host.querySelectorAll<HTMLInputElement>("input[type=radio]")[0].click());
    act(() => button("O")!.click());
    act(() => button("제출하기")!.click());
    expect(host.querySelector("[role=alertdialog]")?.textContent).toContain("답하지 않은 2문항이 있어요 · 제출하면 다시 풀 수 없어요");
    let done!: (v: ExamView) => void;
    m.submit.mockReturnValue(new Promise<ExamView>((r) => (done = r)));
    act(() => button("제출")!.click());
    await flush();
    // 남은 답을 먼저 저장한 뒤 제출
    expect(m.save).toHaveBeenCalledTimes(2);
    act(() => button("제출 중…")?.click());
    expect(m.submit).toHaveBeenCalledTimes(1);
    await act(async () => done(view({ reason: "submitted", canTake: false, questions: revealed, attempt: submitted(RESULTS) })));
    await flush();
    expect(m.submit).toHaveBeenCalledTimes(1);
    expect(onSubmitted).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("4/5점 (80%) · 3/4 문항 정답");
  });
  it("제출 실패 EXAM_ALREADY_SUBMITTED → 토스트 + 다시 불러오기, onSubmitted 없음", async () => {
    m.submit.mockRejectedValue(new ApiException({ code: "EXAM_ALREADY_SUBMITTED", message: "이미 제출한 시험이에요" }));
    await mount(view());
    act(() => button("제출하기")!.click());
    expect(host.querySelector("[role=alertdialog]")?.textContent).toContain("답하지 않은 4문항이 있어요");
    await act(async () => button("제출")!.click());
    await flush();
    expect(toast).toHaveBeenCalledWith({ text: "이미 제출한 시험이에요", tone: "bad" });
    expect(m.fetch).toHaveBeenCalledTimes(2);
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});

const held = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};
const radio = (k: number) => host.querySelectorAll<HTMLInputElement>("input[type=radio]")[k];

describe("ExamSection — 저장 순서(Fix round 1)", () => {
  it("하단 막대에 가리지 않게 — 포커스가 가는 모든 입력에 scroll-mb-20", async () => {
    await mount(view());
    const focusables = Array.from(host.querySelectorAll<HTMLElement>("li[data-qi] input, li[data-qi] button"));
    expect(focusables.length).toBe(2 + 3 + 2 + 1);
    for (const el of focusables) expect(el.className).toContain("scroll-mb-20");
  });
  it("나가기: 보내던 같은 문항 저장이 끝난 뒤에 새 답을 보낸다(옛 답이 나중에 닿지 않게)", async () => {
    const a = held<unknown>();
    m.save.mockReturnValueOnce(a.promise).mockResolvedValue({ savedAt: "x", answered: 1, total: 4 });
    await mount(view());
    act(() => radio(0).click());
    await tickSave();
    expect(m.save).toHaveBeenCalledTimes(1);
    act(() => radio(1).click());
    act(() => root!.unmount());
    root = null;
    await flush();
    expect(m.save).toHaveBeenCalledTimes(1);
    a.resolve({ savedAt: "x", answered: 1, total: 4 });
    await flush();
    expect(m.save.mock.calls.map((c) => c[2])).toEqual([0, 1]);
  });
  it("나가기: 보내던 저장이 나간 뒤 실패하면 그 답을 한 번 더 보낸다", async () => {
    const a = held<unknown>();
    m.save.mockReturnValueOnce(a.promise).mockResolvedValue({ savedAt: "x", answered: 1, total: 4 });
    await mount(view());
    act(() => radio(1).click());
    await tickSave();
    act(() => root!.unmount());
    root = null;
    a.reject(new ApiException({ code: "UNKNOWN", message: "fetch failed" }));
    await flush();
    expect(m.save.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["1", 1],
      ["1", 1],
    ]);
  });
  it("재조회가 보내는 중인 답을 되돌리지 않는다", async () => {
    m.save.mockResolvedValueOnce({ savedAt: "x", answered: 3, total: 4 }); // 화면 1 ≠ 서버 3 → 재조회
    const f = held<ExamView>();
    await mount(view());
    m.fetch.mockReturnValueOnce(f.promise);
    act(() => radio(0).click());
    await tickSave();
    expect(m.fetch).toHaveBeenCalledTimes(2);
    const s2 = held<unknown>();
    m.save.mockReturnValueOnce(s2.promise);
    act(() => host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].click());
    await tickSave();
    expect(m.save).toHaveBeenLastCalledWith("311", "2", [1]);
    // 서버는 아직 2번 답을 모른다
    await act(async () => f.resolve(view({ attempt: { status: "in_progress", answers: { "1": 0, "3": true, "4": "x" }, score: null, maxScore: null, correctCount: null, submittedAt: null, isLate: null, results: null } })));
    await flush();
    expect(host.querySelectorAll<HTMLInputElement>("input[type=checkbox]")[1].checked).toBe(true);
    expect(bar()).toContain("4/4 답함");
    s2.resolve({ savedAt: "x", answered: 4, total: 4 });
    await flush();
  });
  it("제출은 마지막으로 고른 답을 먼저 저장하고, 제출 전에 떠난 재조회 응답은 결과를 되돌리지 않는다", async () => {
    m.save.mockResolvedValue({ savedAt: "x", answered: 3, total: 4 }); // 어긋남 → 재조회
    await mount(view());
    const f = held<ExamView>();
    m.fetch.mockReturnValueOnce(f.promise);
    act(() => radio(0).click());
    act(() => radio(1).click());
    m.submit.mockResolvedValue(view({ reason: "submitted", canTake: false, questions: revealed, attempt: submitted(RESULTS) }));
    act(() => button("제출하기")!.click());
    await act(async () => button("제출")!.click());
    await flush();
    expect(m.save.mock.calls.map((c) => [c[1], c[2]])).toEqual([["1", 1]]);
    expect(m.save.mock.invocationCallOrder[0]).toBeLessThan(m.submit.mock.invocationCallOrder[0]);
    expect(host.textContent).toContain("4/5점 (80%)");
    await act(async () => f.resolve(view()));
    await flush();
    expect(host.textContent).toContain("4/5점 (80%)");
    expect(button("제출하기")).toBeUndefined();
  });
  it("VALIDATION_FAILED 는 다시 보내지 않고 서버 것을 다시 받는다", async () => {
    m.save.mockRejectedValue(new ApiException({ code: "VALIDATION_FAILED", message: "답 모양이 문항 유형과 맞지 않아요", details: { field: "answer" } }));
    await mount(view());
    act(() => radio(0).click());
    await tickSave();
    expect(toast).toHaveBeenCalledWith({ text: "답 모양이 문항 유형과 맞지 않아요", tone: "bad" });
    expect(m.fetch).toHaveBeenCalledTimes(2);
    expect(bar()).not.toContain("저장 실패");
    expect(button("다시 시도")).toBeUndefined();
  });
});

describe("ExamSection — 결과", () => {
  it("공개(after_submit) → 점수 카드 · 정오 · 내 답/정답 · 해설 <details>", async () => {
    await mount(view({ reason: "submitted", canTake: false, questions: revealed, attempt: submitted(RESULTS) }));
    expect(host.querySelector("h3")?.textContent).toContain("4/5점 (80%) · 3/4 문항 정답");
    expect(host.textContent).toContain("제출 · 기한 내");
    expect(host.textContent).toContain("✓ 정답");
    expect(host.textContent).toContain("✗ 오답");
    expect(host.textContent).toContain("(0/2점)");
    expect(host.querySelectorAll("details").length).toBe(3);
    expect(host.querySelector("details summary")?.textContent).toBe("해설");
    expect(host.textContent).toContain("내 답");
    expect(host.textContent).toContain("인터넷 게이트웨이 / IGW");
    expect(host.querySelector("input")).toBeNull();
    expect(button("제출하기")).toBeUndefined();
  });
  it("after_deadline 마감 전 → 점수만 + 'MM.DD 마감 뒤에 열려요', 해설·정오 없음", async () => {
    await mount(view({ reason: "submitted", canTake: false, reveal: "after_deadline", attempt: submitted(null) }));
    expect(host.textContent).toContain("4/5점 (80%)");
    expect(host.textContent).not.toContain("문항 정답");
    expect(host.textContent).toContain("정답·해설은 10.21 마감 뒤에 열려요");
    expect(host.querySelector("details")).toBeNull();
    expect(host.textContent).not.toContain("✓ 정답");
    expect(host.textContent).not.toContain("IAM 정책 평가 순서로");
  });
});

describe("ExamSection — 구역(시험 응시 카드 · 제출 현황)", () => {
  const panel = () => host.querySelector<HTMLElement>("section[data-submit-panel]");
  it("응시 가능 → '시험 응시' 카드(h2, aria-labelledby) 안에 문항·제출 막대, 제출 현황은 카드 밖", async () => {
    await mount(view());
    const p = panel()!;
    expect(p.getAttribute("aria-labelledby")).toBe("my-exam-title");
    expect(p.querySelector("h2#my-exam-title")?.textContent).toBe("시험 응시");
    expect(p.textContent).toContain("응시 전 · D-5");
    expect(p.textContent).toContain("마감 10.21(수)");
    expect(p.querySelector('[aria-label="시험 문항"]')).not.toBeNull();
    const status = host.querySelector("#submissions")!;
    expect(p.contains(status)).toBe(false);
    expect(p.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("제출 뒤 결과 → 카드 배지 '기한내 제출', 결과 머리는 h3", async () => {
    await mount(view({ reason: "submitted", canTake: false, questions: revealed, attempt: submitted(RESULTS) }));
    expect(panel()!.textContent).toContain("기한내 제출");
    expect(panel()!.querySelector("h3")?.textContent).toContain("내 결과");
  });
  it("담당 아님 → 시험 응시 카드 없이 안내 한 줄", async () => {
    await mount(view({ reason: "not_assignee", questions: null }));
    expect(panel()).toBeNull();
    expect(host.querySelector("[role=note]")?.textContent).toContain("담당 과제가 아니에요");
  });
});

describe("ExamSection — 문항 이동", () => {
  const nav = () => host.querySelector<HTMLElement>('nav[aria-label="문항 이동"]')!;
  const cells = () => Array.from(nav().querySelectorAll("button"));
  it("번호 칸 — aria-label 답함/안 답함 · 지금 문항 aria-current · n/총 답함", async () => {
    await mount(view({ attempt: { status: "in_progress", answers: { "2": [1] }, score: null, maxScore: null, correctCount: null, submittedAt: null, isLate: null, results: null } }));
    expect(cells().map((b) => b.getAttribute("aria-label"))).toEqual(["1번 문항 · 안 답함", "2번 문항 · 답함", "3번 문항 · 안 답함", "4번 문항 · 안 답함"]);
    expect(cells()[0].getAttribute("aria-current")).toBe("step");
    expect(cells().filter((b) => b.hasAttribute("aria-current")).length).toBe(1);
    expect(nav().textContent).toContain("1/4 답함");
    expect(cells()[0].className).toContain("cursor-pointer");
  });
  it("답을 고르면 그 칸이 바로 '답함'", async () => {
    m.save.mockResolvedValue({ savedAt: "x", answered: 1, total: 4 });
    await mount(view());
    act(() => host.querySelectorAll<HTMLInputElement>("input[type=radio]")[0].click());
    expect(cells()[0].getAttribute("aria-label")).toBe("1번 문항 · 답함");
    expect(nav().textContent).toContain("1/4 답함");
    await tickSave();
  });
  it("칸을 누르면 그 문항으로 스크롤 + 머리에 포커스 + aria-current 이동 (동작 줄이기 → 바로)", async () => {
    await mount(view());
    const calls: [string | undefined, ScrollIntoViewOptions | boolean | undefined][] = [];
    Element.prototype.scrollIntoView = function (this: Element, o?: ScrollIntoViewOptions | boolean) {
      calls.push([(this as HTMLElement).dataset.qi, o]);
    };
    act(() => cells()[2].click());
    expect(calls).toEqual([["2", { behavior: "smooth", block: "start" }]]);
    expect(document.activeElement?.id).toBe("exam-q-3");
    expect(cells()[2].getAttribute("aria-current")).toBe("step");
    expect(cells()[0].hasAttribute("aria-current")).toBe(false);

    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") })) as unknown as typeof window.matchMedia;
    act(() => cells()[1].click());
    window.matchMedia = mm;
    expect(calls[1]).toEqual(["1", { behavior: "auto", block: "start" }]);
  });
  it("좁은 화면 하단 막대 [문항 이동] — 바텀 시트(body 포털·바탕 잠금)를 열고, 고르면 닫힌다", async () => {
    await mount(view());
    const toggle = button("문항 이동")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.focus();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const sheet = document.getElementById("exam-nav-sheet")!;
    expect(host.contains(sheet)).toBe(false);
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.querySelector("h2")?.textContent).toBe("문항 이동");
    // 답함 요약은 시트 머리 한 곳 — 번호 칸 nav 안에는 머리가 없다
    expect(sheet.textContent).toContain("0/4 답함");
    const grid = sheet.querySelector<HTMLElement>('nav[aria-label="문항 이동"]')!;
    expect(grid.textContent).not.toContain("답함");
    expect(document.body.style.overflow).toBe("hidden");
    // 열면 지금 문항 칸에 포커스
    expect(document.activeElement?.getAttribute("aria-current")).toBe("step");
    expect(grid.querySelector("button")!.className).toContain("h-11");
    act(() => grid.querySelectorAll("button")[3].click());
    expect(document.getElementById("exam-nav-sheet")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement?.id).toBe("exam-q-4");
  });
  it("바텀 시트 — 바탕을 누르거나 닫기·Esc 로 닫히고 [문항 이동] 으로 포커스가 돌아온다", async () => {
    await mount(view());
    const toggle = button("문항 이동")!;
    const open = () => {
      toggle.focus();
      act(() => toggle.click());
      return document.getElementById("exam-nav-sheet")!;
    };
    // 시트 안을 눌러도 닫히지 않는다
    const h2 = open().querySelector("h2")!;
    act(() => h2.click());
    expect(document.getElementById("exam-nav-sheet")).not.toBeNull();
    act(() => document.querySelector<HTMLElement>("[data-qnav-backdrop]")!.click());
    expect(document.getElementById("exam-nav-sheet")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);

    const x = open().querySelector<HTMLButtonElement>('button[aria-label="닫기"]')!;
    act(() => x.click());
    expect(document.getElementById("exam-nav-sheet")).toBeNull();
    expect(document.activeElement).toBe(toggle);

    open();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.getElementById("exam-nav-sheet")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(document.body.style.overflow).toBe("");
  });
  it("결과 화면에는 문항 이동이 없다", async () => {
    await mount(view({ reason: "submitted", canTake: false, questions: revealed, attempt: submitted(RESULTS) }));
    expect(host.querySelector('nav[aria-label="문항 이동"]')).toBeNull();
  });
});

describe("ExamSection — 본문 카드 아래 자리로", () => {
  it("시험 응시 카드는 자리로 포털, 제출 현황은 제자리 · 문항 이동도 자리 안에서 스크롤·포커스", async () => {
    m.fetch.mockResolvedValue(view());
    host = document.body.appendChild(document.createElement("div"));
    const slot = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const body = createElement(ExamSection, { n: leaf, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted, toast, viewerPending: false, onUnsavedChange: onUnsaved });
    act(() => root!.render(createElement(SubmitSlotProvider, { value: slot }, createElement(MeProvider, { me: null } as Parameters<typeof MeProvider>[0], body))));
    await flush();
    expect(host.querySelector("section[data-submit-panel]")).toBeNull();
    expect(host.querySelector("#submissions")).not.toBeNull();
    const card = slot.querySelector("section[data-submit-panel]")!;
    expect(card.querySelector("h2")?.textContent).toBe("시험 응시");
    act(() => card.querySelector<HTMLButtonElement>('nav[aria-label="문항 이동"] button[aria-label^="3번"]')!.click());
    expect(document.activeElement?.id).toBe("exam-q-3");
    act(() => root!.unmount());
    root = null;
    expect(slot.childElementCount).toBe(0);
    slot.remove();
  });
  // 편집자: 「시험 응시」 → 「시험 결과」 두 카드가 한 자리 안에서 이 순서로. 제출 현황은 본문 카드에 그대로
  const editor = (o: O = {}): ExamView => {
    const v = view(o);
    return { ...v, viewer: { ...v.viewer, canEdit: true } };
  };
  const mountIn = async (slot: HTMLElement | null | undefined, v: ExamView) => {
    m.fetch.mockResolvedValue(v);
    m.results.mockReturnValue(new Promise(() => {}));
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const body = createElement(MeProvider, { me: null } as Parameters<typeof MeProvider>[0], createElement(ExamSection, { n: leaf, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted, toast, viewerPending: false }));
    act(() => root!.render(slot === undefined ? body : createElement(SubmitSlotProvider, { value: slot }, body)));
    await flush();
  };
  const titles = (el: HTMLElement) => Array.from(el.querySelectorAll(":scope > section > div h2")).map((h) => h.textContent);

  it("편집자 · 응시 대상 → 자리 안 순서 「시험 응시」 → 「시험 결과」, 본문엔 제출 현황만", async () => {
    const slot = document.body.appendChild(document.createElement("div"));
    await mountIn(slot, editor());
    expect(titles(slot)).toEqual(["시험 응시", "시험 결과"]);
    expect(slot.children[1].hasAttribute("data-results-panel")).toBe(true);
    expect(slot.children[1].getAttribute("aria-labelledby")).toBe(`exam-results-${leaf.id}`);
    expect(host.querySelector("section[data-results-panel]")).toBeNull();
    expect(host.querySelector("#submissions")).not.toBeNull();
    act(() => root!.unmount());
    root = null;
    expect(slot.childElementCount).toBe(0);
    slot.remove();
  });
  it("편집자 · 응시 대상 아님 → 응시 카드 없이 「시험 결과」 혼자 자리에", async () => {
    const slot = document.body.appendChild(document.createElement("div"));
    await mountIn(slot, editor({ reason: "not_assignee", canTake: false, questions: null }));
    expect(titles(slot)).toEqual(["시험 결과"]);
    expect(host.querySelector("[role=note]")?.textContent).toContain("담당 과제가 아니에요");
    slot.remove();
  });
  it("편집자 · 제출 뒤 결과 → 「시험 응시」(내 결과) 다음 「시험 결과」", async () => {
    const slot = document.body.appendChild(document.createElement("div"));
    await mountIn(slot, editor({ reason: "submitted", canTake: false, questions: revealed, attempt: submitted(RESULTS) }));
    expect(titles(slot)).toEqual(["시험 응시", "시험 결과"]);
    expect(slot.children[0].querySelector("h3")?.textContent).toContain("내 결과");
    slot.remove();
  });
  it("자리가 아직 없으면(null) 두 카드 다 그리지 않는다", async () => {
    await mountIn(null, editor());
    expect(host.querySelector("section[data-submit-panel]")).toBeNull();
    expect(host.querySelector("section[data-results-panel]")).toBeNull();
    expect(host.querySelector("#submissions")).not.toBeNull();
  });
  it("자리를 여는 화면이 없으면 제자리에 — 그래도 「시험 응시」 → 「시험 결과」 순서", async () => {
    await mountIn(undefined, editor());
    const exam = host.querySelector("section[data-submit-panel]")!;
    const res = host.querySelector("section[data-results-panel]")!;
    expect(exam.compareDocumentPosition(res) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("멤버(canEdit false)는 결과 카드가 없다", async () => {
    const slot = document.body.appendChild(document.createElement("div"));
    await mountIn(slot, view());
    expect(titles(slot)).toEqual(["시험 응시"]);
    expect(m.results).not.toHaveBeenCalled();
    slot.remove();
  });
});
