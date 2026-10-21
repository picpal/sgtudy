import { describe, expect, it } from "vitest";
import type { ExamDraft } from "@/lib/api/exam";
import type { ExamAttempt, ExamQuestion, ExamView, ExamViewerReason } from "@/lib/api/types";
import {
  aiInstruction, answeredCount, draftDirty, draftReduce, EMPTY_DRAFT, examErrorAction, examHead, isAnswered, isExamDraft, lockText, newQuestion,
  questionResult, resultSummary, submitAsk, submittedLine, takeNote, toggleIndex,
} from "./exam";

const qs: ExamQuestion[] = [
  { id: "1", ord: 0, type: "single", prompt: "a", choices: ["x", "y"], points: 1 },
  { id: "2", ord: 1, type: "multi", prompt: "b", choices: ["x", "y", "z"], points: 2 },
  { id: "3", ord: 2, type: "ox", prompt: "c", choices: null, points: 1 },
  { id: "4", ord: 3, type: "short", prompt: "d", choices: null, points: 1 },
];

const view = (o: Partial<ExamView> = {}, viewer: Partial<ExamView["viewer"]> = {}): ExamView => ({
  today: "2026-10-12",
  node: { id: "311", title: "3주차 정리 시험", startDate: "2026-10-15", endDate: "2026-10-21", archived: false },
  exam: { status: "published", reveal: "after_submit", questionCount: 4, totalPoints: 5, publishedAt: "2026-10-12T00:00:00.000Z", closed: false },
  viewer: { canEdit: false, isAssignee: true, canTake: false, reason: null, ...viewer },
  questions: qs,
  attempt: null,
  ...o,
});

describe("answered — 서버 exam_is_answered 와 같은 규칙", () => {
  it("null·undefined·''·[] are unanswered; 0·false·[0]·'x' answered", () => {
    expect([null, undefined, "", []].map(isAnswered)).toEqual([false, false, false, false]);
    expect([0, false, [0], "x"].map(isAnswered)).toEqual([true, true, true, true]);
  });
  it("answeredCount", () => expect(answeredCount(qs, { 1: 0, 2: [], 3: false, 4: "", 9: "other" })).toBe(2));
});

describe("takeNote", () => {
  it.each<[ExamViewerReason, string | null]>([
    ["not_published", "아직 발행되지 않은 시험이에요"],
    ["not_started", "10.15 부터 풀 수 있어요"],
    ["archived", "보관된 시험이에요"],
    ["not_assignee", "담당 과제가 아니에요 · 제출 현황만 볼 수 있어요"],
    ["room_not_active", "스터디가 진행 중일 때 풀 수 있어요"],
    ["closed", "마감이 지나 해설이 공개된 시험은 제출할 수 없어요"],
    ["submitted", null],
  ])("%s → %s", (reason, text) => expect(takeNote(view({}, { reason }), false)).toBe(text));
  it("quiet hides not_assignee only", () => {
    expect(takeNote(view({}, { reason: "not_assignee" }), true)).toBeNull();
    expect(takeNote(view({}, { reason: "archived" }), true)).toBe("보관된 시험이에요");
  });
  it("canTake → null", () => expect(takeNote(view({}, { canTake: true }), false)).toBeNull());
});

const submitted = (o: Partial<ExamAttempt> = {}): ExamAttempt => ({
  status: "submitted", answers: { 1: 0, 2: [0, 2], 3: false, 4: null }, score: 4, maxScore: 5, correctCount: 3,
  submittedAt: "2026-10-18T12:03:00.000Z", isLate: false,
  results: { 1: { correct: true, earned: 1 }, 2: { correct: true, earned: 2 }, 3: { correct: true, earned: 1 }, 4: { correct: false, earned: 0 } }, ...o,
});

describe("resultSummary", () => {
  it("revealed → score + correct count", () =>
    expect(resultSummary(view({ attempt: submitted() }))).toEqual({ headline: "4/5점 (80%) · 3/4 문항 정답", sub: null }));
  it("after_deadline before close → score only + when it opens", () =>
    expect(resultSummary(view({ attempt: submitted({ results: null }) }))).toEqual({ headline: "4/5점 (80%)", sub: "정답·해설은 10.21 마감 뒤에 열려요" }));
  it("not submitted → empty", () => expect(resultSummary(view({ attempt: { ...submitted(), status: "in_progress", score: null } }))).toEqual({ headline: "", sub: null }));
  it("submittedLine (KST)", () => {
    expect(submittedLine(submitted())).toBe("10.18(일) 21:03 제출 · 기한 내");
    expect(submittedLine(submitted({ isLate: true }))).toBe("10.18(일) 21:03 제출 · 지각");
  });
});

describe("submitAsk", () => {
  it("with and without unanswered", () => {
    expect(submitAsk(2)).toBe("답하지 않은 2문항이 있어요 · 제출하면 다시 풀 수 없어요");
    expect(submitAsk(0)).toBe("제출하면 다시 풀 수 없어요");
  });
});

describe("questionResult", () => {
  it("multi revealed: mine, answer, correctness", () => {
    const q = { ...qs[1], answer: [0, 2], explanation: "e" };
    expect(questionResult(q, submitted({ results: { 2: { correct: false, earned: 0 } }, answers: { 2: [0] } }))).toEqual({ mine: [0], answer: [0, 2], correct: false, earned: 0 });
    expect(questionResult(q, submitted())).toEqual({ mine: [0, 2], answer: [0, 2], correct: true, earned: 2 });
  });
  it("before reveal: answer undefined, correct null", () =>
    expect(questionResult(qs[1], submitted({ results: null }))).toEqual({ mine: [0, 2], answer: undefined, correct: null, earned: null }));
  it("no attempt", () => expect(questionResult(qs[0], null)).toEqual({ mine: null, answer: undefined, correct: null, earned: null }));
});

describe("newQuestion defaults", () => {
  it("per type", () => {
    expect(newQuestion("single")).toEqual({ type: "single", prompt: "", choices: ["", "", "", ""], answer: 0, explanation: "", points: 1 });
    expect(newQuestion("multi")).toMatchObject({ choices: ["", "", "", ""], answer: [] });
    expect(newQuestion("ox")).toMatchObject({ choices: [], answer: true });
    expect(newQuestion("short")).toMatchObject({ choices: [], answer: [""] });
  });
});

describe("draftReduce", () => {
  const d: ExamDraft = { reveal: "after_submit", questions: [{ ...newQuestion("single"), prompt: "p", choices: ["a", "b", "c"], answer: 2 }, { ...newQuestion("ox"), prompt: "o" }] };
  it("unlocked edits", () => {
    expect(draftReduce(d, false, { type: "add", qtype: "short" }).questions).toHaveLength(3);
    expect(draftReduce(d, false, { type: "remove", i: 0 }).questions.map((q) => q.prompt)).toEqual(["o"]);
    expect(draftReduce(d, false, { type: "move", i: 0, dir: 1 }).questions.map((q) => q.prompt)).toEqual(["o", "p"]);
    expect(draftReduce(d, false, { type: "move", i: 1, dir: 1 })).toBe(d);
    expect(draftReduce(d, false, { type: "choiceRemove", i: 0, c: 0 }).questions[0]).toMatchObject({ choices: ["b", "c"], answer: 1 });
    expect(draftReduce(d, false, { type: "choiceRemove", i: 0, c: 2 }).questions[0]).toMatchObject({ choices: ["a", "b"], answer: 0 });
    expect(draftReduce(d, false, { type: "choiceAdd", i: 0 }).questions[0].choices).toHaveLength(4);
    expect(draftReduce(d, false, { type: "patch", i: 0, patch: { type: "multi" } }).questions[0]).toMatchObject({ type: "multi", prompt: "p", choices: ["a", "b", "c"], answer: [2] });
    expect(draftReduce(d, false, { type: "patch", i: 0, patch: { type: "short" } }).questions[0]).toMatchObject({ type: "short", prompt: "p", choices: [], answer: [""] });
    expect(draftReduce(d, false, { type: "setAnswer", i: 1, answer: false }).questions[1].answer).toBe(false);
    expect(d.questions[0].answer).toBe(2); // 불변
  });
  it("locked ignores structural changes, allows prompt/explanation/reveal", () => {
    for (const a of [
      { type: "add", qtype: "ox" }, { type: "remove", i: 0 }, { type: "move", i: 0, dir: 1 }, { type: "choiceAdd", i: 0 },
      { type: "choiceRemove", i: 0, c: 0 }, { type: "choiceSet", i: 0, c: 0, text: "z" }, { type: "setAnswer", i: 0, answer: 1 },
      { type: "patch", i: 0, patch: { type: "ox" } }, { type: "patch", i: 0, patch: { points: 3 } },
    ] as const) expect(draftReduce(d, true, a)).toBe(d);
    expect(draftReduce(d, true, { type: "patch", i: 0, patch: { prompt: "새 문제", explanation: "해설" } }).questions[0]).toMatchObject({ prompt: "새 문제", explanation: "해설", answer: 2 });
    expect(draftReduce(d, true, { type: "setReveal", reveal: "after_deadline" }).reveal).toBe("after_deadline");
  });
  it("draftDirty · toggleIndex", () => {
    expect(draftDirty(d, structuredClone(d))).toBe(false);
    expect(draftDirty(d, EMPTY_DRAFT)).toBe(true);
    expect(toggleIndex([2], 0)).toEqual([0, 2]);
    expect(toggleIndex([0, 2], 2)).toEqual([0]);
  });
});

describe("aiInstruction", () => {
  it("includes slug, task id and both tool names", () => {
    const t = aiInstruction("aws", "311", "3주차 정리 시험", { topic: "IAM·VPC", count: 10, types: ["single", "ox"], difficulty: "normal" });
    for (const s of ['"aws"', "311", "get_exam_brief", "create_exam_draft", "IAM·VPC", "10문항", "객관식·O/X", "보통"]) expect(t).toContain(s);
    expect(aiInstruction("aws", "311", "t", null)).toContain("먼저 물어보고");
  });
});

describe("misc", () => {
  it("lockText · examHead · isExamDraft", () => {
    expect(lockText(3)).toBe("3명이 제출해 문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요");
    expect(examHead({ status: "draft", questionCount: 4, totalPoints: 5, reveal: "after_submit" })).toBe("초안 · 4문항 · 5점");
    expect(examHead({ status: "draft" })).toBe("초안");
    expect([isExamDraft({ status: "draft" }), isExamDraft({ status: "published" }), isExamDraft(null), isExamDraft(undefined)]).toEqual([true, false, false, false]);
  });
  it("examErrorAction", () => {
    expect(examErrorAction({ code: "EXAM_CLOSED", message: "마감이 지나 해설이 공개된 시험은 제출할 수 없어요" })).toEqual({ kind: "refetch", text: "마감이 지나 해설이 공개된 시험은 제출할 수 없어요" });
    expect(examErrorAction({ code: "VALIDATION_FAILED", message: "보기는 2~8개예요", details: { field: "choices", index: 2 as unknown as string } })).toEqual({ kind: "field", field: "choices", index: 2, text: "보기는 2~8개예요" });
    expect(examErrorAction({ code: "EXAM_EMPTY", message: "EXAM_EMPTY" })).toEqual({ kind: "toast", text: "문항을 하나 이상 넣어야 발행할 수 있어요" });
    expect(examErrorAction({ code: "UNKNOWN", message: "fetch failed" }).kind).toBe("toast");
    expect(examErrorAction({ code: "AUTH_REQUIRED", message: "로그인" }).kind).toBe("login");
  });
});
