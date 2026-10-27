import type { Usage } from "../interview";
import type { ChatInput } from "../prompt";
import { buildExplainMessages, EXPLAIN_SYSTEM, type ExplainInput } from "./prompt";
import { sanitizeExplain } from "./sanitize";
import { ExplainOut } from "./schema";

/* 용어 해설 한 번(D7·D10) — 메시지 조립 → 모델 → 스키마 검사 → 정제. 순수(모델은 주입) */

/** 모델 호출 — 실제는 client.ts(openaiCallExplain), 로컬·테스트는 explain-mock.ts. term 은 목 대본용(실제 호출은 쓰지 않는다) */
export type CallExplain = (i: { system: string; messages: ChatInput[]; term: string }) => Promise<
  { ok: true; output: unknown; usage: Usage; model: string } | { ok: false; status?: number }
>;

export type ExplainResult = { ok: true; body: ExplainOut; usage: Usage; model: string } | { ok: false; status?: number };

export async function runExplain(p: ExplainInput, deps: { callExplain: CallExplain }): Promise<ExplainResult> {
  const r = await deps.callExplain({ system: EXPLAIN_SYSTEM, messages: buildExplainMessages(p), term: p.term });
  if (!r.ok) return { ok: false, status: r.status };
  const parsed = ExplainOut.safeParse(r.output);
  if (!parsed.success) return { ok: false, status: 200 };
  const body = sanitizeExplain(parsed.data, p.term);
  if (!body.oneLiner && body.kind === "term") return { ok: false, status: 200 }; // 빈 해설은 실패로(캐시에 남기지 않는다)
  return { ok: true, body, usage: r.usage, model: r.model };
}
