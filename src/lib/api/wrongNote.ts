import { rpc, type Db } from "./errors";
import type { WrongNote, WrongNoteMine, WrongNotePracticeResult } from "./types";

/* 오답노트 어댑터 (0046_wrong_note.sql). 컴포넌트는 이 파일만 부른다 */
const num = (id: string) => Number(id);

export type WrongNoteAnswer = { questionId: string; answer: unknown };

export const fetchWrongNote = (slug: string, client?: Db) => rpc<WrongNote>("wrong_note_list", { p_slug: slug }, client);
export const fetchWrongNoteMine = (client?: Db) => rpc<WrongNoteMine>("wrong_note_mine", {}, client);
/** 다시 풀기 — 문항 하나는 길이 1 배열, 시험 묶음은 그 카드의 문항 전부(1~50). 채점은 서버(exam_grade) 만 한다 */
export const practiceWrongNote = (slug: string, answers: WrongNoteAnswer[], client?: Db) =>
  rpc<WrongNotePracticeResult>("wrong_note_practice", { p_slug: slug, p_answers: answers.map((a) => ({ questionId: a.questionId, answer: a.answer ?? null })) }, client);
export const masterWrongNote = (slug: string, questionId: string, on: boolean, client?: Db) =>
  rpc<{ mastered: boolean }>("wrong_note_master", { p_slug: slug, p_question: num(questionId), p_on: on }, client);
/** 다시 볼 문제(★) 켜기·끄기 (0051) — 정오·외움과 무관한 본인 표시 */
export const bookmarkWrongNote = (slug: string, questionId: string, on: boolean, client?: Db) =>
  rpc<{ bookmarked: boolean }>("wrong_note_bookmark", { p_slug: slug, p_question: num(questionId), p_on: on }, client);
