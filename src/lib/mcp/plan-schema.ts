import { z } from "zod";

/* 도구 입력 zod 스키마 — 문서화(도구 inputSchema) 목적. 최종 검증은 서버(plan_shape_check·plan_resolve·plan_validate).
   〔UX 재검토 D13〕 설명은 영어 · op 별 객체는 loose(추가 키 허용 — JSON Schema 를 작게 두고 서버가 거른다).
   tools/list 예산(설명+스키마+instructions ≤ 6,500자, tools.test.ts): 반복되는 하위 스키마(날짜·회차 선택자)엔 설명을 달지 않고
   쓰는 자리에서 한 번만 단다(날짜 형식은 SERVER_INSTRUCTIONS). .int() 만 쓰면 maximum 9007199254740991 이 붙어 상한을 둔다.
   서버가 한국어 경로별 오류로 검사하는 상한(설명 길이·children 개수(총 노드 200)·ref 형식)은 스키마에 싣지 않는다 — loose 라 그대로 통과.
   assignees 개수·index 상한은 서버에 없어(dedup·멤버 검사뿐, index 는 ::int 넘침 → INTERNAL) 여기서 막는다 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** 서수(1부터) · "current" · 라벨("3주차") · id 문자열 */
export const roundSel = z.union([z.number().int().min(1).max(999), z.string()]);
export const ROUND_SEL_HELP = 'ordinal, "current", label like "3주차", or id';
const parentSel = z.union([z.string(), z.null(), z.object({ round: roundSel })]);
const index = z.number().int().min(0).max(999);

const nodeFields = {
  title: z.string().min(1).max(80),
  label: z.string().max(20).optional(),
  startDate: date.optional(),
  endDate: date.optional(),
  descriptionMd: z.string().optional(),
  taskType: z.enum(["common", "designated"]).optional().describe("leaf only"),
  kind: z.enum(["task", "exam"]).optional().describe("exam: empty draft exam leaf, then create_exam_draft"),
  assignees: z.array(z.string()).max(100).optional().describe("designated only: nicknames or userIds"),
  children: z.array(z.looseObject({})).optional().describe("same shape, no op/parent"),
};

export const planOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    ref: z.string().optional(),
    parent: parentSel.optional().describe(`null = new round, node id, "@<ref>", or {round: ${ROUND_SEL_HELP}}`),
    index: index.optional(),
    ...nodeFields,
  }).loose(),
  z.object({
    op: z.literal("update"),
    id: z.string(),
    set: z.looseObject({}).describe("create fields, shiftDescendants"),
  }).loose(),
  z.object({
    op: z.literal("move"),
    id: z.string(),
    parent: parentSel,
    index,
  }).loose(),
  z.object({
    op: z.literal("shift"),
    from: roundSel.describe(`round: ${ROUND_SEL_HELP}`),
    to: roundSel.optional(),
    days: z.number().int().min(-180).max(180).describe("children and personal goals move too"),
  }).loose(),
]);

export const planDoc = z.object({
  schema: z.literal("sgtudy.plan/v1"),
  baseVersion: z.string().optional(),
  ops: z.array(planOp).min(1).max(200),
});

export type PlanDoc = z.infer<typeof planDoc>;
