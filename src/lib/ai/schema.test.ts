import { zodTextFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";
import { ModelTurn, ModelTurnIn } from "./schema";

type JsonSchema = { type?: unknown; properties?: Record<string, JsonSchema>; required?: string[]; additionalProperties?: unknown; anyOf?: JsonSchema[]; items?: JsonSchema };

/** strict 제약: 모든 object 는 properties 를 전부 required 로, additionalProperties:false */
function assertStrict(s: JsonSchema, path = "$") {
  for (const sub of s.anyOf ?? []) assertStrict(sub, path);
  if (s.items) assertStrict(s.items, `${path}[]`);
  if (s.properties) {
    expect(s.required?.slice().sort(), path).toEqual(Object.keys(s.properties).sort());
    expect(s.additionalProperties, path).toBe(false);
    for (const [k, v] of Object.entries(s.properties)) assertStrict(v, `${path}.${k}`);
  }
}

describe("모델 출력 스키마 (OpenAI Structured Outputs strict)", () => {
  it("zodTextFormat 로 strict json_schema — 모든 키 required, 선택 값은 nullable", () => {
    const f = zodTextFormat(ModelTurn, "room_interview_turn");
    expect([f.type, f.strict, f.name]).toEqual(["json_schema", true, "room_interview_turn"]);
    assertStrict(f.schema as JsonSchema);
  });
  it("서버 검사판은 키를 생략해도 되고 null 도 받는다", () => {
    expect(ModelTurnIn.safeParse({ say: "a", patch: {}, ask: { field: "title", kind: "text" }, done: false }).success).toBe(true);
    expect(ModelTurnIn.safeParse({ say: "a", patch: { title: null }, ask: null, done: false }).success).toBe(true);
    expect(ModelTurn.safeParse({ say: "a", patch: {}, ask: null, done: false }).success).toBe(false);
  });
});
