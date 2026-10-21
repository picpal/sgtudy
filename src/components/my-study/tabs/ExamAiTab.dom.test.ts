// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiException } from "@/lib/api/errors";
import { EMPTY_DRAFT } from "../exam";
import type { ExamBrief, ExamQuestion, ExamSummary, ExamView } from "@/lib/api/types";
import { COPY_FAIL, ExamAiTab, NO_AI_DRAFT, NO_NEW_AI_DRAFT, REPLACE_ASK, briefForm, jsonInstruction } from "./ExamAiTab";
import { ExamEditor, type ExamEditorHandle } from "./ExamEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ fetch: vi.fn(), brief: vi.fn(), put: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/api/exam", async (orig) => ({ ...(await orig<typeof import("@/lib/api/exam")>()), fetchExam: m.fetch, putExamBrief: m.brief, putExam: m.put, publishExam: m.publish }));

const QS: ExamQuestion[] = [
  { id: "1", ord: 0, type: "single", prompt: "IAM 정책 평가 순서로 옳은 것은?", choices: ["명시적 Deny → Allow", "Allow → Deny"], points: 1, answer: 0, explanation: "비밀해설-명시적 Deny 가 이긴다" },
  { id: "2", ord: 1, type: "ox", prompt: "S3 는 리전 서비스다.", choices: null, points: 1, answer: true, explanation: "" },
];
const BRIEF: ExamBrief = { topic: "AWS IAM·VPC 핵심", count: 5, types: ["single", "ox"], difficulty: "normal" };
const view = (o: { status?: "draft" | "published"; questions?: ExamQuestion[]; locked?: boolean; brief?: ExamBrief | null; source?: "manual" | "ai" } = {}): ExamView => {
  const qs = o.questions ?? QS;
  return {
    today: "2026-10-12",
    node: { id: "311", title: "3주차 정리 시험", startDate: "2026-10-15", endDate: "2026-10-21", archived: false },
    exam: { status: o.status ?? "draft", questionCount: qs.length, totalPoints: qs.length, reveal: "after_submit", publishedAt: null, closed: false, source: o.source ?? "manual", locked: o.locked ?? false, submittedCount: 0, brief: o.brief === undefined ? BRIEF : o.brief },
    viewer: { canEdit: true, isAssignee: false, canTake: false, reason: "not_assignee" },
    questions: qs,
    attempt: null,
  };
};
const AI_JSON = JSON.stringify({ questions: [{ type: "ox", prompt: "IAM 은 글로벌 서비스다.", answer: true, explanation: "맞다" }, { type: "short", prompt: "VPC 관문은?", answer: [" IGW "] }] });

let root: Root | null = null;
let host: HTMLElement;
const toast = vi.fn();
const goManual = vi.fn();
const ed = { view: view() as ExamView | null, draft: EMPTY_DRAFT, dirty: false, locked: false, replace: vi.fn(() => true), applyView: vi.fn(), applyMeta: vi.fn(), reload: vi.fn(async () => {}) };

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const mount = (o: Partial<typeof ed> = {}) => {
  Object.assign(ed, o);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(ExamAiTab, { slug: "aws", nodeId: "311", ed, goManual, toast })));
};
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
const fieldOf = <T extends HTMLInputElement | HTMLTextAreaElement>(labelText: string) =>
  Array.from(host.querySelectorAll("label")).find((l) => l.textContent?.startsWith(labelText))!.querySelector<T>("input, textarea")!;
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const alert = () => host.querySelector('[role="alert"]')?.textContent;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  for (const f of [m.fetch, m.brief, m.put, m.publish, toast, goManual, ed.replace, ed.applyView, ed.applyMeta, ed.reload]) f.mockReset();
  ed.replace.mockReturnValue(true);
  Object.assign(ed, { view: view(), draft: EMPTY_DRAFT, dirty: false, locked: false });
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("ExamAiTab — 브리프", () => {
  it("저장된 브리프로 폼을 채우고 [브리프 저장] = putExamBrief(slug, node, 폼) → view 만 갱신(문항 유지)", async () => {
    mount();
    expect(fieldOf<HTMLInputElement>("주제").value).toBe("AWS IAM·VPC 핵심");
    expect(host.querySelector("select")).toBeNull();
    expect(button("브리프 저장됨")!.disabled).toBe(true);
    type(fieldOf("주제"), "  VPC 라우팅 ");
    type(fieldOf("기반 이론"), "라우팅 테이블은 서브넷마다 하나");
    act(() => button("어려움")!.click());
    act(() => button("✓ O/X")!.click()); // 끄기
    act(() => button("단답")!.click()); // 켜기
    const saved = view({ brief: { topic: "VPC 라우팅", count: 5, types: ["single", "short"], difficulty: "hard", theory: "라우팅 테이블은 서브넷마다 하나" } });
    m.brief.mockResolvedValue(saved);
    await act(async () => button("브리프 저장")!.click());
    await flush();
    expect(m.brief).toHaveBeenCalledWith("aws", "311", { topic: "  VPC 라우팅 ", count: 5, types: ["single", "short"], difficulty: "hard", theory: "라우팅 테이블은 서브넷마다 하나" });
    expect(ed.applyMeta).toHaveBeenCalledWith(saved);
    expect(ed.applyView).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ text: "브리프를 저장했어요", tone: "ok" });
  });

  it("브리프가 없으면 기본값(10문항·보통·객관식·복수·OX) · 주제 비면 보내지 않고 한 줄", async () => {
    mount({ view: view({ brief: null }) });
    expect(briefForm(null)).toEqual({ topic: "", theory: "", count: 10, types: ["single", "multi", "ox"], difficulty: "normal", note: "" });
    expect(host.querySelector('[aria-label^="문항 수:"]')!.getAttribute("aria-label")).toBe("문항 수: 10문항");
    // 아무것도 저장하지 않았으면 「저장됨」이 아니라 [브리프 저장](E2E I-5)
    expect(button("브리프 저장됨")).toBeUndefined();
    expect(button("브리프 저장")!.disabled).toBe(false);
    type(fieldOf("참고"), "슬라이드 3장");
    await act(async () => button("브리프 저장")!.click());
    expect(m.brief).not.toHaveBeenCalled();
    expect(alert()).toBe("주제는 1~200자예요");
  });

  it("기반 이론 20,000자 카운터 — 넘으면 경고 · 저장 거부", async () => {
    mount();
    type(fieldOf("기반 이론"), "가".repeat(20001));
    expect(host.textContent).toContain("20,001 / 20,000자");
    await act(async () => button("브리프 저장")!.click());
    expect(m.brief).not.toHaveBeenCalled();
    expect(alert()).toBe("기반 이론은 20,000자까지예요");
  });

  it("서버 거절 — 한국어 한 줄 + 토스트", async () => {
    mount();
    type(fieldOf("주제"), "새 주제");
    m.brief.mockRejectedValue(new ApiException({ code: "VALIDATION_FAILED", message: "참고는 1,000자까지예요", details: { field: "note" } }));
    await act(async () => button("브리프 저장")!.click());
    await flush();
    expect(alert()).toBe("참고는 1,000자까지예요");
    expect(toast).toHaveBeenCalledWith({ text: "참고는 1,000자까지예요", tone: "bad" });
  });
});

describe("ExamAiTab — AI 에게 넘기기(MCP)", () => {
  it("두 갈래 안내 · /me 링크 · 지시문에 slug·task id·도구 이름, 정답·해설은 없다", () => {
    mount();
    const link = host.querySelector<HTMLAnchorElement>('a[href="/me"]');
    expect(link!.textContent).toContain("AI 연결");
    expect(host.textContent).toContain("MCP 없이: JSON 붙여넣기");
    expect(host.textContent).not.toContain("곧 제공");
    const ins = host.querySelector('[aria-label="AI 지시문"]')!.textContent!;
    expect(ins).toContain('"aws"');
    expect(ins).toContain("311");
    expect(ins).toContain("get_exam_brief");
    expect(ins).toContain("create_exam_draft");
    expect(host.textContent).toContain("draft-exam");
    expect(ins).not.toContain("비밀해설");
    expect(ins).not.toContain("명시적 Deny");
  });

  it("[지시문 복사] 성공 → '복사했어요', 실패 → 선택 가능한 글 상자 + 문구", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    mount();
    await act(async () => button("지시문 복사")!.click());
    expect(write.mock.calls[0][0]).toContain("task 311");
    expect(button("복사했어요")).toBeTruthy();
    act(() => root!.unmount());
    root = null;
    host.remove();
    write.mockRejectedValue(new Error("denied"));
    mount();
    await act(async () => button("지시문 복사")!.click());
    expect(alert()).toBe(COPY_FAIL);
    const box = host.querySelector<HTMLTextAreaElement>('textarea[readonly]')!;
    expect(box.value).toContain("task 311");
  });

  it("[초안 새로 불러오기] — AI 초안이 없으면 안내만(문항 그대로) · 사람이 저장한 문항이면 '새 AI 초안이 없어요'", async () => {
    mount();
    m.fetch.mockResolvedValue(view({ source: "manual", questions: [] }));
    await act(async () => button("초안 새로 불러오기")!.click());
    await flush();
    expect(m.fetch).toHaveBeenCalledWith("aws", "311");
    expect(host.textContent).toContain(NO_AI_DRAFT);
    m.fetch.mockResolvedValue(view({ source: "manual" }));
    await act(async () => button("초안 새로 불러오기")!.click());
    await flush();
    expect(host.textContent).toContain(NO_NEW_AI_DRAFT);
    expect(host.textContent).not.toContain(NO_AI_DRAFT);
    expect(ed.applyView).not.toHaveBeenCalled();
    expect(goManual).not.toHaveBeenCalled();
  });

  it("발행된 시험 — [초안 새로 불러오기] 비활성 + 이유(발행 토스트 없음)", () => {
    mount({ view: view({ status: "published", source: "ai" }) });
    const b = button("초안 새로 불러오기")!;
    expect(b.disabled).toBe(true);
    expect(host.querySelector(`#${b.getAttribute("aria-describedby")}`)!.textContent).toBe("발행된 시험은 AI 초안으로 바꿀 수 없어요 · 초안으로 되돌린 뒤 해 주세요");
  });

  it("[초안 새로 불러오기] — 고친 문항이 있으면 묻고, 바꾸면 수동 탭으로", async () => {
    mount({ dirty: true });
    const ai = view({ source: "ai" });
    m.fetch.mockResolvedValue(ai);
    await act(async () => button("초안 새로 불러오기")!.click());
    await flush();
    expect(ed.applyView).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')!.textContent).toContain(REPLACE_ASK);
    act(() => button("AI 초안으로 바꾸기")!.click());
    expect(ed.applyView).toHaveBeenCalledWith(ai);
    expect(goManual).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ text: "AI 초안 2문항을 불러왔어요 · 검토한 뒤 발행해 주세요", tone: "ok" });
  });
});

describe("ExamAiTab — JSON 붙여넣기", () => {
  it("형식 오류는 한국어 한 줄, 가져오지 않는다", () => {
    mount();
    type(fieldOf("AI 가 준 JSON"), '{"questions": [ {"type":"essay","prompt":"x"} ]}');
    act(() => button("가져오기")!.click());
    expect(alert()).toBe("1번 문항 · 문항 유형은 single·multi·ox·short 예요");
    expect(ed.replace).not.toHaveBeenCalled();
    type(fieldOf("AI 가 준 JSON"), "그냥 글");
    act(() => button("가져오기")!.click());
    expect(alert()).toBe("JSON 을 찾지 못했어요 · { 로 시작하는 내용을 붙여 넣어 주세요");
  });

  it("성공 → 초안 교체(다듬지 않음) · 수동 탭으로 · 안내 토스트", () => {
    mount();
    type(fieldOf("AI 가 준 JSON"), "```json\n" + AI_JSON + "\n```");
    act(() => button("가져오기")!.click());
    expect(ed.replace).toHaveBeenCalledTimes(1);
    const d = (ed.replace.mock.calls[0] as unknown as [import("@/lib/api/exam").ExamDraft])[0];
    expect(d.questions).toHaveLength(2);
    expect(d.questions[1].answer).toEqual([" IGW "]);
    expect(d.reveal).toBe("after_submit");
    expect(goManual).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ text: "2문항을 가져왔어요 · 검토한 뒤 [문제 저장]을 눌러 주세요", tone: "ok" });
  });

  it("고친 문항이 있으면 InlineConfirm 뒤에 바꾼다", () => {
    mount({ dirty: true });
    type(fieldOf("AI 가 준 JSON"), AI_JSON);
    act(() => button("가져오기")!.click());
    expect(ed.replace).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')!.textContent).toContain(REPLACE_ASK);
    act(() => button("취소")!.click());
    expect(ed.replace).not.toHaveBeenCalled();
    act(() => button("가져오기")!.click());
    act(() => button("AI 초안으로 바꾸기")!.click());
    expect(ed.replace).toHaveBeenCalledTimes(1);
  });

  it("발행됨·잠김 — 막는 이유 한 줄 · [가져오기] 비활성", () => {
    mount({ view: view({ status: "published" }) });
    expect(host.textContent).toContain("발행된 시험은 AI 초안으로 바꿀 수 없어요");
    type(fieldOf("AI 가 준 JSON"), AI_JSON);
    expect(button("가져오기")!.disabled).toBe(true);
    act(() => root!.unmount());
    root = null;
    host.remove();
    mount({ view: view({ status: "published", locked: true }), locked: true });
    expect(host.textContent).toContain("응시가 시작된 시험이라 문항을 AI 초안으로 바꿀 수 없어요");
  });

  it("JSON 지시문 — 폼의 브리프·유형별 모양, 기반 이론은 인용 블록", () => {
    const t = jsonInstruction({ ...briefForm(BRIEF), theory: "IAM 은 글로벌" });
    expect(t).toContain("주제: AWS IAM·VPC 핵심 · 5문항 · 유형 객관식·O/X · 난이도 보통");
    expect(t).toContain('"type":"single"');
    expect(t).not.toContain('"type":"short"');
    expect(t).toContain('"""\nIAM 은 글로벌\n"""');
  });
});

describe("ExamEditor + AI 탭", () => {
  const SUMMARY: ExamSummary = { status: "draft", questionCount: 2, totalPoints: 2, reveal: "after_submit" };
  it("저장하지 않은 브리프도 미저장 — onDirty(true) · handle.save 가 브리프 저장 · discard 가 되돌린다", async () => {
    m.fetch.mockResolvedValue(view());
    const onDirty = vi.fn();
    const ref = createRef<ExamEditorHandle>();
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() =>
      root!.render(
        createElement(ExamEditor, {
          slug: "aws",
          nodeId: "311",
          summary: SUMMARY,
          assignees: 2,
          toast,
          onDirty,
          ref,
          ai: (e, go, bind) => createElement(ExamAiTab, { slug: "aws", nodeId: "311", ed: e, goManual: go, toast, onBrief: bind }),
        }),
      ),
    );
    await flush();
    expect(onDirty).toHaveBeenLastCalledWith(false);
    type(fieldOf("주제"), "새 주제");
    expect(onDirty).toHaveBeenLastCalledWith(true);
    act(() => ref.current!.discard());
    expect(fieldOf<HTMLInputElement>("주제").value).toBe("AWS IAM·VPC 핵심");
    expect(onDirty).toHaveBeenLastCalledWith(false);
    type(fieldOf("주제"), "새 주제");
    m.brief.mockResolvedValue(view({ brief: { ...BRIEF, topic: "새 주제" } }));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await ref.current!.save();
    });
    await flush();
    expect(ok).toBe(true);
    expect(m.put).not.toHaveBeenCalled(); // 문항은 그대로라 보내지 않는다
    expect(m.brief).toHaveBeenCalledWith("aws", "311", { ...BRIEF, topic: "새 주제" });
    expect(onDirty).toHaveBeenLastCalledWith(false);
    // 주제를 비우면 저장 실패 — 숨은 탭이라도 토스트
    type(fieldOf("주제"), "");
    await act(async () => {
      ok = await ref.current!.save();
    });
    expect(ok).toBe(false);
    expect(toast).toHaveBeenCalledWith({ text: "브리프 · 주제는 1~200자예요", tone: "bad" });
  });

  it("탭 줄 · 탭을 오가도 적던 브리프가 남는다 · 가져오기 → 직접 작성 탭에 문항 + 저장 전", async () => {
    m.fetch.mockResolvedValue(view());
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() =>
      root!.render(
        createElement(ExamEditor, {
          slug: "aws",
          nodeId: "311",
          summary: SUMMARY,
          assignees: 2,
          toast,
          onDirty: () => {},
          ai: (e, go) => createElement(ExamAiTab, { slug: "aws", nodeId: "311", ed: e, goManual: go, toast }),
        }),
      ),
    );
    await flush();
    const panel = host.querySelector<HTMLElement>("[data-exam-ai]")!.parentElement!;
    expect(panel.hidden).toBe(true);
    act(() => button("AI 로 생성")!.click());
    expect(panel.hidden).toBe(false);
    type(fieldOf("주제"), "적던 주제");
    act(() => button("직접 작성")!.click());
    act(() => button("AI 로 생성")!.click());
    expect(fieldOf<HTMLInputElement>("주제").value).toBe("적던 주제");
    type(fieldOf("AI 가 준 JSON"), AI_JSON);
    act(() => button("가져오기")!.click());
    expect(panel.hidden).toBe(true);
    expect(host.querySelectorAll("ol[aria-label='문항'] > li")).toHaveLength(2);
    expect(host.textContent).toContain("저장 전");
  });
});
