import { assert, assertEquals } from "@std/assert";
import { anon, dbTest, service } from "./_testenv.ts";

// 실제 PostgREST 에서만 보이는 것: 공개/비공개 RPC 의 GRANT 경계(시드 행은 읽기만).

dbTest("curriculum rpc: anon 은 curriculum_get 은 읽고, me_studies·me_schedule·curriculum_json 은 막힌다 (D7)", async () => {
  const a = anon();
  const { data, error } = await a.rpc("curriculum_get", { p_slug: "aws" });
  assertEquals(error, null);
  assertEquals((data as { members: unknown[] }).members.length, 5);

  assertEquals((await a.rpc("me_studies")).error?.code, "42501");
  assertEquals((await a.rpc("me_schedule", { p_from: "2026-10-01", p_to: "2026-10-31" })).error?.code, "42501");

  const { data: prof, error: e0 } = await service().from("profiles").select("id").eq("nickname", "지훈").single();
  assertEquals(e0, null);
  const { error: e1 } = await a.rpc("curriculum_json", { p_room: 9, p_uid: prof!.id, p_include_archived: true });
  assert(e1 !== null && ["42501", "PGRST202"].includes(e1.code), `curriculum_json: ${e1?.code}`);
});
