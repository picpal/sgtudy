// supabase/tests/cleanup-files-sql.test.ts — 0019: 정리 유예(file_purge_grace) 한 곳 정의, 정리 후보(file_purge_candidates),
// file_register 가 유예 지난 DELETED 행을 되살리지 않음(cleanup-files 와의 경쟁 제거)
import { assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

async function uploaded(q: Q, path: string, owner: string) {
  await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
          [path, owner, JSON.stringify({ size: 10, mimetype: "image/png" })]);
}
const register = (q: Q, node: string, path: string) =>
  one(q, "select public.file_register($1::bigint, $2, 'a.png', 'image/png', 10) as f", [node, path]).then((r) => r.f);
const statusOf = async (q: Q, fid: string) =>
  (await one(q, "select status from public.files where id = $1::uuid", [fid])).status;

async function registeredThenDeleted(q: Q, deletedAgo: string) {
  const u = await uidOf(q, "철수"); const room = await roomId(q, "aws"); const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
  await asUser(q, u);
  const fid = crypto.randomUUID();
  const path = `${room}/${ec2}/${u}/${fid}.png`;
  await uploaded(q, path, u);
  await register(q, ec2, path);
  await q("update public.files set status = 'DELETED', deleted_at = now() - $2::interval where id = $1::uuid", [fid, deletedAgo]);
  return { fid, path, ec2 };
}

cases("cleanup-files", db, [
  { name: "file_purge_grace() = 1 hour (cleanup-files 와 file_register 가 같은 값을 쓴다)", run: async (q) => {
    assertEquals((await one(q, "select public.file_purge_grace() = interval '1 hour' as ok")).ok, true);
  } },

  { name: "file_register: 유예 안의 DELETED 행(같은 경로)은 그대로 되살린다", run: async (q) => {
    const { fid, path, ec2 } = await registeredThenDeleted(q, "59 minutes");
    assertEquals((await register(q, ec2, path)).status, "ready");
    assertEquals(await statusOf(q, fid), "READY");
  } },

  { name: "file_register: 유예 지난 DELETED 행은 되살리지 않는다 → FILE_NOT_READY(fileId), 행은 DELETED 그대로", run: async (q) => {
    const { fid, path, ec2 } = await registeredThenDeleted(q, "61 minutes");
    await expectFail(register(q, ec2, path), "FILE_NOT_READY");
    assertEquals(await statusOf(q, fid), "DELETED");
  } },

  { name: "file_purge_candidates: 유예 지난 DELETED 만, 오래된 순, limit; service_role 만 실행", run: async (q) => {
    const a = await registeredThenDeleted(q, "3 hours");
    const b = await registeredThenDeleted(q, "2 hours");
    const fresh = await registeredThenDeleted(q, "10 minutes");
    const rows = await q("select id::text, bucket_id, object_path from public.file_purge_candidates(1000)");
    const ids = rows.map((r) => r.id as string);
    assertEquals(ids.indexOf(a.fid) < ids.indexOf(b.fid) && ids.indexOf(a.fid) >= 0, true);
    assertEquals(ids.includes(fresh.fid), false);
    assertEquals(rows.find((r) => r.id === a.fid), { id: a.fid, bucket_id: "attachments", object_path: a.path });
    const st = await q("select count(*)::int as n from public.files where status <> 'DELETED' and id = any($1::uuid[])", [`{${ids.join(",")}}`]);
    assertEquals(st[0].n, 0);
    assertEquals((await q("select * from public.file_purge_candidates(1)")).length, 1);
    const can = async (role: string) =>
      (await one(q, "select has_function_privilege($1, 'public.file_purge_candidates(integer)', 'execute') as v", [role])).v;
    assertEquals([await can("anon"), await can("authenticated"), await can("service_role")], [false, false, true]);
  } },
]);
