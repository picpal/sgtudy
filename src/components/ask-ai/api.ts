import type { ExplainResponse, Source } from "@/lib/ai/explain/schema";
import type { TurnErrorBody } from "@/lib/ai/schema";
import { COPY } from "./copy";

/* POST /api/rooms/explain — 같은 출처 쿠키 세션. 실패는 { error, message, details } 그대로 + status (room-new/interview/api.ts 와 같은 모양) */

export type ExplainBody = { slug: string; term: string; source: Source; context: string };
export type ExplainError = TurnErrorBody & { status: number };
export type ExplainResult = { ok: true; data: ExplainResponse } | { ok: false; err: ExplainError };

const NETWORK: TurnErrorBody = { error: "AI_UNAVAILABLE", message: COPY.unavailable };

export async function postExplain(body: ExplainBody, opts: { fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<ExplainResult> {
  const fetcher = opts.fetcher ?? fetch;
  try {
    const r = await fetcher("/api/rooms/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (r.ok) return { ok: true, data: (await r.json()) as ExplainResponse };
    const e = (await r.json().catch(() => NETWORK)) as TurnErrorBody;
    return { ok: false, err: { ...NETWORK, ...e, status: r.status } };
  } catch {
    return { ok: false, err: { ...NETWORK, status: 0 } };
  }
}

/** 화면 문구(§6) — 코드·상한 창으로 고른다. 모르는 코드는 서버 문구, 그것도 없으면 일반 실패 문구 */
export function errorMessage(err: Pick<ExplainError, "error" | "message" | "details">): string {
  const w = err.details?.window;
  switch (err.error) {
    case "RATE_LIMITED":
      return w === "explainTenMin" ? COPY.rateTenMin : COPY.rateDay;
    case "AI_BUDGET_EXCEEDED":
      return COPY.budget;
    case "EXAM_IN_PROGRESS":
      return COPY.inProgress;
    case "NOT_MEMBER":
      return COPY.notMember;
    case "AI_UNAVAILABLE":
      return COPY.unavailable;
    default:
      return err.message || COPY.unavailable;
  }
}
