import { z } from "zod";
import type { PlanDoc } from "@/lib/mcp/plan-schema";
import { STYLE_VALUES, USER_TEXT_MAX } from "../schema";

/* 회차 초안(§5.1·§5.2) — 모델 출력·클라이언트 요청 스키마와 응답 타입. 순수 모듈(키·SDK 없음) */

export const MAX_ROUNDS = 26;
export const ROUND_TITLE_MAX = 40;
export const GOAL_MAX = 300;
export const TASK_TITLE_MAX = 40;
export const TASK_DESC_MAX = 150;
export const MAX_USER_LINES = 12;

/**
 * 모델 출력(strict). 문자열 3종뿐 — 날짜·라벨·kind·taskType·parent 는 서버가 붙인다(D24·D31).
 * 길이·개수는 여기서 보지 않는다 — toPlan 이 자르고 채운다
 */
export const RoundsModel = z.object({
  rounds: z.array(
    z.object({
      title: z.string(),
      goalMd: z.string(),
      tasks: z.array(z.object({ title: z.string(), descriptionMd: z.string() })),
    }),
  ),
});
/** 서버가 응답을 검사하는 판 — 빠진 키는 빈 값으로 본다(목·테스트가 키를 생략해도 된다) */
export const RoundsModelIn = z.object({
  rounds: z.array(
    z.object({
      title: z.string().default(""),
      goalMd: z.string().default(""),
      tasks: z.array(z.object({ title: z.string().default(""), descriptionMd: z.string().default("") })).default([]),
    }),
  ),
});
export type RoundsModel = z.infer<typeof RoundsModelIn>;

const cp = (n: number) => (s: string) => [...s].length <= n;

/** 클라이언트 요청(§5.1). draft 는 모양만 — 값은 normalizeDraft 가 다시 거른다. userLines = 사용자 발화만(뒤에서 12개) */
export const RoundsRequest = z.object({
  draft: z.record(z.string(), z.unknown()),
  userLines: z.array(z.string().refine(cp(USER_TEXT_MAX), "too long")).max(MAX_USER_LINES).default([]),
  style: z.array(z.enum(STYLE_VALUES)).max(STYLE_VALUES.length).default([]),
});
export type RoundsRequest = z.infer<typeof RoundsRequest>;

/** 미리보기 표시용 회차 한 줄 — plan.ops 와 1:1 */
export type RoundView = { index: number; label: string; startDate: string; endDate: string; title: string; goalMd: string; tasks: string[]; exam: boolean };
export type RoundsStats = { rounds: number; tasks: number; exams: number; cadenceDays: 7 | 14 };
/** 응답 200(§5.1). padded = 모델이 모자라게 내서 서버가 기본 제목으로 채운 회차 수 */
export type RoundsResponse = { plan: PlanDoc; rounds: RoundView[]; stats: RoundsStats; padded: number };
