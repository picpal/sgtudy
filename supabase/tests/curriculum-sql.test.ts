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

