// supabase/tests/notices-sql.test.ts — 0040 그룹장 공지사항 (스펙 2026-10-21-room-notices-design)
// 시드: aws = ACTIVE · 그룹장 민수 · ACTIVE 지은·철수·하나 · INACTIVE 도윤. sqld = 철수 PENDING. algo = ENDED(그룹장 현우). spring = PRIVATE(서연 외부인)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, newUser, openDb } from "./_harness.ts";
import { cases, one, roomId, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
const rpc = async (q: Q, expr: string, p: unknown[] = []) => (await one(q, `select ${expr} as r`, p)).r as Row;
const create = (q: Q, input: Record<string, unknown>, slug = "aws") =>
  rpc(q, "public.notice_create($1, $2::jsonb)", [slug, JSON.stringify({ title: "스터디 규칙", bodyMd: "- 매주 목요일 마감", ...input })]);
const update = (q: Q, id: string, patch: Record<string, unknown>, slug = "aws") =>
  rpc(q, "public.notice_update($1, $2::bigint, $3::jsonb)", [slug, id, JSON.stringify(patch)]);
const list = (q: Q, slug = "aws") => rpc(q, "public.notice_list($1)", [slug]);
const inbox = (q: Q, slug = "aws") => rpc(q, "public.notice_inbox($1)", [slug]);
const read = (q: Q, ids: string[], slug = "aws") => rpc(q, "public.notice_read($1, $2::bigint[])", [slug, `{${ids.join(",")}}`]);
const popupIds = async (q: Q, nick: string) => { await as(q, nick); return ((await inbox(q)).popups as Row[]).map((n) => n.id); };
const posted = async (q: Q, nick: string) =>
  await q("select title, body, link, dedupe_key from public.notifications where user_id = $1::uuid and kind = 'NOTICE_POSTED' order by id", [await uidOf(q, nick)]);
/** fail() 의 hint(JSON) — details */
async function failHint(p: Promise<unknown>, code: string): Promise<Row> {
  try { await p; } catch (e) {
    const er = e as Error & { hint?: string };
    assert(er.message.includes(code), er.message);
    return JSON.parse(er.hint ?? "{}");
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

cases("notices 0040 · schema & permissions", db, [
  { name: "tables closed to clients · RLS on · RPC grants authenticated only", run: async (q) => {
    for (const t of ["room_notices", "room_notice_reads"]) {
      for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert", "update", "delete"]) {
        assertEquals((await one(q, "select has_table_privilege($1, $2, $3) as v", [role, `public.${t}`, priv])).v, false, `${role} ${priv} ${t}`);
      }
      assertEquals((await one(q, "select relrowsecurity as v from pg_class where oid = $1::regclass", [`public.${t}`])).v, true, t);
    }
    for (const f of ["notice_list(text)", "notice_inbox(text)", "notice_read(text,bigint[])", "notice_create(text,jsonb)", "notice_update(text,bigint,jsonb)", "notice_delete(text,bigint)"]) {
      assertEquals((await one(q, "select has_function_privilege('authenticated', $1, 'execute') as v", [`public.${f}`])).v, true, f);
      assertEquals((await one(q, "select has_function_privilege('anon', $1, 'execute') as v", [`public.${f}`])).v, false, f);
    }
    for (const f of ["notice_json(public.room_notices,uuid)", "notice_notify(public.room_notices,uuid)", "notice_mark_read(bigint,uuid)", "notice_reader_room(text)"]) {
      assertEquals((await one(q, "select has_function_privilege('authenticated', $1, 'execute') as v", [`public.${f}`])).v, false, f);
    }
  } },
  { name: "authenticated role cannot select/insert the tables directly", run: async (q) => {
    await as(q, "지은");
    await q("set local role authenticated");
    try {
      await expectFail(q("select * from public.room_notices"), "permission denied");
      await expectFail(q("insert into public.room_notice_reads (notice_id, user_id, read_rev) values (1, auth.uid(), 1)"), "permission denied");
    } finally { await q("reset role"); }
  } },
  { name: "leader creates · Notice JSON shape · author auto-read", run: async (q) => {
    await as(q, "민수");
    const n = await create(q, { popup: true, pinned: true });
    assertEquals([n.title, n.bodyMd, n.popup, n.pinned, n.edited, n.read], ["스터디 규칙", "- 매주 목요일 마감", true, true, false, true]);
    assertEquals(n.author.nickname, "민수");
    assertEquals(typeof n.id, "string");
    assert(/Z$/.test(n.createdAt) && /Z$/.test(n.updatedAt));
    const l = await list(q);
    assertEquals([l.items.length, l.canWrite], [1, true]);
    assertEquals(l.limits, { total: 100, pinned: 3, popup: 5 });
    assertEquals(l.counts, { total: 1, pinned: 1, popup: 1 });
    assertEquals(await inbox(q), { unread: false, popups: [] });   // 그룹장: 팝업 없음·미읽음 없음(D17)
  } },
  { name: "write permission: ACTIVE member · curriculum editor → NOT_LEADER, outsider of private room → ROOM_NOT_FOUND, anon → AUTH_REQUIRED", run: async (q) => {
    await as(q, "민수");
    const n = await create(q, {});
    await q("update public.room_members set can_edit_curriculum = true where room_id = $1 and user_id = $2::uuid", [await roomId(q, "aws"), await uidOf(q, "지은")]);
    for (const nick of ["지은", "철수"]) {
      await as(q, nick);
      await expectFail(create(q, {}), "NOT_LEADER");
      await expectFail(update(q, n.id, { title: "x" }), "NOT_LEADER");
      await expectFail(rpc(q, "public.notice_delete('aws', $1::bigint)", [n.id]), "NOT_LEADER");
    }
    await as(q, "서연");
    await expectFail(create(q, {}, "spring"), "ROOM_NOT_FOUND");
    await expectFail(create(q, {}), "NOT_LEADER");   // 공개 방은 읽을 수 있어 NOT_LEADER (require_leader 규칙)
    await asAnon(q);
    await expectFail(list(q), "AUTH_REQUIRED");
  } },
  { name: "read permission (D10): leader · ACTIVE · INACTIVE read; PENDING · outsider NOT_MEMBER; unreadable room ROOM_NOT_FOUND", run: async (q) => {
    await as(q, "민수");
    await create(q, {});
    for (const nick of ["지은", "도윤"]) {
      await as(q, nick);
      assertEquals((await list(q)).items.length, 1, nick);
      assertEquals((await list(q)).canWrite, false, nick);
    }
    await as(q, "서연");                                         // 공개 방 외부인
    await expectFail(list(q), "NOT_MEMBER");
    await expectFail(inbox(q), "NOT_MEMBER");
    await expectFail(read(q, []), "NOT_MEMBER");
    await expectFail(list(q, "spring"), "ROOM_NOT_FOUND");      // 비공개 방
    await expectFail(list(q, "nope"), "ROOM_NOT_FOUND");
    await as(q, "철수");                                         // sqld PENDING
    assertEquals(await failHint(list(q, "sqld"), "NOT_MEMBER"), { state: "pending" });
    await expectFail(inbox(q, "sqld"), "NOT_MEMBER");
  } },
]);

cases("notices 0040 · validation & limits", db, [
  { name: "title 1~80 · bodyMd 1~10,000 · unknown keys · wrong types", run: async (q) => {
    await as(q, "민수");
    assertEquals((await failHint(create(q, { title: "" }), "VALIDATION_FAILED")).field, "title");
    assertEquals((await failHint(create(q, { title: "   " }), "VALIDATION_FAILED")).field, "title");
    assertEquals((await failHint(create(q, { title: "가".repeat(81) }), "VALIDATION_FAILED")).field, "title");
    assertEquals((await failHint(create(q, { bodyMd: "" }), "VALIDATION_FAILED")).field, "bodyMd");
    assertEquals((await failHint(create(q, { bodyMd: "a".repeat(10001) }), "VALIDATION_FAILED")).field, "bodyMd");
    assertEquals((await failHint(create(q, { popup: "yes" }), "VALIDATION_FAILED")).field, "popup");
    assertEquals((await failHint(create(q, { renotify: true }), "VALIDATION_FAILED")).field, "renotify");   // 작성엔 없는 키
    assertEquals((await create(q, { title: "  " + "가".repeat(80) + " ", bodyMd: "a".repeat(10000) })).title, "가".repeat(80));   // 앞뒤 공백 정리
    await expectFail(rpc(q, "public.notice_create('aws', '[]'::jsonb)"), "VALIDATION_FAILED");
    const n = await create(q, {});
    assertEquals((await failHint(update(q, n.id, { author: "x" }), "VALIDATION_FAILED")).field, "author");
    assertEquals((await failHint(update(q, n.id, { title: "" }), "VALIDATION_FAILED")).field, "title");
    assertEquals((await failHint(update(q, n.id, { renotify: 1 }), "VALIDATION_FAILED")).field, "renotify");
  } },
  { name: "NOTICE_NOT_FOUND: unknown id · another room's id", run: async (q) => {
    await as(q, "태호");
    const other = await create(q, {}, "react");
    await as(q, "민수");
    await expectFail(update(q, other.id, { title: "x" }), "NOTICE_NOT_FOUND");
    await expectFail(rpc(q, "public.notice_delete('aws', $1::bigint)", [other.id]), "NOTICE_NOT_FOUND");
    await expectFail(update(q, "999999", { title: "x" }), "NOTICE_NOT_FOUND");
  } },
  { name: "limits: 101st total · 4th pinned · 6th popup → NOTICE_LIMIT(details.kind)", run: async (q) => {
    await as(q, "민수");
    const room = await roomId(q, "aws");
    for (let i = 0; i < 3; i++) await create(q, { pinned: true });
    assertEquals((await failHint(create(q, { pinned: true }), "NOTICE_LIMIT")).kind, "pinned");
    for (let i = 0; i < 5; i++) await create(q, { popup: true });
    assertEquals((await failHint(create(q, { popup: true }), "NOTICE_LIMIT")).kind, "popup");
    // 기존 공지 수정으로 켤 때도 같은 상한 — 이미 켜진 공지를 다시 보내는 건 괜찮다
    const plain = await create(q, {});
    assertEquals((await failHint(update(q, plain.id, { pinned: true }), "NOTICE_LIMIT")).kind, "pinned");
    assertEquals((await failHint(update(q, plain.id, { popup: true }), "NOTICE_LIMIT")).kind, "popup");
    assertEquals((await failHint(update(q, plain.id, { renotify: true }), "NOTICE_LIMIT")).kind, "popup");
    const pinned = (await list(q)).items.find((n: Row) => n.pinned);
    assertEquals((await update(q, pinned.id, { pinned: true, title: "고정 유지" })).title, "고정 유지");
    await q(`insert into public.room_notices (room_id, title, body_md) select $1, 'n', 'b' from generate_series(1, 100 - 9)`, [room]);
    assertEquals((await list(q)).counts.total, 100);
    assertEquals(await failHint(create(q, {}), "NOTICE_LIMIT"), { kind: "total", max: 100 });
  } },
]);

cases("notices 0040 · room state (D12)", db, [
  { name: "ENDED room: writes ROOM_NOT_EDITABLE · list readable · canWrite false · no popups", run: async (q) => {
    const algo = await roomId(q, "algo");
    await q("insert into public.room_notices (room_id, title, body_md, popup) values ($1, '마지막 공지', '수고했어요', true)", [algo]);
    const id = (await one(q, "select id::text as id from public.room_notices where room_id = $1", [algo])).id;
    await as(q, "현우");
    await expectFail(create(q, {}, "algo"), "ROOM_NOT_EDITABLE");
    await expectFail(update(q, id, { title: "x" }, "algo"), "ROOM_NOT_EDITABLE");
    await expectFail(rpc(q, "public.notice_delete('algo', $1::bigint)", [id]), "ROOM_NOT_EDITABLE");
    assertEquals((await list(q, "algo")).canWrite, false);
    await as(q, "보람");
    const l = await list(q, "algo");
    assertEquals([l.items.length, l.canWrite], [1, false]);
    assertEquals(await inbox(q, "algo"), { unread: true, popups: [] });
    assertEquals((await read(q, [id], "algo")).unread, false);   // 읽음 기록은 종료 방에서도 된다
  } },
  { name: "archived room: writes ROOM_NOT_EDITABLE · no popups · list readable", run: async (q) => {
    await as(q, "민수");
    const n = await create(q, { popup: true });
    await q("update public.rooms set archived_at = now() where slug = 'aws'");
    await expectFail(create(q, {}), "ROOM_NOT_EDITABLE");
    await expectFail(update(q, n.id, { pinned: true }), "ROOM_NOT_EDITABLE");
    await as(q, "지은");
    assertEquals((await list(q)).items.length, 1);
    assertEquals((await inbox(q)).popups, []);
  } },
]);

cases("notices 0040 · popup inbox & reads", db, [
  { name: "member sees popup · leader not · read clears · idempotent · plain edit keeps cleared · renotify re-pops · popup=false clears", run: async (q) => {
    await as(q, "민수");
    const n = await create(q, { popup: true });
    assertEquals(await popupIds(q, "민수"), []);
    assertEquals(await popupIds(q, "지은"), [n.id]);
    assertEquals((await inbox(q)).unread, true);
    assertEquals((await list(q)).items[0].read, false);
    assertEquals(await read(q, [n.id]), { unread: false });
    assertEquals(await read(q, [n.id]), { unread: false });   // 멱등
    assertEquals(await popupIds(q, "지은"), []);
    assertEquals((await list(q)).items[0].read, true);
    await as(q, "민수");
    const e = await update(q, n.id, { title: "규칙(오타 수정)" });
    assertEquals(e.title, "규칙(오타 수정)");
    assertEquals(await popupIds(q, "지은"), []);              // 일반 수정은 다시 안 뜬다(D4)
    await as(q, "민수");
    const r = await update(q, n.id, { renotify: true, bodyMd: "바뀐 규칙" });
    assertEquals([r.popup, r.read], [true, true]);            // 그룹장은 새 리비전도 읽음
    assertEquals(await popupIds(q, "지은"), [n.id]);
    assertEquals((await inbox(q)).unread, true);
    await as(q, "민수");
    assertEquals((await inbox(q)).unread, false);
    await update(q, n.id, { popup: false });
    assertEquals(await popupIds(q, "지은"), []);
    assertEquals((await inbox(q)).unread, true);              // 팝업은 꺼도 미읽음 배지는 남는다
  } },
  { name: "renotify on a non-popup notice turns popup on", run: async (q) => {
    await as(q, "민수");
    const n = await create(q, {});
    assertEquals(await popupIds(q, "철수"), []);
    await as(q, "민수");
    assertEquals((await update(q, n.id, { renotify: true })).popup, true);
    assertEquals(await popupIds(q, "철수"), [n.id]);
  } },
  { name: "queue order: pinned first, then oldest · max 5", run: async (q) => {
    await as(q, "민수");
    const a = await create(q, { popup: true, title: "a" });
    const b = await create(q, { popup: true, title: "b" });
    const c = await create(q, { popup: true, title: "c", pinned: true });
    const d = await create(q, { popup: true, title: "d" });
    assertEquals(await popupIds(q, "하나"), [c.id, a.id, b.id, d.id]);
    // 상한을 우회해 6개 이상 넣어도 큐는 5개까지
    await q("insert into public.room_notices (room_id, title, body_md, popup) select $1, 'z', 'b', true from generate_series(1, 3)", [await roomId(q, "aws")]);
    assertEquals((await popupIds(q, "하나")).length, 5);
  } },
  { name: "late joiner sees existing popups (D6) · INACTIVE gets none · non-popup notice not in queue", run: async (q) => {
    await as(q, "민수");
    const p = await create(q, { popup: true });
    await create(q, {});
    const late = await newUser(q);
    await q("update public.profiles set nickname = '늦은이' where id = $1::uuid", [late]);
    await q("insert into public.room_members (room_id, user_id, role, status, joined_at) values ($1, $2::uuid, 'MEMBER', 'ACTIVE', now())", [await roomId(q, "aws"), late]);
    await asUser(q, late);
    assertEquals(((await inbox(q)).popups as Row[]).map((n) => n.id), [p.id]);
    await as(q, "도윤");
    assertEquals(await inbox(q), { unread: true, popups: [] });
  } },
  { name: "notice_read skips foreign / deleted ids · caps array at 100", run: async (q) => {
    await as(q, "태호");
    const other = await create(q, {}, "react");
    await as(q, "민수");
    const n = await create(q, {});
    await as(q, "지은");
    assertEquals(await read(q, [other.id, "999999"]), { unread: true });
    assertEquals((await one(q, "select count(*)::int as c from public.room_notice_reads where notice_id = $1::bigint", [other.id])).c, 1);   // 작성자 행만
    assertEquals(await read(q, [n.id, n.id]), { unread: false });
    await expectFail(read(q, Array.from({ length: 101 }, (_, i) => String(i + 1))), "VALIDATION_FAILED");
  } },
  { name: "list order: pinned → newest · edited flag only on title/body change", run: async (q) => {
    await as(q, "민수");
    const a = await create(q, { title: "a" });
    const b = await create(q, { title: "b", pinned: true });
    const c = await create(q, { title: "c" });
    assertEquals((await list(q)).items.map((n: Row) => n.id), [b.id, c.id, a.id]);
    await q("update public.room_notices set created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour'");
    assertEquals((await update(q, a.id, { pinned: true })).edited, false);   // 고정 토글은 '수정됨' 아님
    assertEquals((await update(q, a.id, { bodyMd: "새 본문" })).edited, true);
  } },
  { name: "delete: hard delete cascades reads · existing bell notification stays", run: async (q) => {
    await as(q, "민수");
    const n = await create(q, { popup: true });
    await as(q, "지은");
    await read(q, [n.id]);
    await as(q, "민수");
    await q("select public.notice_delete('aws', $1::bigint)", [n.id]);
    assertEquals((await one(q, "select count(*)::int as c from public.room_notice_reads where notice_id = $1::bigint", [n.id])).c, 0);
    assertEquals((await list(q)).items, []);
    assertEquals((await posted(q, "지은")).length, 1);
    await expectFail(rpc(q, "public.notice_delete('aws', $1::bigint)", [n.id]), "NOTICE_NOT_FOUND");
  } },
]);

cases("notices 0040 · NOTICE_POSTED notification (D8)", db, [
  { name: "kind registered last · render · link ?tab=notice", run: async (q) => {
    const k = (await one(q, "select public.notification_kinds() as k")).k as string[];
    assertEquals([k[k.length - 2], k[k.length - 1]], ["EXAM_PUBLISHED", "NOTICE_POSTED"]);
    const aws = await roomId(q, "aws");
    const t = (await one(q, `select public.notify_render('NOTICE_POSTED', $1::bigint, null, null, '{"title":"규칙"}') as t`, [aws])).t as Row;
    assertEquals([t.title, t.body], ["AWS SAA 자격증 3개월 완주 새 공지: 규칙", null]);
    assertEquals((await one(q, "select public.notify_link('NOTICE_POSTED', $1::bigint, null, $2::uuid) as l", [aws, await uidOf(q, "지은")])).l, "/my-study/aws?tab=notice");
  } },
  { name: "create notifies ACTIVE members only (not leader/author, INACTIVE) · plain update none · renotify once per rev · dedupe", run: async (q) => {
    await as(q, "민수");
    const n = await create(q, { title: "중간고사 일정" });
    for (const nick of ["지은", "철수", "하나"]) {
      const got = await posted(q, nick);
      assertEquals(got.length, 1, nick);
      assertEquals([got[0].title, got[0].link, got[0].dedupe_key.startsWith(`NOTICE_POSTED:${n.id}:1:`)],
                   ["AWS SAA 자격증 3개월 완주 새 공지: 중간고사 일정", "/my-study/aws?tab=notice", true]);
    }
    assertEquals((await posted(q, "민수")).length, 0);
    assertEquals((await posted(q, "도윤")).length, 0);
    await update(q, n.id, { title: "중간고사 일정(수정)", pinned: true, popup: true });
    assertEquals((await posted(q, "지은")).length, 1);
    await update(q, n.id, { renotify: true });
    const got = await posted(q, "지은");
    assertEquals(got.length, 2);
    assert(got[1].dedupe_key.startsWith(`NOTICE_POSTED:${n.id}:2:`));
    assertEquals(got[1].title, "AWS SAA 자격증 3개월 완주 새 공지: 중간고사 일정(수정)");
    // 같은 리비전으로 다시 발행해도 dedupe
    assertEquals((await one(q, "select public.notice_notify(n, $2::uuid) as c from public.room_notices n where n.id = $1::bigint", [n.id, await uidOf(q, "민수")])).c, 0);
  } },
]);
