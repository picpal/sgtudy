import { beforeEach, describe, expect, it, vi } from "vitest";

/* OpenAI 어댑터 경계 — 요청 모양(Responses API·strict·effort·상한·store false)과 실패 매핑. 실제 호출 없음 */
vi.mock("server-only", () => ({}));
const parse = vi.fn();
vi.mock("openai", () => {
  class APIError extends Error { constructor(public status: number) { super("x"); } }
  class OpenAI { static APIError = APIError; responses = { parse }; }
  return { default: OpenAI };
});
const { openaiCallModel } = await import("./client");
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
