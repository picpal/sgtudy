// 0014 개인 목표 — 팀원이 회차 아래에 직접 만드는 PERSONAL 리프. 배정 행 없음, 소유자 = owner_id
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { nodeByTitle, roomId } from "./_curriculum-helpers.ts";
import { cases, one, type Q, type Row, uidOf } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

/** aws 회차 id (라벨로) */
const roundOf = async (q: Q, label: string) =>
  (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'aws' and n.parent_id is null and n.label = $1", [label])).id as string;
/** 표에 직접 개인 목표 한 줄 (RPC 가 생기기 전 Task 1 용) */
async function rawPersonal(q: Q, round: string, owner: string, title: string): Promise<string> {
  const r = await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                          select n.room_id, n.id, n.id, 3, 99, $2, n.start_date, n.end_date, 'PERSONAL', $3::uuid from public.goal_nodes n where n.id = $1
                          returning id::text as id`, [round, title, owner]);
  return r.id as string;
}

cases("personal goals · schema", db, [
  { name: "제약: PERSONAL 은 owner 필수, owner 는 PERSONAL 에만, depth 3 만", run: async (q) => {
    const r2 = await roundOf(q, "2주차");
    const chulsu = await uidOf(q, "철수");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                        select room_id, id, id, 3, 99, 'x', start_date, end_date, 'PERSONAL' from public.goal_nodes where id = $1`, [r2]), "ck_goal_nodes_owner");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                        select room_id, id, id, 3, 99, 'x', start_date, end_date, 'COMMON', $2::uuid from public.goal_nodes where id = $1`, [r2, chulsu]), "ck_goal_nodes_owner");
    const aws = await roomId(q, "aws");
    const bundle = await nodeByTitle(q, aws, "로드밸런서 비교");   // 3주차 묶음(depth 3) 아래 = depth 4
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                        select room_id, id, round_id, 4, 99, 'x', start_date, end_date, 'PERSONAL', $2::uuid from public.goal_nodes where id = $1`, [bundle, chulsu]), "ck_goal_nodes_personal_depth");
  } },
  { name: "트리거: 개인 목표 아래에는 아무것도 못 둔다 (PERSONAL_NODE)", run: async (q) => {
    const p = await rawPersonal(q, await roundOf(q, "2주차"), await uidOf(q, "철수"), "개인 A");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                        select room_id, id, round_id, 4, 0, 'x', start_date, end_date, 'COMMON' from public.goal_nodes where id = $1`, [p]), "PERSONAL_NODE");
  } },
  { name: "node_* 는 개인 목표를 대상으로도 부모로도 못 쓴다 (그룹장도)", run: async (q) => {
    const r2 = await roundOf(q, "2주차");
    const r3 = await roundOf(q, "3주차");
    const p = await rawPersonal(q, r2, await uidOf(q, "철수"), "개인 A");
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(q("select public.node_update('aws', $1, '{\"title\":\"x\"}'::jsonb)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_move('aws', $1, $2, 0)", [p, r3]), "PERSONAL_NODE");
    await expectFail(q("select public.node_delete('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_archive('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_unarchive('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_create('aws', $1, 'x')", [p]), "PERSONAL_NODE");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
    await expectFail(q("select public.node_move('aws', $1, $2, 0)", [ec2, p]), "PERSONAL_NODE");
  } },
  { name: "회차 삭제는 개인 목표를 함께 지운다 (제출 없을 때)", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    const c0 = await one(q, "select public.node_create('aws', null, '임시 회차', null, null, '2026-12-01', '2026-12-07') as c");
    const round = (c0.c.nodes as Row[]).find((n) => n.title === "임시 회차")!.id as string;
    await rawPersonal(q, round, await uidOf(q, "철수"), "개인 B");
    const c = (await one(q, "select public.node_delete('aws', $1) as c", [round])).c;
    assertEquals((c.nodes as Row[]).some((n) => n.title === "개인 B"), false);
  } },
  { name: "is_task_assignee: 보관 아닌 개인 목표의 소유자만 참", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    const p = await rawPersonal(q, await roundOf(q, "2주차"), chulsu, "개인 A");
    const yes = async (u: string) => (await one(q, "select public.is_task_assignee($1, $2::uuid) as v", [p, u])).v as boolean;
    assertEquals([await yes(chulsu), await yes(await uidOf(q, "지은"))], [true, false]);
    await q("update public.goal_nodes set archived_at = now() where id = $1", [p]);
    assertEquals(await yes(chulsu), false);
  } },
  { name: "RLS 정책: 남의 개인 목표는 owner_id 조건이 붙는다", run: async (q) => {
    const pol = await one(q, "select pg_get_expr(polqual, polrelid) as e from pg_policy where polname = 'goal_nodes_select'");
    assert(String(pol.e).includes("owner_id"));
    assert(String(pol.e).includes("can_read_submissions"));
  } },
  { name: "RLS 직접 조회: 외부인·비로그인·대기자에겐 남의 개인 목표 행이 없다", run: async (q) => {
    const p = await rawPersonal(q, await roundOf(q, "2주차"), await uidOf(q, "철수"), "개인 RLS");
    await q("update public.room_members set status = 'PENDING', joined_at = null where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')",
            [await uidOf(q, "하나")]);
    // 호스티드 supabase 는 anon·authenticated 에 표 select 를 기본 부여한다 — PGlite 스텁엔 없어 이 케이스 안에서만 준다(롤백)
    await q("grant usage on schema public, auth to anon, authenticated");
    await q("grant execute on all functions in schema auth to anon, authenticated");
    await q("grant select on public.goal_nodes, public.rooms to anon, authenticated");
    const seen = async (role: string, nick: string | null) => {
      if (nick) await asUser(q, await uidOf(q, nick)); else await asAnon(q);
      await q(`set local role ${role}`);
      const n = (await one(q, "select count(*)::int as n from public.goal_nodes where id = $1", [p])).n as number;
      const team = (await one(q, "select count(*)::int as n from public.goal_nodes g join public.rooms r on r.id = g.room_id where r.slug = 'aws'")).n as number;
      await q("reset role");
      return [n, team > 0];
    };
    assertEquals(await seen("authenticated", "철수"), [1, true]);
    assertEquals(await seen("authenticated", "지은"), [1, true]);
    assertEquals(await seen("authenticated", "도윤"), [1, true]);
    assertEquals(await seen("authenticated", "서연"), [0, true]);
    assertEquals(await seen("authenticated", "하나"), [0, true]);
    assertEquals(await seen("anon", null), [0, true]);
  } },
]);
