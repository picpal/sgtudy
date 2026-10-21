// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiException } from "@/lib/api/errors";
import type { ExamQuestion, ExamResults as ExamResultsDto, ExamView } from "@/lib/api/types";
import { MeProvider } from "@/lib/me";
import { EMPTY_OVERRIDES, buildTree, type LeafNode } from "../model";
import { AWS, REF_DAY } from "../fixtures";
import { resultsHead, rateText, kstMd } from "../exam";
import { ExamResults } from "./ExamResults";
import { ExamSection } from "./ExamSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ fetch: vi.fn(), results: vi.fn(), attempt: vi.fn(), task: vi.fn() }));
vi.mock("@/lib/api/exam", async (orig) => ({ ...(await orig<typeof import("@/lib/api/exam")>()), fetchExam: m.fetch, fetchExamResults: m.results, fetchExamAttempt: m.attempt }));
vi.mock("@/lib/api/submission", async (orig) => ({ ...(await orig<object>()), fetchTask: m.task }));

const RESULTS: ExamResultsDto = {
  submitted: 3,
  assigned: 4,
  maxScore: 5,
  avg: 3.6667,
  max: 5,
  questions: [
    { id: "2", ord: 1, type: "multi", points: 2, correctRate: 33 },
    { id: "1", ord: 0, type: "single", points: 1, correctRate: 100 },
    { id: "3", ord: 2, type: "ox", points: 1, correctRate: 67 },
    { id: "4", ord: 3, type: "short", points: 1, correctRate: 100 },
  ],
  members: [
    { userId: "u-jieun", nickname: "지은", tone: "mint", status: "done", score: 5, submittedAt: "2026-10-18T12:03:00Z", isLate: false },
    { userId: "u-cs", nickname: "철수", tone: "mint", status: "done", score: 3, submittedAt: "2026-10-18T16:30:00Z", isLate: false },
    { userId: "u-hana", nickname: "하나", tone: "mint", status: "late", score: 3, submittedAt: "2026-10-22T01:00:00Z", isLate: true },
    { userId: "u-ms", nickname: "민수", tone: "mint", status: "todo", score: null, submittedAt: null, isLate: null },
  ],
} as unknown as ExamResultsDto;

const QS: ExamQuestion[] = [
  { id: "1", ord: 0, type: "single", prompt: "IAM 정책 평가 순서로 옳은 것은?", choices: ["명시적 Deny 먼저", "Allow 먼저"], points: 1, answer: 0, explanation: "Deny 가 이긴다" },
  { id: "2", ord: 1, type: "multi", prompt: "VPC 구성 요소", choices: ["서브넷", "IGW", "S3"], points: 2, answer: [0, 1], explanation: "" },
];
const attemptOf = (canEdit: boolean): ExamView =>
  ({
    today: "2026-10-19",
    node: { id: "311", title: "ALB vs NLB 실습", startDate: "2026-10-15", endDate: "2026-10-21", archived: false },
    exam: { status: "published", questionCount: 2, totalPoints: 3, reveal: "after_submit", publishedAt: "2026-10-14T00:00:00Z", closed: false },
    viewer: { canEdit, isAssignee: true, canTake: false, reason: "submitted" },
    questions: QS,
    attempt: {
      status: "submitted",
      answers: { "1": 0, "2": [0, 2] },
      score: 1,
      maxScore: 3,
      correctCount: 1,
      submittedAt: "2026-10-18T16:30:00Z",
      isLate: false,
      results: { "1": { correct: true, earned: 1 }, "2": { correct: false, earned: 0 } },
    },
  }) as ExamView;

let root: Root | null = null;
let host: HTMLElement;
const toast = vi.fn();
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const button = (text: string) => Array.from(host.querySelectorAll("button")).filter((b) => b.textContent?.trim() === text);
const render = async (el: ReturnType<typeof createElement>) => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(MeProvider, { me: null } as Parameters<typeof MeProvider>[0], el)));
  await flush();
};

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  for (const f of Object.values(m)) f.mockReset();
  m.task.mockReturnValue(new Promise(() => {}));
  toast.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

describe("exam 결과 순수 함수", () => {
  it("resultsHead — 평균 소수 한 자리 · 제출 0명이면 개수만", () => {
    expect(resultsHead(RESULTS)).toBe("3/4 제출 · 평균 3.7/5 · 최고 5");
    expect(resultsHead({ submitted: 0, assigned: 4, maxScore: 5, avg: null, max: null })).toBe("0/4 제출");
    expect(resultsHead({ submitted: 2, assigned: 2, maxScore: 5, avg: 4, max: 5 })).toBe("2/2 제출 · 평균 4/5 · 최고 5");
  });
  it("rateText · kstMd", () => {
    expect(rateText(null)).toBe("—");
    expect(rateText(0)).toBe("0%");
    expect(kstMd("2026-10-18T16:30:00Z")).toBe("10.19");
  });
});

describe("ExamResults", () => {
  const mount = (r: ExamResultsDto = RESULTS) => {
    m.results.mockResolvedValue(r);
    return render(createElement(ExamResults, { slug: "aws", nodeId: "311", toast }));
  };

  it("요약 줄 · 문항별 정답률(ord 순, ProgressBar) · 2열 grid(sm) 1열 기본", async () => {
    await mount();
    expect(m.results).toHaveBeenCalledWith("aws", "311");
    expect(host.querySelector("h3")?.textContent).toContain("3/4 제출 · 평균 3.7/5 · 최고 5");
    const rates = Array.from(host.querySelectorAll("ol > li")).map((li) => li.textContent);
    expect(rates).toEqual(["1.100%", "2.33%", "3.67%", "4.100%"]);
    const bars = host.querySelectorAll("[role=progressbar]");
    expect(bars.length).toBe(4);
    expect(bars[1].getAttribute("aria-valuenow")).toBe("33");
    const grid = host.querySelector("ol")!.className;
    expect(grid).toContain("grid-cols-1");
    expect(grid).toContain("sm:grid-cols-2");
  });

  it("정답률 null(제출 0명) → '—'", async () => {
    await mount({ ...RESULTS, submitted: 0, avg: null, max: null, questions: RESULTS.questions.map((q) => ({ ...q, correctRate: null })), members: [RESULTS.members[3]] });
    expect(host.querySelector("h3")?.textContent).toContain("0/4 제출");
    expect(host.querySelector("h3")?.textContent).not.toContain("평균");
    expect(host.querySelector("ol > li")?.textContent).toBe("1.—");
  });

  it("멤버 표 — 점수·제출일(KST)·지각/기한 내 · 미제출은 '— 미제출' 이고 [답안 ▸] 없음", async () => {
    await mount();
    const rows = Array.from(host.querySelectorAll("ul > li"));
    expect(rows.map((r) => r.textContent)).toEqual(["지은5/510.18기한 내답안 ▸", "철수3/510.19기한 내답안 ▸", "하나3/510.22지각답안 ▸", "민수— 미제출"]);
    expect(button("답안 ▸").length).toBe(3);
    for (const b of button("답안 ▸")) expect(b.className).toContain("h-11");
  });

  it("[답안 ▸] → fetchExamAttempt(그 사람) · 결과 모드 읽기 전용 인라인 · 다시 누르면 접힘(재조회 없음)", async () => {
    await mount();
    m.attempt.mockResolvedValue(attemptOf(false));
    act(() => button("답안 ▸")[1].click());
    await flush();
    expect(m.attempt).toHaveBeenCalledWith("aws", "311", "u-cs");
    const region = host.querySelector("[role=region]")!;
    expect(region.getAttribute("aria-label")).toBe("철수 답안");
    expect(region.textContent).toContain("1/3점 (33%) · 1/2 문항 정답");
    expect(region.textContent).toContain("✓ 정답");
    expect(region.textContent).toContain("✗ 오답");
    expect(region.textContent).not.toContain("내 답");   // 남의 답안 — 중립 라벨 「답」(E2E I-3)
    expect([...region.querySelectorAll("span, dt")].some((e) => e.textContent === "답")).toBe(true);
    expect(region.querySelector("input")).toBeNull();
    expect(region.querySelectorAll("details").length).toBe(1);
    expect(host.querySelector("[aria-expanded=true]")?.textContent).toBe("답안 ▾");
    act(() => button("답안 ▾")[0].click());
    expect(host.querySelector("[role=region]")).toBeNull();
    act(() => button("답안 ▸")[1].click());
    await flush();
    expect(m.attempt).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[role=region]")).not.toBeNull();
  });

  it("refreshKey 로 다시 불러오면 펼친 답안을 접고, 다시 누르면 새로 조회", async () => {
    m.results.mockResolvedValue(RESULTS);
    const el = (k: string) => createElement(MeProvider, { me: null } as Parameters<typeof MeProvider>[0], createElement(ExamResults, { slug: "aws", nodeId: "311", toast, refreshKey: k }));
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() => root!.render(el("a")));
    await flush();
    m.attempt.mockResolvedValue(attemptOf(false));
    act(() => button("답안 ▸")[1].click());
    await flush();
    expect(host.querySelector("[role=region]")).not.toBeNull();
    act(() => root!.render(el("b")));
    await flush();
    expect(m.results).toHaveBeenCalledTimes(2);
    expect(host.querySelector("[role=region]")).toBeNull();
    expect(host.querySelector("[aria-expanded=true]")).toBeNull();
    act(() => button("답안 ▸")[1].click());
    await flush();
    expect(m.attempt).toHaveBeenCalledTimes(2);
    expect(host.querySelector("[role=region]")).not.toBeNull();
  });

  it("[답안 ▸] 실패 → 토스트, 펼치지 않음", async () => {
    await mount();
    m.attempt.mockRejectedValue(new ApiException({ code: "FORBIDDEN", message: "x" }));
    act(() => button("답안 ▸")[0].click());
    await flush();
    expect(toast).toHaveBeenCalledWith({ text: "답안을 불러오지 못했어요", tone: "bad" });
    expect(host.querySelector("[role=region]")).toBeNull();
  });

  it("불러오기 실패 → 다시 시도", async () => {
    m.results.mockRejectedValueOnce(new ApiException({ code: "UNKNOWN", message: "x" }));
    await mount();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("결과를 불러오지 못했어요");
    act(() => button("다시 시도")[0].click());
    await flush();
    expect(host.querySelector("h3")?.textContent).toContain("3/4 제출");
  });
});

describe("ExamSection — 편집자에게만 「결과」", () => {
  const leaf = { ...buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).leaves.find((l) => l.title === "ALB vs NLB 실습")!, exam: { status: "published", questionCount: 2, totalPoints: 3, reveal: "after_submit" } } as LeafNode;
  const section = () => createElement(ExamSection, { n: leaf, slug: "aws", roomStatus: "active", focus: null, onFocused: () => {}, onSubmitted: () => {}, toast, viewerPending: false });
  const asViewer = (canEdit: boolean, status: "published" | "draft" = "published"): ExamView => {
    const v = attemptOf(canEdit);
    return { ...v, exam: { ...v.exam, status }, viewer: { canEdit, isAssignee: false, canTake: false, reason: "not_assignee" }, questions: null, attempt: null };
  };

  it("canEdit → 결과 섹션을 그리고 fetchExamResults 호출", async () => {
    m.fetch.mockResolvedValue(asViewer(true));
    m.results.mockResolvedValue(RESULTS);
    await render(section());
    expect(m.results).toHaveBeenCalledWith("aws", leaf.id);
    expect(host.textContent).toContain("문항별 정답률");
  });
  it("멤버(canEdit false) → fetchExamResults 를 부르지 않는다", async () => {
    m.fetch.mockResolvedValue(asViewer(false));
    await render(section());
    expect(m.results).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("문항별 정답률");
  });
  it("초안 → 편집자여도 결과 없음", async () => {
    m.fetch.mockResolvedValue(asViewer(true, "draft"));
    await render(section());
    expect(m.results).not.toHaveBeenCalled();
  });
});
