// 0023 일정 변경 알림 본문에 "무엇이 어떻게" — 과제 SCHEDULE_CHANGED 본문이 옛 날짜 → 새 날짜를 말한다
// (마감만: '마감 10.14 → 10.17', 시작만: '시작 …', 둘 다: '기간 a – b → c – d'). 방 기간(ROOM_PERIOD_CHANGED)은 0018 이 이미 옛 → 새
import { assertEquals } from "@std/assert";
import { applySeed, asUser, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

/** 철수(EC2 담당)가 받은 이번 저장의 SCHEDULE_CHANGED 본문 */
const bodyFor = async (q: Q, node: string) =>
  (await one(q, `select body from public.notifications where user_id = $1::uuid and kind = 'SCHEDULE_CHANGED'
                 and node_id = $2::bigint and created_at >= now()`, [await uidOf(q, "철수"), node])).body as string;
const save = async (q: Q, node: string, patch: Record<string, string>) => {
  await asUser(q, await uidOf(q, "민수"));
  await q("select public.node_update('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify(patch)]);
};
const render = async (q: Q, node: string, model: Record<string, string>) =>
  (await one(q, "select public.notify_render('SCHEDULE_CHANGED', $1::bigint, $2::bigint, null, $3::jsonb) as t",
    [await roomId(q, "aws"), node, JSON.stringify(model)])).t as { title: string; body: string | null };

cases("schedule diff (0023)", db, [
  { name: "node_update: 마감만 바꾸면 본문은 '\"과제\" 마감 옛 → 새'", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");            // 2026-10-08 – 10-14, 철수·지은 담당
    await save(q, ec2, { endDate: "2026-10-17" });
    assertEquals(await bodyFor(q, ec2), '"EC2 인스턴스 유형 정리" 마감 10.14 → 10.17');
  } },
  { name: "node_update: 시작만 바꾸면 '시작 옛 → 새'", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await save(q, ec2, { startDate: "2026-10-09" });
    assertEquals(await bodyFor(q, ec2), '"EC2 인스턴스 유형 정리" 시작 10.08 → 10.09');
  } },
  { name: "node_update: 둘 다 바꾸면 '기간 옛 시작 – 옛 마감 → 새 시작 – 새 마감'", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await save(q, ec2, { startDate: "2026-10-09", endDate: "2026-10-20" });
    assertEquals(await bodyFor(q, ec2), '"EC2 인스턴스 유형 정리" 기간 10.08 – 10.14 → 10.09 – 10.20');
  } },
  { name: "notify_render: 오늘과 다른 해 날짜는 YYYY.MM.DD(0024 format.ts 규칙), 옛 날짜가 없는 모델(0023 이전 호출)은 새 기간만", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    assertEquals((await render(q, ec2, { oldStartDate: "2026-12-20", oldEndDate: "2026-12-28", startDate: "2026-12-20", endDate: "2027-01-03" })).body,
                 '"EC2 인스턴스 유형 정리" 마감 12.28 → 2027.01.03');   // 0024: 오늘과 다른 해만 YYYY.MM.DD
    assertEquals((await render(q, ec2, { startDate: "2026-10-13", endDate: "2026-10-19" })).body,
                 '"EC2 인스턴스 유형 정리" 10.13 – 10.19');
    assertEquals((await render(q, ec2, { oldStartDate: "2026-10-08", oldEndDate: "2026-10-14", startDate: "2026-10-08", endDate: "2026-10-17" })).title,
                 "AWS SAA 자격증 3개월 완주 일정이 변경됐어요");                  // 제목은 그대로
  } },
]);
