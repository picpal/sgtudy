// supabase/tests/node-upload-sql.test.ts — 0045 그림 업로드 티켓(node_upload_prepare·node_upload_commit·node_upload_ticket_open)
// 스펙 2026-10-23-md-images-attachments-design §3.3 · D21~D29. Storage 업로드는 storage.objects 에 직접 넣어 흉내(anon 업로드 = owner_id 없음, C0 실측)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const LEAF = "EC2 인스턴스 유형 정리";
const roundOf = async (q: Q, label: string) =>
  (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'aws' and n.parent_id is null and n.label = $1", [label])).id as string;
const memberSet = (q: Q, room: string, uid: string, sql: string) =>
  q(`update public.room_members set ${sql} where room_id = $1::bigint and user_id = $2::uuid`, [room, uid]);

type Prep = { name?: string; mime?: string; size?: number; replace?: boolean; slug?: string };
const prepare = (q: Q, node: string, o: Prep = {}) =>
  one(q, "select public.node_upload_prepare($1, $2::bigint, $3, $4, $5::bigint, $6) as r",
      [o.slug ?? "aws", node, o.name ?? "vpc.svg", o.mime ?? "image/svg+xml", o.size ?? 100, o.replace ?? false]).then((r) => r.r as Row);
const commit = (q: Q, id: string, dry = false, slug = "aws") =>
  one(q, "select public.node_upload_commit($1, $2::uuid, $3) as r", [slug, id, dry]).then((r) => r.r as Row);
/** anon PUT 흉내 — 실물 메타데이터(신고값과 다를 수 있다) */
const put = (q: Q, path: string, mime: string, size: number) =>
  q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, null, $2::jsonb)",
    [path, JSON.stringify({ mimetype: mime, size })]);
const open = async (q: Q, path: string) => (await one(q, "select public.node_upload_ticket_open($1) as v", [path])).v as boolean;
/** prepare → put(신고값 그대로) → commit */
async function upload(q: Q, node: string, o: Prep = {}) {
  const p = await prepare(q, node, o);
  await put(q, p.objectPath, p.contentType, p.size);
  return commit(q, p.uploadId);
}
async function asLeader(q: Q) {
  await setNow(q, "2026-10-12T03:00:00Z");
  const minsu = await uidOf(q, "민수");
  await asUser(q, minsu);
  return { aws: await roomId(q, "aws"), leaf: await nodeId(q, "aws", LEAF), minsu };
}

cases("node upload 0045 · prepare", db, [
  { name: "편집자 OK: 경로 n/{room}/{node}/{id}.svg · 만료 2h · 노드(회차 라벨) · 티켓 열림", run: async (q) => {
    const { aws, leaf } = await asLeader(q);
    const p = await prepare(q, leaf, { name: "3주차-VPC구성.svg" });
    assertEquals(p.objectPath, `n/${aws}/${leaf}/${p.uploadId}.svg`);
    assertEquals([p.fileName, p.contentType, p.size, p.replace], ["3주차-VPC구성.svg", "image/svg+xml", 100, false]);
    assertEquals([p.node.id, p.node.title, typeof p.node.round], [leaf, LEAF, "string"]);
    const exp = (await one(q, "select expires_at - created_at = interval '2 hours' as ok from public.node_upload_tickets where id = $1::uuid", [p.uploadId])).ok;
    assertEquals(exp, true);
    assertEquals(await open(q, p.objectPath), true);
    assertEquals((await one(q, "select public.node_doc_key_ok($1) as v", [p.objectPath])).v, true);   // 고아 정리 대상 키 모양
    const j = await prepare(q, leaf, { name: "a.JPEG", mime: "image/jpeg" });
    assert(j.objectPath.endsWith(".jpg"));                                       // 확장자는 정규형
  } },
  { name: "권한: 멤버 NOT_CURRICULUM_EDITOR · 다른 방 slug NODE_NOT_FOUND · 개인 PERSONAL_NODE · 보관 TASK_ARCHIVED · 종료 ROOM_NOT_EDITABLE", run: async (q) => {
    const { aws, leaf } = await asLeader(q);
    await expectFail(prepare(q, leaf, { slug: "spring" }), "NODE_NOT_FOUND");
    const cheolsu = await uidOf(q, "철수");
    await asUser(q, cheolsu);
    await expectFail(prepare(q, leaf), "NOT_CURRICULUM_EDITOR");
    const g = ((await one(q, "select public.personal_create('aws', $1, '그림 목표') as c", [await roundOf(q, "3주차")])).c as Row).createdId as string;
    await expectFail(prepare(q, g), "PERSONAL_NODE");
    await asUser(q, await uidOf(q, "민수"));
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [leaf]);
    await expectFail(prepare(q, leaf), "TASK_ARCHIVED");
    await q("update public.goal_nodes set archived_at = null where id = $1::bigint", [leaf]);
    await q("update public.rooms set status = 'ENDED' where id = $1::bigint", [aws]);
    await expectFail(prepare(q, leaf), "ROOM_NOT_EDITABLE");
  } },
  { name: "입력: PDF FILE_TYPE_NOT_ALLOWED · 이름 규칙 · 확장자 불일치 · 11MB · SVG 3MB · 0바이트", run: async (q) => {
    const { leaf } = await asLeader(q);
    await expectFail(prepare(q, leaf, { name: "a.pdf", mime: "application/pdf" }), "FILE_TYPE_NOT_ALLOWED");
    for (const bad of ["a b.svg", "a(1).svg", "a/b.svg", "a%20.svg", "a#.svg", "a[1].svg", "", "x".repeat(117) + ".svg"]) {
      await expectFail(prepare(q, leaf, { name: bad }), "VALIDATION_FAILED");
    }
    await expectFail(prepare(q, leaf, { name: "a.png" }), "VALIDATION_FAILED");                  // svg 형식인데 .png
    await expectFail(prepare(q, leaf, { name: "a", mime: "image/png" }), "VALIDATION_FAILED");   // 확장자 없음
    await expectFail(prepare(q, leaf, { name: "a.png", mime: "image/png", size: 10485761 }), "FILE_TOO_LARGE");
    await expectFail(prepare(q, leaf, { size: 3 * 1048576 }), "FILE_TOO_LARGE");
    await expectFail(prepare(q, leaf, { size: 0 }), "VALIDATION_FAILED");
    assertEquals((await prepare(q, leaf, { name: "a.png", mime: "image/png", size: 10485760 })).size, 10485760);
  } },
  { name: "같은 이름: 붙은 파일이 있으면 FILE_NAME_TAKEN · replace:true 면 통과", run: async (q) => {
    const { leaf } = await asLeader(q);
    await upload(q, leaf, { name: "vpc.svg" });
    await expectFail(prepare(q, leaf, { name: "vpc.svg" }), "FILE_NAME_TAKEN");
    assertEquals((await prepare(q, leaf, { name: "vpc.svg", replace: true })).replace, true);
  } },
  { name: "한도 20: 붙은 그림 + 내 열린 티켓 · replace 는 같은 이름만큼 빼고 센다 · 문서 5개는 그림 한도와 별개", run: async (q) => {
    const { aws, leaf, minsu } = await asLeader(q);
    for (let i = 0; i < 5; i++) {                                                   // 문서 5(웹)
      const fid = crypto.randomUUID(); const path = `n/${aws}/${leaf}/${fid}.pdf`;
      await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, '{\"size\":10,\"mimetype\":\"application/pdf\"}')", [path, minsu]);
      await one(q, "select public.node_file_register($1::bigint, $2, 'd.pdf', 'application/pdf', 10)", [leaf, path]);
      await one(q, "select public.node_files_set($1::bigint, (select array_agg(id) from public.files where node_id = $1::bigint and purpose = 'NODE_DOC' and status = 'READY')) as r", [leaf]);
    }
    for (let i = 0; i < 9; i++) await upload(q, leaf, { name: `g${i}.svg` });       // 붙은 그림 9
    await q("update public.node_upload_tickets set created_at = now() - interval '2 hours'");   // 시간당 60 과 섞이지 않게
    for (let i = 9; i < 19; i++) await upload(q, leaf, { name: `g${i}.svg` });      // 19
    await q("update public.node_upload_tickets set created_at = now() - interval '2 hours'");
    await prepare(q, leaf, { name: "g19.svg" });                                    // 19 + 열린 1 = 20
    await expectFail(prepare(q, leaf, { name: "g20.svg" }), "FILE_LIMIT_EXCEEDED");
    await prepare(q, leaf, { name: "g0.svg", replace: true });                      // 같은 이름 1개를 바꾸면 자리 1
  } },
  { name: "레이트리밋: 시간당 61번째 · 열린 11번째 RATE_LIMITED(retryAfterSec) · 1일 지난 내 티켓은 지운다", run: async (q) => {
    const { leaf, minsu } = await asLeader(q);
    for (let i = 0; i < 10; i++) await prepare(q, leaf, { name: `o${i}.svg` });
    await expectFail(prepare(q, leaf, { name: "o10.svg" }), "RATE_LIMITED");          // 열린 11번째
    await q("update public.node_upload_tickets set committed_at = now()");          // 열린 것 0 · 시간당 10
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 10; j++) await prepare(q, leaf, { name: `h${i}-${j}.svg` });
      await q("update public.node_upload_tickets set committed_at = now()");
    }                                                                                // 시간당 60
    await expectFail(prepare(q, leaf, { name: "h-last.svg" }), "RATE_LIMITED");
    await q("update public.node_upload_tickets set created_at = now() - interval '25 hours' where user_id = $1::uuid", [minsu]);
    await prepare(q, leaf, { name: "fresh.svg" });
    assertEquals((await one(q, "select count(*)::int as n from public.node_upload_tickets where user_id = $1::uuid", [minsu])).n, 1);
  } },
]);

cases("node upload 0045 · commit", db, [
  { name: "객체 없음 FILE_NOT_READY · dry 는 행 없음 · 완료 → attached_at·READY·티켓 닫힘·이미지 목록", run: async (q) => {
    const { leaf, minsu } = await asLeader(q);
    const p = await prepare(q, leaf, { name: "vpc.svg", size: 300 });
    await expectFail(commit(q, p.uploadId), "FILE_NOT_READY");
    await put(q, p.objectPath, "image/svg+xml", 250);                               // 신고 300, 실물 250
    const d = await commit(q, p.uploadId, true);
    assertEquals([d.dry, d.objectPath, d.contentType, d.size], [true, p.objectPath, "image/svg+xml", 250]);
    assertEquals((await one(q, "select count(*)::int as n from public.files where id = $1::uuid", [p.uploadId])).n, 0);
    assertEquals(await open(q, p.objectPath), true);                                // dry 는 티켓을 닫지 않는다
    const c = await commit(q, p.uploadId);
    assertEquals([c.file.id, c.file.name, c.file.size, c.replayed, c.replaced, c.images], [p.uploadId, "vpc.svg", 250, false, [], ["vpc.svg"]]);
    const f = await one(q, "select status, purpose, attached_at is not null as att, owner_user_id::text as o from public.files where id = $1::uuid", [p.uploadId]);
    assertEquals([f.status, f.purpose, f.att, f.o], ["READY", "NODE_DOC", true, minsu]);
    assertEquals(await open(q, p.objectPath), false);
    assertEquals((await one(q, "select public.node_doc_object_readable($1) as v", [p.objectPath])).v, true);   // 이제 기존 읽기 정책
  } },
  { name: "재호출 replayed(dry 여도) · 남의 티켓 UPLOAD_NOT_FOUND · 3h 지남 UPLOAD_EXPIRED", run: async (q) => {
    const { leaf } = await asLeader(q);
    const c = await upload(q, leaf);
    const id = c.file.id as string;
    const r = await commit(q, id);
    assertEquals([r.replayed, r.file.id, r.images], [true, id, ["vpc.svg"]]);
    assertEquals((await commit(q, id, true)).replayed, true);
    await expectFail(commit(q, id, false, "spring"), "UPLOAD_NOT_FOUND");
    await expectFail(commit(q, crypto.randomUUID()), "UPLOAD_NOT_FOUND");
    const p = await prepare(q, leaf, { name: "late.svg" });
    await put(q, p.objectPath, "image/svg+xml", 100);
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(commit(q, p.uploadId), "UPLOAD_NOT_FOUND");                    // 완료는 티켓 주인만
    await asUser(q, await uidOf(q, "민수"));
    await q("update public.node_upload_tickets set created_at = now() - interval '3 hours 1 minute' where id = $1::uuid", [p.uploadId]);
    await expectFail(commit(q, p.uploadId), "UPLOAD_EXPIRED");
  } },
  { name: "실물 검사: MIME 다름 FILE_TYPE_NOT_ALLOWED · SVG 2MB 초과·10MB 초과 FILE_TOO_LARGE", run: async (q) => {
    const { leaf } = await asLeader(q);
    const a = await prepare(q, leaf, { name: "a.png", mime: "image/png" });
    await put(q, a.objectPath, "image/gif", 100);
    await expectFail(commit(q, a.uploadId), "FILE_TYPE_NOT_ALLOWED");
    const b = await prepare(q, leaf, { name: "b.svg" });
    await put(q, b.objectPath, "image/svg+xml", 2097153);
    await expectFail(commit(q, b.uploadId), "FILE_TOO_LARGE");
    const c = await prepare(q, leaf, { name: "c.png", mime: "image/png" });
    await put(q, c.objectPath, "image/png", 10485761);
    await expectFail(commit(q, c.uploadId), "FILE_TOO_LARGE");
  } },
  { name: "replace: 같은 이름 붙은 파일 DELETED → 새 파일이 이름을 잇는다 · 비 replace 는 그 사이 생긴 같은 이름에 FILE_NAME_TAKEN", run: async (q) => {
    const { leaf } = await asLeader(q);
    const first = await upload(q, leaf, { name: "vpc.svg" });
    const p = await prepare(q, leaf, { name: "vpc.svg", replace: true });
    await put(q, p.objectPath, "image/svg+xml", 120);
    const c = await commit(q, p.uploadId);
    assertEquals([c.replaced, c.images], [[first.file.id], ["vpc.svg"]]);
    assertEquals((await one(q, "select status from public.files where id = $1::uuid", [first.file.id])).status, "DELETED");
    const x = await prepare(q, leaf, { name: "x.svg" }); const y = await prepare(q, leaf, { name: "x.svg" });
    await put(q, x.objectPath, "image/svg+xml", 1); await put(q, y.objectPath, "image/svg+xml", 1);
    await commit(q, x.uploadId);
    await expectFail(commit(q, y.uploadId), "FILE_NAME_TAKEN");
  } },
  { name: "방 종료·권한 회수 뒤 완료 거부 · 한도 재검사(웹이 그 사이 채움)", run: async (q) => {
    const { aws, leaf } = await asLeader(q);
    const p = await prepare(q, leaf);
    await put(q, p.objectPath, "image/svg+xml", 1);
    await q("update public.rooms set status = 'ENDED' where id = $1::bigint", [aws]);
    await expectFail(commit(q, p.uploadId), "ROOM_NOT_EDITABLE");
    await q("update public.rooms set status = 'ACTIVE' where id = $1::bigint", [aws]);
    const jieun = await uidOf(q, "지은");
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    await asUser(q, jieun);
    const j = await prepare(q, leaf, { name: "j.svg" });
    await put(q, j.objectPath, "image/svg+xml", 1);
    await memberSet(q, aws, jieun, "can_edit_curriculum = false");
    await expectFail(commit(q, j.uploadId), "NOT_CURRICULUM_EDITOR");
    // 한도: 붙은 그림 20 을 직접 만든 뒤 남은 티켓 완료
    await asUser(q, await uidOf(q, "민수"));
    await q(`insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes, status, attached_at)
             select g.id, $1::uuid, $2::bigint, $3::bigint, 'NODE_DOC', 'n/' || $2 || '/' || $3 || '/' || g.id || '.png', 'w' || g.i || '.png', 'image/png', 1, 'READY', now()
             from (select gen_random_uuid() as id, i from generate_series(1, 20) i) g`, [await uidOf(q, "민수"), aws, leaf]);
    await expectFail(commit(q, p.uploadId), "FILE_LIMIT_EXCEEDED");
  } },
]);

cases("node upload 0045 · ticket policy · grants", db, [
  { name: "node_upload_ticket_open: 열린 것만 true — 완료·만료·다른 경로 false", run: async (q) => {
    const { leaf } = await asLeader(q);
    const a = await prepare(q, leaf, { name: "a.svg" }); const b = await prepare(q, leaf, { name: "b.svg" });
    assertEquals(await open(q, a.objectPath), true);
    assertEquals(await open(q, a.objectPath.replace(/[0-9a-f]{8}-/, "00000000-")), false);
    await q("update public.node_upload_tickets set expires_at = now() - interval '1 second' where id = $1::uuid", [b.uploadId]);
    assertEquals(await open(q, b.objectPath), false);
    await put(q, a.objectPath, "image/svg+xml", 1);
    await commit(q, a.uploadId);
    assertEquals(await open(q, a.objectPath), false);
  } },
  { name: "RLS(실제 anon 역할): 열린 티켓 경로만 INSERT·SELECT, 다른 경로·완료 뒤엔 거부 · 표는 anon/authenticated 에 닫힘", run: async (q) => {
    const { aws, leaf } = await asLeader(q);
    const a = await prepare(q, leaf, { name: "a.svg" });
    for (const role of ["anon", "authenticated"]) {
      assertEquals((await one(q, "select has_table_privilege($1, 'public.node_upload_tickets', 'select') as v", [role])).v, false, role);
    }
    await q("grant usage on schema storage, auth to anon, authenticated");
    await q("grant select, insert on storage.objects to anon, authenticated");
    await q("grant select on all tables in schema public to anon, authenticated");
    try {
      await asAnon(q);
      await q("set local role anon");
      await q("insert into storage.objects (bucket_id, name, metadata) values ('attachments', $1, '{\"mimetype\":\"image/svg+xml\",\"size\":1}')", [a.objectPath]);
      await expectFail(q("insert into storage.objects (bucket_id, name) values ('attachments', $1)", [`n/${aws}/${leaf}/${crypto.randomUUID()}.svg`]), "row-level security");
      assertEquals((await q("select name from storage.objects where name like 'n/%'")).map((r) => r.name), [a.objectPath]);
      assertEquals(await q("select id from public.node_upload_tickets"), []);         // RLS on · 정책 없음(GRANT 가 있어도)
    } finally { await q("reset role"); }
    await q("revoke select on all tables in schema public from anon, authenticated");
    await asUser(q, await uidOf(q, "민수"));
    await commit(q, a.uploadId);
    try {
      await asAnon(q);
      await q("set local role anon");
      assertEquals(await q("select name from storage.objects where name like 'n/%'"), []);   // 완료되면 anon 읽기 닫힘
    } finally { await q("reset role"); }
  } },
  { name: "GRANT: ticket_open 만 anon·authenticated · prepare·commit·core 는 닫힘 · 3인자 node_files_set 은 authenticated", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).ok;
    assertEquals(await can("anon", "public.node_upload_ticket_open(text)"), true);
    assertEquals(await can("authenticated", "public.node_upload_ticket_open(text)"), true);
    for (const fn of ["public.node_upload_prepare(text,bigint,text,text,bigint,boolean)", "public.node_upload_commit(text,uuid,boolean)",
                      "public.node_files_set_core(bigint,uuid[],uuid[])", "public.node_files_limit_check(uuid[])",
                      "public.node_image_limit()", "public.node_image_mime_types()", "public.node_doc_mime_types()"]) {
      assertEquals(await can("anon", fn), false, fn);
      assertEquals(await can("authenticated", fn), false, fn);
    }
    assertEquals(await can("authenticated", "public.node_files_set(bigint,uuid[],uuid[])"), true);
    assertEquals(await can("anon", "public.node_files_set(bigint,uuid[],uuid[])"), false);
  } },
]);
