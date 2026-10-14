import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { mkLeaf, mkRoom, mkRound, nodeByTitle, progress, roomId, submit, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

sqlTest("goal_nodes_guard: 직접 INSERT/UPDATE 도 depth=부모+1·round_id 일치·label 은 depth 2 만 (A1)", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const ins = (cols: string, vals: unknown[]) =>
    q(`insert into public.goal_nodes (${cols}) values (${vals.map((_, i) => "$" + (i + 1)).join(",")}) returning id::text as id, round_id::text as round_id`, vals);
  // 루트: round_id 를 비워 두면 자기 id 로 채운다
  const [root] = await ins("room_id, parent_id, depth, sort_order, label, title, start_date, end_date", [room.id, null, 2, 0, "1주차", "R", "2026-11-01", "2026-11-07"]);
  assertEquals(root.round_id, root.id);
  // 하위: round_id 를 비워 두면 부모의 round_id 를 물려받는다
  const [child] = await ins("room_id, parent_id, depth, sort_order, title, start_date, end_date, task_type", [room.id, root.id, 3, 0, "C", "2026-11-01", "2026-11-03", "COMMON"]);
  assertEquals(child.round_id, root.id);
  const base = "room_id, parent_id, depth, sort_order, title, start_date, end_date";
  await expectFail(ins(base, [room.id, root.id, 4, 1, "깊이 틀림", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  await expectFail(ins(base + ", round_id", [room.id, root.id, 3, 1, "회차 틀림", "2026-11-01", "2026-11-03", child.id]), "VALIDATION_FAILED");
  // 루트의 round_id 불일치는 field 가 depth 가 아니라 roundId 여야 한다 (final review M2)
  const rootErr = await ins(base + ", round_id, label", [room.id, null, 2, 1, "루트 회차 틀림", "2026-11-01", "2026-11-03", child.id, "x주차"]).then(() => null, (e: Error & { hint?: string }) => e);
  assertEquals(JSON.parse(rootErr!.hint!).field, "roundId");
  await expectFail(ins(base + ", label", [room.id, root.id, 3, 1, "하위 라벨", "2026-11-01", "2026-11-03", "x"]), "VALIDATION_FAILED");
  await expectFail(ins(base, [room.id, null, 3, 1, "루트 깊이 3", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  await expectFail(ins(base, [room.id, null, 2, 1, "루트 라벨 없음", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  const other = await mkRoom(q, "지훈", { title: "다른 방 Other" });
  await expectFail(ins(base, [other.id, root.id, 3, 0, "다른 방 부모", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  // UPDATE 도 같은 규칙: 회차 라벨 지우기·하위에 라벨
  await expectFail(q("update public.goal_nodes set label = null where id = $1", [root.id]), "VALIDATION_FAILED");
  await expectFail(q("update public.goal_nodes set label = 'x' where id = $1", [child.id]), "VALIDATION_FAILED");
  // depth-2 리프(회차 자체가 과제)는 허용(A7)
  const [leafRoot] = await ins("room_id, parent_id, depth, sort_order, label, title, start_date, end_date, task_type",
    [room.id, null, 2, 1, "2주차", "회차 과제", "2026-11-08", "2026-11-14", "COMMON"]);
  assertEquals(leafRoot.round_id, leafRoot.id);
}));

sqlTest("node_subtree / node_has_submissions: 자기 포함 서브트리, 제출물은 어느 깊이든 감지", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  const mid = await mkLeaf(q, r1, "중간", null, "2026-11-01", "2026-11-07");
  const leaf = await mkLeaf(q, mid, "리프", "COMMON", "2026-11-01", "2026-11-03");
  const r2 = await mkRound(q, room.id, "2주차", "회차2", "2026-11-08", "2026-11-14");
  const rows = await q("select s::text as id from public.node_subtree($1) s order by s", [r1]);
  assertEquals(rows.map((x) => x.id), [r1, mid, leaf].sort((a, b) => Number(a) - Number(b)));
  assertEquals((await q("select public.node_has_submissions($1) as b", [r1]))[0].b, false);
  await q("select public.assignment_resync($1)", [room.id]);
  await submit(q, leaf, "서연");
  assertEquals((await q("select public.node_has_submissions($1) as b", [r1]))[0].b, true);
  assertEquals((await q("select public.node_has_submissions($1) as b", [mid]))[0].b, true);
  assertEquals((await q("select public.node_has_submissions($1) as b", [r2]))[0].b, false);
}));

sqlTest("node_assert_editable: 그룹장·상태·보관 검사, node_get: 방 소속", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  assertEquals((await q("select (public.node_assert_editable($1)).id::text as id", [room.slug]))[0].id, room.id);
  await asUser(q, await uid(q, "민수"));
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "ROOM_NOT_FOUND");   // DRAFT: 외부인은 존재도 모른다 (I-2)
  await q("update public.rooms set status = 'RECRUIT' where id = $1", [room.id]);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "NOT_CURRICULUM_EDITOR");   // 공개 RECRUIT 는 읽을 수 있다
  await q("update public.rooms set status = 'DRAFT' where id = $1", [room.id]);
  await asAnon(q);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "AUTH_REQUIRED");
  await asUser(q, room.leader);
  await expectFail(q("select public.node_assert_editable($1)", ["no-such-room"]), "ROOM_NOT_FOUND");
  await q("update public.rooms set status = 'ENDED' where id = $1", [room.id]);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "ROOM_NOT_EDITABLE");
  await q("update public.rooms set status = 'ACTIVE', archived_at = now() where id = $1", [room.id]);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "ROOM_NOT_EDITABLE");
  // node_get: 다른 방의 노드 id 는 NODE_NOT_FOUND
  const other = await mkRoom(q, "지훈", { title: "다른 방 Other" });
  assertEquals((await q("select (public.node_get($1, $2)).id::text as id", [room.id, r1]))[0].id, r1);
  await expectFail(q("select public.node_get($1, $2)", [other.id, r1]), "NODE_NOT_FOUND");
}));

sqlTest("room_progress: 리프 asg/sub 를 조상까지 합산, 보관 서브트리 제외, pct half-up", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await mkRoom(q, "서연");
  // 서연(그룹장, leader_does_tasks=true) + 민수 + 지훈 = 담당 3명
  for (const n of ["민수", "지훈"]) {
    await q(`insert into public.room_members (room_id, user_id, role, status, joined_at) values ($1, $2::uuid, 'MEMBER', 'ACTIVE', now())`, [room.id, await uid(q, n)]);
  }
  await q("update public.rooms set member_count = 3 where id = $1", [room.id]);
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  const mid = await mkLeaf(q, r1, "중간", null, "2026-11-01", "2026-11-07");
  const a = await mkLeaf(q, mid, "A", "COMMON", "2026-11-01", "2026-11-03");       // 3명
  const b = await mkLeaf(q, r1, "B", "DESIGNATED", "2026-11-04", "2026-11-07");   // 지정 1명
  const c = await mkLeaf(q, r1, "C", "COMMON", "2026-11-04", "2026-11-07");       // 3명, 보관 예정
  await q(`insert into public.task_assignments (node_id, user_id, source) values ($1, $2::uuid, 'DESIGNATED')`, [b, await uid(q, "민수")]);
  await q("select public.assignment_resync($1)", [room.id]);
  await submit(q, a, "서연"); await submit(q, a, "민수", true);
  await submit(q, b, "민수");
  await submit(q, c, "지훈");
  let p = await progress(q, room.id);
  assertEquals(p[a], { asg: 3, sub: 2, pct: 67 });
  assertEquals(p[b], { asg: 1, sub: 1, pct: 100 });
  assertEquals(p[c], { asg: 3, sub: 1, pct: 33 });
  assertEquals(p[mid], { asg: 3, sub: 2, pct: 67 });
  assertEquals(p[r1], { asg: 7, sub: 4, pct: 57 });            // 4/7 = 57.14
  // C 보관 → 집계 제외(행은 0/0, pct null). resync 가 C 의 COMMON 행을 released 로 돌린다
  await q("update public.goal_nodes set archived_at = now() where id = $1", [c]);
  await q("select public.assignment_resync($1)", [room.id]);
  p = await progress(q, room.id);
  assertEquals(p[c], { asg: 0, sub: 0, pct: null });
  assertEquals(p[r1], { asg: 4, sub: 3, pct: 75 });
  // room_leaf_stats 는 같은 숫자를 돌려주고 보관 리프는 빠진다
  const ls = await q("select node_id::text as id, asg, sub from public.room_leaf_stats($1) order by node_id", [room.id]);
  assertEquals(ls, [{ id: a, asg: 3, sub: 2 }, { id: b, asg: 1, sub: 1 }]);
  // 빈 방은 빈 집합
  const empty = await mkRoom(q, "지훈", { title: "빈 방 Empty" });
  assertEquals(Object.keys(await progress(q, empty.id)).length, 0);
}));

async function roundStats(q: Parameters<typeof progress>[0], slug: string) {
  const room = await roomId(q, slug);
  const p = await progress(q, room);
  const rounds = await q("select id::text as id, label from public.goal_nodes where room_id = $1 and parent_id is null order by sort_order", [room]);
  return { room, p, rounds: rounds.map((r) => ({ label: r.label as string, ...p[r.id as string] })) };
}

async function overall(q: Parameters<typeof progress>[0], slug: string) {
  const room = await roomId(q, slug);
  const [r] = await q(
    `select public.pct(coalesce(sum(asg),0)::int, coalesce(sum(sub),0)::int) as pct, coalesce(sum(asg),0)::int as asg, coalesce(sum(sub),0)::int as sub
     from public.room_progress($1) p join public.goal_nodes n on n.id = p.node_id where n.parent_id is null and n.archived_at is null`, [room]);
  return { pct: r.pct as number | null, asg: r.asg as number, sub: r.sub as number };
}

sqlTest("seed §3: aws 24% — 회차 5/8·1/3·0/4·0/4·0/6, 트리 모양이 PLANS 와 같다", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const { room, rounds } = await roundStats(q, "aws");
  assertEquals(rounds.map((r) => [r.label, r.sub, r.asg]), [["1주차", 5, 8], ["2주차", 1, 3], ["3주차", 0, 4], ["4주차", 0, 4], ["5주차", 0, 6]]);
  assertEquals(await overall(q, "aws"), { pct: 24, asg: 25, sub: 6 });
  const nodes = await q(
    `select depth, label, title, task_type, to_char(start_date,'YYYY-MM-DD') as s, to_char(end_date,'YYYY-MM-DD') as e
     from public.goal_nodes where room_id = $1 order by id`, [room]);
  assertEquals(nodes.length, 14);   // 회차 5 + 중간 1 + 리프 8 (PLANS.aws)
  assertEquals(nodes[0], { depth: 2, label: "1주차", title: "IAM·VPC", task_type: null, s: "2026-10-01", e: "2026-10-07" });
  assertEquals(nodes.find((n) => n.title === "로드밸런서 비교"), { depth: 3, label: null, title: "로드밸런서 비교", task_type: null, s: "2026-10-15", e: "2026-10-21" });
  assertEquals(nodes.find((n) => n.title === "ALB vs NLB 실습")?.depth, 4);
  assertEquals(nodes.filter((n) => n.task_type === "DESIGNATED").map((n) => n.title), ["EC2 인스턴스 유형 정리", "S3 스토리지 클래스 발표자료", "DynamoDB 설계 퀴즈"]);
  // round_id 는 같은 방의 depth-2 루트이며 실제 조상이다 (E1: 비루트를 가리키면 NULL 비교로 놓치던 검사를 left join 으로)
  const [{ bad }] = await q(
    `select count(*)::int as bad from public.goal_nodes n left join public.goal_nodes r on r.id = n.round_id
     where n.room_id = $1 and (r.id is null or r.parent_id is not null or r.room_id <> n.room_id)`, [room]);
  assertEquals(bad, 0);
  const [{ badAnc }] = await q(
    `with recursive a as (
       select id, parent_id, id as start from public.goal_nodes where room_id = $1
       union all select p.id, p.parent_id, a.start from a join public.goal_nodes p on p.id = a.parent_id)
     select count(*)::int as "badAnc" from a join public.goal_nodes n on n.id = a.start where a.parent_id is null and n.round_id <> a.id`, [room]);
  assertEquals(badAnc, 0);
}));

sqlTest("seed §3: spring 34%, algo 87%(13주 68/78), sqld null(가은 leader_does_tasks=false), react 4주차 3/10", withCase(db, async (q) => {
  await setToday(q, TODAY);
  assertEquals(await overall(q, "spring"), { pct: 34, asg: 35, sub: 12 });
  assertEquals((await roundStats(q, "spring")).rounds.map((r) => [r.sub, r.asg]), [[9, 10], [3, 10], [0, 10], [0, 5]]);
  assertEquals(await overall(q, "algo"), { pct: 87, asg: 78, sub: 68 });
  assertEquals((await roundStats(q, "algo")).rounds.map((r) => [r.label, r.sub, r.asg]), [["1–4주차", 23, 24], ["5–8주차", 21, 24], ["9–13주차", 24, 30]]);
  assertEquals(await overall(q, "sqld"), { pct: null, asg: 0, sub: 0 });
  const sq = await roundStats(q, "sqld");
  assertEquals(sq.rounds.map((r) => r.label), ["1주차", "2주차", "3주차", "4주차"]);
  const [{ n: sqLeaves }] = await q("select count(*)::int as n from public.goal_nodes where room_id = $1 and task_type is not null", [sq.room]);
  assertEquals(sqLeaves, 9);
  const re = await roundStats(q, "react");
  assertEquals(re.rounds.map((r) => [r.label, r.sub, r.asg]), [["1주차", 10, 10], ["2주차", 10, 10], ["3주차", 9, 10], ["4주차", 3, 10], ["5주차", 0, 10], ["6주차", 0, 10], ["7주차", 0, 10], ["8주차", 0, 10]]);
  // 모집중 방: 회차 수·리프 수가 room-view 목업과 같다 (toeic 8/16, cs 12/24, docker 6/8, jcg 2/6)
  for (const [slug, rounds, leaves] of [["toeic", 8, 16], ["cs", 12, 24], ["docker", 6, 8], ["jcg", 2, 6]] as const) {
    const room = await roomId(q, slug);
    const [{ r, l }] = await q(
      `select count(*) filter (where parent_id is null)::int as r, count(*) filter (where task_type is not null)::int as l from public.goal_nodes where room_id = $1`, [room]);
    assertEquals([slug, r, l], [slug, rounds, leaves]);
  }
}));

sqlTest("seed §3: aws 참가자 done/total — 민수 2/5 지은 2/7 철수 2/6 하나 0/7, 도윤은 released 행만", withCase(db, async (q) => {
  const room = await roomId(q, "aws");
  const rows = await q(
    `select p.nickname, count(*) filter (where s.id is not null)::int as done, count(*)::int as total
     from public.task_assignments a
     join public.goal_nodes n on n.id = a.node_id and n.archived_at is null
     join public.profiles p on p.id = a.user_id
     left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
     where n.room_id = $1 and a.released_at is null group by p.nickname order by p.nickname`, [room]);
  assertEquals(rows, [
    { nickname: "민수", done: 2, total: 5 }, { nickname: "지은", done: 2, total: 7 },
    { nickname: "철수", done: 2, total: 6 }, { nickname: "하나", done: 0, total: 7 },
  ]);
  const [dy] = await q(
    `select count(*)::int as n, bool_and(a.released_at is not null) as released
     from public.task_assignments a join public.profiles p on p.id = a.user_id join public.goal_nodes n on n.id = a.node_id
     where n.room_id = $1 and p.nickname = '도윤'`, [room]);
  assertEquals(dy, { n: 1, released: true });
  const [sub] = await q(`select count(*)::int as n from public.submissions s join public.profiles p on p.id = s.user_id join public.goal_nodes n on n.id = s.node_id where n.room_id = $1 and p.nickname = '도윤'`, [room]);
  assertEquals(sub.n, 1);
}));

sqlTest("resync 규칙: 공통 리프 × ACTIVE, INACTIVE 는 released, leader_does_tasks=false 는 그룹장 제외, 재활성화 복구", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await roomId(q, "aws");
  const iam = await nodeByTitle(q, room, "IAM 정책 이해");
  const cnt = async () => (await q("select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null", [iam]))[0].n;
  assertEquals(await cnt(), 4);
  // 하나 이탈 → released(제출물 보존), 분모 3
  const hana = await uid(q, "하나");
  await q("update public.room_members set status = 'INACTIVE', left_at = now() where room_id = $1 and user_id = $2::uuid", [room, hana]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals(await cnt(), 3);
  assertEquals((await progress(q, room))[iam], { asg: 3, sub: 3, pct: 100 });
  // 재활성화 → 같은 행 복구
  await q("update public.room_members set status = 'ACTIVE', left_at = null where room_id = $1 and user_id = $2::uuid", [room, hana]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals(await cnt(), 4);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1", [iam]))[0].n, 5);  // 도윤 released 포함, 행 삭제 없음
  // 그룹장 제외
  await q("update public.rooms set leader_does_tasks = false where id = $1", [room]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals(await cnt(), 3);
  assertEquals((await progress(q, room))[iam], { asg: 3, sub: 2, pct: 67 });
  await q("update public.rooms set leader_does_tasks = true where id = $1", [room]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals(await cnt(), 4);
}));

sqlTest("RF3 이탈자 분모: 제출자(철수) INACTIVE → IAM 3/4 → 2/3, released 행·제출물 유지, 그룹장은 계속 조회", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await roomId(q, "aws");
  const iam = await nodeByTitle(q, room, "IAM 정책 이해");
  const chulsoo = await uid(q, "철수");
  assertEquals((await progress(q, room))[iam], { asg: 4, sub: 3, pct: 75 });
  // member_deactivate(플랜 04) 의 전구체: 상태 전환 + 자리 반납 + resync
  await q("update public.room_members set status = 'INACTIVE', left_at = now() where room_id = $1 and user_id = $2::uuid", [room, chulsoo]);
  await q("select public.room_release_seat($1)", [room]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals((await progress(q, room))[iam], { asg: 3, sub: 2, pct: 67 });            // 분모에서 빠지고 제출도 집계 제외
  const [row] = await q("select released_at is not null as released from public.task_assignments where node_id = $1 and user_id = $2::uuid", [iam, chulsoo]);
  assertEquals(row.released, true);                                                     // 행 삭제 없음
  assertEquals((await q("select count(*)::int as n from public.submissions where node_id = $1 and user_id = $2::uuid", [iam, chulsoo]))[0].n, 1);
  await asUser(q, await uid(q, "민수"));
  assertEquals((await q("select public.can_read_submission($1, $2::uuid) as b", [iam, chulsoo]))[0].b, true);   // 그룹장 조회 유지
}));

sqlTest("RF3: RECRUIT 방의 INACTIVE 행은 room_apply·room_join 모두 MEMBER_NOT_ACTIVE (재참가 거부)", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const chulsoo = await uid(q, "철수");
  // sqld(RECRUIT·APPROVAL): 철수 행을 INACTIVE 로 만든다(이탈 처리 결과를 흉내)
  await q("update public.room_members set status = 'INACTIVE', left_at = now() where room_id = $1 and user_id = $2::uuid", [await roomId(q, "sqld"), chulsoo]);
  // cs(RECRUIT·DIRECT): INACTIVE 행을 직접 만든다
  await q(`insert into public.room_members (room_id, user_id, role, status, joined_at, left_at)
           values ($1, $2::uuid, 'MEMBER', 'INACTIVE', now(), now())`, [await roomId(q, "cs"), chulsoo]);
  await asUser(q, chulsoo);
  await expectFail(q("select public.room_apply('sqld')"), "MEMBER_NOT_ACTIVE");
  await expectFail(q("select public.room_join('cs')"), "MEMBER_NOT_ACTIVE");
}));

sqlTest("seed §3: 제출 updated_at = first_submitted_at, 배정 assigned_at = 리프 start_date 00:00 KST (final review M1)", withCase(db, async (q) => {
  const [sub] = await q("select count(*)::int as n, count(*) filter (where updated_at <> first_submitted_at)::int as bad from public.submissions");
  assertEquals([(sub.n as number) > 0, sub.bad], [true, 0]);
  const [asg] = await q(
    `select count(*)::int as n,
            count(*) filter (where a.assigned_at <> ((g.start_date::timestamp) at time zone 'Asia/Seoul'))::int as bad
     from public.task_assignments a join public.goal_nodes g on g.id = a.node_id`);
  assertEquals([(asg.n as number) > 0, asg.bad], [true, 0]);
}));
