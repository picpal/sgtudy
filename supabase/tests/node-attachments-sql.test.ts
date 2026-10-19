// supabase/tests/node-attachments-sql.test.ts — 0030 진행목표 항목 첨부 (스펙 2026-10-19-node-attachments-design)
import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, newUser, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, uuids, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const LEAF = "EC2 인스턴스 유형 정리";
const b = async (q: Q, sql: string, p: unknown[]) => (await one(q, sql, p)).v as boolean;
const readable = (q: Q, node: string, uid: string) => b(q, "select public.node_doc_readable($1::bigint, $2::uuid) as v", [node, uid]);
const writable = (q: Q, node: string, uid: string) => b(q, "select public.node_doc_writable($1::bigint, $2::uuid) as v", [node, uid]);
const roundOf = async (q: Q, label: string) =>
  (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'aws' and n.parent_id is null and n.label = $1", [label])).id as string;
const memberSet = (q: Q, room: string, uid: string, sql: string) =>
  q(`update public.room_members set ${sql} where room_id = $1::bigint and user_id = $2::uuid`, [room, uid]);
/** 철수의 개인 목표 하나 (3주차) */
async function personalOf(q: Q, owner: string): Promise<string> {
  await setNow(q, "2026-10-12T03:00:00Z");
  await asUser(q, owner);
  const c = (await one(q, "select public.personal_create('aws', $1, '첨부 시험 목표') as c", [await roundOf(q, "3주차")])).c as Row;
  return c.createdId as string;
}
/** Storage 업로드 흉내 + node_file_register. 반환 file id */
export async function staged(q: Q, node: string, room: string, uid: string, mime = "application/pdf", ext = "pdf") {
  const fid = crypto.randomUUID();
  const path = `n/${room}/${node}/${fid}.${ext}`;
  await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
          [path, uid, JSON.stringify({ size: 10, mimetype: mime })]);
  await one(q, "select public.node_file_register($1::bigint, $2, 'a.' || $4, $3, 10)", [node, path, mime, ext]);
  return fid;
}
/** 닉네임까지 정한 외부인 — require_user(ONBOARDING_REQUIRED) 를 지나야 하는 RPC 용 */
async function onboarded(q: Q): Promise<string> {
  const u = await newUser(q); const nick = "o" + u.slice(0, 8);
  await q("update public.profiles set nickname = $2, nickname_normalized = $2 where id = $1::uuid", [u, nick]);
  return u;
}
export const setFiles = (q: Q, node: string, ids: string[]) =>
  one(q, "select public.node_files_set($1::bigint, $2::uuid[]) as r", [node, uuids(ids)]).then((r) => r.r as Row[]);

cases("node attachments · helpers & policies", db, [
  { name: "node_doc_key_ok: n/{room}/{node}/{uuid}[.ext] only", run: async (q) => {
    const u = "0b9c2f6e-1d2a-4c3b-9e8f-112233445566";
    const ok = (s: string) => b(q, "select public.node_doc_key_ok($1) as v", [s]);
    assertEquals(await ok(`n/1/2/${u}.pdf`), true);
    assertEquals(await ok(`n/1/2/${u}`), true);
    assertEquals(await ok(`1/2/${u}/${u}.pdf`), false);        // 제출 키
    assertEquals(await ok(`n/1/2/${u}.PDF`), false);           // 대문자 확장자(objectKey 가 소문자로 만든다)
    assertEquals(await ok(`n/x/2/${u}.pdf`), false);
    assertEquals(await ok(`n/1/2/3/${u}.pdf`), false);
    assertEquals(await ok(`n/1/99999999999999999999/${u}.pdf`), false);   // bigint 넘침 방지(18자리)
    assertEquals(await ok(`n/1/02/${u}.pdf`), false);          // 앞자리 0 — 캐스트하면 2 지만 글자는 id 와 다르다(리뷰 Minor 1)
    assertEquals(await ok(`n/01/2/${u}.pdf`), false);
    assertEquals(await ok(`n/0/2/${u}.pdf`), false);
    assertEquals(await ok(`n/10/20/${u}.pdf`), true);
  } },
  { name: "readable: team node — leader·ACTIVE·INACTIVE yes, PENDING·outsider no; archived → editors only", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF);
    const [minsu, cheolsu, doyun] = [await uidOf(q, "민수"), await uidOf(q, "철수"), await uidOf(q, "도윤")];
    const outsider = await newUser(q);
    const pending = await newUser(q);
    await q("insert into public.room_members (room_id, user_id, role, status) values ($1, $2, 'MEMBER', 'PENDING')", [aws, pending]);
    for (const u of [minsu, cheolsu, doyun]) assertEquals(await readable(q, leaf, u), true, u);
    assertEquals(await readable(q, leaf, pending), false);   // 판정: PENDING 신청자 제외(D3)
    assertEquals(await readable(q, leaf, outsider), false);
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [leaf]);
    assertEquals(await readable(q, leaf, minsu), true);
    assertEquals(await readable(q, leaf, cheolsu), false);
    await memberSet(q, aws, cheolsu, "can_edit_curriculum = true");
    assertEquals(await readable(q, leaf, cheolsu), true);
  } },
  { name: "writable: leader·delegated editor on team nodes in DRAFT/RECRUIT/ACTIVE; never plain member, archived, ENDED", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const round = await roundOf(q, "2주차");
    const [minsu, cheolsu, jieun] = [await uidOf(q, "민수"), await uidOf(q, "철수"), await uidOf(q, "지은")];
    assertEquals(await writable(q, leaf, minsu), true);
    assertEquals(await writable(q, round, minsu), true);        // 회차도
    assertEquals(await writable(q, leaf, cheolsu), false);
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    assertEquals(await writable(q, leaf, jieun), true);
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [leaf]);
    assertEquals(await writable(q, leaf, minsu), false);
    await q("update public.rooms set status = 'ENDED' where id = $1::bigint", [aws]);
    assertEquals(await writable(q, round, minsu), false);
  } },
  { name: "personal goal: owner writes; leader·delegated editor don't; viewers read; archived → owner·leader read", run: async (q) => {
    const aws = await roomId(q, "aws");
    const [minsu, cheolsu, jieun, doyun] = [await uidOf(q, "민수"), await uidOf(q, "철수"), await uidOf(q, "지은"), await uidOf(q, "도윤")];
    const g = await personalOf(q, cheolsu);
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    assertEquals(await writable(q, g, cheolsu), true);
    assertEquals(await writable(q, g, minsu), false);
    assertEquals(await writable(q, g, jieun), false);
    for (const u of [cheolsu, minsu, jieun, doyun]) assertEquals(await readable(q, g, u), true, u);
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [g]);
    assertEquals(await readable(q, g, cheolsu), true);
    assertEquals(await readable(q, g, minsu), true);
    assertEquals(await readable(q, g, jieun), false);
  } },
  { name: "object helpers: writable checks room segment; readable only for attached READY rows", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    const u = crypto.randomUUID();
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    assertEquals(await b(q, "select public.node_doc_object_writable($1) as v", [`n/${aws}/${leaf}/${u}.pdf`]), true);
    assertEquals(await b(q, "select public.node_doc_object_writable($1) as v", [`n/${Number(aws) + 999}/${leaf}/${u}.pdf`]), false);
    assertEquals(await b(q, "select public.node_doc_object_writable($1) as v", [`${aws}/${leaf}/${minsu}/${u}.pdf`]), false);
    const fid = await staged(q, leaf, aws, minsu);
    const path = `n/${aws}/${leaf}/${fid}.pdf`;
    assertEquals(await b(q, "select public.node_doc_object_readable($1) as v", [path]), false);   // 미저장은 아무도 못 읽는다
    await setFiles(q, leaf, [fid]);
    assertEquals(await b(q, "select public.node_doc_object_readable($1) as v", [path]), true);
    await asUser(q, await newUser(q));
    assertEquals(await b(q, "select public.node_doc_object_readable($1) as v", [path]), false);
  } },
  { name: "policies: storage gets the two node_doc policies; files_select keeps submission branch and adds NODE_DOC", run: async (q) => {
    const pols = await q("select polname, polcmd from pg_policy where polrelid = 'storage.objects'::regclass and polname like '%node_doc' order by 1");
    assertEquals(pols.map((p) => [p.polname, p.polcmd]), [["attachments_insert_node_doc", "a"], ["attachments_select_node_doc", "r"]]);
    const qual = (await one(q, "select pg_get_expr(polqual, polrelid) as e from pg_policy where polname = 'files_select'")).e as string;
    for (const s of ["'ATTACHMENT'", "can_read_submission", "'COVER'", "'NODE_DOC'", "node_doc_readable_me", "attached_at"]) {
      assertEquals(qual.includes(s), true, s);
    }
  } },
  { name: "grants: policy wrappers only; internal helpers closed", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).ok;
    assertEquals(await can("anon", "public.node_doc_readable_me(bigint)"), true);
    assertEquals(await can("authenticated", "public.node_doc_object_writable(text)"), true);
    assertEquals(await can("authenticated", "public.node_doc_object_readable(text)"), true);
    assertEquals(await can("anon", "public.node_doc_object_writable(text)"), false);
    for (const fn of ["public.node_doc_readable(bigint,uuid)", "public.node_doc_writable(bigint,uuid)"]) {
      assertEquals(await can("authenticated", fn), false, fn);
      assertEquals(await can("anon", fn), false, fn);
    }
  } },
  { name: "trigger: deleting a subtree or a personal goal marks its NODE_DOC files DELETED (rows stay for cleanup-files)", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF);
    const [minsu, cheolsu] = [await uidOf(q, "민수"), await uidOf(q, "철수")];
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu);
    await setFiles(q, leaf, [a]);
    const g = await personalOf(q, cheolsu);
    const c = await staged(q, g, aws, cheolsu);
    await setFiles(q, g, [c]);
    // 시드 리프엔 제출물이 있어 node_delete 는 NODE_HAS_SUBMISSIONS 로 막는다 → 제출물을 먼저 걷어 낸 뒤 같은 문장으로 지운다
    await q("delete from public.submissions where node_id in (select public.node_subtree($1::bigint))", [leaf]);
    await q("delete from public.goal_nodes where id in (select public.node_subtree($1::bigint))", [leaf]);  // node_delete 와 같은 문장
    await asUser(q, cheolsu);
    await one(q, "select public.personal_delete('aws', $1::bigint) as r", [g]);
    const st = await q("select status, node_id from public.files where id in ($1::uuid, $2::uuid) order by status", [a, c]);
    assertEquals(st.map((r) => [r.status, r.node_id]), [["DELETED", null], ["DELETED", null]]);
  } },
]);

const list = (q: Q, node: string) => one(q, "select public.node_files($1::bigint) as r", [node]).then((r) => (r.r as Row[]).map((f) => f.id));
const statusOf = async (q: Q, fid: string) => (await one(q, "select status, attached_at is not null as att from public.files where id = $1::uuid", [fid]));

cases("node attachments · RPC", db, [
  { name: "register → staged(READY, not attached); set attaches; set again removes → DELETED; idempotent", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu); const c = await staged(q, leaf, aws, minsu, "image/png", "png");
    assertEquals(await statusOf(q, a), { status: "READY", att: false });
    assertEquals(await list(q, leaf), []);                                      // 미저장은 목록에 없다
    // 한 트랜잭션 안이라 attached_at·created_at 이 같다 → 순서는 id 로 갈린다. 집합으로 비교
    assertEquals((await setFiles(q, leaf, [a, c])).map((f) => f.id).sort(), [a, c].sort());
    assertEquals((await list(q, leaf)).sort(), [a, c].sort());
    assertEquals((await setFiles(q, leaf, [c])).map((f) => f.id), [c]);
    assertEquals(await statusOf(q, a), { status: "DELETED", att: true });
    assertEquals((await setFiles(q, leaf, [c])).map((f) => f.id), [c]);        // 멱등
    await asUser(q, await uidOf(q, "철수"));
    assertEquals(await list(q, leaf), [c]);                                     // 멤버는 읽는다
  } },
  { name: "register validation: path·mime·size·limit; plain member → NOT_CURRICULUM_EDITOR", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const reg = (path: string, mime = "application/pdf", size = 10) =>
      one(q, "select public.node_file_register($1::bigint, $2, 'a.pdf', $3, $4::bigint)", [leaf, path, mime, size]);
    await expectFail(reg(`n/${Number(aws) + 1}/${leaf}/${crypto.randomUUID()}.pdf`), "VALIDATION_FAILED");
    await expectFail(reg(`${aws}/${leaf}/${minsu}/${crypto.randomUUID()}.pdf`), "VALIDATION_FAILED");
    await expectFail(reg(`n/${aws}/${leaf}/${crypto.randomUUID()}.exe`, "application/x-msdownload"), "FILE_TYPE_NOT_ALLOWED");
    await expectFail(reg(`n/${aws}/${leaf}/${crypto.randomUUID()}.pdf`), "FILE_NOT_READY");     // Storage 객체 없음
    const big = crypto.randomUUID(); const bigPath = `n/${aws}/${leaf}/${big}.pdf`;
    await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
            [bigPath, minsu, JSON.stringify({ size: 10485761, mimetype: "application/pdf" })]);
    await expectFail(reg(bigPath), "FILE_TOO_LARGE");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await staged(q, leaf, aws, minsu));
    await setFiles(q, leaf, ids);                                               // 붙은 3
    ids.push(await staged(q, leaf, aws, minsu), await staged(q, leaf, aws, minsu));   // 미저장 2 → 합 5
    await expectFail(staged(q, leaf, aws, minsu), "FILE_LIMIT_EXCEEDED");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(staged(q, leaf, aws, await uidOf(q, "철수")), "NOT_CURRICULUM_EDITOR");
  } },
  { name: "set: duplicates·>5 rejected; another editor's staged id → FILE_NOT_READY; any editor can remove others' attached", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF);
    const [minsu, jieun] = [await uidOf(q, "민수"), await uidOf(q, "지은")];
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu);
    await expectFail(setFiles(q, leaf, [a, a]), "VALIDATION_FAILED");
    await expectFail(setFiles(q, leaf, Array.from({ length: 6 }, () => crypto.randomUUID())), "FILE_LIMIT_EXCEEDED");
    await asUser(q, jieun);
    await expectFail(setFiles(q, leaf, [a]), "FILE_NOT_READY");                 // 민수의 미저장 파일
    await expectFail(setFiles(q, leaf, [crypto.randomUUID()]), "FILE_NOT_READY");
    await asUser(q, minsu);
    await setFiles(q, leaf, [a]);
    await asUser(q, jieun);
    assertEquals(await setFiles(q, leaf, []), []);                              // 다른 편집자가 올린 것도 뺄 수 있다
    assertEquals((await statusOf(q, a)).status, "DELETED");
  } },
  { name: "set on archived / ENDED → TASK_ARCHIVED / ROOM_NOT_EDITABLE", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await asUser(q, minsu);
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [leaf]);
    await expectFail(setFiles(q, leaf, []), "TASK_ARCHIVED");
    await q("update public.goal_nodes set archived_at = null where id = $1::bigint", [leaf]);
    await q("update public.rooms set status = 'ENDED' where id = $1::bigint", [aws]);
    await expectFail(setFiles(q, leaf, []), "ROOM_NOT_EDITABLE");
  } },
  { name: "personal: owner attaches; leader may only remove; delegated editor → NOT_OWNER; outsider → NODE_NOT_FOUND", run: async (q) => {
    const aws = await roomId(q, "aws");
    const [minsu, cheolsu, jieun] = [await uidOf(q, "민수"), await uidOf(q, "철수"), await uidOf(q, "지은")];
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    const g = await personalOf(q, cheolsu);                                     // asUser 철수
    const a = await staged(q, g, aws, cheolsu); const c = await staged(q, g, aws, cheolsu);
    await setFiles(q, g, [a, c]);
    await asUser(q, jieun);
    await expectFail(setFiles(q, g, [a]), "NOT_OWNER");
    await expectFail(staged(q, g, aws, jieun), "NOT_OWNER");
    await asUser(q, minsu);
    await expectFail(staged(q, g, aws, minsu), "NOT_OWNER");                    // 그룹장 추가 불가
    assertEquals((await setFiles(q, g, [c])).map((f) => f.id), [c]);           // 빼기는 된다(모더레이션)
    await asUser(q, await onboarded(q));                                        // require_user 는 닉네임이 있어야 통과
    await expectFail(setFiles(q, g, []), "NODE_NOT_FOUND");
    await expectFail(list(q, g), "NODE_NOT_FOUND");
  } },
  { name: "discard: staged → DELETED (frees a slot), attached → FILE_ATTACHED, others → NOT_FOUND", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu); const c = await staged(q, leaf, aws, minsu);
    await setFiles(q, leaf, [c]);
    const discard = (fid: string) => one(q, "select public.node_file_discard($1::uuid) as r", [fid]).then((r) => r.r);
    assertEquals(await discard(a), { id: a, status: "deleted" });
    assertEquals(await discard(a), { id: a, status: "deleted" });               // 멱등
    await expectFail(discard(c), "FILE_ATTACHED");
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(discard(c), "NOT_FOUND");
  } },
  { name: "anon → AUTH_REQUIRED; RPC EXECUTE to authenticated only", run: async (q) => {
    await asAnon(q);
    await expectFail(one(q, "select public.node_files(1::bigint)"), "AUTH_REQUIRED");
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).ok;
    for (const fn of ["public.node_file_register(bigint,text,text,text,bigint)", "public.node_files_set(bigint,uuid[])",
                      "public.node_file_discard(uuid)", "public.node_files(bigint)"]) {
      assertEquals(await can("authenticated", fn), true, fn);
      assertEquals(await can("anon", fn), false, fn);
    }
  } },
  { name: "job_cleanup: staged NODE_DOC >24h and node-less NODE_DOC → DELETED; attached untouched; old counters unchanged", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    const ins = (id: string, node: string | null, attached: boolean, created: string) =>
      q(`insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes, status, created_at, attached_at)
         values ($1::uuid, $2::uuid, $3::bigint, $4::bigint, 'NODE_DOC', $5, 'x.pdf', 'application/pdf', 1, 'READY', $6::timestamptz, $7::timestamptz)`,
        [id, minsu, aws, node, `n/${aws}/${leaf}/${id}.pdf`, created, attached ? created : null]);
    const [old, young, kept, orphan] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await ins(old, leaf, false, "2026-10-01T00:00:00Z");
    await ins(young, leaf, false, new Date().toISOString());
    await ins(kept, leaf, true, "2026-10-01T00:00:00Z");
    await ins(orphan, null, true, "2026-10-01T00:00:00Z");
    const r = (await one(q, "select public.job_cleanup() as r")).r as Row;
    assertEquals([r.filesExpired, r.orphansExpired, r.nodeDocsExpired], [0, 0, 2]);
    assertEquals((await statusOf(q, old)).status, "DELETED");
    assertEquals((await statusOf(q, young)).status, "READY");
    assertEquals((await statusOf(q, kept)).status, "READY");
    assertEquals((await statusOf(q, orphan)).status, "DELETED");
  } },
  { name: "list order: attached_at, then created_at (스펙 §6.2)", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu); const c = await staged(q, leaf, aws, minsu);
    await setFiles(q, leaf, [a, c]);
    const at = (fid: string, col: string, ago: string) =>
      q(`update public.files set ${col} = now() - $2::interval where id = $1::uuid`, [fid, ago]);
    await at(c, "attached_at", "2 hours"); await at(a, "attached_at", "1 hour");
    assertEquals(await list(q, leaf), [c, a]);                                  // 먼저 붙은 것이 앞
    await at(a, "attached_at", "2 hours");                                      // 붙은 시각이 같으면 올린 순서
    await at(a, "created_at", "3 hours"); await at(c, "created_at", "4 hours");
    assertEquals(await list(q, leaf), [c, a]);
    await at(a, "created_at", "5 hours");
    assertEquals(await list(q, leaf), [a, c]);
  } },
  { name: "register: another editor can't claim someone else's uploaded object → FILE_NOT_READY (리뷰 Minor 2)", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF);
    const [minsu, jieun] = [await uidOf(q, "민수"), await uidOf(q, "지은")];
    await memberSet(q, aws, jieun, "can_edit_curriculum = true");
    await setNow(q, "2026-10-12T03:00:00Z");
    const path = `n/${aws}/${leaf}/${crypto.randomUUID()}.pdf`;
    await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
            [path, minsu, JSON.stringify({ size: 10, mimetype: "application/pdf" })]);
    const reg = () => one(q, "select public.node_file_register($1::bigint, $2, 'a.pdf', 'application/pdf', 10) as r", [leaf, path]);
    await asUser(q, jieun);
    await expectFail(reg(), "FILE_NOT_READY");
    await asUser(q, minsu);
    assertEquals(((await reg()).r as Row).status, "ready");                    // 업로더 본인은 된다
  } },
  { name: "set: staged file older than 24h → FILE_NOT_READY (job_cleanup 과 같은 창, 리뷰 Minor 3)", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF); const minsu = await uidOf(q, "민수");
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const a = await staged(q, leaf, aws, minsu);
    await q("update public.files set created_at = now() - interval '25 hours' where id = $1::uuid", [a]);
    await expectFail(setFiles(q, leaf, [a]), "FILE_NOT_READY");
    await q("update public.files set created_at = now() - interval '23 hours' where id = $1::uuid", [a]);
    assertEquals((await setFiles(q, leaf, [a])).map((f) => f.id), [a]);
  } },
  { name: "RLS under real roles: editor INSERT n/ key ok, wrong room denied; member sees attached only; anon sees no NODE_DOC (리뷰 Minor 6)", run: async (q) => {
    const aws = await roomId(q, "aws"); const leaf = await nodeId(q, "aws", LEAF);
    const [minsu, cheolsu] = [await uidOf(q, "민수"), await uidOf(q, "철수")];
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, minsu);
    const att = await staged(q, leaf, aws, minsu); await setFiles(q, leaf, [att]);
    const loose = await staged(q, leaf, aws, minsu);                            // 미저장
    // Supabase 가 기본으로 주는 GRANT 를 흉내(PGlite 에는 없다). 사례 트랜잭션과 함께 롤백된다
    await q("grant usage on schema storage, auth to anon, authenticated");
    await q("grant select, insert on storage.objects to anon, authenticated");
    await q("grant select on all tables in schema public to anon, authenticated");   // 정책이 부르는 비-definer 헬퍼가 읽는 표 포함
    const put = (path: string) => q("insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)", [path, minsu]);
    const docs = async () => (await q("select id::text as id from public.files where purpose = 'NODE_DOC' order by 1")).map((r) => r.id as string);
    const objs = async () => (await q("select name from storage.objects where name like 'n/%' order by 1")).map((r) => r.name as string);
    try {
      await q("set local role authenticated");
      await put(`n/${aws}/${leaf}/${crypto.randomUUID()}.pdf`);                // 편집자 업로드
      await expectFail(put(`n/${Number(aws) + 999}/${leaf}/${crypto.randomUUID()}.pdf`), "row-level security");
      await asUser(q, cheolsu);
      await expectFail(put(`n/${aws}/${leaf}/${crypto.randomUUID()}.pdf`), "row-level security");   // 일반 멤버
      assertEquals(await docs(), [att]);                                        // 붙은 것만 — 미저장(loose) 안 보임
      assertEquals(await objs(), [`n/${aws}/${leaf}/${att}.pdf`]);              // 객체도 붙은 것만
      await asUser(q, minsu);
      assertEquals((await docs()).sort(), [att, loose].sort());                 // 업로더는 자기 미저장 행을 본다(owner 갈래)
      await q("set local role anon");
      await asAnon(q);
      assertEquals(await docs(), []);
      assertEquals(await objs(), []);
    } finally {
      await q("reset role");
    }
  } },
]);
