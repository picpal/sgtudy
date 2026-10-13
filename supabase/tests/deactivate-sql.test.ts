import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

type Pending = { title: string; roundLabel: string; currentAssignees: { nickname: string }[] };
const preview = async (q: Q, slug: string, user: string) => (await one(q, "select public.member_deactivate_preview($1, $2::uuid) as p", [slug, user])).p;
const deactivate = async (q: Q, slug: string, user: string, decisions: unknown[] = []) =>
  (await one(q, "select public.member_deactivate($1, $2::uuid, $3::jsonb) as r", [slug, user, JSON.stringify(decisions)])).r;
const roundStat = async (q: Q, slug: string, label: string) =>
  one(q, `select coalesce(sum(ls.asg), 0)::int as asg, coalesce(sum(ls.sub), 0)::int as sub
          from public.room_leaf_stats((select id from public.rooms where slug = $1)) ls
          join public.goal_nodes rd on rd.id = ls.round_id where rd.label = $2`, [slug, label]);
const leafStat = async (q: Q, node: string) =>
  one(q, "select asg, sub from public.room_leaf_stats((select room_id from public.goal_nodes where id = $1::bigint)) where node_id = $1::bigint", [node]);

cases("deactivate", db, [
  { name: "preview: only unsubmitted designated tasks of the target, with the other assignees", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    // C6: 지은·하나 모두 DynamoDB 설계 퀴즈(5주차, DESIGNATED, 미제출)에 배정되어 있다. EC2 는 지은이 이미 제출
    const jieun = await preview(q, "aws", await uidOf(q, "지은"));
    assertEquals(jieun.tasks.map((t: Pending) => [t.title, t.roundLabel, t.currentAssignees.map((p) => p.nickname)]),
                 [["DynamoDB 설계 퀴즈", "5주차", ["하나"]]]);
    const hana = await preview(q, "aws", await uidOf(q, "하나"));
    assertEquals(hana.tasks.map((t: Pending) => [t.title, t.roundLabel, t.currentAssignees.map((p) => p.nickname)]),
                 [["S3 스토리지 클래스 발표자료", "2주차", []], ["DynamoDB 설계 퀴즈", "5주차", ["지은"]]]);   // B10: 회차 순
    const cheolsu = await preview(q, "aws", await uidOf(q, "철수"));
    assertEquals(cheolsu.tasks.map((t: Pending) => [t.title, t.currentAssignees.map((p) => p.nickname)]),
                 [["EC2 인스턴스 유형 정리", ["지은"]]]);
    assertEquals(typeof hana.today, "string");
  } },

  { name: "deactivate 지은 (submitted designated + common): counts drop, submissions stay readable by leader, member_count 3, notified (Review Focus 2)", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const jieun = await uidOf(q, "지은");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const iam = await nodeId(q, "aws", "IAM 정책 이해");
    const dynamo = await nodeId(q, "aws", "DynamoDB 설계 퀴즈");
    await asUser(q, minsu);
    assertEquals(await roundStat(q, "aws", "1주차"), { asg: 8, sub: 5 });
    await expectFail(deactivate(q, "aws", jieun, []), "LEAVE_DECISION_MISSING");   // DynamoDB 미제출 → 결정 필요
    const r = await deactivate(q, "aws", jieun, [{ nodeId: dynamo, action: "exclude" }]);   // 하나가 남으므로 exclude 가능
    assertEquals(r.memberCount, 3);
    assertEquals(r.me, { state: "leader" });
    assertEquals(r.members.find((m: { nickname: string }) => m.nickname === "지은").status, "inactive");
    assertEquals(await roundStat(q, "aws", "1주차"), { asg: 6, sub: 4 });        // 지은 L(IAM)·M(VPC) 제외
    assertEquals(await leafStat(q, ec2), { asg: 1, sub: 0 });                     // 철수만 남음
    const m = await one(q, "select rm.status, (rm.left_at is not null) as left_set, r.member_count from public.room_members rm join public.rooms r on r.id = rm.room_id where r.slug = 'aws' and rm.user_id = $1::uuid", [jieun]);
    assertEquals([m.status, m.left_set, m.member_count], ["INACTIVE", true, 3]);
    assertEquals((await one(q, "select count(*)::int as n from public.task_assignments a join public.goal_nodes n on n.id = a.node_id where n.room_id = $1::bigint and a.user_id = $2::uuid and a.released_at is null", [await roomId(q, "aws"), jieun])).n, 0);
    // 제출물 보존 + 그룹장 열람
    assertEquals((await one(q, "select count(*)::int as n from public.submissions where user_id = $1::uuid and node_id in ($2::bigint, $3::bigint)", [jieun, ec2, iam])).n, 2);
    const t = (await one(q, "select public.task_get('aws', $1::bigint) as t", [ec2])).t;
    assertEquals(t.submissions.map((s: { author: { nickname: string } }) => s.author.nickname), ["지은"]);
    assertEquals(t.allSubmitted, false);
    // 알림
    const n = await q("select kind, link from public.notifications where user_id = $1::uuid and kind = 'MEMBER_DEACTIVATED'", [jieun]);
    assertEquals(n.length, 1);
    assertEquals(n[0].link, "/rooms/aws");                                        // 이미 참가자가 아니므로 /rooms
    // 다시 이탈 처리 → MEMBER_NOT_ACTIVE
    await asUser(q, minsu);
    await expectFail(deactivate(q, "aws", jieun), "MEMBER_NOT_ACTIVE");
  } },

  { name: "INACTIVE cannot re-apply to a RECRUIT room → MEMBER_NOT_ACTIVE (00 RF3, S7)", run: async (q) => {
    // aws 는 ACTIVE 라 room_apply 가 ROOM_NOT_RECRUITING 에서 먼저 막힌다 → 모집중(RECRUIT·APPROVAL)인 sqld 에 INACTIVE 행을 만들어 분기까지 간다
    const seoyeon = await uidOf(q, "서연");
    const sqld = await roomId(q, "sqld");
    assertEquals((await one(q, "select status, join_mode from public.rooms where id = $1::bigint", [sqld])), { status: "RECRUIT", join_mode: "APPROVAL" });
    await q(`insert into public.room_members (room_id, user_id, role, status, applied_at, joined_at, left_at)
             values ($1::bigint, $2::uuid, 'MEMBER', 'INACTIVE', now() - interval '3 days', now() - interval '2 days', now() - interval '1 day')`, [sqld, seoyeon]);
    await asUser(q, seoyeon);
    await expectFail(q("select public.room_apply('sqld')"), "MEMBER_NOT_ACTIVE");
    assertEquals((await one(q, "select status from public.room_members where room_id = $1::bigint and user_id = $2::uuid", [sqld, seoyeon])).status, "INACTIVE");
  } },

  { name: "도윤 is already INACTIVE: MEMBER_NOT_ACTIVE and 1주차 stays 5/8", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(deactivate(q, "aws", await uidOf(q, "도윤")), "MEMBER_NOT_ACTIVE");
    await expectFail(preview(q, "aws", await uidOf(q, "도윤")), "MEMBER_NOT_ACTIVE");
    assertEquals(await roundStat(q, "aws", "1주차"), { asg: 8, sub: 5 });
  } },

  { name: "guards: CANNOT_DEACTIVATE_LEADER, NOT_LEADER, ROOM_NOT_ACTIVE, non-member → MEMBER_NOT_ACTIVE, AUTH_REQUIRED", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    await asUser(q, minsu);
    await expectFail(deactivate(q, "aws", minsu), "CANNOT_DEACTIVATE_LEADER");
    await expectFail(deactivate(q, "aws", await uidOf(q, "가은")), "MEMBER_NOT_ACTIVE");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(deactivate(q, "aws", await uidOf(q, "지은")), "NOT_LEADER");
    await asUser(q, await uidOf(q, "가은"));                                      // sqld RECRUIT
    await expectFail(deactivate(q, "sqld", await uidOf(q, "철수")), "ROOM_NOT_ACTIVE");
    await asUser(q, await uidOf(q, "현우"));                                      // algo ENDED
    await expectFail(deactivate(q, "algo", await uidOf(q, "철수")), "ROOM_NOT_ACTIVE");
    await asAnon(q);
    await expectFail(deactivate(q, "aws", minsu), "AUTH_REQUIRED");
  } },

  { name: "decisions: missing → LEAVE_DECISION_MISSING, exclude to zero → REASSIGN_REQUIRED, reassign to non-member → ASSIGNEE_NOT_MEMBER, bad uuid → VALIDATION_FAILED, reassign ok + TASK_ASSIGNED", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const hana = await uidOf(q, "하나");
    const cheolsu = await uidOf(q, "철수");
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");
    const dynamo = await nodeId(q, "aws", "DynamoDB 설계 퀴즈");
    await asUser(q, minsu);
    await expectFail(deactivate(q, "aws", hana, []), "LEAVE_DECISION_MISSING");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3 }]), "LEAVE_DECISION_MISSING");               // action 누락도 결정 없음
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "exclude" }]), "REASSIGN_REQUIRED");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [] }]), "REASSIGN_REQUIRED");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [await uidOf(q, "가은")] }]), "ASSIGNEE_NOT_MEMBER");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [hana] }]), "ASSIGNEE_NOT_MEMBER");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "drop" }]), "VALIDATION_FAILED");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: ["x"] }]), "VALIDATION_FAILED");   // B9: 22P02 가 새지 않는다
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [7] }]), "VALIDATION_FAILED");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: cheolsu }]), "VALIDATION_FAILED");
    // S3 만 결정하고 DynamoDB 를 빠뜨리면 아무것도 쓰지 않는다
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [cheolsu] }]), "LEAVE_DECISION_MISSING");
    // 아무것도 바뀌지 않았어야 한다
    assertEquals((await one(q, "select rm.status from public.room_members rm join public.rooms r on r.id = rm.room_id where r.slug = 'aws' and rm.user_id = $1::uuid", [hana])).status, "ACTIVE");
    assertEquals(await leafStat(q, s3), { asg: 1, sub: 0 });

    const r = await deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [cheolsu] }, { nodeId: dynamo, action: "exclude" }]);
    assertEquals(r.memberCount, 3);
    assertEquals(await leafStat(q, s3), { asg: 1, sub: 0 });
    const a = await one(q, "select user_id::text as u, source from public.task_assignments where node_id = $1::bigint and released_at is null", [s3]);
    assertEquals([a.u, a.source], [cheolsu, "DESIGNATED"]);
    assertEquals(await roundStat(q, "aws", "1주차"), { asg: 6, sub: 5 });        // 하나 M·M 제외
    const n = await q("select kind, node_id::text as node from public.notifications where user_id = $1::uuid and kind = 'TASK_ASSIGNED'", [cheolsu]);
    assertEquals(n, [{ kind: "TASK_ASSIGNED", node: s3 }]);
  } },

  { name: "exclude is fine when someone remains (철수 off EC2, 지은 stays)", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, await uidOf(q, "민수"));
    await deactivate(q, "aws", await uidOf(q, "철수"), [{ nodeId: ec2, action: "exclude" }]);
    assertEquals(await leafStat(q, ec2), { asg: 1, sub: 1 });
    assertEquals((await one(q, "select public.task_get('aws', $1::bigint) as t", [ec2])).t.allSubmitted, true);
  } },

  { name: "grants: preview/deactivate for authenticated only; deactivate_pending/check internal (B4); real roles (D7)", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    for (const fn of ["public.deactivate_pending(bigint, uuid)", "public.deactivate_check(text, uuid, boolean)"]) {
      assertEquals(await can("anon", fn), false, fn);
      assertEquals(await can("authenticated", fn), false, fn);
    }
    for (const fn of ["public.member_deactivate_preview(text, uuid)", "public.member_deactivate(text, uuid, jsonb)"]) {
      assertEquals(await can("anon", fn), false, fn);
      assertEquals(await can("authenticated", fn), true, fn);
    }
    // 실제 실행: authenticated 그룹장은 통과, anon 은 GRANT 층에서 거절
    const hana = await uidOf(q, "하나");
    await asUser(q, await uidOf(q, "민수"));
    await q("set local role authenticated");
    assertEquals((await one(q, "select public.member_deactivate_preview('aws', $1::uuid) as p", [hana])).p.tasks.length, 2);
    await q("reset role");
    await asAnon(q);
    await q("set local role anon");
    await expectFail(q("select public.member_deactivate_preview('aws', $1::uuid)", [hana]), "permission denied");
    await q("reset role");
  } },
]);
