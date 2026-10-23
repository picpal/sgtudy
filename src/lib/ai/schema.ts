import { z } from "zod";

/* 방 만들기 AI 인터뷰 — 모델 출력(§5.2)·클라이언트 요청(§5.1) 스키마와 공용 타입. 순수 모듈(서버·클라이언트 공용, 키·SDK 없음) */

/** ask.field — 실제 폼 필드 + 파생 필드(access = 공개+참가 방식, durationWeeks → 종료일, style → 설명·규칙 초안, extra = 추가 요청사항) */
export const FIELDS = [
  "title", "intro", "startDate", "endDate", "maxMembers", "minMembers", "isPublic", "joinMode",
  "descriptionMd", "rulesMd", "leaderDoesTasks", "tags", "access", "durationWeeks", "style", "extra",
] as const;
export const Field = z.enum(FIELDS);
export type Field = z.infer<typeof Field>;

/** 필수 6개(D11·D16). isPublic = 공개/참가 방식 한 묶음 */
export const REQUIRED_FIELDS = ["title", "intro", "startDate", "endDate", "maxMembers", "isPublic"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export const ACCESS_VALUES = ["public-direct", "public-approval", "private"] as const;
export const STYLE_VALUES = ["weekly-task", "proof", "meeting", "presentation", "exam", "other"] as const;

/**
 * 모델 출력 스키마. OpenAI Structured Outputs strict 모드는 모든 키가 required 여야 해서 선택 값은 nullable(null = 이번에 안 바꿈).
 * 값의 범위는 여기서 보지 않는다 — normalizePatch 가 자르고 버린다(D10)
 */
const nullable = <T extends z.ZodType>(t: T) => t.nullable();
export const ModelTurn = z.object({
  say: z.string(),
  patch: z.object({
    title: nullable(z.string()),
    intro: nullable(z.string()),
    startDate: nullable(z.string()),
    endDate: nullable(z.string()),
    maxMembers: nullable(z.number().int()),
    minMembers: nullable(z.number().int()),
    isPublic: nullable(z.boolean()),
    joinMode: nullable(z.enum(["direct", "approval"])),
    descriptionMd: nullable(z.string()),
    rulesMd: nullable(z.string()),
    leaderDoesTasks: nullable(z.boolean()),
    tags: nullable(z.array(z.string())),
  }),
  ask: z
    .object({
      field: Field,
      kind: z.enum(["single", "multi", "text", "date", "number"]),
      options: nullable(z.array(z.object({ label: z.string(), value: z.string() }))),
      allowOther: nullable(z.enum(["text", "date", "number"])),
    })
    .nullable(),
  done: z.boolean(),
});
/** 서버가 응답을 검사하는 판 — 빠진 키는 null 과 같게 본다(목·테스트가 키를 생략해도 된다) */
export const ModelTurnIn = ModelTurn.extend({
  patch: ModelTurn.shape.patch.partial(),
  ask: ModelTurn.shape.ask.unwrap().partial({ options: true, allowOther: true }).nullable(),
});
export type ModelTurn = z.infer<typeof ModelTurnIn>;

/** 초안 태그 — 사전 태그는 slug, 자유 라벨은 label 만 (room-new/tags.ts TagItem 과 같은 모양) */
export type DraftTag = { slug?: string; label: string; tone?: string };
/** 지금까지 채운 값. 없는 키 = 아직 안 채움 */
export type Draft = {
  title?: string; intro?: string; startDate?: string; endDate?: string; maxMembers?: number; minMembers?: number | null;
  isPublic?: boolean; joinMode?: "direct" | "approval"; descriptionMd?: string; rulesMd?: string; leaderDoesTasks?: boolean; tags?: DraftTag[];
};

export type ChipOption = { label: string; value: string };
export type Ask = { field: Field; kind: "single" | "multi" | "text" | "date" | "number"; options?: ChipOption[]; allowOther?: "text" | "date" | "number" };
export type Dropped = { field: string; reason: string };

/** 클라이언트 → 서버 대화 한 줄. assistant 는 지난 say 텍스트만(D9) */
export type ChatLine = { role: "user" | "assistant"; text: string };

/** 턴 상한(D8·§4.1): 메시지 24개. 넘으면 409 AI_TURN_LIMIT */
export const MAX_MESSAGES = 24;
export const USER_TEXT_MAX = 500;
export const SAY_MAX = 600;
export const MD_MAX = 4000;

const cp = (n: number) => (s: string) => [...s].length <= n;

/**
 * 클라이언트 요청 본문(§5.1). draft 는 모양만 느슨하게 보고(값은 normalizeDraft 가 다시 거른다),
 * messages 는 개수를 넉넉히 받아 24 초과를 400 이 아닌 409 로 돌려준다.
 */
export const InterviewRequest = z.object({
  draft: z.record(z.string(), z.unknown()).default({}),
  messages: z
    .array(
      z.discriminatedUnion("role", [
        z.object({ role: z.literal("user"), text: z.string().refine(cp(USER_TEXT_MAX), "too long") }),
        z.object({ role: z.literal("assistant"), text: z.string().refine(cp(SAY_MAX), "too long") }),
      ]),
    )
    .max(60),
  answer: z.object({ field: Field, value: z.string().max(2000) }).nullable().optional(),
});
export type InterviewRequest = z.infer<typeof InterviewRequest>;

/** 응답 200(§5.1) */
export type TurnResponse = {
  say: string; patch: Draft; draft: Draft; ask: Ask | null; missing: RequiredField[]; dropped: Dropped[]; done: boolean; turn: number; turnsLeft: number;
};
/** 오류 본문(§5.1) — 토큰·내부 메시지 없음 */
export type TurnErrorBody = { error: string; message: string; details?: Record<string, unknown> };
