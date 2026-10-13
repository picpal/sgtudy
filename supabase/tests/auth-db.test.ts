import { assert, assertEquals } from "@std/assert";
import { anon, dbTest, RUN, userClient } from "./_testenv.ts";

// 실제 Postgres + GoTrue + PostgREST 에서만 보이는 것: RLS 차단, anon/authenticated 역할, RPC 에러 전달 형식.
// 시드 행은 읽기만. 쓰기는 테스트 사용자 자신의 profiles 행뿐.

dbTest("anon cannot read profiles (emails hidden), but sees public_profiles without email", async () => {
  const a = anon();
  const { data: p, error: e1 } = await a.from("profiles").select("id, email");
  assertEquals(e1, null);
  assertEquals(p, []);
  const { data: pub, error: e2 } = await a.from("public_profiles").select("*").limit(5);
  assertEquals(e2, null);
  assert(pub!.length > 0, "seeded public profiles visible");
  assertEquals("email" in pub![0], false);
});

dbTest("anon rpc me_get fails with AUTH_REQUIRED carried in error.message", async () => {
  const { error } = await anon().rpc("me_get");
  assertEquals(error?.message, "AUTH_REQUIRED");
  assertEquals(error?.details, "로그인이 필요해요");
});

dbTest("authenticated user reads only own profile row with email", async () => {
  const { u, c } = await userClient(1);
  const { data, error } = await c.from("profiles").select("id, email");
  assertEquals(error, null);
  assertEquals(data!.map((r) => r.id), [u.id]);
  assertEquals(data![0].email, u.email);
});

dbTest("direct insert into rooms is rejected by RLS even when authenticated", async () => {
  const { u, c } = await userClient(1);
  const { error } = await c.from("rooms").insert({
    slug: "rls-" + RUN, title: "t", intro: "i", start_date: "2026-10-01", end_date: "2026-12-31",
    max_members: 6, visibility: "PUBLIC", join_mode: "DIRECT", leader_id: u.id,
  });
  assert(error !== null, "insert must fail");
  assertEquals(error!.code, "42501");   // insufficient_privilege (RLS)
});

dbTest("me_update sets a nickname; nickname_check reports taken for another user; PostgREST hint carries json", async () => {
  const nick = "tester " + RUN;
  const { c: c1 } = await userClient(1);
  const { data: me, error } = await c1.rpc("me_update", { p_nickname: nick });
  assertEquals(error, null);
  assertEquals(me.nickname, nick);
  assertEquals(me.onboarded, true);

  const { c: c2 } = await userClient(2);
  const { data: chk } = await c2.rpc("nickname_check", { p_value: nick.toUpperCase() });
  assertEquals(chk, { available: false, reason: "taken" });
  const { error: taken } = await c2.rpc("me_update", { p_nickname: nick });
  assertEquals(taken?.message, "NICKNAME_TAKEN");
  assertEquals(JSON.parse(taken!.hint!), { field: "nickname" });
});

dbTest("meta_get is callable by anon and returns KST today (seed pins 2026-10-12)", async () => {
  const { data, error } = await anon().rpc("meta_get");
  assertEquals(error, null);
  assertEquals(data.today, "2026-10-12");
});

dbTest("internal helpers are not exposed as RPC even with Supabase default grants (D7)", async () => {
  // Supabase 는 public 함수에 anon·authenticated GRANT 를 기본으로 준다 — 0002 의 alter default privileges 가 그것까지 걷어냈는지
  for (const [fn, args] of [["require_user", {}], ["person_json", { p_user: "00000000-0000-4000-8000-000000000001" }]] as const) {
    const { error } = await anon().rpc(fn, args);
    assert(error !== null, fn);
    assert(error!.code === "42501" || error!.code === "PGRST202", `${fn}: ${error!.code} ${error!.message}`);
  }
});
