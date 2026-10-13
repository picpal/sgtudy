import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { nodeByTitle, roomId, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

type R = Record<string, any>;
const sched = async (q: Parameters<typeof uid>[0], from: string, to: string) =>
  (await q("select public.me_schedule($1::date, $2::date) as s", [from, to]))[0].s as R;

sqlTest("me_schedule(철수 09-27~11-07): studies 5개·tone, tasks 19개(st), markers 11개, upcoming EC2 < 섹션 6~7 < 싱글톤", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  const s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals(s.today, TODAY);
  assertEquals(s.studies.map((x: R) => [x.slug, x.membership, x.status, x.tone]),
    [["sqld", "pending", "recruit", "lav"], ["docker", "leader", "recruit", "amber"], ["aws", "joined", "active", "mint"], ["algo", "joined", "ended", "peach"], ["spring", "joined", "active", "lav"]]);
  assertEquals([s.studies[2].title, s.studies[2].startDate, s.studies[2].endDate], ["AWS SAA 자격증 3개월 완주", "2026-10-01", "2026-12-31"]);
  const byTitle = (t: string) => s.tasks.find((x: R) => x.title === t);
  assertEquals(s.tasks.length, 19);                                          // aws 6 + spring 7 + sqld 5(미리보기) + algo 13주차 1
  assertEquals(s.tasks.filter((x: R) => x.slug === "sqld").every((x: R) => x.st === "planned"), true);
  assertEquals(byTitle("EC2 인스턴스 유형 정리"), { ...byTitle("EC2 인스턴스 유형 정리"), slug: "aws", s: "2026-10-08", e: "2026-10-14", st: "open", round: "2주차" });
  assertEquals([byTitle("IAM 정책 이해").st, byTitle("스프링 컨테이너 실습").st, byTitle("섹션 1~5 정리 노트").st, byTitle("싱글톤 컨테이너 실습 코드").st], ["done", "late", "done", "planned"]);
  assertEquals([byTitle("13주차 문제 풀이").st, byTitle("13주차 문제 풀이").round], ["done", "9–13주차"]);
  assertEquals(typeof byTitle("EC2 인스턴스 유형 정리").id, "string");
  assertEquals(s.tasks.find((x: R) => x.title === "S3 스토리지 클래스 발표자료"), undefined);   // 철수 미담당
  assertEquals(s.markers.length, 11);
  assertEquals(s.markers.filter((m: R) => m.slug === "sqld"), [{ date: "2026-10-26", slug: "sqld", round: "1주차" }, { date: "2026-11-02", slug: "sqld", round: "2주차" }]);
  assertEquals(s.markers[0], { date: "2026-10-01", slug: "aws", round: "1주차" });
  assertEquals(s.upcoming.map((x: R) => [x.title, x.e, x.st]), [["EC2 인스턴스 유형 정리", "2026-10-14", "open"], ["섹션 6~7 정리 노트", "2026-10-18", "open"], ["싱글톤 컨테이너 실습 코드", "2026-10-18", "planned"]]);
}));

sqlTest("me_schedule: 창 밖 제외·upcoming 은 창과 독립, 보관 리프 제외, 11월 창에서 sqld 미리보기·docker(그룹장) 과제", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  let s = await sched(q, "2026-11-08", "2026-12-12");
  assertEquals(s.tasks.filter((x: R) => x.slug === "aws").length, 0);
  assertEquals(s.tasks.filter((x: R) => x.slug === "sqld").length, 6);         // 내장 함수(e=11-08 겹침)·2과목 전반 + 3주차 2 + 4주차 2. SELECT·JOIN(11-05 끝)은 제외
  assertEquals(s.tasks.filter((x: R) => x.slug === "docker").every((x: R) => x.st === "planned"), true);
  assertEquals(s.tasks.filter((x: R) => x.slug === "docker").length, 7);       // 1~5주차 7개. 6주차(12-14 시작)는 창 밖
  assertEquals(s.upcoming.map((x: R) => x.title), ["EC2 인스턴스 유형 정리", "섹션 6~7 정리 노트", "싱글톤 컨테이너 실습 코드"]);
  // EC2 보관 → tasks·upcoming 에서 사라진다
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  await q("select public.node_archive($1, $2)", ["aws", await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리")]);
  await asUser(q, await uid(q, "철수"));
  s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals(s.tasks.find((x: R) => x.title === "EC2 인스턴스 유형 정리"), undefined);
  assertEquals(s.upcoming.map((x: R) => x.title), ["섹션 6~7 정리 노트", "싱글톤 컨테이너 실습 코드"]);
  // 오늘이 10-20 이면 섹션 6~7 은 missed, upcoming 은 ALB(10-21, planned)·MVC(10-25)·서블릿(10-25)
  await setToday(q, "2026-10-20");
  s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals(s.tasks.find((x: R) => x.title === "VPC 실습").st, "done");
  assertEquals(s.tasks.find((x: R) => x.title === "섹션 6~7 정리 노트").st, "missed");
  assertEquals(s.upcoming.map((x: R) => [x.title, x.e]), [["ALB vs NLB 실습", "2026-10-21"], ["MVC 구조 이해 노트", "2026-10-25"], ["서블릿→MVC 리팩토링", "2026-10-25"]]);
}));

sqlTest("me_schedule: leader_does_tasks=false 그룹장(가은)은 st=null 로 보이고 upcoming 제외, 이탈자 제외, 범위·인증 오류", withCase(db, async (q) => {
  await setToday(q, "2026-10-27");
  await asUser(q, await uid(q, "가은"));
  let s = await sched(q, "2026-10-25", "2026-11-28");
  assertEquals(s.studies.map((x: R) => [x.slug, x.membership]), [["sqld", "leader"]]);
  assertEquals([s.tasks.length, s.tasks.every((x: R) => x.st === null), s.upcoming], [9, true, []]);
  await asUser(q, await uid(q, "도윤"));                                          // aws INACTIVE
  s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals([s.studies, s.tasks, s.markers], [[], [], []]);
  await asUser(q, await uid(q, "철수"));
  await expectFail(q("select public.me_schedule('2026-09-01'::date, '2026-11-03'::date)"), "SCHEDULE_RANGE_INVALID");   // 63일
  assertEquals((await sched(q, "2026-09-01", "2026-11-02")).today, "2026-10-27");                                     // 62일은 허용
  await expectFail(q("select public.me_schedule('2026-11-03'::date, '2026-11-01'::date)"), "SCHEDULE_RANGE_INVALID");
  await expectFail(q("select public.me_schedule(null, '2026-11-01'::date)"), "SCHEDULE_RANGE_INVALID");
  await asAnon(q);   // superuser 아래에서 claims 만 비운 경우 → EXECUTE 는 있으니 AUTH_REQUIRED. 실제 anon 역할은 아래 privileges 사례(42501/permission denied)
  await expectFail(q("select public.me_schedule('2026-10-01'::date, '2026-10-31'::date)"), "AUTH_REQUIRED");
}));

sqlTest("me_schedule: 보관 리프 술어 격리(resync 없이 archived_at 만 찍어도 tasks·upcoming 에서 빠진다)", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
  await q("update public.goal_nodes set archived_at = now() where id = $1", [ec2]);     // 배정 행은 그대로 live — 리프의 archived_at 술어만 검증
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null", [ec2]))[0].n as number > 0, true);
  await asUser(q, await uid(q, "철수"));
  const s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals(s.tasks.find((x: R) => x.title === "EC2 인스턴스 유형 정리"), undefined);
  assertEquals(s.upcoming.map((x: R) => x.title), ["섹션 6~7 정리 노트", "싱글톤 컨테이너 실습 코드"]);
}));

sqlTest("me_schedule: upcoming 경계 — 오늘(10-14)에 끝나는 과제와 오늘+7(10-21)에 끝나는 과제를 포함", withCase(db, async (q) => {
  await setToday(q, "2026-10-14");
  await asUser(q, await uid(q, "철수"));
  const s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals(s.upcoming.map((x: R) => [x.title, x.e]),
    [["EC2 인스턴스 유형 정리", "2026-10-14"], ["섹션 6~7 정리 노트", "2026-10-18"], ["싱글톤 컨테이너 실습 코드", "2026-10-18"], ["ALB vs NLB 실습", "2026-10-21"]]);   // e=오늘, e=오늘+7 포함. MVC(10-25)는 밖
}));

sqlTest("privileges (D7): 플랜 03 내부 함수는 anon·authenticated 실행 불가, me_schedule 은 실제 역할로 실행", withCase(db, async (q) => {
  const can = async (role: string, fn: string) =>
    (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
  // 임의 uid 를 받는 빌더(리뷰 D1 의 노출 경로) + 트리 헬퍼 + 03-api 에 없는 래퍼. 양성(공개 RPC)은 catalog sweep(_cases-rooms.ts)이 맡는다.
  for (const fn of [
    "public.curriculum_json(bigint,uuid,boolean)", "public.me_schedule_leaves(uuid,date)",
    "public.room_progress(bigint)", "public.node_subtree(bigint)", "public.node_has_submissions(bigint)",
    "public.node_assert_editable(text)", "public.node_get(bigint,bigint)", "public.goal_nodes_guard()",
    "public.node_indent(text,bigint)", "public.node_outdent(text,bigint)",
  ]) {
    assertEquals(await can("anon", fn), false, `anon → ${fn}`);
    assertEquals(await can("authenticated", fn), false, `authenticated → ${fn}`);
  }
  assertEquals([await can("authenticated", "public.me_schedule(date,date)"), await can("anon", "public.me_schedule(date,date)")], [true, false]);
  await setToday(q, TODAY);
  const jihoon = await uid(q, "지훈");
  await asUser(q, await uid(q, "철수"));
  await q("set local role authenticated");
  assertEquals((await sched(q, "2026-10-01", "2026-10-31")).studies.length, 5);
  await expectFail(q("select public.curriculum_json(9, $1::uuid, true)", [jihoon]), "permission denied");
  await expectFail(q("select public.me_schedule_leaves($1::uuid, '2026-10-12'::date)", [jihoon]), "permission denied");
  await expectFail(q("select public.node_indent('aws', 1)"), "permission denied");
  await q("reset role");
  await asAnon(q);
  await q("set local role anon");
  await expectFail(q("select public.me_schedule('2026-10-01'::date, '2026-10-31'::date)"), "permission denied");
  await q("reset role");
}));
