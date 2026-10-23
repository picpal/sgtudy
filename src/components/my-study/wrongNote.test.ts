import { describe, expect, it } from "vitest";
import type { ExamQuestion, WrongNote, WrongNoteExam, WrongNoteItem, WrongNoteMine } from "@/lib/api/types";
import {
  applyFilter, batchSummary, emptyState, examHeadLine, FILTER_EMPTY_TEXT, itemBadges, lockedLine, mergePractice, PENDING_TEXT, practiceResultText,
  setMastered, stripKey, studyEmptyLine, toNoteStudies, toNoteStudiesMine, totalsLine, totalsOf, wrongNoteErrorAction, type NoteStudy,
} from "./wrongNote";

const q = (id: string, o: Partial<ExamQuestion> = {}): ExamQuestion => ({
  id, ord: Number(id) - 1, type: "single", prompt: `문제 ${id}`, choices: ["a", "b"], points: 1, answer: 0, explanation: `해설 ${id}`, ...o,
});
const item = (id: string, o: Partial<WrongNoteItem> = {}): WrongNoteItem => ({ question: q(id), no: Number(id), mine: 1, practice: null, mastered: false, ...o });
const ok = { lastCorrect: true, correctCount: 1, wrongCount: 0, lastAnswer: 0, lastAt: "2026-10-17T00:00:00.000Z" };
const bad = { lastCorrect: false, correctCount: 0, wrongCount: 1, lastAnswer: 1, lastAt: "2026-10-17T00:00:00.000Z" };
const exam = (nodeId: string, items: WrongNoteItem[], o: Partial<WrongNoteExam> = {}): WrongNoteExam => ({
  nodeId, title: `시험 ${nodeId}`, endDate: "2026-10-21", reveal: "after_submit", score: 1, maxScore: 5, correctCount: 1, questionCount: 4, locked: false, items, ...o,
});
const lockedExam = (nodeId: string, n: number): WrongNoteExam => {
  const ex = exam(nodeId, [], { reveal: "after_deadline", locked: true, lockedCount: n, unlockDate: "2026-10-28", score: 4, maxScore: 10, endDate: "2026-10-28" });
  delete ex.items;
  return ex;
};
const aws: NoteStudy = {
  slug: "aws", hasExam: true,
  rounds: [
    { id: "3", title: "3주차", exams: [exam("31", [item("1"), item("2", { practice: ok }), item("3", { mine: null, practice: bad }), item("4", { mastered: true })])] },
    { id: "4", title: "4주차", exams: [lockedExam("41", 6)] },
  ],
};
const spring: NoteStudy = { slug: "spring", title: "Spring", tone: "blue", hasExam: true, rounds: [{ id: "9", title: "1주차", exams: [exam("91", [item("11", { practice: ok })])] }] };
const ids = (ss: NoteStudy[]) => ss.flatMap((s) => s.rounds.flatMap((r) => r.exams.flatMap((ex) => (ex.items ?? []).map((i) => i.question.id))));

describe("toNoteStudies / toNoteStudiesMine", () => {
  it("room view → one study without title · mine → studies with title/tone", () => {
    const v: WrongNote = { today: "2026-10-16", viewer: "member", hasExam: true, totals: { wrong: 0, retriedOk: 0, mastered: 0, locked: 0 }, rounds: aws.rounds };
    expect(toNoteStudies(v, "aws")).toEqual([{ slug: "aws", hasExam: true, rounds: aws.rounds }]);
    const m: WrongNoteMine = { today: "2026-10-16", studies: [{ slug: "spring", title: "Spring", tone: "blue", status: "active", hasExam: false, totals: { wrong: 0, retriedOk: 0, mastered: 0, locked: 0 }, rounds: [] }] };
    expect(toNoteStudiesMine(m)).toEqual([{ slug: "spring", title: "Spring", tone: "blue", hasExam: false, rounds: [] }]);
  });
});

describe("applyFilter", () => {
  it("all hides mastered unless toggled · locked kept", () => {
    expect(ids(applyFilter([aws], "all", false))).toEqual(["1", "2", "3"]);
    expect(ids(applyFilter([aws], "all", true))).toEqual(["1", "2", "3", "4"]);
    expect(applyFilter([aws], "all", false)[0].rounds.map((r) => r.id)).toEqual(["3", "4"]);
  });
  it("open = no practice or last wrong · retriedOk = last correct · locked dropped only for retriedOk", () => {
    expect(ids(applyFilter([aws], "open", false))).toEqual(["1", "3"]);
    expect(applyFilter([aws], "open", false)[0].rounds.map((r) => r.id)).toEqual(["3", "4"]);
    const r = applyFilter([aws], "retriedOk", false);
    expect(ids(r)).toEqual(["2"]);
    expect(r[0].rounds.map((x) => x.id)).toEqual(["3"]);
  });
  it("empty exams/rounds removed but study section kept · locked exam has no items key", () => {
    const only = { ...aws, rounds: [aws.rounds[0]] };
    const r = applyFilter([only, spring], "open", false);
    expect(r.map((s) => s.slug)).toEqual(["aws", "spring"]);
    expect(r[1].rounds).toEqual([]);
    expect("items" in applyFilter([aws], "all", false)[0].rounds[1].exams[0]).toBe(false);
  });
  it("studySlug picks a section · unknown slug = all", () => {
    expect(applyFilter([aws, spring], "all", false, "spring").map((s) => s.slug)).toEqual(["spring"]);
    expect(applyFilter([aws, spring], "all", false, "nope").map((s) => s.slug)).toEqual(["aws", "spring"]);
    expect(applyFilter([aws, spring], "all", false, "all").map((s) => s.slug)).toEqual(["aws", "spring"]);
  });
});

describe("totalsOf / totalsLine", () => {
  it("sums across studies · mastered counted in wrong · locked = lockedCount", () => {
    expect(totalsOf([aws])).toEqual({ wrong: 4, retriedOk: 1, mastered: 1, locked: 6 });
    expect(totalsOf([aws, spring])).toEqual({ wrong: 5, retriedOk: 2, mastered: 1, locked: 6 });
    expect(totalsOf([])).toEqual({ wrong: 0, retriedOk: 0, mastered: 0, locked: 0 });
  });
  it("line omits zeros", () => {
    expect(totalsLine({ wrong: 12, retriedOk: 4, mastered: 2, locked: 0 })).toBe("오답 12문항 · 다시 풀어 맞힘 4 · 외움 2");
    expect(totalsLine({ wrong: 3, retriedOk: 0, mastered: 0, locked: 6 })).toBe("오답 3문항 · 잠김 6");
    expect(totalsLine({ wrong: 0, retriedOk: 0, mastered: 0, locked: 0 })).toBe("");
  });
});

describe("emptyState (스펙 §6.2 · §6.5)", () => {
  const none: NoteStudy = { slug: "aws", hasExam: false, rounds: [] };
  const noWrong: NoteStudy = { slug: "aws", hasExam: true, rounds: [] };
  const allMastered: NoteStudy = { slug: "aws", hasExam: true, rounds: [{ id: "3", title: "3주차", exams: [exam("31", [item("1", { mastered: true }), item("2", { mastered: true })])] }] };
  const lockedOnly: NoteStudy = { slug: "aws", hasExam: true, rounds: [{ id: "4", title: "4주차", exams: [lockedExam("41", 2)] }] };
  it("room: pending · no exam · no wrong · all mastered (link) · locked only → null · list → null", () => {
    expect(emptyState([aws], { pending: true })).toEqual({ text: PENDING_TEXT });
    expect(emptyState([none])).toEqual({ text: "아직 시험이 없는 방이에요 · 시험을 제출하면 틀린 문항이 여기에 모여요" });
    expect(emptyState([noWrong])).toEqual({ text: "틀린 문항이 없어요 · 제출한 시험을 전부 맞혔거나 아직 제출한 시험이 없어요" });
    expect(emptyState([allMastered])).toEqual({ text: "전부 외웠어요", masteredLink: true });
    expect(emptyState([allMastered], { showMastered: true })).toBeNull();
    expect(emptyState([lockedOnly])).toBeNull();
    expect(emptyState([aws])).toBeNull();
  });
  it("filtered to nothing → 조건에 맞는 문항이 없어요", () => {
    expect(emptyState([aws], { visible: applyFilter([aws], "retriedOk", false) })).toBeNull();
    const fresh: NoteStudy = { slug: "aws", hasExam: true, rounds: [{ id: "3", title: "3주차", exams: [exam("31", [item("1")])] }] };
    expect(emptyState([fresh], { visible: applyFilter([fresh], "retriedOk", false) })).toEqual({ text: FILTER_EMPTY_TEXT });
  });
  it("all studies: no study → null (TasksEmpty) · every study without exam → 아직 시험이 없어요", () => {
    expect(emptyState([], { scope: "all" })).toBeNull();
    expect(emptyState([none, { ...none, slug: "spring" }], { scope: "all" })).toEqual({ text: "아직 시험이 없어요 · 시험을 제출하면 틀린 문항이 여기에 모여요" });
    expect(emptyState([none, noWrong], { scope: "all" })).toEqual({ text: "틀린 문항이 없어요 · 제출한 시험을 전부 맞혔거나 아직 제출한 시험이 없어요" });
    expect(emptyState([none, spring], { scope: "all" })).toBeNull();
  });
  it("study section line", () => {
    expect(studyEmptyLine(none)).toBe("아직 시험이 없는 방이에요");
    expect(studyEmptyLine(noWrong)).toBe("틀린 문항이 없어요");
    expect(studyEmptyLine(spring, applyFilter([spring], "open", false)[0])).toBe(FILTER_EMPTY_TEXT);
    expect(studyEmptyLine(spring, applyFilter([spring], "all", false)[0])).toBeNull();
  });
});

describe("lines · badges · summary", () => {
  it("locked card: 10.28 마감 뒤에 열려요 · head lines", () => {
    expect(lockedLine(lockedExam("41", 6))).toBe("10.28 마감 뒤에 열려요");
    expect(examHeadLine(lockedExam("41", 6))).toBe("4/10점 · 오답 6문항 · 10.28 마감 뒤에 열려요");
    expect(examHeadLine(exam("31", [item("1"), item("2")], { score: 3 }))).toBe("3/5점 · 오답 2문항");
    expect(examHeadLine(exam("31", [item("1")], { score: null }))).toBe("오답 1문항");
  });
  it("badges: 미답/오답 + practice + 외움", () => {
    expect(itemBadges(item("1")).map((b) => b.text)).toEqual(["오답"]);
    expect(itemBadges(item("1", { mine: null })).map((b) => b.text)).toEqual(["미답"]);
    expect(itemBadges(item("1", { mine: "" })).map((b) => b.text)).toEqual(["미답"]);
    expect(itemBadges(item("1", { practice: ok })).map((b) => b.text)).toEqual(["오답", "다시 풀어 맞힘"]);
    expect(itemBadges(item("1", { practice: bad, mastered: true })).map((b) => b.text)).toEqual(["오답", "또 틀림", "외움"]);
    expect(itemBadges(item("1", { practice: { ...ok, lastCorrect: null } })).map((b) => b.text)).toEqual(["오답"]);
  });
  it("batch summary · practice result text", () => {
    expect(batchSummary({ 1: { correct: true, practice: ok }, 2: { correct: false, practice: bad }, 3: { correct: true, practice: ok } }, 3)).toBe("3문항 중 2 맞힘");
    expect([practiceResultText(true), practiceResultText(false)]).toEqual(["✓ 맞혔어요", "✗ 또 틀렸어요"]);
  });
});

describe("stripKey", () => {
  it("deletes answer & explanation keys (not undefined) · original untouched", () => {
    const orig = q("1");
    const s = stripKey(orig);
    expect("answer" in s).toBe(false);
    expect("explanation" in s).toBe(false);
    expect(s).toEqual({ id: "1", ord: 0, type: "single", prompt: "문제 1", choices: ["a", "b"], points: 1 });
    expect(orig.answer).toBe(0);
  });
});

describe("mergePractice / setMastered", () => {
  it("merges practice by question id across studies, immutably", () => {
    const out = mergePractice([aws, spring], { 1: { correct: true, practice: ok }, 11: { correct: false, practice: bad } });
    expect(out[0].rounds[0].exams[0].items![0].practice).toEqual(ok);
    expect(out[1].rounds[0].exams[0].items![0].practice).toEqual(bad);
    expect(aws.rounds[0].exams[0].items![0].practice).toBeNull();
    expect(totalsOf(out).retriedOk).toBe(2);   // 2·1 맞힘, 11 은 또 틀림
    expect("items" in out[0].rounds[1].exams[0]).toBe(false);
  });
  it("setMastered toggles one item", () => {
    const on = setMastered([aws], "1", true);
    expect(on[0].rounds[0].exams[0].items![0].mastered).toBe(true);
    expect(ids(applyFilter(on, "all", false))).toEqual(["2", "3"]);
    expect(setMastered(on, "1", false)[0].rounds[0].exams[0].items![0].mastered).toBe(false);
  });
});

describe("wrongNoteErrorAction", () => {
  it("NOT_IN·LOCKED·NODE/ROOM_NOT_FOUND → refetch with server text · VALIDATION → field · AUTH → login", () => {
    expect(wrongNoteErrorAction({ code: "WRONG_NOTE_LOCKED", message: "정답이 공개된 뒤에 다시 풀 수 있어요" })).toEqual({ kind: "refetch", text: "정답이 공개된 뒤에 다시 풀 수 있어요" });
    expect(wrongNoteErrorAction({ code: "WRONG_NOTE_NOT_IN", message: "WRONG_NOTE_NOT_IN" })).toEqual({ kind: "refetch", text: "오답노트에 없는 문항이에요" });
    expect(wrongNoteErrorAction({ code: "NODE_NOT_FOUND", message: "" }).kind).toBe("refetch");
    expect(wrongNoteErrorAction({ code: "ROOM_NOT_FOUND", message: "" }).kind).toBe("refetch");
    expect(wrongNoteErrorAction({ code: "VALIDATION_FAILED", message: "x", details: { questionId: "12" } })).toEqual({ kind: "field", questionId: "12", text: "답을 확인해 주세요" });
    expect(wrongNoteErrorAction({ code: "AUTH_REQUIRED", message: "로그인이 필요해요" })).toEqual({ kind: "login", text: "로그인이 필요해요" });
    expect(wrongNoteErrorAction({ code: "UNKNOWN", message: "fetch failed" }).kind).toBe("toast");
  });
});
