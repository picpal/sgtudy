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

const RoundItem = z.object({
  /** 회차 번호(1부터) — 서버가 <write> 로 준 번호를 그대로 돌려받아 자리를 맞춘다 */
  index: z.number().int().min(1).max(MAX_ROUNDS),
  title: z.string(),
  /** 목표 본문(첫 줄 한 문장 + 불릿) — 앞머리 "이번 주 목표:" 는 서버가 붙인다(D42) */
  goalMd: z.string(),
  tasks: z.array(z.object({ title: z.string(), descriptionMd: z.string() })),
});
/**
 * 모델 출력(strict). 문자열과 회차 번호뿐 — 날짜·라벨·kind·taskType·parent 는 서버가 붙인다(D24·D31).
 * 배열 길이는 이번에 쓸 회차 수로 못박는다(minItems = maxItems, D39). 글 길이는 여기서 보지 않는다 — toPlan 이 자른다
 */
export const roundsModelFor = (n: number) => z.object({ rounds: z.array(RoundItem).length(n) });
/** 서버가 응답을 검사하는 판 — 빠진 키는 빈 값으로 본다(목·테스트가 키를 생략해도 된다). 회차 번호가 틀리면 없는 셈(자리 순서로 채운다) */
export const RoundsModelIn = z.object({
  rounds: z.array(
    z.object({
      index: z.number().int().optional().catch(undefined),
      title: z.string().default(""),
      goalMd: z.string().default(""),
      tasks: z.array(z.object({ title: z.string().default(""), descriptionMd: z.string().default("") })).default([]),
    }),
  ),
});
export type RoundsModel = z.infer<typeof RoundsModelIn>;
export type RoundModelItem = RoundsModel["rounds"][number];

const cp = (n: number) => (s: string) => [...s].length <= n;

/** 클라이언트 요청(§5.1). draft 는 모양만 — 값은 normalizeDraft 가 다시 거른다. userLines = 사용자 발화만(뒤에서 12개) */
export const RoundsRequest = z.object({
  draft: z.record(z.string(), z.unknown()),
  userLines: z.array(z.string().refine(cp(USER_TEXT_MAX), "too long")).max(MAX_USER_LINES).default([]),
  style: z.array(z.enum(STYLE_VALUES)).max(STYLE_VALUES.length).default([]),
});
export type RoundsRequest = z.infer<typeof RoundsRequest>;

/** 미리보기 표시용 회차 한 줄 — plan.ops 와 1:1. padded = 모델이 끝내 안 써서 서버가 빈 채움 회차로 넣었다 */
export type RoundView = { index: number; label: string; startDate: string; endDate: string; title: string; goalMd: string; tasks: string[]; exam: boolean; padded?: true };
export type RoundsStats = { rounds: number; tasks: number; exams: number; cadenceDays: 7 | 14 };
/** 응답 200(§5.1). padded = 모델이 모자라게 내서(한 번 더 요청한 뒤에도) 서버가 기본 제목으로 채운 회차 수 */
export type RoundsResponse = { plan: PlanDoc; rounds: RoundView[]; stats: RoundsStats; padded: number };
