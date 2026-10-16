// 0016 room_start 시작일 규칙 — 앞당겨 시작할 때만 start_date = 오늘, 예정일 이후 시작은 예정 시작일 유지 + 기존 방 복구
import { assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, one, uidOf, type Q } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const create = (q: Q, title: string, s: string, e: string) =>
  one(q, "select public.room_create($1, '소개', $2::date, $3::date, 4, true, 'direct') as d", [title, s, e]).then((r) => r.d);
/** 1회차(depth 2) + 공통 리프 하나 */
const addRound = async (q: Q, roomId: string, s: string, e: string) => {
  const rd = await one(q, `insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
                           values ($1::bigint, null, 2, 0, '1주차', '첫 주', $2::date, $3::date) returning id::text as id`, [roomId, s, e]);
  await q("update public.goal_nodes set round_id = id where id = $1::bigint", [rd.id]);
  await q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
           values ($1::bigint, $2::bigint, $2::bigint, 3, 0, 't', $3::date, $4::date, 'COMMON')`, [roomId, rd.id, s, e]);
  return rd.id as string;
};
/** 모집중 방 하나(철수 참가) — 그룹장 민수 */
const recruitRoom = async (q: Q, title: string, today: string, s: string, e: string, rs: string, re: string) => {
  const minsu = await uidOf(q, "민수");
  await setToday(q, today);
  await asUser(q, minsu);
  const d = await create(q, title, s, e);
  const round = await addRound(q, d.id, rs, re);
  await q("select public.room_open_recruit($1)", [d.slug]);
  await asUser(q, await uidOf(q, "철수"));
  await q("select public.room_join($1)", [d.slug]);
  await asUser(q, minsu);
  return { d, round, minsu };
};
const startOf = async (q: Q, id: string) =>
  (await one(q, "select to_char(start_date, 'YYYY-MM-DD') as s from public.rooms where id = $1::bigint", [id])).s as string;
const repair = async (q: Q) =>
  ((await one(q, "select public.room_start_date_repair() as r")).r as { roomId: string; from: string; to: string }[]);

cases("start-date", db, [
  { name: "room_start after the planned start keeps the planned start_date (round stays inside the room period)", run: async (q) => {
    const { d, round } = await recruitRoom(q, "늦은 시작 Late", "2026-10-14", "2026-10-15", "2026-10-23", "2026-10-15", "2026-10-21");
    await setToday(q, "2026-10-16");
    const r = (await one(q, "select public.room_start($1) as r", [d.slug])).r;
    assertEquals(r.status, "active");
    assertEquals(r.startDate, "2026-10-15");
    assertEquals(await startOf(q, d.id), "2026-10-15");
    // 회차 수정에 방 기간 경고가 붙지 않는다
    const u = (await one(q, "select public.node_update($1, $2::bigint, $3::jsonb) as r", [d.slug, round, JSON.stringify({ title: "첫 주 수정" })])).r;
    assertEquals((u.warnings ?? []).filter((w: { code: string }) => w.code === "PERIOD_OUTSIDE_ROOM").length, 0);
    // 진행 중 회차 ROUND_STARTED 는 그대로(오늘 기준)
    assertEquals((await q("select 1 from public.notifications where kind = 'ROUND_STARTED' and node_id = $1::bigint", [round])).length, 2);
  } },

  { name: "room_start on the planned start day keeps start_date (= today)", run: async (q) => {
    const { d } = await recruitRoom(q, "당일 시작 Same", "2026-10-14", "2026-10-15", "2026-10-23", "2026-10-15", "2026-10-21");
    await setToday(q, "2026-10-15");
    const r = (await one(q, "select public.room_start($1) as r", [d.slug])).r;
    assertEquals(r.startDate, "2026-10-15");
  } },

  { name: "room_start before the planned start pulls start_date to today", run: async (q) => {
    const { d } = await recruitRoom(q, "이른 시작 Early", "2026-10-12", "2026-10-20", "2026-10-30", "2026-10-20", "2026-10-26");
    await setToday(q, "2026-10-13");
    const r = (await one(q, "select public.room_start($1) as r", [d.slug])).r;
    assertEquals(r.startDate, "2026-10-13");
  } },

  { name: "early room_start that would make the period exceed 1 year fails PERIOD_TOO_LONG and leaves the room RECRUIT", run: async (q) => {
    const { d } = await recruitRoom(q, "긴 방 Long", "2026-10-12", "2026-10-20", "2027-10-19", "2026-10-20", "2026-10-26");
    await setToday(q, "2026-10-13");
    await expectFail(q("select public.room_start($1)", [d.slug]), "PERIOD_TOO_LONG");
    const row = await one(q, "select status, to_char(start_date, 'YYYY-MM-DD') as s from public.rooms where id = $1::bigint", [d.id]);
    assertEquals([row.status, row.s], ["RECRUIT", "2026-10-20"]);
  } },

  { name: "repair: a room moved by the old room_start gets start_date back to its first round start; idempotent", run: async (q) => {
    const before = await repair(q);                                          // 시드에는 대상이 없다
    assertEquals(before, []);
    const { d, minsu } = await recruitRoom(q, "옛 시작 Old", "2026-10-14", "2026-10-15", "2026-10-23", "2026-10-15", "2026-10-21");
    // 0004 판 room_start 를 흉내: start_date = today 로 당기고 그룹장이 actor
    await setToday(q, "2026-10-16");
    await q("update public.rooms set start_date = '2026-10-16' where id = $1::bigint", [d.id]);
    await q("select public.room_transition_active($1::bigint, $2::uuid)", [d.id, minsu]);
    const r = await repair(q);
    assertEquals(r, [{ roomId: d.id, from: "2026-10-16", to: "2026-10-15" }]);
    assertEquals(await startOf(q, d.id), "2026-10-15");
    assertEquals(await repair(q), []);
  } },

  { name: "repair leaves tick-started rooms, rounds added after start, and >1-year results alone", run: async (q) => {
    // (a) tick 이 시작(actor null ROOM_STARTED) — 그룹장이 모집중에 시작일을 회차보다 늦춘 경우
    const a = await recruitRoom(q, "틱 Tick", "2026-10-14", "2026-10-16", "2026-10-23", "2026-10-15", "2026-10-21");
    await setToday(q, "2026-10-16");
    await q("select public.room_tick()");
    // (b) 옛 room_start 로 옮겨졌지만 1회차가 시작 뒤에 만들어짐
    const b = await recruitRoom(q, "나중 회차 After", "2026-10-14", "2026-10-15", "2026-10-23", "2026-10-15", "2026-10-21");
    await q("update public.goal_nodes set created_at = now() + interval '1 hour' where room_id = $1::bigint", [b.d.id]);
    await setToday(q, "2026-10-16");
    await q("update public.rooms set start_date = '2026-10-16' where id = $1::bigint", [b.d.id]);
    await q("select public.room_transition_active($1::bigint, $2::uuid)", [b.d.id, b.minsu]);
    // (c) 되돌리면 1년을 넘는다
    const c = await recruitRoom(q, "넘침 Over", "2026-10-14", "2026-10-15", "2027-10-14", "2026-10-14", "2026-10-21");
    await setToday(q, "2026-10-16");
    await q("update public.rooms set start_date = '2026-10-16', end_date = '2027-10-15' where id = $1::bigint", [c.d.id]);
    await q("select public.room_transition_active($1::bigint, $2::uuid)", [c.d.id, c.minsu]);
    assertEquals(await repair(q), []);
    assertEquals([await startOf(q, a.d.id), await startOf(q, b.d.id), await startOf(q, c.d.id)], ["2026-10-16", "2026-10-16", "2026-10-16"]);
  } },
]);
