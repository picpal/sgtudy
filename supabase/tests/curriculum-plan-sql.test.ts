// 0034 — 진행목표 계획서(curriculum_plan) · node_create_core · curriculum_version · 알림 묶기
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { applySeed, asUser, newUser, openDb } from "./_harness.ts";
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
