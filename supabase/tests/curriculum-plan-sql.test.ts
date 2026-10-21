// 0034 — 진행목표 계획서(curriculum_plan) · node_create_core · curriculum_version · 알림 묶기
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { applySeed, asUser, expectFail, newUser, openDb } from "./_harness.ts";
import { cases, nodeId, one, roomId, uidOf, type Q, type Row } from "./_fixtures.ts";
import { mkRoom, submit } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => { await asUser(q, await uidOf(q, nick)); };
const ver = async (q: Q, slug: string) => (await one(q, "select public.curriculum_version($1::bigint) as v", [await roomId(q, slug)])).v as string;
const count = async (q: Q, sql: string, p: unknown[] = []) => Number((await one(q, `select count(*)::int as n from (${sql}) x`, p)).n);

cases("curriculum plan 0034 · core", db, [
  { name: "node_create 는 분리 후에도 같은 결과(회차 기본 라벨·기간, 하위 기본 common, 리프 → 부모 전환)", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const c1 = (await one(q, "select public.node_create($1) as c", [slug])).c as Row;
    const round = c1.nodes[0];
    assertEquals([round.label, round.startDate, round.endDate], ["1주차", "2026-11-01", "2026-11-07"]);
    const c2 = (await one(q, "select public.node_create($1, $2::bigint, '과제 A') as c", [slug, round.id])).c as Row;
    const leaf = c2.nodes.find((n: Row) => n.title === "과제 A");
    assertEquals(leaf.task.type, "common");
    const c3 = (await one(q, "select public.node_create($1, $2::bigint, '하위') as c", [slug, leaf.id])).c as Row;
    assertEquals(c3.nodes.find((n: Row) => n.id === leaf.id).task, null);
  } },
  { name: "node_create_core 는 id 를 돌려주고 설명을 저장한다(배정 동기화는 호출자 몫)", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const r = await one(q, "select public.node_create_core(r, public.current_user_id(), null, '회차', null, null, null, null, null, '설명') as id from public.rooms r where r.slug = $1", [slug]);
    const n = await one(q, "select depth, description_md, round_id::text as rid from public.goal_nodes where id = $1::bigint", [r.id]);
    assertEquals([n.depth, n.description_md, n.rid], [2, "설명", String(r.id)]);
  } },
  { name: "curriculum_version: 제목·일정·지정 담당이 바뀌면 달라지고, 제출·개인 목표에는 그대로", run: async (q) => {
    await as(q, "민수");
    const v0 = await ver(q, "aws");
    assertMatch(v0, /^[0-9a-f]{32}$/);
    await submit(q, await nodeId(q, "aws", "ALB vs NLB 실습"), "지은");
    assertEquals(await ver(q, "aws"), v0);       // 제출 무관
    await as(q, "지은");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    await q("select public.personal_create('aws', $1::bigint, '내 복습')", [r2]);
    assertEquals(await ver(q, "aws"), v0);
    await as(q, "민수");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    await q("select public.node_update('aws', $1::bigint, '{\"title\":\"ALB vs NLB 비교 실습\"}')", [alb]);
    assertNotEquals(await ver(q, "aws"), v0);
  } },
  { name: "〔C#3〕 curriculum_version: 필드 경계 충돌 없음(라벨 'x|y'+제목 'z' ≠ 라벨 'x'+제목 'y|z') · null 자리 유지", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const c = (await one(q, "select public.node_create($1, null, 'z', 'x|y') as c", [slug])).c as Row;
    const rid = c.nodes[0].id;
    const v1 = await ver(q, slug);
    await q("select public.node_update($1, $2::bigint, '{\"label\":\"x\",\"title\":\"y|z\"}')", [slug, rid]);
    assertNotEquals(await ver(q, slug), v1);   // concat_ws('|') 판에서는 둘 다 '…|x|y|z|…' 로 같았다
  } },
  { name: "〔C#3〕 curriculum_version: 방 시작일·상태·ACTIVE 멤버가 바뀌면 달라진다", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const v0 = await ver(q, slug);
    await q("update public.rooms set start_date = start_date + 7, end_date = end_date + 7 where id = $1::bigint", [id]);
    const v1 = await ver(q, slug);
    assertNotEquals(v1, v0);                    // 빈 방 회차 기본 날짜 = 방 시작일 → 미리본 날짜와 달라질 수 있다
    await q(`insert into public.room_members (room_id, user_id, role, status, joined_at)
             values ($1::bigint, $2::uuid, 'MEMBER', 'ACTIVE', now())`, [id, await uidOf(q, "지은")]);
    const v2 = await ver(q, slug);
    assertNotEquals(v2, v1);                    // 공통 배정·알림 수신자가 바뀐다
    await q("update public.rooms set status = 'RECRUIT' where id = $1::bigint", [id]);
    const v3 = await ver(q, slug);
    assertNotEquals(v3, v2);                    // 상태 — 알림·배정
    await q("update public.rooms set leader_does_tasks = not leader_does_tasks where id = $1::bigint", [id]);
    const v4 = await ver(q, slug);
    assertNotEquals(v4, v3);                    // 공통 배정 대상
    await q("update public.room_members set status = 'INACTIVE' where room_id = $1::bigint and user_id = $2::uuid", [id, await uidOf(q, "지은")]);
    assertNotEquals(await ver(q, slug), v4);    // ACTIVE 에서 빠짐
  } },
  { name: "curriculum_version: 멤버가 나갔다 다시 들어와 assign_from 만 바뀌어도(ACTIVE 집합 동일) 달라진다", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const ji = await uidOf(q, "지은");
    await q(`insert into public.room_members (room_id, user_id, role, status, joined_at, assign_from)
             values ($1::bigint, $2::uuid, 'MEMBER', 'ACTIVE', now(), '2026-11-03')`, [id, ji]);
    const v0 = await ver(q, slug);
    await q("update public.room_members set status = 'INACTIVE' where room_id = $1::bigint and user_id = $2::uuid", [id, ji]);
    await q("update public.room_members set status = 'ACTIVE', assign_from = '2026-11-10' where room_id = $1::bigint and user_id = $2::uuid", [id, ji]);
    assertNotEquals(await ver(q, slug), v0);
  } },
  { name: "curriculum_version: 같은 상태면 같은 값 · 방 없음(null)도 예외 없이 32자", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    assertEquals(await ver(q, slug), await ver(q, slug));
    const v = (await one(q, "select public.curriculum_version(null) as v")).v as string;
    assertMatch(v, /^[0-9a-f]{32}$/);
  } },
]);

const plan = (ops: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ schema: "sgtudy.plan/v1", ops, ...extra });
const validate = async (q: Q, slug: string, p: string) =>
  (await one(q, "select public.plan_validate(r, $2::jsonb) as v from public.rooms r where r.slug = $1", [slug, p])).v as Row;

cases("curriculum plan 0034 · validate", db, [
  { name: "plan_flatten: 전위 순회 경로 · children 제거 · has_children", run: async (q) => {
    const rows = await q("select seq, path, parent_path, has_children, op from public.plan_flatten($1::jsonb) order by seq", [plan([
      { op: "create", title: "R", children: [{ title: "B", children: [{ title: "T" }] }, { title: "T2" }] },
      { op: "update", id: "1", set: { title: "x" } },
    ])]);
    assertEquals(rows.map((r) => r.path), ["ops[0]", "ops[0].children[0]", "ops[0].children[0].children[0]", "ops[0].children[1]", "ops[1]"]);
    assertEquals(rows.map((r) => r.parent_path), [null, "ops[0]", "ops[0].children[0]", "ops[0]", null]);
    assertEquals(rows.map((r) => r.has_children), [true, true, false, false, false]);
    assertEquals("children" in rows[0].op, false);
  } },
  { name: "정상 계획서: 오류 0 · 노드 수 · 방 기간 밖 경고", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const v = await validate(q, slug, plan([
      { op: "create", ref: "w1", title: "1주차", children: [{ title: "읽기", taskType: "common" }] },
      { op: "create", parent: "@w1", title: "발표", taskType: "designated", startDate: "2026-11-05", endDate: "2026-11-30" },
    ]));
    assertEquals(v.errors, []);
    assertEquals(v.nodes, 3);
    assertEquals(v.warnings.map((w: Row) => [w.path, w.code]).sort(), [["ops[1]", "PERIOD_OUTSIDE_PARENT"], ["ops[1]", "PERIOD_OUTSIDE_ROOM"]]);
  } },
  { name: "오류를 모두 모은다(경로·코드)", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const v = await validate(q, slug, plan([
      { op: "create", title: "" },
      { op: "create", parent: "@nope", title: "x" },
      { op: "archive", id: "1" },
      { op: "create", title: "R", taskType: "common", children: [{ title: "c" }] },
      { op: "create", title: "R2", startDate: "2026-11-10", endDate: "2026-11-01" },
      { op: "create", title: "R3", startDate: "11/10" },
      { op: "frobnicate" },
    ]));
    assertEquals(v.errors.map((e: Row) => [e.path, e.code]), [
      ["ops[0]", "INVALID_TITLE"], ["ops[1]", "UNKNOWN_REF"], ["ops[2]", "DESTRUCTIVE_OP_NOT_ALLOWED"],
      ["ops[3]", "PLAN_INVALID"], ["ops[4]", "INVALID_PERIOD"], ["ops[5]", "VALIDATION_FAILED"], ["ops[6]", "UNKNOWN_OP"],
    ]);
  } },
  { name: "깊이 5 초과 · 중복 ref · 다른 방 노드 · 개인 목표 대상", run: async (q) => {
    await as(q, "지은");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const c = (await one(q, "select public.personal_create('aws', $1::bigint, '내 복습') as c", [r2])).c as Row;
    const sqldNode = (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'sqld' limit 1")).id;
    const deep = { title: "d2", children: [{ title: "d3", children: [{ title: "d4", children: [{ title: "d5", children: [{ title: "d6" }] }] }] }] };
    const v = await validate(q, "aws", plan([
      { op: "create", ...deep },
      { op: "create", ref: "a", title: "x" }, { op: "create", ref: "a", title: "y" },
      { op: "update", id: sqldNode, set: { title: "z" } },
      { op: "update", id: c.createdId, set: { title: "z" } },
    ]));
    assertEquals(v.errors.map((e: Row) => [e.path, e.code]), [
      ["ops[0].children[0].children[0].children[0].children[0]", "NODE_DEPTH_EXCEEDED"],
      ["ops[2]", "DUPLICATE_REF"], ["ops[3]", "NODE_NOT_FOUND"], ["ops[4]", "PERSONAL_NODE"],
    ]);
  } },
  { name: "크기 제한: 노드 201개 → PLAN_TOO_LARGE", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const v = await validate(q, slug, plan([{ op: "create", title: "R", children: Array.from({ length: 200 }, (_, i) => ({ title: `t${i}` })) }]));
    assertEquals(v.errors.map((e: Row) => e.code), ["PLAN_TOO_LARGE"]);
  } },
  { name: "무거운 op(update·move·담당 지정 create) 51개 → PLAN_TOO_LARGE", run: async (q) => {
    await as(q, "민수");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    const v = await validate(q, "aws", plan(Array.from({ length: 51 }, () => ({ op: "update", id: alb, set: { title: "x" } }))));
    assertEquals(v.errors.map((e: Row) => e.code), ["PLAN_TOO_LARGE"]);
  } },
  { name: "schema 누락 · ops 비어 있음 → PLAN_INVALID", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    assertEquals((await validate(q, slug, JSON.stringify({ ops: [{ op: "create", title: "x" }] }))).errors[0].code, "PLAN_INVALID");
    assertEquals((await validate(q, slug, plan([]))).errors[0].code, "PLAN_INVALID");
  } },
  { name: "〔C#11〕 plan_shape_check: 256KB 초과 · 중첩 50단 · ops 201개를 해석 전에 거부", run: async (q) => {
    const shape = async (p: string) => (await one(q, "select public.plan_shape_check($1::jsonb) as v", [p])).v as Row | null;
    assertEquals(await shape(plan([{ op: "create", title: "R" }])), null);
    assertEquals((await shape(plan([{ op: "create", title: "R", descriptionMd: "가".repeat(100_000) }])))!.code, "PLAN_TOO_LARGE");   // 300KB
    let deep: Row = { title: "leaf" };
    for (let i = 0; i < 50; i++) deep = { title: `d${i}`, children: [deep] };
    const d = (await shape(plan([{ op: "create", ...deep }])))!;
    assertEquals([d.code, d.field], ["PLAN_INVALID", "children"]);
    assertEquals((await shape(plan(Array.from({ length: 201 }, () => ({ op: "create", title: "x" })))))!.code, "PLAN_TOO_LARGE");
    // plan_flatten 은 6단에서 멈춘다(무한·과대 재귀 없음)
    assert(Number((await one(q, "select count(*)::int as n from public.plan_flatten($1::jsonb)", [plan([{ op: "create", ...deep }])])).n) <= 6);
  } },
  // ── 구현자 추가 ──
  { name: "update·move 규칙: set 키 · update id 에 @ref 불가 · move index 필수 · 보관 노드 · 담당은 지정 과제만 · 무부작용", run: async (q) => {
    await as(q, "민수");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [await nodeId(q, "aws", "VPC 실습")]);
    const vpc = await nodeId(q, "aws", "VPC 실습");
    const before = await count(q, "select 1 from public.goal_nodes");
    const v = await validate(q, "aws", plan([
      { op: "create", ref: "n", parent: r2, title: "새 과제" },
      { op: "update", id: "@n", set: { title: "x" } },
      { op: "update", id: alb, set: { bogus: 1 } },
      { op: "move", id: alb, parent: r2 },
      { op: "update", id: vpc, set: { title: "x" } },
      { op: "update", id: alb, set: { assigneeIds: [await uidOf(q, "지은")] } },
      { op: "update", id: ec2, set: { assigneeIds: [await uidOf(q, "지은")], startDate: "2026-10-20", endDate: "2026-10-09" } },
      { op: "move", id: "@n", parent: null, index: 0 },
      { op: "update", id: ec2, set: { assigneeIds: [await uidOf(q, "지은")] } },
      { op: "create", parent: r2, title: "라벨", label: "x" },
    ]));
    assertEquals(v.errors.map((e: Row) => [e.path, e.code, e.field ?? null]), [
      ["ops[1]", "PLAN_INVALID", "id"], ["ops[2]", "VALIDATION_FAILED", "bogus"], ["ops[3]", "PLAN_INVALID", "index"],
      ["ops[4]", "TASK_ARCHIVED", null], ["ops[5]", "PLAN_INVALID", "assigneeIds"], ["ops[6]", "INVALID_PERIOD", "endDate"],
      ["ops[9]", "VALIDATION_FAILED", "label"],
    ]);
    assertEquals(await count(q, "select 1 from public.goal_nodes"), before);
  } },
  { name: "기본 날짜 시뮬레이션: 생략한 회차는 앞 회차(계획서 포함) 다음 7일 · 하위는 부모 기간", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const v = await validate(q, slug, plan([
      { op: "create", ref: "a", title: "A" },                                   // 11-01 ~ 11-07
      { op: "create", title: "B" },                                             // 11-08 ~ 11-14
      { op: "create", title: "C", children: [{ title: "c", startDate: "2026-11-14" }] },   // 11-15 ~ 11-21, 하위 시작 11-14 → 부모 밖
      { op: "create", title: "D", startDate: "2026-11-25" },                    // 11-25 ~ 12-01 → 방 밖
    ]));
    assertEquals(v.errors, []);
    assertEquals(v.warnings.map((w: Row) => [w.path, w.code]), [["ops[2].children[0]", "PERIOD_OUTSIDE_PARENT"], ["ops[3]", "PERIOD_OUTSIDE_ROOM"]]);
  } },
]);

const resolve = async (q: Q, slug: string, p: string) =>
  (await one(q, "select public.plan_resolve(r, $2::jsonb) as v from public.rooms r where r.slug = $1", [slug, p])).v as Row;
const pick = async (q: Q, slug: string, sel: unknown) =>
  (await one(q, "select public.plan_round_pick(r, $2::jsonb) as v from public.rooms r where r.slug = $1", [slug, JSON.stringify(sel)])).v as Row;

cases("curriculum plan 0034 · resolve", db, [
  { name: "회차 선택자: 서수 · 라벨 · id · current · 없음(후보)", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    assertEquals((await pick(q, "aws", 2)).id, r2);
    assertEquals((await pick(q, "aws", "2주차")).id, r2);
    assertEquals((await pick(q, "aws", r2)).id, r2);
    assertMatch((await pick(q, "aws", "current")).id, /^\d+$/);
    const miss = await pick(q, "aws", "99주차");
    assertEquals(miss.error.code, "ROUND_NOT_FOUND");
    assert(miss.error.candidates.includes("2주차"));
  } },
  { name: "assignees 닉네임 → assigneeIds · 비참가자 ASSIGNEE_NOT_MEMBER", run: async (q) => {
    await as(q, "민수");
    const r = await resolve(q, "aws", plan([
      { op: "create", parent: { round: "2주차" }, title: "발표", taskType: "designated", assignees: ["지은"] },
      { op: "create", parent: { round: 2 }, title: "발표2", taskType: "designated", assignees: ["가은"] },
    ]));
    assertEquals(r.plan.ops[0].assigneeIds, [await uidOf(q, "지은")]);
    assertEquals(r.plan.ops[0].parent, await nodeId(q, "aws", "EC2·S3"));
    assertEquals("assignees" in r.plan.ops[0], false);
    assertEquals(r.errors.map((e: Row) => [e.path, e.code]), [["ops[1]", "ASSIGNEE_NOT_MEMBER"]]);
  } },
  { name: "shift: from~마지막 회차를 update 로 펼친다(days 더함, 하위 있으면 shiftDescendants)", run: async (q) => {
    await as(q, "민수");
    const r = await resolve(q, "aws", plan([{ op: "shift", from: 2, days: 7 }]));
    assertEquals(r.errors, []);
    const rounds = await q("select n.id::text as id, n.start_date::text as s from public.goal_nodes n join public.rooms x on x.id = n.room_id where x.slug = 'aws' and n.parent_id is null and n.archived_at is null order by n.sort_order offset 1");
    assertEquals(r.plan.ops.map((o: Row) => o.id), rounds.map((x) => x.id));
    assertEquals(r.plan.ops[0].op, "update");
    assertEquals(r.map["ops[0]"], "ops[0]#0");
  } },
  { name: "shift 오류: days 0 · from 이 to 뒤 · 같은 회차 update 와 충돌", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const r = await resolve(q, "aws", plan([
      { op: "shift", from: 1, days: 0 },
      { op: "shift", from: 3, to: 2, days: 7 },
      { op: "shift", from: 2, to: 2, days: 7 }, { op: "update", id: r2, set: { title: "x" } },
    ]));
    assertEquals(r.errors.map((e: Row) => [e.path, e.code]), [["ops[0]", "PLAN_INVALID"], ["ops[1]", "PLAN_INVALID"], ["ops[3]", "PLAN_INVALID"]]);
  } },
  // ── 구현자 추가(P11 · D14·D15 세부) ──
  { name: "〔P11〕 ROUND_AMBIGUOUS: 같은 라벨 회차 2개 → 추측하지 않고 후보", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    await q("select public.node_create($1, null, 'A', '특강')", [slug]);
    await q("select public.node_create($1, null, 'B', '특강')", [slug]);
    const amb = await pick(q, slug, " 특강 ");
    assertEquals(amb.id, undefined);
    assertEquals(amb.error.code, "ROUND_AMBIGUOUS");
    assertEquals(amb.error.candidates.length, 2);
    const r = await resolve(q, slug, plan([{ op: "create", parent: { round: "특강" }, title: "x" }]));
    assertEquals(r.errors.map((e: Row) => [e.path, e.code, e.field]), [["ops[0]", "ROUND_AMBIGUOUS", "parent"]]);
    assertEquals((await pick(q, slug, 2)).error, undefined);   // 서수로는 고를 수 있다
  } },
  { name: "〔P11〕 ASSIGNEE_AMBIGUOUS: 같은 닉네임 ACTIVE 멤버 2명 → 후보 수만(uuid 비노출) · userId 는 그대로", run: async (q) => {
    await as(q, "민수");
    const dup = await newUser(q);
    await q("update public.profiles set nickname = '지은' where id = $1::uuid", [dup]);   // nickname_normalized 는 null → 유일 제약 우회(경로 검증용)
    await q(`insert into public.room_members (room_id, user_id, role, status, joined_at)
             values ($1::bigint, $2::uuid, 'MEMBER', 'ACTIVE', now())`, [await roomId(q, "aws"), dup]);
    const alb = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const r = await resolve(q, "aws", plan([
      { op: "update", id: alb, set: { assignees: ["지은"] } },
      { op: "update", id: alb, set: { assignees: [dup.toUpperCase(), "철수"] } },
    ]));
    assertEquals(r.errors.map((e: Row) => [e.path, e.code]), [["ops[0]", "ASSIGNEE_AMBIGUOUS"]]);
    assertEquals(r.errors[0].candidates, ["지은", "지은"]);
    assert(!JSON.stringify(r.errors).includes(dup));
    assertEquals(r.plan.ops[1].set.assigneeIds, [dup, await uidOf(q, "철수")]);
    assertEquals("assignees" in r.plan.ops[1].set, false);
  } },
  { name: "children 안의 assignees 도 해석 · INACTIVE 멤버는 ASSIGNEE_NOT_MEMBER", run: async (q) => {
    await as(q, "민수");
    const r = await resolve(q, "aws", plan([
      { op: "create", title: "R", children: [{ title: "B", children: [{ title: "T", taskType: "designated", assignees: ["하나"] }] },
                                              { title: "T2", taskType: "designated", assignees: ["도윤"] }] },
    ]));
    assertEquals(r.plan.ops[0].children[0].children[0].assigneeIds, [await uidOf(q, "하나")]);
    assertEquals(r.errors.map((e: Row) => [e.path, e.code]), [["ops[0].children[1]", "ASSIGNEE_NOT_MEMBER"]]);
  } },
  { name: "shift 세부: to 생략 = 마지막 · 날짜 = 원래 + days · 하위 있는 회차만 shiftDescendants · 뒤 op 경로 map · 선택자 오류", run: async (q) => {
    await as(q, "민수");
    const r4 = await nodeId(q, "aws", "오토스케일링");
    const r = await resolve(q, "aws", plan([
      { op: "create", title: "새 회차" },
      { op: "shift", from: "4주차", days: -3 },
      { op: "update", id: await nodeId(q, "aws", "IAM·VPC"), set: { title: "IAM" } },
    ]));
    assertEquals(r.errors, []);
    const ops = r.plan.ops;
    assertEquals(ops.length, 4);
    assertEquals(ops[1], { op: "update", id: r4, set: { startDate: "2026-10-19", endDate: "2026-10-25", shiftDescendants: true } });
    assertEquals(ops[2].set.startDate, "2026-10-26");
    assertEquals(r.map, { "ops[1]": "ops[1]#0", "ops[2]": "ops[1]#1", "ops[3]": "ops[2]" });
    const empty = (await one(q, "select public.node_create('aws', null, '빈 회차') as c")).c as Row;
    const e = await resolve(q, "aws", plan([{ op: "shift", from: "current", days: 1 }]));
    const last = e.plan.ops[e.plan.ops.length - 1];
    assertEquals([last.id, "shiftDescendants" in last.set], [empty.nodes.find((n: Row) => n.title === "빈 회차").id, false]);
    const bad = await resolve(q, "aws", plan([{ op: "shift", from: "없는주차", days: 1.5 }, { op: "shift", days: 2 }, { op: "shift", from: 1, days: 181 }]));
    assertEquals(bad.errors.map((x: Row) => [x.path, x.code, x.field]), [
      ["ops[0]", "PLAN_INVALID", "days"], ["ops[1]", "PLAN_INVALID", "from"], ["ops[2]", "PLAN_INVALID", "days"]]);
  } },
  // ── 리뷰 보강 ──
  { name: "SHIFT_CONFLICT: 0 붙인 id 도 같은 회차 · 하위 날짜 update 는 충돌, 하위 move·제목 update 는 허용", run: async (q) => {
    await as(q, "민수");
    const r3 = await nodeId(q, "aws", "고가용성 아키텍처");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");     // 3주차 안(묶음 아래)
    const r = await resolve(q, "aws", plan([
      { op: "update", id: "00" + r3, set: { title: "x" } },
      { op: "shift", from: 3, to: 3, days: 7 },
      { op: "update", id: alb, set: { endDate: "2026-10-25" } },
      { op: "update", id: alb, set: { title: "제목만" } },
      { op: "move", id: alb, parent: await nodeId(q, "aws", "오토스케일링"), index: 0 },
    ]));
    assertEquals(r.errors.map((e: Row) => [e.path, e.code, e.field]), [
      ["ops[0]", "PLAN_INVALID", "SHIFT_CONFLICT"], ["ops[2]", "PLAN_INVALID", "SHIFT_CONFLICT"]]);
    assertEquals(r.plan.ops[0].id, r3);                        // 정규형으로
  } },
  { name: "되돌려 싣는 사용자 문자열은 40자 + … 로 자른다(ref·닉네임·키)", run: async (q) => {
    await as(q, "민수");
    const long = "가".repeat(500);
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const v = await validate(q, "aws", plan([
      { op: "create", parent: "@" + "a".repeat(500), title: "x" },
      { op: "create", title: "x", ["k".repeat(500)]: 1 },
      { op: "update", id: r2, set: { ["s".repeat(500)]: 1 } },
      { op: "x".repeat(500) },
    ]));
    assertEquals(v.errors.length, 4);
    for (const e of v.errors) assert(JSON.stringify(e).length < 300, JSON.stringify(e).slice(0, 80));
    assertEquals(v.errors[1].field, "k".repeat(40) + "…");
    const r = await resolve(q, "aws", plan([{ op: "create", parent: r2, title: "x", taskType: "designated", assignees: [long] }]));
    assert(r.errors[0].message.length < 120);
    assert(!r.errors[0].message.includes(long));
  } },
  { name: "최상위 키는 schema·ops·baseVersion 만 → 그 밖은 PLAN_INVALID(field = 키)", run: async (q) => {
    const shape = async (p: string) => (await one(q, "select public.plan_shape_check($1::jsonb) as v", [p])).v as Row | null;
    assertEquals(await shape(plan([{ op: "create", title: "R" }], { baseVersion: "abc" })), null);
    const e = (await shape(plan([{ op: "create", title: "R" }], { opz: [] })))!;
    assertEquals([e.path, e.code, e.field], ["$", "PLAN_INVALID", "opz"]);
    const { slug } = await mkRoom(q, "민수");
    assertEquals((await validate(q, slug, plan([{ op: "create", title: "R" }], { extra: 1 }))).errors.map((x: Row) => [x.code, x.field]), [["PLAN_INVALID", "extra"]]);
  } },
  { name: "형태 오류는 건드리지 않고 넘긴다 · plan_map_paths 는 앞부분만 원래 경로로", run: async (q) => {
    await as(q, "민수");
    const raw = { schema: "x", ops: "nope" };
    const r = await resolve(q, "aws", JSON.stringify(raw));
    assertEquals([r.plan, r.errors, r.map], [raw, [], {}]);
    const m = (await one(q, "select public.plan_map_paths($1::jsonb, $2::jsonb) as v", [
      JSON.stringify([{ path: "ops[2]", code: "X" }, { path: "ops[3].children[1]", code: "Y" }, { path: "ops[0]", code: "Z" }, { path: "undo" }]),
      JSON.stringify({ "ops[2]": "ops[1]#1", "ops[3]": "ops[2]" }),
    ])).v as Row[];
    assertEquals(m, [
      { path: "ops[1]#1", rpath: "ops[2]", code: "X" }, { path: "ops[2].children[1]", rpath: "ops[3].children[1]", code: "Y" },
      { path: "ops[0]", code: "Z" }, { path: "undo" }]);
  } },
]);

const preview = async (q: Q, slug: string, p: string, undo: string | null = null) =>
  (await one(q, "select public.curriculum_plan_preview($1, $2::jsonb, $3) as r", [slug, p, undo])).r as Row;
const apply = async (q: Q, slug: string, id: string) =>
  (await one(q, "select public.curriculum_plan_apply($1, $2) as r", [slug, id])).r as Row;
const sample = (base?: string) => plan([
  { op: "create", ref: "w1", title: "1주차 기초", children: [
    { title: "읽기 과제", taskType: "common" },
    { title: "실습 묶음", children: [{ title: "실습 1" }, { title: "실습 2" }] },
  ] },
  { op: "create", parent: "@w1", title: "추가 과제", taskType: "common", index: 0 },
], base ? { baseVersion: base } : {});

cases("curriculum plan 0034 · run", db, [
  { name: "미리보기: 노드는 그대로 · 초안 1행 · previewId·요약·diff", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const before = await count(q, "select 1 from public.goal_nodes where room_id = $1::bigint", [id]);
    const r = await preview(q, slug, sample());
    assertEquals(r.ok, true);
    assertMatch(r.previewId, /^pv_[0-9a-f]{12}$/);
    assertEquals(r.summary.created, 6);
    assertEquals(r.diff.filter((d: Row) => d.op === "create").every((d: Row) => d.id === null), true);
    assertEquals(r.diff.find((d: Row) => d.title === "실습 묶음").kind, "bundle");
    assertEquals(r.diff.find((d: Row) => d.title === "실습 1").parentPath, "ops[0].children[1]");
    assertEquals(await count(q, "select 1 from public.goal_nodes where room_id = $1::bigint", [id]), before);
    assertEquals(await count(q, "select 1 from public.api_plan_drafts where id = $1", [r.previewId]), 1);
  } },
  { name: "적용: previewId 만으로 원자 생성(depth·유형·refs) · 재적용은 replayed(노드 그대로)", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const pre = await preview(q, slug, sample());
    const a = await apply(q, slug, pre.previewId);
    assertEquals([a.ok, a.applied], [true, true]);
    const rows = await q("select title, depth, task_type, parent_id::text as pid, sort_order from public.goal_nodes where room_id = $1::bigint order by id", [id]);
    assertEquals(rows.map((x) => [x.title, x.depth, x.task_type]), [
      ["1주차 기초", 2, null], ["읽기 과제", 3, "COMMON"], ["실습 묶음", 3, null], ["실습 1", 4, "COMMON"], ["실습 2", 4, "COMMON"], ["추가 과제", 3, "COMMON"],
    ]);
    assertEquals(rows.find((x) => x.title === "추가 과제")!.pid, a.refs.w1);
    assertEquals(rows.find((x) => x.title === "추가 과제")!.sort_order, 0);
    assertNotEquals(a.version, pre.version);
    const b = await apply(q, slug, pre.previewId);
    assertEquals([b.replayed, b.refs], [true, a.refs]);
    assertEquals(await count(q, "select 1 from public.goal_nodes where room_id = $1::bigint", [id]), 6);
  } },
  { name: "없는 previewId → PREVIEW_NOT_FOUND · 만료 → PREVIEW_EXPIRED", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    await expectFail(q("select public.curriculum_plan_apply($1, 'pv_000000000000')", [slug]), "PREVIEW_NOT_FOUND");
    const pre = await preview(q, slug, sample());
    await q("select set_config('app.now', (now() + interval '25 hours')::text, true)");
    await expectFail(q("select public.curriculum_plan_apply($1, $2)", [slug, pre.previewId]), "PREVIEW_EXPIRED");
  } },
  { name: "〔C#13〕 남의 previewId: 같은 방의 다른 편집자(지은)가 민수의 초안을 적용·undo → PREVIEW_NOT_FOUND, 노드 그대로", run: async (q) => {
    const aws = await roomId(q, "aws");
    await q("update public.room_members set can_edit_curriculum = true where room_id = $1::bigint and user_id = $2::uuid", [aws, await uidOf(q, "지은")]);
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const pre = await preview(q, "aws", plan([{ op: "create", parent: r2, title: "민수 초안", taskType: "common" }]));
    await as(q, "지은");   // 권한 검사(node_assert_editable)는 통과하는 사람 — 초안 소유 검사만 남는다
    await expectFail(q("select public.curriculum_plan_apply('aws', $1)", [pre.previewId]), "PREVIEW_NOT_FOUND");
    assertEquals(await count(q, "select 1 from public.goal_nodes where title = '민수 초안'"), 0);
    await as(q, "민수");
    await apply(q, "aws", pre.previewId);
    await as(q, "지은");
    await expectFail(q("select public.curriculum_plan_preview('aws', '{}'::jsonb, $1)", [pre.previewId]), "PREVIEW_NOT_FOUND");
  } },
  { name: "미리본 뒤 다른 변경 → 적용 STALE_VERSION · baseVersion 불일치 → 미리보기 STALE_VERSION", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const pre = await preview(q, "aws", plan([{ op: "create", parent: r2, title: "새 과제", taskType: "common" }]));
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    await q("select public.node_update('aws', $1::bigint, '{\"title\":\"ALB vs NLB 비교\"}')", [alb]);
    await expectFail(q("select public.curriculum_plan_apply('aws', $1)", [pre.previewId]), "STALE_VERSION");
    await expectFail(q("select public.curriculum_plan_preview('aws', $1::jsonb)", [sample("0".repeat(32))]), "STALE_VERSION");
  } },
  { name: "〔C#3〕 빈 방에서 날짜 생략 회차를 미리본 뒤 방 시작일이 바뀌면 → 적용 STALE_VERSION(다른 날짜로 적용되지 않음)", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const pre = await preview(q, slug, plan([{ op: "create", title: "1회차" }]));
    assertEquals(pre.diff[0].startDate, "2026-11-01");
    await q("update public.rooms set start_date = '2026-11-08', end_date = '2026-12-05' where id = $1::bigint", [id]);
    await expectFail(q("select public.curriculum_plan_apply($1, $2)", [slug, pre.previewId]), "STALE_VERSION");
    assertEquals(await count(q, "select 1 from public.goal_nodes where room_id = $1::bigint", [id]), 0);
  } },
  { name: "〔C#13〕 적용 중간 실패 → 전체 롤백: 미리본 뒤 생긴 제출로 2번째 op 가 NODE_HAS_SUBMISSIONS — 1번째 op 의 노드도 없고 초안은 미적용", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const leaf = ((await one(q, "select public.node_create('aws', $1::bigint, '제출될 과제', null, 'common') as c", [r2])).c as Row)
      .nodes.find((n: Row) => n.title === "제출될 과제").id as string;
    const pre = await preview(q, "aws", plan([{ op: "create", parent: r2, title: "먼저 생길 과제", taskType: "common" },
                                            { op: "create", parent: leaf, title: "하위" }]));   // 미리보기 땐 제출 없음 → 리프 → 묶음 전환 OK
    assertEquals(pre.ok, true);
    await submit(q, leaf, "지은");      // 제출은 curriculum_version 에 들어가지 않는다 → STALE 아님, 실행 중 실패
    await expectFail(q("select public.curriculum_plan_apply('aws', $1)", [pre.previewId]), "NODE_HAS_SUBMISSIONS");
    assertEquals(await count(q, "select 1 from public.goal_nodes where title in ('먼저 생길 과제', '하위')"), 0);
    assertEquals((await one(q, "select applied_at from public.api_plan_drafts where id = $1", [pre.previewId])).applied_at, null);
  } },
  { name: "〔C#13〕 잠금 순서(정적): apply 는 방 잠금(node_assert_editable) 뒤 초안 for update · preview 도 방 잠금이 먼저", run: async (q) => {
    // PGlite 단일 연결 — 동시 적용은 api-invoke-db.test.ts(실 PostgREST)에서. 여기선 순서만 고정
    const src = async (fn: string) => (await one(q, "select prosrc from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1", [fn])).prosrc as string;
    const a = await src("curriculum_plan_apply");
    assert(a.indexOf("node_assert_editable") >= 0 && a.indexOf("node_assert_editable") < a.indexOf("for update"));
    const p = await src("curriculum_plan_preview");
    assert(p.indexOf("node_assert_editable") >= 0 && p.indexOf("node_assert_editable") < p.indexOf("insert into public.api_plan_drafts"));   // P2: 실제 쓰기 문장
    assertEquals(p.split("offset 50").length - 1, 2);   // P13: 일반·undo 두 분기 모두 오래된 초안 정리
  } },
  { name: "〔C#9〕 실행 경고에도 한국어 message · 적용 응답에 undoable", run: async (q) => {
    await as(q, "민수");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    const d = await preview(q, "aws", plan([{ op: "update", id: alb, set: { endDate: "2027-03-01" } }]));   // 방 종료 2026-12-31 밖
    const w = d.warnings.find((x: Row) => x.code === "PERIOD_OUTSIDE_ROOM");
    assertEquals([w.path, w.message], ["ops[0]", "스터디 기간 밖이에요"]);
    assert(d.warnings.every((x: Row) => typeof x.message === "string" && x.message.length > 0));
    const a = await apply(q, "aws", d.previewId);
    assertEquals(a.undoable, d.undoable);
    assertEquals(a.undoable.ops, 1);
  } },
  { name: "실행 중 오류(비참가자 담당) — 미리보기는 경로와 코드, 초안 없음", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const outsider = await uidOf(q, "가은");
    const n0 = await count(q, "select 1 from public.api_plan_drafts");
    const d = await preview(q, "aws", plan([{ op: "create", parent: r2, title: "정상", taskType: "common" },
                                          { op: "create", parent: r2, title: "지정", taskType: "designated", assigneeIds: [outsider] }]));
    assertEquals([d.ok, d.errors[0].path, d.errors[0].code], [false, "ops[1]", "ASSIGNEE_NOT_MEMBER"]);
    assertEquals(await count(q, "select 1 from public.api_plan_drafts"), n0);
  } },
  { name: "권한은 기존 규칙: 비편집자·공개 방 외부인 NOT_CURRICULUM_EDITOR · DRAFT 방 외부인 ROOM_NOT_FOUND", run: async (q) => {
    await as(q, "지은");
    await expectFail(q("select public.curriculum_plan_preview('aws', $1::jsonb)", [sample()]), "NOT_CURRICULUM_EDITOR");
    await as(q, "가은");   // aws 는 PUBLIC·ACTIVE → room_readable 참 → ROOM_NOT_FOUND 가 아니다
    await expectFail(q("select public.curriculum_plan_preview('aws', $1::jsonb)", [sample()]), "NOT_CURRICULUM_EDITOR");
    const { slug } = await mkRoom(q, "민수");   // DRAFT
    await as(q, "가은");
    await expectFail(q("select public.curriculum_plan_preview($1, $2::jsonb)", [slug, sample()]), "ROOM_NOT_FOUND");
  } },
  { name: "shift · move — diff.changes(원래 경로 ops[0]#0)와 summary.shiftedDescendants", run: async (q) => {
    await as(q, "민수");
    const grp = await nodeId(q, "aws", "로드밸런서 비교");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const d = await preview(q, "aws", plan([{ op: "shift", from: "3주차", to: "3주차", days: 7 },
                                          { op: "move", id: grp, parent: r2, index: 0 }]));
    assertEquals(d.diff[0].changes.startDate, ["2026-10-15", "2026-10-22"]);
    assertEquals(d.diff[0].path, "ops[0]#0");
    assert(d.summary.shiftedDescendants >= 1);
    assertEquals(d.summary.moved, 1);
  } },
  { name: "되돌리기: shift 적용 → undo 미리보기는 기록된 노드의 옛 날짜(하위 포함) · 적용하면 원래 날짜 · 생성만 있던 계획은 NOTHING_TO_UNDO", run: async (q) => {
    await as(q, "민수");
    const grp = await nodeId(q, "aws", "로드밸런서 비교");   // 3주차 아래 묶음
    const before = await one(q, "select start_date::text as s from public.goal_nodes where id = $1::bigint", [grp]);
    const p = await preview(q, "aws", plan([{ op: "shift", from: "3주차", to: "3주차", days: 7 }]));
    await apply(q, "aws", p.previewId);
    const u = await preview(q, "aws", "{}", p.previewId);   // undo 가 있으면 plan 은 무시
    assert(u.diff.every((d: Row) => d.op === "restore"));
    assertEquals(u.diff.find((d: Row) => d.kind === "round").changes.startDate, ["2026-10-22", "2026-10-15"]);
    assertEquals(u.undoable.ops, p.undoable.ops);           // 기록된 노드 수 그대로
    await apply(q, "aws", u.previewId);
    assertEquals((await one(q, "select start_date::text as s from public.goal_nodes where id = $1::bigint", [grp])).s, before.s);
    const { slug } = await mkRoom(q, "민수");
    const c = await preview(q, slug, sample());
    await apply(q, slug, c.previewId);
    await expectFail(q("select public.curriculum_plan_preview($1, '{}'::jsonb, $2)", [slug, c.previewId]), "NOTHING_TO_UNDO");
  } },
  { name: "〔C#4〕 undo 는 일정만: shift + move + 제목 변경 + create 계획 → undo 는 restore 만, 나머지는 notUndoable", run: async (q) => {
    await as(q, "민수");
    const grp = await nodeId(q, "aws", "로드밸런서 비교");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    const p = await preview(q, "aws", plan([{ op: "shift", from: "4주차", to: "4주차", days: 7 },
                                          { op: "move", id: grp, parent: r2, index: 0 },
                                          { op: "update", id: alb, set: { title: "ALB 실습" } },
                                          { op: "create", parent: r2, title: "새 과제", taskType: "common" }]));
    assert(p.undoable.ops >= 1);
    assertEquals(p.undoable.notUndoable, { created: 1, moved: 1, otherChanges: 1 });
    await apply(q, "aws", p.previewId);
    const u = await preview(q, "aws", "{}", p.previewId);
    assert(u.diff.length >= 1 && u.diff.every((d: Row) => d.op === "restore"));
    assertEquals([u.summary.created, u.summary.moved, u.summary.updated], [0, 0, 0]);
  } },
  { name: "〔N2〕 shift 뒤 자식을 다른 회차로 move(같은 계획) → undo 는 옮겨 간 자식의 날짜도 복원(자리는 그대로)", run: async (q) => {
    await as(q, "민수");
    const grp = await nodeId(q, "aws", "로드밸런서 비교");   // 3주차 자식
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const b = await one(q, "select start_date::text as s, end_date::text as e from public.goal_nodes where id = $1::bigint", [grp]);
    const p = await preview(q, "aws", plan([{ op: "shift", from: "3주차", to: "3주차", days: 7 }, { op: "move", id: grp, parent: r2, index: 0 }]));
    await apply(q, "aws", p.previewId);
    const u = await preview(q, "aws", "{}", p.previewId);
    await apply(q, "aws", u.previewId);
    const a = await one(q, "select start_date::text as s, end_date::text as e, parent_id::text as pid from public.goal_nodes where id = $1::bigint", [grp]);
    assertEquals([a.s, a.e, a.pid], [b.s, b.e, r2]);        // 날짜만 복원, 이동은 그대로(notUndoable)
  } },
  { name: "〔N2〕 shift 뒤 그 회차 아래 create(같은 계획) → 새 노드는 기록되지 않고 undo 가 건드리지 않는다", run: async (q) => {
    await as(q, "민수");
    const r3 = await nodeId(q, "aws", "로드밸런서 비교").then(async (g) =>
      (await one(q, "select parent_id::text as p from public.goal_nodes where id = $1::bigint", [g])).p as string);   // 3주차
    const p = await preview(q, "aws", plan([{ op: "shift", from: "3주차", to: "3주차", days: 7 },
                                          { op: "create", parent: r3, title: "밀린 뒤 새 과제", taskType: "common", startDate: "2026-10-23", endDate: "2026-10-24" }]));
    const a = await apply(q, "aws", p.previewId);
    const created = a.createdIds[0] as string;
    const u = await preview(q, "aws", "{}", p.previewId);
    assertEquals(u.diff.some((d: Row) => d.id === created), false);
    await apply(q, "aws", u.previewId);
    assertEquals((await one(q, "select start_date::text as s from public.goal_nodes where id = $1::bigint", [created])).s, "2026-10-23");
  } },
  { name: "〔C#4·N1〕 낡은 undo 거부: 적용 뒤 기록된 하위 일정이 바뀌면 미리보기 UNDO_STALE · 이미 되돌린 것도 UNDO_STALE", run: async (q) => {
    await as(q, "민수");
    const p = await preview(q, "aws", plan([{ op: "shift", from: "3주차", to: "3주차", days: 7 }]));
    await apply(q, "aws", p.previewId);
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");   // 3주차 하위(기록됨)
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-30\"}')", [alb]);
    await expectFail(q("select public.curriculum_plan_preview('aws', '{}'::jsonb, $1)", [p.previewId]), "UNDO_STALE");
    const p2 = await preview(q, "aws", plan([{ op: "shift", from: "5주차", to: "5주차", days: 3 }]));
    await apply(q, "aws", p2.previewId);
    const u2 = await preview(q, "aws", "{}", p2.previewId);
    await apply(q, "aws", u2.previewId);
    await expectFail(q("select public.curriculum_plan_preview('aws', '{}'::jsonb, $1)", [p2.previewId]), "UNDO_STALE");
  } },
  { name: "〔N1〕 undo 미리보기 뒤 개인 목표 변경 → undo 적용 UNDO_STALE(버전 검사로는 못 잡는 경우) · 새 개인 목표 추가는 막지 않고 건드리지도 않음", run: async (q) => {
    const grp = await nodeId(q, "aws", "로드밸런서 비교");
    const r3 = (await one(q, "select parent_id::text as p from public.goal_nodes where id = $1::bigint", [grp])).p as string;
    await as(q, "지은");
    const goal = ((await one(q, "select public.personal_create('aws', $1::bigint, '지은 3주차 복습') as c", [r3])).c as Row).createdId as string;
    await as(q, "민수");
    const p = await preview(q, "aws", plan([{ op: "shift", from: "3주차", to: "3주차", days: 7 }]));   // 개인 목표도 함께 밀림 → 기록
    await apply(q, "aws", p.previewId);
    const u = await preview(q, "aws", "{}", p.previewId);
    assert(u.diff.some((d: Row) => d.id === goal));
    const v = (await one(q, "select public.curriculum_version(id) as v from public.rooms where slug = 'aws'")).v;
    await as(q, "지은");
    await q("select public.personal_update('aws', $1::bigint, '{\"endDate\":\"2026-10-29\"}')", [goal]);
    assertEquals((await one(q, "select public.curriculum_version(id) as v from public.rooms where slug = 'aws'")).v, v);   // 버전은 그대로
    await as(q, "민수");
    await expectFail(q("select public.curriculum_plan_apply('aws', $1)", [u.previewId]), "UNDO_STALE");
    // 되돌린 날짜를 원래대로 두고 새 개인 목표만 추가한 경우는 통과하고, 새 목표는 그대로
    await as(q, "지은");
    await q("select public.personal_update('aws', $1::bigint, $2::jsonb)", [goal, JSON.stringify({ endDate: u.diff.find((d: Row) => d.id === goal).changes.endDate[0] })]);
    const extra = ((await one(q, "select public.personal_create('aws', $1::bigint, '나중 목표', '2026-10-25', '2026-10-26') as c", [r3])).c as Row).createdId as string;
    await as(q, "민수");
    await apply(q, "aws", u.previewId);
    assertEquals((await one(q, "select start_date::text as s from public.goal_nodes where id = $1::bigint", [extra])).s, "2026-10-25");
  } },
  { name: "〔P11〕 미리보기 무부작용: goal_nodes·task_assignments·notifications 행 수 그대로, 초안만 1행", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const tables = ["goal_nodes", "task_assignments", "notifications", "api_plan_drafts"];
    const snap = () => Promise.all(tables.map((t) => count(q, `select 1 from public.${t}`)));
    const b = await snap();
    const d = await preview(q, "aws", plan([
      { op: "shift", from: "3주차", to: "4주차", days: 7 },                                     // ACTIVE 방: 적용이면 알림이 나간다
      { op: "create", parent: r2, title: "지정 발표", taskType: "designated", assignees: ["지은"] },
      { op: "create", parent: r2, title: "공통 과제", taskType: "common" },
    ]));
    assertEquals(d.ok, true);
    const a = await snap();
    assertEquals(a.slice(0, 3), b.slice(0, 3));
    assertEquals(a[3], b[3] + 1);
  } },
  { name: "〔P4〕 미리보기 diff 의 담당은 닉네임(uuid 없음) — create 는 assignees, update 는 changes.assignees [옛, 새]", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");   // 시드 담당 = 하나
    const d = await preview(q, "aws", plan([
      { op: "create", parent: r2, title: "지정 발표", taskType: "designated", assignees: ["지은"] },
      { op: "update", id: s3, set: { assignees: ["철수", "하나"] } },
    ]));
    assertEquals(d.ok, true);
    assertEquals(d.diff[0].assignees, ["지은"]);
    const ch = d.diff[1].changes.assignees as string[][];
    assertEquals([ch[0], [...ch[1]].sort()], [["하나"], ["철수", "하나"].sort()]);
    assertEquals(d.undoable.notUndoable.otherChanges, 1);
    assertEquals(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(JSON.stringify(d)), false);
  } },
  { name: "실행 오류에 사용자 id 를 싣지 않는다(비참가자 담당 — hint 의 userId 제거)", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const outsider = await uidOf(q, "가은");
    const d = await preview(q, "aws", plan([{ op: "create", parent: r2, title: "지정", taskType: "designated", assigneeIds: [outsider] }]));
    assertEquals(d.errors[0].code, "ASSIGNEE_NOT_MEMBER");
    assertEquals(JSON.stringify(d).includes(outsider), false);
  } },
  { name: "shift 결과가 스터디 기간 밖 → 미리보기 경고(원래 경로 ops[0]#n · 한국어 message)", run: async (q) => {
    await as(q, "민수");
    const d = await preview(q, "aws", plan([{ op: "shift", from: "5주차", days: 60 }]));   // 5주차 끝 11-04 + 60 > 12-31
    assertEquals(d.ok, true);
    const w = d.warnings.filter((x: Row) => x.code === "PERIOD_OUTSIDE_ROOM");
    assert(w.length >= 1);
    assert(w.every((x: Row) => /^ops\[0\]#0$/.test(x.path) && x.message === "스터디 기간 밖이에요" && x.rpath === "ops[0]"));
  } },
  { name: "move 의 id 가 @ref(같은 계획의 create) — 적용하면 새 노드가 옮겨지고 미리보기 diff id 는 null", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const r3 = (await one(q, "select parent_id::text as p from public.goal_nodes where id = $1::bigint", [await nodeId(q, "aws", "로드밸런서 비교")])).p as string;
    const d = await preview(q, "aws", plan([{ op: "create", ref: "x", parent: r2, title: "옮길 과제", taskType: "common" },
                                          { op: "move", id: "@x", parent: r3, index: 0 }]));
    assertEquals(d.ok, true);
    assertEquals([d.diff[1].op, d.diff[1].id], ["move", null]);
    const a = await apply(q, "aws", d.previewId);
    const n = await one(q, "select parent_id::text as p, sort_order from public.goal_nodes where id = $1::bigint", [a.refs.x]);
    assertEquals([n.p, n.sort_order], [r3, 0]);
  } },
  { name: "〔P13〕 createdIds 는 생성 순서", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const ops = Array.from({ length: 12 }, (_, i) => ({ op: "create", title: `회차 ${i + 1}` }));
    const a = await apply(q, slug, (await preview(q, slug, plan(ops))).previewId);
    const titles = await Promise.all((a.createdIds as string[]).map(async (id) =>
      (await one(q, "select title from public.goal_nodes where id = $1::bigint", [id])).title));
    assertEquals(titles, ops.map((o) => o.title));
  } },
  { name: "되돌리기 알림: ACTIVE 방 undo 적용 → 복원된 과제 담당자에게 CURRICULUM_BULK_UPDATED 1건(행위자 제외) · 미리보기는 알림 없음", run: async (q) => {
    await as(q, "민수");
    const p = await preview(q, "aws", plan([{ op: "shift", from: "3주차", to: "4주차", days: 7 }]));
    await apply(q, "aws", p.previewId);
    const bulk = async (nick: string) => q(`select title, body, link from public.notifications where user_id = $1::uuid and kind = 'CURRICULUM_BULK_UPDATED'`, [await uidOf(q, nick)]);
    const before = (await bulk("지은")).length;                 // Task 5: 원 적용도 묶음 1건을 남긴다
    const u = await preview(q, "aws", "{}", p.previewId);
    assertEquals((await bulk("지은")).length, before);
    assertEquals(u.notifications.perRecipient.find((x: Row) => x.nickname === "지은").count >= 2, true);
    await apply(q, "aws", u.previewId);
    const got = (await bulk("지은")).slice(before);
    assertEquals(got.length, 1);
    assertMatch(got[0].body, /^일정 [0-9]+건$/);
    assertEquals(got[0].link, "/my-study/aws?tab=curriculum");
    assertEquals((await bulk("민수")).length, 0);
  } },
  { name: "CURRICULUM_BULK_UPDATED 종류·렌더·링크 등록(MEMBER_JOINED 유지)", run: async (q) => {
    const k = (await one(q, "select public.notification_kinds() as k")).k as string[];
    // 0037 이 EXAM_PUBLISHED, 0040 이 NOTICE_POSTED, 0041 이 MENTIONED 를 끝에 더했다 — CURRICULUM_BULK_UPDATED 는 그 바로 앞
    assertEquals([k.includes("CURRICULUM_BULK_UPDATED"), k.includes("MEMBER_JOINED"), k.slice(-4)], [true, true, ["CURRICULUM_BULK_UPDATED", "EXAM_PUBLISHED", "NOTICE_POSTED", "MENTIONED"]]);
    const aws = await roomId(q, "aws");
    const t = (await one(q, "select public.notify_render('CURRICULUM_BULK_UPDATED', $1::bigint, null, null, '{\"newTasks\":2,\"schedule\":3,\"assign\":0}') as t", [aws])).t as Row;
    assertEquals([t.title, t.body], ["AWS SAA 자격증 3개월 완주 진행목표가 한꺼번에 바뀌었어요", "새 과제 2건 · 일정 3건"]);
    const j = (await one(q, "select public.notify_render('MEMBER_JOINED', $1::bigint, null, $2::uuid, '{\"via\":\"invite\"}') as t", [aws, await uidOf(q, "지은")])).t as Row;
    assertEquals(j.title, "지은님이 AWS SAA 자격증 3개월 완주에 합류했어요");
    assertEquals((await one(q, "select public.notify_link('CURRICULUM_BULK_UPDATED', $1::bigint, null, $2::uuid) as l", [aws, await uidOf(q, "지은")])).l,
                 "/my-study/aws?tab=curriculum");
  } },
  { name: "적용된 초안은 정리(50개 초과 삭제)에서 제외 — 바깥 DELETE 에도 applied_at is null(다른 탭 동시 적용 대비)", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const uid = await uidOf(q, "민수");
    await asUser(q, uid);
    const old = await preview(q, slug, plan([{ op: "create", title: "가장 오래된 적용" }]));
    await q("update public.api_plan_drafts set created_at = now() - interval '2 days' where id = $1", [old.previewId]);
    await apply(q, slug, old.previewId);
    await q(`insert into public.api_plan_drafts (id, user_id, room_id, plan, resolved, version, preview, created_at, expires_at)
             select 'pv_t' || lpad(g::text, 8, '0'), $1::uuid, $2::bigint, '{}', '{}', repeat('0', 32), '{}', now() - interval '1 day' + g * interval '1 second', now()
             from generate_series(1, 55) g`, [uid, id]);
    await preview(q, slug, plan([{ op: "create", title: "정리 유발" }]));
    assertEquals(await count(q, "select 1 from public.api_plan_drafts where user_id = $1::uuid and applied_at is null", [uid]), 50);
    const b = await apply(q, slug, old.previewId);
    assertEquals(b.replayed, true);                         // 적용 기록은 남아 replay·undo 가 된다
    const src = (await one(q, "select prosrc from pg_proc where proname = 'curriculum_plan_preview'")).prosrc as string;
    assertEquals(src.split("offset 50) and x.applied_at is null").length - 1, 2);   // 두 분기 모두 바깥 조건
  } },
  { name: "GRANT: preview·apply 는 authenticated 만, plan_* 내부는 아무도", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    for (const fn of ["public.curriculum_plan_preview(text, jsonb, text)", "public.curriculum_plan_apply(text, text)"]) {
      assertEquals([await can("anon", fn), await can("authenticated", fn)], [false, true], fn);
    }
    for (const fn of ["public.plan_validate(public.rooms, jsonb)", "public.plan_flatten(jsonb)", "public.curriculum_version(bigint)",
                      "public.plan_resolve(public.rooms, jsonb)", "public.plan_run(public.rooms, uuid, jsonb, boolean, jsonb)",
                      "public.plan_shape_check(jsonb)", "public.plan_warn_text(text)", "public.plan_undo_check(jsonb)",
                      "public.plan_undo_run(public.rooms, uuid, jsonb, boolean)", "public.plan_nicks(bigint)",
                      "public.plan_collapse_notifications(bigint, uuid, bigint, bigint[])",
                      "public.node_create_core(public.rooms, uuid, bigint, text, text, text, date, date, integer, text)"]) {
      assertEquals([await can("anon", fn), await can("authenticated", fn)], [false, false], fn);
    }
  } },
]);

const notes = (q: Q, nick: string, kinds: string[]) => uidOf(q, nick).then((u) =>
  q(`select kind, title, body, link from public.notifications where user_id = $1::uuid and kind = any($2::text[]) and created_at >= now() order by id`,
    [u, `{${kinds.join(",")}}`]));
const K = ["TASK_ASSIGNED", "SCHEDULE_CHANGED", "ROUND_SCHEDULE_CHANGED", "TASK_UNASSIGNED", "CURRICULUM_BULK_UPDATED"];

// 종류·렌더·링크 등록 사례는 Task 4(P1)가 "run" 그룹에 이미 둔다.
cases("curriculum plan 0034 · notify", db, [
  { name: "지은에게 지정 과제 2개 → 묶음 알림 1건(일정 0·담당 2) · 원래 TASK_ASSIGNED 는 없음", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const jieun = await uidOf(q, "지은");
    const p = plan([{ op: "create", parent: r2, title: "발표 A", taskType: "designated", startDate: "2026-10-12", endDate: "2026-10-14", assigneeIds: [jieun] },
                    { op: "create", parent: r2, title: "발표 B", taskType: "designated", startDate: "2026-10-12", endDate: "2026-10-14", assigneeIds: [jieun] }]);
    const d = await preview(q, "aws", p);
    assertEquals(d.notifications.perRecipient.map((x: Row) => [x.nickname, x.count, x.newTasks, x.collapsed]), [["지은", 2, 0, true]]);
    assertEquals(await notes(q, "지은", K), []);                      // dry-run 은 남기지 않는다
    const a = await apply(q, "aws", d.previewId);
    assertEquals(a.notifications.perRecipient.map((x: Row) => [x.nickname, x.count, x.newTasks, x.collapsed]), [["지은", 2, 0, true]]);
    const got = await notes(q, "지은", K);
    assertEquals(got.map((n) => n.kind), ["CURRICULUM_BULK_UPDATED"]);
    assertEquals(got[0].body, "담당 2건");
    assertEquals(got[0].link, "/my-study/aws?tab=curriculum");
  } },
  { name: "1건뿐이면 원래 알림 그대로(TASK_ASSIGNED)", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const jieun = await uidOf(q, "지은");
    const p = plan([{ op: "create", parent: r2, title: "발표 C", taskType: "designated", assigneeIds: [jieun] }]);
    const d = await preview(q, "aws", p);
    assertEquals(d.notifications.perRecipient.map((x: Row) => [x.nickname, x.count, x.collapsed]), [["지은", 1, false]]);
    await apply(q, "aws", d.previewId);
    assertEquals((await notes(q, "지은", K)).map((n) => n.kind), ["TASK_ASSIGNED"]);
  } },
  { name: "이 계획 밖의 알림(먼저 있던 SCHEDULE_CHANGED)은 건드리지 않는다", run: async (q) => {
    await as(q, "민수");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-20\"}')", [alb]);
    const pre = (await notes(q, "지은", ["SCHEDULE_CHANGED"])).length;
    assert(pre >= 1);
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const jieun = await uidOf(q, "지은");
    const p = plan([{ op: "create", parent: r2, title: "발표 D", taskType: "designated", assigneeIds: [jieun] },
                    { op: "create", parent: r2, title: "발표 E", taskType: "designated", assigneeIds: [jieun] }]);
    const d = await preview(q, "aws", p);
    await apply(q, "aws", d.previewId);
    assertEquals((await notes(q, "지은", ["SCHEDULE_CHANGED"])).length, pre);
  } },
  { name: "〔D18〕 ACTIVE 방에 공통 과제 2개 → 과제 하는 팀원마다 묶음 1건 '새 과제 2건' · 행위자 본인은 없음", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const p = plan([{ op: "create", parent: r2, title: "공통 C", taskType: "common" }, { op: "create", parent: r2, title: "공통 D", taskType: "common" }]);
    const d = await preview(q, "aws", p);
    assert(d.notifications.perRecipient.length >= 1);
    assert(d.notifications.perRecipient.every((x: Row) => x.newTasks === 2 && x.collapsed));
    assert(!d.notifications.perRecipient.some((x: Row) => x.nickname === "민수"));
    await apply(q, "aws", d.previewId);
    const got = await notes(q, "지은", K);
    assertEquals([got.map((n) => n.kind), got[0].body], [["CURRICULUM_BULK_UPDATED"], "새 과제 2건"]);
    assertEquals((await notes(q, "민수", K)).length, 0);
  } },
  { name: "〔D18〕 공통 과제 1개만이어도 묶음 1건 '새 과제 1건'(원래 알림이 없으므로)", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const d = await preview(q, "aws", plan([{ op: "create", parent: r2, title: "공통 E", taskType: "common" }]));
    await apply(q, "aws", d.previewId);
    assertEquals((await notes(q, "지은", K)).map((n) => n.body), ["새 과제 1건"]);
  } },
  { name: "일정 + 지정 + 공통 섞여도 수신자당 정확히 1건(본문 '새 과제 · 일정 · 담당')", run: async (q) => {
    await as(q, "민수");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const jieun = await uidOf(q, "지은");
    const d = await preview(q, "aws", plan([
      { op: "shift", from: "3주차", to: "4주차", days: 7 },
      { op: "create", parent: r2, title: "지정 F", taskType: "designated", assigneeIds: [jieun] },
      { op: "create", parent: r2, title: "공통 F", taskType: "common" },
    ]));
    assertEquals(d.ok, true);
    await apply(q, "aws", d.previewId);
    const uids = (await q(`select distinct m.user_id::text as u from public.room_members m join public.rooms r on r.id = m.room_id
                           where r.slug = 'aws' and m.status = 'ACTIVE'`)).map((x) => x.u as string);
    for (const u of uids) {
      const n = await count(q, `select 1 from public.notifications where user_id = $1::uuid and kind = any($2::text[]) and created_at >= now()`, [u, `{${K.join(",")}}`]);
      assert(n <= 1, `수신자 ${u}: ${n}건`);
    }
    const got = await notes(q, "지은", K);
    assertEquals(got.map((n) => n.kind), ["CURRICULUM_BULK_UPDATED"]);
    assertMatch(got[0].body, /^새 과제 1건 · 일정 [0-9]+건 · 담당 1건$/);
  } },
  { name: "〔P5〕 진행중이 아닌 방(RECRUIT)은 공통 과제 알림 없음 — newTasks 0", run: async (q) => {
    await as(q, "민수");
    await q("update public.rooms set status = 'RECRUIT' where slug = 'aws'");
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const d = await preview(q, "aws", plan([{ op: "create", parent: r2, title: "공통 G", taskType: "common" }, { op: "create", parent: r2, title: "공통 H", taskType: "common" }]));
    assertEquals(d.ok, true);
    assert(d.notifications.perRecipient.every((x: Row) => x.newTasks === 0));
    await apply(q, "aws", d.previewId);
    assertEquals(await notes(q, "지은", ["CURRICULUM_BULK_UPDATED"]), []);
  } },
  { name: "알림 설정(담당 알림 끔)을 따른다 — 원래 알림이 없으면 묶음도 없다", run: async (q) => {
    await as(q, "민수");
    await q("update public.room_notification_settings set task_assigned = false where room_id = $1::bigint", [await roomId(q, "aws")]);
    const r2 = await nodeId(q, "aws", "EC2·S3");
    const jieun = await uidOf(q, "지은");
    const d = await preview(q, "aws", plan([{ op: "create", parent: r2, title: "발표 I", taskType: "designated", assigneeIds: [jieun] },
                                          { op: "create", parent: r2, title: "발표 J", taskType: "designated", assigneeIds: [jieun] }]));
    assertEquals(d.notifications.perRecipient, []);
    await apply(q, "aws", d.previewId);
    assertEquals(await notes(q, "지은", K), []);
  } },
  { name: "다른 행위자의 같은 방 알림은 묶지 않는다(행위자 필터)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const jieun = await uidOf(q, "지은");
    const other = await uidOf(q, "하나");
    const after = Number((await one(q, "select coalesce(max(id), 0) as m from public.notifications")).m);
    await q(`insert into public.notifications (user_id, kind, title, body, room_id, actor_user_id, link)
             values ($1::uuid, 'SCHEDULE_CHANGED', 't', 'b', $2::bigint, $3::uuid, '/x'), ($1::uuid, 'SCHEDULE_CHANGED', 't', 'b', $2::bigint, $3::uuid, '/x')`,
            [jieun, aws, other]);
    const r = (await one(q, "select public.plan_collapse_notifications($1::bigint, $2::uuid, $3::bigint, '{}') as r",
                         [aws, await uidOf(q, "민수"), after])).r as Row;
    assertEquals(r, { recipients: 0, perRecipient: [] });
    assertEquals(await count(q, "select 1 from public.notifications where id > $1::bigint and user_id = $2::uuid", [after, jieun]), 2);
  } },
  { name: "적용이 실패하면 묶음 알림도 롤백(같은 트랜잭션) — plan_run 안에서 부른다", run: async (q) => {
    const src = (await one(q, "select prosrc from pg_proc where proname = 'plan_run'")).prosrc as string;
    assert(src.includes("public.plan_collapse_notifications(r.id, v_uid, v_after_id"));
    assert(src.indexOf("plan_collapse_notifications") < src.indexOf("PLAN_DRY_RUN"));   // 서브트랜잭션 안(dry 되감기·실패 롤백)
  } },
]);
