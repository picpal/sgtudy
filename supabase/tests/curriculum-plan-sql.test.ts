// 0034 — 진행목표 계획서(curriculum_plan) · node_create_core · curriculum_version · 알림 묶기
// deno-lint-ignore-file no-unused-vars
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q, type Row } from "./_fixtures.ts";
import { mkRoom, submit } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => { await asUser(q, await uidOf(q, nick)); };
const ver = async (q: Q, slug: string) => (await one(q, "select public.curriculum_version($1::bigint) as v", [await roomId(q, slug)])).v as string;
const count = async (q: Q, sql: string, p: unknown[] = []) => Number((await one(q, `select count(*)::int as n from (${sql}) x`, p)).n);

cases("curriculum plan 0034 · core", db, [
  { name: "node_create 는 분리 후에도 같은 결과(회차 기본 라벨·기간, 하위 기본 common, 리프 → 부모 전환)", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const c1 = (await one(q, "select public.node_create($1) as c", [slug])).c as Row;
    const round = c1.nodes[0];
    assertEquals([round.label, round.startDate, round.endDate], ["1주차", "2026-11-01", "2026-11-07"]);
    const c2 = (await one(q, "select public.node_create($1, $2::bigint, '과제 A') as c", [slug, round.id])).c as Row;
    const leaf = c2.nodes.find((n: Row) => n.title === "과제 A");
    assertEquals(leaf.task.type, "common");
    const c3 = (await one(q, "select public.node_create($1, $2::bigint, '하위') as c", [slug, leaf.id])).c as Row;
    assertEquals(c3.nodes.find((n: Row) => n.id === leaf.id).task, null);
  } },
  { name: "node_create_core 는 id 를 돌려주고 설명을 저장한다(배정 동기화는 호출자 몫)", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const r = await one(q, "select public.node_create_core(r, public.current_user_id(), null, '회차', null, null, null, null, null, '설명') as id from public.rooms r where r.slug = $1", [slug]);
    const n = await one(q, "select depth, description_md, round_id::text as rid from public.goal_nodes where id = $1::bigint", [r.id]);
    assertEquals([n.depth, n.description_md, n.rid], [2, "설명", String(r.id)]);
  } },
  { name: "curriculum_version: 제목·일정·지정 담당이 바뀌면 달라지고, 제출·개인 목표에는 그대로", run: async (q) => {
    await as(q, "민수");
    const v0 = await ver(q, "aws");
    assertMatch(v0, /^[0-9a-f]{32}$/);
    await submit(q, await nodeId(q, "aws", "ALB vs NLB 실습"), "지은");
    assertEquals(await ver(q, "aws"), v0);       // 제출 무관
    await as(q, "지은");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    await q("select public.personal_create('aws', $1::bigint, '내 복습')", [r2]);
    assertEquals(await ver(q, "aws"), v0);
    await as(q, "민수");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    await q("select public.node_update('aws', $1::bigint, '{\"title\":\"ALB vs NLB 비교 실습\"}')", [alb]);
    assertNotEquals(await ver(q, "aws"), v0);
  } },
  { name: "〔C#3〕 curriculum_version: 필드 경계 충돌 없음(라벨 'x|y'+제목 'z' ≠ 라벨 'x'+제목 'y|z') · null 자리 유지", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const c = (await one(q, "select public.node_create($1, null, 'z', 'x|y') as c", [slug])).c as Row;
    const rid = c.nodes[0].id;
    const v1 = await ver(q, slug);
    await q("select public.node_update($1, $2::bigint, '{\"label\":\"x\",\"title\":\"y|z\"}')", [slug, rid]);
    assertNotEquals(await ver(q, slug), v1);   // concat_ws('|') 판에서는 둘 다 '…|x|y|z|…' 로 같았다
  } },
  { name: "〔C#3〕 curriculum_version: 방 시작일·상태·ACTIVE 멤버가 바뀌면 달라진다", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const v0 = await ver(q, slug);
    await q("update public.rooms set start_date = start_date + 7, end_date = end_date + 7 where id = $1::bigint", [id]);
    const v1 = await ver(q, slug);
    assertNotEquals(v1, v0);                    // 빈 방 회차 기본 날짜 = 방 시작일 → 미리본 날짜와 달라질 수 있다
    await q(`insert into public.room_members (room_id, user_id, role, status, joined_at)
             values ($1::bigint, $2::uuid, 'MEMBER', 'ACTIVE', now())`, [id, await uidOf(q, "지은")]);
    const v2 = await ver(q, slug);
    assertNotEquals(v2, v1);                    // 공통 배정·알림 수신자가 바뀐다
    await q("update public.rooms set status = 'RECRUIT' where id = $1::bigint", [id]);
    const v3 = await ver(q, slug);
    assertNotEquals(v3, v2);                    // 상태 — 알림·배정
    await q("update public.rooms set leader_does_tasks = not leader_does_tasks where id = $1::bigint", [id]);
    const v4 = await ver(q, slug);
    assertNotEquals(v4, v3);                    // 공통 배정 대상
    await q("update public.room_members set status = 'INACTIVE' where room_id = $1::bigint and user_id = $2::uuid", [id, await uidOf(q, "지은")]);
    assertNotEquals(await ver(q, slug), v4);    // ACTIVE 에서 빠짐
  } },
  { name: "curriculum_version: 멤버가 나갔다 다시 들어와 assign_from 만 바뀌어도(ACTIVE 집합 동일) 달라진다", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const ji = await uidOf(q, "지은");
    await q(`insert into public.room_members (room_id, user_id, role, status, joined_at, assign_from)
             values ($1::bigint, $2::uuid, 'MEMBER', 'ACTIVE', now(), '2026-11-03')`, [id, ji]);
    const v0 = await ver(q, slug);
    await q("update public.room_members set status = 'INACTIVE' where room_id = $1::bigint and user_id = $2::uuid", [id, ji]);
    await q("update public.room_members set status = 'ACTIVE', assign_from = '2026-11-10' where room_id = $1::bigint and user_id = $2::uuid", [id, ji]);
    assertNotEquals(await ver(q, slug), v0);
  } },
  { name: "curriculum_version: 같은 상태면 같은 값 · 방 없음(null)도 예외 없이 32자", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    assertEquals(await ver(q, slug), await ver(q, slug));
    const v = (await one(q, "select public.curriculum_version(null) as v")).v as string;
    assertMatch(v, /^[0-9a-f]{32}$/);
  } },
]);
