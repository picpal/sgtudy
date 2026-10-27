import type { ApiError } from "@/lib/api/errors";
import type {
  ExamQuestion, WrongNote, WrongNoteExam, WrongNoteItem, WrongNoteMine, WrongNotePracticeResult, WrongNoteRound, WrongNoteTotals,
} from "@/lib/api/types";
import { md } from "@/lib/date";
import type { Tone } from "@/lib/palette";
import { isAnswered } from "./exam";

/* 오답노트 순수 로직 (스펙 2026-10-23-wrong-answer-note-design §6). React·Supabase 무관.
 * 방 탭(스터디 1개)과 내 과제 「오답노트」 보기(여러 개)가 같은 함수를 쓴다 — 전부 NoteStudy[] 기준.
 * 정오는 계산하지 않는다(채점은 서버 exam_grade 하나, D6) — 연습 응답을 목록에 합칠 뿐이다 */

/** 화면 공용 모양. title·tone 은 내 과제 보기에서만(방 탭은 스터디 머리줄이 없다) */
export type NoteStudy = { slug: string; title?: string; tone?: Tone; hasExam: boolean; rounds: WrongNoteRound[] };

export const toNoteStudies = (v: WrongNote, slug: string): NoteStudy[] => [{ slug, hasExam: v.hasExam, rounds: v.rounds }];
export const toNoteStudiesMine = (m: WrongNoteMine): NoteStudy[] =>
  m.studies.map((s) => ({ slug: s.slug, title: s.title, tone: s.tone, hasExam: s.hasExam, rounds: s.rounds }));

/* ---------- 필터 (D11) ---------- */

export type Filter = "all" | "open" | "retriedOk";
export const FILTERS: readonly Filter[] = ["all", "open", "retriedOk"];
export const FILTER_KO: Record<Filter, string> = { all: "전체", open: "아직 못 맞힘", retriedOk: "다시 풀어 맞힘" };

const retriedOk = (it: WrongNoteItem) => it.practice?.lastCorrect === true;
const passes = (it: WrongNoteItem, filter: Filter, showMastered: boolean) =>
  (showMastered || !it.mastered) && (filter === "all" || (filter === "retriedOk" ? retriedOk(it) : !retriedOk(it)));

/**
 * 필터 적용. studySlug 가 목록에 있는 slug 면 그 스터디만(모르는 slug = "all" — calc.normalizeFilter 와 같은 취급).
 * 빈 시험·빈 회차는 빼고 스터디 섹션은 남긴다(섹션 단위 빈 줄은 studyEmptyLine). 잠긴 시험은 「다시 풀어 맞힘」 에서만 빠진다(아직 못 맞힌 문항이다)
 */
export function applyFilter(studies: NoteStudy[], filter: Filter, showMastered: boolean, studySlug: string = "all"): NoteStudy[] {
  const picked = studies.some((s) => s.slug === studySlug) ? studies.filter((s) => s.slug === studySlug) : studies;
  return picked.map((s) => ({
    ...s,
    rounds: s.rounds
      .map((r) => ({
        ...r,
        exams: r.exams
          .map((ex) => (ex.locked ? ex : { ...ex, items: (ex.items ?? []).filter((it) => passes(it, filter, showMastered)) }))
          .filter((ex) => (ex.locked ? filter !== "retriedOk" : (ex.items ?? []).length > 0)),
      }))
      .filter((r) => r.exams.length > 0),
  }));
}

/* ---------- 합계 · 문구 ---------- */

/** 머리줄 합계 — 화면의 정본(D21). 서버 wrong_note_totals 와 같은 규칙: wrong 은 외운 것 포함, locked = 잠긴 시험 lockedCount 합 */
export function totalsOf(studies: NoteStudy[]): WrongNoteTotals {
  const t: WrongNoteTotals = { wrong: 0, retriedOk: 0, mastered: 0, locked: 0 };
  for (const s of studies) for (const r of s.rounds) for (const ex of r.exams) {
    if (ex.locked) { t.locked += ex.lockedCount ?? 0; continue; }
    for (const it of ex.items ?? []) {
      t.wrong += 1;
      if (retriedOk(it)) t.retriedOk += 1;
      if (it.mastered) t.mastered += 1;
    }
  }
  return t;
}

/** "오답 12문항 · 다시 풀어 맞힘 4 · 외움 2 · 잠김 3" — 0 인 항목은 뺀다. 전부 0 이면 "" */
export function totalsLine(t: WrongNoteTotals): string {
  const parts: string[] = [];
  if (t.wrong > 0) parts.push(`오답 ${t.wrong}문항`);
  if (t.retriedOk > 0) parts.push(`다시 풀어 맞힘 ${t.retriedOk}`);
  if (t.mastered > 0) parts.push(`외움 ${t.mastered}`);
  if (t.locked > 0) parts.push(`잠김 ${t.locked}`);
  return parts.join(" · ");
}

export const PENDING_TEXT = "참가가 승인되면 오답노트를 볼 수 있어요";
export const FILTER_EMPTY_TEXT = "조건에 맞는 문항이 없어요";
const NO_EXAM_HINT = "시험을 제출하면 틀린 문항이 여기에 모여요";
const NO_WRONG_TEXT = "틀린 문항이 없어요 · 제출한 시험을 전부 맞혔거나 아직 제출한 시험이 없어요";

export type EmptyState = { text: string; masteredLink?: boolean };

/**
 * 목록 전체의 빈 상태(스펙 §6.2 방 탭 · §6.5 내 과제). null = 목록을 그린다.
 * scope "room" = 방 탭(스터디 1개), "all" = 내 과제(여러 개). 스터디 0 개는 null — 내 과제는 기존 TasksEmpty noStudy 를 쓴다.
 * visible(= applyFilter 결과)을 주면 필터로 빈 경우 「조건에 맞는 문항이 없어요」. 잠긴 시험만 있으면 null(잠금 카드만 그린다)
 */
export function emptyState(
  studies: NoteStudy[],
  opts: { pending?: boolean; showMastered?: boolean; scope?: "room" | "all"; visible?: NoteStudy[] } = {},
): EmptyState | null {
  if (opts.pending) return { text: PENDING_TEXT };
  if (studies.length === 0) return null;
  if (studies.every((s) => !s.hasExam)) {
    return { text: `${opts.scope === "all" ? "아직 시험이 없어요" : "아직 시험이 없는 방이에요"} · ${NO_EXAM_HINT}` };
  }
  if (studies.every((s) => s.rounds.length === 0)) return { text: NO_WRONG_TEXT };
  const t = totalsOf(studies);
  if (!opts.showMastered && t.locked === 0 && t.mastered > 0 && t.mastered === t.wrong) return { text: "전부 외웠어요", masteredLink: true };
  if (opts.visible && opts.visible.every((s) => s.rounds.length === 0)) return { text: FILTER_EMPTY_TEXT };
  return null;
}

/** 내 과제 보기의 스터디 섹션 한 줄(스펙 §6.5). visible = 그 스터디의 필터 결과. null = 시험 카드를 그린다 */
export function studyEmptyLine(s: NoteStudy, visible?: NoteStudy): string | null {
  if (!s.hasExam) return "아직 시험이 없는 방이에요";
  if (s.rounds.length === 0) return "틀린 문항이 없어요";
  if (visible && visible.rounds.length === 0) return FILTER_EMPTY_TEXT;
  return null;
}

/** 잠금 카드 문구 — "10.28 마감 뒤에 열려요" (after_deadline 은 마감 다음 날 열린다) */
export const lockedLine = (ex: WrongNoteExam): string => `${md(ex.unlockDate ?? ex.endDate)} 마감 뒤에 열려요`;

/** 시험 카드 머리 — "3/5점 · 오답 2문항" · 잠김이면 "4/10점 · 오답 6문항 · 10.28 마감 뒤에 열려요" */
export function examHeadLine(ex: WrongNoteExam): string {
  const parts: string[] = [];
  if (ex.score != null && ex.maxScore != null) parts.push(`${ex.score}/${ex.maxScore}점`);
  parts.push(`오답 ${ex.locked ? (ex.lockedCount ?? 0) : (ex.items ?? []).length}문항`);
  if (ex.locked) parts.push(lockedLine(ex));
  return parts.join(" · ");
}

export type ItemBadge = { text: string; tone: "wrong" | "ok" | "muted" };

/** 문항 배지: 제출 결과(미답·오답) + 연습 상태(다시 풀어 맞힘·또 틀림) + 외움 */
export function itemBadges(it: WrongNoteItem): ItemBadge[] {
  const out: ItemBadge[] = [{ text: isAnswered(it.mine) ? "오답" : "미답", tone: "wrong" }];
  if (it.practice?.lastCorrect === true) out.push({ text: "다시 풀어 맞힘", tone: "ok" });
  else if (it.practice?.lastCorrect === false) out.push({ text: "또 틀림", tone: "wrong" });
  if (it.mastered) out.push({ text: "외움", tone: "muted" });
  return out;
}

/** 다시 풀기 채점 뒤 배지 문구 */
export const practiceResultText = (correct: boolean): string => (correct ? "✓ 맞혔어요" : "✗ 또 틀렸어요");

/** 묶음 채점 요약 — "5문항 중 3 맞힘" */
export function batchSummary(results: WrongNotePracticeResult["results"], n: number): string {
  const k = Object.values(results).filter((r) => r.correct).length;
  return `${n}문항 중 ${k} 맞힘`;
}

/** 정답 키를 **지운** 사본(undefined 대입이 아니다 — ExamQuestionView 는 "answer" in q 로 정답 표시를 고른다) */
export function stripKey(q: ExamQuestion): ExamQuestion {
  const c = { ...q };
  delete c.answer;
  delete c.explanation;
  return c;
}

/* ---------- 응답 합치기 (목록 재조회 없이) ---------- */

function mapItems(studies: NoteStudy[], f: (it: WrongNoteItem) => WrongNoteItem): NoteStudy[] {
  return studies.map((s) => ({
    ...s,
    rounds: s.rounds.map((r) => ({
      ...r,
      exams: r.exams.map((ex) => (ex.items ? { ...ex, items: ex.items.map(f) } : ex)),
    })),
  }));
}

/** 연습 응답의 문항별 practice 를 목록에 반영 */
export const mergePractice = (studies: NoteStudy[], results: WrongNotePracticeResult["results"]): NoteStudy[] =>
  mapItems(studies, (it) => (it.question.id in results ? { ...it, practice: results[it.question.id].practice } : it));

/** 외웠어요 / 다시 노트에 */
export const setMastered = (studies: NoteStudy[], questionId: string, on: boolean): NoteStudy[] =>
  mapItems(studies, (it) => (it.question.id === questionId ? { ...it, mastered: on } : it));

/** 다시 볼 문제(★) 켜기·끄기 */
export const setBookmarked = (studies: NoteStudy[], questionId: string, on: boolean): NoteStudy[] =>
  mapItems(studies, (it) => (it.question.id === questionId ? { ...it, bookmarked: on } : it));

/* ---------- 다시 볼 문제(★, 0051) ---------- */

/** ★ 모아 보기 한 줄 — 문항 + 원래 자리(스터디·회차·시험). 필터·외움과 무관 */
export type StarEntry = { study: NoteStudy; round: WrongNoteRound; exam: WrongNoteExam; item: WrongNoteItem };

/**
 * ★ 표시한 문항 — 스터디 → 회차 → 시험 → 문항 순(목록 순서 그대로). 잠긴 시험은 items 가 없으니 나오지 않는다.
 * ids 를 주면 ★ 대신 그 문항들(모아 보기를 연 때의 ★ — 보는 중에 ☆ 로 꺼도 자리에 남아 되돌릴 수 있게)
 */
export function starEntries(studies: NoteStudy[], ids?: ReadonlySet<string>): StarEntry[] {
  const out: StarEntry[] = [];
  for (const study of studies) for (const round of study.rounds) for (const exam of round.exams)
    for (const item of exam.items ?? []) if (ids ? ids.has(item.question.id) : item.bookmarked) out.push({ study, round, exam, item });
  return out;
}

/** 회차 안 ★ 개수(카드 배지) */
export const roundStarCount = (r: WrongNoteRound): number =>
  r.exams.reduce((n, ex) => n + (ex.items ?? []).filter((it) => it.bookmarked).length, 0);

/* ---------- 오류 → 화면 동작 ---------- */

/** 0046 오류 코드 기본 문구(서버 문구가 정본 — 문구가 비었을 때만) */
export const WRONG_NOTE_ERROR_KO: Record<string, string> = {
  WRONG_NOTE_NOT_IN: "오답노트에 없는 문항이에요",
  WRONG_NOTE_LOCKED: "정답이 공개된 뒤에 다시 풀 수 있어요",
  NODE_NOT_FOUND: "문항을 찾을 수 없어요",
  ROOM_NOT_FOUND: "방을 찾을 수 없어요",
  VALIDATION_FAILED: "답을 확인해 주세요",
};

export type WrongNoteErrorAction =
  | { kind: "refetch"; text: string }
  | { kind: "field"; questionId: string | null; text: string }
  | { kind: "login"; text: string }
  | { kind: "toast"; text: string };

/** 목록이 서버와 어긋났다는 뜻 — 토스트 + 다시 받기(잠금 카드로 바뀌거나 문항이 빠진다) */
const REFETCH = new Set(["WRONG_NOTE_NOT_IN", "WRONG_NOTE_LOCKED", "NODE_NOT_FOUND", "ROOM_NOT_FOUND"]);

const textOf = (e: ApiError): string => (e.message && e.message !== e.code ? e.message : (WRONG_NOTE_ERROR_KO[e.code] ?? e.message));

/** wrong_note_practice·wrong_note_master 실패 → 화면 동작 */
export function wrongNoteErrorAction(e: ApiError): WrongNoteErrorAction {
  if (REFETCH.has(e.code)) return { kind: "refetch", text: textOf(e) };
  if (e.code === "VALIDATION_FAILED") return { kind: "field", questionId: e.details?.questionId ? String(e.details.questionId) : null, text: WRONG_NOTE_ERROR_KO.VALIDATION_FAILED };
  if (e.code === "AUTH_REQUIRED") return { kind: "login", text: e.message };
  if (e.code === "UNKNOWN") return { kind: "toast", text: "채점하지 못했어요 · 연결을 확인하고 다시 시도해 주세요" };
  return { kind: "toast", text: textOf(e) };
}

/* ---------- 회차 카드 · 상세 (D22~) ---------- */

/** 회차 기간 — 응답에 없어 화면이 커리큘럼(방 탭)·me_tasks(내 과제)에서 넘긴다. 모르면 기간 줄을 뺀다 */
export type RoundPeriods = Record<string, { startDate: string; endDate: string }>;

export type RoundStats = {
  exams: number;
  /** 답했는데 틀림 · 답하지 않음 — 공개된 문항만(외운 것 포함, totalsOf 와 같다) */
  wrong: number;
  unanswered: number;
  retriedOk: number;
  mastered: number;
  /** 잠긴 시험 lockedCount 합 */
  locked: number;
  /** 시험이 전부 잠겼다 — 카드는 열 수 없고 자물쇠 + 열리는 날 */
  allLocked: boolean;
  /** 가장 먼저 열리는 잠긴 시험의 날(잠긴 시험이 없으면 null) */
  unlockDate: string | null;
};

export function roundStats(r: WrongNoteRound): RoundStats {
  const s: RoundStats = { exams: r.exams.length, wrong: 0, unanswered: 0, retriedOk: 0, mastered: 0, locked: 0, allLocked: r.exams.length > 0, unlockDate: null };
  for (const ex of r.exams) {
    if (ex.locked) {
      s.locked += ex.lockedCount ?? 0;
      const d = ex.unlockDate ?? ex.endDate;
      if (!s.unlockDate || d < s.unlockDate) s.unlockDate = d;
      continue;
    }
    s.allLocked = false;
    for (const it of ex.items ?? []) {
      if (isAnswered(it.mine)) s.wrong += 1;
      else s.unanswered += 1;
      if (retriedOk(it)) s.retriedOk += 1;
      if (it.mastered) s.mastered += 1;
    }
  }
  return s;
}

/** 카드 숫자 줄 — [["오답", 2], ["미답", 1], …] 0 은 뺀다 */
export function roundStatParts(s: RoundStats): [string, number][] {
  const parts: [string, number][] = [["오답", s.wrong], ["미답", s.unanswered], ["다시 풀어 맞힘", s.retriedOk], ["외움", s.mastered], ["잠김", s.locked]];
  return parts.filter(([, n]) => n > 0);
}

/** 회차 잠금 문구 — "10.28 마감 뒤에 열려요" */
export const roundLockedLine = (s: RoundStats): string => (s.unlockDate ? `${md(s.unlockDate)} 마감 뒤에 열려요` : "정답이 공개된 뒤에 열려요");

/** 회차 기간 — "10.14 ~ 10.20" */
export const periodLine = (p: { startDate: string; endDate: string } | undefined): string | null => (p ? `${md(p.startDate)} ~ ${md(p.endDate)}` : null);

/** 화면에 보이는(필터 결과) 문항 수 — 잠긴 시험은 세지 않는다 */
export const visibleCount = (r: WrongNoteRound): number => r.exams.reduce((n, ex) => n + (ex.locked ? 0 : (ex.items ?? []).length), 0);

/** id 회차와 그 스터디 — 없으면 null */
export function findRound(studies: NoteStudy[], id: string): { study: NoteStudy; round: WrongNoteRound } | null {
  for (const study of studies) for (const round of study.rounds) if (round.id === id) return { study, round };
  return null;
}

/** 지금 주소에서 ?round= 만 바꾼 주소(상세 열기·닫기). 다른 쿼리·해시는 그대로 */
export function withRound(href: string, id: string | null): string {
  const u = new URL(href, "http://x");
  if (id) u.searchParams.set("round", id);
  else u.searchParams.delete("round");
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ""}${u.hash}`;
}

/* ---------- 다시 푼 횟수 단계 (문항 이동 번호 색) ---------- */

/** 다시 푼 횟수 = 연습 채점 횟수(맞힘 + 틀림) */
export const retryCount = (it: WrongNoteItem): number => (it.practice ? it.practice.correctCount + it.practice.wrongCount : 0);

/** 단계 — 0 = 아직, 1, 2, 3 = 3번 이상 */
export type RetryTier = 0 | 1 | 2 | 3;
export const retryTier = (n: number): RetryTier => (n >= 3 ? 3 : (n as RetryTier));
export const RETRY_TIER_KO: Record<RetryTier, string> = { 0: "0번", 1: "1번", 2: "2번", 3: "3번+" };

/** 번호 칸의 마지막 정오 표시 — 다시 푼 적이 없으면 null */
export const lastMark = (it: WrongNoteItem): "ok" | "bad" | null =>
  retryCount(it) === 0 || it.practice?.lastCorrect == null ? null : it.practice.lastCorrect ? "ok" : "bad";

/** 번호 칸 aria-label·title — "3번 문항 · 2번 다시 풀었어요 · 마지막에 맞힘" (색만으로 구분하지 않게) */
export function retryLabel(it: WrongNoteItem): string {
  const n = retryCount(it);
  const parts = [`${it.no}번 문항`, n === 0 ? "아직 다시 풀지 않았어요" : `${n}번 다시 풀었어요`];
  const m = lastMark(it);
  if (m) parts.push(m === "ok" ? "마지막에 맞힘" : "마지막에 틀림");
  if (it.mastered) parts.push("외움");
  if (it.bookmarked) parts.push("다시 볼 문제");
  return parts.join(" · ");
}
