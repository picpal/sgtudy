import type { PlanDoc } from "@/lib/mcp/plan-schema";
import { rpc, toApiError, type Db } from "./errors";
import { openRecruit } from "./leader";

/*
 * 방 만들기 직후 회차 초안 적용·모집 시작(2단계 D21·D22·D35). 방은 이미 만들어졌으니 여기 실패는 던지지 않고 note 로 돌려준다 —
 * 생성 화면은 어떤 경우에도 편집 화면으로 이동하고, 편집 화면이 note 를 토스트로 알린다. 서버 검증은 계획서 RPC 가 다시 한다(0034)
 */

export type PlanPreview = { ok: boolean; previewId?: string; errors?: { code: string }[] };
export type ApplyNote = "applied" | "rounds-skipped" | "recruit-skipped";

export const planPreview = (slug: string, plan: PlanDoc, client?: Db) => rpc<PlanPreview>("curriculum_plan_preview", { p_slug: slug, p_plan: plan }, client);
export const planApply = (slug: string, previewId: string, client?: Db) => rpc<{ ok: boolean }>("curriculum_plan_apply", { p_slug: slug, p_preview_id: previewId }, client);

/** preview → apply. 검증 실패·예외는 "rounds-skipped"(콘솔에 코드만) */
export async function applyRoundsPlan(slug: string, plan: PlanDoc, client?: Db): Promise<"applied" | "rounds-skipped"> {
  try {
    const p = await planPreview(slug, plan, client);
    if (!p.ok || !p.previewId) {
      console.warn("rounds plan preview", p.errors?.[0]?.code ?? "NO_PREVIEW");
      return "rounds-skipped";
    }
    const a = await planApply(slug, p.previewId, client);
    if (!a.ok) {
      console.warn("rounds plan apply", "NOT_APPLIED");
      return "rounds-skipped";
    }
    return "applied";
  } catch (e) {
    console.warn("rounds plan", toApiError(e).code);
    return "rounds-skipped";
  }
}

/** 모집 시작(room_open_recruit) — 실패하면 "recruit-skipped". 준비중 막대(DraftRecruitBanner)가 다시 시도 경로다 */
export async function tryOpenRecruit(slug: string, client?: Db): Promise<"applied" | "recruit-skipped"> {
  try {
    await openRecruit(slug, client);
    return "applied";
  } catch (e) {
    console.warn("open recruit", toApiError(e).code);
    return "recruit-skipped";
  }
}

/** 제외한 회차만 뺀 계획서(D30·D31) — 그 밖은 바꾸지 않는다 */
export const withOnly = (plan: PlanDoc, excluded: ReadonlySet<number>): PlanDoc => ({ ...plan, ops: plan.ops.filter((_, i) => !excluded.has(i)) });
