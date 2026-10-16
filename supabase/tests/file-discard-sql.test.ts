// supabase/tests/file-discard-sql.test.ts — 0015 file_discard (task-submission 스펙 §1.7, R9)
import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);

/** Storage 업로드(storage.objects 스텁 행) + file_register. 반환: file id */
async function uploadedAndRegistered(q: Q, node: string, room: string, uid: string) {
  const fid = crypto.randomUUID();
  const path = `${room}/${node}/${uid}/${fid}.png`;
  await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
          [path, uid, JSON.stringify({ size: 10, mimetype: "image/png" })]);
  await one(q, "select public.file_register($1::bigint, $2, 'a.png', 'image/png', 10)", [node, path]);
  return fid;
}
const discard = (q: Q, fid: string) => one(q, "select public.file_discard($1::uuid) as r", [fid]).then((r) => r.r);
const statusOf = async (q: Q, fid: string) =>
  (await one(q, "select status, deleted_at is not null as gone from public.files where id = $1::uuid", [fid]));

cases("file_discard", db, [
  { name: "discarding an unattached upload frees a file_register slot; idempotent", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    const u = await uidOf(q, "철수"); const room = await roomId(q, "aws"); const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, u);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await uploadedAndRegistered(q, ec2, room, u));
    await expectFail(uploadedAndRegistered(q, ec2, room, u), "FILE_LIMIT_EXCEEDED");
    assertEquals(await discard(q, ids[0]), { id: ids[0], status: "deleted" });
    assertEquals(await statusOf(q, ids[0]), { status: "DELETED", gone: true });   // job_cleanup 과 같은 DELETED — cleanup-files 가 객체를 정리
    await uploadedAndRegistered(q, ec2, room, u);                                   // 자리가 났다
    assertEquals(await discard(q, ids[0]), { id: ids[0], status: "deleted" });     // 멱등
  } },
  { name: "attached files are refused (FILE_ATTACHED) and stay READY; others' files are NOT_FOUND and untouched", run: async (q) => {
    const u = await uidOf(q, "철수"); const room = await roomId(q, "aws"); const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, u);
    const attached = await uploadedAndRegistered(q, ec2, room, u);
    const loose = await uploadedAndRegistered(q, ec2, room, u);
    await submit(q, ec2, "첨부", [], [attached]);
    await expectFail(discard(q, attached), "FILE_ATTACHED");
    assertEquals((await statusOf(q, attached)).status, "READY");
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(discard(q, attached), "NOT_FOUND");
    await expectFail(discard(q, loose), "NOT_FOUND");
    assertEquals((await statusOf(q, loose)).status, "READY");
    await expectFail(discard(q, crypto.randomUUID()), "NOT_FOUND");
  } },
  { name: "anon → AUTH_REQUIRED; EXECUTE granted to authenticated only", run: async (q) => {
    await asAnon(q);
    await expectFail(discard(q, crypto.randomUUID()), "AUTH_REQUIRED");
    const can = async (role: string) =>
      (await one(q, "select has_function_privilege($1, 'public.file_discard(uuid)', 'execute') as ok", [role])).ok;
    assertEquals(await can("authenticated"), true);
    assertEquals(await can("anon"), false);
  } },
]);
