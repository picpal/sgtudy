import { beforeEach, describe, expect, it, vi } from "vitest";

/* OpenAI 어댑터 경계 — 요청 모양(Responses API·strict·effort·상한·store false)과 실패 매핑. 실제 호출 없음 */
vi.mock("server-only", () => ({}));
const parse = vi.fn();
vi.mock("openai", () => {
  class APIError extends Error { constructor(public status: number) { super("x"); } }
  class OpenAI { static APIError = APIError; responses = { parse }; }
  return { default: OpenAI };
});
const { openaiCallModel, openaiCallRounds } = await import("./client");
const OpenAI = (await import("openai")).default as unknown as { APIError: new (s: number) => Error };

const input = { system: "SYS", messages: [{ role: "user" as const, content: "hi" }], state: {} as never };
beforeEach(() => {
  parse.mockReset();
  vi.stubEnv("AI_INTERVIEW_MODEL", "");
});

describe("openaiCallModel", () => {
  it("Responses API: instructions·input·strict text.format·effort low·max_output_tokens·store false · 사용량 매핑", async () => {
    parse.mockResolvedValue({ status: "completed", output_parsed: { say: "a" }, model: "gpt-6-luna", usage: { input_tokens: 900, output_tokens: 120, input_tokens_details: { cached_tokens: 800 } } });
    const r = await openaiCallModel(input);
    const body = parse.mock.calls[0][0];
    expect(body).toMatchObject({ model: "gpt-6-luna", instructions: "SYS", input: input.messages, reasoning: { effort: "low" }, max_output_tokens: 2048, store: false });
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(body.tools).toBeUndefined();
    expect(body.prompt_cache_key).toBe("sgtudy-room-interview");
    expect(parse.mock.calls[0][1]).toBeUndefined(); // 인스턴스 기본(20s · 재시도 1)
    expect(r).toEqual({ ok: true, turn: { say: "a" }, usage: { in: 900, out: 120, cached: 800 }, model: "gpt-6-luna" });
  });
  it("잘림(incomplete)·거절(output_parsed null) → 실패", async () => {
    parse.mockResolvedValueOnce({ status: "incomplete", output_parsed: null, incomplete_details: { reason: "max_output_tokens" } });
    expect((await openaiCallModel(input)).ok).toBe(false);
    parse.mockResolvedValueOnce({ status: "completed", output_parsed: null });
    expect((await openaiCallModel(input)).ok).toBe(false);
  });
  it("API 오류는 상태 코드만, 그 밖은 undefined", async () => {
    parse.mockRejectedValueOnce(new OpenAI.APIError(429));
    expect(await openaiCallModel(input)).toEqual({ ok: false, status: 429 });
    parse.mockRejectedValueOnce(new Error("timeout"));
    expect(await openaiCallModel(input)).toEqual({ ok: false, status: undefined });
  });
  it("AI_INTERVIEW_MODEL 로 모델을 바꾼다", async () => {
    vi.stubEnv("AI_INTERVIEW_MODEL", "gpt-6-sol");
    parse.mockResolvedValue({ status: "completed", output_parsed: { say: "a" } });
    await openaiCallModel(input);
    expect(parse.mock.calls[0][0].model).toBe("gpt-6-sol");
  });
});

describe("openaiCallRounds", () => {
  const slot = (i: number) => ({ index: i, label: `${i + 1}주차`, startDate: "2026-10-26", endDate: "2026-11-01" });
  const rin = { system: "RSYS", messages: [{ role: "user" as const, content: "<schedule/>" }], state: {} as never, write: [slot(0), slot(1), slot(2)] };
  it("strict 회차 포맷 · 12,000 상한 · 캐시 키 · 요청 옵션 timeout 50s · 재시도 0 · 사용량 매핑", async () => {
    parse.mockResolvedValue({ status: "completed", output_parsed: { rounds: [] }, model: "gpt-6-luna", usage: { input_tokens: 3000, output_tokens: 2500, input_tokens_details: { cached_tokens: 1200 } } });
    const r = await openaiCallRounds(rin);
    const [body, opts] = parse.mock.calls[0];
    expect(body).toMatchObject({ model: "gpt-6-luna", instructions: "RSYS", input: rin.messages, reasoning: { effort: "low" }, max_output_tokens: 12_000, store: false, prompt_cache_key: "sgtudy-room-rounds" });
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true, name: "room_rounds_draft" });
    // 배열 길이 = 쓸 회차 수(D39) · 항목마다 회차 번호
    expect(body.text.format.schema.properties.rounds).toMatchObject({ minItems: 3, maxItems: 3, items: { required: ["index", "title", "goalMd", "tasks"] } });
    expect(opts).toEqual({ timeout: 50_000, maxRetries: 0 });
    expect(r).toEqual({ ok: true, output: { rounds: [] }, usage: { in: 3000, out: 2500, cached: 1200 }, model: "gpt-6-luna" });
  });
  it("재요청: 빠진 회차 수만큼의 길이 · 남은 시간 timeout", async () => {
    parse.mockResolvedValue({ status: "completed", output_parsed: { rounds: [] }, model: "m" });
    await openaiCallRounds({ ...rin, write: [slot(25)], timeoutMs: 20_000 });
    const [body, opts] = parse.mock.calls[0];
    expect(body.text.format.schema.properties.rounds).toMatchObject({ minItems: 1, maxItems: 1 });
    expect(opts).toEqual({ timeout: 20_000, maxRetries: 0 });
  });
  it("잘림·API 오류 → 실패(상태 코드만)", async () => {
    parse.mockResolvedValueOnce({ status: "incomplete", output_parsed: null });
    expect(await openaiCallRounds(rin)).toEqual({ ok: false, status: 200 });
    parse.mockRejectedValueOnce(new OpenAI.APIError(503));
    expect(await openaiCallRounds(rin)).toEqual({ ok: false, status: 503 });
  });
});
