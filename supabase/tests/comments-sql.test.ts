// supabase/tests/comments-sql.test.ts — 0041 회차·과제 댓글 + 멘션 (스펙 2026-10-21-node-comments-mentions-design)
// 시드: aws = ACTIVE · 그룹장 민수 · ACTIVE 지은·철수·하나 · INACTIVE 도윤. sqld = 철수 PENDING. algo = ENDED(그룹장 현우·멤버 보람). spring = PRIVATE(서연 외부인)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, newUser, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
const rpc = async (q: Q, expr: string, p: unknown[] = []) => (await one(q, `select ${expr} as r`, p)).r as Row;
const tok = (uid: string) => `<@${uid}>`;
const create = (q: Q, node: string, body: string, slug = "aws") =>
  rpc(q, "public.comment_create($1, $2::bigint, $3)", [slug, node, body]);
const update = (q: Q, id: string, body: string, slug = "aws") => rpc(q, "public.comment_update($1, $2::bigint, $3)", [slug, id, body]);
const del = (q: Q, id: string, slug = "aws") => q("select public.comment_delete($1, $2::bigint)", [slug, id]);
const list = (q: Q, node: string, o: { before?: string; from?: string } = {}, slug = "aws") =>
  rpc(q, "public.comment_list($1, $2::bigint, $3::bigint, $4::bigint)", [slug, node, o.before ?? null, o.from ?? null]);
const mentions = async (q: Q, nick: string) =>
  await q("select title, body, link, dedupe_key, read_at from public.notifications where user_id = $1::uuid and kind = 'MENTIONED' order by id", [await uidOf(q, nick)]);
/** 시드 노드: 회차 2주차(EC2·S3) · 과제 리프 VPC 실습(COMMON) · 지정 과제 EC2 인스턴스 유형 정리 · 묶음 로드밸런서 비교 */
const round = (q: Q) => nodeId(q, "aws", "EC2·S3");
const leaf = (q: Q) => nodeId(q, "aws", "VPC 실습");
/** fail() 의 hint(JSON) — details */
async function failHint(p: Promise<unknown>, code: string): Promise<Row> {
  try { await p; } catch (e) {
    const er = e as Error & { hint?: string };
    assertEquals(er.message, code);
    return JSON.parse(er.hint ?? "{}");
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}
/** 리밋을 피해 n개 넣기(작성자 created_at 을 과거로) */
async function bulk(q: Q, node: string, nick: string, n: number) {
  await q(`insert into public.node_comments (room_id, node_id, author_id, body, created_at, updated_at)
           select g.room_id, g.id, $2::uuid, '댓글 ' || i, now() - interval '2 hours', now() - interval '2 hours'
           from public.goal_nodes g, generate_series(1, $3::int) i where g.id = $1::bigint`, [node, await uidOf(q, nick), n]);
}

cases("comments 0041 · schema & permissions", db, [
  { name: "table closed to clients · RLS on · RPC grants authenticated only · helpers no grant", run: async (q) => {
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert", "update", "delete"]) {
      assertEquals((await one(q, "select has_table_privilege($1, 'public.node_comments', $2) as v", [role, priv])).v, false, `${role} ${priv}`);
    }
    assertEquals((await one(q, "select relrowsecurity as v from pg_class where oid = 'public.node_comments'::regclass")).v, true);
    for (const f of ["comment_list(text,bigint,bigint,bigint)", "comment_create(text,bigint,text)", "comment_update(text,bigint,text)", "comment_delete(text,bigint)"]) {
      assertEquals((await one(q, "select has_function_privilege('authenticated', $1, 'execute') as v", [`public.${f}`])).v, true, f);
      assertEquals((await one(q, "select has_function_privilege('anon', $1, 'execute') as v", [`public.${f}`])).v, false, f);
    }
    for (const f of ["comment_notify(public.node_comments,uuid,uuid[])", "comment_people(bigint,uuid[])", "comment_reader(text,bigint)",
                     "comment_exam_locked(public.goal_nodes,uuid)", "comment_rate_check(uuid)",
                     "notify_publish(text,bigint,bigint,uuid,uuid[],text,jsonb,text)"]) {
      assertEquals((await one(q, "select has_function_privilege('authenticated', $1, 'execute') as v", [`public.${f}`])).v, false, f);
    }
  } },
  { name: "read matrix (D2): leader · ACTIVE · INACTIVE read; PENDING · outsider NOT_MEMBER; private/unknown ROOM_NOT_FOUND; anon AUTH_REQUIRED", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    await create(q, node, "첫 댓글");
    for (const nick of ["민수", "지은", "도윤"]) {
      await as(q, nick);
      assertEquals((await list(q, node)).items.length, 1, nick);
    }
    await as(q, "서연");
    await expectFail(list(q, node), "NOT_MEMBER");
    await expectFail(list(q, node, {}, "spring"), "ROOM_NOT_FOUND");
    await expectFail(list(q, node, {}, "nope"), "ROOM_NOT_FOUND");
    await as(q, "철수");
    const sqldNode = await nodeId(q, "sqld", "데이터 모델링 요약 노트");
    assertEquals(await failHint(list(q, sqldNode, {}, "sqld"), "NOT_MEMBER"), { state: "pending" });
    await asAnon(q);
    await expectFail(list(q, node), "AUTH_REQUIRED");
  } },
  { name: "write matrix (D3): leader · ACTIVE write; INACTIVE → NOT_MEMBER(inactive) · canWrite false · writeBlock inactive", run: async (q) => {
    const node = await leaf(q);
    for (const nick of ["민수", "철수"]) {
      await as(q, nick);
      assertEquals((await create(q, node, `${nick} 댓글`)).comment.mine, true);
      assertEquals([(await list(q, node)).canWrite, (await list(q, node)).writeBlock], [true, null]);
    }
    await as(q, "도윤");
    assertEquals(await failHint(create(q, node, "x"), "NOT_MEMBER"), { state: "inactive" });
    const l = await list(q, node);
    assertEquals([l.canWrite, l.writeBlock, l.items.every((c: Row) => !c.canEdit && !c.canDelete)], [false, "inactive", true]);
  } },
  { name: "targets (D1): round · task leaf · designated leaf ok; bundle · personal goal · other room's node → NODE_NOT_FOUND", run: async (q) => {
    await as(q, "지은");
    for (const n of [await round(q), await leaf(q), await nodeId(q, "aws", "EC2 인스턴스 유형 정리")]) {
      assertEquals((await create(q, n, "ok")).comment.body, "ok");
    }
    await expectFail(create(q, await nodeId(q, "aws", "로드밸런서 비교"), "x"), "NODE_NOT_FOUND");
    await expectFail(list(q, await nodeId(q, "aws", "로드밸런서 비교")), "NODE_NOT_FOUND");
    const p = await rpc(q, "public.personal_create('aws', $1::bigint, '내 목표', null, null)", [await round(q)]);
    await expectFail(create(q, p.id, "x"), "NODE_NOT_FOUND");
    await expectFail(list(q, await nodeId(q, "spring", "섹션 1~5 정리 노트")), "NODE_NOT_FOUND");
    await expectFail(list(q, "999999"), "NODE_NOT_FOUND");
  } },
]);

cases("comments 0041 · Comment JSON · validation · limits", db, [
  { name: "shape: id string · author · ISO times · edited · mine/canEdit/canDelete by viewer", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    const { comment: c, people } = await create(q, node, "  안녕하세요  \n");
    assertEquals([typeof c.id, c.body, c.author.nickname, c.edited, c.mine, c.canEdit, c.canDelete], ["string", "안녕하세요", "지은", false, true, true, true]);
    assert(/Z$/.test(c.createdAt) && /Z$/.test(c.updatedAt));
    assertEquals(people, {});
    await as(q, "철수");
    assertEquals((({ mine, canEdit, canDelete }) => [mine, canEdit, canDelete])((await list(q, node)).items[0]), [false, false, false]);
    await as(q, "민수");   // 그룹장: 삭제만(D8)
    assertEquals((({ mine, canEdit, canDelete }) => [mine, canEdit, canDelete])((await list(q, node)).items[0]), [false, false, true]);
    const l = await list(q, node);
    assertEquals([l.total, l.hasOlder, l.hasNewer, l.locked, l.target], [1, false, false, null, null]);
    assertEquals(l.limits.bodyMax, 2000);
  } },
  { name: "body: blank → VALIDATION_FAILED(body) · 2000 display chars ok (token = 1) · 2001 fails · >10 mentions fail", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    for (const b of ["", "   \n\t ", "\u00a0\u3000\r\n"]) assertEquals((await failHint(create(q, node, b), "VALIDATION_FAILED")).field, "body");
    await expectFail(rpc(q, "public.comment_create('aws', $1::bigint, null)", [node]), "VALIDATION_FAILED");
    assertEquals((await create(q, node, "가".repeat(2000))).comment.body.length, 2000);
    assertEquals(await failHint(create(q, node, "가".repeat(2001)), "VALIDATION_FAILED"), { field: "body", max: 2000 });
    const cs = await uidOf(q, "철수");
    assertEquals((await create(q, node, "가".repeat(1999) + tok(cs))).comment.body.length, 1999 + 39);   // 토큰은 1자
    const many = await Promise.all(Array.from({ length: 11 }, () => newUser(q)));
    assertEquals(await failHint(create(q, node, many.map(tok).join(" ")), "VALIDATION_FAILED"), { field: "mentions", max: 10 });
    // 같은 사람 반복은 1명 · 대문자 uuid·깨진 토큰은 평문
    const r = await create(q, node, `${tok(cs)} ${tok(cs)} <@${cs.toUpperCase()}> <@nope>`);
    assertEquals((await one(q, "select mention_ids::text[] as m from public.node_comments where id = $1::bigint", [r.comment.id])).m, [cs]);
  } },
  { name: "per-node limit 1000 live comments → COMMENT_LIMIT · deleted ones don't count", run: async (q) => {
    const node = await leaf(q);
    await bulk(q, node, "하나", 1000);
    await as(q, "지은");
    assertEquals(await failHint(create(q, node, "x"), "COMMENT_LIMIT"), { kind: "perNode", max: 1000 });
    await q("update public.node_comments set deleted_at = now(), body = '' where id = (select min(id) from public.node_comments where node_id = $1::bigint)", [node]);
    assertEquals((await create(q, node, "자리 생김")).comment.body, "자리 생김");
  } },
  { name: "rate limit (D18): 11th in a minute → RATE_LIMITED(retryAfterSec) · counts deleted · per hour 120", run: async (q) => {
    const node = await leaf(q);
    await setNow(q, "2026-10-12T10:00:00+09:00");
    await as(q, "지은");
    const first = await create(q, node, "1");
    await del(q, first.comment.id);
    for (let i = 2; i <= 10; i++) await create(q, node, String(i));
    const h = await failHint(create(q, node, "11"), "RATE_LIMITED");
    assertEquals([h.window, h.retryAfterSec], ["minute", 60]);
    await as(q, "철수");
    assertEquals((await create(q, node, "다른 사람은 됨")).comment.body, "다른 사람은 됨");
    await setNow(q, "2026-10-12T10:01:30+09:00");
    await as(q, "지은");
    assertEquals((await create(q, node, "1분 지남")).comment.body, "1분 지남");
    await q(`update public.node_comments set created_at = timestamptz '2026-10-12T09:30:00+09:00'
             where author_id = $1::uuid`, [await uidOf(q, "지은")]);
    await q(`insert into public.node_comments (room_id, node_id, author_id, body, created_at)
             select g.room_id, g.id, $2::uuid, 'x', timestamptz '2026-10-12T09:30:00+09:00' from public.goal_nodes g, generate_series(1, 109) where g.id = $1::bigint`,
            [node, await uidOf(q, "지은")]);
    const hh = await failHint(create(q, node, "시간 상한"), "RATE_LIMITED");
    assertEquals([hh.window, hh.retryAfterSec], ["hour", 30 * 60 - 90]);
  } },
]);

cases("comments 0041 · edit · delete · room state", db, [
  { name: "update: author only (leader too → NOT_AUTHOR) · edited flag only on body change · deleted/foreign → COMMENT_NOT_FOUND", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    const c = (await create(q, node, "원문")).comment;
    await as(q, "민수");
    await expectFail(update(q, c.id, "그룹장 수정"), "NOT_AUTHOR");
    await as(q, "철수");
    await expectFail(update(q, c.id, "남 수정"), "NOT_AUTHOR");
    await as(q, "지은");
    await q("update public.node_comments set created_at = created_at - interval '1 hour', updated_at = updated_at - interval '1 hour'");
    assertEquals((await update(q, c.id, "  원문 ")).comment.edited, false);   // 정리 후 같은 본문 = 수정 아님
    assertEquals((await update(q, c.id, "고친 글")).comment.edited, true);
    await as(q, "태호");
    const other = (await create(q, await nodeId(q, "react", (await one(q, `select n.title from public.goal_nodes n join public.rooms r on r.id = n.room_id
      where r.slug = 'react' and n.task_type = 'COMMON' order by n.id limit 1`)).title), "react", "react")).comment;
    await as(q, "지은");
    await expectFail(update(q, other.id, "x"), "COMMENT_NOT_FOUND");
    await expectFail(update(q, "999999", "x"), "COMMENT_NOT_FOUND");
    await del(q, c.id);
    await expectFail(update(q, c.id, "x"), "COMMENT_NOT_FOUND");
    await expectFail(del(q, c.id), "COMMENT_NOT_FOUND");
  } },
  { name: "delete: author or leader (D8) · others NOT_AUTHOR · soft delete hides from list · body/mentions cleared", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    const a = (await create(q, node, `a ${tok(await uidOf(q, "철수"))}`)).comment;
    const b = (await create(q, node, "b")).comment;
    await as(q, "철수");
    await expectFail(del(q, a.id), "NOT_AUTHOR");
    await as(q, "지은");
    await del(q, a.id);
    await as(q, "민수");
    await del(q, b.id);
    const l = await list(q, node);
    assertEquals([l.items, l.total], [[], 0]);
    const rows = await q("select body, mention_ids::text, deleted_at is not null as d, deleted_by from public.node_comments where node_id = $1::bigint order by id", [node]);
    assertEquals(rows.map((r) => [r.body, r.mention_ids, r.d]), [["", "{}", true], ["", "{}", true]]);
    assertEquals(rows[1].deleted_by, await uidOf(q, "민수"));
  } },
  { name: "ENDED room (D20): list readable · canWrite false · writeBlock ended · create/update/delete ROOM_NOT_EDITABLE (leader too)", run: async (q) => {
    const node = (await one(q, `select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id
                                where r.slug = 'algo' and n.task_type is not null order by n.id limit 1`)).id as string;
    const algo = await roomId(q, "algo");
    await q("insert into public.node_comments (room_id, node_id, author_id, body) values ($1, $2::bigint, $3::uuid, '옛 댓글')", [algo, node, await uidOf(q, "보람")]);
    const id = (await one(q, "select id::text as id from public.node_comments where node_id = $1::bigint", [node])).id as string;
    await as(q, "보람");
    const l = await list(q, node, {}, "algo");
    assertEquals([l.items.length, l.canWrite, l.writeBlock, l.items[0].canEdit], [1, false, "ended", false]);
    assertEquals((await failHint(create(q, node, "x", "algo"), "ROOM_NOT_EDITABLE")).reason, "ended");
    await expectFail(update(q, id, "x", "algo"), "ROOM_NOT_EDITABLE");
    await as(q, "현우");
    await expectFail(del(q, id, "algo"), "ROOM_NOT_EDITABLE");
  } },
  { name: "archived room · archived node: read-only", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    const c = (await create(q, node, "x")).comment;
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [node]);
    assertEquals((await list(q, node)).writeBlock, "archived_node");
    assertEquals((await failHint(create(q, node, "y"), "ROOM_NOT_EDITABLE")).reason, "archived_node");
    await expectFail(del(q, c.id), "ROOM_NOT_EDITABLE");
    await q("update public.goal_nodes set archived_at = null where id = $1::bigint", [node]);
    await q("update public.rooms set archived_at = now() where slug = 'aws'");
    assertEquals((await list(q, node)).writeBlock, "ended");
    await expectFail(update(q, c.id, "z"), "ROOM_NOT_EDITABLE");
  } },
  { name: "node delete cascades comments (D21)", run: async (q) => {
    await as(q, "민수");
    await q("select public.node_create('aws', $1::bigint, '지울 과제', null, 'common', '2026-10-08', '2026-10-14')", [await round(q)]);
    const node = await nodeId(q, "aws", "지울 과제");
    await as(q, "지은");
    await create(q, node, "x");
    await q("delete from public.goal_nodes where id = $1::bigint", [node]);
    assertEquals((await one(q, "select count(*)::int as c from public.node_comments")).c, 0);
  } },
]);

cases("comments 0041 · paging (D17)", db, [
  { name: "default latest 50 oldest→newest · before cursor · hasOlder", run: async (q) => {
    const node = await leaf(q);
    await bulk(q, node, "하나", 120);
    await as(q, "지은");
    const p1 = await list(q, node);
    assertEquals([p1.items.length, p1.total, p1.hasOlder, p1.items[49].body, p1.items[0].body], [50, 120, true, "댓글 120", "댓글 71"]);
    const p2 = await list(q, node, { before: p1.items[0].id });
    assertEquals([p2.items.length, p2.items[0].body, p2.items[49].body, p2.hasOlder], [50, "댓글 21", "댓글 70", true]);
    const p3 = await list(q, node, { before: p2.items[0].id });
    assertEquals([p3.items.length, p3.items[0].body, p3.hasOlder], [20, "댓글 1", false]);
  } },
  { name: "from: target..newest (≤200) · >200 → 100 before + target + 99 after, hasNewer · deleted/missing target → state + default page", run: async (q) => {
    const node = await leaf(q);
    await bulk(q, node, "하나", 400);
    const ids = (await q("select id::text as id from public.node_comments where node_id = $1::bigint order by id", [node])).map((r) => r.id as string);
    await as(q, "지은");
    const near = await list(q, node, { from: ids[250] });
    assertEquals([near.items.length, near.items[0].id, near.hasOlder, near.hasNewer, near.target], [150, ids[250], true, false, { id: ids[250], state: "ok" }]);
    const far = await list(q, node, { from: ids[50] });
    // 앞쪽은 50개뿐 → 50 + 그 댓글 + 뒤 99 = 150
    assertEquals([far.items.length, far.items[0].id, far.items[50].id, far.items[149].id, far.hasOlder, far.hasNewer], [150, ids[0], ids[50], ids[149], false, true]);
    const mid = await list(q, node, { from: ids[150] });
    assertEquals([mid.items.length, mid.items[0].id, mid.items[100].id, mid.items[199].id, mid.hasOlder, mid.hasNewer], [200, ids[50], ids[150], ids[249], true, true]);
    await q("update public.node_comments set deleted_at = now(), body = '' where id = $1::bigint", [ids[10]]);
    const gone = await list(q, node, { from: ids[10] });
    assertEquals([gone.target, gone.items.length], [{ id: ids[10], state: "deleted" }, 50]);
    assertEquals((await list(q, node, { from: "999999" })).target, { id: "999999", state: "missing" });
    // 다른 노드의 댓글 id = missing
    await create(q, await round(q), "회차 댓글");
    const other = (await one(q, "select max(id)::text as id from public.node_comments")).id as string;
    assertEquals((await list(q, node, { from: other })).target.state, "missing");
  } },
]);

cases("comments 0041 · exam lock (D4)", db, [
  { name: "assignee before reveal: locked list · COMMENT_LOCKED write · submit (after_submit) unlocks · editors/leader never locked", run: async (q) => {
    await as(q, "민수");
    const bundle = (await one(q, "select parent_id::text as id from public.goal_nodes where id = $1::bigint", [await nodeId(q, "aws", "ALB vs NLB 실습")])).id;
    await q("select public.node_create('aws', $1::bigint, '3주차 시험', null, 'common', '2026-10-15', '2026-10-21')", [bundle]);
    const node = await nodeId(q, "aws", "3주차 시험");
    await q("select public.exam_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ reveal: "after_submit", questions: [{ type: "ox", prompt: "S3 는 리전 서비스다.", answer: false }] })]);
    await q("select public.exam_publish('aws', $1::bigint)", [node]);
    await setToday(q, "2026-10-16");
    await create(q, node, "정답은 X 예요");
    await as(q, "지은");
    const l = await list(q, node);
    assertEquals([l.items, l.people, l.total, l.locked, l.canWrite, l.writeBlock], [[], {}, 1, { reason: "exam" }, false, "exam_locked"]);
    assertEquals(await failHint(create(q, node, "x"), "COMMENT_LOCKED"), { reason: "exam" });
    await q("select public.exam_submit($1::bigint)", [node]);
    assertEquals([(await list(q, node)).items.length, (await list(q, node)).locked], [1, null]);
    // 편집자 멤버는 미제출이어도 열림
    await q("update public.room_members set can_edit_curriculum = true where room_id = $1 and user_id = $2::uuid", [await roomId(q, "aws"), await uidOf(q, "철수")]);
    await as(q, "철수");
    assertEquals((await list(q, node)).locked, null);
    await as(q, "하나");
    assertEquals((await list(q, node)).locked, { reason: "exam" });
    // 시험 리프 멘션 알림엔 발췌가 없다
    await as(q, "민수");
    await create(q, node, `${tok(await uidOf(q, "하나"))} 정답은 X`);
    assertEquals((await mentions(q, "하나"))[0].body, "「3주차 시험」");
  } },
  { name: "after_deadline: submitted assignee stays locked until deadline passes (same reveal predicate as exam_view)", run: async (q) => {
    await as(q, "민수");
    const bundle = (await one(q, "select parent_id::text as id from public.goal_nodes where id = $1::bigint", [await nodeId(q, "aws", "ALB vs NLB 실습")])).id;
    await q("select public.node_create('aws', $1::bigint, '마감 공개 시험', null, 'common', '2026-10-15', '2026-10-21')", [bundle]);
    const node = await nodeId(q, "aws", "마감 공개 시험");
    await q("select public.exam_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ reveal: "after_deadline", questions: [{ type: "ox", prompt: "p", answer: true }] })]);
    await q("select public.exam_publish('aws', $1::bigint)", [node]);
    await setToday(q, "2026-10-16");
    await as(q, "지은");
    await q("select public.exam_submit($1::bigint)", [node]);
    assertEquals((await list(q, node)).locked, { reason: "exam" });
    await setToday(q, "2026-10-22");
    assertEquals((await list(q, node)).locked, null);
  } },
  { name: "review I1: ENDED / archived room doesn't unlock an unsubmitted assignee (lock checked apart from writeBlock)", run: async (q) => {
    await as(q, "민수");
    const bundle = (await one(q, "select parent_id::text as id from public.goal_nodes where id = $1::bigint", [await nodeId(q, "aws", "ALB vs NLB 실습")])).id;
    await q("select public.node_create('aws', $1::bigint, '종료 방 시험', null, 'common', '2026-10-15', '2026-10-21')", [bundle]);
    const node = await nodeId(q, "aws", "종료 방 시험");
    await q("select public.exam_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ reveal: "after_submit", questions: [{ type: "ox", prompt: "p", answer: true }] })]);
    await q("select public.exam_publish('aws', $1::bigint)", [node]);
    await setToday(q, "2026-10-16");
    await create(q, node, "정답은 O");
    await q("update public.rooms set status = 'ENDED' where slug = 'aws'");
    await as(q, "지은");
    const l = await list(q, node);
    assertEquals([l.items, l.locked, l.canWrite, l.writeBlock, l.total], [[], { reason: "exam" }, false, "ended", 1]);
    await q("update public.rooms set status = 'ACTIVE', archived_at = now() where slug = 'aws'");
    assertEquals([(await list(q, node)).locked, (await list(q, node)).items], [{ reason: "exam" }, []]);
    await as(q, "민수");   // 편집자는 그대로 열림
    assertEquals((await list(q, node)).items.length, 1);
  } },
]);

cases("comments 0041 · mentions → MENTIONED notifications (D10~D15)", db, [
  { name: "kind registered last · render · link with #comment-{id} (leaf ?task= · round ?tab=curriculum&item=)", run: async (q) => {
    const k = (await one(q, "select public.notification_kinds() as k")).k as string[];
    assertEquals(k.slice(-2), ["NOTICE_POSTED", "MENTIONED"]);
    const node = await leaf(q);
    const rnd = await round(q);
    await as(q, "지은");
    const cs = await uidOf(q, "철수");
    const a = (await create(q, node, `${tok(cs)} 이거 봐 주세요\n\n**굵게**`)).comment;
    const b = (await create(q, rnd, `회차 얘기 ${tok(cs)}`)).comment;
    const got = await mentions(q, "철수");
    assertEquals(got.map((n) => [n.title, n.body, n.link, n.dedupe_key]), [
      ["지은님이 댓글에서 회원님을 언급했어요", "「VPC 실습」 · @철수 이거 봐 주세요 **굵게**", `/my-study/aws?task=${node}#comment-${a.id}`, `MENTIONED:${a.id}:${cs}`],
      ["지은님이 댓글에서 회원님을 언급했어요", "「2주차」 · 회차 얘기 @철수", `/my-study/aws?tab=curriculum&item=${rnd}#comment-${b.id}`, `MENTIONED:${b.id}:${cs}`],
    ]);
    // 7인자 notify_publish 는 해시 없이 그대로
    const aws = await roomId(q, "aws");
    assertEquals((await one(q, "select public.notify_publish('MENTIONED', $1::bigint, $2::bigint, null, array[$3::uuid], 'T7', '{}') as n", [aws, node, cs])).n, 1);
    assertEquals((await one(q, "select link from public.notifications where dedupe_key = $1", [`T7:${cs}`])).link, `/my-study/aws?task=${node}`);
  } },
  { name: "excerpt ≤80 chars · unknown uid → @알 수 없음 · people map excludes unrelated uuids", run: async (q) => {
    const node = await leaf(q);
    const stranger = await newUser(q);
    await as(q, "지은");
    const r = await create(q, node, `${tok(await uidOf(q, "철수"))} ${tok(stranger)} ${"가".repeat(100)}`);
    assertEquals(Object.keys(r.people), [await uidOf(q, "철수")]);
    assertEquals(r.people[await uidOf(q, "철수")].nickname, "철수");
    const body = (await mentions(q, "철수"))[0].body as string;
    assert(body.startsWith("「VPC 실습」 · @철수 @알 수 없음 가"), body);
    assertEquals(body.length, "「VPC 실습」 · ".length + 80);
    assert(body.endsWith("…"));
    assertEquals((await mentions(q, "서연")).length, 0);
    assertEquals((await q("select 1 from public.notifications where user_id = $1::uuid", [stranger])).length, 0);
    // list 의 people 도 같은 규칙
    const l = await list(q, node);
    assertEquals(Object.keys(l.people), [await uidOf(q, "철수")]);
  } },
  { name: "review M1: people map = leader · ACTIVE · INACTIVE only (PENDING member's nickname hidden)", run: async (q) => {
    const node = await leaf(q);
    const pend = await newUser(q);
    await q("update public.profiles set nickname = '대기자' where id = $1::uuid", [pend]);
    await q("insert into public.room_members (room_id, user_id, role, status) values ($1, $2::uuid, 'MEMBER', 'PENDING')", [await roomId(q, "aws"), pend]);
    const [ds, ms] = await Promise.all([uidOf(q, "도윤"), uidOf(q, "민수")]);
    await as(q, "지은");
    const r = await create(q, node, `${tok(pend)} ${tok(ds)} ${tok(ms)}`);
    assertEquals(Object.keys(r.people).sort(), [ds, ms].sort());
    assertEquals((await mentions(q, "민수"))[0].body, "「VPC 실습」 · @알 수 없음 @도윤 @민수");
  } },
  { name: "review M4: edit drops removed people's unread notifications · re-renders remaining unread excerpts · read ones untouched", run: async (q) => {
    const node = await leaf(q);
    const [cs, hn, ms] = await Promise.all([uidOf(q, "철수"), uidOf(q, "하나"), uidOf(q, "민수")]);
    await as(q, "지은");
    const c = (await create(q, node, `${tok(cs)} ${tok(hn)} ${tok(ms)} 옛 욕설`)).comment;
    await q("update public.notifications set read_at = now() where dedupe_key = $1", [`MENTIONED:${c.id}:${ms}`]);
    await update(q, c.id, `${tok(hn)} ${tok(ms)} 고친 글`);
    assertEquals(await mentions(q, "철수"), []);
    assertEquals((await mentions(q, "하나")).map((n) => n.body), ["「VPC 실습」 · @하나 @민수 고친 글"]);
    assertEquals((await mentions(q, "민수")).map((n) => n.body), ["「VPC 실습」 · @철수 @하나 @민수 옛 욕설"]);   // 이미 읽은 건 그대로
  } },
  { name: "recipients: duplicate tokens → 1 · self 0 · INACTIVE 0 · PENDING/outsider 0 · leader yes", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    const [js, cs, ds, ms, sy] = await Promise.all(["지은", "철수", "도윤", "민수", "서연"].map((n) => uidOf(q, n)));
    await create(q, node, `${tok(cs)} ${tok(cs)} ${tok(js)} ${tok(ds)} ${tok(ms)} ${tok(sy)}`);
    assertEquals((await mentions(q, "철수")).length, 1);
    assertEquals((await mentions(q, "지은")).length, 0);
    assertEquals((await mentions(q, "도윤")).length, 0);
    assertEquals((await mentions(q, "민수")).length, 1);
    assertEquals((await mentions(q, "서연")).length, 0);
  } },
  { name: "edit notifies only newly added people · re-adding a removed person doesn't re-notify (dedupe)", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    const [cs, hn] = await Promise.all([uidOf(q, "철수"), uidOf(q, "하나")]);
    const c = (await create(q, node, `${tok(cs)} 안녕`)).comment;
    await update(q, c.id, `${tok(cs)} ${tok(hn)} 안녕`);
    assertEquals([(await mentions(q, "철수")).length, (await mentions(q, "하나")).length], [1, 1]);
    await update(q, c.id, "아무도 없음");
    await update(q, c.id, `${tok(hn)} 다시`);
    assertEquals((await mentions(q, "하나")).length, 1);
    const r = await update(q, c.id, `${tok(hn)} 다시`);
    assertEquals(Object.keys(r.people), [hn]);
  } },
  { name: "delete removes the comment's unread MENTIONED notifications only (read ones stay)", run: async (q) => {
    const node = await leaf(q);
    await as(q, "지은");
    const [cs, hn] = await Promise.all([uidOf(q, "철수"), uidOf(q, "하나")]);
    const c = (await create(q, node, `${tok(cs)} ${tok(hn)}`)).comment;
    const keep = (await create(q, node, `${tok(cs)} 다른 댓글`)).comment;
    await q("update public.notifications set read_at = now() where user_id = $1::uuid and dedupe_key = $2", [hn, `MENTIONED:${c.id}:${hn}`]);
    await as(q, "민수");
    await del(q, c.id);
    assertEquals((await mentions(q, "철수")).map((n) => n.dedupe_key), [`MENTIONED:${keep.id}:${cs}`]);
    assertEquals((await mentions(q, "하나")).length, 1);
  } },
]);
