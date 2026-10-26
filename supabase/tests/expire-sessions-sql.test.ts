// supabase/tests/expire-sessions-sql.test.ts — 0050 30일 비활성 세션 만료
import { assertEquals } from "@std/assert";
import { asUser, expectFail, newUser, openDb } from "./_harness.ts";
import { cases, one, type Q } from "./_fixtures.ts";

const db = await openDb();

/** 마지막 활동을 days 일 전으로 둔 세션 + refresh token 하나. via: 어느 컬럼이 마지막 활동인지 */
async function session(q: Q, uid: string, days: number, via: "refreshed" | "updated" | "created"): Promise<string> {
  const id = crypto.randomUUID();
  const old = "now() - interval '60 days'";
  const at = `now() - make_interval(days => $3::int)`;
  await q(
    `insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at) values ($1::uuid, $2::uuid,
       ${via === "created" ? at : old},
       ${via === "updated" ? at : via === "created" ? "null" : old},
       ${via === "refreshed" ? `(${at}) at time zone 'UTC'` : "null"})`,
    [id, uid, days],
  );
  await q("insert into auth.refresh_tokens (token, user_id, session_id) values ($1, $2, $3::uuid)", [id, uid, id]);
  return id;
}
const alive = async (q: Q, id: string) =>
  (await one(q, "select count(*)::int as n from auth.sessions where id = $1::uuid", [id])).n === 1;
const tokens = async (q: Q, id: string) =>
  (await one(q, "select count(*)::int as n from auth.refresh_tokens where session_id = $1::uuid", [id])).n;

cases("expire-inactive-sessions 0050", db, [
  { name: "31일 전 활동 → 삭제(refresh token cascade) · 29일 → 유지 · 기준 coalesce(refreshed_at, updated_at, created_at)", run: async (q) => {
    const u = await newUser(q);
    const s = {
      r31: await session(q, u, 31, "refreshed"), r29: await session(q, u, 29, "refreshed"),
      u31: await session(q, u, 31, "updated"), u29: await session(q, u, 29, "updated"),
      c31: await session(q, u, 31, "created"), c29: await session(q, u, 29, "created"),
    };
    assertEquals((await one(q, "select public.job_expire_inactive_sessions() as n")).n, 3);
    for (const k of ["r31", "u31", "c31"] as const) {
      assertEquals(await alive(q, s[k]), false, k);
      assertEquals(await tokens(q, s[k]), 0, `${k} tokens`);
    }
    for (const k of ["r29", "u29", "c29"] as const) {
      assertEquals(await alive(q, s[k]), true, k);
      assertEquals(await tokens(q, s[k]), 1, `${k} tokens`);
    }
    assertEquals((await one(q, "select public.job_expire_inactive_sessions() as n")).n, 0);   // 멱등
  } },
  { name: "security definer · search_path '' · anon/authenticated EXECUTE 불가 · authenticated 호출 → permission denied", run: async (q) => {
    const p = await one(q, `select p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname = 'job_expire_inactive_sessions'`);
    assertEquals(p.prosecdef, true);
    assertEquals([...(p.proconfig as string[])], ['search_path=""']);
    for (const role of ["anon", "authenticated"]) {
      assertEquals((await one(q, "select has_function_privilege($1, 'public.job_expire_inactive_sessions()', 'execute') as v", [role])).v, false, role);
    }
    await asUser(q, await newUser(q));
    await q("set local role authenticated");
    try { await expectFail(q("select public.job_expire_inactive_sessions()"), "permission denied"); }
    finally { await q("reset role"); }
  } },
  { name: "cron 잡 등록: 19:15 UTC(04:15 KST) 하루 1회", run: async (q) => {
    const j = await one(q, "select schedule, command from cron.job where jobname = 'expire-inactive-sessions'");
    assertEquals([j.schedule, j.command], ["15 19 * * *", "select public.job_expire_inactive_sessions()"]);
  } },
]);
