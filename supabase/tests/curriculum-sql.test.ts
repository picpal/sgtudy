import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { mkLeaf, mkRoom, mkRound, nodeByTitle, roomId, submit, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

type Node = Record<string, any>;
const get = async (q: Parameters<typeof uid>[0], slug: string, archived = false) =>
  (await q("select public.curriculum_get($1, $2) as c", [slug, archived]))[0].c as Record<string, any>;
const peopleOf = (n: Node) => Object.fromEntries((n.task.people as Node[]).map((p) => [p.nickname, p.status]));

sqlTest("curriculum_get(aws): 전위 순서·집계·IAM people(민수 done 지은 late 철수 done 하나 missed)·stats", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  const c = await get(q, "aws");
  assertEquals(c.today, TODAY);
  assertEquals(c.room, { slug: "aws", status: "active", leaderDoesTasks: true });
  assertEquals(c.members[0].nickname, "민수");                                   // 그룹장 먼저
  assertEquals(c.members.map((m: Node) => [m.nickname, m.role, m.status, m.doesTasks]).sort(),
    [["민수", "leader", "active", true], ["지은", "member", "active", true], ["철수", "member", "active", true], ["하나", "member", "active", true], ["도윤", "member", "inactive", false]].sort());
  const titles = c.nodes.map((n: Node) => n.title);
  assertEquals(titles, ["IAM·VPC", "IAM 정책 이해", "VPC 실습", "EC2·S3", "EC2 인스턴스 유형 정리", "S3 스토리지 클래스 발표자료",
    "고가용성 아키텍처", "로드밸런서 비교", "ALB vs NLB 실습", "오토스케일링", "Auto Scaling 정책 정리", "데이터베이스", "RDS·Aurora 비교", "DynamoDB 설계 퀴즈"]);
  const iam = c.nodes[1];
  assertEquals([iam.depth, iam.parentId, iam.roundId, iam.sortOrder, iam.label, iam.archived], [3, c.nodes[0].id, c.nodes[0].id, 0, null, false]);
  assertEquals([iam.startDate, iam.endDate, iam.assigned, iam.submitted, iam.pct], ["2026-10-01", "2026-10-03", 4, 3, 75]);
  assertEquals(iam.task.type, "common");
  assertEquals(iam.task.state, "delayed");                       // sub<asg, e<today
  assertEquals(peopleOf(iam), { 민수: "done", 지은: "late", 철수: "done", 하나: "missed" });
  assertEquals(iam.task.people.map((p: Node) => p.nickname), ["민수", "지은", "철수", "하나"]);
  assertEquals(typeof iam.task.people[0].userId, "string");
  assertEquals(iam.task.people[0].tone, "mint");
  const ec2 = c.nodes[4];
  assertEquals([ec2.task.type, ec2.task.state], ["designated", "progress"]);
  assertEquals(peopleOf(ec2), { 지은: "done", 철수: "open" });
  const alb = c.nodes[8];
  assertEquals([alb.depth, alb.roundId === c.nodes[6].id, alb.task.state], [4, true, "planned"]);
  assertEquals(c.nodes[0].task, null);
  assertEquals([c.nodes[0].assigned, c.nodes[0].submitted, c.nodes[0].pct], [8, 5, 63]);
  assertEquals(c.nodes[0].descriptionMd, "");
  assertEquals(c.stats, { overallPct: 24, leafCount: 8, unassignedCount: 0 });
}));

sqlTest("curriculum_get: 비로그인·비멤버는 people=[] (집계는 보임), 대기자는 people 보임, 비공개 방 비멤버는 ROOM_NOT_FOUND", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asAnon(q);
  let c = await get(q, "aws");
  assertEquals(c.members.length, 5);
  assertEquals(c.nodes[1].task.people, []);
  assertEquals([c.nodes[1].assigned, c.nodes[1].submitted], [4, 3]);
  await asUser(q, await uid(q, "서연"));                          // 로그인했지만 aws 비멤버
  c = await get(q, "aws");
  assertEquals(c.nodes[1].task.people, []);
  await asUser(q, await uid(q, "철수"));                          // sqld PENDING
  c = await get(q, "sqld");
  assertEquals(c.room.leaderDoesTasks, false);
  assertEquals(c.members, [{ ...c.members[0], role: "leader", status: "active", doesTasks: false }]);
  assertEquals(c.stats, { overallPct: null, leafCount: 9, unassignedCount: 1 });
  assertEquals(c.nodes.filter((n: Node) => n.task).every((n: Node) => n.task.people.length === 0 && n.task.state === "unassigned"), true);
  assertEquals((await get(q, "spring")).room.slug, "spring");   // 비공개지만 철수는 멤버
  await asUser(q, await uid(q, "서연"));
  await expectFail(q("select public.curriculum_get($1, false)", ["spring"]), "ROOM_NOT_FOUND");   // 비공개 + 비멤버
  await expectFail(q("select public.curriculum_get($1, false)", ["no-such"]), "ROOM_NOT_FOUND");
}));

sqlTest("curriculum_get: includeArchived 기본 false — 보관 서브트리는 빠지고 true 면 archived=true 로 포함, 집계는 항상 제외", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await roomId(q, "aws");
  const w1 = await nodeByTitle(q, room, "IAM·VPC");
  await asUser(q, await uid(q, "민수"));
  await q("update public.goal_nodes set archived_at = now() where id in (select public.node_subtree($1))", [w1]);
  await q("select public.assignment_resync($1)", [room]);
  let c = await get(q, "aws");
  assertEquals(c.nodes.map((n: Node) => n.title).includes("IAM 정책 이해"), false);
  assertEquals(c.stats, { overallPct: 6, leafCount: 6, unassignedCount: 0 });     // 1/17, 리프 8 - 2
  c = await get(q, "aws", true);
  const iam = c.nodes.find((n: Node) => n.title === "IAM 정책 이해");
  assertEquals([iam.archived, iam.assigned, iam.submitted, iam.pct, iam.task.people, iam.task.state], [true, 0, 0, null, [], "unassigned"]);
  assertEquals(c.nodes[0].title, "IAM·VPC");
}));

sqlTest("curriculum_get: 빈 방은 nodes=[], stats null/0", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const c = await get(q, room.slug);
  assertEquals(c.nodes, []);
  assertEquals(c.stats, { overallPct: null, leafCount: 0, unassignedCount: 0 });
  assertEquals(c.members.length, 1);
}));

sqlTest("privileges: curriculum_get runs under real roles; curriculum_json has no EXECUTE for anon/authenticated (D7)", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const can = async (role: string, fn: string) =>
    (await q(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]))[0].ok as boolean;
  assertEquals(await can("anon", "public.curriculum_get(text,boolean)"), true);
  assertEquals(await can("authenticated", "public.curriculum_get(text,boolean)"), true);
  assertEquals(await can("anon", "public.curriculum_json(bigint,uuid,boolean)"), false);
  assertEquals(await can("authenticated", "public.curriculum_json(bigint,uuid,boolean)"), false);
  const room = await roomId(q, "aws");
  const minsu = await uid(q, "민수");
  await asAnon(q);
  await q("set local role anon");
  const c = (await q("select public.curriculum_get('aws', false) as c"))[0].c as Record<string, any>;
  assertEquals(c.members.length, 5);
  await expectFail(q("select public.curriculum_get('spring', false)"), "ROOM_NOT_FOUND");
  await q("reset role");
  await asUser(q, await uid(q, "철수"));
  await q("set local role authenticated");
  assertEquals(((await q("select public.curriculum_get('spring', false) as c"))[0].c as Record<string, any>).room.slug, "spring");
  await expectFail(q("select public.curriculum_json($1, $2, true)", [room, minsu]), "permission denied");
  await q("reset role");
}));

const call = (q: Parameters<typeof uid>[0], fn: string, args: unknown[]) =>
  q(`select public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as c`, args).then((r) => r[0].c as Record<string, any>);
const byTitle = (c: Record<string, any>, title: string): Node => c.nodes.find((n: Node) => n.title === title);

sqlTest("node_create(회차): 기본값 label/title/기간, index 로 앞에 끼우기, 회차는 빈 부모(task=null)", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");                              // 2026-11-01 ~ 11-28
  let c = await call(q, "node_create", [room.slug]);
  assertEquals(c.nodes.length, 1);
  assertEquals([c.nodes[0].label, c.nodes[0].title, c.nodes[0].startDate, c.nodes[0].endDate, c.nodes[0].depth, c.nodes[0].task, c.nodes[0].sortOrder],
    ["1주차", "새 회차", "2026-11-01", "2026-11-07", 2, null, 0]);
  assertEquals(c.nodes[0].roundId, c.nodes[0].id);
  c = await call(q, "node_create", [room.slug, null, "두 번째", "OT"]);
  assertEquals([c.nodes[1].label, c.nodes[1].title, c.nodes[1].startDate, c.nodes[1].endDate], ["OT", "두 번째", "2026-11-08", "2026-11-14"]);
  c = await q(`select public.node_create($1, null, '앞', null, null, '2026-10-30'::date, null, 0) as c`, [room.slug]).then((r) => r[0].c as Record<string, any>);
  assertEquals(c.nodes.map((n: Node) => [n.title, n.sortOrder]), [["앞", 0], ["새 회차", 1], ["두 번째", 2]]);
  assertEquals([c.nodes[0].label, c.nodes[0].endDate], ["3주차", "2026-11-05"]);     // label 은 "회차 수+1", end = start+6
  // 공백만 있는 제목은 trim 뒤 빈 문자열 → 기본값 '새 회차'(UI 에서 제목 비우고 추가). 81자는 INVALID_TITLE
  c = await q(`select public.node_create($1, null, '   ') as c`, [room.slug]).then((r) => r[0].c as Record<string, any>);
  assertEquals(c.nodes[3].title, "새 회차");
  await expectFail(q(`select public.node_create($1, null, $2)`, [room.slug, "가".repeat(81)]), "INVALID_TITLE");
  await expectFail(q(`select public.node_create($1, null, 'x', null, null, '2026-11-10'::date, '2026-11-09'::date)`, [room.slug]), "INVALID_PERIOD");
  // 회차에 taskType → 회차 자체가 과제인 depth-2 리프(A7). 잘못된 값은 VALIDATION_FAILED
  c = await q(`select public.node_create($1, null, '회차 과제', null, 'common') as c`, [room.slug]).then((r) => r[0].c as Record<string, any>);
  const rl = byTitle(c, "회차 과제");
  assertEquals([rl.depth, rl.label, rl.roundId === rl.id, rl.task.type, rl.task.assigned], [2, "5주차", true, "common", 1]);
  await expectFail(q(`select public.node_create($1, null, 'x', null, 'weird')`, [room.slug]), "VALIDATION_FAILED");
  await asUser(q, await uid(q, "민수"));
  await expectFail(q(`select public.node_create($1)`, [room.slug]), "ROOM_NOT_FOUND");   // DRAFT 외부인
  // D6: 비공개 방(spring)의 외부인은 존재도 모른다, 멤버는 NOT_LEADER
  await asUser(q, await uid(q, "승호"));
  await expectFail(q(`select public.node_create($1)`, ["spring"]), "ROOM_NOT_FOUND");
  await asUser(q, await uid(q, "철수"));
  await expectFail(q(`select public.node_create($1)`, ["spring"]), "NOT_LEADER");
}));

sqlTest("node_create(하위): 기본값·부모 기간 상속·resync, 리프→부모 전환, 제출물 있는 리프·깊이 6·보관 부모는 거부", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await mkRoom(q, "서연");
  let c = await call(q, "node_create", [room.slug]);
  const round = c.nodes[0].id;
  c = await call(q, "node_create", [room.slug, round]);
  const leaf = byTitle(c, "새 과제");
  assertEquals([leaf.depth, leaf.parentId, leaf.roundId, leaf.startDate, leaf.endDate, leaf.task.type, leaf.sortOrder], [3, round, round, "2026-11-01", "2026-11-07", "common", 0]);
  assertEquals([leaf.task.assigned, leaf.task.people.length], [1, 1]);          // 그룹장 서연 자동 배정(resync)
  c = await q(`select public.node_create($1, $2, '지정', null, 'designated', '2026-11-02'::date, '2026-11-03'::date, 0) as c`, [room.slug, round]).then((r) => r[0].c as Record<string, any>);
  assertEquals(c.nodes.slice(1).map((n: Node) => [n.title, n.sortOrder]), [["지정", 0], ["새 과제", 1]]);
  assertEquals(byTitle(c, "지정").task, { ...byTitle(c, "지정").task, type: "designated", assigned: 0, state: "unassigned" });
  // 제출물 없는 리프 아래 자식 → 리프가 부모로 전환되고 배정 released
  c = await call(q, "node_create", [room.slug, leaf.id, "손자"]);
  const conv = byTitle(c, "새 과제");
  assertEquals([conv.task, byTitle(c, "손자").depth, byTitle(c, "손자").roundId], [null, 4, round]);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null", [leaf.id]))[0].n, 0);
  // 깊이: 4 → 5 는 되고, 5 아래는 NODE_DEPTH_EXCEEDED
  c = await call(q, "node_create", [room.slug, byTitle(c, "손자").id, "증손"]);
  assertEquals(byTitle(c, "증손").depth, 5);
  await expectFail(q(`select public.node_create($1, $2)`, [room.slug, byTitle(c, "증손").id]), "NODE_DEPTH_EXCEEDED");
  await expectFail(q(`select public.node_create($1, $2, 'x', null, 'weird')`, [room.slug, round]), "VALIDATION_FAILED");
  await expectFail(q(`select public.node_create($1, $2, 'x', '라벨')`, [room.slug, round]), "VALIDATION_FAILED");  // 하위엔 label 불가
  await expectFail(q(`select public.node_create($1, 999999)`, [room.slug]), "NODE_NOT_FOUND");
  // 제출물 있는 리프(aws IAM) 아래 자식 → NODE_HAS_SUBMISSIONS
  const aws = await roomId(q, "aws");
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  await asUser(q, await uid(q, "민수"));
  await expectFail(q(`select public.node_create($1, $2)`, ["aws", iam]), "NODE_HAS_SUBMISSIONS");
  // 보관된 부모 아래 → PARENT_ARCHIVED
  const w4 = await nodeByTitle(q, aws, "오토스케일링");
  await call(q, "node_archive", ["aws", w4]);
  await expectFail(q(`select public.node_create($1, $2)`, ["aws", w4]), "PARENT_ARCHIVED");
  // 다른 방의 노드 id → NODE_NOT_FOUND, 종료 방 → ROOM_NOT_EDITABLE
  await asUser(q, await uid(q, "현우"));
  await expectFail(q(`select public.node_create($1, $2)`, ["algo", w4]), "ROOM_NOT_EDITABLE");
}));

sqlTest("node_delete: 서브트리에 제출물이 있으면 NODE_HAS_SUBMISSIONS, 없으면 cascade + 형제 재정렬", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const w1 = await nodeByTitle(q, aws, "IAM·VPC");
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  await expectFail(call(q, "node_delete", ["aws", iam]), "NODE_HAS_SUBMISSIONS");
  await expectFail(call(q, "node_delete", ["aws", w1]), "NODE_HAS_SUBMISSIONS");      // 회차도 하위 제출물 때문에 불가
  const w3 = await nodeByTitle(q, aws, "고가용성 아키텍처");                             // 3주차: 중간 노드 + 리프, 제출물 없음
  const alb = await nodeByTitle(q, aws, "ALB vs NLB 실습");
  const c = await call(q, "node_delete", ["aws", w3]);
  assertEquals(c.nodes.filter((n: Node) => n.depth === 2).map((n: Node) => [n.label, n.sortOrder]), [["1주차", 0], ["2주차", 1], ["4주차", 2], ["5주차", 3]]);
  assertEquals((await q("select count(*)::int as n from public.goal_nodes where id in ($1, $2)", [w3, alb]))[0].n, 0);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1", [alb]))[0].n, 0);
  assertEquals(c.stats, { overallPct: 29, leafCount: 7, unassignedCount: 0 });    // 6/21, 리프 8 → 7
  await expectFail(call(q, "node_delete", ["aws", w3]), "NODE_NOT_FOUND");
  await asUser(q, await uid(q, "철수"));
  await expectFail(call(q, "node_delete", ["aws", iam]), "NOT_LEADER");
}));

sqlTest("node_archive/unarchive: 서브트리 전파, 집계·배정 제외/복구(is_late 보존), 부모 보관 중이면 PARENT_ARCHIVED", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const w1 = await nodeByTitle(q, aws, "IAM·VPC");
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  const vpc = await nodeByTitle(q, aws, "VPC 실습");
  let c = await call(q, "node_archive", ["aws", w1]);
  assertEquals([byTitle(c, "IAM·VPC").archived, byTitle(c, "IAM 정책 이해").archived, byTitle(c, "VPC 실습").archived], [true, true, true]);
  assertEquals(c.stats, { overallPct: 6, leafCount: 6, unassignedCount: 0 });      // 1/17, 리프 8 - 2
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id in ($1, $2) and released_at is null", [iam, vpc]))[0].n, 0);
  assertEquals((await q("select count(*)::int as n from public.submissions where node_id = $1", [iam]))[0].n, 4);   // 민수·지은·철수 + 도윤(이탈) 제출물 보존
  await expectFail(call(q, "node_unarchive", ["aws", iam]), "PARENT_ARCHIVED");
  c = await call(q, "node_archive", ["aws", w1]);                                   // 멱등
  assertEquals(byTitle(c, "IAM·VPC").archived, true);
  c = await call(q, "node_unarchive", ["aws", w1]);
  assertEquals([byTitle(c, "IAM·VPC").archived, byTitle(c, "IAM 정책 이해").archived], [false, false]);
  assertEquals(c.stats.overallPct, 24);
  assertEquals(peopleOf(byTitle(c, "IAM 정책 이해")), { 민수: "done", 지은: "late", 철수: "done", 하나: "missed" });
  // 리프 하나만 보관하면 그 리프만
  c = await call(q, "node_archive", ["aws", vpc]);
  assertEquals([byTitle(c, "VPC 실습").archived, byTitle(c, "IAM 정책 이해").archived, byTitle(c, "IAM·VPC").assigned], [true, false, 4]);
  // D13: 지정 리프 보관 → DESIGNATED 행도 해제(업로드 차단), 해제하면 같은 담당자로 복구
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
  const [지은, 철수] = [await uid(q, "지은"), await uid(q, "철수")];
  await call(q, "node_archive", ["aws", ec2]);
  assertEquals((await q("select public.is_task_assignee($1, $2::uuid) as b", [ec2, 철수]))[0].b, false);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null", [ec2]))[0].n, 0);
  c = await call(q, "node_unarchive", ["aws", ec2]);
  assertEquals(peopleOf(byTitle(c, "EC2 인스턴스 유형 정리")), { 지은: "done", 철수: "open" });
  assertEquals((await q("select public.is_task_assignee($1, $2::uuid) as b", [ec2, 지은]))[0].b, true);
}));

sqlTest("privileges: node_create/archive/unarchive/delete run under real roles; node_make_parent·node_renumber have no EXECUTE", withCase(db, async (q) => {
  const can = async (role: string, fn: string) =>
    (await q(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]))[0].ok as boolean;
  for (const fn of ["node_create(text,bigint,text,text,text,date,date,integer)", "node_delete(text,bigint)", "node_archive(text,bigint)", "node_unarchive(text,bigint)"]) {
    assertEquals(await can("authenticated", `public.${fn}`), true, fn);
    assertEquals(await can("anon", `public.${fn}`), false, fn);
  }
  for (const fn of ["node_make_parent(public.goal_nodes,text)", "node_renumber(bigint,bigint,bigint)"]) {
    assertEquals(await can("authenticated", `public.${fn}`), false, fn);
    assertEquals(await can("anon", `public.${fn}`), false, fn);
  }
  const room = await mkRoom(q, "서연");
  await asUser(q, await uid(q, "서연"));
  await q("set local role authenticated");
  let c = await call(q, "node_create", [room.slug]);
  const id = c.nodes[0].id;
  c = await call(q, "node_archive", [room.slug, id]);
  assertEquals(c.nodes[0].archived, true);
  c = await call(q, "node_unarchive", [room.slug, id]);
  assertEquals(c.nodes[0].archived, false);
  c = await call(q, "node_delete", [room.slug, id]);
  assertEquals(c.nodes, []);
  await q("reset role");
  await asAnon(q);
  await q("set local role anon");
  await expectFail(q("select public.node_create($1)", [room.slug]), "permission denied");
  await q("reset role");
}));


const upd = (q: Parameters<typeof uid>[0], slug: string, node: string, patch: Record<string, unknown>) =>
  q(`select public.node_update($1, $2, $3::jsonb) as c`, [slug, node, JSON.stringify(patch)]).then((r) => r[0].c as Record<string, any>);

sqlTest("node_update: 제목·설명·기간·라벨, 경고 PERIOD_OUTSIDE_PARENT/ROOM, 검증 오류", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const w1 = await nodeByTitle(q, aws, "IAM·VPC");
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
  let c = await upd(q, "aws", w1, { label: "OT", title: "오리엔테이션", descriptionMd: "# 첫 주" });
  assertEquals([byTitle(c, "오리엔테이션").label, byTitle(c, "오리엔테이션").descriptionMd, c.warnings], ["OT", "# 첫 주", []]);
  c = await upd(q, "aws", ec2, { startDate: "2026-10-09", endDate: "2026-10-13" });
  assertEquals([byTitle(c, "EC2 인스턴스 유형 정리").startDate, byTitle(c, "EC2 인스턴스 유형 정리").endDate, c.warnings], ["2026-10-09", "2026-10-13", []]);
  c = await upd(q, "aws", ec2, { endDate: "2026-10-16" });                               // 부모 2주차는 10-14 까지
  assertEquals(c.warnings, [{ code: "PERIOD_OUTSIDE_PARENT", nodeId: ec2 }]);
  c = await upd(q, "aws", w1, { startDate: "2026-09-30" });                              // 방은 10-01 부터
  assertEquals(c.warnings, [{ code: "PERIOD_OUTSIDE_ROOM", nodeId: w1 }]);
  await expectFail(upd(q, "aws", ec2, { label: "x" }), "VALIDATION_FAILED");             // 리프에 label
  await expectFail(upd(q, "aws", w1, { label: null }), "VALIDATION_FAILED");             // 회차 label 지우기 금지(A7)
  await expectFail(upd(q, "aws", w1, { label: "  " }), "VALIDATION_FAILED");
  await expectFail(upd(q, "aws", ec2, { startDate: "2026-02-30" }), "VALIDATION_FAILED"); // D11: 22008 원문 대신
  await expectFail(upd(q, "aws", ec2, { endDate: 20261014 }), "VALIDATION_FAILED");
  await expectFail(upd(q, "aws", ec2, { nope: 1 }), "VALIDATION_FAILED");
  await expectFail(upd(q, "aws", ec2, { title: "  " }), "INVALID_TITLE");
  await expectFail(upd(q, "aws", ec2, { startDate: "2026-10-20" }), "INVALID_PERIOD");  // start > end(10-16)
  await expectFail(upd(q, "aws", ec2, { descriptionMd: "x".repeat(20001) }), "VALIDATION_FAILED");
  await expectFail(q(`select public.node_update($1, $2, 'null'::jsonb)`, ["aws", ec2]), "VALIDATION_FAILED");
  await asUser(q, await uid(q, "철수"));
  await expectFail(upd(q, "aws", ec2, { title: "x" }), "NOT_LEADER");
}));

sqlTest("node_update(taskType): 제출물 있으면 양방향 NODE_HAS_SUBMISSIONS, 회차는 NODE_NOT_LEAF, 공통→지정은 담당자 승계·source DESIGNATED", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
  const w1 = await nodeByTitle(q, aws, "IAM·VPC");
  const alb = await nodeByTitle(q, aws, "ALB vs NLB 실습");
  await expectFail(upd(q, "aws", iam, { taskType: "designated" }), "NODE_HAS_SUBMISSIONS");
  await expectFail(upd(q, "aws", ec2, { taskType: "common" }), "NODE_HAS_SUBMISSIONS");
  await expectFail(upd(q, "aws", w1, { taskType: "common" }), "NODE_NOT_LEAF");
  await expectFail(upd(q, "aws", w1, { assigneeIds: [] }), "NODE_NOT_LEAF");              // E3: 회차의 assigneeIds 는 조용히 무시되지 않는다
  await expectFail(upd(q, "aws", alb, { taskType: "weird" }), "VALIDATION_FAILED");
  let c = await upd(q, "aws", alb, { taskType: "designated" });
  assertEquals([byTitle(c, "ALB vs NLB 실습").task.type, Object.keys(peopleOf(byTitle(c, "ALB vs NLB 실습"))).sort(), c.warnings], ["designated", ["민수", "지은", "철수", "하나"], []]);
  const src = await q("select source, count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null group by source", [alb]);
  assertEquals(src, [{ source: "DESIGNATED", n: 4 }]);
  c = await upd(q, "aws", alb, { taskType: "common" });
  assertEquals((await q("select source, count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null group by source", [alb])), [{ source: "COMMON", n: 4 }]);
  // 공통 리프의 assigneeIds 는 무시된다
  c = await upd(q, "aws", alb, { assigneeIds: [await uid(q, "철수")] });
  assertEquals(byTitle(c, "ALB vs NLB 실습").task.assigned, 4);
  // E4: 지정→공통 전환 뒤 공통 대상이 아닌 사람(leader_does_tasks=false 그룹장)의 DESIGNATED 행이 남지 않는다
  await upd(q, "aws", alb, { taskType: "designated" });
  await q("update public.rooms set leader_does_tasks = false where id = $1", [aws]);
  c = await upd(q, "aws", alb, { taskType: "common" });
  assertEquals(byTitle(c, "ALB vs NLB 실습").task.assigned, 3);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1 and user_id = $2 and released_at is null", [alb, await uid(q, "민수")]))[0].n, 0);
}));

sqlTest("node_update(assigneeIds): 교체·해제·0명 경고, ASSIGNEE_NOT_MEMBER(이탈자·비멤버·leader_does_tasks=false 그룹장), ASSIGNEE_HAS_SUBMISSION", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const s3 = await nodeByTitle(q, aws, "S3 스토리지 클래스 발표자료");    // 지정, 하나 O, 제출 없음
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");         // 지정, 지은 D, 철수 O
  const [지은, 철수, 하나, 도윤, 서연, 민수] = await Promise.all(["지은", "철수", "하나", "도윤", "서연", "민수"].map((n) => uid(q, n)));
  let c = await upd(q, "aws", s3, { assigneeIds: [지은, 철수] });
  assertEquals([peopleOf(byTitle(c, "S3 스토리지 클래스 발표자료")), c.warnings], [{ 지은: "open", 철수: "open" }, []]);
  const rows = await q("select user_id::text as u, source, released_at is null as live from public.task_assignments where node_id = $1 order by id", [s3]);
  assertEquals(rows.map((r) => [r.u, r.source, r.live]).sort(), [[지은, "DESIGNATED", true], [철수, "DESIGNATED", true], [하나, "DESIGNATED", false]].sort());
  c = await upd(q, "aws", s3, { assigneeIds: [] });
  assertEquals([byTitle(c, "S3 스토리지 클래스 발표자료").task.state, c.warnings, c.stats.unassignedCount], ["unassigned", [{ code: "UNASSIGNED_TASK", nodeId: s3 }], 1]);
  c = await upd(q, "aws", s3, { assigneeIds: [하나] });                   // 같은 행 복구
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1", [s3]))[0].n, 3);
  await expectFail(upd(q, "aws", s3, { assigneeIds: [도윤] }), "ASSIGNEE_NOT_MEMBER");   // INACTIVE
  await expectFail(upd(q, "aws", s3, { assigneeIds: [서연] }), "ASSIGNEE_NOT_MEMBER");   // 비멤버
  await expectFail(upd(q, "aws", s3, { assigneeIds: ["not-a-uuid"] }), "VALIDATION_FAILED");
  await expectFail(upd(q, "aws", ec2, { assigneeIds: [철수] }), "ASSIGNEE_HAS_SUBMISSION");   // 지은(제출) 제거
  c = await upd(q, "aws", ec2, { assigneeIds: [지은] });                   // 철수(미제출) 제거는 가능
  assertEquals(peopleOf(byTitle(c, "EC2 인스턴스 유형 정리")), { 지은: "done" });
  assertEquals(c.stats.overallPct, 25);                                    // 6/24
  await q("update public.rooms set leader_does_tasks = false where id = $1", [aws]);
  await expectFail(upd(q, "aws", s3, { assigneeIds: [민수] }), "ASSIGNEE_NOT_MEMBER");
}));

sqlTest("node_update: ACTIVE 방 기간 변경·담당자 교체가 notify_publish 를 kind·수신자·prefix 대로 부르고 한 번에 적용된다(E2 spy)", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const s3 = await nodeByTitle(q, aws, "S3 스토리지 클래스 발표자료");
  const [지은, 하나] = [await uid(q, "지은"), await uid(q, "하나")];
  // 0008 전의 자리표를 이 사례 안에서만 스파이로 바꾼다(롤백됨)
  await q("create temp table spy(kind text, rcpt uuid[], prefix text)");
  await q(`create or replace function public.notify_publish(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb)
    returns int language sql security definer set search_path = '' as $$ insert into pg_temp.spy values (p_kind, p_recipients, p_dedupe_prefix) returning 0 $$`);
  const c = await upd(q, "aws", s3, { endDate: "2026-10-15", assigneeIds: [지은] });
  assertEquals([byTitle(c, "S3 스토리지 클래스 발표자료").endDate, c.warnings], ["2026-10-15", [{ code: "PERIOD_OUTSIDE_PARENT", nodeId: s3 }]]);
  const rows = await q("select user_id::text as u, source, released_at is null as live from public.task_assignments where node_id = $1", [s3]);
  assertEquals(rows.map((x) => [x.u, x.source, x.live]).sort(), [[지은, "DESIGNATED", true], [하나, "DESIGNATED", false]].sort());
  const spy = await q("select kind, cardinality(rcpt)::int as n, rcpt[1]::text as first, prefix from spy order by kind");
  assertEquals(spy.map((x) => [x.kind, x.n, x.first]), [["SCHEDULE_CHANGED", 1, 지은], ["TASK_ASSIGNED", 1, 지은], ["TASK_UNASSIGNED", 1, 하나]]);
  for (const x of spy) assertEquals(new RegExp(`^${x.kind}:${aws}:${s3}:\\d+$`).test(x.prefix as string), true, String(x.prefix));
}));

sqlTest("privileges: node_update runs under real roles (authenticated 그룹장), anon 은 permission denied", withCase(db, async (q) => {
  const can = async (role: string) =>
    (await q(`select has_function_privilege($1, 'public.node_update(text,bigint,jsonb)', 'execute') as ok`, [role]))[0].ok as boolean;
  assertEquals([await can("authenticated"), await can("anon")], [true, false]);
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
  await asUser(q, await uid(q, "민수"));
  await q("set local role authenticated");
  const c = await upd(q, "aws", ec2, { title: "EC2 정리" });
  assertEquals(byTitle(c, "EC2 정리").title, "EC2 정리");
  await q("reset role");
  await asAnon(q);
  await q("set local role anon");
  await expectFail(upd(q, "aws", ec2, { title: "x" }), "permission denied");
  await q("reset role");
}));
