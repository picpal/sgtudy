import type { ChatLine, Draft, Field, TurnErrorBody, TurnResponse } from "@/lib/ai/schema";

/* POST /api/rooms/interview — 같은 출처 쿠키 세션. 실패는 { error, message, details } 그대로(화면이 대체 경로를 고른다) */

export type TurnBody = { draft: Draft; messages: ChatLine[]; answer?: { field: Field; value: string } | null };
export type TurnError = TurnErrorBody & { status: number };
export type TurnResult = { ok: true; data: TurnResponse } | { ok: false; err: TurnError };

const NETWORK: TurnErrorBody = { error: "AI_UNAVAILABLE", message: "지금은 AI 응답이 어려워요 · 직접 입력으로 이어서 할 수 있어요" };

export async function postTurn(body: TurnBody, fetcher: typeof fetch = fetch): Promise<TurnResult> {
  try {
    const r = await fetcher("/api/rooms/interview", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    if (r.ok) return { ok: true, data: (await r.json()) as TurnResponse };
    const e = (await r.json().catch(() => NETWORK)) as TurnErrorBody;
    return { ok: false, err: { ...NETWORK, ...e, status: r.status } };
  } catch {
    return { ok: false, err: { ...NETWORK, status: 0 } };
  }
}
