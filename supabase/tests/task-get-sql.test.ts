import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { cases, nodeId, one, setNow, uidOf, type Q } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);
const get = async (q: Q, slug: string, node: string) => (await one(q, "select public.task_get($1, $2::bigint) as t", [slug, node])).t;

cases("task_get", db, [
  { name: "assignee view: node, path, people, mySubmission null, isAssignee, allSubmitted false, submissions", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, await uidOf(q, "철수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const t = await get(q, "aws", ec2);
    assertEquals(t.today, "2026-10-12");
    assertEquals(t.node.id, ec2);
    assertEquals(t.node.task.type, "designated");
    assertEquals(t.node.task.people.map((p: { nickname: string; status: string }) => [p.nickname, p.status]), [["지은", "done"], ["철수", "open"]]);
    assertEquals([t.node.task.assigned, t.node.task.submitted, t.node.task.state, t.node.pct], [2, 1, "progress", 50]);
    assertEquals(t.path.map((p: { label: string | null; title: string }) => [p.label, p.title]), [["2주차", "EC2·S3"], [null, "EC2 인스턴스 유형 정리"]]);
    assertEquals(t.mySubmission, null);
    assertEquals(t.isAssignee, true);
    assertEquals(t.allSubmitted, false);
    assertEquals(t.submissions.length, 1);
    assertEquals(t.submissions[0].author.nickname, "지은");
    assertEquals(typeof t.submissions[0].bodyMd, "string");
  } },

  { name: "after submitting: mySubmission filled, allSubmitted true, submissions 2", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, await uidOf(q, "철수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await q("select public.submission_upsert($1::bigint, '내 제출', '{}'::text[], '{}'::uuid[])", [ec2]);
    const t = await get(q, "aws", ec2);
    assertEquals(t.mySubmission.bodyMd, "내 제출");
    assertEquals(t.allSubmitted, true);
    assertEquals(t.node.task.state, "complete");
    assertEquals(t.submissions.length, 2);
  } },

  { name: "anon on a public room: meta only — people [], submissions [], isAssignee false", run: async (q) => {
    await asAnon(q);
    const t = await get(q, "aws", await nodeId(q, "aws", "EC2 인스턴스 유형 정리"));
    assertEquals(t.node.task.people, []);
    assertEquals([t.node.task.assigned, t.node.task.submitted], [2, 1]);   // 집계 숫자는 공개
    assertEquals(t.submissions, []);
    assertEquals(t.mySubmission, null);
    assertEquals(t.isAssignee, false);
  } },

  { name: "non-member logged in: submissions []; PENDING sees meta; INACTIVE (도윤) still reads submissions", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, await uidOf(q, "가은"));
    const gaeun = await get(q, "aws", ec2);
    assertEquals(gaeun.submissions, []);
    assertEquals(gaeun.node.task.people, []);                                  // C9: 비멤버는 people 도 없다
    await asUser(q, await uidOf(q, "도윤"));
    const t = await get(q, "aws", ec2);
    assertEquals(t.submissions.length, 1);
    assertEquals(t.isAssignee, false);
    // B5: PENDING (철수 @ sqld) — 메타만, 제출물 없음
    await asUser(q, await uidOf(q, "철수"));
    const p = await get(q, "sqld", await nodeId(q, "sqld", "데이터 모델링 요약 노트"));
    assertEquals(p.submissions, []);
    assertEquals(p.isAssignee, false);
  } },

  { name: "archived node: leader sees all submissions, member sees only own (Review Focus 2 반쪽)", run: async (q) => {
    const iam = await nodeId(q, "aws", "IAM 정책 이해");                    // DLDM → 민수·지은·철수·도윤(이탈) 4건
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [iam]);
    await asUser(q, await uidOf(q, "민수"));
    const leader = await get(q, "aws", iam);
    assertEquals(leader.node.archived, true);
    assertEquals(leader.submissions.length, 4);
    await asUser(q, await uidOf(q, "철수"));
    const me = await get(q, "aws", iam);
    assertEquals(me.submissions.map((s: { author: { nickname: string } }) => s.author.nickname), ["철수"]);
    assertEquals(me.mySubmission !== null, true);
  } },

  { name: "errors: private room anon → ROOM_NOT_FOUND, foreign node → NODE_NOT_FOUND, round → NODE_NOT_LEAF", run: async (q) => {
    await asAnon(q);
    await expectFail(get(q, "spring", await nodeId(q, "spring", "섹션 1~5 정리 노트")), "ROOM_NOT_FOUND");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(get(q, "aws", await nodeId(q, "spring", "섹션 1~5 정리 노트")), "NODE_NOT_FOUND");
    await expectFail(get(q, "aws", await nodeId(q, "aws", "EC2·S3")), "NODE_NOT_LEAF");
    await expectFail(get(q, "nope", "1"), "ROOM_NOT_FOUND");
  } },

  { name: "0007 grants: public RPCs only (B4 — D7 GRANT 전용)", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    // 내부 헬퍼 — anon·authenticated 모두 불가 (submission_json 이 열리면 비로그인이 임의 제출물 본문을 읽는다)
    for (const fn of ["public.submission_json(bigint)", "public.task_node_json(bigint, uuid)", "public.file_json(public.files)",
                      "public.storage_exists(text, text)", "public.app_now()", "public.allowed_mime_types()"]) {
      assertEquals(await can("anon", fn), false, fn);
      assertEquals(await can("authenticated", fn), false, fn);
    }
    // 공개 RPC
    assertEquals(await can("anon", "public.task_get(text, bigint)"), true);
    assertEquals(await can("authenticated", "public.submission_upsert(bigint, text, text[], uuid[])"), true);
    assertEquals(await can("anon", "public.submission_upsert(bigint, text, text[], uuid[])"), false);
    assertEquals(await can("authenticated", "public.file_register(bigint, text, text, text, bigint)"), true);
    assertEquals(await can("anon", "public.file_register(bigint, text, text, text, bigint)"), false);
    assertEquals(await can("anon", "public.submission_target(bigint, uuid)"), false);
    assertEquals(await can("authenticated", "public.submission_target(bigint, uuid)"), false);
    // D7: 실제 역할로 실행
    await setNow(q, "2026-10-12T03:00:00Z");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, await uidOf(q, "철수"));
    await q("set local role anon");
    assertEquals((await get(q, "aws", ec2)).node.id, ec2);
    await expectFail(q("select public.submission_upsert($1::bigint, 'x', '{}'::text[], '{}'::uuid[])", [ec2]), "permission denied");
    await q("set local role authenticated");
    assertEquals((await one(q, "select public.submission_upsert($1::bigint, '역할 제출', '{}'::text[], '{}'::uuid[]) as s", [ec2])).s.bodyMd, "역할 제출");
    await q("reset role");
  } },
]);
