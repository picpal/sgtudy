import { clampCp } from "@/components/room-new/validate";
import { CONFIRM_ASK, defaultAsk, sanitizeAsk } from "./chips";
import { computeMissing, deriveAnswer, mergeDraft, normalizeDraft, normalizePatch, stripControl, type TagDict } from "./normalize";
import { buildMessages, systemPrompt, type ChatInput } from "./prompt";
import { MAX_MESSAGES, ModelTurnIn, SAY_MAX, type Draft, type Dropped, type Field, type InterviewRequest, type RequiredField, type TurnResponse } from "./schema";

/* 인터뷰 한 턴(§5.3) — 순수 로직. 모델 호출은 주입(callModel)이라 테스트·목 모드는 대본을 끼운다. I/O·키 없음 */

export type Usage = { in: number; out: number; cached: number };
/** 모델 호출 — 실제는 client.ts(openaiCallModel), 로컬·테스트는 interview-mock.ts */
export type CallModel = (input: {
  system: string;
  messages: ChatInput[];
  /** 목 대본용 — 실제 호출은 쓰지 않는다 */
  state: { draft: Draft; missing: RequiredField[]; today: string; lastUser: string | null; lastAssistant: string | null; answer: { field: Field; value: string } | null };
}) => Promise<{ ok: true; turn: unknown; usage: Usage; model: string } | { ok: false; status?: number }>;

export type TurnResult =
  | { ok: true; body: TurnResponse; usage: Usage; model: string }
  | { ok: false; error: "AI_UNAVAILABLE"; status?: number };

const FALLBACK_SAY = "다음 항목을 골라 주세요.";

/** 409 AI_TURN_LIMIT — 사용량을 남기기 전에(라우트가 ai_turn_check 앞에서) 본다 */
export const turnLimitExceeded = (req: InterviewRequest) => req.messages.length > MAX_MESSAGES;
/** 인터뷰 첫 턴 = 사용자 말이 아직 없다(하루 시작 횟수 상한) */
export const isStart = (req: InterviewRequest) => !req.messages.some((m) => m.role === "user");

export async function runTurn(req: InterviewRequest, deps: { callModel: CallModel; today: string; tagDict: TagDict }): Promise<TurnResult> {
  const { today, tagDict } = deps;
  // 1) 클라이언트 초안은 다시 거른다 → 2) 칩 답을 실제 필드로(서버가 먼저 반영, 모델은 결과만 본다)
  const base = normalizeDraft(req.draft, today, tagDict);
  const derived = normalizePatch(deriveAnswer(req.answer, base), base, today, tagDict);
  const draft1 = mergeDraft(base, derived.patch);
  const missing1 = computeMissing(draft1, today);
  const lastUser = req.messages.at(-1)?.role === "user" ? req.messages.at(-1)!.text : null;
  const lastAssistant = [...req.messages].reverse().find((m) => m.role === "assistant")?.text ?? null;

  const res = await deps.callModel({
    system: systemPrompt(tagDict),
    messages: buildMessages({ today, draft: draft1, missing: missing1, dropped: derived.dropped, messages: req.messages, answer: req.answer }),
    state: { draft: draft1, missing: missing1, today, lastUser, lastAssistant, answer: req.answer ?? null },
  });
  if (!res.ok) return { ok: false, error: "AI_UNAVAILABLE", status: res.status };
  const parsed = ModelTurnIn.safeParse(res.turn);
  if (!parsed.success) return { ok: false, error: "AI_UNAVAILABLE" };
  const m = parsed.data;

  // 3) 모델 patch 정규화(D10) → 4) 완료는 서버가 판정(D11)
  // null = 이번에 안 바꿈(strict 스키마) — 정규화 전에 뺀다
  const modelPatch = Object.fromEntries(Object.entries(m.patch).filter(([, v]) => v !== null && v !== undefined));
  const fromModel = normalizePatch(modelPatch, draft1, today, tagDict);
  const draft = mergeDraft(draft1, fromModel.patch);
  const missing = computeMissing(draft, today);
  const done = m.done && missing.length === 0;
  // 안 끝났는데 질문도 칩도 없으면 확인 질문이다 — 사용자가 "네" 를 직접 치지 않게 예/아니요 칩
  const ask = done ? null : (sanitizeAsk(m.ask, draft, today) ?? defaultAsk(missing, today) ?? CONFIRM_ASK);
  const dropped: Dropped[] = [...derived.dropped, ...fromModel.dropped];
  const say = clampCp(stripControl(m.say).trim(), SAY_MAX) || FALLBACK_SAY;
  const sent = req.messages.length;
  return {
    ok: true,
    body: {
      say, patch: { ...derived.patch, ...fromModel.patch }, draft, ask, missing, dropped, done,
      turn: req.messages.filter((x) => x.role === "assistant").length + 1, // 이번 응답이 몇 번째 AI 말인가
      turnsLeft: Math.max(0, Math.floor((MAX_MESSAGES - sent) / 2)),
    },
    usage: res.usage,
    model: res.model,
  };
}
