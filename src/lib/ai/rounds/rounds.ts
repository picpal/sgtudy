import type { Usage } from "../interview";
import { normalizeDraft } from "../normalize";
import type { ChatInput } from "../prompt";
import type { Draft } from "../schema";
import { buildRoundsMessages, ROUNDS_SYSTEM } from "./prompt";
import { splitRounds, type Schedule } from "./schedule";
import { RoundsModelIn, type RoundsRequest, type RoundsResponse } from "./schema";
import { examEachRound, tasksPerRound, toPlan } from "./toPlan";

/* 회차 초안 한 번(§5.1·D28) — 순수 로직. 모델 호출은 주입(callRounds)이라 테스트·목 모드는 대본을 끼운다. I/O·키 없음 */

/** 검증을 통과한 요청 — 라우트가 사용량을 남기기 전에 만든다(날짜 없는 요청은 상한을 쓰지 않는다) */
export type PreparedRounds = { today: string; draft: Draft & { title: string; startDate: string; endDate: string }; schedule: Schedule; style: string[]; userLines: string[] };

/** 모델 호출 — 실제는 client.ts(openaiCallRounds), 로컬·테스트는 rounds-mock.ts */
export type CallRounds = (input: {
  system: string;
  messages: ChatInput[];
  /** 목 대본용 — 실제 호출은 쓰지 않는다 */
  state: PreparedRounds;
}) => Promise<{ ok: true; output: unknown; usage: Usage; model: string } | { ok: false; status?: number }>;

export type RoundsResult = { ok: true; body: RoundsResponse; usage: Usage; model: string } | { ok: false; error: "AI_UNAVAILABLE"; status?: number };

/** 클라이언트 초안(위조 가능)을 다시 거른다. 제목·시작일·종료일이 없으면 null → 400 */
export function prepareRounds(req: RoundsRequest, today: string): PreparedRounds | null {
  const draft = normalizeDraft(req.draft, today, []);
  const { title, startDate, endDate } = draft;
  if (!title || !startDate || !endDate) return null;
  return { today, draft: { ...draft, title, startDate, endDate }, schedule: splitRounds(startDate, endDate), style: [...req.style], userLines: [...req.userLines] };
}

export async function runRounds(p: PreparedRounds, deps: { callRounds: CallRounds }): Promise<RoundsResult> {
  const opts = { tasksPerRound: tasksPerRound(p.style), examEachRound: examEachRound(p.style) };
  const res = await deps.callRounds({
    system: ROUNDS_SYSTEM,
    messages: buildRoundsMessages({ today: p.today, draft: p.draft, style: p.style, schedule: p.schedule, tasksPerRound: opts.tasksPerRound, userLines: p.userLines }),
    state: p,
  });
  if (!res.ok) return { ok: false, error: "AI_UNAVAILABLE", status: res.status };
  const parsed = RoundsModelIn.safeParse(res.output);
  if (!parsed.success) return { ok: false, error: "AI_UNAVAILABLE" };
  return { ok: true, body: toPlan(p.schedule, parsed.data, opts), usage: res.usage, model: res.model };
}
