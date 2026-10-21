import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);

/** Storage 업로드를 흉내 낸다(storage.objects 스텁 행). metadata.size 가 서버가 아는 크기 */
async function uploaded(q: Q, path: string, owner: string, size = 1234, mime = "image/png") {
  await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
          [path, owner, JSON.stringify({ size, mimetype: mime })]);
}
const register = (q: Q, node: string, path: string, name: string, mime: string, size: number) =>
  one(q, "select public.file_register($1::bigint, $2, $3, $4, $5::bigint) as f", [node, path, name, mime, size]).then((r) => r.f);

cases("files", db, [
  { name: "file_register: READY row from an uploaded object; size comes from storage metadata", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    const fid = crypto.randomUUID();
    const path = `${room}/${ec2}/${cheolsu}/${fid}.png`;                     // 원본명(한글)은 키에 넣지 않는다
    await uploaded(q, path, cheolsu, 4096);
    const f = await register(q, ec2, path, "노트.png", "image/png", 1234);
    assertEquals(f, { id: fid, name: "노트.png", contentType: "image/png", size: 4096, status: "ready" });
    // 같은 파일을 다시 등록해도 멱등
    assertEquals((await register(q, ec2, path, "노트.png", "image/png", 1234)).id, fid);

    const s = await submit(q, ec2, "첨부 있음", [], [fid]);
    assertEquals(s.files.length, 1);
    assertEquals(s.files[0].id, fid);
    // 다음 제출에서 빼면 soft delete 되고 목록에서 사라진다
    const s2 = await submit(q, ec2, "첨부 뺌", [], []);
    assertEquals(s2.files, []);
    const row = await one(q, "select status, (deleted_at is not null) as del, submission_id from public.files where id = $1::uuid", [fid]);
    assertEquals([row.status, row.del, row.submission_id], ["DELETED", true, null]);
  } },

  { name: "file_register: stored content_type is the Storage-recorded mimetype, not the client's claim (final review Minor 4)", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    const fid = crypto.randomUUID();
    const path = `${room}/${ec2}/${cheolsu}/${fid}.png`;
    await uploaded(q, path, cheolsu, 100, "image/png");
    const f = await register(q, ec2, path, "a.png", "text/plain", 100);       // 클라이언트는 text/plain(허용 목록 안)이라 주장
    assertEquals(f.contentType, "image/png");
    assertEquals((await one(q, "select content_type from public.files where id = $1::uuid", [fid])).content_type, "image/png");
    const bad = crypto.randomUUID();
    const badPath = `${room}/${ec2}/${cheolsu}/${bad}.png`;
    await uploaded(q, badPath, cheolsu, 100, "text/html");                     // Storage 가 기록한 형식이 허용 밖이면 클라이언트 값과 무관하게 거절
    await expectFail(register(q, ec2, badPath, "b.png", "image/png", 100), "FILE_TYPE_NOT_ALLOWED");
  } },

  { name: "file_register: on-conflict only for the same object_path; a different path on an existing id is NOT_FOUND and does not revive a DELETED row", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    const fid = crypto.randomUUID();
    const png = `${room}/${ec2}/${cheolsu}/${fid}.png`;
    await uploaded(q, png, cheolsu, 10);
    await register(q, ec2, png, "a.png", "image/png", 10);
    await q("update public.files set status = 'DELETED', deleted_at = now() where id = $1::uuid", [fid]);
    const jpg = `${room}/${ec2}/${cheolsu}/${fid}.jpg`;                        // 같은 id, 다른 확장자 = 다른 object_path
    await uploaded(q, jpg, cheolsu, 10, "image/jpeg");
    await expectFail(register(q, ec2, jpg, "a.jpg", "image/jpeg", 10), "NOT_FOUND");
    const row = await one(q, "select status, object_path from public.files where id = $1::uuid", [fid]);
    assertEquals([row.status, row.object_path], ["DELETED", png]);
  } },

  { name: "file_register: FILE_NOT_READY without object, FILE_TYPE_NOT_ALLOWED, FILE_TOO_LARGE, bad path, TASK_NOT_ASSIGNED", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    const fid = crypto.randomUUID();
    const path = `${room}/${ec2}/${cheolsu}/${fid}.pdf`;
    await expectFail(register(q, ec2, path, "a.pdf", "application/pdf", 10), "FILE_NOT_READY");
    await uploaded(q, path, cheolsu, 10, "application/pdf");
    await expectFail(register(q, ec2, path, "a.pdf", "text/html", 10), "FILE_TYPE_NOT_ALLOWED");
    await expectFail(register(q, ec2, path, "", "application/pdf", 10), "VALIDATION_FAILED");
    await expectFail(register(q, ec2, `${room}/${ec2}/${await uidOf(q, "지은")}/${fid}.pdf`, "a.pdf", "application/pdf", 10), "VALIDATION_FAILED");
    await expectFail(register(q, ec2, `${room}/${ec2}/${cheolsu}/not-a-uuid.pdf`, "a.pdf", "application/pdf", 10), "VALIDATION_FAILED");
    await expectFail(register(q, ec2, `${room}/${ec2}/${cheolsu}/${fid}-원본이름.pdf`, "a.pdf", "application/pdf", 10), "VALIDATION_FAILED");   // 옛 {uuid}-{name} 형식 거부

    const big = crypto.randomUUID();
    const bigPath = `${room}/${ec2}/${cheolsu}/${big}.zip`;
    await uploaded(q, bigPath, cheolsu, 10485761, "application/zip");
    await expectFail(register(q, ec2, bigPath, "big.zip", "application/zip", 10), "FILE_TOO_LARGE");

    await asUser(q, await uidOf(q, "가은"));
    await expectFail(register(q, ec2, path, "a.pdf", "application/pdf", 10), "TASK_NOT_ASSIGNED");
    await asAnon(q);   // 수퍼유저 + 빈 uid 경로. 실제 anon 은 GRANT 층에서 42501(D10)
    await expectFail(register(q, ec2, path, "a.pdf", "application/pdf", 10), "AUTH_REQUIRED");
  } },

  { name: "file_register: 6th in-flight file per user per node → FILE_LIMIT_EXCEEDED; orphans older than 24h don't count (S3)", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID();
      const p = `${room}/${ec2}/${cheolsu}/${id}.txt`;
      await uploaded(q, p, cheolsu, 10, "text/plain");
      await register(q, ec2, p, `${i}.txt`, "text/plain", 10);
      ids.push(id);
    }
    const id = crypto.randomUUID();
    const p = `${room}/${ec2}/${cheolsu}/${id}.txt`;
    await uploaded(q, p, cheolsu, 10, "text/plain");
    await expectFail(register(q, ec2, p, "6.txt", "text/plain", 10), "FILE_LIMIT_EXCEEDED");
    // 하나를 이틀 전 고아로 만들면(제출 미연결 READY, created_at 48h 전) 한도에서 빠진다
    await q("update public.files set created_at = now() - interval '48 hours' where id = $1::uuid", [ids[0]]);
    assertEquals((await register(q, ec2, p, "6.txt", "text/plain", 10)).id, id);
  } },

  { name: "submission_upsert re-checks storage: object removed after register → FILE_NOT_READY (S4)", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    const fid = crypto.randomUUID();
    const path = `${room}/${ec2}/${cheolsu}/${fid}.pdf`;
    await uploaded(q, path, cheolsu, 10, "application/pdf");
    await register(q, ec2, path, "보고서.pdf", "application/pdf", 10);
    await q("delete from storage.objects where name = $1", [path]);   // 객체가 사라진 상황(0036 이전엔 소유자 직접 삭제로 가능했다. 스텁 행 삭제는 테스트 전용)
    await expectFail(submit(q, ec2, "첨부", [], [fid]), "FILE_NOT_READY");
  } },

  { name: "bucket + policies from 0003 are what file_register relies on", run: async (q) => {
    const bk = await one(q, "select file_size_limit::text as lim, allowed_mime_types as m from storage.buckets where id = 'attachments'");
    assertEquals(bk.lim, "10485760");
    assertEquals((bk.m as string[]).length, 9);
    const mt = await one(q, "select public.allowed_mime_types() as m");
    assertEquals((mt.m as string[]).sort(), (bk.m as string[]).sort());
  } },
]);
