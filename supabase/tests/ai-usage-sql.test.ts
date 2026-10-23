// supabase/tests/ai-usage-sql.test.ts — 0047 AI 인터뷰 사용량·상한 (스펙 2026-10-23-room-create-ai-interview-design D17)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, newUser, openDb } from "./_harness.ts";
import { cases, one, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
const check = async (q: Q, started = false, kind: unknown = "room_interview") =>
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
const fill = (q: Q, uid: string, n: number, at: string, started = false) =>
  q(`insert into public.ai_usage (user_id, kind, started, created_at)
     select $1::uuid, 'room_interview', $2, $3::timestamptz from generate_series(1, $4::int)`, [uid, started, at, n]);

cases("ai_usage 0047 · schema & permissions", db, [
  { name: "table closed to clients · RLS on · two RPCs authenticated only · ai_limits not granted", run: async (q) => {
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert", "update", "delete"]) {
      assertEquals((await one(q, "select has_table_privilege($1, 'public.ai_usage', $2) as v", [role, priv])).v, false, `${role} ${priv}`);
    }
    assertEquals((await one(q, "select relrowsecurity as v from pg_class where oid = 'public.ai_usage'::regclass")).v, true);
    const can = async (role: string, f: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, `public.${f}`])).v;
    for (const f of ["ai_turn_check(text,boolean)", "ai_turn_done(bigint,integer,integer,integer,text)"]) {
      assertEquals(await can("authenticated", f), true, f);
      assertEquals(await can("anon", f), false, f);
    }
    assertEquals(await can("authenticated", "ai_limits()"), false);
    assertEquals(await can("anon", "ai_limits()"), false);
  } },
  { name: "authenticated role cannot read or insert the table directly", run: async (q) => {
    await as(q, "지은");
    await q("set local role authenticated");
    try {
      await expectFail(q("select * from public.ai_usage"), "permission denied");
      await expectFail(q("insert into public.ai_usage (user_id, kind) values (auth.uid(), 'room_interview')"), "permission denied");
    } finally { await q("reset role"); }
  } },
  { name: "anon → AUTH_REQUIRED · pre-onboarding → ONBOARDING_REQUIRED (방 만들기와 같은 문턱)", run: async (q) => {
    await asAnon(q);
    await expectFail(check(q), "AUTH_REQUIRED");
    await expectFail(q("select public.ai_turn_done(1, 1, 1, 0, 'm')"), "AUTH_REQUIRED");
    await asUser(q, await newUser(q));
    await expectFail(check(q), "ONBOARDING_REQUIRED");
  } },
  { name: "not in api_invoke allow-list (MCP 비노출)", run: async (q) => {
    const src = (await one(q, "select string_agg(prosrc, ' ') as s from pg_proc where proname like 'api_invoke%'")).s as string | null;
    assert(!src?.includes("ai_turn"), "api_invoke must not route ai_turn_*");
  } },
]);

cases("ai_usage 0047 · ai_turn_check", db, [
  { name: "first call returns {id} · one row · started=true · unknown kind → VALIDATION_FAILED", run: async (q) => {
    await setNow(q, "2026-10-23T10:00:00+09:00");
    await as(q, "지은");
    const r = await check(q, true);
    assertEquals(typeof r.id, "number");
    const row = await one(q, "select user_id::text as u, kind, started, input_tokens from public.ai_usage where id = $1", [r.id]);
    assertEquals(row, { u: await uidOf(q, "지은"), kind: "room_interview", started: true, input_tokens: null });
    assertEquals((await failHint(check(q, false, "exam_draft"), "VALIDATION_FAILED")).field, "kind");
    assertEquals((await failHint(check(q, false, null), "VALIDATION_FAILED")).field, "kind");
  } },
  { name: "10 min: 30 ok, 31st → RATE_LIMITED window tenMin with retryAfterSec · per user", run: async (q) => {
    await setNow(q, "2026-10-23T10:00:00+09:00");
    await as(q, "지은");
    for (let i = 0; i < 30; i++) await check(q);
    const h = await failHint(check(q), "RATE_LIMITED");
    assertEquals([h.window, h.retryAfterSec], ["tenMin", 600]);
    await as(q, "철수");
    await check(q);
    await setNow(q, "2026-10-23T10:10:01+09:00");
    await as(q, "지은");
    await check(q);
  } },
  { name: "day: 120 turns in 24h → RATE_LIMITED window day", run: async (q) => {
    await setNow(q, "2026-10-23T22:00:00+09:00");
    await as(q, "지은");
    await fill(q, await uidOf(q, "지은"), 120, "2026-10-23T09:00:00+09:00");
    const h = await failHint(check(q), "RATE_LIMITED");
    assertEquals(h.window, "day");
    assertEquals(h.retryAfterSec, 11 * 3600);
    await setNow(q, "2026-10-24T09:00:01+09:00");
    await check(q);
  } },
  { name: "starts: 11th started=true → RATE_LIMITED window starts · continuing turns still ok", run: async (q) => {
    await setNow(q, "2026-10-23T12:00:00+09:00");
    await as(q, "지은");
    await fill(q, await uidOf(q, "지은"), 10, "2026-10-23T08:00:00+09:00", true);
    const h = await failHint(check(q, true), "RATE_LIMITED");
    assertEquals(h.window, "starts");
    assert((h.retryAfterSec as number) > 600);
    await check(q, false);
  } },
  { name: "global day budget 3000 across users → AI_BUDGET_EXCEEDED (모델 호출 전 차단)", run: async (q) => {
    await setNow(q, "2026-10-23T12:00:00+09:00");
    // 여러 사용자(각자 상한 밑) 합으로 3000 — 여기서는 한 계정 과거 행을 25시간 전/1시간 전으로 나눠 채운다
    const other = await uidOf(q, "철수");
    await fill(q, other, 2999, "2026-10-23T11:00:00+09:00");
    await fill(q, other, 50, "2026-10-22T10:00:00+09:00");   // 24시간 밖은 세지 않는다
    await as(q, "지은");
    await check(q);   // 3000번째
    await expectFail(check(q), "AI_BUDGET_EXCEEDED");
    assertEquals((await one(q, "select count(*)::int as n from public.ai_usage where user_id = $1", [await uidOf(q, "지은")])).n, 1);
  } },
]);

cases("ai_usage 0047 · ai_turn_done", db, [
  { name: "records tokens on my row only · other's id is a silent no-op", run: async (q) => {
    await setNow(q, "2026-10-23T10:00:00+09:00");
    await as(q, "지은");
    const mine = (await check(q, true)).id;
    await as(q, "철수");
    const theirs = (await check(q, true)).id;
    await as(q, "지은");
    await q("select public.ai_turn_done($1, 1200, 300, 2500, 'claude-haiku-5-5')", [mine]);
    await q("select public.ai_turn_done($1, 9, 9, 9, 'x')", [theirs]);
    const row = async (id: unknown) => one(q, "select input_tokens as i, output_tokens as o, cached_tokens as c, model from public.ai_usage where id = $1", [id]);
    assertEquals(await row(mine), { i: 1200, o: 300, c: 2500, model: "claude-haiku-5-5" });
    assertEquals(await row(theirs), { i: null, o: null, c: null, model: null });
  } },
]);
