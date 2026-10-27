// supabase/tests/ai-explain-sql.test.ts — 0052 AI 용어 해설 (스펙 2026-10-27-ask-ai-term-explain-design D13~D16)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, one, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
const rpc = async (q: Q, expr: string, p: unknown[] = []) => (await one(q, `select ${expr} as r`, p)).r as Row;
const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const KEY = await sha("cidr 블록");
const KEY2 = await sha("vpc");
const begin = (q: Q, slug = "aws", key = KEY) => rpc(q, "public.ai_explain_begin($1, $2)", [slug, key]);
const BODY = { kind: "term", term: "CIDR 블록", oneLiner: "IP 주소 범위를 적는 방식이에요", inContext: "- VPC 설계", points: [], related: [] };
const done = (q: Q, id: unknown, body: unknown = BODY, slug = "aws", key = KEY, norm = key === KEY2 ? "vpc" : "cidr 블록") =>
  q("select public.ai_explain_done($1::bigint, $2, $3, $4, $5::jsonb, 500, 450, 700, 'gpt-6-luna')",
    [id, slug, key, norm, JSON.stringify(body)]);
const usageCount = async (q: Q, nick: string, kind = "term_explain") =>
  (await one(q, "select count(*)::int as n from public.ai_usage where user_id = $1 and kind = $2", [await uidOf(q, nick), kind])).n as number;
async function failHint(p: Promise<unknown>, code: string): Promise<Row> {
  try { await p; } catch (e) {
    const er = e as Error & { hint?: string };
    assertEquals(er.message, code);
    return JSON.parse(er.hint ?? "{}");
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}
const fill = (q: Q, uid: string, n: number, at: string, kind = "term_explain") =>
  q(`insert into public.ai_usage (user_id, kind, started, created_at)
     select $1::uuid, $2, false, $3::timestamptz from generate_series(1, $4::int)`, [uid, kind, at, n]);

cases("ai_explain 0052 · schema & grants", db, [
  { name: "cache closed to clients · RLS on · two RPCs authenticated only · kind term_explain allowed · limits keys", run: async (q) => {
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert", "update", "delete"]) {
      assertEquals((await one(q, "select has_table_privilege($1, 'public.ai_explain_cache', $2) as v", [role, priv])).v, false, `${role} ${priv}`);
    }
    assertEquals((await one(q, "select relrowsecurity as v from pg_class where oid = 'public.ai_explain_cache'::regclass")).v, true);
    const can = async (role: string, f: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, `public.${f}`])).v;
    for (const f of ["ai_explain_begin(text,text)", "ai_explain_done(bigint,text,text,text,jsonb,integer,integer,integer,text)"]) {
      assertEquals(await can("authenticated", f), true, f);
      assertEquals(await can("anon", f), false, f);
    }
    assertEquals(await can("authenticated", "ai_limits()"), false);
    await fill(q, await uidOf(q, "지은"), 1, "2026-10-12T09:00:00+09:00");
    await expectFail(fill(q, await uidOf(q, "지은"), 1, "2026-10-12T09:00:00+09:00", "exam_draft"), "ai_usage_kind_check");
    const lim = (await one(q, "select public.ai_limits() as v")).v as Row;
    assertEquals([lim.explainPerTenMin, lim.explainPerDay, lim.explainGlobalPerDay, lim.perTenMin, lim.roundsPerDay], [10, 60, 2000, 30, 10]);
  } },
]);

cases("ai_explain 0052 · begin: 권한", db, [
  { name: "anon AUTH_REQUIRED · private non-member ROOM_NOT_FOUND · public non-member / PENDING NOT_MEMBER · bad key VALIDATION_FAILED", run: async (q) => {
    await asAnon(q);
    await expectFail(begin(q), "AUTH_REQUIRED");
    await as(q, "민수");
    await failHint(begin(q, "spring"), "ROOM_NOT_FOUND");
    await failHint(begin(q, "nope-room"), "ROOM_NOT_FOUND");
    await as(q, "가은");                               // 공개 aws 구경(비멤버)
    await failHint(begin(q, "aws"), "NOT_MEMBER");
    await as(q, "철수");                               // sqld PENDING
    await failHint(begin(q, "sqld"), "NOT_MEMBER");
    await as(q, "지은");
    await failHint(begin(q, "aws", "XYZ"), "VALIDATION_FAILED");
    await failHint(begin(q, "aws", "A".repeat(64)), "VALIDATION_FAILED");
    assertEquals(await usageCount(q, "지은"), 0);       // 거부는 행을 남기지 않는다
  } },
  { name: "INACTIVE member · leader pass → miss with room meta (title, tags, current round)", run: async (q) => {
    await as(q, "도윤");
    const r = await begin(q);
    assertEquals(r.hit, false);
    assertEquals(typeof r.id, "number");
    assertEquals(r.room.title, "AWS SAA 자격증 3개월 완주");
    assert(Array.isArray(r.room.tags) && r.room.tags.includes("AWS"), JSON.stringify(r.room.tags));
    assertEquals([r.room.round.label, r.room.round.title], ["2주차", "EC2·S3"]);   // 시드 오늘 10/12
    assert(r.room.description.length <= 600);
    assertEquals(typeof r.room.round.goal, "string");
    const row = await one(q, "select kind, started from public.ai_usage where id = $1", [r.id]);
    assertEquals(row, { kind: "term_explain", started: false });
    await as(q, "민수");
    assertEquals((await begin(q)).hit, false);
  } },
]);

cases("ai_explain 0052 · cache", db, [
  { name: "miss → done → hit (no usage, hits+1) · 31 days later miss again · not_term not cached", run: async (q) => {
    await setNow(q, "2026-10-12T10:00:00+09:00");
    await as(q, "지은");
    const m = await begin(q);
    await done(q, m.id);
    const u = await one(q, "select input_tokens, output_tokens, cached_tokens, model from public.ai_usage where id = $1", [m.id]);
    assertEquals(u, { input_tokens: 500, output_tokens: 450, cached_tokens: 700, model: "gpt-6-luna" });
    await as(q, "철수");                                   // 같은 방 다른 멤버 — 공유
    const h = await begin(q);
    assertEquals([h.hit, h.body.term, "id" in h], [true, "CIDR 블록", false]);
    assertEquals(await usageCount(q, "철수"), 0);
    assertEquals(await usageCount(q, "지은"), 1);
    assertEquals((await one(q, "select hits from public.ai_explain_cache where term_key = $1", [KEY])).hits, 1);
    assertEquals((await begin(q)).hit, true);
    assertEquals((await one(q, "select hits from public.ai_explain_cache where term_key = $1", [KEY])).hits, 2);
    // 다른 방엔 공유되지 않는다
    await as(q, "철수");
    assertEquals((await begin(q, "docker")).hit, false);
    // TTL 30일
    await setNow(q, "2026-11-12T10:00:01+09:00");
    await as(q, "지은");
    const late = await begin(q);
    assertEquals(late.hit, false);
    assertEquals(await usageCount(q, "지은"), 2);
    await done(q, late.id, { ...BODY, oneLiner: "새 해설" });
    assertEquals((await begin(q)).body.oneLiner, "새 해설");
    // not_term 은 저장 안 함
    const n = await begin(q, "aws", KEY2);
    await done(q, n.id, { ...BODY, kind: "not_term" }, "aws", KEY2);
    assertEquals((await begin(q, "aws", KEY2)).hit, false);
  } },
  { name: "done: someone else's id → silent no-op (no cache, tokens null) · same id twice ignored", run: async (q) => {
    await as(q, "지은");
    const m = await begin(q);
    await as(q, "철수");
    await done(q, m.id);
    assertEquals((await one(q, "select count(*)::int as n from public.ai_explain_cache")).n, 0);
    assertEquals((await one(q, "select input_tokens from public.ai_usage where id = $1", [m.id])).input_tokens, null);
    await as(q, "지은");
    await done(q, m.id);
    await done(q, m.id, { ...BODY, oneLiner: "덮어쓰기" });       // 두 번째 done 은 무시
    assertEquals((await one(q, "select body->>'oneLiner' as v from public.ai_explain_cache")).v, BODY.oneLiner);
  } },
  { name: "done: malformed body or key ≠ sha256(norm_term) is not cached", run: async (q) => {
    await as(q, "지은");
    const m = await begin(q);
    await done(q, m.id, { kind: "term", term: "x" });
    const m2 = await begin(q);
    await done(q, m2.id, BODY, "aws", KEY, "다른 용어");
    assertEquals((await one(q, "select count(*)::int as n from public.ai_explain_cache")).n, 0);
    const m3 = await begin(q);
    await done(q, m3.id);
    assertEquals((await one(q, "select count(*)::int as n from public.ai_explain_cache")).n, 1);
  } },
  { name: "done: live row not overwritten via another term's id · link/URL/HTML · over-limit · extra key not cached", run: async (q) => {
    await as(q, "지은");
    const m = await begin(q);
    await done(q, m.id);
    const other = await begin(q, "aws", KEY2);                       // 다른 용어로 받은 id 로 이미 캐시된 KEY 를 바꿔치기
    await done(q, other.id, { ...BODY, oneLiner: "오염된 해설" }, "aws", KEY, "cidr 블록");
    assertEquals((await one(q, "select body->>'oneLiner' as v from public.ai_explain_cache where term_key = $1", [KEY])).v, BODY.oneLiner);
    const bads = [
      { ...BODY, inContext: "- [여기](https://evil.example)" }, { ...BODY, oneLiner: "https://evil.example 참고" }, { ...BODY, inContext: "- <img src=x>" },
      { ...BODY, oneLiner: "가".repeat(121) }, { ...BODY, points: ["a", "b", "c", "d", "e"] }, { ...BODY, related: [1] }, { ...BODY, extra: 1 },
    ];
    for (const bad of bads) {
      const b = await begin(q, "aws", KEY2);
      await done(q, b.id, bad, "aws", KEY2);
    }
    assertEquals((await one(q, "select count(*)::int as n from public.ai_explain_cache where term_key = $1", [KEY2])).n, 0);
  } },
]);

cases("ai_explain 0052 · limits", db, [
  { name: "10 per 10 min → RATE_LIMITED explainTenMin · 60 per day → explain", run: async (q) => {
    await setNow(q, "2026-10-12T10:00:00+09:00");
    await as(q, "지은");
    const uid = await uidOf(q, "지은");
    await fill(q, uid, 9, "2026-10-12T09:55:00+09:00");
    await begin(q);
    const h = await failHint(begin(q), "RATE_LIMITED");
    assertEquals([h.window, h.retryAfterSec], ["explainTenMin", 300]);
    await setNow(q, "2026-10-12T22:00:00+09:00");
    await fill(q, uid, 50, "2026-10-12T08:00:00+09:00");
    const d = await failHint(begin(q), "RATE_LIMITED");
    assertEquals(d.window, "explain");
  } },
  { name: "cache hit does not consume limits even when limited", run: async (q) => {
    await setNow(q, "2026-10-12T10:00:00+09:00");
    await as(q, "지은");
    const m = await begin(q);
    await done(q, m.id);
    await fill(q, await uidOf(q, "지은"), 60, "2026-10-12T09:59:00+09:00");
    assertEquals((await begin(q)).hit, true);
    await failHint(begin(q, "aws", KEY2), "RATE_LIMITED");
  } },
  { name: "global 2000 → AI_BUDGET_EXCEEDED", run: async (q) => {
    await setNow(q, "2026-10-12T12:00:00+09:00");
    await fill(q, await uidOf(q, "철수"), 2000, "2026-10-12T11:00:00+09:00");
    await as(q, "지은");
    await expectFail(begin(q), "AI_BUDGET_EXCEEDED");
  } },
  { name: "windows are separate: 59 explain rows don't touch interview · 119 interview rows don't block explain", run: async (q) => {
    await setNow(q, "2026-10-12T12:00:00+09:00");
    await as(q, "지은");
    await fill(q, await uidOf(q, "지은"), 59, "2026-10-12T11:58:00+09:00");
    for (let i = 0; i < 30; i++) await rpc(q, "public.ai_turn_check('room_interview', false)");   // 인터뷰 10분 창 30턴 그대로
    await failHint(rpc(q, "public.ai_turn_check('room_interview', false)"), "RATE_LIMITED");
    await as(q, "철수");
    await fill(q, await uidOf(q, "철수"), 119, "2026-10-12T08:00:00+09:00", "room_interview");
    assertEquals((await begin(q)).hit, false);
    // 인터뷰 하루 창: explain 행은 세지 않는다 → 120번째 인터뷰 턴 통과
    await rpc(q, "public.ai_turn_check('room_interview', false)");
  } },
]);

const EXAM = { reveal: "after_submit", questions: [{ type: "ox", prompt: "S3 는 리전 서비스다.", answer: false, explanation: "x" }] };
async function inProgressExam(q: Q): Promise<string> {
  await as(q, "민수");
  const leaf = (await one(q, `select n.parent_id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id
                               where r.slug = 'aws' and n.title = 'ALB vs NLB 실습'`)).id as string;
  await q("select public.node_create('aws', $1::bigint, '정리 시험', null, 'common', '2026-10-15', '2026-10-21')", [leaf]);
  const node = (await one(q, `select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id
                               where r.slug = 'aws' and n.title = '정리 시험'`)).id as string;
  await rpc(q, "public.exam_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify(EXAM)]);
  await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
  await setToday(q, "2026-10-16");
  await setNow(q, "2026-10-16T12:00:00+09:00");
  await as(q, "지은");
  const qid = (await one(q, "select id::text as id from public.exam_questions where node_id = $1::bigint", [node])).id as string;
  await rpc(q, "public.exam_answer_save($1::bigint, $2::bigint, 'true'::jsonb)", [node, qid]);
  return node;
}

cases("ai_explain 0052 · exam in progress", db, [
  { name: "IN_PROGRESS → EXAM_IN_PROGRESS (even on cache hit) · others unaffected · submit → ok", run: async (q) => {
    const node = await inProgressExam(q);
    await q(`insert into public.ai_explain_cache (room_id, term_key, norm_term, body, created_at)
             select id, $1, 'cidr 블록', $2::jsonb, now() from public.rooms where slug = 'aws'`, [KEY, JSON.stringify(BODY)]);
    await failHint(begin(q), "EXAM_IN_PROGRESS");
    assertEquals(await usageCount(q, "지은"), 0);
    await as(q, "철수");
    assertEquals((await begin(q)).hit, true);
    await as(q, "지은");
    await rpc(q, "public.exam_submit($1::bigint)", [node]);
    assertEquals((await begin(q)).hit, true);
  } },
  { name: "after deadline (today > end_date) → ok even if still IN_PROGRESS", run: async (q) => {
    await inProgressExam(q);
    await setToday(q, "2026-10-22");
    await setNow(q, "2026-10-22T12:00:00+09:00");
    assertEquals((await begin(q)).hit, false);
  } },
  { name: "idle > 3h since last answer save → ok · saving again → locked again", run: async (q) => {
    const node = await inProgressExam(q);                           // 10/16 12:00 저장
    await setNow(q, "2026-10-16T14:59:00+09:00");
    await failHint(begin(q), "EXAM_IN_PROGRESS");
    await setNow(q, "2026-10-16T15:00:01+09:00");
    assertEquals((await begin(q)).hit, false);
    const qid = (await one(q, "select id::text as id from public.exam_questions where node_id = $1::bigint", [node])).id as string;
    await rpc(q, "public.exam_answer_save($1::bigint, $2::bigint, 'false'::jsonb)", [node, qid]);
    await failHint(begin(q), "EXAM_IN_PROGRESS");
  } },
]);
