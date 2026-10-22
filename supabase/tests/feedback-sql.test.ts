// supabase/tests/feedback-sql.test.ts — 0044 의견 보내기 (스펙 2026-10-22-feedback-design)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, newUser, openDb } from "./_harness.ts";
import { cases, one, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
const submit = async (q: Q, kind: unknown, message: unknown, ctx: unknown = {}) =>
  (await one(q, "select public.feedback_submit($1, $2, $3::jsonb) as r", [kind, message, JSON.stringify(ctx)])).r as Row;
const CTX = { path: "/my-study/aws?tab=tasks", room: "aws", userAgent: "Mozilla/5.0", viewport: "390x844", appVersion: "abc1234" };
/** fail() 의 hint(JSON) — details */
async function failHint(p: Promise<unknown>, code: string): Promise<Row> {
  try { await p; } catch (e) {
    const er = e as Error & { hint?: string };
    assertEquals(er.message, code);
    return JSON.parse(er.hint ?? "{}");
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

cases("feedback 0044 · schema & permissions", db, [
  { name: "table closed to clients · RLS on · feedback_submit authenticated only · helpers not granted", run: async (q) => {
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert", "update", "delete"]) {
      assertEquals((await one(q, "select has_table_privilege($1, 'public.feedback', $2) as v", [role, priv])).v, false, `${role} ${priv}`);
    }
    assertEquals((await one(q, "select relrowsecurity as v from pg_class where oid = 'public.feedback'::regclass")).v, true);
    const can = async (role: string, f: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, `public.${f}`])).v;
    assertEquals(await can("authenticated", "feedback_submit(text,text,jsonb)"), true);
    assertEquals(await can("anon", "feedback_submit(text,text,jsonb)"), false);
    for (const f of ["feedback_limits()", "feedback_rate_check(uuid)", "feedback_validate_context(jsonb)"]) {
      assertEquals(await can("authenticated", f), false, f);
      assertEquals(await can("anon", f), false, f);
    }
  } },
  { name: "authenticated role cannot read or insert the table directly", run: async (q) => {
    await as(q, "지은");
    await q("set local role authenticated");
    try {
      await expectFail(q("select * from public.feedback"), "permission denied");
      await expectFail(q("insert into public.feedback (user_id, kind, message) values (auth.uid(), 'BUG', '직접 넣기')"), "permission denied");
    } finally { await q("reset role"); }
  } },
  { name: "anon → AUTH_REQUIRED · pre-onboarding account can submit (D1)", run: async (q) => {
    await asAnon(q);
    await expectFail(submit(q, "BUG", "버튼이 안 눌려요"), "AUTH_REQUIRED");
    const uid = await newUser(q);
    await asUser(q, uid);
    const r = await submit(q, "QUESTION", "닉네임 화면에서 막혔어요");
    assertEquals(typeof r.id, "string");
    assert(/Z$/.test(r.createdAt as string));
    assertEquals((await one(q, "select user_id::text as v from public.feedback where id = $1::bigint", [r.id])).v, uid);
  } },
]);

cases("feedback 0044 · submit & validation", db, [
  { name: "stores kind · trimmed message · context · server user id · status NEW", run: async (q) => {
    await as(q, "지은");
    const r = await submit(q, "BUG", "  \n 제출 버튼이 회색이에요 　", CTX);
    const row = await one(q, "select user_id::text as u, kind, message, context, status from public.feedback where id = $1::bigint", [r.id]);
    assertEquals(row, { u: await uidOf(q, "지은"), kind: "BUG", message: "제출 버튼이 회색이에요", context: CTX, status: "NEW" });
  } },
  { name: "kind must be one of BUG/IDEA/QUESTION/OTHER", run: async (q) => {
    await as(q, "지은");
    for (const k of ["IDEA", "QUESTION", "OTHER"]) await submit(q, k, "다섯 글자 이상");
    for (const k of ["bug", "PRAISE", null]) assertEquals((await failHint(submit(q, k, "다섯 글자 이상"), "VALIDATION_FAILED")).field, "kind");
  } },
  { name: "message 5~2000 after trim", run: async (q) => {
    await as(q, "지은");
    for (const m of ["    ", "넷글자요", "  1234  ", "가".repeat(2001), null]) {
      assertEquals((await failHint(submit(q, "BUG", m), "VALIDATION_FAILED")).field, "message", String(m));
    }
    await submit(q, "BUG", "다섯글자요");
    await submit(q, "BUG", "가".repeat(2000));
  } },
  { name: "context: object · whitelisted keys · string values ≤500 (no userId/email from client)", run: async (q) => {
    await as(q, "지은");
    assertEquals((await failHint(submit(q, "BUG", "내용 다섯자", []), "VALIDATION_FAILED")).field, "context");
    assertEquals((await failHint(submit(q, "BUG", "내용 다섯자", { userId: "x" }), "VALIDATION_FAILED")).field, "userId");
    assertEquals((await failHint(submit(q, "BUG", "내용 다섯자", { path: 3 }), "VALIDATION_FAILED")).field, "path");
    assertEquals((await failHint(submit(q, "BUG", "내용 다섯자", { userAgent: "a".repeat(501) }), "VALIDATION_FAILED")).field, "userAgent");
    await submit(q, "BUG", "내용 다섯자", { userAgent: "a".repeat(500) });
    // p_context 생략 → 빈 객체
    const r = (await one(q, "select public.feedback_submit('IDEA', '컨텍스트 없음') as r")).r as Row;
    assertEquals((await one(q, "select context from public.feedback where id = $1::bigint", [r.id])).context, {});
  } },
  { name: "rate limit (D7): 6th in 10 min → RATE_LIMITED(retryAfterSec) · per user · 21st in a day", run: async (q) => {
    await setNow(q, "2026-10-22T10:00:00+09:00");
    await as(q, "지은");
    for (let i = 1; i <= 5; i++) await submit(q, "BUG", `버그 신고 ${i}번`);
    const h = await failHint(submit(q, "BUG", "버그 신고 6번"), "RATE_LIMITED");
    assertEquals([h.window, h.retryAfterSec], ["10min", 600]);
    await as(q, "철수");
    await submit(q, "BUG", "다른 사람은 됨");
    await setNow(q, "2026-10-22T10:10:30+09:00");
    await as(q, "지은");
    await submit(q, "BUG", "10분 지남");
    // 하루 상한: 앞선 6건 + 오전에 14건을 더 채워 20건
    await q(`insert into public.feedback (user_id, kind, message, created_at)
             select $1::uuid, 'BUG', '오전 신고', timestamptz '2026-10-22T08:00:00+09:00' from generate_series(1, 14)`, [await uidOf(q, "지은")]);
    const d = await failHint(submit(q, "BUG", "하루 상한"), "RATE_LIMITED");
    assertEquals(d.window, "day");
    assert((d.retryAfterSec as number) > 600);
  } },
]);
