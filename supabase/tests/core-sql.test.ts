import { assertEquals } from "@std/assert";
import { asAnon, asUser, expectFail, newUser, openDb, setToday, sqlTest, withCase } from "./_harness.ts";

const db = await openDb();

sqlTest("kst_today: honors app.today, else Seoul date", withCase(db, async (q) => {
  await setToday(q, "2026-10-12");
  assertEquals((await q("select public.kst_today()::text as d"))[0].d, "2026-10-12");
  await q("select set_config('app.today', '', true)");
  await q("delete from internal.settings where key = 'today'");
  const r = await q("select (public.kst_today() = (now() at time zone 'Asia/Seoul')::date) as same");
  assertEquals(r[0].same, true);
}));

// Supabase 의 postgres 역할은 superuser 가 아니라 `alter database … set app.today` 가 42501 로 거부된다(db 게이트에서 확인).
// 영속 기준일은 internal.settings('today') 에 두고, 세션 설정(app.today)이 있으면 그것이 우선한다.
sqlTest("kst_today: falls back to internal.settings 'today' when app.today is unset; app.today still wins", withCase(db, async (q) => {
  await q("select set_config('app.today', '', true)");
  await q("insert into internal.settings (key, value) values ('today', '2026-10-12') on conflict (key) do update set value = excluded.value");
  assertEquals((await q("select public.kst_today()::text as d"))[0].d, "2026-10-12");
  await setToday(q, "2026-10-20");
  assertEquals((await q("select public.kst_today()::text as d"))[0].d, "2026-10-20");
}));

sqlTest("kst_today: internal.settings is not reachable by anon/authenticated, kst_today stays ungranted", withCase(db, async (q) => {
  for (const role of ["anon", "authenticated"]) {
    assertEquals((await q("select has_schema_privilege($1, 'internal', 'usage') as ok", [role]))[0].ok, false, `${role} usage`);
    assertEquals((await q("select has_function_privilege($1, 'public.kst_today()', 'execute') as ok", [role]))[0].ok, false, `${role} kst_today`);
  }
}));

sqlTest("kst_deadline: next day 00:00 KST = 15:00Z of end_date (Review Focus 4)", withCase(db, async (q) => {
  const r = await q("select public.iso(public.kst_deadline('2026-10-03')) as d");
  assertEquals(r[0].d, "2026-10-03T15:00:00.000Z");
  const late = await q("select ('2026-10-03 15:00:30+00'::timestamptz >= public.kst_deadline('2026-10-03')) as l");
  assertEquals(late[0].l, true);
  const onTime = await q("select ('2026-10-03 14:59:59+00'::timestamptz >= public.kst_deadline('2026-10-03')) as l");
  assertEquals(onTime[0].l, false);
}));

sqlTest("task_code: full matrix", withCase(db, async (q) => {
  const code = async (first: string | null, late: boolean, today: string) =>
    (await q("select public.task_code('2026-10-01', '2026-10-03', $1::timestamptz, $2, $3::date) as c", [first, late, today]))[0].c;
  assertEquals(await code(null, false, "2026-09-30"), "planned");
  assertEquals(await code(null, false, "2026-10-01"), "open");
  assertEquals(await code(null, false, "2026-10-03"), "open");
  assertEquals(await code(null, false, "2026-10-04"), "missed");
  assertEquals(await code("2026-10-02 09:00+09", false, "2026-10-12"), "done");
  assertEquals(await code("2026-10-04 00:00:30+09", true, "2026-10-12"), "late");   // 자정 30초 뒤 제출
  assertEquals(await code("2026-10-02 09:00+09", false, "2026-09-01"), "done");    // 제출이 있으면 날짜 무관
}));

sqlTest("leaf_state: unassigned/complete/planned/delayed/progress", withCase(db, async (q) => {
  const st = async (asg: number, sub: number, today: string) =>
    (await q("select public.leaf_state($1, $2, '2026-10-01', '2026-10-03', $3::date) as s", [asg, sub, today]))[0].s;
  assertEquals(await st(0, 0, "2026-10-02"), "unassigned");
  assertEquals(await st(4, 4, "2026-10-02"), "complete");
  assertEquals(await st(4, 1, "2026-09-30"), "planned");
  assertEquals(await st(4, 1, "2026-10-04"), "delayed");
  assertEquals(await st(4, 1, "2026-10-02"), "progress");
}));

sqlTest("pct: null when nothing assigned, half-up rounding (5/8 → 63)", withCase(db, async (q) => {
  assertEquals((await q("select public.pct(0, 0) as p"))[0].p, null);
  assertEquals((await q("select public.pct(8, 5) as p"))[0].p, 63);
  assertEquals((await q("select public.pct(25, 6) as p"))[0].p, 24);
  assertEquals((await q("select public.pct(78, 68) as p"))[0].p, 87);
  assertEquals((await q("select public.pct(35, 12) as p"))[0].p, 34);
  assertEquals((await q("select public.pct(3, 3) as p"))[0].p, 100);
}));

sqlTest("iso: UTC with milliseconds and Z", withCase(db, async (q) => {
  assertEquals((await q("select public.iso('2026-10-12 09:30:15.25+09'::timestamptz) as t"))[0].t, "2026-10-12T00:30:15.250Z");
}));

sqlTest("slugify: ascii words, hangul romanized (0013), no letters falls back to r-<base36 id>", withCase(db, async (q) => {
  assertEquals((await q("select public.slugify('AWS SAA 자격증 3개월 완주', 7) as s"))[0].s, "aws-saa-jagyeokjeung-3gaewol-wanju");
  assertEquals((await q("select public.slugify('토익 900 8주 챌린지', 2) as s"))[0].s, "toik-900-8ju-chaelrinji");
  assertEquals((await q("select public.slugify('🚀 !!', 36) as s"))[0].s, "r-10");
  assertEquals((await q("select public.slugify('  Docker---Compose!! ', 1) as s"))[0].s, "docker-compose");
  const long = (await q("select public.slugify(repeat('abcde ', 20), 1) as s"))[0].s as string;
  assertEquals(long.length <= 50, true);
}));

sqlTest("fail: raises P0001 with code as message, detail and json hint", withCase(db, async (q) => {
  try {
    await q("select public.fail('ROOM_FULL', '정원이 찼어요', '{\"field\":\"maxMembers\"}'::jsonb)");
    throw new Error("should have raised");
  } catch (e) {
    const err = e as Error & { detail?: string; hint?: string; code?: string };
    assertEquals(err.message.includes("ROOM_FULL"), true);
    assertEquals(err.detail, "정원이 찼어요");
    assertEquals(err.hint, '{"field": "maxMembers"}');
    assertEquals(err.code, "P0001");
  }
  await expectFail(q("select public.fail('AUTH_REQUIRED', '로그인이 필요해요')"), "AUTH_REQUIRED");
}));

sqlTest("current_user_id / require_user: anon, onboarding, onboarded (Review Focus 3)", withCase(db, async (q) => {
  await asAnon(q);
  assertEquals((await q("select public.current_user_id() as u"))[0].u, null);
  await expectFail(q("select public.require_user()"), "AUTH_REQUIRED");
  const uid = await newUser(q);
  await asUser(q, uid);
  assertEquals((await q("select public.current_user_id()::text as u"))[0].u, uid);
  await expectFail(q("select public.require_user()"), "ONBOARDING_REQUIRED");
  await q("update public.profiles set nickname = '철수', nickname_normalized = '철수' where id = $1::uuid", [uid]);
  assertEquals((await q("select public.require_user()::text as u"))[0].u, uid);
}));

sqlTest("privileges: 0002 helpers are not executable by anon/authenticated (D7 default-privileges REVOKE)", withCase(db, async (q) => {
  for (const fn of ["public.require_user()", "public.fail(text,text,jsonb)", "public.person_json(uuid)", "public.kst_today()",
                    "public.task_code(date,date,timestamptz,boolean,date)", "public.slugify(text,bigint)"]) {
    for (const role of ["anon", "authenticated"]) {
      const r = await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]);
      assertEquals(r[0].ok, false, `${role} → ${fn}`);
    }
  }
}));

// D13(2026-10-13) 은 0033(AI 연동 스펙 §4)이 대체: auth.uid() 가 먼저, 보조 신원은 sgtudy.api_uid 하나뿐(api_authenticate 만 설정)
sqlTest("current_user_id: auth.uid() first, only fallback = sgtudy.api_uid (0033, supersedes D13)", withCase(db, async (q) => {
  const src = (await q("select prosrc from pg_proc where oid = 'public.current_user_id()'::regprocedure"))[0].prosrc as string;
  const settings = [...src.matchAll(/current_setting\('([^']+)'/g)].map((m) => m[1]);
  assertEquals(settings, ["sgtudy.api_uid"]);
  assertEquals(/coalesce\(\s*auth\.uid\(\)\s*,/.test(src), true);
}));

sqlTest("person_json: userId/nickname/tone, empty nickname before onboarding", withCase(db, async (q) => {
  const uid = await newUser(q);
  await q("update public.profiles set avatar_tone = 'blue' where id = $1::uuid", [uid]);
  assertEquals((await q("select public.person_json($1::uuid) as p", [uid]))[0].p, { userId: uid, nickname: "", tone: "blue" });
  await q("update public.profiles set nickname = '철수' where id = $1::uuid", [uid]);
  assertEquals((await q("select public.person_json($1::uuid) as p", [uid]))[0].p, { userId: uid, nickname: "철수", tone: "blue" });
}));

sqlTest("auth.users email update syncs profiles.email (Review Focus 5)", withCase(db, async (q) => {
  const uid = await newUser(q, "old@example.com");
  await q("update auth.users set email = 'new@example.com' where id = $1::uuid", [uid]);
  assertEquals((await q("select email::text as e from public.profiles where id = $1::uuid", [uid]))[0].e, "new@example.com");
}));

sqlTest("updated_at trigger bumps on rooms update", withCase(db, async (q) => {
  const uid = await newUser(q);
  await q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id, updated_at)
           values ('r1', 't', 'i', '2026-10-01', '2026-10-10', 6, 'PUBLIC', 'DIRECT', $1::uuid, '2020-01-01')`, [uid]);
  await q("update public.rooms set title = 't2' where slug = 'r1'");
  const r = await q("select (updated_at > '2025-01-01'::timestamptz) as bumped from public.rooms where slug = 'r1'");
  assertEquals(r[0].bumped, true);
}));

sqlTest("submissions: first_submitted_at and is_late are immutable (I9 → FIELD_LOCKED)", withCase(db, async (q) => {
  const uid = await newUser(q);
  await q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id)
           values ('r1', 't', 'i', '2026-10-01', '2026-10-10', 6, 'PUBLIC', 'DIRECT', $1::uuid)`, [uid]);
  await q(`insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date, task_type)
           values ((select id from public.rooms where slug = 'r1'), null, 2, 0, '1주차', 'w1', '2026-10-01', '2026-10-07', 'COMMON')`);
  await q(`insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late)
           values ((select id from public.goal_nodes where title = 'w1'), $1::uuid, 'hi', '2026-10-02 09:00+09', false)`, [uid]);
  await q("update public.submissions set body_md = 'edited' where user_id = $1::uuid", [uid]);   // 본문 수정은 허용
  await expectFail(q("update public.submissions set is_late = true where user_id = $1::uuid", [uid]), "FIELD_LOCKED");
  await expectFail(q("update public.submissions set first_submitted_at = now() where user_id = $1::uuid", [uid]), "FIELD_LOCKED");
}));
