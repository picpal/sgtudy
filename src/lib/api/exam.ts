import { rpc, type Db } from "./errors";
import type { ExamAnswerSaved, ExamBrief, ExamQType, ExamResults, ExamReveal, ExamView } from "./types";

/* 회차 시험 어댑터 (0037_round_exam.sql). 컴포넌트는 이 파일만 부른다 (D13) */
const num = (id: string) => Number(id);

/** 편집 초안 — 화면이 고치는 모양. ox·short 도 choices 는 [] (계약으로 바꿀 때 뺀다) */
export type ExamDraftQuestion = { type: ExamQType; prompt: string; choices: string[]; answer: number | number[] | boolean | string[]; explanation: string; points: number };
export type ExamDraft = { reveal: ExamReveal; questions: ExamDraftQuestion[] };

export const fetchExam = (slug: string, nodeId: string, client?: Db) => rpc<ExamView>("exam_get", { p_slug: slug, p_node: num(nodeId) }, client);
export const putExam = (slug: string, nodeId: string, draft: ExamDraft, client?: Db) =>
  rpc<ExamView>("exam_put", { p_slug: slug, p_node: num(nodeId), p_exam: toContract(draft) }, client);
export const publishExam = (slug: string, nodeId: string, on: boolean, client?: Db) =>
  rpc<ExamView>(on ? "exam_publish" : "exam_unpublish", { p_slug: slug, p_node: num(nodeId) }, client);
export const putExamBrief = (slug: string, nodeId: string, brief: ExamBrief, client?: Db) =>
  rpc<ExamView>("exam_brief_put", { p_slug: slug, p_node: num(nodeId), p_brief: brief }, client);
export const saveExamAnswer = (nodeId: string, questionId: string, answer: unknown, client?: Db) =>
  rpc<ExamAnswerSaved>("exam_answer_save", { p_node: num(nodeId), p_question: num(questionId), p_answer: answer }, client);
export const submitExam = (nodeId: string, client?: Db) => rpc<ExamView>("exam_submit", { p_node: num(nodeId) }, client);
export const fetchExamResults = (slug: string, nodeId: string, client?: Db) => rpc<ExamResults>("exam_results", { p_slug: slug, p_node: num(nodeId) }, client);
/** 편집자가 남의 답안 보기 — viewer 는 그 사람 기준, canTake 는 항상 false */
export const fetchExamAttempt = (slug: string, nodeId: string, userId: string, client?: Db) =>
  rpc<ExamView>("exam_attempt_get", { p_slug: slug, p_node: num(nodeId), p_user: userId }, client);

/* ---------- 초안 ↔ 계약(sgtudy.exam/v1) ---------- */

export const EXAM_LIMITS = { questions: 50, prompt: 2000, explanation: 4000, choicesMin: 2, choicesMax: 8, choice: 200, shortAnswers: 10, shortAnswer: 200, pointsMin: 1, pointsMax: 10 } as const;
const QTYPES: readonly ExamQType[] = ["single", "multi", "ox", "short"];
const hasChoices = (t: ExamQType) => t === "single" || t === "multi";

/** 서버 ExamView.questions(편집자 모양) → 편집 초안. 정답 키가 없으면(편집자 아님) 빈 초안 */
export function toDraft(v: ExamView): ExamDraft {
  const reveal = v.exam.reveal ?? "after_submit";
  const qs = v.questions ?? [];
  if (qs.some((q) => !("answer" in q))) return { reveal, questions: [] };
  return {
    reveal,
    questions: [...qs].sort((a, b) => a.ord - b.ord).map((q) => ({
      type: q.type,
      prompt: q.prompt,
      choices: q.choices ?? [],
      answer: q.answer as ExamDraftQuestion["answer"],
      explanation: q.explanation ?? "",
      points: q.points,
    })),
  };
}

/** 초안 → sgtudy.exam/v1 (서버 exam_validate 입력). single/multi 만 choices, short 허용 답은 trim·빈 값 제거 */
export function toContract(d: ExamDraft): { reveal: ExamReveal; questions: unknown[] } {
  return {
    reveal: d.reveal,
    questions: d.questions.map((q) => {
      const answer = q.type === "short" && Array.isArray(q.answer) ? (q.answer as string[]).map((a) => a.trim()).filter((a) => a !== "") : q.answer;
      const base = { type: q.type, prompt: q.prompt, answer, explanation: q.explanation, points: q.points };
      return hasChoices(q.type) ? { ...base, choices: q.choices } : base;
    }),
  };
}

/** 서버 exam_norm 근사: NFC·소문자·앞뒤 공백·구두점 제거·연속 공백 1칸 (클라이언트 사전 검사용) */
export const examNorm = (s: string) =>
  s.normalize("NFC").trim().toLowerCase().replace(/[!-/:-@[-`{-~]/g, "").replace(/\s+/g, " ").trim();

const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

/** 저장 전 클라이언트 검증 — 서버 exam_validate 와 같은 순서·문구. 첫 오류만. 문항 수 초과는 index -1 */
export function validateDraft(d: ExamDraft): { index: number; field: string; message: string } | null {
  if (d.questions.length > EXAM_LIMITS.questions) return { index: -1, field: "questions", message: "문항은 50개까지예요" };
  for (let i = 0; i < d.questions.length; i++) {
    const q = d.questions[i];
    const bad = (field: string, message: string) => ({ index: i, field, message });
    if (!QTYPES.includes(q.type)) return bad("type", "문항 유형은 single·multi·ox·short 예요");
    if (typeof q.prompt !== "string" || q.prompt.trim().length < 1 || q.prompt.length > EXAM_LIMITS.prompt) return bad("prompt", "문제는 1~2,000자예요");
    if ((q.explanation ?? "").length > EXAM_LIMITS.explanation) return bad("explanation", "해설은 4,000자까지예요");
    if (!isInt(q.points) || q.points < EXAM_LIMITS.pointsMin || q.points > EXAM_LIMITS.pointsMax) return bad("points", "배점은 1~10점이에요");
    const a: unknown = q.answer;
    if (hasChoices(q.type)) {
      const n = q.choices.length;
      if (n < EXAM_LIMITS.choicesMin || n > EXAM_LIMITS.choicesMax) return bad("choices", "보기는 2~8개예요");
      if (q.choices.some((c) => typeof c !== "string" || c.trim().length < 1 || c.length > EXAM_LIMITS.choice)) return bad("choices", "보기는 1~200자예요");
      if (q.type === "single") {
        if (!isInt(a) || a < 0 || a >= n) return bad("answer", "정답은 보기 번호(0부터) 하나예요");
      } else {
        if (!Array.isArray(a) || a.length < 1) return bad("answer", "정답은 보기 번호 배열이에요");
        if (a.some((x) => !isInt(x) || x < 0 || x >= n) || new Set(a).size !== a.length) return bad("answer", "정답 번호가 보기 범위를 벗어나거나 겹쳐요");
      }
    } else if (q.type === "ox") {
      if (typeof a !== "boolean") return bad("answer", "OX 정답은 true/false 예요");
    } else {
      const xs = Array.isArray(a) ? a.filter((x) => typeof x !== "string" || x.trim() !== "") : null;
      if (!xs || xs.length < 1 || xs.length > EXAM_LIMITS.shortAnswers) return bad("answer", "단답 정답은 허용 답 1~10개예요");
      if (xs.some((x) => typeof x !== "string" || examNorm(x).length < 1 || x.trim().length > EXAM_LIMITS.shortAnswer)) return bad("answer", "허용 답은 1~200자예요");
    }
  }
  return null;
}

/** JSON 붙여넣기 가져오기 실패 문구 — "n번 문항 · 서버 문구" */
const at = (i: number, m: string) => (i < 0 ? m : `${i + 1}번 문항 · ${m}`);

/** 원시 문항 1개 → 초안 문항(모양만 맞춘다 — 범위·길이는 validateDraft). 모양이 틀리면 한국어 오류 */
function rawToQuestion(raw: unknown, i: number): ExamDraftQuestion | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return at(i, "문항 유형은 single·multi·ox·short 예요");
  const o = raw as Record<string, unknown>;
  const type = typeof o.type === "string" ? (o.type.toLowerCase() as ExamQType) : null;
  if (!type || !QTYPES.includes(type)) return at(i, "문항 유형은 single·multi·ox·short 예요");
  if (typeof o.prompt !== "string") return at(i, "문제는 1~2,000자예요");
  if (o.explanation != null && typeof o.explanation !== "string") return at(i, "해설은 4,000자까지예요");
  if (o.points != null && !isInt(o.points)) return at(i, "배점은 1~10점이에요");
  let choices: string[] = [];
  if (hasChoices(type)) {
    if (!Array.isArray(o.choices) || o.choices.some((c) => typeof c !== "string")) return at(i, "보기는 2~8개예요");
    choices = o.choices as string[];
  }
  const a = o.answer;
  const okAnswer =
    type === "single" ? typeof a === "number"
    : type === "multi" ? Array.isArray(a) && a.every((x) => typeof x === "number")
    : type === "ox" ? typeof a === "boolean"
    : Array.isArray(a) && a.every((x) => typeof x === "string");
  if (!okAnswer) {
    const m = { single: "정답은 보기 번호(0부터) 하나예요", multi: "정답은 보기 번호 배열이에요", ox: "OX 정답은 true/false 예요", short: "단답 정답은 허용 답 1~10개예요" }[type];
    return at(i, m);
  }
  return { type, prompt: o.prompt, choices, answer: a as ExamDraftQuestion["answer"], explanation: (o.explanation as string | undefined) ?? "", points: (o.points as number | undefined) ?? 1 };
}

/**
 * JSON 붙여넣기 가져오기(스펙 §4.2 AI 탭 · MCP 없는 경로). 첫 '{' 부터 마지막 '}' 까지만 읽어 ```json 코드블록·앞뒤 설명을 허용.
 * 서버 규칙의 클라이언트 사전 검사(유형·모양·개수·길이·범위). reveal 은 JSON 에 올바른 값이 있으면 그것, 아니면 인자
 */
export function parseExamJson(text: string, reveal: ExamReveal): { ok: true; draft: ExamDraft } | { ok: false; error: string } {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < s) return { ok: false, error: "JSON 을 찾지 못했어요 · { 로 시작하는 내용을 붙여 넣어 주세요" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(s, e + 1));
  } catch {
    return { ok: false, error: "JSON 형식이 올바르지 않아요 · AI 가 준 내용을 그대로 붙여 넣어 주세요" };
  }
  const obj = parsed as { questions?: unknown; reveal?: unknown };
  if (!Array.isArray(obj.questions)) return { ok: false, error: "questions 배열이 없어요" };
  if (obj.questions.length < 1) return { ok: false, error: "가져올 문항이 없어요" };
  if (obj.questions.length > EXAM_LIMITS.questions) return { ok: false, error: "문항은 50개까지예요" };
  const questions: ExamDraftQuestion[] = [];
  for (let i = 0; i < obj.questions.length; i++) {
    const q = rawToQuestion(obj.questions[i], i);
    if (typeof q === "string") return { ok: false, error: q };
    questions.push(q);
  }
  const draft: ExamDraft = { reveal: obj.reveal === "after_submit" || obj.reveal === "after_deadline" ? obj.reveal : reveal, questions };
  const bad = validateDraft(draft);
  return bad ? { ok: false, error: at(bad.index, bad.message) } : { ok: true, draft };
}
