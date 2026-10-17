// 0020 — 담당 해제(node_update assigneeIds·assignment_resync)로 남은 담당자 전원이 제출한 상태가 된 과제의 전원 제출 알림
//   IMMEDIATE: 그 자리에서 TASK_ALL_SUBMITTED(submission_upsert·member_deactivate 와 같은 자연 키 → 이미 나갔으면 다시 안 나감)
//   DAILY_DIGEST: 다음 날 TASK_COMPLETION_DIGEST 가 센다(해제 시각 = 완료 시각)
import { assertEquals } from "@std/assert";
import { applySeed, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);

const immediate = async (q: Q, slug: string) =>
  await q("update public.room_notification_settings set completion_mode = 'IMMEDIATE' where room_id = $1::bigint", [await roomId(q, slug)]);
const allSubmitted = async (q: Q, leader: string) =>
  await q(`select node_id::text as node, actor_user_id::text as actor, dedupe_key from public.notifications
           where user_id = $1::uuid and kind = 'TASK_ALL_SUBMITTED' and created_at >= now() order by id`, [leader]);
const kstToday = async (q: Q) => (await one(q, "select to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') as d")).d as string;
const nextDay = (ymd: string) => new Date(Date.parse(ymd + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
const digests = async (q: Q, leader: string, room: string) =>
  (await q("select title from public.notifications where user_id = $1::uuid and kind = 'TASK_COMPLETION_DIGEST' and room_id = $2::bigint and created_at >= now()",
    [leader, room])).map((x) => x.title);
const assign = async (q: Q, node: string, ids: string[]) =>
  await q("select public.node_update('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ assigneeIds: ids })]);

cases("backlog3", db, [
  // ───────── IMMEDIATE ─────────
  { name: "node_update: unassigning the last non-submitter notifies the leader TASK_ALL_SUBMITTED (IMMEDIATE, natural key, actor null)", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const jieun = await uidOf(q, "지은");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");   // 지은 제출, 철수 미제출
    await immediate(q, "aws");
    await asUser(q, minsu);
    await assign(q, ec2, [jieun]);
    const rows = await allSubmitted(q, minsu);
    assertEquals(rows.map((x) => x.node), [ec2]);                 // 다른 과제(전원 제출 아님·이미 전원 제출)는 알리지 않는다
    assertEquals(rows[0].actor, null);                            // 상태 이벤트 — 편집자가 그룹장이어도 그룹장이 받는다
    assertEquals(rows[0].dedupe_key, `TASK_ALL_SUBMITTED:${aws}:${ec2}:${minsu}`);
  } },

  { name: "node_update: no duplicate when the task already sent its all-submitted notification (re-add then unassign)", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const jieun = await uidOf(q, "지은");
    const cheolsu = await uidOf(q, "철수");
    const hana = await uidOf(q, "하나");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await immediate(q, "aws");
    await asUser(q, cheolsu);
    await submit(q, ec2);                                          // 마지막 제출 → 1건
    assertEquals((await allSubmitted(q, minsu)).length, 1);
    await asUser(q, minsu);
    await assign(q, ec2, [jieun, cheolsu, hana]);                  // 하나 추가 → 전원 제출 아님
    await assign(q, ec2, [jieun, cheolsu]);                        // 하나 해제 → 다시 전원 제출. 같은 자연 키라 다시 안 나간다
    assertEquals((await allSubmitted(q, minsu)).length, 1);
  } },

  { name: "node_update: unassigning everyone (0 assignees) or a still-incomplete task does not notify", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const jieun = await uidOf(q, "지은");
    const cheolsu = await uidOf(q, "철수");
    const hana = await uidOf(q, "하나");
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");   // 하나만 담당, 미제출
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await immediate(q, "aws");
    await asUser(q, minsu);
    await assign(q, s3, []);
    await assign(q, ec2, [jieun, cheolsu, hana]);
    await assign(q, ec2, [jieun, cheolsu]);                        // 철수 여전히 미제출
    assertEquals(await allSubmitted(q, minsu), []);
  } },

  { name: "scope guard: in an ACTIVE room leaderDoesTasks is locked, so resync's leader release cannot complete a task (only node_update needs the check)", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(q("select public.room_update('aws', $1::jsonb)", [JSON.stringify({ leaderDoesTasks: true })]), "FIELD_LOCKED");
  } },

  // ───────── DAILY_DIGEST ─────────
  { name: "digest: an unassignment that completes a task is counted in the next day's TASK_COMPLETION_DIGEST, once", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const jieun = await uidOf(q, "지은");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, minsu);
    await assign(q, ec2, [jieun]);
    assertEquals(await allSubmitted(q, minsu), []);               // 요약 모드는 즉시 알리지 않는다
    await setToday(q, nextDay(await kstToday(q)));
    await q("select public.job_completion_digest()");
    assertEquals(await digests(q, minsu, aws), ["어제 1개 과제가 전원 제출됐어요"]);
    await setToday(q, nextDay(nextDay(await kstToday(q))));
    await q("select public.job_completion_digest()");
    assertEquals((await digests(q, minsu, aws)).length, 1);
  } },

  { name: "digest: an earlier unassignment does not move the completion day of a task finished later by a submission", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const jieun = await uidOf(q, "지은");
    const cheolsu = await uidOf(q, "철수");
    const hana = await uidOf(q, "하나");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, minsu);
    await assign(q, ec2, [jieun, cheolsu, hana]);
    await q("update public.task_assignments set released_at = now() - interval '3 days' where node_id = $1::bigint and user_id = $2::uuid", [ec2, hana]);
    await asUser(q, cheolsu);
    await submit(q, ec2);                                          // 오늘 마지막 제출 → 완료일 = 오늘
    await setToday(q, nextDay(await kstToday(q)));
    await q("select public.job_completion_digest()");
    assertEquals(await digests(q, minsu, aws), ["어제 1개 과제가 전원 제출됐어요"]);
  } },

  // ───────── PERSONAL ─────────
  { name: "personal goals are not targets: a submitted personal goal never produces TASK_ALL_SUBMITTED or a digest count via resync", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const jieun = await uidOf(q, "지은");
    const aws = await roomId(q, "aws");
    const round = (await one(q, "select id::text as id from public.goal_nodes where room_id = $1::bigint and depth = 2 and label = '3주차'", [aws])).id;
    await immediate(q, "aws");
    await asUser(q, jieun);
    const c = (await one(q, "select public.personal_create('aws', $1::bigint, '개인 복습', null, null) as c", [round])).c;
    const pid = c.createdId as string;
    await submit(q, pid);
    await q("select public.assignment_resync($1::bigint)", [aws]);
    assertEquals((await allSubmitted(q, minsu)).filter((x) => x.node === pid), []);
    await q("update public.room_notification_settings set completion_mode = 'DAILY_DIGEST' where room_id = $1::bigint", [aws]);
    await setToday(q, nextDay(await kstToday(q)));
    await q("select public.job_completion_digest()");
    assertEquals(await digests(q, minsu, aws), []);
  } },
]);
