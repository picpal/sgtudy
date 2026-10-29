import type { ApiError } from "@/lib/api/errors";
import type { ExamDraft, ExamDraftQuestion } from "@/lib/api/exam";
import type { ExamAttempt, ExamBrief, ExamDifficulty, ExamQType, ExamQuestion, ExamResults, ExamReveal, ExamSummary, ExamView } from "@/lib/api/types";
import { dday, md, weekdayKo } from "@/lib/date";
import type { TaskStatus } from "@/lib/types";
import { notAssignedText, stampKst } from "./submission";

/* 회차 시험 순수 로직 (스펙 2026-10-21-round-exam-design §4). React·Supabase 무관 */

export const QTYPE_KO: Record<ExamQType, string> = { single: "객관식", multi: "복수 선택", ox: "O/X", short: "단답" };
export const REVEAL_KO: Record<ExamReveal, string> = { after_submit: "제출하면 바로", after_deadline: "마감 뒤" };
export const DIFFICULTY_KO: Record<ExamDifficulty, string> = { easy: "쉬움", normal: "보통", hard: "어려움" };

/** 서버 exam_is_answered 와 같은 규칙 — null·undefined·""·[] 는 답 아님 ("답함 n/총" = 저장 응답 answered) */
export const isAnswered = (a: unknown): boolean => a != null && a !== "" && !(Array.isArray(a) && a.length === 0);
export const answeredCount = (qs: ExamQuestion[], answers: Record<string, unknown>): number => qs.filter((q) => isAnswered(answers[q.id])).length;

/** 트리 요약 → 초안인가(편집 목록 "초안" 배지). warnings 는 변경 RPC 응답에서 덮이므로 이것으로 판정한다 */
export const isExamDraft = (e: ExamSummary | null | undefined): boolean => e?.status === "draft";

/** 편집 화면 머리 "초안 · 4문항 · 5점" (요약에 수가 없으면 상태만) */
export function examHead(e: ExamSummary): string {
  const st = e.status === "draft" ? "초안" : "발행됨";
  return e.questionCount == null ? st : `${st} · ${e.questionCount}문항 · ${e.totalPoints ?? 0}점`;
}

export const CLOSED_NOTE = "마감이 지나 해설이 공개된 시험은 제출할 수 없어요";
/** 정답 키를 받은 뒤 기간 연장·공개 시점 변경으로 다시 열린 시험(0053 EXAM_ANSWERS_SEEN) */
export const ANSWERS_SEEN_NOTE = "정답·해설을 이미 본 시험은 응시할 수 없어요";

/** 응시 화면 안내 문구(스펙 §4.3). 풀 수 있거나 제출했으면 null(결과 화면이 대신). personalQuiet = 담당 아님 문구를 숨기는 화면 */
export function takeNote(v: ExamView, personalQuiet: boolean): string | null {
  if (v.viewer.canTake) return null;
  switch (v.viewer.reason) {
    case "not_published": return "아직 발행되지 않은 시험이에요";
    case "not_started": return `${md(v.node.startDate)} 부터 풀 수 있어요`;
    case "archived": return "보관된 시험이에요";
    case "not_assignee": return personalQuiet ? null : notAssignedText(false);
    case "room_not_active": return "스터디가 진행 중일 때 풀 수 있어요";
    case "closed": return CLOSED_NOTE;
    case "answers_seen": return ANSWERS_SEEN_NOTE;
    default: return null;
  }
}

/** 시험 응시 카드 머리 배지 — 과제 제출 배지(myBadgeOf)와 같은 말. 담당이 아니거나 아직 풀 수 없는 상태(발행 전·스터디 대기·보관)는 없음 */
export function examBadgeOf(v: ExamView): { status: TaskStatus; text: string } | null {
  const a = v.attempt;
  if (a?.status === "submitted") return a.isLate ? { status: "late", text: "지각 제출" } : { status: "done", text: "기한내 제출" };
  if (!v.viewer.isAssignee) return null;
  const late = v.today > v.node.endDate;
  if (v.viewer.canTake) return late ? { status: "missed", text: "미제출 · 마감 지남" } : { status: "open", text: `응시 전 · ${dday(v.today, v.node.endDate)}` };
  if (v.viewer.reason === "not_started") return { status: "planned", text: "예정" };
  if (v.viewer.reason === "closed") return { status: "missed", text: "미제출 · 마감 지남" };
  if (v.viewer.reason === "answers_seen") return { status: "missed", text: "미제출 · 응시 불가" };
  return null;
}

/** 시험 응시 카드 머리 아래 한 줄 */
export const examPanelSub = (end: string): string => `문제를 풀고 여기서 제출해요 · 마감 ${md(end)}(${weekdayKo(end)})`;

const pctOf = (score: number, max: number) => (max > 0 ? Math.round((score / max) * 100) : 0);

/** 결과 카드 요약. 정오 공개 = "4/5점 (80%) · 3/4 문항 정답", after_deadline 마감 전 = 점수만 + "정답·해설은 MM.DD 마감 뒤에 열려요" */
export function resultSummary(v: ExamView): { headline: string; sub: string | null } {
  const a = v.attempt;
  if (!a || a.status !== "submitted" || a.score == null || a.maxScore == null) return { headline: "", sub: null };
  const score = `${a.score}/${a.maxScore}점 (${pctOf(a.score, a.maxScore)}%)`;
  if (a.results) {
    const total = v.questions?.length ?? v.exam.questionCount ?? Object.keys(a.results).length;
    return { headline: `${score} · ${a.correctCount ?? 0}/${total} 문항 정답`, sub: null };
  }
  return { headline: score, sub: `정답·해설은 ${md(v.node.endDate)} 마감 뒤에 열려요` };
}

/** "10.18(일) 21:03 제출 · 기한 내|지각" */
export const submittedLine = (a: Pick<ExamAttempt, "submittedAt" | "isLate">): string | null =>
  a.submittedAt ? `${stampKst(a.submittedAt)} 제출 · ${a.isLate ? "지각" : "기한 내"}` : null;

/** 편집자 결과 요약 줄 — "3/4 제출 · 평균 3.7/5 · 최고 5". 제출 0명이면 평균·최고 없음 */
export function resultsHead(r: Pick<ExamResults, "submitted" | "assigned" | "maxScore" | "avg" | "max">): string {
  const parts = [`${r.submitted}/${r.assigned} 제출`];
  if (r.avg != null) parts.push(`평균 ${Math.round(r.avg * 10) / 10}/${r.maxScore}`);
  if (r.max != null) parts.push(`최고 ${r.max}`);
  return parts.join(" · ");
}

/** 문항별 정답률 글자 — 제출 0명(null)이면 "—" */
export const rateText = (pct: number | null): string => (pct == null ? "—" : `${pct}%`);

const KST_YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
/** 제출 시각 → KST 날짜 "10.18" */
export const kstMd = (iso: string): string => md(KST_YMD.format(new Date(iso)));

/** 제출 확인 문구 */
export const submitAsk = (unanswered: number): string =>
  unanswered > 0 ? `답하지 않은 ${unanswered}문항이 있어요 · 제출하면 다시 풀 수 없어요` : "제출하면 다시 풀 수 없어요";

/** 문항별 결과(내 답·정답·정오). 공개 전이면 answer undefined · correct·earned null */
export function questionResult(q: ExamQuestion, a: ExamAttempt | null): { mine: unknown; answer: unknown; correct: boolean | null; earned: number | null } {
  const r = a?.results?.[q.id];
  return { mine: a?.answers[q.id] ?? null, answer: q.answer, correct: r ? r.correct : null, earned: r ? r.earned : null };
}

/** 편집 화면 잠금 문구 — 서버 locked(응시 행 1건~). 제출 0명이면 응시 중 문구 */
export const lockText = (n: number) => `${n}명이 제출해 문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요`;
export const lockTextStarted = "응시가 시작돼 문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요";
/** [초안으로] 비활성 이유 — 잠금 문구와 같은 주어(제출 n명 / 응시 시작) */
export const unpublishLockText = (n: number) => `${n > 0 ? `${n}명이 제출해` : "응시가 시작돼"} 초안으로 되돌릴 수 없어요`;

/** AI 탭 지시문(스펙 §4.2) — 사용자가 Claude Code 등에 붙여 넣는다. 도구 이름은 서버 계약 문구(create_exam_draft)와 같다 */
export function aiInstruction(slug: string, nodeId: string, title: string, brief: ExamBrief | null): string {
  const where = `study: "${slug}", task: "${nodeId}"`;
  const lines = [`sgtudy 의 "${slug}" 스터디 과제 「${title}」(task ${nodeId}) 의 시험 문제를 만들어 줘.`, `1. get_exam_brief 도구로 브리프와 문항 규칙을 읽어 (${where}).`];
  if (brief) {
    const types = brief.types.map((t) => QTYPE_KO[t]).join("·");
    lines.push(`2. 브리프(주제 "${brief.topic}" · ${brief.count}문항 · ${types} · 난이도 ${DIFFICULTY_KO[brief.difficulty]})에 맞춰 문제·정답·해설을 한국어로 만들어.`);
  } else {
    lines.push("2. 브리프가 아직 없으면 주제와 문항 수를 나에게 먼저 물어보고, 문제·정답·해설을 한국어로 만들어.");
  }
  lines.push(`3. create_exam_draft 도구로 초안을 저장해 (${where}). 발행은 내가 웹에서 검토한 뒤에 할게.`);
  return lines.join("\n");
}

/* ---------- 출제 초안 편집 ---------- */

export const EMPTY_DRAFT: ExamDraft = { reveal: "after_submit", questions: [] };

export function newQuestion(type: ExamQType): ExamDraftQuestion {
  const base = { prompt: "", explanation: "", points: 1 };
  if (type === "single") return { ...base, type, choices: ["", "", "", ""], answer: 0 };
  if (type === "multi") return { ...base, type, choices: ["", "", "", ""], answer: [] };
  if (type === "ox") return { ...base, type, choices: [], answer: true };
  return { ...base, type, choices: [], answer: [""] };
}

export const draftDirty = (a: ExamDraft, b: ExamDraft): boolean => JSON.stringify(a) !== JSON.stringify(b);

export const draftTotals = (d: ExamDraft) => ({ count: d.questions.length, points: d.questions.reduce((s, q) => s + q.points, 0) });

export type DraftAction =
  | { type: "add"; qtype: ExamQType }
  | { type: "remove"; i: number }
  | { type: "move"; i: number; dir: -1 | 1 }
  /** 유형 변경은 보기·정답을 새 유형 기본값으로(객관식↔복수는 보기 유지·정답 변환) */
  | { type: "patch"; i: number; patch: Partial<Pick<ExamDraftQuestion, "type" | "prompt" | "explanation" | "points">> }
  | { type: "choiceAdd"; i: number }
  | { type: "choiceRemove"; i: number; c: number }
  | { type: "choiceSet"; i: number; c: number; text: string }
  | { type: "setAnswer"; i: number; answer: ExamDraftQuestion["answer"] }
  | { type: "setReveal"; reveal: ExamReveal };

const STRUCTURAL = new Set<DraftAction["type"]>(["add", "remove", "move", "choiceAdd", "choiceRemove", "choiceSet", "setAnswer"]);

function retype(q: ExamDraftQuestion, type: ExamQType): ExamDraftQuestion {
  if (type === q.type) return q;
  const fresh = { ...newQuestion(type), prompt: q.prompt, explanation: q.explanation, points: q.points };
  if (type === "multi" && q.type === "single") return { ...fresh, choices: q.choices, answer: [q.answer as number] };
  if (type === "single" && q.type === "multi") return { ...fresh, choices: q.choices, answer: (q.answer as number[])[0] ?? 0 };
  return fresh;
}

/** 보기 c 를 지운 뒤 정답 번호를 맞춘다(지운 보기가 정답이면 단일은 0, 복수는 뺀다) */
function dropChoice(q: ExamDraftQuestion, c: number): ExamDraftQuestion {
  const choices = q.choices.filter((_, k) => k !== c);
  const shift = (x: number) => (x > c ? x - 1 : x);
  if (q.type === "single") return { ...q, choices, answer: q.answer === c ? 0 : shift(q.answer as number) };
  return { ...q, choices, answer: (q.answer as number[]).filter((x) => x !== c).map(shift) };
}

/** 초안 편집 리듀서(불변). 구조 잠금이면 유형·보기·정답·배점·추가·삭제·이동을 무시(그대로 반환) — 문제 글·해설·공개 시점만 */
export function draftReduce(d: ExamDraft, locked: boolean, action: DraftAction): ExamDraft {
  if (locked && STRUCTURAL.has(action.type)) return d;
  const qs = d.questions;
  const upd = (i: number, f: (q: ExamDraftQuestion) => ExamDraftQuestion): ExamDraft =>
    i < 0 || i >= qs.length ? d : { ...d, questions: qs.map((q, k) => (k === i ? f(q) : q)) };
  switch (action.type) {
    case "add":
      return qs.length >= 50 ? d : { ...d, questions: [...qs, newQuestion(action.qtype)] };
    case "remove":
      return action.i < 0 || action.i >= qs.length ? d : { ...d, questions: qs.filter((_, k) => k !== action.i) };
    case "move": {
      const j = action.i + action.dir;
      if (action.i < 0 || action.i >= qs.length || j < 0 || j >= qs.length) return d;
      const next = [...qs];
      [next[action.i], next[j]] = [next[j], next[action.i]];
      return { ...d, questions: next };
    }
    case "patch": {
      const p = action.patch;
      if (locked && (p.type !== undefined || p.points !== undefined)) return d;
      return upd(action.i, (q) => {
        const t = p.type !== undefined ? retype(q, p.type) : q;
        return { ...t, ...(p.prompt !== undefined && { prompt: p.prompt }), ...(p.explanation !== undefined && { explanation: p.explanation }), ...(p.points !== undefined && { points: p.points }) };
      });
    }
    case "choiceAdd":
      return upd(action.i, (q) => (q.choices.length >= 8 || (q.type !== "single" && q.type !== "multi") ? q : { ...q, choices: [...q.choices, ""] }));
    case "choiceRemove":
      return upd(action.i, (q) => (q.choices.length <= 2 || action.c < 0 || action.c >= q.choices.length ? q : dropChoice(q, action.c)));
    case "choiceSet":
      return upd(action.i, (q) => (action.c < 0 || action.c >= q.choices.length ? q : { ...q, choices: q.choices.map((x, k) => (k === action.c ? action.text : x)) }));
    case "setAnswer":
      return upd(action.i, (q) => ({ ...q, answer: action.answer }));
    case "setReveal":
      return { ...d, reveal: action.reveal };
  }
}

/** 복수 선택 정답 토글(정렬 유지) — setAnswer 에 넘길 값 */
export const toggleIndex = (xs: number[], c: number): number[] => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c].sort((a, b) => a - b));

/* ---------- 오류 → 화면 동작 ---------- */

/** 0037 오류 코드 기본 문구(서버 문구가 정본 — 문구가 비었을 때만) */
export const EXAM_ERROR_KO: Record<string, string> = {
  EXAM_NODE: "시험 과제는 시험 화면에서 제출해요",
  EXAM_NOT_FOUND: "시험이 없는 과제예요",
  EXAM_NOT_PUBLISHED: "아직 발행되지 않은 시험이에요",
  EXAM_LOCKED: "응시가 시작돼 문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요",
  EXAM_EMPTY: "문항을 하나 이상 넣어야 발행할 수 있어요",
  EXAM_PUBLISHED: "발행된 시험이에요 · 초안으로 되돌린 뒤 고쳐 주세요",
  EXAM_ALREADY_SUBMITTED: "이미 제출한 시험이에요",
  EXAM_CLOSED: CLOSED_NOTE,
  EXAM_ANSWERS_SEEN: ANSWERS_SEEN_NOTE,
  NODE_HAS_SUBMISSIONS: "제출물이 있는 과제는 시험으로 바꿀 수 없어요",
  VALIDATION_FAILED: "입력 내용을 확인해 주세요",
};

export type ExamErrorAction =
  | { kind: "refetch"; text: string }
  | { kind: "field"; field: string; index: number | null; text: string }
  | { kind: "login"; text: string }
  | { kind: "toast"; text: string };

/** 상태가 바뀌어 화면을 다시 불러와야 하는 코드(발행 취소·마감·제출됨·담당 해제·보관·문항 교체 NOT_FOUND 등) */
const EXAM_REFETCH = new Set([
  "EXAM_NOT_FOUND", "NOT_FOUND", "EXAM_NOT_PUBLISHED", "EXAM_CLOSED", "EXAM_ANSWERS_SEEN", "EXAM_ALREADY_SUBMITTED", "EXAM_LOCKED", "EXAM_PUBLISHED",
  "TASK_NOT_ASSIGNED", "TASK_ARCHIVED", "PARENT_ARCHIVED", "ROOM_NOT_ACTIVE", "TASK_NOT_STARTED", "NODE_NOT_FOUND",
]);

const textOf = (e: ApiError): string => (e.message && e.message !== e.code ? e.message : (EXAM_ERROR_KO[e.code] ?? e.message));

/** exam_* 실패 → 화면 동작 */
export function examErrorAction(e: ApiError): ExamErrorAction {
  if (EXAM_REFETCH.has(e.code)) return { kind: "refetch", text: textOf(e) };
  if (e.code === "VALIDATION_FAILED") {
    const idx = e.details?.index;
    const index = idx != null && Number.isInteger(Number(idx)) ? Number(idx) : null;
    return { kind: "field", field: e.details?.field ? String(e.details.field) : "", index, text: textOf(e) };
  }
  if (e.code === "AUTH_REQUIRED") return { kind: "login", text: e.message };
  if (e.code === "UNKNOWN") return { kind: "toast", text: "저장하지 못했어요 · 연결을 확인하고 다시 시도해 주세요" };
  return { kind: "toast", text: textOf(e) };
}
