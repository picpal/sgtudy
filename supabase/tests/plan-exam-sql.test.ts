// 0038 — 진행목표 계획서 create kind:"exam" (MCP 로 시험 리프 만들기)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asUser, openDb } from "./_harness.ts";
import { cases, nodeId, one, uidOf, type Q, type Row } from "./_fixtures.ts";
import { mkRoom } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => { await asUser(q, await uidOf(q, nick)); };
const plan = (ops: unknown[]) => JSON.stringify({ schema: "sgtudy.plan/v1", ops });
const preview = async (q: Q, slug: string, p: string) =>
  (await one(q, "select public.curriculum_plan_preview($1, $2::jsonb) as r", [slug, p])).r as Row;
const apply = async (q: Q, slug: string, id: string) =>
  (await one(q, "select public.curriculum_plan_apply($1, $2) as r", [slug, id])).r as Row;
const errs = (r: Row) => (r.errors as Row[]).map((e) => [e.path, e.code, e.field]);
/** 비교용 exams 행(id·시각 제외) */
const examRow = async (q: Q, node: string) => await one(q,
  `select x.status, x.reveal, x.source, x.question_count, x.total_points, x.brief, x.published_at, x.created_by::text as by,
          x.room_id = n.room_id as same_room, n.task_type,
          (select count(*)::int from public.exam_questions e where e.node_id = x.node_id) as qs
   from public.exams x join public.goal_nodes n on n.id = x.node_id where x.node_id = $1::bigint`, [node]);
const weekWithExam = (exam: Row = {}) => plan([
  { op: "create", ref: "w", title: "1주차", children: [{ title: "읽기" }, { title: "1주차 시험", kind: "exam", ...exam }] },
]);

cases("plan exam 0038", db, [
  { name: "미리보기: 시험 리프는 diff 에 exam:true · 노드·시험 행은 그대로(되감김)", run: async (q) => {
    const { slug, id } = await mkRoom(q, "민수");
    const r = await preview(q, slug, weekWithExam());
    assertEquals(r.ok, true);
    const ex = (r.diff as Row[]).find((d) => d.title === "1주차 시험")!;
    assertEquals([ex.op, ex.kind, ex.taskType, ex.exam], ["create", "task", "common", true]);
    assertEquals("exam" in (r.diff as Row[]).find((d) => d.title === "읽기")!, false);
    assertEquals((await one(q, "select count(*)::int as n from public.exams where room_id = $1::bigint", [id])).n, 0);
  } },
  { name: "적용: 웹 빠른 추가(node_create → exam_put 빈 초안)와 같은 시험 행 · 이어서 exam_draft_put 이 채운다", run: async (q) => {
    const { slug, leader } = await mkRoom(q, "민수");
    const a = await apply(q, slug, (await preview(q, slug, weekWithExam())).previewId);
    assertEquals(a.applied, true);
    const exam = (await one(q, "select id::text as id from public.goal_nodes where title = '1주차 시험'")).id as string;
    const viaPlan = await examRow(q, exam);
    // 웹 경로로 같은 회차에 하나 더
    const round = a.refs.w as string;
    await q("select public.node_create($1, $2::bigint, '웹 시험')", [slug, round]);
    const web = (await one(q, "select id::text as id from public.goal_nodes where title = '웹 시험'")).id as string;
    await q(`select public.exam_put($1, $2::bigint, '{"reveal":"after_submit","questions":[]}'::jsonb)`, [slug, web]);
    assertEquals(viaPlan, await examRow(q, web));
    assertEquals([viaPlan.status, viaPlan.qs, viaPlan.brief, viaPlan.by, viaPlan.task_type], ["DRAFT", 0, null, leader, "COMMON"]);
    const d = (await one(q, `select public.exam_draft_put($1, $2::bigint,
      '{"questions":[{"type":"ox","prompt":"참?","answer":true}]}'::jsonb) as r`, [slug, exam])).r as Row;
    assertEquals(d.questionCount, 1);
    // 일반 과제(kind 생략·"task")는 시험 행이 없다
    assertEquals((await one(q, "select count(*)::int as n from public.exams x join public.goal_nodes n on n.id = x.node_id where n.title = '읽기'")).n, 0);
  } },
  { name: "지정 시험: taskType designated + assignees 그대로 · 기존 회차 아래(parent:{round}) · kind:task 명시", run: async (q) => {
    await as(q, "민수");
    const r = await preview(q, "aws", plan([
      { op: "create", parent: { round: 2 }, title: "지정 시험", kind: "exam", taskType: "designated", assignees: ["지은"] },
      { op: "create", parent: { round: 2 }, title: "그냥 과제", kind: "task" },
      { op: "create", parent: { round: 2 }, title: "공통 시험", kind: "exam" },
    ]));
    assertEquals(r.ok, true, JSON.stringify(r.errors));
    const ex = (r.diff as Row[]).find((d) => d.title === "지정 시험")!;
    assertEquals([ex.taskType, ex.assignees, ex.exam], ["designated", ["지은"], true]);
    await apply(q, "aws", r.previewId);
    const node = await nodeId(q, "aws", "지정 시험");
    assertEquals((await examRow(q, node)).task_type, "DESIGNATED");
    // 초안 시험(공통 시험)은 「새 과제」 알림으로 세지 않는다 — 그냥 과제 1개만
    assertEquals((r.notifications.perRecipient as Row[]).find((p) => p.nickname === "철수")?.newTasks, 1);
    assertEquals((await one(q, "select count(*)::int as n from public.exams x where x.node_id = $1::bigint", [await nodeId(q, "aws", "그냥 과제")])).n, 0);
  } },
  { name: "검증: kind 값 · 시험에 children · 회차 자리 시험 → 모두 보고", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const r = await preview(q, slug, plan([
      { op: "create", ref: "w", title: "1주차" },
      { op: "create", parent: "@w", title: "a", kind: "quiz" },
      { op: "create", parent: "@w", title: "b", kind: "exam", children: [{ title: "c" }] },
      { op: "create", title: "회차 시험", kind: "exam", taskType: "common" },
      { op: "create", parent: "@w", title: "d", kind: 1 },
    ]));
    assertEquals(r.ok, false);
    assertEquals(errs(r), [
      ["ops[1]", "VALIDATION_FAILED", "kind"], ["ops[2]", "PLAN_INVALID", "kind"], ["ops[3]", "PLAN_INVALID", "kind"], ["ops[4]", "VALIDATION_FAILED", "kind"]]);
  } },
  { name: "시험은 부모가 될 수 없다: 계획서 안 시험(@ref)·기존 시험 아래 create · 기존 시험 아래로 move → EXAM_NODE", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const a = await apply(q, slug, (await preview(q, slug, weekWithExam({ ref: "ex" }))).previewId);
    const exam = a.refs.ex as string;
    const read = (await one(q, "select id::text as id from public.goal_nodes where title = '읽기'")).id as string;
    const r = await preview(q, slug, plan([
      { op: "create", parent: { round: 1 }, ref: "ex2", title: "또 시험", kind: "exam" },
      { op: "create", parent: "@ex2", title: "x" },
      { op: "create", parent: exam, title: "y" },
      { op: "move", id: read, parent: exam, index: 0 },
    ]));
    assertEquals(errs(r), [["ops[1]", "EXAM_NODE", "parent"], ["ops[2]", "EXAM_NODE", "parent"], ["ops[3]", "EXAM_NODE", "parent"]]);
  } },
  { name: "update 로 kind 를 바꿀 수 없다(시험 ↔ 과제 모두) · 시험의 다른 필드 update·move 는 되고 diff 에 exam:true", run: async (q) => {
    const { slug } = await mkRoom(q, "민수");
    const a = await apply(q, slug, (await preview(q, slug, weekWithExam({ ref: "ex" }))).previewId);
    const exam = a.refs.ex as string;
    const read = (await one(q, "select id::text as id from public.goal_nodes where title = '읽기'")).id as string;
    const bad = await preview(q, slug, plan([
      { op: "update", id: read, set: { kind: "exam" } },
      { op: "update", id: exam, set: { kind: "task" } },
    ]));
    assertEquals(errs(bad), [["ops[0]", "PLAN_INVALID", "kind"], ["ops[1]", "PLAN_INVALID", "kind"]]);
    const ok = await preview(q, slug, plan([
      { op: "update", id: exam, set: { title: "1주차 정리 시험" } },
      { op: "move", id: exam, parent: a.refs.w, index: 0 },
    ]));
    assertEquals(ok.ok, true, JSON.stringify(ok.errors));
    assert((ok.diff as Row[]).every((d) => d.exam === true));
  } },
]);
