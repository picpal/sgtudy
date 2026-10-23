import type { Usage } from "../interview";
import { normalizeDraft } from "../normalize";
import type { ChatInput } from "../prompt";
import type { Draft } from "../schema";
import { buildRoundsMessages, ROUNDS_SYSTEM } from "./prompt";
import { splitRounds, type Schedule, type ScheduleRound } from "./schedule";
import { sanitizeLine } from "./sanitize";
import { ROUND_TITLE_MAX, RoundsModelIn, type RoundModelItem, type RoundsRequest, type RoundsResponse } from "./schema";
import { examEachRound, placeRounds, tasksPerRound, toPlan } from "./toPlan";

/* 회차 초안 한 번(§5.1·D28) — 순수 로직. 모델 호출은 주입(callRounds)이라 테스트·목 모드는 대본을 끼운다. I/O·키 없음 */

/** 검증을 통과한 요청 — 라우트가 사용량을 남기기 전에 만든다(날짜 없는 요청은 상한을 쓰지 않는다) */
export type PreparedRounds = { today: string; draft: Draft & { title: string; startDate: string; endDate: string }; schedule: Schedule; style: string[]; userLines: string[] };

/** 모델 호출 — 실제는 client.ts(openaiCallRounds), 로컬·테스트는 rounds-mock.ts */
export type CallRounds = (input: {
  system: string;
  messages: ChatInput[];
  /** 목 대본용 — 실제 호출은 쓰지 않는다 */
  state: PreparedRounds;
  /** 이번에 쓸 회차 — 출력 배열 길이를 이 수로 못박는다(D39) */
  write: ScheduleRound[];
  /** 없으면 기본(50s). 재요청은 남은 시간으로 줄인다(D40) */
  timeoutMs?: number;
}) => Promise<{ ok: true; output: unknown; usage: Usage; model: string } | { ok: false; status?: number }>;

/** refill = 모자라서 한 번 더 요청한 회차 수(0 = 재요청 없음) — 로그용 */
export type RoundsResult = { ok: true; body: RoundsResponse; usage: Usage; model: string; refill: number } | { ok: false; error: "AI_UNAVAILABLE"; status?: number };

/** 라우트 maxDuration 60s 안에서 모델 호출에 쓰는 시간. 재요청은 남은 시간이 REFILL_MIN_MS 이상일 때만 */
export const ROUNDS_BUDGET_MS = 55_000;
const REFILL_MIN_MS = 8_000;

/** 클라이언트 초안(위조 가능)을 다시 거른다. 제목·시작일·종료일이 없으면 null → 400 */
export function prepareRounds(req: RoundsRequest, today: string): PreparedRounds | null {
  const draft = normalizeDraft(req.draft, today, []);
  const { title, startDate, endDate } = draft;
  if (!title || !startDate || !endDate) return null;
  return { today, draft: { ...draft, title, startDate, endDate }, schedule: splitRounds(startDate, endDate), style: [...req.style], userLines: [...req.userLines] };
}

/**
 * 1) 전 회차를 한 번에 요청 → 2) 회차 번호로 자리를 맞추고 → 3) 빈 자리가 있으면 그 회차만 한 번 더(D40, 시간이 남을 때) →
 * 4) 그래도 빈 자리는 toPlan 이 채움 회차로. 사용량은 두 호출을 합쳐 한 번(ai_turn_check 1회 · ai_turn_done 1회)으로 기록한다
 */
export async function runRounds(p: PreparedRounds, deps: { callRounds: CallRounds; now?: () => number }): Promise<RoundsResult> {
  const now = deps.now ?? Date.now;
  const t0 = now();
  const opts = { tasksPerRound: tasksPerRound(p.style), examEachRound: examEachRound(p.style) };
  const all = p.schedule.rounds;
  const call = (write: ScheduleRound[], written: { label: string; title: string }[], timeoutMs?: number) =>
    deps.callRounds({
      system: ROUNDS_SYSTEM,
      messages: buildRoundsMessages({ today: p.today, draft: p.draft, style: p.style, schedule: p.schedule, tasksPerRound: opts.tasksPerRound, userLines: p.userLines, write, written }),
      state: p,
      write,
      ...(timeoutMs ? { timeoutMs } : {}),
    });

  const res = await call(all, []);
  if (!res.ok) return { ok: false, error: "AI_UNAVAILABLE", status: res.status };
  const parsed = RoundsModelIn.safeParse(res.output);
  if (!parsed.success) return { ok: false, error: "AI_UNAVAILABLE" };
  const placed = new Map<number, RoundModelItem>();
  placeRounds(all, parsed.data.rounds, placed);
  const usage = { ...res.usage };

  const missing = all.filter((r) => !placed.has(r.index));
  const left = ROUNDS_BUDGET_MS - (now() - t0);
  if (missing.length && left >= REFILL_MIN_MS) {
    const written = all.flatMap((r) => (placed.has(r.index) ? [{ label: r.label, title: sanitizeLine(placed.get(r.index)!.title, ROUND_TITLE_MAX) }] : []));
    const again = await call(missing, written, left - 2_000);
    if (again.ok) {
      usage.in += again.usage.in;
      usage.out += again.usage.out;
      usage.cached += again.usage.cached;
      const more = RoundsModelIn.safeParse(again.output);
      if (more.success) placeRounds(missing, more.data.rounds, placed);
    }
  }
  const body = toPlan(p.schedule, { rounds: all.map((r) => placed.get(r.index)) }, opts);
  return { ok: true, body, usage, model: res.model, refill: missing.length };
}
