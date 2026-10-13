import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { nodeByTitle, roomId, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

const studies = async (q: Parameters<typeof uid>[0]) => (await q("select public.me_studies() as s"))[0].s as Record<string, any>;
const flat = (s: Record<string, any>) => s.groups.map((g: any) => [g.kind, g.items.map((i: any) => [i.slug, i.membership, i.when.kind, i.when.date])]);

sqlTest("me_studies(철수): 진행중 aws 10-14·spring 10-18, 모집중 sqld(pending) 10-26·docker(leader) 11-09, 종료 algo 09-30", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  const s = await studies(q);
  assertEquals(s.today, TODAY);
  assertEquals(flat(s), [
    ["active",  [["aws", "joined", "deadline", "2026-10-14"], ["spring", "joined", "deadline", "2026-10-18"]]],
    ["recruit", [["sqld", "pending", "start", "2026-10-26"], ["docker", "leader", "start", "2026-11-09"]]],
    ["ended",   [["algo", "joined", "end", "2026-09-30"]]],
  ]);
  const aws = s.groups[0].items[0];
  assertEquals([aws.title, typeof aws.intro], ["AWS SAA 자격증 3개월 완주", "string"]);
}));

sqlTest("me_studies: OPEN 과제가 없으면 when=end(방 종료일), 보관 방·이탈 방은 빠진다, 비로그인 AUTH_REQUIRED", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));                                      // 그룹장: IAM·VPC 제출, EC2 미담당 → OPEN 없음
  let s = await studies(q);
  assertEquals(s.groups[0].items.map((i: any) => [i.slug, i.membership, i.when]), [["aws", "leader", { kind: "end", date: "2026-12-31" }]]);
  // 철수의 EC2 를 보관하면 철수도 end 로 떨어진다
  await q("select public.node_archive($1, $2)", ["aws", await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리")]);
  await asUser(q, await uid(q, "철수"));
  s = await studies(q);
  assertEquals(s.groups[0].items.map((i: any) => [i.slug, i.when]), [["spring", { kind: "deadline", date: "2026-10-18" }], ["aws", { kind: "end", date: "2026-12-31" }]]);  // when 날짜순
  // 보관된 방은 사라진다
  await q("update public.rooms set archived_at = now() where slug = 'algo'");
  s = await studies(q);
  assertEquals(s.groups[2], { kind: "ended", items: [] });
  // 이탈자(도윤)는 aws 가 없다
  await asUser(q, await uid(q, "도윤"));
  s = await studies(q);
  assertEquals(s.groups.map((g: any) => g.items.length), [0, 0, 0]);
  await asAnon(q);
  await expectFail(q("select public.me_studies()"), "AUTH_REQUIRED");
}));

sqlTest("me_studies: 모집중 방은 PENDING 뿐 아니라 ACTIVE 멤버도, DRAFT 방은 그룹장만", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "도현"));                                      // toeic ACTIVE 멤버(모집중)
  let s = await studies(q);
  assertEquals(flat(s)[1], ["recruit", [["toeic", "joined", "start", "2026-11-02"]]]);
  await asUser(q, await uid(q, "서연"));                                      // toeic 그룹장 + 새 DRAFT 방
  await q(`select public.room_create('초안 방 Draft', '소개', '2026-12-01'::date, '2026-12-20'::date, 4, true, 'direct')`);
  s = await studies(q);
  assertEquals(s.groups[1].items.map((i: any) => [i.title, i.membership, i.when.date]),
    [["토익 900 8주 챌린지", "leader", "2026-11-02"], ["초안 방 Draft", "leader", "2026-12-01"]]);
}));

sqlTest("privileges: me_studies — authenticated 는 실행, anon 은 permission denied", withCase(db, async (q) => {
  const can = async (role: string) =>
    (await q(`select has_function_privilege($1, 'public.me_studies()', 'execute') as ok`, [role]))[0].ok as boolean;
  assertEquals([await can("authenticated"), await can("anon")], [true, false]);
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  await q("set local role authenticated");
  assertEquals((await studies(q)).groups.length, 3);
  await q("reset role");
  await asAnon(q);
  await q("set local role anon");
  await expectFail(q("select public.me_studies()"), "permission denied");
  await q("reset role");
}));
