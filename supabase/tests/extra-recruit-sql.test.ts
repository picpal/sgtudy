// supabase/tests/extra-recruit-sql.test.ts — 0032 추가 모집 · 초대 코드(바로 참가) (스펙 2026-10-20-extra-recruit-design)
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";
import { openRoom } from "./_cases-membership.ts";   // 리프 있는 RECRUIT 방 (실제 종료일 단축 사례)
import { USERS } from "./_cases-rooms.ts";

const db = await openDb();
await applySeed(db);

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** 시드 사용자로 행동 */
const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
/** select <expr> as r 의 r */
const rpc = async (q: Q, expr: string, p: unknown[] = []) => (await one(q, `select ${expr} as r`, p)).r as Row;
const memberRow = async (q: Q, slug: string, uid: string) =>
  await one(q, `select m.status, to_char(m.assign_from, 'YYYY-MM-DD') as assign_from from public.room_members m
                join public.rooms r on r.id = m.room_id where r.slug = $1 and m.user_id = $2::uuid`, [slug, uid]);
/** 배정 행이 있으면 유효 여부, 없으면 null */
const live = async (q: Q, node: string, uid: string) =>
  (await one(q, "select released_at is null as v from public.task_assignments where node_id = $1::bigint and user_id = $2::uuid", [node, uid]))?.v ?? null;
const recruitOpen = async (q: Q, slug: string) =>
  (await one(q, "select public.room_recruit_open(r) as v from public.rooms r where r.slug = $1", [slug])).v as boolean;
const openExtra = (q: Q, slug: string, until: string, max: number | null = null, mode: string | null = null) =>
  rpc(q, "public.room_extra_recruit_open($1, $2::date, $3::int, $4)", [slug, until, max, mode]);
const notes = async (q: Q, nick: string, kind: string, slug: string) =>
  await q(`select n.title, n.body from public.notifications n join public.rooms r on r.id = n.room_id
           where n.user_id = $1::uuid and n.kind = $2 and r.slug = $3 order by n.id`, [await uidOf(q, nick), kind, slug]);
// (Task 1 시점에 아직 안 쓰는 import·헬퍼는 Task 2~4 묶음이 쓴다)

cases("extra recruit 0032 · schema & helpers", db, [
  { name: "invite_code_norm: upper, strip spaces/hyphens, O→0 I/L→1", run: async (q) => {
    const n = async (s: string) => (await one(q, "select public.invite_code_norm($1) as v", [s])).v;
    assertEquals(await n(" k7qm-3xpa "), "K7QM3XPA");
    assertEquals(await n("oIlL"), "0111");
    assertEquals(await n(""), "");
  } },
  { name: "invite_code_new: 8 Crockford chars, unique among 200", run: async (q) => {
    const rows = await q("select public.invite_code_new() as c from generate_series(1, 200)");
    for (const r of rows) assertMatch(r.c as string, CODE_RE);
    assertEquals(new Set(rows.map((r) => r.c)).size, 200);
  } },
  { name: "room_recruit_open: RECRUIT yes · ACTIVE only inside window · archived/ENDED no", run: async (q) => {
    assertEquals(await recruitOpen(q, "toeic"), true);
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-12' where slug = 'aws'");
    assertEquals(await recruitOpen(q, "aws"), true);                 // 오늘까지 포함
    await setToday(q, "2026-10-13");
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-20', archived_at = now() where slug = 'aws'");
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-20' where slug = 'algo'");
    assertEquals(await recruitOpen(q, "algo"), false);               // ENDED
    // 실효 마감 = least(recruit_until, end_date) (Codex #3)
    await q("update public.rooms set archived_at = null, recruit_until = '2026-11-30', end_date = '2026-10-14' where slug = 'aws'");
    assertEquals((await one(q, "select to_char(public.room_recruit_until(r), 'YYYY-MM-DD') as v from public.rooms r where slug = 'aws'")).v, "2026-10-14");
    await setToday(q, "2026-10-15");
    assertEquals(await recruitOpen(q, "aws"), false);                // 종료일이 지나면 tick 전에도 닫힘
  } },
  { name: "assignment_resync: assign_from skips COMMON leaves that ended before it; others unchanged", run: async (q) => {
    const aws = await roomId(q, "aws");
    const late = await uidOf(q, "서연");
    const jieun = await uidOf(q, "지은");
    await q("insert into public.room_members (room_id, user_id, role, status, joined_at, assign_from) values ($1::bigint, $2::uuid, 'MEMBER', 'ACTIVE', now(), '2026-10-12')", [aws, late]);
    await q("select public.assignment_resync($1::bigint)", [aws]);
    assertEquals(await live(q, await nodeId(q, "aws", "IAM 정책 이해"), late), null);      // 10/01~10/03
    assertEquals(await live(q, await nodeId(q, "aws", "VPC 실습"), late), null);           // 10/04~10/07
    assertEquals(await live(q, await nodeId(q, "aws", "ALB vs NLB 실습"), late), true);    // 10/15~
    assertEquals(await live(q, await nodeId(q, "aws", "RDS·Aurora 비교"), late), true);
    assertEquals(await live(q, await nodeId(q, "aws", "IAM 정책 이해"), jieun), true);     // 기존 멤버 그대로
    // 나중에 만든 지난 날짜 공통 과제도 중간 합류자에겐 안 간다
    const r2 = (await one(q, "select n.id from public.goal_nodes n where n.room_id = $1::bigint and n.label = '2주차'", [aws])).id;
    const past = (await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                                values ($1::bigint, $2, $2, 3, 99, '지난 공통', '2026-10-08', '2026-10-11', 'COMMON') returning id::text as id`, [aws, r2])).id;
    const today = (await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                                 values ($1::bigint, $2, $2, 3, 100, '오늘 마감', '2026-10-08', '2026-10-12', 'COMMON') returning id::text as id`, [aws, r2])).id;
    await q("select public.assignment_resync($1::bigint)", [aws]);
    assertEquals(await live(q, past, late), null);
    assertEquals(await live(q, past, jieun), true);
    assertEquals(await live(q, today, late), true);                  // 마감 = 합류일 → 배정
  } },
  { name: "invite_code_failures: closed to clients", run: async (q) => {
    const p = async (role: string, priv: string) => (await one(q, "select has_table_privilege($1, 'public.invite_code_failures', $2) as v", [role, priv])).v;
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert"]) assertEquals(await p(role, priv), false, `${role} ${priv}`);
  } },
]);
