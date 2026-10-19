// 0028 (2026-10-19 백로그 F) — ① 보관된 방의 승인 대기 신청 취소 ② 묶음째 옮길 때 담당자별 일정 변경 알림 묶기
import { assert, assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => { await asUser(q, await uidOf(q, nick)); };
const notes = (q: Q, nick: string, kind: string) => uidOf(q, nick).then((u) =>
  q(`select title, body, link, read_at, dedupe_key, node_id::text as node_id from public.notifications
     where user_id = $1::uuid and kind = $2 and created_at >= now() order by id`, [u, kind]));

/** aws 3주차 묶음 "로드밸런서 비교"(공통 과제 ALB 1개)에 지은 단독 지정 과제 + 지은 지정 보관 과제를 더한다 */
const bundle = async (q: Q) => {
  const grp = await nodeId(q, "aws", "로드밸런서 비교");
  const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
  const range = (await one(q, "select start_date::text as s, end_date::text as e from public.goal_nodes where id = $1::bigint", [grp])) as Row;
  await as(q, "민수");
  const jieun = await uidOf(q, "지은");
  const mk = async (title: string) => {
    const c = (await one(q, "select public.node_create('aws', $1::bigint, $2, null, 'designated', $3::date, $4::date) as c", [grp, title, range.s, range.e])).c as Row;
    const id = c.nodes.find((n: Row) => n.title === title).id as string;
    await q("select public.node_update('aws', $1::bigint, $2::jsonb)", [id, JSON.stringify({ assigneeIds: [jieun] })]);
    return id;
  };
  const nlb = await mk("NLB 헬스체크");
  const old = await mk("보관할 지정 과제");
  await q("select public.node_archive('aws', $1::bigint)", [old]);
  return { grp, alb, nlb, range };
};
const shift = (q: Q, grp: string, s: string, e: string) =>
  one(q, "select public.node_update('aws', $1::bigint, $2::jsonb) as r", [grp, JSON.stringify({ startDate: s, endDate: e, shiftDescendants: true })]);

cases("backlog 0028", db, [
  // ───────── ① 보관된 방의 승인 대기 ─────────
  { name: "보관된 방(모집중이던 sqld)에서도 승인 대기 본인은 신청을 취소할 수 있다 · 그룹장 JOIN_REQUESTED 읽음 · 승인 대기 목록에서 빠짐", run: async (q) => {
    const rid = await roomId(q, "sqld");
    const leader = await uidOf(q, "가은");
    const cs = await uidOf(q, "철수");
    await q(`insert into public.notifications (user_id, kind, title, room_id, actor_user_id, link)
             values ($1::uuid, 'JOIN_REQUESTED', '신청', $2::bigint, $3::uuid, '/my-study/sqld#applications')`, [leader, rid, cs]);
    await q("update public.rooms set archived_at = now() where id = $1::bigint", [rid]);
    await as(q, "철수");
    const before = (await one(q, "select public.room_get('sqld') as r")).r as Row;
    assertEquals([before.archived, before.me.state], [true, "pending"]);
    const r = (await one(q, "select public.room_cancel_application('sqld') as r")).r as Row;
    assertEquals(r.me.state, "none");
    assertEquals((await one(q, "select status from public.room_members where room_id = $1::bigint and user_id = $2::uuid", [rid, cs])).status, "CANCELED");
    await expectFail(q("select public.room_cancel_application('sqld')"), "NOT_FOUND");
    assert((await one(q, "select read_at from public.notifications where user_id = $1::uuid and kind = 'JOIN_REQUESTED' and room_id = $2::bigint", [leader, rid])).read_at);
    await as(q, "가은");
    assertEquals((await one(q, "select public.room_applications('sqld') as r")).r.items.length, 0);
    assertEquals((await one(q, "select public.room_get('sqld') as r")).r.pendingCount, 0);
  } },
  { name: "보관된 진행중 방의 남은 PENDING 도 취소 가능 · 그 외(참가 취소·그룹장 승인)는 그대로 막힌다", run: async (q) => {
    const rid = await roomId(q, "aws");
    const ga = await uidOf(q, "가은");
    await q("insert into public.room_members (room_id, user_id, role, status) values ($1::bigint, $2::uuid, 'MEMBER', 'PENDING')", [rid, ga]);
    await q("update public.rooms set archived_at = now() where id = $1::bigint", [rid]);
    await as(q, "민수");
    await expectFail(q("select public.room_approve('aws', $1::uuid)", [ga]), "ROOM_NOT_RECRUITING");
    await as(q, "철수");
    await expectFail(q("select public.room_leave('aws')"), "ROOM_NOT_RECRUITING");
    await as(q, "가은");
    assertEquals(((await one(q, "select public.room_cancel_application('aws') as r")).r as Row).me.state, "none");
  } },

  // ───────── ② 묶음 이동 알림 묶기 ─────────
  { name: "묶음째 옮기면 담당자마다 1건: 과제 k≥2 는 묶음 알림(묶음 딥링크), k=1 은 기존 과제 문구(과제 딥링크) · 보관 과제 제외", run: async (q) => {
    const rid = await roomId(q, "aws");
    const { grp, alb, nlb, range } = await bundle(q);
    assertEquals([range.s, range.e], ["2026-10-15", "2026-10-21"]);
    const u = (await shift(q, grp, "2026-10-17", "2026-10-23")).r as Row;
    assertEquals(u.shifted.tasks, 2);
    const [j, ...rest] = await notes(q, "지은", "SCHEDULE_CHANGED");
    assertEquals(rest.length, 0);
    assertEquals([j.node_id, j.body, j.link], [grp, '"로드밸런서 비교" 과제 2개 일정이 2일 뒤로 옮겨졌어요 · 기간 10.15 – 10.21 → 10.17 – 10.23',
      `/my-study/aws?tab=curriculum&item=${grp}`]);
    assert((j.dedupe_key as string).startsWith(`SCHEDULE_CHANGED:${rid}:${grp}:`));
    for (const nick of ["철수", "하나"]) {
      const ns = await notes(q, nick, "SCHEDULE_CHANGED");
      assertEquals(ns.map((n) => [n.node_id, n.body, n.link]),
        [[alb, '"ALB vs NLB 실습" 기간 10.15 – 10.21 → 10.17 – 10.23', `/my-study/aws?task=${alb}`]], nick);
      assert((ns[0].dedupe_key as string).startsWith(`SCHEDULE_CHANGED:${rid}:${alb}:`));
    }
    assertEquals((await notes(q, "지은", "ROUND_SCHEDULE_CHANGED")).length, 0);
    assert(nlb);
  } },
  { name: "묶음 시작만 바꿔도(하위는 종료일까지 함께 옮겨짐) 묶음 알림 본문은 '기간 옛 → 새' (리뷰 M1)", run: async (q) => {
    const { grp } = await bundle(q);
    await shift(q, grp, "2026-10-17", "2026-10-21");
    assertEquals((await notes(q, "지은", "SCHEDULE_CHANGED")).map((n) => n.body),
      ['"로드밸런서 비교" 과제 2개 일정이 2일 뒤로 옮겨졌어요 · 기간 10.15 – 10.21 → 10.17 – 10.21']);
  } },
  { name: "편집 권한자가 자기도 과제 2개를 맡은 묶음을 옮기면 본인은 0건 · 다른 담당자는 1건씩 (리뷰 M2)", run: async (q) => {
    const { grp, alb } = await bundle(q);
    await q("select public.member_set_curriculum_editor('aws', $1::uuid, true)", [await uidOf(q, "지은")]);
    await as(q, "지은");
    await shift(q, grp, "2026-10-17", "2026-10-23");
    assertEquals((await notes(q, "지은", "SCHEDULE_CHANGED")).length, 0);
    for (const nick of ["철수", "하나"]) assertEquals((await notes(q, nick, "SCHEDULE_CHANGED")).map((n) => n.node_id), [alb], nick);
  } },
  { name: "모집중(RECRUIT) 방에서 묶음을 옮기면 일정 변경 알림 0건 — 0026 규칙(진행중 방만) 그대로 (리뷰 M3)", run: async (q) => {
    const { grp } = await bundle(q);
    await q("update public.rooms set status = 'RECRUIT' where id = $1::bigint", [await roomId(q, "aws")]);
    await shift(q, grp, "2026-10-17", "2026-10-23");
    for (const nick of ["지은", "철수", "하나"]) assertEquals((await notes(q, nick, "SCHEDULE_CHANGED")).length, 0, nick);
  } },
  { name: "notify_link 재정의 회귀 — TASK_ASSIGNED 는 ?task=, ROUND_SCHEDULE_CHANGED 는 ?tab=curriculum (리뷰 M5)", run: async (q) => {
    const rid = await roomId(q, "aws");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    const r3 = await nodeId(q, "aws", "고가용성 아키텍처");
    const cs = await uidOf(q, "철수");
    assertEquals((await one(q, "select public.notify_link('TASK_ASSIGNED', $1::bigint, $2::bigint, $3::uuid) as l", [rid, alb, cs])).l, `/my-study/aws?task=${alb}`);
    assertEquals((await one(q, "select public.notify_link('ROUND_SCHEDULE_CHANGED', $1::bigint, $2::bigint, $3::uuid) as l", [rid, r3, cs])).l, "/my-study/aws?tab=curriculum");
  } },
  { name: "앞으로 당기면 '앞으로' · 과제를 직접 고친 알림도 과제 딥링크", run: async (q) => {
    const { grp, nlb } = await bundle(q);
    await shift(q, grp, "2026-10-14", "2026-10-20");
    assertEquals((await notes(q, "지은", "SCHEDULE_CHANGED")).map((n) => n.body),
      ['"로드밸런서 비교" 과제 2개 일정이 1일 앞으로 옮겨졌어요 · 기간 10.15 – 10.21 → 10.14 – 10.20']);
    await q("delete from public.notifications where kind = 'SCHEDULE_CHANGED'");
    await q("select public.node_update('aws', $1::bigint, $2::jsonb)", [nlb, JSON.stringify({ endDate: "2026-10-22" })]);
    assertEquals((await notes(q, "지은", "SCHEDULE_CHANGED")).map((n) => [n.node_id, n.body, n.link]),
      [[nlb, '"NLB 헬스체크" 마감 10.20 → 10.22', `/my-study/aws?task=${nlb}`]]);
  } },
  { name: "일정 변경 알림을 끈 방은 묶음 알림도 없다", run: async (q) => {
    const rid = await roomId(q, "aws");
    const { grp } = await bundle(q);
    await q("update public.room_notification_settings set schedule_changed = false where room_id = $1::bigint", [rid]);
    await shift(q, grp, "2026-10-17", "2026-10-23");
    for (const nick of ["지은", "철수", "하나"]) assertEquals((await notes(q, nick, "SCHEDULE_CHANGED")).length, 0, nick);
  } },
]);
