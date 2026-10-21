// supabase/tests/api-invoke-db.test.ts — 0035 실 PostgREST 게이트(역할·연결 풀·동시 실행). PGlite 하네스로 증명할 수 없는 것만.
// 로컬 supabase 전용(호스티드 금지 — 파일 머리의 URL 검사). 실행:
//   eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_DB_URL=$DB_URL
//   deno test -A --config supabase/tests/deno.json supabase/tests/api-invoke-db.test.ts
// 쓰기: 테스트 사용자 41 의 토큰·감사·초안, 이 파일이 만든 방(제목 'AI 게이트 <RUN> …')만 — finally 에서 지운다.
// 〔N4〕 경쟁은 같은 사용자의 서로 다른 토큰 · 서로 다른 방 · 직접 PG 연결이 advisory 키를 쥐었다 놓는 제어된 동시 시작(대기 중임을 확인).
import { assert, assertEquals } from "@std/assert";
import postgres from "npm:postgres@3.4.5";
import type { SupabaseClient } from "supabase-js";
import { anon, dbTest, hasEnv, RUN, service, userClient } from "./_testenv.ts";

// 〔N5〕 로컬 강제: 호스티드에 대고 동시성·대량 감사 행을 만들지 않는다
const LOCAL = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DB_URL") ?? "";
if (hasEnv && (!LOCAL.test(Deno.env.get("SUPABASE_URL") ?? "") || !/@(127\.0\.0\.1|localhost):/.test(DB_URL))) {
  throw new Error("api-invoke-db.test.ts 는 로컬 supabase 전용이에요 — SUPABASE_URL·SUPABASE_DB_URL(또는 DB_URL) 이 127.0.0.1/localhost 여야 해요");
}
const pg = hasEnv ? postgres(DB_URL, { max: 4, onnotice: () => {} }) : (null as never);
const USER = 41;

// deno-lint-ignore no-explicit-any
type Any = any;
type R = { data: unknown; error: { message: string } | null };
function must<T>(r: R, label: string): T {
  if (r.error || r.data === null || r.data === undefined) throw new Error(`${label}: ${r.error?.message ?? "no data"}`);
  return r.data as T;
}
const call = async (token: string | null, op: string, args: unknown = {}): Promise<R> => {
  const { data, error } = await anon().rpc("api_invoke", { p_token: token, p_op: op, p_args: args });
  return { data, error };
};
const rpc = async (c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<R> => {
  const { data, error } = await c.rpc(fn, args);
  return { data, error };
};
const env = (r: R) => must<{ ok: boolean; data: Any; error?: { code: string } }>(r, "api_invoke");
// 〔P9〕 날짜는 앱의 오늘 기준(room_create 는 시작일 ≥ 오늘)
const plus = async (n: number) => (await pg`select (public.kst_today() + ${n}::int)::text as d`)[0].d as string;

async function wipe(uid: string) {
  const admin = service();
  for (const t of ["api_audit", "api_plan_drafts", "api_tokens"]) {
    const { error } = await admin.from(t).delete().eq("user_id", uid);
    if (error) console.error("cleanup", t, error.message);
  }
}
async function setup(rooms = 1) {
  const { u, c } = await userClient(USER);
  await wipe(u.id);                                   // 앞선 실행이 죽어 남긴 토큰이 10개 한도를 채우지 않게
  must(await c.rpc("me_update", { p_nickname: "ai" + USER + RUN }), "me_update");
  const [s, e] = [await plus(10), await plus(37)];
  const rs: { id: string; slug: string }[] = [];
  for (let i = 0; i < rooms; i++) {
    rs.push(must(await c.rpc("room_create", { p_title: `AI 게이트 ${RUN} ${i}`, p_intro: "x", p_start_date: s, p_end_date: e,
      p_max_members: 6, p_is_public: true, p_join_mode: "direct" }), "room_create"));   // 0013 판 인자 이름
  }
  const toks: { id: string; token: string }[] = [];
  for (let i = 0; i < 3; i++) {   // 같은 사용자의 서로 다른 토큰 3개
    toks.push(must(await c.rpc("pat_create", { p_name: `gate ${RUN} ${i}`, p_scopes: ["read", "curriculum:write", "personal:write"], p_days: 30 }), "pat_create"));
  }
  return { u, c, rooms: rs, toks };
}
async function cleanup(uid: string, rooms: { id: string }[]) {
  await wipe(uid);
  for (const r of rooms) {
    // 제출 행은 goal_nodes 를 RESTRICT 로 막는다 → 이 방 노드의 제출부터(테스트 방 한정)
    const { data: ns } = await service().from("goal_nodes").select("id").eq("room_id", r.id);
    const ids = (ns ?? []).map((n: { id: number }) => n.id);
    if (ids.length) {
      const { error: e1 } = await service().from("submissions").delete().in("node_id", ids);
      if (e1) console.error("cleanup submissions", e1.message);
    }
    const { error } = await service().from("rooms").delete().eq("id", r.id);
    if (error) console.error("cleanup room", error.message);
  }
}
const preview = async (token: string, slug: string, title: string) => {
  const d = env(await call(token, "curriculum_plan_preview", { study: slug, plan: { schema: "sgtudy.plan/v1", ops: [{ op: "create", title }] } }));
  assert(d.ok && d.data.ok, "preview " + JSON.stringify(d.error ?? d.data.errors));
  return d.data.previewId as string;
};
const fillApplies = async (uid: string, n: number) => {
  const at = new Date(Date.now() - 120_000).toISOString();
  const { error } = await service().from("api_audit").insert(Array.from({ length: n }, () =>
    ({ token_id: null, user_id: uid, source: "PAT", op: "curriculum_plan_apply", dry_run: false, ok: true, created_at: at })));
  if (error) throw new Error("fill " + error.message);
};

// 제어된 동시 시작: key 를 세션 advisory 잠금으로 쥔 채 fire → 400ms 뒤 전부 대기 중인지 확인 → 놓기
async function heldStart<T>(key: string, fire: () => Promise<T>[]): Promise<T[]> {
  const conn = await pg.reserve();
  try {
    await conn`select pg_advisory_lock(hashtextextended(${key}, 0))`;
    const done: boolean[] = [];
    let ps: Promise<T>[] = [];
    try {
      ps = fire().map((p, i) => p.finally(() => { done[i] = true; }));
      await new Promise((r) => setTimeout(r, 400));
      assertEquals(done.filter(Boolean).length, 0, `${key}: 요청들이 잠금에서 기다리고 있어야 한다(잠금이 실제 직렬화 지점인지)`);
    } finally {
      await conn`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
    }
    return await Promise.all(ps);
  } finally { conn.release(); }
}
// 별도 연결의 열린 트랜잭션에서 uid 로 body 실행(방·행 잠금을 쥔 채) → PAT 요청이 막혀 있는지 본 뒤 커밋 → 그 다음에 PAT 응답을 기다린다
async function holdThen<T>(uid: string, body: (tx: Any) => Promise<unknown>, during: () => Promise<T>): Promise<T> {
  let pending!: Promise<T>;
  await pg.begin(async (tx: Any) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true),
                    set_config('request.jwt.claim.sub', ${uid}, true)`;
    await body(tx);                                   // 여기서 잠금을 잡는다
    let settled = false;
    pending = during().finally(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 400));
    assertEquals(settled, false, "PAT 요청이 잠금에서 기다리고 있어야 한다");
  });                                                 // 커밋 → 잠금 해제
  return await pending;
}

dbTest("api: anon 역할로 api_invoke 만 · 내부 함수는 PostgREST 에 없다 · 요청 사이 신원 누수 없음", async () => {
  const { u, c, rooms, toks } = await setup(1);
  try {
    const w = env(await call(toks[0].token, "whoami"));
    assertEquals([w.ok, w.data.userId, w.data.source], [true, u.id, "pat"]);
    for (const [fn, args] of [["api_authenticate", { p_token: toks[0].token, p_op: "whoami" }], ["api_user_lock", { p_user: u.id }],
                              ["api_studies", { p_uid: u.id, p_include_ended: true }], ["api_resolve_study", { p_uid: u.id, p_text: "x" }],
                              ["personal_create_many", { p_slug: rooms[0].slug, p_round: "current", p_goals: [] }]] as const) {
      assert((await anon().rpc(fn, args)).error, fn + " 는 anon 이 부를 수 없어야 한다");
      assert((await c.rpc(fn, args)).error, fn + " 는 authenticated 도 부를 수 없어야 한다");
    }
    for (let i = 0; i < 5; i++) {                     // 같은 연결 풀에서 PAT 요청 바로 뒤의 익명 요청 = 신원 없음
      assertEquals(env(await call(toks[0].token, "whoami")).ok, true);
      assertEquals((await call(null, "whoami")).error?.message, "AUTH_REQUIRED");
      assertEquals((await anon().rpc("me_get")).error !== null, true);
    }
    // 로그인 세션 + 토큰 → API_AUTH_CONFLICT · 세션만 → source session(감사 SESSION)
    assertEquals((await c.rpc("api_invoke", { p_token: toks[0].token, p_op: "whoami", p_args: {} })).error?.message, "API_AUTH_CONFLICT");
    const s = env(await c.rpc("api_invoke", { p_token: null, p_op: "me_studies", p_args: {} }));
    assert(s.data.items.some((x: Any) => x.slug === rooms[0].slug && x.role === "leader"));
    const { data: au } = await service().from("api_audit").select("source, token_id").eq("user_id", u.id).eq("op", "me_studies");
    assertEquals(au, [{ source: "SESSION", token_id: null }]);
  } finally { await cleanup(u.id, rooms); }
});

dbTest("api 〔N4·N3〕: 같은 previewId 를 같은 사용자의 다른 토큰 2개로 동시 적용(19/20) → 한 번 실행 + replayed, 한도 거부 없음", async () => {
  const { u, rooms, toks } = await setup(1);
  try {
    const pv = await preview(toks[0].token, rooms[0].slug, "동시 " + RUN);
    await fillApplies(u.id, 19);
    const rs = await heldStart("sgtudy.api:" + u.id, () => [toks[1], toks[2]].map((t) => call(t.token, "curriculum_plan_apply", { previewId: pv })));
    const ds = rs.map((r) => { assertEquals(r.error, null, "API_RATE_LIMITED 이면 replay 판정이 잠금 전에 일어난 것"); return env(r).data; });
    assertEquals(ds.filter((d) => d.applied && !d.replayed).length, 1);
    assertEquals(ds.filter((d) => d.replayed).length, 1);
    assertEquals(must<unknown[]>(await service().from("goal_nodes").select("id").eq("room_id", rooms[0].id).eq("title", "동시 " + RUN), "count").length, 1);
  } finally { await cleanup(u.id, rooms); }
});

dbTest("api 〔N4〕: 적용 19/20 에서 서로 다른 방 3곳의 previewId 를 다른 토큰 3개로 동시 적용 → 정확히 1건만 성공", async () => {
  const { u, rooms, toks } = await setup(3);
  try {
    const pvs = await Promise.all(rooms.map((r, i) => preview(toks[i].token, r.slug, `r${i} ${RUN}`)));
    await fillApplies(u.id, 19);
    const rs = await heldStart("sgtudy.api:" + u.id, () => pvs.map((pv, i) => call(toks[i].token, "curriculum_plan_apply", { previewId: pv })));
    assertEquals(rs.filter((r) => !r.error && env(r).ok).length, 1);
    assertEquals(rs.filter((r) => r.error?.message === "API_RATE_LIMITED").length, 2);
  } finally { await cleanup(u.id, rooms); }
});

dbTest("api 〔N4〕: PAT 9개에서 동시 생성 3건(같은 세션, 서로 다른 요청) → 10개를 넘지 않는다", async () => {
  const { u, c, rooms } = await setup(0);             // setup 이 3개 → 6개 더 = 9
  try {
    for (let i = 0; i < 6; i++) must(await c.rpc("pat_create", { p_name: `n${i}`, p_scopes: ["read"], p_days: 30 }), "pat_create");
    const rs = await heldStart("sgtudy.pat:" + u.id, () => [0, 1, 2].map((i) => rpc(c, "pat_create", { p_name: `p${i}`, p_scopes: ["read"], p_days: 30 })));
    assertEquals(rs.filter((r) => !r.error).length, 1);
    assertEquals(rs.filter((r) => r.error?.message === "API_TOKEN_LIMIT").length, 2);
  } finally { await cleanup(u.id, rooms); }
});

// 개인 목표 경쟁: 방이 RECRUIT/ACTIVE 여야 한다 → 회차 1개 만든 뒤 service 로 상태만 바꾼다(테스트 방 한정)
async function activeRoomWithRound(c: SupabaseClient, room: { id: string; slug: string }) {
  must(await c.rpc("node_create", { p_slug: room.slug }), "node_create");
  const { error } = await service().from("rooms").update({ status: "ACTIVE" }).eq("id", room.id);
  if (error) throw new Error("activate " + error.message);
}

dbTest("api 〔N4·C#2〕: 개인 목표 추가 경쟁 — 별도 연결이 같은 제목을 만드는 트랜잭션 중이면 PAT 요청은 방 잠금에서 기다렸다가 skipped", async () => {
  const { u, c, rooms, toks } = await setup(1);
  try {
    await activeRoomWithRound(c, rooms[0]);
    const r = await holdThen(u.id,
      (tx) => tx`select public.personal_create_many(${rooms[0].slug}, '"current"'::jsonb, '[{"title":"동시 목표"}]'::jsonb)`,
      () => call(toks[0].token, "personal_create_many", { study: rooms[0].slug, goals: [{ title: "동시 목표" }] }));
    assertEquals([env(r).data.count, env(r).data.skipped], [0, ["동시 목표"]]);
    assertEquals(must<unknown[]>(await service().from("goal_nodes").select("id").eq("room_id", rooms[0].id).eq("title", "동시 목표"), "count").length, 1);
  } finally { await cleanup(u.id, rooms); }
});

dbTest("api 〔N4·C#1〕: 제출-삭제 경쟁 — 별도 연결이 완료(제출) 트랜잭션 중이면 PAT 삭제는 기다렸다가 NODE_HAS_SUBMISSIONS, 목표·제출 유지", async () => {
  const { u, c, rooms, toks } = await setup(1);
  try {
    await activeRoomWithRound(c, rooms[0]);
    const id = env(await call(toks[0].token, "personal_create_many", { study: rooms[0].slug, goals: [{ title: "끝낼 목표" }] })).data.createdIds[0];
    const r = await holdThen(u.id,
      (tx) => tx`select public.personal_complete(${rooms[0].slug}, ${id}::bigint, true)`,
      () => call(toks[1].token, "personal_delete_many", { study: rooms[0].slug, ids: [id] }));
    assertEquals([env(r).ok, env(r).error?.code], [false, "NODE_HAS_SUBMISSIONS"]);
    assertEquals(must<unknown[]>(await service().from("goal_nodes").select("id").eq("id", id), "node").length, 1);
    assertEquals(must<unknown[]>(await service().from("submissions").select("id").eq("node_id", id), "sub").length, 1);
  } finally { await cleanup(u.id, rooms); }
});

// Task 4 이월: 초안 정리(내 미적용 초안 50개 초과 삭제)와 다른 방 초안의 동시 적용 — 정리의 DELETE 가 적용 트랜잭션의 초안 행 잠금에서
// 기다렸다가 커밋 뒤 applied_at 을 다시 보고 건너뛴다(바깥 조건 x.applied_at is null). 없으면 막 적용된 초안이 지워져 replay·되돌리기가 깨진다
dbTest("api 〔P13·T4 이월〕: 정리 중인 미리보기와 다른 방 초안의 동시 적용 → 적용된 초안은 지워지지 않고 replay 된다", async () => {
  const { u, rooms, toks } = await setup(2);
  try {
    const old = await preview(toks[0].token, rooms[1].slug, "정리 경쟁 " + RUN);
    const admin = service();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const fut = new Date(Date.now() + 86_400_000).toISOString();
    { const { error } = await admin.from("api_plan_drafts").update({ created_at: past }).eq("id", old); if (error) throw new Error(error.message); }
    const filler = Array.from({ length: 55 }, (_, i) => ({ id: "pv_" + (RUN.slice(1) + i.toString(16).padStart(6, "0")).padEnd(12, "0").slice(0, 12),
      user_id: u.id, room_id: Number(rooms[0].id), plan: {}, resolved: {}, version: "0".repeat(32), preview: {},
      created_at: new Date(Date.now() - 60_000 + i).toISOString(), expires_at: fut }));
    { const { error } = await admin.from("api_plan_drafts").insert(filler); if (error) throw new Error("filler " + error.message); }
    const r = await holdThen(u.id,
      (tx) => tx`select public.curriculum_plan_apply(${rooms[1].slug}, ${old})`,   // 웹 직접 경로: 방(1) 잠금 + 초안 행 잠금·갱신
      () => call(toks[1].token, "curriculum_plan_preview", { study: rooms[0].slug, plan: { schema: "sgtudy.plan/v1", ops: [{ op: "create", title: "새 " + RUN }] } }));
    assertEquals(env(r).data.ok, true);
    const { data: left } = await admin.from("api_plan_drafts").select("id, applied_at").eq("user_id", u.id).is("applied_at", null);
    assertEquals(left!.length, 50);                    // 정리는 됐다
    const { data: kept } = await admin.from("api_plan_drafts").select("applied_at").eq("id", old);
    assert(kept!.length === 1 && kept![0].applied_at, "적용된 초안이 정리에 지워졌다");
    assertEquals(env(await call(toks[2].token, "curriculum_plan_apply", { previewId: old })).data.replayed, true);
  } finally { await cleanup(u.id, rooms); }
});

addEventListener("unload", () => { if (hasEnv) void pg.end(); });
