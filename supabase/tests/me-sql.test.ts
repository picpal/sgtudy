import { assertEquals } from "@std/assert";
import { asAnon, asUser, expectFail, newUser, openDb, setToday, sqlTest, withCase, type Q } from "./_harness.ts";

const db = await openDb();
const j = async (q: Q, sql: string, params: unknown[] = []) => (await q(sql, params))[0].j as Record<string, unknown>;

sqlTest("meta_get: today from kst_today, serverTime ISO", withCase(db, async (q) => {
  await setToday(q, "2026-10-12");
  const m = await j(q, "select public.meta_get() as j");
  assertEquals(m.today, "2026-10-12");
  assertEquals(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(m.serverTime as string), true);
}));

sqlTest("me_get: AUTH_REQUIRED for anon; before onboarding returns nickname null, initial from email", withCase(db, async (q) => {
  await setToday(q, "2026-10-12");
  await asAnon(q);
  await expectFail(q("select public.me_get()"), "AUTH_REQUIRED");
  const uid = await newUser(q, "chulsoo@example.com");
  await q("update public.profiles set avatar_tone = 'blue' where id = $1::uuid", [uid]);
  await asUser(q, uid);
  const me = await j(q, "select public.me_get() as j");
  assertEquals(me, { id: uid, email: "chulsoo@example.com", nickname: null, initial: "c", tone: "blue",
                     onboarded: false, optionalMailEnabled: true, unreadCount: 0, today: "2026-10-12" });
}));

sqlTest("me_update: sets nickname (onboarding) and mail flag; returns Me (Review Focus 3)", withCase(db, async (q) => {
  const uid = await newUser(q);
  await asUser(q, uid);
  const me = await j(q, "select public.me_update(p_nickname => '철수') as j");
  assertEquals(me.nickname, "철수");
  assertEquals(me.initial, "철");
  assertEquals(me.onboarded, true);
  const me2 = await j(q, "select public.me_update(p_optional_mail_enabled => false) as j");
  assertEquals(me2.nickname, "철수");            // 생략한 인자는 그대로
  assertEquals(me2.optionalMailEnabled, false);
  const row = await q("select nickname_normalized as n from public.profiles where id = $1::uuid", [uid]);
  assertEquals(row[0].n, "철수");
}));

sqlTest("me_update: nickname rules — length, charset, spaces", withCase(db, async (q) => {
  const uid = await newUser(q);
  await asUser(q, uid);
  for (const bad of ["철", "a", "12345678901234567", "철수!", "chul soo  kim", " 철수", "철수 ", "철\t수", "철수　김", "ㅊㅅ"]) {
    await expectFail(q("select public.me_update(p_nickname => $1)", [bad]), "NICKNAME_INVALID");
  }
  for (const ok of ["철수", "chul_soo.kim", "철수 김", "Ab", "a1"]) {
    const me = await j(q, "select public.me_update(p_nickname => $1) as j", [ok]);
    assertEquals(me.nickname, ok);
  }
}));

sqlTest("me_update: reserved words", withCase(db, async (q) => {
  const uid = await newUser(q);
  await asUser(q, uid);
  for (const bad of ["관리자", "admin", "Admin01", "sgtudy", "슥터디 운영"]) {
    await expectFail(q("select public.me_update(p_nickname => $1)", [bad]), "NICKNAME_RESERVED");
  }
}));

sqlTest("me_update: NICKNAME_TAKEN is case- and NFC-insensitive (Review Focus 1)", withCase(db, async (q) => {
  const a = await newUser(q);
  const b = await newUser(q);
  await asUser(q, a);
  await j(q, "select public.me_update(p_nickname => 'Chulsoo') as j");
  await j(q, "select public.me_update(p_nickname => 'Chulsoo') as j");   // 내 닉네임 재설정은 허용
  await asUser(q, b);
  await expectFail(q("select public.me_update(p_nickname => 'chulsoo')"), "NICKNAME_TAKEN");
  await asUser(q, a);
  await j(q, "select public.me_update(p_nickname => '철수') as j");         // NFC
  await asUser(q, b);
  const nfd = "철수".normalize("NFD");
  assertEquals(nfd === "철수", false);
  await expectFail(q("select public.me_update(p_nickname => $1)", [nfd]), "NICKNAME_TAKEN");
}));

sqlTest("nickname_check: available / taken / invalid / reserved; own nickname counts as available", withCase(db, async (q) => {
  const a = await newUser(q);
  const b = await newUser(q);
  await asAnon(q);
  await expectFail(q("select public.nickname_check('x')"), "AUTH_REQUIRED");
  await asUser(q, a);
  await j(q, "select public.me_update(p_nickname => '민수') as j");
  assertEquals(await j(q, "select public.nickname_check('민수') as j"), { available: true });
  await asUser(q, b);
  assertEquals(await j(q, "select public.nickname_check('민수') as j"), { available: false, reason: "taken" });
  assertEquals(await j(q, "select public.nickname_check('지은') as j"), { available: true });
  assertEquals(await j(q, "select public.nickname_check('지') as j"), { available: false, reason: "invalid" });
  assertEquals(await j(q, "select public.nickname_check('admin') as j"), { available: false, reason: "reserved" });
}));

sqlTest("privileges: meta_get public, me_* authenticated only, nickname helpers private (D7)", withCase(db, async (q) => {
  const can = async (role: string, fn: string) =>
    (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
  assertEquals(await can("anon", "public.meta_get()"), true);
  for (const fn of ["public.me_get()", "public.me_update(text,boolean)", "public.nickname_check(text)"]) {
    assertEquals(await can("anon", fn), false, fn);
    assertEquals(await can("authenticated", fn), true, fn);
  }
  for (const fn of ["public.nickname_normalize(text)", "public.nickname_problem(text)"]) {
    assertEquals(await can("authenticated", fn), false, fn);
  }
}));

sqlTest("me_get: unreadCount counts unread notifications only", withCase(db, async (q) => {
  const uid = await newUser(q);
  await q(`insert into public.notifications (user_id, kind, title, link, read_at)
           values ($1::uuid, 'ROOM_STARTED', 't', '/rooms/a', null), ($1::uuid, 'ROOM_ENDED', 't', '/rooms/a', now())`, [uid]);
  await asUser(q, uid);
  assertEquals((await j(q, "select public.me_get() as j")).unreadCount, 1);
}));
