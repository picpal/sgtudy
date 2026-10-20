// supabase/tests/extra-recruit-db.test.ts — 0032 실 PostgreSQL(두 연결) 게이트. PGlite(단일 연결)로 증명 못 하는 경쟁·커밋 지속만.
// 로컬 supabase 전용(호스티드 금지). 실행:
//   eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_DB_URL=$DB_URL
//   deno test -A --config supabase/tests/deno.json supabase/tests/extra-recruit-db.test.ts
// 쓰기: 이 파일이 만든 방(제목 '추가모집 <RUN>')·테스트 사용자 31~40 의 행·internal.settings 'today'(finally 에서 되돌림)만.
import { assertEquals } from "@std/assert";
import postgres from "npm:postgres@3.4.5";
import type { SupabaseClient } from "supabase-js";
import { dbTest, hasEnv, RUN, service, testUser, userClient } from "./_testenv.ts";

const LOCAL = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DB_URL") ?? "";
if (hasEnv && (!LOCAL.test(Deno.env.get("SUPABASE_URL") ?? "") || !/@(127\.0\.0\.1|localhost):/.test(DB_URL))) {
  throw new Error("extra-recruit-db.test.ts 는 로컬 supabase 전용이에요 — SUPABASE_URL·SUPABASE_DB_URL(또는 DB_URL) 이 127.0.0.1/localhost 여야 해요");
}
const pg = hasEnv ? postgres(DB_URL, { max: 4, onnotice: () => {} }) : (null as never);

const USERS = [31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
type R = { data: unknown; error: { message: string } | null };
const ok = <T = unknown>(r: R, label: string): T => {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data as T;
};
const code = (r: R) => r.error?.message ?? "OK";

async function member(n: number): Promise<{ id: string; c: SupabaseClient }> {
  const { u, c } = await userClient(n);
  ok(await c.rpc("me_update", { p_nickname: `er${n}${RUN}` }), "me_update");
  return { id: u.id, c };
}
const today = async () => (await pg`select public.kst_today()::text as d`)[0].d as string;
const plus = async (n: number) => (await pg`select (public.kst_today() + ${n}::int)::text as d`)[0].d as string;

/** 리프 1개 있는 ACTIVE 방. 시작일은 **내일**로 만들어 cron 이 먼저 시작시키지 못하게 하고, room_start 로 명시적으로 시작(Codex 2-5).
 *  endIn = 종료일(오늘+n). 회차·리프는 내일~종료일 */
async function activeRoom(leader: { c: SupabaseClient }, max: number, joinMode: "direct" | "approval", endIn = 40) {
  const [s, e] = [await plus(1), await plus(endIn)];
  const room = ok<{ id: string; slug: string }>(
    await leader.c.rpc("room_create", {
      p_title: `추가모집 ${RUN} ${crypto.randomUUID().slice(0, 4)}`, p_intro: "게이트", p_start_date: s, p_end_date: e,
      p_max_members: max, p_is_public: true, p_join_mode: joinMode,
    }),
    "room_create",
  );
  try {
    const admin = service();
    const { data: round, error: e1 } = await admin.from("goal_nodes")
      .insert({ room_id: Number(room.id), parent_id: null, depth: 2, sort_order: 0, label: "1주차", title: "회차", start_date: s, end_date: e })
      .select("id").single();
    if (e1) throw new Error(e1.message);
    const { error: eU } = await admin.from("goal_nodes").update({ round_id: round!.id }).eq("id", round!.id);
    if (eU) throw new Error(eU.message);
    const { error: e2 } = await admin.from("goal_nodes").insert({
      room_id: Number(room.id), parent_id: round!.id, round_id: round!.id, depth: 3, sort_order: 0, title: "과제",
      start_date: s, end_date: e, task_type: "COMMON",
    });
    if (e2) throw new Error(e2.message);
    ok(await leader.c.rpc("room_open_recruit", { p_slug: room.slug }), "open_recruit");
    ok(await leader.c.rpc("room_start", { p_slug: room.slug }), "room_start"); // 예정보다 하루 일찍(시작일 → 오늘)
    assertEquals((await pg`select status from public.rooms where id = ${room.id}::bigint`)[0].status, "ACTIVE");
  } catch (err) {
    await dropRoom(room.id);
    throw err;
  }
  return room;
}
async function dropRoom(id: string) {
  const { error } = await service().from("rooms").delete().eq("id", Number(id));
  if (error) console.error("cleanup room", id, error.message); // 정리 실패가 본 단언을 가리지 않게
}

/** holder 백엔드 뒤에 줄 선(직접 또는 앞선 대기자를 거쳐 — 행 잠금 대기열은 두 번째부터 앞 대기자에게 막힌다), 대상 함수를 실행 중인
 *  백엔드가 n 개가 될 때까지(최대 timeoutMs) 기다린다 — 시간 대기가 아니라 잠금 대기 증명 (Codex 2-5) */
async function waitBlocked(holderPid: number, fn: string, n: number, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [{ c }] = await pg`with recursive w(pid) as (
                               select ${holderPid}::int
                               union
                               select a.pid from pg_stat_activity a, w where w.pid = any(pg_blocking_pids(a.pid)))
                             select count(*)::int as c from pg_stat_activity a
                             where a.pid in (select pid from w) and a.pid <> ${holderPid}::int and a.query ilike ${"%" + fn + "%"}`;
    if (c === n) return;
    if (c > n || Date.now() > until) throw new Error(`${fn} 요청 ${n}개가 방 잠금을 기다려야 하는데 지금 ${c}개예요`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** 방 행을 쥔 채 during(쥔 트랜잭션 안 작업) → fire → 대상 n 개가 바로 이 연결에 막혀 있음을 확인 → commit. 확인 실패면 롤백·실패 */
async function heldRoom<T>(
  roomId: string, fn: string, fire: () => PromiseLike<T>[], during?: (tx: postgres.ReservedSql) => Promise<void>,
): Promise<T[]> {
  const tx = await pg.reserve();
  let ps: Promise<T>[] = [];
  try {
    await tx`begin`;
    await tx`select 1 from public.rooms where id = ${roomId}::bigint for update`;
    const [{ pid }] = await tx`select pg_backend_pid() as pid`;
    if (during) await during(tx);
    ps = fire().map((p) => Promise.resolve(p));
    await waitBlocked(pid as number, fn, ps.length);
    await tx`commit`;
    return await Promise.all(ps);
  } catch (e) {
    await tx`rollback`.catch(() => {});
    await Promise.allSettled(ps); // 잠금이 풀린 뒤 남은 요청을 기다려 다음 사례에 새지 않게
    throw e;
  } finally {
    tx.release();
  }
}

/** tick 이 시드·남의 방을 건드리지 않음을 보장하는 전제: 오늘..오늘+3 사이에 tick 대상이 될 방이 없다(설계 ③) */
const tickTargets = async () =>
  (await pg`select slug from public.rooms
            where archived_at is null and title not like ${"추가모집 " + RUN + "%"}
              and ((status = 'RECRUIT' and start_date <= public.kst_today() + 3)
                or (status = 'ACTIVE' and end_date < public.kst_today() + 3)
                or (recruit_until is not null and (status <> 'ACTIVE' or least(recruit_until, end_date) < public.kst_today() + 3)))
            order by slug`).map((r) => r.slug as string);

dbTest("preflight: clean leftovers of earlier runs, seed has no tick targets within today+3", async () => {
  const ids = await Promise.all(USERS.map(async (n) => (await testUser(n)).id));
  const gone = await pg`delete from public.rooms where title like '추가모집 t%' and leader_id = any(${ids}::uuid[]) returning id`;
  if (gone.length) console.log(`preflight: 이전 실행이 남긴 방 ${gone.length}개 정리`);
  await pg`delete from public.invite_code_failures where user_id = any(${ids}::uuid[])`;
  assertEquals(await tickTargets(), []); // 비어 있지 않으면 날짜를 옮기는 사례가 그 방을 시작·종료·만료시킨다 → 멈추고 확인
});

dbTest("extra window: two concurrent direct joins for the last seat → one OK, one ROOM_FULL", async () => {
  const leader = await member(31);
  const room = await activeRoom(leader, 2, "direct");
  try {
    ok(await leader.c.rpc("room_extra_recruit_open", { p_slug: room.slug, p_until: await plus(3), p_max_members: 2, p_join_mode: "direct" }), "extra_open");
    const [a, b] = [await member(32), await member(33)];
    const res = await heldRoom(room.id, "room_join", () => [
      a.c.rpc("room_join", { p_slug: room.slug }),
      b.c.rpc("room_join", { p_slug: room.slug }),
    ]);
    assertEquals(res.map(code).sort(), ["OK", "ROOM_FULL"]);
    assertEquals((await pg`select member_count from public.rooms where id = ${room.id}::bigint`)[0].member_count, 2);
    assertEquals((await pg`select count(*)::int as n from public.room_members where room_id = ${room.id}::bigint and status = 'ACTIVE'`)[0].n, 2);
  } finally {
    await dropRoom(room.id);
  }
});

dbTest("bypass invite: limit 1, two concurrent invite_join → one OK, one INVITE_EXPIRED, used = 1", async () => {
  const leader = await member(34);
  const room = await activeRoom(leader, 6, "approval");
  try {
    const inv = ok<{ token: string }>(await leader.c.rpc("invite_bypass_set", { p_slug: room.slug, p_until: await plus(3), p_max: 1 }), "bypass_set");
    const [a, b] = [await member(35), await member(36)];
    const res = await heldRoom(room.id, "invite_join", () => [
      a.c.rpc("invite_join", { p_token: inv.token }),
      b.c.rpc("invite_join", { p_token: inv.token }),
    ]);
    assertEquals(res.map(code).sort(), ["INVITE_EXPIRED", "OK"]);
    assertEquals((await pg`select bypass_used from public.room_invites where token = ${inv.token}`)[0].bypass_used, 1);
    assertEquals((await pg`select member_count from public.rooms where id = ${room.id}::bigint`)[0].member_count, 2);
  } finally {
    await dropRoom(room.id);
  }
});

dbTest("tick vs extend: tick picks a lapsed window, leader reopens while holding the row → tick re-checks and leaves the new window", async () => {
  const leader = await member(37);
  const room = await activeRoom(leader, 6, "approval");
  const saved = await today();
  try {
    ok(await leader.c.rpc("room_extra_recruit_open", { p_slug: room.slug, p_until: saved, p_max_members: null, p_join_mode: null }), "extra_open");
    await pg`update internal.settings set value = ${await plus(1)} where key = 'today'`; // 창이 지난 날
    const until = await plus(5);
    const [tick] = await heldRoom(room.id, "room_tick", () => [pg`select public.room_tick() as r`], async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: leader.id, role: "authenticated" })}, true)`;
      await tx`select public.room_extra_recruit_open(${room.slug}, ${until}::date, null, null)`; // 실제 RPC, 커밋 전
    });
    // tick 은 옛 상태(지난 창)로 이 방을 후보로 골라 방 행 잠금에 막혔다(waitBlocked) → 커밋 뒤 재판정해 새 창을 닫지 않았다
    assertEquals((tick as unknown as { r: unknown }[])[0].r, { activated: 0, ended: 0 });
    const row = (await pg`select status, recruit_until::text as u from public.rooms where id = ${room.id}::bigint`)[0];
    assertEquals([row.status, row.u], ["ACTIVE", until]);
  } finally {
    await pg`update internal.settings set value = ${saved} where key = 'today'`;
    await dropRoom(room.id);
  }
});

dbTest("code lookup: failures persist across separate requests (10 → RATE_LIMITED); successes are not stored", async () => {
  const leader = await member(38);
  const room = await activeRoom(leader, 6, "approval");
  const u = await member(39);
  try {
    const { code: real } = ok<{ code: string }>(await leader.c.rpc("invite_get", { p_slug: room.slug }), "invite_get");
    await pg`delete from public.invite_code_failures where user_id = ${u.id}::uuid`;
    assertEquals(ok<{ found: boolean }>(await u.c.rpc("invite_code_lookup", { p_code: real }), "hit").found, true);
    assertEquals((await pg`select count(*)::int as n from public.invite_code_failures where user_id = ${u.id}::uuid`)[0].n, 0);
    const miss = real === "ZZZZZZZZ" ? "YYYYYYYY" : "ZZZZZZZZ";
    for (let i = 9; i >= 0; i--) { // 요청마다 별도 트랜잭션(PostgREST)
      assertEquals(ok(await u.c.rpc("invite_code_lookup", { p_code: miss }), "miss"), { found: false, remaining: i });
    }
    assertEquals(code(await u.c.rpc("invite_code_lookup", { p_code: real })), "RATE_LIMITED");
    assertEquals((await pg`select count(*)::int as n from public.invite_code_failures where user_id = ${u.id}::uuid`)[0].n, 10);
  } finally {
    await pg`delete from public.invite_code_failures where user_id = ${u.id}::uuid`;
    await dropRoom(room.id);
  }
});

dbTest("tick vs end-date extension: tick picks an overdue room, leader extends end_date while holding the row → room stays ACTIVE, not counted (Codex 2-2)", async () => {
  const leader = await member(40);
  const room = await activeRoom(leader, 6, "direct", 2); // 종료일 = 오늘+2
  const saved = await today();
  try {
    await pg`update internal.settings set value = ${await plus(3)} where key = 'today'`; // 종료일이 지난 날
    const newEnd = await plus(10);
    const [tick] = await heldRoom(room.id, "room_tick", () => [pg`select public.room_tick() as r`], async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: leader.id, role: "authenticated" })}, true)`;
      await tx`select public.room_update(${room.slug}, ${tx.json({ endDate: newEnd })})`; // 실제 RPC, 커밋 전
    });
    const row = (await pg`select status, end_date::text as e from public.rooms where id = ${room.id}::bigint`)[0];
    assertEquals([row.status, row.e], ["ACTIVE", newEnd]);
    assertEquals((tick as unknown as { r: unknown }[])[0].r, { activated: 0, ended: 0 }); // 실제 전이만 센다. 시드는 날짜 범위 밖(preflight)
  } finally {
    await pg`update internal.settings set value = ${saved} where key = 'today'`;
    await dropRoom(room.id);
  }
});

// 연결을 명시적으로 닫는다 — 정의 순서대로 도므로 마지막(Codex 2-5)
dbTest("teardown: close the direct pg pool", async () => {
  await pg.end({ timeout: 5 });
});
