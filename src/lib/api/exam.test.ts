import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import {
  examNorm, fetchExam, fetchExamAttempt, fetchExamResults, parseExamJson, publishExam, putExam, putExamBrief, saveExamAnswer, submitExam, toContract, toDraft, validateDraft,
  type ExamDraft, type ExamDraftQuestion,
} from "./exam";
import type { ExamView } from "./types";

const fake = () => {
  const calls: [string, unknown][] = [];
  const client = { rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve({ data: {}, error: null }); } } as unknown as Db;
  return { calls, client };
};

const single = (o: Partial<ExamDraftQuestion> = {}): ExamDraftQuestion => ({ type: "single", prompt: "IAM?", choices: ["a", "b", "c"], answer: 1, explanation: "", points: 1, ...o });

describe("exam adapter — RPC 이름·인자(0037)", () => {
  it("each call maps to the SQL signature", async () => {
    const f = fake();
    const d: ExamDraft = { reveal: "after_deadline", questions: [single()] };
    await fetchExam("aws", "311", f.client);
    await putExam("aws", "311", d, f.client);
    await publishExam("aws", "311", true, f.client);
    await publishExam("aws", "311", false, f.client);
    await putExamBrief("aws", "311", { topic: "IAM", count: 5, types: ["single"], difficulty: "easy" }, f.client);
    await saveExamAnswer("311", "9", [0, 2], f.client);
    await submitExam("311", f.client);
    await fetchExamResults("aws", "311", f.client);
    await fetchExamAttempt("aws", "311", "u-1", f.client);
    expect(f.calls).toEqual([
      ["exam_get", { p_slug: "aws", p_node: 311 }],
      ["exam_put", { p_slug: "aws", p_node: 311, p_exam: toContract(d) }],
      ["exam_publish", { p_slug: "aws", p_node: 311 }],
      ["exam_unpublish", { p_slug: "aws", p_node: 311 }],
      ["exam_brief_put", { p_slug: "aws", p_node: 311, p_brief: { topic: "IAM", count: 5, types: ["single"], difficulty: "easy" } }],
      ["exam_answer_save", { p_node: 311, p_question: 9, p_answer: [0, 2] }],
      ["exam_submit", { p_node: 311 }],
      ["exam_results", { p_slug: "aws", p_node: 311 }],
      ["exam_attempt_get", { p_slug: "aws", p_node: 311, p_user: "u-1" }],
    ]);
  });
});

describe("toContract", () => {
  it("keeps choices for single/multi, drops them for ox/short, trims short answers and drops blanks", () => {
    const c = toContract({
      reveal: "after_submit",
      questions: [
        single(),
        { type: "multi", prompt: "m", choices: ["a", "b"], answer: [0, 1], explanation: "e", points: 2 },
        { type: "ox", prompt: "o", choices: [], answer: false, explanation: "", points: 1 },
        { type: "short", prompt: "s", choices: [], answer: ["  IGW ", "", "  "], explanation: "", points: 1 },
      ],
    });
    expect(c.reveal).toBe("after_submit");
    expect(c.questions[0]).toEqual({ type: "single", prompt: "IAM?", choices: ["a", "b", "c"], answer: 1, explanation: "", points: 1 });
    expect(c.questions[1]).toMatchObject({ choices: ["a", "b"], answer: [0, 1] });
    expect(c.questions[2]).not.toHaveProperty("choices");
    expect(c.questions[3]).toEqual({ type: "short", prompt: "s", answer: ["  IGW "], explanation: "", points: 1 });
  });
  it("round-trips a loaded exam byte-identically (잠금 뒤 같은 구조 재저장 = exam_struct_key 동일)", () => {
    const qs = [
      { id: "1", ord: 0, type: "short" as const, prompt: "p", choices: null, points: 1, answer: [" IGW ", "Internet Gateway"], explanation: "e" },
      { id: "2", ord: 1, type: "single" as const, prompt: "q", choices: [" a ", "b"], points: 2, answer: 1, explanation: "" },
    ];
    const v = { exam: { status: "published", reveal: "after_submit", publishedAt: null, closed: false }, questions: qs } as unknown as ExamView;
    const key = (xs: unknown[]) => JSON.stringify(xs.map((q) => { const o = q as Record<string, unknown>; return [o.type, o.choices ?? null, o.answer, o.points]; }));
    expect(key(toContract(toDraft(v)).questions)).toBe(key(qs));
  });
});

describe("toDraft", () => {
  const view = (questions: ExamView["questions"]): ExamView => ({
    today: "2026-10-12", node: { id: "311", title: "t", startDate: "2026-10-15", endDate: "2026-10-21", archived: false },
    exam: { status: "draft", reveal: "after_deadline", questionCount: 2, totalPoints: 2, publishedAt: null, closed: false },
    viewer: { canEdit: true, isAssignee: false, canTake: false, reason: "not_assignee", answersSeen: false, canOpenAnswers: false }, questions, attempt: null,
  });
  it("editor shape → draft sorted by ord; null choices → []", () => {
    const d = toDraft(view([
      { id: "2", ord: 1, type: "ox", prompt: "o", choices: null, points: 1, answer: true, explanation: "x" },
      { id: "1", ord: 0, type: "single", prompt: "s", choices: ["a", "b"], points: 1, answer: 0, explanation: "" },
    ]));
    expect(d).toEqual({ reveal: "after_deadline", questions: [
      { type: "single", prompt: "s", choices: ["a", "b"], answer: 0, explanation: "", points: 1 },
      { type: "ox", prompt: "o", choices: [], answer: true, explanation: "x", points: 1 },
    ] });
  });
  it("no answer key (not editor) → empty draft", () => {
    expect(toDraft(view([{ id: "1", ord: 0, type: "single", prompt: "s", choices: ["a", "b"], points: 1 }])).questions).toEqual([]);
    expect(toDraft(view(null)).questions).toEqual([]);
  });
});

describe("examNorm ≈ SQL exam_norm", () => {
  it("strips ASCII and Unicode punctuation/symbols, collapses spaces", () => {
    expect(examNorm("  IGW . ")).toBe("igw");
    expect(examNorm("인터넷·게이트웨이")).toBe("인터넷게이트웨이");
    expect(examNorm("“Internet”  Gateway…")).toBe("internet gateway");
    expect(examNorm("₩1,000 + 2")).toBe("1000 2");
  });
});

describe("validateDraft — 서버 exam_validate 와 같은 문구, 첫 오류만", () => {
  it("valid draft → null", () => expect(validateDraft({ reveal: "after_submit", questions: [single()] })).toBeNull());
  it.each<[Partial<ExamDraftQuestion>, string, string]>([
    [{ prompt: "  " }, "prompt", "문제는 1~2,000자예요"],
    [{ prompt: "x".repeat(2001) }, "prompt", "문제는 1~2,000자예요"],
    [{ explanation: "x".repeat(4001) }, "explanation", "해설은 4,000자까지예요"],
    [{ points: 0 }, "points", "배점은 1~10점이에요"],
    [{ points: 1.5 }, "points", "배점은 1~10점이에요"],
    [{ choices: ["a"] }, "choices", "보기는 2~8개예요"],
    [{ choices: ["a", " "] }, "choices", "보기는 1~200자예요"],
    [{ answer: 3 }, "answer", "정답은 보기 번호(0부터) 하나예요"],
    [{ type: "multi", answer: [] }, "answer", "정답은 보기 번호 배열이에요"],
    [{ type: "multi", answer: [0, 0] }, "answer", "정답 번호가 보기 범위를 벗어나거나 겹쳐요"],
    [{ type: "ox", choices: [], answer: 1 }, "answer", "OX 정답은 true/false 예요"],
    [{ type: "short", choices: [], answer: ["", " "] }, "answer", "단답 정답은 허용 답 1~10개예요"],
    [{ type: "short", choices: [], answer: ["..."] }, "answer", "허용 답은 1~200자예요"],
  ])("%j → %s", (o, field, message) => {
    expect(validateDraft({ reveal: "after_submit", questions: [single(), single(o)] })).toEqual({ index: 1, field, message });
  });
  it("51 questions → questions error", () =>
    expect(validateDraft({ reveal: "after_submit", questions: Array.from({ length: 51 }, () => single()) })).toEqual({ index: -1, field: "questions", message: "문항은 50개까지예요" }));
});

describe("parseExamJson", () => {
  const body = JSON.stringify({ questions: [{ type: "single", prompt: "p", choices: ["a", "b"], answer: 1 }, { type: "OX", prompt: "o", answer: false, explanation: "e", points: 2 }] });
  it("strips a ```json code block and surrounding prose; fills defaults", () => {
    const r = parseExamJson(`여기 초안이에요:\n\`\`\`json\n${body}\n\`\`\`\n검토해 주세요.`, "after_deadline");
    expect(r).toEqual({ ok: true, draft: { reveal: "after_deadline", questions: [
      { type: "single", prompt: "p", choices: ["a", "b"], answer: 1, explanation: "", points: 1 },
      { type: "ox", prompt: "o", choices: [], answer: false, explanation: "e", points: 2 },
    ] } });
  });
  it("reveal in JSON wins when valid", () => {
    const r = parseExamJson(JSON.stringify({ reveal: "after_submit", questions: [{ type: "ox", prompt: "o", answer: true }] }), "after_deadline");
    expect(r.ok && r.draft.reveal).toBe("after_submit");
  });
  const err = (qs: unknown[]) => parseExamJson(JSON.stringify({ questions: qs }), "after_submit");
  it("51 questions → 한국어 오류", () => expect(err(Array.from({ length: 51 }, () => ({ type: "ox", prompt: "o", answer: true })))).toEqual({ ok: false, error: "문항은 50개까지예요" }));
  it("one choice → 보기 오류(번호 포함)", () =>
    expect(err([{ type: "ox", prompt: "o", answer: true }, { type: "single", prompt: "p", choices: ["a"], answer: 0 }])).toEqual({ ok: false, error: "2번 문항 · 보기는 2~8개예요" }));
  it("answer out of range", () => expect(err([{ type: "single", prompt: "p", choices: ["a", "b"], answer: 2 }])).toEqual({ ok: false, error: "1번 문항 · 정답은 보기 번호(0부터) 하나예요" }));
  it("unknown type", () => expect(err([{ type: "essay", prompt: "p", answer: "x" }])).toEqual({ ok: false, error: "1번 문항 · 문항 유형은 single·multi·ox·short 예요" }));
  it("wrong answer shape for type", () => expect(err([{ type: "short", prompt: "p", answer: "IGW" }])).toEqual({ ok: false, error: "1번 문항 · 단답 정답은 허용 답 1~10개예요" }));
  it("no JSON / broken JSON / no questions / empty", () => {
    expect(parseExamJson("그냥 글", "after_submit").ok).toBe(false);
    expect(parseExamJson("{ questions: [ }", "after_submit")).toMatchObject({ ok: false, error: expect.stringContaining("JSON 형식") });
    expect(parseExamJson("{}", "after_submit")).toEqual({ ok: false, error: "questions 배열이 없어요" });
    expect(err([])).toEqual({ ok: false, error: "가져올 문항이 없어요" });
  });
});
