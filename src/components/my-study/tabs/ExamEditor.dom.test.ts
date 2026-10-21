// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ApiException } from "@/lib/api/errors";
import { toContract, type ExamDraft } from "@/lib/api/exam";
import type { ExamQuestion, ExamSummary, ExamView } from "@/lib/api/types";
import { ExamEditor, type ExamEditorHandle } from "./ExamEditor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ fetch: vi.fn(), put: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/api/exam", async (orig) => ({ ...(await orig<typeof import("@/lib/api/exam")>()), fetchExam: m.fetch, putExam: m.put, publishExam: m.publish }));

const QS: ExamQuestion[] = [
  { id: "1", ord: 0, type: "single", prompt: "IAM 정책 평가 순서로 옳은 것은?", choices: ["명시적 Deny → Allow", "Allow → Deny"], points: 1, answer: 0, explanation: "명시적 Deny 가 이긴다" },
  { id: "2", ord: 1, type: "multi", prompt: "VPC 구성 요소를 모두 고르세요", choices: ["서브넷", "IGW", "S3"], points: 2, answer: [0, 1], explanation: "" },
  { id: "3", ord: 2, type: "ox", prompt: "S3 는 리전 서비스다.", choices: null, points: 1, answer: true, explanation: "" },
  { id: "4", ord: 3, type: "short", prompt: "VPC 를 인터넷에 잇는 것은?", choices: null, points: 1, answer: ["인터넷 게이트웨이", "IGW"], explanation: "" },
];
const view = (o: { status?: "draft" | "published"; questions?: ExamQuestion[]; locked?: boolean; submittedCount?: number } = {}): ExamView => {
  const qs = o.questions ?? QS;
  return {
    today: "2026-10-12",
    node: { id: "311", title: "3주차 정리 시험", startDate: "2026-10-15", endDate: "2026-10-21", archived: false },
    exam: { status: o.status ?? "draft", questionCount: qs.length, totalPoints: qs.reduce((s, q) => s + q.points, 0), reveal: "after_submit", publishedAt: null, closed: false, source: "manual", locked: o.locked ?? false, submittedCount: o.submittedCount ?? 0, brief: null },
    viewer: { canEdit: true, isAssignee: false, canTake: false, reason: "not_assignee" },
    questions: qs,
    attempt: null,
  };
};
const SUMMARY: ExamSummary = { status: "draft", questionCount: 4, totalPoints: 5, reveal: "after_submit" };

let root: Root | null = null;
let host: HTMLElement;
const toast = vi.fn();
const onDirty = vi.fn();
const onChanged = vi.fn();

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const mount = async (v: ExamView, summary: ExamSummary = SUMMARY, ref?: React.Ref<ExamEditorHandle>, assignees = 4) => {
  m.fetch.mockResolvedValue(v);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(ExamEditor, { slug: "aws", nodeId: "311", summary, assignees, toast, onDirty, onChanged, ref })));
  await flush();
};
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
const byLabel = <T extends Element = HTMLElement>(l: string) => host.querySelector<T>(`[aria-label="${l}"]`);
const lbBtn = (l: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button[aria-haspopup=listbox]")).find((b) => b.getAttribute("aria-label")?.startsWith(`${l}:`));
const sent = (): ExamDraft => m.put.mock.calls.at(-1)![2];

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  m.fetch.mockReset();
  m.put.mockReset();
  m.publish.mockReset();
  toast.mockReset();
  onDirty.mockReset();
  onChanged.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe("ExamEditor — 문항 렌더(유형별 입력)", () => {
  it("초안 4문항 — 머리 줄 · 객관식 라디오 · 복수 체크 · OX · 단답 허용 답", async () => {
    await mount(view());
    expect(m.fetch).toHaveBeenCalledWith("aws", "311");
    expect(host.textContent).toContain("초안 · 4문항 · 5점");
    expect(host.querySelectorAll("ol > li")).toHaveLength(4);
    const radios = host.querySelectorAll<HTMLInputElement>('input[type="radio"][name="exam-q-0-answer"]');
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    const checks = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="exam-q-1-answer"]');
    expect(Array.from(checks).map((c) => c.checked)).toEqual([true, true, false]);
    const ox = byLabel("3번 문항 정답")!.querySelectorAll("button");
    expect(Array.from(ox).map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["O", "true"], ["X", "false"]]);
    expect(byLabel<HTMLInputElement>("4번 문항 허용 답 2")!.value).toBe("IGW");
    // 유형 고르기는 앱 Listbox(기본 select 아님)
    expect(host.querySelector("select")).toBeNull();
    expect(lbBtn("1번 문항 유형")!.getAttribute("aria-label")).toBe("1번 문항 유형: 객관식");
    // 문항 추가 4종 · 공개 · [문제 저장](처음엔 비활성)
    for (const t of ["+ 객관식", "+ 복수 선택", "+ O/X", "+ 단답"]) expect(button(t)).toBeTruthy();
    expect(button("문제 저장")!.disabled).toBe(true);
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });

  it("정답 라디오를 바꾸면 dirty → [문제 저장] = putExam 에 바뀐 정답, 저장 뒤 dirty 해제 + 트리 갱신", async () => {
    await mount(view());
    const r2 = host.querySelectorAll<HTMLInputElement>('input[type="radio"][name="exam-q-0-answer"]')[1];
    act(() => r2.click());
    expect(onDirty).toHaveBeenLastCalledWith(true);
    expect(host.textContent).toContain("· 저장 전");
    const saved = view({ questions: QS.map((q, k) => (k === 0 ? { ...q, answer: 1 } : q)) });
    m.put.mockResolvedValue(saved);
    await act(async () => button("문제 저장")!.click());
    await flush();
    expect(m.put).toHaveBeenCalledTimes(1);
    expect(m.put.mock.calls[0].slice(0, 2)).toEqual(["aws", "311"]);
    expect(sent().questions[0].answer).toBe(1);
    expect(sent().questions[1].answer).toEqual([0, 1]);
    expect(onDirty).toHaveBeenLastCalledWith(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ text: "문제를 저장했어요", tone: "ok" });
  });

  it("클라이언트 검사 실패 — 보내지 않고 그 문항에 오류 + 토스트", async () => {
    await mount(view({ questions: [] }), { status: "draft", questionCount: 0, totalPoints: 0 });
    act(() => button("+ 객관식")!.click());
    await act(async () => button("문제 저장")!.click());
    expect(m.put).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("문제는 1~2,000자예요");
    expect(toast).toHaveBeenCalledWith({ text: "1번 문항 · 문제는 1~2,000자예요", tone: "bad" });
  });

  it("단답 허용 답은 다듬지 않고 보낸다(빈 칸만 뺀다)", async () => {
    await mount(view({ questions: [{ ...QS[3], answer: [" IGW "] }] }));
    act(() => button("+ 허용 답")!.click());
    act(() => button("+ 단답")!.click()); // 새 문항은 프롬프트가 비어 검사에 걸린다 → 지운다
    act(() => byLabel<HTMLButtonElement>("2번 문항 삭제")!.click());
    // 새 허용 답 칸은 비어 있다 → dirty 지만 계약에서 빠진다
    m.put.mockResolvedValue(view({ questions: [{ ...QS[3], answer: [" IGW "] }] }));
    await act(async () => button("문제 저장")!.click());
    await flush();
    expect(sent().questions[0].answer).toEqual([" IGW ", ""]); // 초안은 그대로
    expect((toContract(sent()).questions[0] as { answer: unknown }).answer).toEqual([" IGW "]); // putExam 안의 toContract 가 빈 칸만 뺀다(다듬지 않음)
  });
});

describe("ExamEditor — 잠김(응시 1건~)", () => {
  it("유형·배점 aria-disabled · 추가/삭제/순서 없음 · 보기 글 readOnly · 잠금 문구, 문제 글은 고칠 수 있다", async () => {
    await mount(view({ status: "published", locked: true, submittedCount: 3 }), { ...SUMMARY, status: "published" });
    expect(host.textContent).toContain("3명이 제출해 문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요");
    expect(lbBtn("1번 문항 유형")!.getAttribute("aria-disabled")).toBe("true");
    expect(lbBtn("1번 문항 배점")!.getAttribute("aria-disabled")).toBe("true");
    act(() => lbBtn("1번 문항 유형")!.click());
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(button("+ 객관식")).toBeUndefined();
    expect(byLabel("1번 문항 삭제")).toBeNull();
    expect(button("+ 보기")).toBeUndefined();
    const choice = byLabel<HTMLInputElement>("1번 문항 1번 보기")!;
    expect(choice.readOnly).toBe(true);
    expect(choice.getAttribute("aria-disabled")).toBe("true");
    expect(host.querySelectorAll<HTMLInputElement>('input[name="exam-q-0-answer"]')[1].getAttribute("aria-disabled")).toBe("true");
    // 정답 라디오를 눌러도 바뀌지 않는다
    act(() => host.querySelectorAll<HTMLInputElement>('input[name="exam-q-0-answer"]')[1].click());
    expect(onDirty).toHaveBeenLastCalledWith(false);
    // 초안으로 되돌리기도 막힌다 — 이유를 버튼에 이어 보인다(E2E I-7)
    const unpub = button("초안으로")!;
    expect(unpub.disabled).toBe(true);
    const why = host.querySelector(`#${unpub.getAttribute("aria-describedby")}`);
    expect(why?.textContent).toBe("3명이 제출해 초안으로 되돌릴 수 없어요");
  });

  it("제출 0명·응시 중 — '응시가 시작돼' 문구 (0명이 제출해 아님)", async () => {
    await mount(view({ status: "published", locked: true, submittedCount: 0 }), { ...SUMMARY, status: "published" });
    expect(host.textContent).toContain("응시가 시작돼 문항은 잠겼어요");
    expect(host.textContent).not.toContain("0명이 제출해");
    expect(host.textContent).toContain("응시가 시작돼 초안으로 되돌릴 수 없어요");
  });
});

describe("ExamEditor — 발행", () => {
  it("문항 0 — [발행] 비활성 + 이유", async () => {
    await mount(view({ questions: [] }), { status: "draft", questionCount: 0, totalPoints: 0 });
    expect(button("발행")!.disabled).toBe(true);
    expect(host.textContent).toContain("문항을 하나 이상 넣어야 발행할 수 있어요");
  });

  it("[발행] → InlineConfirm '담당 팀원에게 알림이 가요'(수는 서버가 정한다) → publishExam(true) · 머리 줄 발행됨", async () => {
    await mount(view());
    act(() => button("발행")!.click());
    expect(host.querySelector('[role="alertdialog"]')!.textContent).toContain("담당 팀원에게 알림이 가요");
    expect(host.querySelector('[role="alertdialog"]')!.textContent).not.toMatch(/\d+명/);
    m.publish.mockResolvedValue(view({ status: "published" }));
    const confirm = host.querySelector('[role="alertdialog"]')!.querySelectorAll("button")[1];
    await act(async () => confirm.click());
    await flush();
    expect(m.publish).toHaveBeenCalledWith("aws", "311", true);
    expect(m.put).not.toHaveBeenCalled();
    expect(host.textContent).toContain("발행됨 · 4문항 · 5점");
    expect(button("초안으로")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it("고친 문항이 있으면 저장한 뒤 발행", async () => {
    await mount(view());
    act(() => host.querySelectorAll<HTMLInputElement>('input[name="exam-q-0-answer"]')[1].click());
    act(() => button("발행")!.click());
    expect(host.querySelector('[role="alertdialog"]')!.textContent).toContain("고친 문항을 먼저 저장해요");
    m.put.mockResolvedValue(view({ questions: QS.map((q, k) => (k === 0 ? { ...q, answer: 1 } : q)) }));
    m.publish.mockResolvedValue(view({ status: "published" }));
    await act(async () => button("저장하고 발행")!.click());
    await flush();
    expect(m.put).toHaveBeenCalledTimes(1);
    expect(m.publish).toHaveBeenCalledWith("aws", "311", true);
    expect(m.put.mock.invocationCallOrder[0]).toBeLessThan(m.publish.mock.invocationCallOrder[0]);
  });

  it("[초안으로] — 서버 EXAM_LOCKED(그새 응시 시작) → 토스트 + 다시 불러와 잠금", async () => {
    await mount(view({ status: "published" }), { ...SUMMARY, status: "published" });
    m.publish.mockRejectedValue(new ApiException({ code: "EXAM_LOCKED", message: "응시가 시작된 시험은 초안으로 되돌릴 수 없어요" }));
    m.fetch.mockResolvedValue(view({ status: "published", locked: true, submittedCount: 1 }));
    act(() => button("초안으로")!.click());
    const confirm = host.querySelector('[role="alertdialog"]')!.querySelectorAll("button")[1];
    await act(async () => confirm.click());
    await flush();
    expect(m.publish).toHaveBeenCalledWith("aws", "311", false);
    expect(toast).toHaveBeenCalledWith({ text: "응시가 시작된 시험은 초안으로 되돌릴 수 없어요", tone: "bad" });
    expect(m.fetch).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("1명이 제출해 문항은 잠겼어요");
  });
});

describe("ExamEditor — handle (EditView 의 [저장]·떠나기 확인)", () => {
  it("discard — 고친 문항을 버리고 dirty 해제, save — 저장", async () => {
    const ref = createRef<ExamEditorHandle>();
    await mount(view(), SUMMARY, ref);
    act(() => host.querySelectorAll<HTMLInputElement>('input[name="exam-q-0-answer"]')[1].click());
    expect(onDirty).toHaveBeenLastCalledWith(true);
    act(() => ref.current!.discard());
    expect(onDirty).toHaveBeenLastCalledWith(false);
    expect(host.querySelectorAll<HTMLInputElement>('input[name="exam-q-0-answer"]')[0].checked).toBe(true);
    // 바뀐 게 없으면 보내지 않고 true
    let ok: boolean | undefined;
    await act(async () => void (ok = await ref.current!.save()));
    expect(ok).toBe(true);
    expect(m.put).not.toHaveBeenCalled();
  });
});

describe("ExamEditor — 리뷰 보완(minor)", () => {
  it("담당자 0명 — 발행 확인이 '알림은 가지 않아요'", async () => {
    await mount(view(), SUMMARY, undefined, 0);
    act(() => button("발행")!.click());
    expect(host.querySelector('[role="alertdialog"]')!.textContent).toContain("담당자가 아직 없어 알림은 가지 않아요");
  });

  it("문항 삭제 뒤 포커스 — 다음 카드의 삭제 버튼이 아니라 앞 카드의 문제 칸, 다 지우면 머리말", async () => {
    await mount(view());
    act(() => byLabel<HTMLButtonElement>("2번 문항 삭제")!.click());
    expect(host.querySelectorAll("ol > li")).toHaveLength(3);
    expect(document.activeElement).toBe(host.querySelectorAll("ol > li")[0].querySelector("textarea"));
    for (let k = 0; k < 3; k++) act(() => byLabel<HTMLButtonElement>("1번 문항 삭제")!.click());
    expect(document.activeElement?.tagName).toBe("H3");
    expect(document.activeElement?.textContent).toBe("문제");
  });

  it("50문항 — 추가 버튼 비활성 + 이유", async () => {
    await mount(view({ questions: Array.from({ length: 50 }, (_, k) => ({ ...QS[2], id: String(k), ord: k })) }));
    expect(button("+ 객관식")!.disabled).toBe(true);
    expect(host.textContent).toContain("문항은 50개까지예요");
  });

  it("범위 밖 배점 — 빈 칸 대신 값과 이유", async () => {
    await mount(view({ questions: [{ ...QS[2], points: 15 }] }));
    expect(lbBtn("1번 문항 배점")!.getAttribute("aria-label")).toBe("1번 문항 배점: 15점");
    expect(host.textContent).toContain("배점 15점 · 1~10점만 돼요");
  });

  it("[문제 저장] 중에 handle.save(위쪽 [저장]) — 실패로 끝나지 않고 기다렸다가 true", async () => {
    const ref = createRef<ExamEditorHandle>();
    await mount(view(), SUMMARY, ref);
    act(() => host.querySelectorAll<HTMLInputElement>('input[name="exam-q-0-answer"]')[1].click());
    let done!: (v: ExamView) => void;
    m.put.mockReturnValue(new Promise<ExamView>((r) => (done = r)));
    act(() => button("문제 저장")!.click());
    let second: Promise<boolean> | undefined;
    act(() => void (second = ref.current!.save()));
    await act(async () => done(view({ questions: QS.map((q, k) => (k === 0 ? { ...q, answer: 1 } : q)) })));
    await flush();
    expect(await second).toBe(true);
    expect(m.put).toHaveBeenCalledTimes(1);
  });
});
