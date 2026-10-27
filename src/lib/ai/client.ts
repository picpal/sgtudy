import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { aiModel } from "./env";
import type { CallExplain } from "./explain/explain";
import { ExplainOut } from "./explain/schema";
import type { CallModel, Usage } from "./interview";
import type { ChatInput } from "./prompt";
import type { CallRounds } from "./rounds/rounds";
import { roundsModelFor } from "./rounds/schema";
import { ModelTurn } from "./schema";

/*
 * 실제 모델 호출(§5.3·D2~D4, 변경: 사용자 지정 OpenAI luna). Responses API · 비스트리밍 · Structured Outputs(strict, zodTextFormat) ·
 * reasoning effort low · 도구 없음 · store:false(응답을 OpenAI 쪽 대화 상태로 남기지 않는다).
 * max_output_tokens 는 추론 토큰을 포함하므로 출력보다 넉넉히 — 잘리면(status incomplete) 503 으로.
 * 실패(타임아웃·429·5xx·거절·잘림·파싱 실패)는 모두 { ok:false, status } — 라우트가 503 AI_UNAVAILABLE 로 바꾼다. 원문 메시지는 밖으로 내지 않는다.
 * 클라이언트 인스턴스는 하나 — 기능마다 다른 timeout·maxRetries 는 요청 옵션으로 넘긴다.
 */

let client: OpenAI | null = null;
const getClient = () => (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 }));

type StructuredOpts = {
  format: ReturnType<typeof zodTextFormat>;
  cacheKey: string;
  maxOutputTokens: number;
  /** 없으면 인스턴스 기본(20s · 재시도 1) */
  request?: { timeout: number; maxRetries: number };
};
type StructuredResult = { ok: true; parsed: unknown; usage: Usage; model: string } | { ok: false; status?: number };

async function callStructured(o: StructuredOpts, input: { system: string; messages: ChatInput[] }): Promise<StructuredResult> {
  const model = aiModel();
  try {
    const res = await getClient().responses.parse(
      {
        model,
        instructions: input.system, // 요청마다 같은 바이트 — 앞부분 자동 프롬프트 캐시
        input: input.messages,
        text: { format: o.format },
        reasoning: { effort: "low" },
        max_output_tokens: o.maxOutputTokens,
        store: false,
        prompt_cache_key: o.cacheKey,
      },
      o.request,
    );
    if (res.status !== "completed" || !res.output_parsed) return { ok: false, status: 200 }; // 잘림(incomplete)·거절(refusal)
    const u = res.usage;
    return { ok: true, parsed: res.output_parsed, usage: { in: u?.input_tokens ?? 0, out: u?.output_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0 }, model: res.model ?? model };
  } catch (e) {
    // 상태 코드만 남긴다(RateLimitError 429 · 5xx · 타임아웃/연결 = undefined · 파싱 실패 = undefined)
    return { ok: false, status: e instanceof OpenAI.APIError ? e.status : undefined };
  }
}

/** 인터뷰 한 턴 — 출력 ≈300 토큰, 2048 상한 */
const TURN = { format: zodTextFormat(ModelTurn, "room_interview_turn"), cacheKey: "sgtudy-room-interview", maxOutputTokens: 2048 };
export const openaiCallModel: CallModel = async ({ system, messages }) => {
  const r = await callStructured(TURN, { system, messages });
  return r.ok ? { ok: true, turn: r.parsed, usage: r.usage, model: r.model } : r;
};

/**
 * 회차 초안(D28) — 26회차 ≈ 6k 토큰 + 추론이라 12,000 상한 · 50초 · 재시도 없음(라우트 maxDuration 60 안).
 * 출력 배열 길이를 쓸 회차 수로 못박는다(strict minItems = maxItems, D39) — 스키마가 n 마다 달라 n 별로 한 번 만들어 둔다
 */
const roundsFormats = new Map<number, ReturnType<typeof zodTextFormat>>();
const roundsFormat = (n: number) => {
  let f = roundsFormats.get(n);
  if (!f) roundsFormats.set(n, (f = zodTextFormat(roundsModelFor(n), "room_rounds_draft")));
  return f;
};
export const openaiCallRounds: CallRounds = async ({ system, messages, write, timeoutMs }) => {
  const opts = { format: roundsFormat(write.length), cacheKey: "sgtudy-room-rounds", maxOutputTokens: 12_000, request: { timeout: timeoutMs ?? 50_000, maxRetries: 0 } };
  const r = await callStructured(opts, { system, messages });
  return r.ok ? { ok: true, output: r.parsed, usage: r.usage, model: r.model } : r;
};

/** 용어 해설(D10) — 출력 ≈450, 1500 상한 · 25s · 재시도 없음(라우트 maxDuration 30 안) */
const EXPLAIN = { format: zodTextFormat(ExplainOut, "term_explain"), cacheKey: "sgtudy-term-explain", maxOutputTokens: 1500, request: { timeout: 25_000, maxRetries: 0 } };
export const openaiCallExplain: CallExplain = async ({ system, messages }) => {
  const r = await callStructured(EXPLAIN, { system, messages });
  return r.ok ? { ok: true, output: r.parsed, usage: r.usage, model: r.model } : r;
};
