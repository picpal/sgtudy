import { assert, assertEquals } from "@std/assert";
import type { SupabaseClient } from "supabase-js";
import { anon, dbTest, RUN, service, userClient } from "./_testenv.ts";

// 실제 Postgres + PostgREST 에서만 보이는 것: 두 연결의 정원 race, RLS 차단, 에러 전달 형식.
// 시드 행은 읽기만. 쓰기는 이 테스트가 만든 방(제목에 RUN) 과 테스트 사용자 자신의 행뿐.

/** 테스트 사용자 n 을 온보딩(닉네임)까지 마친 클라이언트 */
async function member(n: number): Promise<{ id: string; c: SupabaseClient }> {
  const { u, c } = await userClient(n);
  const { error } = await c.rpc("me_update", { p_nickname: `u${n}${RUN}` });
  if (error) throw new Error("me_update " + error.message);
  return { id: u.id, c };
}

async function rpc<T = unknown>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

dbTest("capacity race: 5/6 room, two concurrent joins → exactly one ROOM_FULL, member_count 6", async () => {
  const leader = await member(1);
  const room = await rpc<{ id: string; slug: string }>(leader.c, "room_create", {
    p_title: `race ${RUN}`, p_intro: "동시성", p_start_date: "2026-12-01", p_end_date: "2026-12-28",
    p_max_members: 6, p_is_public: true, p_join_mode: "direct",
  });
  try {
    // 리프 1개 (node_create 는 플랜 03) — service_role 로 직접 INSERT
    const admin = service();
    const { data: round, error: e1 } = await admin.from("goal_nodes")
      .insert({ room_id: Number(room.id), parent_id: null, depth: 2, sort_order: 0, label: "1주차", title: "회차", start_date: "2026-12-01", end_date: "2026-12-07" })
      .select("id").single();
    if (e1) throw new Error(e1.message);
    const { error: eU } = await admin.from("goal_nodes").update({ round_id: round!.id }).eq("id", round!.id);
    if (eU) throw new Error(eU.message);
    const { error: e2 } = await admin.from("goal_nodes")
      .insert({ room_id: Number(room.id), parent_id: round!.id, round_id: round!.id, depth: 3, sort_order: 0, title: "과제", start_date: "2026-12-01", end_date: "2026-12-07", task_type: "COMMON" });
    if (e2) throw new Error(e2.message);
    await rpc(leader.c, "room_open_recruit", { p_slug: room.slug });

    for (const n of [2, 3, 4, 5]) await rpc((await member(n)).c, "room_join", { p_slug: room.slug });   // 5/6
    // HTTP 수준에서는 직렬화(락)와 우연한 순차 도착을 구분할 수 없다 — 이 사례는 결과 불변식만 본다.
    // 락 자체의 증명은 PGlite 정원 사례(room_take_seat 의 조건부 UPDATE)가 맡는다.
    const a = await member(6), b = await member(7);
    const results = await Promise.all([
      a.c.rpc("room_join", { p_slug: room.slug }),
      b.c.rpc("room_join", { p_slug: room.slug }),
    ]);
    const codes = results.map((r) => r.error?.message ?? "OK").sort();
    assertEquals(codes, ["OK", "ROOM_FULL"]);
    const { data: row } = await admin.from("rooms").select("member_count, max_members").eq("id", Number(room.id)).single();
    assertEquals([row!.member_count, row!.max_members], [6, 6]);
    const { count } = await admin.from("room_members").select("*", { count: "exact", head: true }).eq("room_id", Number(room.id)).eq("status", "ACTIVE");
    assertEquals(count, 6);
  } finally {
    const { error } = await service().from("rooms").delete().eq("id", Number(room.id));   // 조건부 삭제(FK cascade) — 리더 RPC 에 의존하지 않는다
    if (error) console.error("cleanup: delete room", room.id, error.message);   // 정리 실패가 본 단언을 가리지 않게 throw 하지 않는다
  }
});

dbTest("RLS: anon cannot see private room via from('rooms'), sees public room", async () => {
  const a = anon();
  const { data: priv, error: e1 } = await a.from("rooms").select("slug").eq("slug", "spring");
  assertEquals(e1, null);
  assertEquals(priv, []);
  const { data: pub, error: e2 } = await a.from("rooms").select("slug").eq("slug", "aws");
  assertEquals(e2, null);
  assertEquals(pub, [{ slug: "aws" }]);
  // 로그인했지만 비멤버도 비공개 방은 못 본다
  const u = await member(8);
  const { data: priv2 } = await u.c.from("rooms").select("slug").eq("slug", "spring");
  assertEquals(priv2, []);
});

dbTest("rpc error mapping: message = code, details = Korean, hint = json", async () => {
  const a = anon();
  const r1 = await a.rpc("room_get", { p_slug: "spring" });
  assertEquals(r1.error?.message, "ROOM_NOT_FOUND");
  assertEquals(r1.error?.details, "방을 찾을 수 없어요");
  const r2 = await a.rpc("room_join", { p_slug: "toeic" });
  assertEquals(r2.error?.code, "42501");
  const u = await member(8);
  const r3 = await u.c.rpc("room_apply", { p_slug: "jcg" });
  assertEquals(r3.error?.message, "ROOM_FULL");
  assertEquals(JSON.parse(r3.error!.hint!), { field: "maxMembers" });
  // 내부 함수는 RPC 로 부를 수 없다 — Supabase 기본 GRANT 까지 걷어낸 0002 default privileges 의 실측(D1)
  const r4 = await u.c.rpc("assignment_resync", { p_room: 6 });
  assert(r4.error !== null, "assignment_resync must not be callable through PostgREST");
  assert(["42501", "PGRST202"].includes(r4.error!.code), `unexpected ${r4.error!.code}: ${r4.error!.message}`);
  // 임의 uid(비공개 spring 그룹장 지훈)로 상세+초대 URL 을 빼내던 경로
  const r5 = await anon().rpc("room_detail_json", { p_room: 9, p_uid: "00000000-0000-4000-8000-000000000004" });
  assert(r5.error !== null, "room_detail_json must not be callable by anon");
  assert(["42501", "PGRST202"].includes(r5.error!.code), `unexpected ${r5.error!.code}: ${r5.error!.message}`);
  const r6 = await u.c.rpc("room_transition_active", { p_room: 6, p_actor: u.id });
  assert(r6.error !== null, "room_transition_active must not be callable by authenticated");
  assert(["42501", "PGRST202"].includes(r6.error!.code), `unexpected ${r6.error!.code}: ${r6.error!.message}`);
});

dbTest("rooms_list/room_get through PostgREST for anon: 8 public rooms, aws detail", async () => {
  const a = anon();
  const list = await rpc<{ items: { slug: string }[]; tabCounts: Record<string, number> }>(a, "rooms_list", { p_scope: "public" });
  assertEquals(list.items.length, 8);
  assertEquals(list.tabCounts, { public: 8, mine: 0, created: 0 });
  const d = await rpc<{ slug: string; me: unknown; memberCount: number }>(a, "room_get", { p_slug: "aws" });
  assertEquals([d.slug, d.me, d.memberCount], ["aws", null, 4]);
});

dbTest("table writes: anon/authenticated hold no INSERT GRANT (0004 revoke, M-3) — 42501, not an RLS denial", async () => {
  const e1 = (await anon().from("tags").insert({ slug: "x" + RUN, label: "x", tone: "blue" })).error;
  assert(e1 !== null, "anon insert into tags must fail");
  assertEquals(e1!.code, "42501");
  assert(/permission denied for table/.test(e1!.message), e1!.message);   // RLS 거부는 "new row violates row-level security policy"
  const u = await member(8);
  const e2 = (await u.c.from("rooms").insert({ slug: "x" + RUN, title: "x", intro: "x", start_date: "2026-12-01", end_date: "2026-12-02", max_members: 2, leader_id: u.id })).error;
  assert(e2 !== null, "authenticated insert into rooms must fail");
  assertEquals(e2!.code, "42501");
  assert(/permission denied for table/.test(e2!.message), e2!.message);
});
