// supabase/tests/ai-rounds-usage-sql.test.ts — 0049 AI 회차 초안 사용량·상한 (스펙 2026-10-23-room-create-ai-rounds-design D29)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, one, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
const check = async (q: Q, kind: unknown = "room_rounds", started = false) =>
  (await one(q, "select public.ai_turn_check($1, $2) as r", [kind, started])).r as Row;
/** fail() 의 hint(JSON) — details */
async function failHint(p: Promise<unknown>, code: string): Promise<Row> {
  try { await p; } catch (e) {
    const er = e as Error & { hint?: string };
    assertEquals(er.message, code);
    return JSON.parse(er.hint ?? "{}");
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}
/** 과거 사용 행을 직접 채운다(상한 경계 준비) */
const fill = (q: Q, uid: string, n: number, at: string, kind = "room_interview", started = false) =>
  q(`insert into public.ai_usage (user_id, kind, started, created_at)
     select $1::uuid, $2, $3, $4::timestamptz from generate_series(1, $5::int)`, [uid, kind, started, at, n]);

cases("ai_usage 0049 · schema", db, [
  { name: "kind check allows room_rounds · rejects others · ai_limits has rounds keys · grants unchanged", run: async (q) => {
    const uid = await uidOf(q, "지은");
    await fill(q, uid, 1, "2026-10-23T09:00:00+09:00", "room_rounds");
    await expectFail(fill(q, uid, 1, "2026-10-23T09:00:00+09:00", "exam_draft"), "ai_usage_kind_check");
    const lim = (await one(q, "select public.ai_limits() as v")).v as Row;
    // 0052 가 explain* 키를 더했다 — 0049 키 값은 그대로
    assertEquals({ ...lim, explainPerTenMin: undefined, explainPerDay: undefined, explainGlobalPerDay: undefined },
      { perTenMin: 30, perDay: 120, startsPerDay: 10, globalPerDay: 3000, roundsPerDay: 10, roundsGlobalPerDay: 300,
        explainPerTenMin: undefined, explainPerDay: undefined, explainGlobalPerDay: undefined });
    const can = async (role: string, f: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, `public.${f}`])).v;
    assertEquals(await can("authenticated", "ai_turn_check(text,boolean)"), true);
    assertEquals(await can("anon", "ai_turn_check(text,boolean)"), false);
    assertEquals(await can("authenticated", "ai_limits()"), false);
  } },
]);

cases("ai_usage 0049 · room_rounds", db, [
  { name: "first call returns {id} · row kind room_rounds · started stays false even if p_started=true", run: async (q) => {
    await setNow(q, "2026-10-23T10:00:00+09:00");
    await as(q, "지은");
    const r = await check(q, "room_rounds", true);
    assertEquals(typeof r.id, "number");
    const row = await one(q, "select kind, started from public.ai_usage where id = $1", [r.id]);
    assertEquals(row, { kind: "room_rounds", started: false });
  } },
  { name: "rounds per day: 10 ok, 11th → RATE_LIMITED window rounds · per user · next day ok", run: async (q) => {
    await setNow(q, "2026-10-23T10:00:00+09:00");
    await as(q, "지은");
    await fill(q, await uidOf(q, "지은"), 9, "2026-10-23T08:00:00+09:00", "room_rounds");
    await check(q);   // 10번째
    const h = await failHint(check(q), "RATE_LIMITED");
    assertEquals([h.window, h.retryAfterSec], ["rounds", 22 * 3600]);
    await check(q, "room_interview");   // 인터뷰는 계속된다
    await as(q, "철수");
    await check(q);
    await setNow(q, "2026-10-24T08:00:01+09:00");
    await as(q, "지은");
    await check(q);
  } },
  { name: "10 min window is shared: 29 interview turns + 1 rounds → next interview RATE_LIMITED tenMin", run: async (q) => {
    await setNow(q, "2026-10-23T10:00:00+09:00");
    await as(q, "지은");
    await fill(q, await uidOf(q, "지은"), 29, "2026-10-23T09:55:00+09:00");
    await check(q);
    assertEquals((await failHint(check(q, "room_interview"), "RATE_LIMITED")).window, "tenMin");
    assertEquals((await failHint(check(q), "RATE_LIMITED")).window, "tenMin");
  } },
  { name: "rounds do not consume interview startsPerDay", run: async (q) => {
    await setNow(q, "2026-10-23T12:00:00+09:00");
    await as(q, "지은");
    await fill(q, await uidOf(q, "지은"), 9, "2026-10-23T08:00:00+09:00", "room_interview", true);
    for (let i = 0; i < 3; i++) await check(q, "room_rounds", true);
    await check(q, "room_interview", true);   // 10번째 시작 — rounds 3회는 안 셌다
    assertEquals((await failHint(check(q, "room_interview", true), "RATE_LIMITED")).window, "starts");
  } },
  { name: "global rounds budget (lowered to 2) → AI_BUDGET_EXCEEDED · interview unaffected", run: async (q) => {
    await setNow(q, "2026-10-23T12:00:00+09:00");
    await q(`create or replace function public.ai_limits() returns jsonb language sql immutable set search_path = '' as $$
      select '{"perTenMin":30,"perDay":120,"startsPerDay":10,"globalPerDay":3000,"roundsPerDay":10,"roundsGlobalPerDay":2}'::jsonb $$`);
    await as(q, "지은");
    await check(q);
    await as(q, "철수");
    await check(q);
    await as(q, "민수");
    await expectFail(check(q), "AI_BUDGET_EXCEEDED");
    await check(q, "room_interview");
    assertEquals((await one(q, "select count(*)::int as n from public.ai_usage where user_id = $1", [await uidOf(q, "민수")])).n, 1);
  } },
  { name: "interview global 3000 counts interview rows only (rounds rows are separate)", run: async (q) => {
    await setNow(q, "2026-10-23T12:00:00+09:00");
    const other = await uidOf(q, "철수");
    await fill(q, other, 2999, "2026-10-23T11:00:00+09:00");
    await fill(q, other, 200, "2026-10-23T11:00:00+09:00", "room_rounds");
    await as(q, "지은");
    await check(q, "room_interview");   // 3000번째
    await expectFail(check(q, "room_interview"), "AI_BUDGET_EXCEEDED");
    await check(q);   // rounds 는 자체 통(200 < 300)
  } },
  { name: "unknown kind → VALIDATION_FAILED", run: async (q) => {
    await as(q, "지은");
    assertEquals((await failHint(check(q, "unknown"), "VALIDATION_FAILED")).field, "kind");
  } },
]);

cases("ai_usage 0049 · room_interview regression (0047 동작)", db, [
  { name: "started=true row · 31st turn tenMin · day 120 · starts 11th", run: async (q) => {
    await setNow(q, "2026-10-23T10:00:00+09:00");
    await as(q, "지은");
    const r = await check(q, "room_interview", true);
    assertEquals((await one(q, "select kind, started from public.ai_usage where id = $1", [r.id])), { kind: "room_interview", started: true });
    for (let i = 0; i < 29; i++) await check(q, "room_interview");
    const h = await failHint(check(q, "room_interview"), "RATE_LIMITED");
    assertEquals([h.window, h.retryAfterSec], ["tenMin", 600]);

    await setNow(q, "2026-10-23T22:00:00+09:00");
    await as(q, "철수");
    await fill(q, await uidOf(q, "철수"), 120, "2026-10-23T09:00:00+09:00");
    const d = await failHint(check(q, "room_interview"), "RATE_LIMITED");
    assertEquals([d.window, d.retryAfterSec], ["day", 11 * 3600]);
    // 하루 창도 두 kind 합산 — rounds 도 같이 막힌다
    assertEquals((await failHint(check(q), "RATE_LIMITED")).window, "day");
  } },
  { name: "starts: 11th started=true → RATE_LIMITED starts · continuing turn ok", run: async (q) => {
    await setNow(q, "2026-10-23T12:00:00+09:00");
    await as(q, "지은");
    await fill(q, await uidOf(q, "지은"), 10, "2026-10-23T08:00:00+09:00", "room_interview", true);
    const h = await failHint(check(q, "room_interview", true), "RATE_LIMITED");
    assertEquals(h.window, "starts");
    assert((h.retryAfterSec as number) > 600);
    await check(q, "room_interview", false);
  } },
]);
