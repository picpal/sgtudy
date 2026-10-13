import { assert, assertEquals } from "@std/assert";
import { expectFail, migrationFiles, newUser, openDb, sqlTest, withCase } from "./_harness.ts";

const db = await openDb();

sqlTest("0001: is the first migration", async () => {
  assertEquals((await migrationFiles())[0], "0001_schema.sql");
});

sqlTest("0001: all tables exist", withCase(db, async (q) => {
  const want = ["profiles", "rooms", "room_members", "room_invites", "goal_nodes", "task_assignments", "submissions",
    "submission_links", "files", "tags", "room_tags", "room_tag_suppressions", "notifications",
    "room_notification_settings", "mail_outbox"];
  const rows = await q("select table_name from information_schema.tables where table_schema = 'public' order by 1");
  const have = rows.map((r) => r.table_name);
  for (const t of want) assert(have.includes(t), `missing table ${t}`);
}));

sqlTest("0001: auth.users insert creates a profile with email and a palette tone", withCase(db, async (q) => {
  const uid = await newUser(q, "Hello@Example.com");
  const p = await q("select email::text as email, nickname, avatar_tone from public.profiles where id = $1::uuid", [uid]);
  assertEquals(p.length, 1);
  assertEquals(p[0].email, "Hello@Example.com");
  assertEquals(p[0].nickname, null);
  assert(["mint", "blue", "peach", "lav", "amber", "slate"].includes(p[0].avatar_tone as string));
  // citext: 대소문자 무시 비교
  const c = await q("select count(*)::int as n from public.profiles where email = 'hello@example.com'");
  assertEquals(c[0].n, 1);
}));

sqlTest("0001: rooms checks reject bad period and capacity", withCase(db, async (q) => {
  const uid = await newUser(q);
  await expectFail(q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id)
                      values ('x', 't', 'i', '2026-10-10', '2026-10-01', 6, 'PUBLIC', 'DIRECT', $1::uuid)`, [uid]), "ck_rooms_period");
  await expectFail(q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id)
                      values ('y', 't', 'i', '2026-10-01', '2026-10-10', 1, 'PUBLIC', 'DIRECT', $1::uuid)`, [uid]), "ck_rooms_members");
}));
