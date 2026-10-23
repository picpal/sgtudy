import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiModel } from "./env";
import type { CallModel } from "./interview";
import { ModelTurn } from "./schema";

/*
 * 실제 Claude 호출(§5.3·D2~D4). 비스트리밍 · 구조화 출력(messages.parse + zodOutputFormat) · effort low · system 캐시.
 * 실패(타임아웃·429·5xx·refusal·파싱 실패)는 모두 { ok:false, status } — 라우트가 503 AI_UNAVAILABLE 로 바꾼다. 원문 메시지는 밖으로 내지 않는다.
 */

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 1 }));

export const anthropicCallModel: CallModel = async ({ system, messages }) => {
  const model = aiModel();
  try {
    const res = await getClient().messages.parse({
      model,
      max_tokens: 1024,
      output_config: { format: zodOutputFormat(ModelTurn), effort: "low" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
    });
    if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens" || !res.parsed_output) return { ok: false, status: 200 };
    const u = res.usage;
    return { ok: true, turn: res.parsed_output, usage: { in: u.input_tokens, out: u.output_tokens, cached: u.cache_read_input_tokens ?? 0 }, model: res.model ?? model };
  } catch (e) {
    // 상태 코드만 남긴다(RateLimitError 429 · InternalServerError 5xx · 타임아웃/연결 = undefined · 파싱 실패 = undefined)
    return { ok: false, status: e instanceof Anthropic.APIError ? e.status : undefined };
  }
};
