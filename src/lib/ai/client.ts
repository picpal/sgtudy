import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { aiModel } from "./env";
import type { CallModel } from "./interview";
import { ModelTurn } from "./schema";

/*
 * 실제 모델 호출(§5.3·D2~D4, 변경: 사용자 지정 OpenAI luna). Responses API · 비스트리밍 · Structured Outputs(strict, zodTextFormat) ·
 * reasoning effort low · 도구 없음 · store:false(응답을 OpenAI 쪽 대화 상태로 남기지 않는다).
 * max_output_tokens 는 추론 토큰을 포함하므로 출력(≈300)보다 넉넉히 2048 — 잘리면(status incomplete) 503 으로.
 * 실패(타임아웃·429·5xx·거절·잘림·파싱 실패)는 모두 { ok:false, status } — 라우트가 503 AI_UNAVAILABLE 로 바꾼다. 원문 메시지는 밖으로 내지 않는다.
 */

const FORMAT = zodTextFormat(ModelTurn, "room_interview_turn");
let client: OpenAI | null = null;
const getClient = () => (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 }));

export const openaiCallModel: CallModel = async ({ system, messages }) => {
  const model = aiModel();
  try {
    const res = await getClient().responses.parse({
      model,
      instructions: system, // 요청마다 같은 바이트 — 앞부분 자동 프롬프트 캐시
      input: messages,
      text: { format: FORMAT },
      reasoning: { effort: "low" },
      max_output_tokens: 2048,
      store: false,
      prompt_cache_key: "sgtudy-room-interview",
    });
    if (res.status !== "completed" || !res.output_parsed) return { ok: false, status: 200 }; // 잘림(incomplete)·거절(refusal)
    const u = res.usage;
    return { ok: true, turn: res.output_parsed, usage: { in: u?.input_tokens ?? 0, out: u?.output_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0 }, model: res.model ?? model };
  } catch (e) {
    // 상태 코드만 남긴다(RateLimitError 429 · 5xx · 타임아웃/연결 = undefined · 파싱 실패 = undefined)
    return { ok: false, status: e instanceof OpenAI.APIError ? e.status : undefined };
  }
};
