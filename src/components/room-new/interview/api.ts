import type { RoundsResponse } from "@/lib/ai/rounds/schema";
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

/* POST /api/rooms/rounds — 회차 초안(2단계 §5.1). 같은 실패 모양 */
export type RoundsBody = { draft: Draft; userLines: string[]; style: string[] };
export type RoundsResult = { ok: true; data: RoundsResponse } | { ok: false; err: TurnError };
const ROUNDS_NETWORK: TurnErrorBody = { error: "AI_UNAVAILABLE", message: "회차 초안은 지금 어려워요 · 방만 먼저 만들고 진행목표에서 채울 수 있어요" };

export async function postRounds(body: RoundsBody, fetcher: typeof fetch = fetch): Promise<RoundsResult> {
  try {
    const r = await fetcher("/api/rooms/rounds", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    if (r.ok) return { ok: true, data: (await r.json()) as RoundsResponse };
    const e = (await r.json().catch(() => ROUNDS_NETWORK)) as TurnErrorBody;
    return { ok: false, err: { ...ROUNDS_NETWORK, ...e, status: r.status } };
  } catch {
    return { ok: false, err: { ...ROUNDS_NETWORK, status: 0 } };
  }
}
