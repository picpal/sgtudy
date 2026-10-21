import { z } from "zod";

/* 도구 입력 zod 스키마 — 문서화(도구 inputSchema) 목적. 최종 검증은 서버(plan_shape_check·plan_resolve·plan_validate).
   〔UX 재검토 D13〕 설명은 영어 · op 별 객체는 loose(추가 키 허용 — JSON Schema 를 작게 두고 서버가 거른다) */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("KST calendar date YYYY-MM-DD");

export const roundSel = z.union([z.number().int().min(1), z.string()])
  .describe('ordinal number, "current", label like "3주차", or id string');

const nodeFields = {
  title: z.string().min(1).max(80),
  label: z.string().max(20).optional().describe("rounds (parent=null) only"),
  startDate: date.optional(),
  endDate: date.optional(),
  descriptionMd: z.string().max(20000).optional(),
  taskType: z.enum(["common", "designated"]).optional().describe("leaf only; omit when children present (bundle)"),
  assignees: z.array(z.string()).max(100).optional().describe("designated only: nicknames or userIds"),
  children: z.array(z.record(z.string(), z.unknown())).max(200).optional()
    .describe("child items of the same shape (op omitted = create, parent implied)"),
};

export const planOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    ref: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional().describe('name to reference later as "@ref"'),
    parent: z.union([z.string(), z.null(), z.object({ round: roundSel })]).optional()
      .describe('null = new round, existing id, "@ref", or {round: selector}'),
    index: z.number().int().min(0).optional(),
    ...nodeFields,
  }).loose(),
  z.object({
    op: z.literal("update"),
    id: z.string(),
    set: z.record(z.string(), z.unknown())
      .describe("title, descriptionMd, startDate, endDate, label, taskType, assignees, shiftDescendants"),
  }).loose(),
  z.object({
    op: z.literal("move"),
    id: z.string(),
    parent: z.union([z.string(), z.null(), z.object({ round: roundSel })]),
    index: z.number().int().min(0),
  }).loose(),
  z.object({
    op: z.literal("shift"),
    from: roundSel,
    to: roundSel.optional().describe("last round to shift (default: last round)"),
    days: z.number().int().min(-180).max(180).describe("calendar days; children and personal goals move along"),
  }).loose(),
]);

export const planDoc = z.object({
  schema: z.literal("sgtudy.plan/v1"),
  baseVersion: z.string().optional().describe("optional: get_curriculum version"),
  ops: z.array(planOp).min(1).max(200),
});

export type PlanDoc = z.infer<typeof planDoc>;
