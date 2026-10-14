// 0011 커리큘럼 편집 위임 — 그룹장이 기본, 그룹장이 허락한 ACTIVE 멤버도 node_* 를 쓸 수 있다
import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { mkLeaf, mkRoom, mkRound, nodeByTitle, roomId } from "./_curriculum-helpers.ts";
import { cases, one, type Q, type Row, uidOf } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const grant = (q: Q, slug: string, user: string, allow: boolean) =>
  one(q, "select public.member_set_curriculum_editor($1, $2::uuid, $3) as m", [slug, user, allow]).then((r) => r.m as Row);
const flagOf = async (q: Q, slug: string, user: string) =>
  (await one(q, `select m.can_edit_curriculum as f from public.room_members m join public.rooms r on r.id = m.room_id
                 where r.slug = $1 and m.user_id = $2::uuid`, [slug, user])).f as boolean;
const cur = (q: Q, slug: string) => one(q, "select public.curriculum_get($1, true) as c", [slug]).then((r) => r.c as Row);
const roomGet = (q: Q, slug: string) => one(q, "select public.room_get($1) as d", [slug]).then((r) => r.d as Row);

/** aws 의 모든 커리큘럼 쓰기 RPC — 하나라도 막히면 실패 */
async function everyMutation(q: Q) {
  const aws = await roomId(q, "aws");
  let c = await one(q, "select public.node_create('aws', null, '위임 회차', null, null, '2026-12-01', '2026-12-07') as c").then((r) => r.c as Row);
  const round = await nodeByTitle(q, aws, "위임 회차");
  await q("select public.node_create('aws', $1, '위임 과제 A', null, 'common', '2026-12-01', '2026-12-03')", [round]);
  await q("select public.node_create('aws', $1, '위임 과제 B', null, 'common', '2026-12-04', '2026-12-07')", [round]);
  const a = await nodeByTitle(q, aws, "위임 과제 A");
  const b = await nodeByTitle(q, aws, "위임 과제 B");
  const jieun = await uidOf(q, "지은");
  await q("select public.node_update('aws', $1, $2::jsonb)", [a, JSON.stringify({
    title: "위임 과제 A2", descriptionMd: "설명", startDate: "2026-12-02", endDate: "2026-12-03", taskType: "designated", assigneeIds: [jieun] })]);
  await q("select public.node_update('aws', $1, $2::jsonb)", [round, JSON.stringify({ label: "9주차" })]);
  await q("select public.node_indent('aws', $1)", [b]);
  await q("select public.node_outdent('aws', $1)", [b]);
  await q("select public.node_move('aws', $1, $2, 0)", [b, round]);
  await q("select public.node_archive('aws', $1)", [b]);
  await q("select public.node_unarchive('aws', $1)", [b]);
  c = await one(q, "select public.node_delete('aws', $1) as c", [b]).then((r) => r.c as Row);
  const titles = (c.nodes as Row[]).map((n) => n.title);
  assertEquals([titles.includes("위임 과제 A2"), titles.includes("위임 과제 B")], [true, false]);
}

async function everyMutationDenied(q: Q, code: string) {
  const aws = await roomId(q, "aws");
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  const vpc = await nodeByTitle(q, aws, "VPC 실습");
  const round = await nodeByTitle(q, aws, "IAM·VPC");
  await expectFail(q("select public.node_create('aws', null, 'x')"), code);
  await expectFail(q("select public.node_update('aws', $1, '{\"title\":\"x\"}'::jsonb)", [iam]), code);
  await expectFail(q("select public.node_delete('aws', $1)", [vpc]), code);
  await expectFail(q("select public.node_archive('aws', $1)", [vpc]), code);
  await expectFail(q("select public.node_unarchive('aws', $1)", [vpc]), code);
  await expectFail(q("select public.node_move('aws', $1, $2, 0)", [vpc, round]), code);
  await expectFail(q("select public.node_indent('aws', $1)", [vpc]), code);
  await expectFail(q("select public.node_outdent('aws', $1)", [vpc]), code);
}

cases("curriculum editors", db, [
  { name: "leader edits; non-granted member → NOT_CURRICULUM_EDITOR (Korean detail) on every node_* RPC", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await everyMutation(q);
    await asUser(q, await uidOf(q, "철수"));
    await everyMutationDenied(q, "NOT_CURRICULUM_EDITOR");
    try { await q("select public.node_create('aws')"); } catch (e) { assertEquals((e as Error & { detail?: string }).detail, "커리큘럼 편집 권한이 없어요"); }
  } },

  { name: "outsider: private room → ROOM_NOT_FOUND, readable public room → NOT_CURRICULUM_EDITOR", run: async (q) => {
    await asUser(q, await uidOf(q, "서연"));
    await expectFail(q("select public.node_create('spring')"), "ROOM_NOT_FOUND");
    await everyMutationDenied(q, "NOT_CURRICULUM_EDITOR");
  } },

  { name: "granted ACTIVE member can run every curriculum mutation; revoke takes it back", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    await asUser(q, await uidOf(q, "민수"));
    const m = await grant(q, "aws", chulsu, true);
    assertEquals([m.userId, m.nickname, m.role, m.status, m.canEditCurriculum], [chulsu, "철수", "member", "active", true]);
    assertEquals((await grant(q, "aws", chulsu, true)).canEditCurriculum, true);          // 멱등
    await asUser(q, chulsu);
    await everyMutation(q);
    await asUser(q, await uidOf(q, "민수"));
    assertEquals((await grant(q, "aws", chulsu, false)).canEditCurriculum, false);
    assertEquals((await grant(q, "aws", chulsu, false)).canEditCurriculum, false);       // 멱등
    await asUser(q, chulsu);
    await everyMutationDenied(q, "NOT_CURRICULUM_EDITOR");
  } },

  { name: "editor stays non-leader: cannot grant, change room settings, see/kick members", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    const jieun = await uidOf(q, "지은");
    await asUser(q, await uidOf(q, "민수"));
    await grant(q, "aws", chulsu, true);
    await asUser(q, chulsu);
    await expectFail(grant(q, "aws", jieun, true), "NOT_LEADER");
    await expectFail(grant(q, "aws", chulsu, false), "NOT_LEADER");
    await expectFail(q("select public.room_update('aws', '{\"title\":\"x\"}'::jsonb)"), "NOT_LEADER");
    await expectFail(q("select public.settings_get('aws')"), "NOT_LEADER");
    await expectFail(q("select public.room_members_get('aws')"), "NOT_LEADER");
    await expectFail(q("select public.member_deactivate('aws', $1::uuid)", [jieun]), "NOT_LEADER");
    await expectFail(q("select public.invite_get('aws')"), "NOT_LEADER");
    await expectFail(q("select public.room_archive('aws')"), "NOT_LEADER");
  } },

  { name: "member_set_curriculum_editor guards: leader target, non-ACTIVE target, outsider, anon", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    await asUser(q, minsu);
    await expectFail(grant(q, "aws", minsu, true), "CANNOT_TARGET_LEADER");
    await expectFail(grant(q, "aws", await uidOf(q, "도윤"), true), "MEMBER_NOT_ACTIVE");    // INACTIVE
    await expectFail(grant(q, "aws", await uidOf(q, "서연"), true), "MEMBER_NOT_ACTIVE");    // 행 없음
    await asUser(q, await uidOf(q, "서연"));
    await expectFail(grant(q, "spring", minsu, true), "ROOM_NOT_FOUND");
    await expectFail(grant(q, "nope-slug", minsu, true), "ROOM_NOT_FOUND");
    await asAnon(q);
    await expectFail(grant(q, "aws", minsu, true), "AUTH_REQUIRED");
  } },

  { name: "kick (member_deactivate) clears the flag", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    await asUser(q, await uidOf(q, "민수"));
    await grant(q, "aws", chulsu, true);
    const pv = await one(q, "select public.member_deactivate_preview('aws', $1::uuid) as p", [chulsu]);
    const dec = (pv.p.tasks as Row[]).map((t) => ({ nodeId: t.nodeId, action: "exclude" }));
    await q("select public.member_deactivate('aws', $1::uuid, $2::jsonb)", [chulsu, JSON.stringify(dec)]);
    assertEquals(await flagOf(q, "aws", chulsu), false);
    await asUser(q, chulsu);
    await everyMutationDenied(q, "NOT_CURRICULUM_EDITOR");
  } },

  { name: "leave clears the flag and rejoin starts without it", run: async (q) => {
    const room = await mkRoom(q, "서연");
    await mkLeaf(q, await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07"), "과제", "COMMON", "2026-11-01", "2026-11-07");
    await q("select public.room_open_recruit($1)", [room.slug]);
    const jieun = await uidOf(q, "지은");
    await asUser(q, jieun);
    await q("select public.room_join($1)", [room.slug]);
    await asUser(q, room.leader);
    await grant(q, room.slug, jieun, true);
    assertEquals(await flagOf(q, room.slug, jieun), true);
    await asUser(q, jieun);
    await q("select public.node_create($1, null, '지은 회차')", [room.slug]);         // RECRUIT 에서도 위임 편집 가능
    await q("select public.room_leave($1)", [room.slug]);
    assertEquals(await flagOf(q, room.slug, jieun), false);
    await q("select public.room_join($1)", [room.slug]);
    assertEquals(await flagOf(q, room.slug, jieun), false);
    await expectFail(q("select public.node_create($1)", [room.slug]), "NOT_CURRICULUM_EDITOR");
  } },

  { name: "flag on a non-ACTIVE row (PENDING / INACTIVE, set directly) never grants editing", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    const aws = await roomId(q, "aws");
    await q("insert into public.room_members (room_id, user_id, role, status, can_edit_curriculum) values ($1, $2, 'MEMBER', 'PENDING', true)", [aws, seoyeon]);
    await asUser(q, seoyeon);
    await everyMutationDenied(q, "NOT_CURRICULUM_EDITOR");
    const doyun = await uidOf(q, "도윤");
    await q("update public.room_members set can_edit_curriculum = true where room_id = $1 and user_id = $2", [aws, doyun]);
    await asUser(q, doyun);
    await everyMutationDenied(q, "NOT_CURRICULUM_EDITOR");
  } },

  { name: "reads: room_get / curriculum_get myPermissions + members, room_members_get items expose canEditCurriculum", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    await asUser(q, await uidOf(q, "민수"));
    await grant(q, "aws", chulsu, true);
    const flags = (ms: Row[]) => Object.fromEntries(ms.map((m) => [m.nickname, m.canEditCurriculum]));
    const want = { 민수: true, 지은: false, 철수: true, 하나: false, 도윤: false };
    let d = await roomGet(q, "aws");
    assertEquals([d.me, d.myPermissions], [{ state: "leader" }, { canEditCurriculum: true }]);
    assertEquals(flags(d.members), want);
    assertEquals(flags((await one(q, "select public.room_members_get('aws') as r")).r.items), want);
    let c = await cur(q, "aws");
    assertEquals(c.myPermissions, { canEditCurriculum: true });
    assertEquals(flags(c.members), want);

    await asUser(q, chulsu);
    d = await roomGet(q, "aws");
    assertEquals([d.me, d.myPermissions], [{ state: "active" }, { canEditCurriculum: true }]);
    assertEquals((await cur(q, "aws")).myPermissions, { canEditCurriculum: true });
    await asUser(q, await uidOf(q, "지은"));
    assertEquals((await roomGet(q, "aws")).myPermissions, { canEditCurriculum: false });
    assertEquals((await cur(q, "aws")).myPermissions, { canEditCurriculum: false });
    await asUser(q, await uidOf(q, "서연"));
    assertEquals((await roomGet(q, "aws")).myPermissions, { canEditCurriculum: false });
    await asAnon(q);
    assertEquals((await roomGet(q, "aws")).myPermissions, { canEditCurriculum: false });
    c = await cur(q, "aws");
    assertEquals(c.myPermissions, { canEditCurriculum: false });
    assertEquals(flags(c.members), want);
  } },
]);
