// supabase/tests/round-exam-sql.test.ts — 0037 회차 시험 (스펙 2026-10-21-round-exam-design)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";
import { submit } from "./_submit.ts";

const db = await openDb();
await applySeed(db);

const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
const rpc = async (q: Q, expr: string, p: unknown[] = []) => (await one(q, `select ${expr} as r`, p)).r as Row;
/** aws 3주차 묶음 아래 시험 리프(COMMON) 하나 — node_create 로 만든다(민수 = 그룹장) */
async function newExamLeaf(q: Q, title = "3주차 정리 시험"): Promise<string> {
  await as(q, "민수");
  const parent = (await one(q, `select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id
                                 where r.slug = 'aws' and n.title = 'ALB vs NLB 실습'`)).id as string;
  const bundle = (await one(q, "select parent_id::text as id from public.goal_nodes where id = $1::bigint", [parent])).id as string;
  await q("select public.node_create('aws', $1::bigint, $2, null, 'common', '2026-10-15', '2026-10-21')", [bundle, title]);
  return await nodeId(q, "aws", title);
}
const Q4 = {
  reveal: "after_submit",
  questions: [
    { type: "single", prompt: "IAM 정책 평가 순서로 옳은 것은?", choices: ["명시적 Deny → Allow → 암묵 Deny", "Allow → Deny", "암묵 Deny → Allow", "순서 없음"], answer: 0, explanation: "명시적 Deny 가 먼저예요", points: 1 },
    { type: "multi", prompt: "리전 서비스를 모두 고르세요", choices: ["EC2", "IAM", "VPC"], answer: [0, 2], explanation: "IAM 은 글로벌", points: 2 },
    { type: "ox", prompt: "S3 는 리전 서비스다.", answer: false, explanation: "S3 는 글로벌 네임스페이스·리전 버킷" },
    { type: "short", prompt: "VPC 의 인터넷 관문은?", answer: ["인터넷 게이트웨이", "Internet Gateway", "IGW"], explanation: "IGW" },
  ],
};
const put = (q: Q, node: string, exam: unknown) => rpc(q, "public.exam_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify(exam)]);

cases("round exam 0037 · schema & authoring", db, [
  { name: "tables closed to clients · RLS on", run: async (q) => {
    for (const t of ["exams", "exam_questions", "exam_attempts", "exam_answers"]) {
      for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert", "update", "delete"]) {
        assertEquals((await one(q, "select has_table_privilege($1, $2, $3) as v", [role, `public.${t}`, priv])).v, false, `${role} ${priv} ${t}`);
      }
      assertEquals((await one(q, "select relrowsecurity as v from pg_class where oid = $1::regclass", [`public.${t}`])).v, true, t);
    }
  } },
  { name: "exam_norm: NFC·lower·trim·collapse·punct", run: async (q) => {
    const n = async (s: string) => (await one(q, "select public.exam_norm($1) as v", [s])).v;
    assertEquals(await n("  Internet   Gateway! "), "internet gateway");
    assertEquals(await n("인터넷-게이트웨이"), "인터넷게이트웨이");
    assertEquals(await n("IGW ."), "igw");                  // 구두점 제거 뒤 남은 공백도 걷는다
  } },
  { name: "exam_put: draft with 4 questions → counts · editor view has answers", run: async (q) => {
    const node = await newExamLeaf(q);
    const v = await put(q, node, Q4);
    assertEquals(v.exam.status, "draft");
    assertEquals(v.exam.questionCount, 4);
    assertEquals(v.exam.totalPoints, 5);
    assertEquals(v.exam.source, "manual");
    assertEquals(v.questions.length, 4);
    assertEquals(v.questions[1].answer, [0, 2]);           // 편집자는 정답을 본다
    assertEquals(v.questions[2].explanation, "S3 는 글로벌 네임스페이스·리전 버킷");
    assertEquals(v.questions[2].points, 1);                 // 기본 배점
  } },
  { name: "exam_put: validation — 50 max · choices 2~8 · answer index range · short answers non-empty · points 1~10", run: async (q) => {
    const node = await newExamLeaf(q);
    const bad = async (patch: Record<string, unknown>, field: string) => {
      try { await put(q, node, { questions: [{ ...Q4.questions[0], ...patch }] }); throw new Error("expected fail"); }
      catch (e) {
        const er = e as Error & { hint?: string };
        assert(er.message.includes("VALIDATION_FAILED"), er.message);
        assertEquals(JSON.parse(er.hint ?? "{}").field, field, `field ${field}: ${er.hint}`);   // fail(): message = 코드, details = hint JSON
      }
    };
    await bad({ choices: ["하나"] }, "choices");
    await bad({ answer: 4 }, "answer");
    await bad({ points: 11 }, "points");
    await bad({ prompt: "" }, "prompt");
    await bad({ type: "essay" }, "type");
    await expectFail(put(q, node, { questions: [{ type: "short", prompt: "x", answer: [] }] }), "VALIDATION_FAILED");
    await expectFail(put(q, node, { questions: Array.from({ length: 51 }, () => Q4.questions[2]) }), "VALIDATION_FAILED");
    await expectFail(put(q, node, { reveal: "never", questions: [] }), "VALIDATION_FAILED");
    await bad({ type: undefined }, "type");                  // 유형 없음
    await bad({ points: 1.5 }, "points");
    await expectFail(put(q, node, { questions: [{ ...Q4.questions[1], answer: [0, 0] }] }), "VALIDATION_FAILED");   // 복수 정답 중복
    await expectFail(put(q, node, { questions: ["문항"] }), "VALIDATION_FAILED");
    // 0 문항 초안은 허용
    assertEquals((await put(q, node, { questions: [] })).exam.questionCount, 0);
  } },
  { name: "exam_put: normalizes — multi answer sorted · type upper-stored, lower-shown · reveal kept when omitted", run: async (q) => {
    const node = await newExamLeaf(q);
    const v = await put(q, node, { reveal: "after_deadline", questions: [{ ...Q4.questions[1], type: "MULTI", answer: [2, 0] }] });
    assertEquals([v.questions[0].type, v.questions[0].answer, v.exam.reveal], ["multi", [0, 2], "after_deadline"]);
    assertEquals((await put(q, node, { questions: [Q4.questions[2]] })).exam.reveal, "after_deadline");
  } },
  { name: "exam_put: only editors · not on PERSONAL · not on bundle · leaf of another room", run: async (q) => {
    const node = await newExamLeaf(q);
    await as(q, "지은");
    await expectFail(put(q, node, Q4), "NOT_CURRICULUM_EDITOR");
    await as(q, "민수");
    const bundle = (await one(q, "select parent_id::text as id from public.goal_nodes where id = $1::bigint", [node])).id;
    await expectFail(put(q, bundle, Q4), "NODE_NOT_LEAF");
    const spring = await nodeId(q, "spring", "스프링 컨테이너 실습");   // 다른 방 리프(시드 spring 1주차)
    await expectFail(put(q, spring, Q4), "NODE_NOT_FOUND");
    // 개인 목표(지은이 3주차에 만든 PERSONAL 리프)는 진행목표 편집 대상이 아니다
    const r3 = (await one(q, "select parent_id::text as id from public.goal_nodes where id = $1::bigint", [bundle])).id;
    await as(q, "지은");
    const c = (await one(q, "select public.personal_create('aws', $1, '내 시험 공부', null, null) as c", [r3])).c as Row;
    await as(q, "민수");
    await expectFail(put(q, c.createdId, Q4), "PERSONAL_NODE");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [c.createdId, JSON.stringify({ topic: "x" })]), "PERSONAL_NODE");
  } },
  { name: "exam_put on plain leaf: no submissions → becomes exam · has submissions → NODE_HAS_SUBMISSIONS (no exams row)", run: async (q) => {
    await as(q, "민수");
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");     // 시드 PPPP — 제출 없음
    const v = await put(q, alb, Q4);
    assertEquals([v.exam.status, v.exam.questionCount, v.node.id], ["draft", 4, alb]);
    const iam = await nodeId(q, "aws", "IAM 정책 이해");       // 시드 DLDM — 제출 있음
    await expectFail(put(q, iam, Q4), "NODE_HAS_SUBMISSIONS");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [iam, JSON.stringify({ topic: "IAM" })]), "NODE_HAS_SUBMISSIONS");
    assertEquals((await one(q, "select count(*)::int as c from public.exams where node_id = $1::bigint", [iam])).c, 0);
  } },
  { name: "exam_publish: needs ≥1 question · notifies assignees (EXAM_PUBLISHED, not the publisher) · unpublish ok before any submission", run: async (q) => {
    const node = await newExamLeaf(q);
    await put(q, node, { questions: [] });
    await expectFail(rpc(q, "public.exam_publish('aws', $1::bigint)", [node]), "EXAM_EMPTY");
    await put(q, node, Q4);
    const v = await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
    assertEquals(v.exam.status, "published");
    assert(v.exam.publishedAt);
    const notes = await q(`select n.user_id, n.title, n.link from public.notifications n where n.kind = 'EXAM_PUBLISHED' and n.node_id = $1::bigint order by n.id`, [node]);
    assertEquals(notes.length, 3);                           // 지은·철수·하나 (민수 = 발행자 제외, 도윤 INACTIVE)
    assert((notes[0].title as string).includes("시험이 열렸어요"));
    assertEquals(notes[0].link, `/my-study/aws?task=${node}`);
    assertEquals(notes.map((x) => x.user_id).sort(), [await uidOf(q, "지은"), await uidOf(q, "철수"), await uidOf(q, "하나")].sort());
    const body = (await one(q, "select body from public.notifications where kind = 'EXAM_PUBLISHED' and node_id = $1::bigint limit 1", [node])).body;
    assertEquals(body, "4문항 · 10.21 마감");
    // 다시 발행해도 멱등(알림 추가 없음)
    assertEquals((await rpc(q, "public.exam_publish('aws', $1::bigint)", [node])).exam.status, "published");
    assertEquals((await q("select 1 from public.notifications where kind = 'EXAM_PUBLISHED' and node_id = $1::bigint", [node])).length, 3);
    // 발행 중엔 문항을 비울 수 없다
    await expectFail(put(q, node, { questions: [] }), "EXAM_EMPTY");
    const u = await rpc(q, "public.exam_unpublish('aws', $1::bigint)", [node]);
    assertEquals([u.exam.status, u.exam.publishedAt], ["draft", null]);
    // 시험 없는 리프
    const other = await newExamLeaf(q, "빈 리프");
    await expectFail(rpc(q, "public.exam_publish('aws', $1::bigint)", [other]), "EXAM_NOT_FOUND");
    await expectFail(rpc(q, "public.exam_unpublish('aws', $1::bigint)", [other]), "EXAM_NOT_FOUND");
  } },
  { name: "guards: no child under exam leaf (EXAM_NODE) · no plain submission / attachment on exam leaf (EXAM_NODE)", run: async (q) => {
    const node = await newExamLeaf(q);
    await put(q, node, Q4);
    await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
    await expectFail(q("select public.node_create('aws', $1::bigint, '하위')", [node]), "EXAM_NODE");
    await as(q, "지은");
    await setToday(q, "2026-10-16");
    await expectFail(submit(q, node, "일반 제출"), "EXAM_NODE");
    // file_register 는 경로·Storage 검증이 insert 보다 먼저라 PGlite 에선 못 미친다 → files 트리거를 직접 insert 로 확인(테스트는 소유자 권한)
    await expectFail(q(`insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes)
                        values (gen_random_uuid(), $2::uuid, (select id from public.rooms where slug = 'aws'), $1::bigint, 'ATTACHMENT', 'x/y', 'a.png', 'image/png', 10)`,
                      [node, await uidOf(q, "지은")]), "EXAM_NODE");
    // 대조: 같은 묶음의 일반 리프(ALB vs NLB 실습)는 그대로 제출된다
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");
    await submit(q, alb, "일반 제출");
    assertEquals((await one(q, "select count(*)::int as c from public.submissions where node_id = $1::bigint and user_id = $2::uuid", [alb, await uidOf(q, "지은")])).c, 1);
  } },
  { name: "exam_brief_put: stored for editors · length limits", run: async (q) => {
    const node = await newExamLeaf(q);
    const v = await rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "IAM·VPC", theory: "IAM 정책은 …", count: 10, types: ["single", "ox"], difficulty: "normal" })]);
    assertEquals(v.exam.brief.count, 10);
    assertEquals(v.exam.brief.types, ["single", "ox"]);
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "x".repeat(201) })]), "VALIDATION_FAILED");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "a", count: 0 })]), "VALIDATION_FAILED");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "a", types: ["essay"] })]), "VALIDATION_FAILED");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "a", difficulty: "insane" })]), "VALIDATION_FAILED");
    // 브리프만 넣은 새 리프 = 빈 초안 · 기본값(count 10 · types single/multi/ox · normal)
    const fresh = await newExamLeaf(q, "브리프만");
    const b = await rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [fresh, JSON.stringify({ topic: "  ELB  " })]);
    assertEquals([b.exam.status, b.exam.questionCount, b.exam.brief], ["draft", 0, { topic: "ELB", count: 10, types: ["single", "multi", "ox"], difficulty: "normal" }]);
    await as(q, "지은");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "x" })]), "NOT_CURRICULUM_EDITOR");
  } },
]);
