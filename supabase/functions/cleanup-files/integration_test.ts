// 로컬 supabase 에 실제 Storage 객체·files 행을 만들고 runCleanup(supabaseStore) 으로 정리되는지 본다.
//   eval "$(supabase status -o env)"; SUPABASE_URL=$API_URL SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY deno test -A --config deno.json
// env 가 없으면 ignore. 만든 행·객체는 끝나면 지운다. (유예가 지난 다른 DELETED 행도 함께 정리된다 — 이 함수의 실제 동작)
import { assert, assertEquals } from "@std/assert";
import { createClient } from "supabase-js";
import { runCleanup, supabaseStore } from "./cleanup.ts";

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

  try {
    const r = await runCleanup(supabaseStore(db), { now: new Date(), limit: 1000 });
    assertEquals(r.errors, []);
    assertEquals(r.failed, 0);
    assert(r.rowsDeleted >= 2, JSON.stringify(r));

    const { data: left } = await db.from("files").select("id").in("id", [gone.id, missing.id, fresh.id, ready.id]);
    assertEquals(new Set(left!.map((x) => x.id)), new Set([fresh.id, ready.id]));
    const { data: objs } = await db.storage.from("attachments").list(run);
    assertEquals(new Set(objs!.map((o) => o.name)), new Set([`${fresh.id}.txt`, `${ready.id}.txt`]));

    const again = await runCleanup(supabaseStore(db), { now: new Date(), limit: 1000 });   // 멱등: 남은 대상 없음
    assertEquals([again.selected, again.errors], [0, []]);
  } finally {
    await db.from("files").delete().in("id", [gone.id, missing.id, fresh.id, ready.id]);
    await db.storage.from("attachments").remove([gone, missing, fresh, ready].map(path));
  }
} });
