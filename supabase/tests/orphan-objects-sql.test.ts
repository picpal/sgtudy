// supabase/tests/orphan-objects-sql.test.ts — 0031: files 행이 없는 Storage 고아 객체 후보(file_orphan_candidates), 유예 file_orphan_grace
import { assertEquals } from "@std/assert";
import { applySeed, openDb } from "./_harness.ts";
import { cases, one, type Q } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const sub = () => `1/2/${crypto.randomUUID()}/${crypto.randomUUID()}.png`;   // 제출 첨부 키
const doc = () => `n/1/2/${crypto.randomUUID()}.pdf`;                         // 항목 첨부 키(0030)

async function object(q: Q, name: string, ago: string, bucket = "attachments") {
  await q("insert into storage.objects (bucket_id, name, owner_id, created_at) values ($1, $2, null, now() - $3::interval)",
          [bucket, name, ago]);
}
async function fileRow(q: Q, path: string, status: string) {
  const owner = (await one(q, "select id from public.profiles limit 1")).id;
  await q(`insert into public.files (id, owner_user_id, purpose, bucket_id, object_path, original_name, content_type, size_bytes, status, deleted_at)
           values (gen_random_uuid(), $1, 'ATTACHMENT', 'attachments', $2, 'a.png', 'image/png', 1, $3::text,
                   case when $3::text = 'DELETED' then now() end)`, [owner, path, status]);
}
const candidates = async (q: Q, limit = 1000) =>
  (await q("select bucket_id, object_path from public.file_orphan_candidates($1)", [limit])).map((r) => r.object_path as string);

cases("orphan-objects", db, [
  { name: "file_orphan_grace() = 24 hours", run: async (q) => {
    assertEquals((await one(q, "select public.file_orphan_grace() = interval '24 hours' as ok")).ok, true);
  } },

  { name: "유예 지난 미등록 객체(제출·항목 키)만 후보, 오래된 순; 유예 안·등록됨(READY/DELETED)·다른 버킷·모르는 키 모양은 제외", run: async (q) => {
    await q("insert into storage.buckets (id, name) values ('covers', 'covers') on conflict do nothing");
    const [oldSub, oldDoc, fresh, ready, deleted, other, weird] = [sub(), doc(), doc(), sub(), doc(), sub(), "misc/readme.txt"];
    await object(q, oldSub, "3 days");
    await object(q, oldDoc, "25 hours");
    await object(q, fresh, "23 hours");
    await object(q, ready, "3 days");    await fileRow(q, ready, "READY");
    await object(q, deleted, "3 days");  await fileRow(q, deleted, "DELETED");   // 행이 있으면 purge 경로가 맡는다
    await object(q, other, "3 days", "covers");
    await object(q, weird, "3 days");
    const got = await candidates(q);
    const mine = [oldSub, oldDoc, fresh, ready, deleted, other, weird];
    assertEquals(got.filter((p) => mine.includes(p)), [oldSub, oldDoc]);
    const rows = await q("select bucket_id, object_path from public.file_orphan_candidates(1000) where object_path = $1", [oldDoc]);
    assertEquals(rows, [{ bucket_id: "attachments", object_path: oldDoc }]);
  } },

  { name: "limit: 1~1000 로 자르고 null 은 기본값", run: async (q) => {
    for (let i = 0; i < 3; i++) await object(q, sub(), `${2 + i} days`);
    assertEquals((await candidates(q, 1)).length, 1);
    assertEquals((await candidates(q, 0)).length, 1);
    assertEquals((await q("select * from public.file_orphan_candidates(null)")).length >= 3, true);
  } },

  { name: "권한: service_role 만 실행(anon·authenticated·public 불가), 둘 다 security definer · search_path ''", run: async (q) => {
    const can = async (role: string, fn: string) =>
      (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    const c = "public.file_orphan_candidates(integer)";
    assertEquals([await can("anon", c), await can("authenticated", c), await can("service_role", c)], [false, false, true]);
    assertEquals([await can("anon", "public.file_orphan_grace()"), await can("authenticated", "public.file_orphan_grace()")], [false, false]);
    const meta = await one(q, `select p.prosecdef as sd, p.proconfig as cfg from pg_proc p
                               where p.oid = 'public.file_orphan_candidates(integer)'::regprocedure`);
    assertEquals(meta.sd, true);
    assertEquals((meta.cfg as string[]).includes('search_path=""'), true);
  } },
]);
