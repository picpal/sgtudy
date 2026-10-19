// 로컬 supabase 에 실제 Storage 객체·files 행을 만들고 runCleanup(supabaseStore) 으로 정리되는지 본다.
//   eval "$(supabase status -o env)"; SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY deno test -A --config deno.json
// env 가 없으면 ignore. 실제 RPC·Storage·delete 를 쓰되 후보는 이 테스트가 만든 행으로만 거른다(공유 로컬 DB 의 다른 행은 건드리지 않는다).
// 만든 행·객체는 끝나면 지운다. 0019 가 로컬 DB 에 적용돼 있어야 한다(file_purge_candidates).
import { assertEquals } from "@std/assert";
import { createClient } from "supabase-js";
import { runCleanup, runOrphanCleanup, type Store, supabaseStore } from "./cleanup.ts";

const URL = Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.test({ name: "integration: DELETED(유예 지남) 객체·행 정리, 이미 없는 객체도 성공, 유예 안·READY 는 그대로, 재실행 멱등", ignore: !(URL && KEY), fn: async () => {
  const db = createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: owner, error: oe } = await db.from("profiles").select("id").limit(1).single();
  if (oe) throw oe;
  const run = "cleanup-it/" + crypto.randomUUID().slice(0, 8);
  const mk = (tag: string) => ({ id: crypto.randomUUID(), tag });
  const [gone, missing, fresh, ready] = [mk("gone"), mk("missing"), mk("fresh"), mk("ready")];
  const path = (f: { id: string }) => `${run}/${f.id}.txt`;
  const old = new Date(Date.now() - 2 * 3600_000).toISOString();
  const now = new Date().toISOString();

  for (const f of [gone, fresh, ready]) {
    const { error } = await db.storage.from("attachments").upload(path(f), new Blob(["x"], { type: "text/plain" }), { contentType: "text/plain" });
    if (error) throw error;
  }
  const row = (f: { id: string }, status: string, deleted_at: string | null) => ({
    id: f.id, owner_user_id: owner.id, purpose: "ATTACHMENT", bucket_id: "attachments", object_path: path(f),
    original_name: "it.txt", content_type: "text/plain", size_bytes: 1, status, deleted_at,
  });
  const { error: ie } = await db.from("files").insert([
    row(gone, "DELETED", old), row(missing, "DELETED", old), row(fresh, "DELETED", now), row(ready, "READY", null),
  ]);
  if (ie) throw ie;

  const mine = new Set<string>([gone.id, missing.id, fresh.id, ready.id]);
  const real = supabaseStore(db);
  const scoped: Store = { ...real, selectDeleted: async (limit) => (await real.selectDeleted(limit)).filter((r) => mine.has(r.id)) };
  try {
    const r = await runCleanup(scoped, { limit: 1000 });
    assertEquals(r.errors, []);
    assertEquals(r.failed, 0);
    assertEquals([r.selected, r.removed, r.rowsDeleted], [2, 2, 2]);

    const { data: left } = await db.from("files").select("id").in("id", [gone.id, missing.id, fresh.id, ready.id]);
    assertEquals(new Set(left!.map((x) => x.id)), new Set([fresh.id, ready.id]));
    const { data: objs } = await db.storage.from("attachments").list(run);
    assertEquals(new Set(objs!.map((o) => o.name)), new Set([`${fresh.id}.txt`, `${ready.id}.txt`]));

    const again = await runCleanup(scoped, { limit: 1000 });   // 멱등: 남은 대상 없음
    assertEquals([again.selected, again.errors], [0, []]);
  } finally {
    await db.from("files").delete().in("id", [gone.id, missing.id, fresh.id, ready.id]);
    await db.storage.from("attachments").remove([gone, missing, fresh, ready].map(path));
  }
} });

// 0031: 실제 Storage 객체의 created_at 은 API 로 과거로 돌릴 수 없다 → 방금 올린 고아(유예 안)는 후보가 아니고,
//       runOrphanCleanup 이 고른 것만 지운다는 것만 본다(유예 지난 경우는 supabase/tests/orphan-objects-sql.test.ts 가 PGlite 로).
Deno.test({ name: "integration: file_orphan_candidates RPC 동작, 방금 올린 미등록 객체(유예 24h 안)는 고르지 않고 남긴다", ignore: !(URL && KEY), fn: async () => {
  const db = createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const key = `n/1/1/${crypto.randomUUID()}.txt`;
  const { error } = await db.storage.from("attachments").upload(key, new Blob(["x"], { type: "text/plain" }), { contentType: "text/plain" });
  if (error) throw error;
  const real = supabaseStore(db);
  try {
    const cands = await real.selectOrphans(1000);
    assertEquals(cands.some((c) => c.object_path === key), false);
    const scoped: Store = { ...real, selectOrphans: async (limit) => (await real.selectOrphans(limit)).filter((c) => c.object_path === key) };
    const r = await runOrphanCleanup(scoped, { limit: 1000 });
    assertEquals([r.selected, r.removed, r.errors], [0, 0, []]);
    const { data } = await db.storage.from("attachments").list(key.slice(0, key.lastIndexOf("/")));
    assertEquals(data!.some((o) => key.endsWith(o.name)), true);
  } finally {
    await db.storage.from("attachments").remove([key]);
  }
} });
