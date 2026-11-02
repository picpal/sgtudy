// 0056 — node_update·node_move·personal_create 의 core 분리. 웹 RPC 응답은 그대로, plan_run·personal_create_many 는 curriculum_json 을 만들지 않는다
import { assert, assertEquals } from "@std/assert";
import { applySeed, asUser, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => { await asUser(q, await uidOf(q, nick)); };
const plan = (ops: unknown[]) => JSON.stringify({ schema: "sgtudy.plan/v1", ops });
const preview = async (q: Q, slug: string, p: string) =>
  (await one(q, "select public.curriculum_plan_preview($1, $2::jsonb, null) as r", [slug, p])).r as Row;
const apply = async (q: Q, slug: string, id: string) =>
  (await one(q, "select public.curriculum_plan_apply($1, $2) as r", [slug, id])).r as Row;
// 이 트랜잭션에서 curriculum_json 이 불린 횟수(사례 첫머리 track_functions = all)
const cjCalls = async (q: Q) =>
  Number((await one(q, "select coalesce(pg_stat_get_xact_function_calls('public.curriculum_json(bigint,uuid,boolean)'::regprocedure), 0) as n")).n);
const track = (q: Q) => q("set local track_functions = 'all'");
const tree = async (q: Q, slug: string) =>
  (await one(q, "select public.curriculum_json(r.id, public.current_user_id(), true) as c from public.rooms r where r.slug = $1", [slug])).c as Row;
const without = (x: Row, ...keys: string[]) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k)));

cases("plan core 0056 · 웹 RPC 응답 불변", db, [
  { name: "node_update 담당 지정 = curriculum_json || {warnings, shifted}", run: async (q) => {
    await as(q, "민수");
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");
    const r = (await one(q, "select public.node_update('aws', $1::bigint, $2::jsonb) as r",
      [s3, JSON.stringify({ assigneeIds: [await uidOf(q, "지은")] })])).r as Row;
    assertEquals(without(r, "warnings", "shifted"), without(await tree(q, "aws"), "warnings"));   // 변경 RPC 는 트리의 warnings 를 자기 경고로 덮는다(0037)
    assertEquals(r.warnings, []);
    assertEquals(r.shifted, { days: 0, tasks: 0, personal: 0, groups: 0, archived: 0 });
  } },
  { name: "node_update 기간 밖 경고는 그대로(PERIOD_OUTSIDE_PARENT·ROOM)", run: async (q) => {
    await as(q, "민수");
    const rds = await nodeId(q, "aws", "RDS·Aurora 비교");
    const r = (await one(q, "select public.node_update('aws', $1::bigint, '{\"endDate\":\"2027-01-15\"}') as r", [rds])).r as Row;
    assertEquals(without(r, "warnings", "shifted"), without(await tree(q, "aws"), "warnings"));   // 변경 RPC 는 트리의 warnings 를 자기 경고로 덮는다(0037)
    assertEquals((r.warnings as Row[]).map((w) => w.code), ["PERIOD_OUTSIDE_PARENT", "PERIOD_OUTSIDE_ROOM"]);
  } },
  { name: "node_update 회차 함께 옮기기 shifted 그대로", run: async (q) => {
    await as(q, "민수");
    const r5 = await nodeId(q, "aws", "데이터베이스");
    const r = (await one(q, "select public.node_update('aws', $1::bigint, '{\"startDate\":\"2026-11-05\",\"endDate\":\"2026-11-11\",\"shiftDescendants\":true}') as r", [r5])).r as Row;
    assertEquals(without(r, "warnings", "shifted"), without(await tree(q, "aws"), "warnings"));   // 변경 RPC 는 트리의 warnings 를 자기 경고로 덮는다(0037)
    assertEquals([r.shifted.days, r.shifted.tasks], [7, 2]);
  } },
  { name: "node_move = curriculum_json", run: async (q) => {
    await as(q, "민수");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const r = (await one(q, "select public.node_move('aws', $1::bigint, $2::bigint, 0) as r", [ec2, await nodeId(q, "aws", "오토스케일링")])).r as Row;
    assertEquals(r, await tree(q, "aws"));
  } },
  { name: "personal_create = curriculum_json || {createdId, warnings} · 기본 기간 = 회차∩방", run: async (q) => {
    await as(q, "지은");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const r = (await one(q, "select public.personal_create('aws', $1::bigint, '내 복습') as r", [r2])).r as Row;
    assertEquals(without(r, "createdId", "warnings"), await tree(q, "aws"));
    assertEquals(r.warnings, []);
    const n = await one(q, "select start_date::text s, end_date::text e from public.goal_nodes where id = $1::bigint", [r.createdId]);
    assertEquals([n.s, n.e], ["2026-10-08", "2026-10-14"]);
  } },
  { name: "웹 RPC 는 curriculum_json 을 한 번만", run: async (q) => {
    await track(q);
    await as(q, "민수");
    const c0 = await cjCalls(q);
    await q("select public.node_update('aws', $1::bigint, '{\"title\":\"ALB vs NLB 비교\"}')", [await nodeId(q, "aws", "ALB vs NLB 실습")]);
    assertEquals(await cjCalls(q) - c0, 1);
  } },
  { name: "core 는 authenticated·anon 이 직접 부를 수 없다", run: async (q) => {
    for (const f of ["public.node_update_core(text,bigint,jsonb)", "public.node_move_core(text,bigint,bigint,int)",
                     "public.personal_create_core(text,bigint,text,date,date,text)"]) {
      for (const role of ["authenticated", "anon"]) {
        assertEquals((await one(q, "select has_function_privilege($1, $2, 'execute') as ok", [role, f])).ok, false, `${role} ${f}`);
      }
    }
    assertEquals((await one(q, "select has_function_privilege('authenticated', 'public.node_update(text,bigint,jsonb)', 'execute') as ok")).ok, true);
  } },
]);

cases("plan core 0056 · MCP 경로는 curriculum_json 없음", db, [
  { name: "plan_run(미리보기·적용): 담당 지정 create · update · move 에서 0회, 결과는 그대로", run: async (q) => {
    await track(q);
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");
    const rds = await nodeId(q, "aws", "RDS·Aurora 비교");
    const p = plan([
      { op: "create", parent: r2, title: "지정 발표 1", taskType: "designated", assignees: ["지은"] },
      { op: "create", parent: r2, title: "지정 발표 2", taskType: "designated", assignees: ["철수", "하나"] },
      { op: "update", id: s3, set: { assignees: ["철수"] } },
      { op: "update", id: rds, set: { endDate: "2027-01-15" } },
      { op: "move", id: await nodeId(q, "aws", "EC2 인스턴스 유형 정리"), parent: await nodeId(q, "aws", "오토스케일링"), index: 0 },
    ]);
    const c0 = await cjCalls(q);
    const d = await preview(q, "aws", p);
    assertEquals(d.ok, true);
    assertEquals(await cjCalls(q) - c0, 0);
    assertEquals(d.summary, { created: 2, updated: 2, moved: 1, restored: 0, shiftedDescendants: 0 });
    assertEquals((d.warnings as Row[]).map((w) => w.code).filter((c) => c.startsWith("PERIOD")), ["PERIOD_OUTSIDE_PARENT", "PERIOD_OUTSIDE_ROOM"]);
    const a = await apply(q, "aws", d.previewId);
    assertEquals(a.ok, true);
    assertEquals(await cjCalls(q) - c0, 0);
    const asg = await q(`select p.nickname from public.task_assignments t join public.profiles p on p.id = t.user_id
                         where t.node_id = $1::bigint and t.released_at is null order by 1`, [s3]);
    assertEquals(asg.map((x) => x.nickname), ["철수"]);
  } },
  { name: "personal_create_many: 0회 · 결과 그대로", run: async (q) => {
    await track(q);
    await as(q, "지은");
    const c0 = await cjCalls(q);
    const r = (await one(q, "select public.personal_create_many('aws', '\"2주차\"'::jsonb, $1::jsonb) as r",
      [JSON.stringify([{ title: "복습 1" }, { title: "복습 2" }, { title: "복습 1" }])])).r as Row;
    assertEquals(await cjCalls(q) - c0, 0);
    assertEquals([r.count, r.skipped, (r.createdIds as string[]).length], [2, ["복습 1"], 2]);
  } },
]);

// 큰 방: aws 에 회차 10 × 과제 30 을 더해 ~350 노드 → 담당 지정 48 계획 미리보기.
// PGlite 실측(2026-11-02): 분리 전 10.4s → 후 6.9s(1,050노드면 120s → 53s). 남은 시간의 대부분은 호출마다 방 전체 assignment_resync(범위 밖 B).
// 시간 상한은 기계 부하에 흔들리지 않게 느슨히 둔 회귀 감지용 — 분리 여부는 위 호출 수 사례가, 3초 한도는 로컬 MCP 벤치가 본다
const BOUND_MS = 15000;
cases("plan core 0056 · 큰 방 성능", db, [
  { name: `방 ~350노드 + 담당 지정 48 미리보기 < ${BOUND_MS}ms`, run: async (q) => {
    await as(q, "민수");
    const room = await roomId(q, "aws");
    await q(`with rd as (
               insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
               select $1::bigint, null, 2, 100 + i, 'P' || i, '부하 회차 ' || i, date '2026-11-05', date '2026-11-11' from generate_series(1, 10) i
               returning id)
             update public.goal_nodes g set round_id = g.id from rd where g.id = rd.id`, [room]);
    await q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
             select $1::bigint, g.id, g.id, 3, j, g.title || ' 과제 ' || j, g.start_date, g.end_date, 'COMMON'
             from public.goal_nodes g cross join generate_series(1, 30) j where g.room_id = $1::bigint and g.title like '부하 회차 %'`, [room]);
    await q("select public.assignment_resync($1::bigint)", [room]);
    const ops = Array.from({ length: 6 }, (_, i) => ({
      op: "create", title: `벤치 회차 ${i + 1}`,
      children: Array.from({ length: 8 }, (_, j) => ({ title: `지정 ${i + 1}-${j + 1}`, taskType: "designated", assignees: ["지은", "철수"] })),
    }));
    const t0 = performance.now();
    const d = await preview(q, "aws", plan(ops));
    const ms = Math.round(performance.now() - t0);
    console.log(`  preview 350노드 + 담당 48: ${ms}ms`);
    assertEquals(d.ok, true, JSON.stringify(d.errors));
    assertEquals(d.summary.created, 54);
    assert(ms < BOUND_MS, `${ms}ms ≥ ${BOUND_MS}ms`);
  } },
]);
