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
    // 큰 수는 int 캐스트(22003) 전에 범위로 거른다
    await bad({ points: 1e12 }, "points");
    await bad({ answer: 99999999999 }, "answer");
    await bad({ prompt: 123 }, "prompt");                    // 문자열만
    await bad({ explanation: { md: "x" } }, "explanation");
    await expectFail(put(q, node, { questions: [{ ...Q4.questions[1], answer: [0, 1e12] }] }), "VALIDATION_FAILED");
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
    assertEquals(notes[0].title, "AWS SAA 자격증 3개월 완주 「3주차 정리 시험」 시험이 열렸어요");   // 스펙 §4.6 앞부분
    assertEquals(notes[0].link, `/my-study/aws?task=${node}`);
    assertEquals(notes.map((x) => x.user_id).sort(), [await uidOf(q, "지은"), await uidOf(q, "철수"), await uidOf(q, "하나")].sort());
    const body = (await one(q, "select body from public.notifications where kind = 'EXAM_PUBLISHED' and node_id = $1::bigint limit 1", [node])).body;
    assertEquals(body, "4문항 · ~10.21");                                                   // 스펙 §4.6 뒷부분
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
    try {
      await rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "a", count: 1e12 })]);
      throw new Error("expected fail");
    } catch (e) {
      const er = e as Error & { hint?: string };
      assert(er.message.includes("VALIDATION_FAILED"), er.message);
      assertEquals(JSON.parse(er.hint ?? "{}").field, "count");
    }
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "a", types: ["essay"] })]), "VALIDATION_FAILED");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "a", difficulty: "insane" })]), "VALIDATION_FAILED");
    // 브리프만 넣은 새 리프 = 빈 초안 · 기본값(count 10 · types single/multi/ox · normal)
    const fresh = await newExamLeaf(q, "브리프만");
    const b = await rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [fresh, JSON.stringify({ topic: "  ELB  " })]);
    assertEquals([b.exam.status, b.exam.questionCount, b.exam.brief], ["draft", 0, { topic: "ELB", count: 10, types: ["single", "multi", "ox"], difficulty: "normal" }]);
    await as(q, "지은");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "x" })]), "NOT_CURRICULUM_EDITOR");
  } },
  { name: "lock: any attempt (even IN_PROGRESS) locks structure & unpublish (EXAM_LOCKED) · text·explanation·reveal still editable", run: async (q) => {
    const node = await newExamLeaf(q);
    await put(q, node, Q4);
    await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
    // 응시 RPC 는 Task 2 — 진행 중 응시 행을 직접 넣는다(테스트는 소유자 권한) + 저장된 답 1개
    const att = (await one(q, "insert into public.exam_attempts (node_id, user_id) values ($1::bigint, $2::uuid) returning id::text as id", [node, await uidOf(q, "지은")])).id;
    const q0 = (await one(q, "select id::text as id from public.exam_questions where node_id = $1::bigint and ord = 0", [node])).id;
    await q("insert into public.exam_answers (attempt_id, question_id, answer) values ($1::bigint, $2::bigint, '0')", [att, q0]);
    const locked = async (p: Promise<unknown>, started: number, submitted: number) => {
      try { await p; throw new Error("expected fail"); }
      catch (e) {
        const er = e as Error & { hint?: string };
        assert(er.message.includes("EXAM_LOCKED"), er.message);
        assertEquals(JSON.parse(er.hint ?? "{}"), { submitted, started });
      }
    };
    await locked(put(q, node, { questions: Q4.questions.slice(0, 3) }), 1, 0);                                       // 개수
    await locked(put(q, node, { questions: [{ ...Q4.questions[0], answer: 1 }, ...Q4.questions.slice(1)] }), 1, 0); // 정답
    await locked(put(q, node, { questions: [{ ...Q4.questions[0], points: 3 }, ...Q4.questions.slice(1)] }), 1, 0); // 배점
    await locked(rpc(q, "public.exam_unpublish('aws', $1::bigint)", [node]), 1, 0);
    // 문구·해설·공개 시점은 허용 — 문항 id 와 저장된 답이 남는다
    const v = await put(q, node, { reveal: "after_deadline", questions: [{ ...Q4.questions[0], prompt: "고친 문제", explanation: "고친 해설" }, ...Q4.questions.slice(1)] });
    assertEquals([v.questions[0].id, v.questions[0].prompt, v.questions[0].explanation, v.exam.reveal, v.exam.locked], [q0, "고친 문제", "고친 해설", "after_deadline", true]);
    assertEquals((await one(q, "select count(*)::int as c from public.exam_answers where attempt_id = $1::bigint", [att])).c, 1);
    // 제출된 응시가 있으면 문구만 바뀐다(코드는 같고 details.submitted 가 센다)
    await q("update public.exam_attempts set status = 'SUBMITTED', submitted_at = now() where id = $1::bigint", [att]);
    await locked(rpc(q, "public.exam_unpublish('aws', $1::bigint)", [node]), 1, 1);
  } },
]);

/** 발행된 4문항 시험 + 오늘 10/16 */
async function published(q: Q): Promise<string> {
  const node = await newExamLeaf(q);
  await put(q, node, Q4);
  await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
  await setToday(q, "2026-10-16");
  await setNow(q, "2026-10-16T12:00:00+09:00");
  return node;
}
const get = (q: Q, node: string) => rpc(q, "public.exam_get('aws', $1::bigint)", [node]);
const save = (q: Q, node: string, qid: string, a: unknown) => rpc(q, "public.exam_answer_save($1::bigint, $2::bigint, $3::jsonb)", [node, qid, JSON.stringify(a)]);
const submitExam = (q: Q, node: string) => rpc(q, "public.exam_submit($1::bigint)", [node]);
const qids = async (q: Q, node: string) => (await q("select id::text as id from public.exam_questions where node_id = $1::bigint order by ord", [node])).map((r) => r.id as string);
/** 오류 코드 정확히 일치(expectFail 은 부분 문자열 — NOT_FOUND 가 EXAM_NOT_FOUND 에도 맞는다) */
async function failCode(p: Promise<unknown>, code: string): Promise<void> {
  try { await p; } catch (e) { assertEquals((e as Error).message, code); return; }
  throw new Error(`expected ${code}, but the call succeeded`);
}

cases("round exam 0037 · taking & reveal", db, [
  { name: "exam_get before submit: assignee gets questions WITHOUT answer/explanation keys · non-assignee no questions · anon EXAM_NOT_FOUND", run: async (q) => {
    const node = await published(q);
    await as(q, "지은");
    const v = await get(q, node);
    assertEquals(v.viewer.canTake, true);
    assertEquals(v.questions.length, 4);
    for (const x of v.questions) { assertEquals("answer" in x, false); assertEquals("explanation" in x, false); }
    assertEquals(v.attempt, null);
    for (const k of ["brief", "source", "locked", "submittedCount"]) assertEquals(k in v.exam, false, k);   // 편집자 전용 키
    await q("update public.rooms set leader_does_tasks = false where slug = 'aws'");
    await q("select public.assignment_resync((select id from public.rooms where slug = 'aws'))");
    await as(q, "민수");                                     // 그룹장(과제 안 함) = 편집자 → 정답 본다
    const m = await get(q, node);
    assertEquals("answer" in m.questions[0], true);
    assertEquals([m.viewer.canEdit, m.viewer.isAssignee, m.viewer.reason], [true, false, "not_assignee"]);
    await as(q, "도윤");                                     // INACTIVE 멤버: 문항 없음
    const d = await get(q, node);
    assertEquals(d.questions, null);
    assertEquals(d.viewer.reason, "not_assignee");
    assertEquals("locked" in d.exam, false);
    await asAnon(q);
    await failCode(get(q, node), "EXAM_NOT_FOUND");
    // 일반 리프는 시험이 없다
    await as(q, "지은");
    await failCode(get(q, await nodeId(q, "aws", "ALB vs NLB 실습")), "EXAM_NOT_FOUND");
  } },
  { name: "draft exam: assignee sees status only (reason not_published) · before start not_started, still no questions", run: async (q) => {
    const node = await newExamLeaf(q);
    await put(q, node, Q4);
    await as(q, "지은");
    const v = await get(q, node);
    assertEquals(v.viewer.reason, "not_published");
    assertEquals(v.questions, null);
    await as(q, "지은");
    await failCode(save(q, node, (await qids(q, node))[0], 0), "EXAM_NOT_PUBLISHED");
    await as(q, "민수");
    await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
    await as(q, "지은");                                     // 오늘 10/12 < 10/15
    const s = await get(q, node);
    assertEquals([s.viewer.reason, s.viewer.canTake, s.questions], ["not_started", false, null]);   // 시작 전 문항 유출 없음
    await failCode(save(q, node, (await qids(q, node))[0], 0), "TASK_NOT_STARTED");
    await failCode(submitExam(q, node), "TASK_NOT_STARTED");
    await as(q, "민수");                                     // 편집자는 시작 전에도 문항·정답을 본다
    const e = await get(q, node);
    assertEquals([e.questions.length, "answer" in e.questions[0]], [4, true]);
  } },
  { name: "exam_answer_save: shape check per type · creates IN_PROGRESS · answered/total · plain leaf EXAM_NOT_FOUND", run: async (q) => {
    const node = await published(q);
    const ids = await qids(q, node);
    await as(q, "지은");
    let r = await save(q, node, ids[0], 0);
    assertEquals([r.answered, r.total], [1, 4]);
    assertEquals(r.savedAt, "2026-10-16T03:00:00.000Z");
    await failCode(save(q, node, ids[0], 9), "VALIDATION_FAILED");
    await failCode(save(q, node, ids[0], 1e12), "VALIDATION_FAILED");     // 큰 수도 22003 이 아니라 모양 오류
    await failCode(save(q, node, ids[0], 0.5), "VALIDATION_FAILED");
    await failCode(save(q, node, ids[0], null), "VALIDATION_FAILED");
    await failCode(save(q, node, ids[1], 0), "VALIDATION_FAILED");        // multi 는 배열
    await failCode(save(q, node, ids[1], [1.5]), "VALIDATION_FAILED");
    await failCode(save(q, node, ids[1], ["0"]), "VALIDATION_FAILED");
    await failCode(save(q, node, ids[2], "O"), "VALIDATION_FAILED");      // ox 는 boolean
    await failCode(save(q, node, ids[3], "x".repeat(201)), "VALIDATION_FAILED");
    await failCode(save(q, node, ids[3], 1), "VALIDATION_FAILED");
    r = await save(q, node, ids[1], [2, 0]);
    assertEquals(r.answered, 2);
    r = await save(q, node, ids[3], "");                     // 빈 답은 저장되지만 "답함" 이 아니다(웹 isAnswered 와 같음)
    assertEquals(r.answered, 2);
    r = await save(q, node, ids[1], []);
    assertEquals(r.answered, 1);
    assertEquals((await one(q, "select status from public.exam_attempts where node_id = $1::bigint", [node])).status, "IN_PROGRESS");
    const plain = await nodeId(q, "aws", "ALB vs NLB 실습");
    await failCode(save(q, plain, ids[0], 0), "EXAM_NOT_FOUND");
    await failCode(save(q, node, "0", 0), "NOT_FOUND");                    // 다른 시험의 문항 id
    // 담당자 아님
    await q("update public.rooms set leader_does_tasks = false where slug = 'aws'");
    await q("select public.assignment_resync((select id from public.rooms where slug = 'aws'))");
    await as(q, "민수");
    await failCode(save(q, node, ids[0], 0), "TASK_NOT_ASSIGNED");
    // 진행 중 응시가 생기면 편집자 화면 locked = true · submittedCount 는 제출만 센다 · 초안 되돌리기 잠김
    const e = await get(q, node);
    assertEquals([e.exam.locked, e.exam.submittedCount], [true, 0]);
    await failCode(rpc(q, "public.exam_unpublish('aws', $1::bigint)", [node]), "EXAM_LOCKED");
  } },
  { name: "exam_submit: server grading (single·multi all-or-nothing·ox·short normalized) · submissions row · progress · answers revealed (after_submit)", run: async (q) => {
    const node = await published(q);
    const ids = await qids(q, node);
    await as(q, "지은");
    await save(q, node, ids[0], 0);           // 정답
    await save(q, node, ids[1], [0]);         // 부분 → 오답
    await save(q, node, ids[2], false);       // 정답
    await save(q, node, ids[3], " internet  GATEWAY ");   // 정규화 → 정답
    const v = await submitExam(q, node);
    assertEquals(v.attempt.status, "submitted");
    assertEquals([v.attempt.score, v.attempt.maxScore, v.attempt.correctCount], [3, 5, 3]);
    assertEquals(v.attempt.isLate, false);
    assertEquals(v.attempt.submittedAt, "2026-10-16T03:00:00.000Z");
    assertEquals(v.attempt.results[ids[1]], { correct: false, earned: 0 });
    assertEquals(v.attempt.results[ids[2]], { correct: true, earned: 1 });
    assertEquals(v.questions[1].answer, [0, 2]);
    assertEquals(v.questions[1].explanation, "IAM 은 글로벌");
    assertEquals([v.viewer.reason, v.viewer.canTake], ["submitted", false]);
    // submissions 1행 → 기존 집계가 "제출" 로 본다
    const s = await one(q, "select body_md, is_late from public.submissions where node_id = $1::bigint and user_id = $2::uuid", [node, await uidOf(q, "지은")]);
    assertEquals([s.body_md, s.is_late], ["", false]);
    const p = await one(q, "select asg, sub from public.room_progress((select id from public.rooms where slug = 'aws')) where node_id = $1::bigint", [node]);
    assertEquals([p.asg, p.sub], [4, 1]);
    const st = await one(q, "select st from public.me_schedule_leaves($1::uuid, '2026-10-16') where node_id = $2::bigint", [await uidOf(q, "지은"), node]);
    assertEquals(st.st, "done");
    await failCode(submitExam(q, node), "EXAM_ALREADY_SUBMITTED");
    await failCode(save(q, node, ids[0], 1), "EXAM_ALREADY_SUBMITTED");
    // 다른 담당자(철수)는 아직 제출 전 — 정답 키 없음, 편집자는 제출 1건
    await as(q, "철수");
    assertEquals("answer" in (await get(q, node)).questions[0], false);
    await as(q, "민수");
    const e = await get(q, node);
    assertEquals([e.exam.locked, e.exam.submittedCount], [true, 1]);
  } },
  { name: "exam_grade: multi duplicates count once · wrong/missing answers 0 · short punctuation", run: async (q) => {
    const node = await published(q);
    const ids = await qids(q, node);
    await as(q, "하나");
    await save(q, node, ids[0], 1);                          // 오답
    await save(q, node, ids[1], [2, 0, 2]);                  // 중복 선택 → [0,2] 정답
    await save(q, node, ids[3], "IGW.");                     // 구두점 → 정답
    const v = await submitExam(q, node);
    assertEquals([v.attempt.score, v.attempt.correctCount], [3, 2]);
    assertEquals(v.attempt.results[ids[2]], { correct: false, earned: 0 });   // 미답
    assertEquals(v.attempt.answers[ids[2]], null);                             // 미답 채점 행 = JSON null
  } },
  { name: "exam_submit: unanswered questions count wrong · late after deadline · empty attempt allowed (0점)", run: async (q) => {
    const node = await published(q);
    await setToday(q, "2026-10-22");
    await setNow(q, "2026-10-22T09:00:00+09:00");
    await as(q, "철수");
    assertEquals([(await get(q, node)).viewer.canTake, (await get(q, node)).exam.closed], [true, false]);   // after_submit 은 마감 뒤에도 응시(지각)
    const v = await submitExam(q, node);
    assertEquals([v.attempt.score, v.attempt.correctCount, v.attempt.isLate], [0, 0, true]);
    await as(q, "하나");                                     // 지각 저장·제출 — 정답은 자기 제출 뒤에만 열린다
    const ids = await qids(q, node);
    await save(q, node, ids[0], 0);
    assertEquals("answer" in (await get(q, node)).questions[0], false);
    const h = await submitExam(q, node);
    assertEquals([h.attempt.score, h.attempt.isLate], [1, true]);
    assertEquals((await one(q, "select is_late from public.submissions where node_id = $1::bigint and user_id = $2::uuid", [node, await uidOf(q, "철수")])).is_late, true);
  } },
  { name: "reveal after_deadline: after submit only score · after end_date answers for everyone incl. non-submitters · extending end_date closes again", run: async (q) => {
    const node = await newExamLeaf(q);
    await put(q, node, { ...Q4, reveal: "after_deadline" });
    await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
    await setToday(q, "2026-10-16"); await setNow(q, "2026-10-16T12:00:00+09:00");
    const ids = await qids(q, node);
    await as(q, "지은");
    await save(q, node, ids[0], 0);
    let v = await submitExam(q, node);
    assertEquals(v.attempt.score, 1);
    assertEquals(v.attempt.results, null);
    assertEquals("answer" in v.questions[0], false);
    assertEquals("explanation" in v.questions[0], false);
    await setToday(q, "2026-10-21");                         // 마감 당일 = 아직 닫힘
    assertEquals("answer" in (await get(q, node)).questions[0], false);
    await setToday(q, "2026-10-22");
    v = await get(q, node);
    assertEquals(v.attempt.results[ids[0]].correct, true);
    assertEquals("answer" in v.questions[0], true);
    await as(q, "하나");                                     // 미제출자도 마감 뒤엔 본다
    const h = await get(q, node);
    assertEquals("answer" in h.questions[0], true);
    assertEquals(h.attempt, null);
    await as(q, "민수");
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-25\"}'::jsonb)", [node]);
    await as(q, "지은");
    const c = await get(q, node);
    assertEquals("answer" in c.questions[0], false);         // 연장 → 다시 닫힘
    assertEquals(c.attempt.results, null);
  } },
  { name: "all-submitted notification (IMMEDIATE) fires from exam_submit like a normal task", run: async (q) => {
    const node = await published(q);
    await q("update public.room_notification_settings set completion_mode = 'IMMEDIATE' where room_id = (select id from public.rooms where slug = 'aws')");
    // 행위자는 수신자에서 빠진다 → 마지막 제출자는 그룹장이 아니어야 그룹장에게 간다
    for (const n of ["민수", "지은", "철수"]) { await as(q, n); await submitExam(q, node); }
    assertEquals((await q("select 1 from public.notifications where kind = 'TASK_ALL_SUBMITTED' and node_id = $1::bigint", [node])).length, 0);
    await as(q, "하나");
    await submitExam(q, node);
    const notes = await q("select user_id::text as u from public.notifications where kind = 'TASK_ALL_SUBMITTED' and node_id = $1::bigint", [node]);
    assertEquals(notes.map((x) => x.u), [await uidOf(q, "민수")]);
  } },
  { name: "archived exam leaf: take blocked (TASK_ARCHIVED) · editor still sees answers", run: async (q) => {
    const node = await published(q);
    await as(q, "민수");
    await q("select public.node_archive('aws', $1::bigint)", [node]);
    await as(q, "지은");
    await failCode(save(q, node, (await qids(q, node))[0], 0), "TASK_ARCHIVED");
    await failCode(submitExam(q, node), "TASK_ARCHIVED");
    await as(q, "민수");
    const v = await get(q, node);
    assertEquals(v.exam.status, "published");
    assertEquals(v.node.archived, true);
    assertEquals("answer" in v.questions[0], true);
  } },
  { name: "exam_view: editor-only FORBIDDEN guard for someone else's attempt (p_for) · unauthenticated save rejected", run: async (q) => {
    const node = await published(q);
    const ji = await uidOf(q, "지은");
    const cs = await uidOf(q, "철수");
    await as(q, "지은");
    await save(q, node, (await qids(q, node))[0], 0);
    await failCode(rpc(q, "public.exam_view($1::bigint, $2::uuid, $3::uuid)", [node, cs, ji]), "FORBIDDEN");
    const m = await rpc(q, "public.exam_view($1::bigint, $2::uuid, $3::uuid)", [node, await uidOf(q, "민수"), ji]);
    assertEquals(m.attempt.status, "in_progress");
    assertEquals(Object.keys(m.attempt.answers).length, 1);
    await asAnon(q);
    await failCode(save(q, node, (await qids(q, node))[0], 0), "AUTH_REQUIRED");
  } },
  { name: "answers stored canonically: 0.0 / [2.0, 0, 0] (direct RPC) → 0 / [0,2] · graded correct (no 22P02)", run: async (q) => {
    const node = await published(q);
    const ids = await qids(q, node);
    await as(q, "지은");
    // JS 의 JSON.stringify(0.0) 은 "0" 이라 SQL 리터럴로 직접 보낸다(PostgREST 클라이언트는 1.0 을 그대로 보낼 수 있다)
    await q("select public.exam_answer_save($1::bigint, $2::bigint, '0.0'::jsonb)", [node, ids[0]]);
    await q("select public.exam_answer_save($1::bigint, $2::bigint, '[2.0, 0, 0]'::jsonb)", [node, ids[1]]);
    const stored = await q(`select e.answer::text as a from public.exam_answers e join public.exam_attempts t on t.id = e.attempt_id
                            where t.node_id = $1::bigint order by e.question_id`, [node]);
    assertEquals(stored.map((x) => x.a), ["0", "[0, 2]"]);
    // 저장 경로를 거치지 않은 비정규 표기도 채점은 견딘다(exam_grade ::numeric::int)
    await q("update public.exam_answers set answer = '0.0'::jsonb where question_id = $1::bigint", [ids[0]]);
    const v = await submitExam(q, node);
    assertEquals([v.attempt.results[ids[0]].correct, v.attempt.results[ids[1]].correct, v.attempt.score], [true, true, 3]);
  } },
  { name: "EXAM_CLOSED: after_deadline past end_date → save & submit rejected · exam.closed / reason closed · extension reopens", run: async (q) => {
    const node = await newExamLeaf(q);
    await put(q, node, { ...Q4, reveal: "after_deadline" });
    await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
    const ids = await qids(q, node);
    await setToday(q, "2026-10-16"); await setNow(q, "2026-10-16T12:00:00+09:00");
    await as(q, "철수");
    await save(q, node, ids[0], 1);                          // 진행 중 응시
    await setToday(q, "2026-10-22"); await setNow(q, "2026-10-22T09:00:00+09:00");
    for (const n of ["철수", "하나"]) {                       // 진행 중 · 응시 전 모두
      await as(q, n);
      const v = await get(q, node);
      assertEquals([v.exam.closed, v.viewer.canTake, v.viewer.reason, "answer" in v.questions[0]], [true, false, "closed", true]);
      await failCode(save(q, node, ids[0], 0), "EXAM_CLOSED");
      await failCode(submitExam(q, node), "EXAM_CLOSED");
    }
    await as(q, "민수");
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-25\"}'::jsonb)", [node]);
    await as(q, "철수");                                     // 연장 → 공개 닫힘 → 응시 다시 열림
    const o = await get(q, node);
    assertEquals([o.exam.closed, o.viewer.canTake, "answer" in o.questions[0]], [false, true, false]);
    await save(q, node, ids[0], 0);
    const s = await submitExam(q, node);
    assertEquals([s.attempt.score, s.attempt.isLate, s.attempt.results], [1, false, null]);
  } },
]);
