// supabase/tests/orphan-objects-sql.test.ts — 0031: files 행이 없는 Storage 고아 객체 후보(file_orphan_candidates), 유예 file_orphan_grace,
// file_register·node_file_register 의 등록 경합 차단(행 없는 객체가 유예−1h 보다 오래되면 FILE_NOT_READY)
import { assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q } from "./_fixtures.ts";

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
  { name: "PENDING 행이 있는 객체도 제외(상태 무관), 다른 버킷 행이 같은 경로면 제외(버킷 무관 비교)", run: async (q) => {
    const [pending, crossBucket] = [sub(), doc()];
    await object(q, pending, "3 days");     await fileRow(q, pending, "PENDING");
    await object(q, crossBucket, "3 days");
    const owner = (await one(q, "select id from public.profiles limit 1")).id;
    await q(`insert into public.files (id, owner_user_id, purpose, bucket_id, object_path, original_name, content_type, size_bytes, status)
             values (gen_random_uuid(), $1, 'ATTACHMENT', 'covers', $2, 'a.pdf', 'application/pdf', 1, 'READY')`, [owner, crossBucket]);
    const got = await candidates(q);
    assertEquals([got.includes(pending), got.includes(crossBucket)], [false, false]);
  } },

  { name: "거의 맞는 키는 제외: 대문자 UUID, 앞자리 0 세그먼트, 세그먼트 수 틀림(제출 3·5개, n/ 뒤 4개), 대문자 확장자", run: async (q) => {
    const u = () => crypto.randomUUID();
    const near = [
      `1/2/${u().toUpperCase()}/${u()}.png`, `1/2/${u()}/${u().toUpperCase()}.png`, `n/1/2/${u().toUpperCase()}.pdf`,
      `01/2/${u()}/${u()}.png`, `1/02/${u()}/${u()}.png`, `n/01/2/${u()}.pdf`, `n/1/0/${u()}.pdf`,
      `1/${u()}/${u()}.png`, `1/2/3/${u()}/${u()}.png`, `n/1/2/3/${u()}.pdf`, `n/1/${u()}.pdf`,
      `1/2/${u()}/${u()}.PNG`,
    ];
    for (const k of near) await object(q, k, "3 days");
    const ok = sub(); await object(q, ok, "3 days");                 // 대조군: 맞는 키는 고른다
    const got = await candidates(q);
    assertEquals(near.filter((k) => got.includes(k)), []);
    assertEquals(got.includes(ok), true);
  } },

  // ───────── 등록 경합 차단(R1) ─────────
  { name: "file_register: 행 없는 객체가 23h 이하면 등록, 23h 넘으면 FILE_NOT_READY; 이미 행 있는 오래된 객체 재등록은 그대로", run: async (q) => {
    const u = await uidOf(q, "철수"); const room = await roomId(q, "aws"); const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, u);
    const put = async (ago: string) => {
      const path = `${room}/${ec2}/${u}/${crypto.randomUUID()}.png`;
      await q("insert into storage.objects (bucket_id, name, owner_id, metadata, created_at) values ('attachments', $1, $2, $3::jsonb, now() - $4::interval)",
              [path, u, JSON.stringify({ size: 10, mimetype: "image/png" }), ago]);
      return path;
    };
    const reg = (path: string) => one(q, "select public.file_register($1::bigint, $2, 'a.png', 'image/png', 10) as f", [ec2, path]).then((r) => r.f);
    assertEquals((await reg(await put("22 hours 59 minutes"))).status, "ready");
    await expectFail(reg(await put("23 hours 30 minutes")), "FILE_NOT_READY");
    const again = await put("1 minute");
    await reg(again);
    await q("update storage.objects set created_at = now() - interval '3 days' where name = $1", [again]);
    assertEquals((await reg(again)).status, "ready");                    // 행이 있으면 0031 검사 대상 아님(on conflict 갱신)
    assertEquals((await candidates(q)).includes(again), false);
  } },

  { name: "node_file_register: 행 없는 객체가 23h 이하면 등록, 23h 넘으면 FILE_NOT_READY; 이미 행 있는 오래된 객체 재등록은 그대로", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", "EC2 인스턴스 유형 정리"); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const put = async (ago: string) => {
      const path = `n/${aws}/${leaf}/${crypto.randomUUID()}.pdf`;
      await q("insert into storage.objects (bucket_id, name, owner_id, metadata, created_at) values ('attachments', $1, $2, $3::jsonb, now() - $4::interval)",
              [path, minsu, JSON.stringify({ size: 10, mimetype: "application/pdf" }), ago]);
      return path;
    };
    const reg = (path: string) =>
      one(q, "select public.node_file_register($1::bigint, $2, 'a.pdf', 'application/pdf', 10) as f", [leaf, path]).then((r) => r.f);
    assertEquals((await reg(await put("22 hours 59 minutes"))).status, "ready");
    await expectFail(reg(await put("23 hours 30 minutes")), "FILE_NOT_READY");
    const again = await put("1 minute");
    await reg(again);
    await q("update storage.objects set created_at = now() - interval '3 days' where name = $1", [again]);
    assertEquals((await reg(again)).status, "ready");
  } },
]);

cases("orphan-objects · 0045 upload tickets", db, [
  { name: "완료 안 한 티켓 객체는 24h 뒤 후보 · 완료된 것은 행이 있어 후보 아님", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, await uidOf(q, "민수"));
    const leaf = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const prep = async (name: string) => (await one(q, "select public.node_upload_prepare('aws', $1::bigint, $2, 'image/png', 10, false) as r", [leaf, name])).r;
    const [left, done] = [await prep("left.png"), await prep("done.png")];
    for (const t of [left, done]) {
      await q("insert into storage.objects (bucket_id, name, owner_id, metadata, created_at) values ('attachments', $1, null, '{\"size\":10,\"mimetype\":\"image/png\"}', now() - interval '2 hours')", [t.objectPath]);
    }
    await one(q, "select public.node_upload_commit('aws', $1::uuid, false)", [done.uploadId]);
    await q("update storage.objects set created_at = now() - interval '25 hours' where name in ($1, $2)", [left.objectPath, done.objectPath]);
    const got = await candidates(q);
    assertEquals([got.includes(left.objectPath), got.includes(done.objectPath)], [true, false]);
  } },
]);
