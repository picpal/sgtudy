import { assert, assertEquals } from "@std/assert";
import { asAnon, asUser, newUser, openDb, sqlTest, withCase, type Q } from "./_harness.ts";

const db = await openDb();

async function mkRoom(q: Q, leader: string, slug: string, visibility = "PUBLIC", status = "RECRUIT", archived = false): Promise<number> {
  const r = await q(`insert into public.rooms (slug, title, intro, start_date, end_date, max_members, visibility, join_mode, leader_id, status, archived_at)
                     values ($1, 't', 'i', '2026-10-01', '2026-12-31', 6, $2, 'DIRECT', $3::uuid, $4, case when $5 then now() end) returning id`,
                    [slug, visibility, leader, status, archived]);
  return Number(r[0].id);
}
async function addMember(q: Q, room: number, user: string, status: string) {
  await q("insert into public.room_members (room_id, user_id, role, status) values ($1, $2::uuid, 'MEMBER', $3)", [room, user, status]);
}
const b = async (q: Q, sql: string, params: unknown[]) => (await q(sql, params))[0].v as boolean;

sqlTest("rls: every public table has RLS enabled", withCase(db, async (q) => {
  const off = await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  assertEquals(off.map((r) => r.relname), []);
}));

sqlTest("rls: no insert/update/delete policies on public tables (writes go through RPC only)", withCase(db, async (q) => {
  // storage.objects 의 INSERT·DELETE 정책은 의도된 것 → public 스키마만 본다 (regclass::text 는 search_path 스키마를 생략하므로 pg_namespace 로 거른다)
  const w = await q(`select p.polname from pg_policy p
                     join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and p.polcmd <> 'r' order by 1`);
  assertEquals(w.map((r) => r.polname), []);
}));

sqlTest("rls: policy helpers executable by the querying roles; is_task_assignee by authenticated only", withCase(db, async (q) => {
  const can = async (role: string, fn: string) =>
    (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
  for (const fn of ["public.current_user_id()", "public.can_read_room(bigint)", "public.can_read_submission(bigint,uuid)"]) {
    assertEquals(await can("anon", fn), true, fn);
    assertEquals(await can("authenticated", fn), true, fn);
  }
  assertEquals(await can("anon", "public.is_task_assignee(bigint,uuid)"), false);
  assertEquals(await can("authenticated", "public.is_task_assignee(bigint,uuid)"), true);
}));

sqlTest("rls: can_read_room — anon sees public non-draft only", withCase(db, async (q) => {
  const leader = await newUser(q);
  const pubRecruit = await mkRoom(q, leader, "a");
  const pubDraft = await mkRoom(q, leader, "b", "PUBLIC", "DRAFT");
  const priv = await mkRoom(q, leader, "c", "PRIVATE");
  const archived = await mkRoom(q, leader, "d", "PUBLIC", "ACTIVE", true);
  await asAnon(q);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [pubRecruit]), true);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [pubDraft]), false);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [priv]), false);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [archived]), false);
  await asUser(q, leader);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [pubDraft]), true);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [priv]), true);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [archived]), true);
  assertEquals(await b(q, "select public.is_room_leader($1) as v", [priv]), true);
}));

sqlTest("rls: membership states — PENDING reads room but not submissions, INACTIVE reads both", withCase(db, async (q) => {
  const leader = await newUser(q);
  const pending = await newUser(q);
  const inactive = await newUser(q);
  const rejected = await newUser(q);
  const room = await mkRoom(q, leader, "p", "PRIVATE");
  await addMember(q, room, pending, "PENDING");
  await addMember(q, room, inactive, "INACTIVE");
  await addMember(q, room, rejected, "REJECTED");
  await asUser(q, pending);
  assertEquals(await b(q, "select public.is_room_member($1) as v", [room]), true);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [room]), true);
  assertEquals(await b(q, "select public.can_read_submissions($1) as v", [room]), false);
  await asUser(q, inactive);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [room]), true);
  assertEquals(await b(q, "select public.can_read_submissions($1) as v", [room]), true);
  await asUser(q, rejected);
  assertEquals(await b(q, "select public.is_room_member($1) as v", [room]), false);
  assertEquals(await b(q, "select public.can_read_room($1) as v", [room]), false);
  await asUser(q, leader);
  assertEquals(await b(q, "select public.can_read_submissions($1) as v", [room]), true);
}));

sqlTest("rls: is_task_assignee ignores released rows; archived node submissions only for leader/author", withCase(db, async (q) => {
  const leader = await newUser(q);
  const a = await newUser(q);
  const other = await newUser(q);
  const room = await mkRoom(q, leader, "t", "PUBLIC", "ACTIVE");
  await addMember(q, room, a, "ACTIVE");
  await addMember(q, room, other, "ACTIVE");
  const node = Number((await q(`insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date, task_type)
                                 values ($1, null, 2, 0, '1주차', 'w1', '2026-10-01', '2026-10-07', 'COMMON') returning id`, [room]))[0].id);
  await q("insert into public.task_assignments (node_id, user_id, source) values ($1, $2::uuid, 'COMMON')", [node, a]);
  assertEquals(await b(q, "select public.is_task_assignee($1, $2::uuid) as v", [node, a]), true);
  assertEquals(await b(q, "select public.is_task_assignee($1, $2::uuid) as v", [node, other]), false);
  await q("update public.task_assignments set released_at = now() where node_id = $1", [node]);
  assertEquals(await b(q, "select public.is_task_assignee($1, $2::uuid) as v", [node, a]), false);

  await asUser(q, other);
  assertEquals(await b(q, "select public.can_read_submission($1, $2::uuid) as v", [node, a]), true);
  await q("update public.goal_nodes set archived_at = now() where id = $1", [node]);
  assertEquals(await b(q, "select public.can_read_submission($1, $2::uuid) as v", [node, a]), false);
  await asUser(q, a);
  assertEquals(await b(q, "select public.can_read_submission($1, $2::uuid) as v", [node, a]), true);
  await asUser(q, leader);
  assertEquals(await b(q, "select public.can_read_submission($1, $2::uuid) as v", [node, a]), true);
}));

sqlTest("rls: public_profiles exposes only id/nickname/avatar_tone", withCase(db, async (q) => {
  const cols = await q("select column_name from information_schema.columns where table_name = 'public_profiles' order by ordinal_position");
  assertEquals(cols.map((c) => c.column_name), ["id", "nickname", "avatar_tone"]);
}));

sqlTest("rls: attachments bucket and storage policies exist", withCase(db, async (q) => {
  const bk = await q("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'attachments'");
  assertEquals(bk.length, 1);
  assertEquals(bk[0].public, false);
  assertEquals(Number(bk[0].file_size_limit), 10485760);
  assert((bk[0].allowed_mime_types as string[]).includes("application/pdf"));
  const pols = await q("select polname from pg_policy where polrelid = 'storage.objects'::regclass order by 1");
  assertEquals(pols.map((p) => p.polname), ["attachments_delete_own", "attachments_insert_assignee", "attachments_select_member"]);
}));
