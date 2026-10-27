// supabase/tests/wrong-note-sql.test.ts — 0046 오답노트 (스펙 2026-10-23-wrong-answer-note-design)
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

// ── round-exam-sql.test.ts 상단 헬퍼 복사(그 파일은 테스트 본문이라 import 못 한다) ──
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
    { type: "ox", prompt: "S3 는 리전 서비스다.", answer: false, explanation: "" },
    { type: "short", prompt: "VPC 의 인터넷 관문은?", answer: ["인터넷 게이트웨이", "Internet Gateway", "IGW"], explanation: "IGW" },
  ],
};
const put = (q: Q, node: string, exam: unknown) => rpc(q, "public.exam_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify(exam)]);

// ── 이 파일의 헬퍼 ──
/** 발행된 시험(기본 Q4) + 오늘 10/16 */
async function published(q: Q, exam: unknown = Q4, title?: string): Promise<string> {
  const node = await newExamLeaf(q, title);
  await put(q, node, exam);
  await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
  await setToday(q, "2026-10-16");
  await setNow(q, "2026-10-16T12:00:00+09:00");
  return node;
}
const qids = async (q: Q, node: string) =>
  (await q("select id::text as id from public.exam_questions where node_id = $1::bigint order by ord", [node])).map((r) => r.id as string);
/** nick 이 풀고 제출 — answers 는 문항 ord 순 [단일, 복수, OX, 단답] (null = 미답) */
async function takeAs(q: Q, nick: string, node: string, answers: unknown[]): Promise<Row> {
  await as(q, nick);
  const ids = await qids(q, node);
  for (let i = 0; i < ids.length; i++) if (answers[i] !== null && answers[i] !== undefined)
    await q("select public.exam_answer_save($1::bigint, $2::bigint, $3::jsonb)", [node, ids[i], JSON.stringify(answers[i])]);
  return await rpc(q, "public.exam_submit($1::bigint)", [node]);
}
const list = (q: Q, slug = "aws") => rpc(q, "public.wrong_note_list($1)", [slug]);
const mine = (q: Q) => rpc(q, "public.wrong_note_mine()");
const practice = (q: Q, items: { questionId: string; answer: unknown }[], slug = "aws") =>
  rpc(q, "public.wrong_note_practice($1, $2::jsonb)", [slug, JSON.stringify(items)]);
const master = (q: Q, qid: string, on: boolean, slug = "aws") => rpc(q, "public.wrong_note_master($1, $2::bigint, $3)", [slug, qid, on]);
/** 오류 코드 정확히 일치(expectFail 은 부분 문자열) + details */
async function failCode(p: Promise<unknown>, code: string): Promise<Row> {
  try { await p; } catch (e) {
    const er = e as Error & { hint?: string };
    assertEquals(er.message, code);
    return JSON.parse(er.hint ?? "{}");
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}
/** 지은 오답 3(1번 오답 · 2번 부분 정답 · 3번 미답), 4번 정답 */
const JIEUN = [1, [0], null, "igw"];

cases("wrong note 0046 · schema & permissions", db, [
  { name: "exam_practice closed to clients · RLS on · 4 RPCs authenticated only · helpers not granted", run: async (q) => {
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert", "update", "delete"]) {
      assertEquals((await one(q, "select has_table_privilege($1, 'public.exam_practice', $2) as v", [role, priv])).v, false, `${role} ${priv}`);
    }
    assertEquals((await one(q, "select relrowsecurity as v from pg_class where oid = 'public.exam_practice'::regclass")).v, true);
    const can = async (role: string, f: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, `public.${f}`])).v;
    for (const f of ["wrong_note_list(text)", "wrong_note_mine()", "wrong_note_practice(text,jsonb)", "wrong_note_master(text,bigint,boolean)"]) {
      assertEquals(await can("authenticated", f), true, f);
      assertEquals(await can("anon", f), false, f);
    }
    for (const f of ["wrong_note_room(text,uuid)", "wrong_note_practice_json(public.exam_practice)", "wrong_note_has_exam(bigint)",
                     "wrong_note_ord(bigint)", "wrong_note_rounds(bigint,uuid)", "wrong_note_totals(jsonb)", "wrong_note_target(bigint,uuid,bigint)"]) {
      assertEquals(await can("authenticated", f), false, f);
      assertEquals(await can("anon", f), false, f);
    }
  } },
]);

cases("wrong note 0046 · list", db, [
  { name: "list: wrong + unanswered, ord order, keys present, mine, round title", run: async (q) => {
    const node = await published(q);
    const ids = await qids(q, node);
    const sub = await takeAs(q, "지은", node, JIEUN);
    assertEquals(sub.attempt.score, 1);
    const v = await list(q);
    assertEquals([v.viewer, v.hasExam, typeof v.today], ["member", true, "string"]);
    assertEquals(v.rounds.length, 1);
    const root = (await one(q, "select r.id::text as id, r.title from public.goal_nodes n join public.goal_nodes r on r.id = n.round_id where n.id = $1::bigint", [node]));
    assertEquals([v.rounds[0].id, v.rounds[0].title], [root.id, root.title]);
    assertEquals(v.rounds[0].exams.length, 1);
    const ex = v.rounds[0].exams[0];
    assertEquals([ex.nodeId, ex.title, ex.endDate, ex.reveal, ex.locked], [node, "3주차 정리 시험", "2026-10-21", "after_submit", false]);
    assertEquals([ex.score, ex.maxScore, ex.correctCount, ex.questionCount], [1, 5, 1, 4]);
    assertEquals("lockedCount" in ex, false);
    assertEquals(ex.items.length, 3);
    assertEquals(ex.items.map((i: Row) => i.no), [1, 2, 3]);
    assertEquals(ex.items.map((i: Row) => i.question.id), ids.slice(0, 3));
    const [a, b, c] = ex.items;
    assertEquals([a.question.type, a.question.answer, a.question.explanation, a.question.points], ["single", 0, "명시적 Deny 가 먼저예요", 1]);
    assertEquals(a.question.choices.length, 4);
    assertEquals(a.question.prompt, "IAM 정책 평가 순서로 옳은 것은?");
    assertEquals([a.mine, b.mine, c.mine], [1, [0], null]);    // 미답 = JSON null
    assertEquals([a.practice, a.mastered], [null, false]);
    assertEquals(c.question.explanation, "");                  // 해설 없는 문항도 키는 있다(D13 은 화면)
    assertEquals(v.totals, { wrong: 3, retriedOk: 0, mastered: 0, locked: 0 });
  } },
  { name: "list: perfect exam omitted · no exam → hasExam false · unsubmitted (in progress) not in note", run: async (q) => {
    await as(q, "지은");
    let v = await list(q);
    assertEquals([v.hasExam, v.rounds, v.totals.wrong], [false, [], 0]);
    const node = await published(q);
    await takeAs(q, "철수", node, [0, [0, 2], false, "IGW"]);
    v = await list(q);
    assertEquals([v.hasExam, v.rounds, v.totals], [true, [], { wrong: 0, retriedOk: 0, mastered: 0, locked: 0 }]);
    // 하나: 답만 저장(IN_PROGRESS) → 노트에 없다
    await as(q, "하나");
    await q("select public.exam_answer_save($1::bigint, $2::bigint, '1'::jsonb)", [node, (await qids(q, node))[0]]);
    assertEquals((await list(q)).rounds, []);
  } },
  { name: "list: after_deadline locked before deadline (no item keys) · opens after · relocks on extend", run: async (q) => {
    const node = await published(q, { ...Q4, reveal: "after_deadline" });
    await takeAs(q, "지은", node, JIEUN);
    await setToday(q, "2026-10-20");
    let ex = (await list(q)).rounds[0].exams[0];
    assertEquals([ex.locked, ex.lockedCount, ex.unlockDate, ex.reveal], [true, 3, "2026-10-21", "after_deadline"]);
    assertEquals("items" in ex, false);                         // 키 자체가 없다(D3)
    assertEquals(JSON.stringify(ex).includes("명시적 Deny"), false);
    assertEquals([ex.score, ex.correctCount], [1, 1]);          // 점수는 이미 보이는 값
    let v = await list(q);
    assertEquals(v.totals, { wrong: 0, retriedOk: 0, mastered: 0, locked: 3 });
    await setToday(q, "2026-10-21");                            // 마감 당일 = 아직 닫힘
    assertEquals((await list(q)).rounds[0].exams[0].locked, true);
    await setToday(q, "2026-10-22");
    ex = (await list(q)).rounds[0].exams[0];
    assertEquals([ex.locked, ex.items.length, "lockedCount" in ex], [false, 3, false]);
    await as(q, "민수");
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-25\"}'::jsonb)", [node]);
    await as(q, "지은");
    v = await list(q);
    ex = v.rounds[0].exams[0];
    assertEquals([ex.locked, "items" in ex, ex.unlockDate], [true, false, "2026-10-25"]);
  } },
  { name: "list: locked perfect attempt omitted", run: async (q) => {
    const node = await published(q, { ...Q4, reveal: "after_deadline" });
    await takeAs(q, "철수", node, [0, [0, 2], false, "IGW"]);
    const v = await list(q);
    assertEquals([v.rounds, v.totals.locked], [[], 0]);
  } },
  { name: "list: order — rounds by round sort_order · exams by tree order · archived leaf omitted", run: async (q) => {
    const a = await published(q, Q4, "3주차 정리 시험");
    const b = await published(q, Q4, "3주차 보충 시험");
    await takeAs(q, "지은", b, JIEUN);
    await takeAs(q, "지은", a, JIEUN);
    let v = await list(q);
    assertEquals(v.rounds.length, 1);
    // 같은 묶음의 형제 — sort_order 순(먼저 만든 a 가 앞)
    const so = await q("select id::text as id, sort_order from public.goal_nodes where id in ($1::bigint, $2::bigint) order by sort_order, id", [a, b]);
    assertEquals(v.rounds[0].exams.map((e: Row) => e.nodeId), so.map((r) => r.id));
    assertEquals(v.totals.wrong, 6);
    await as(q, "민수");
    await q("select public.node_archive('aws', $1::bigint)", [a]);
    await as(q, "지은");
    v = await list(q);
    assertEquals(v.rounds[0].exams.map((e: Row) => e.nodeId), [b]);
    assertEquals(v.totals.wrong, 3);
  } },
  { name: "list: editor gets no bypass — own locked exam stays locked", run: async (q) => {
    const node = await published(q, { ...Q4, reveal: "after_deadline" });
    await takeAs(q, "민수", node, JIEUN);                        // 그룹장도 담당자 — 자기 응시
    const ex = (await list(q)).rounds[0].exams[0];
    assertEquals([ex.locked, "items" in ex], [true, false]);
  } },
  { name: "list: non-member ROOM_NOT_FOUND · unknown room · pending viewer · anon AUTH_REQUIRED", run: async (q) => {
    await as(q, "지훈");                                         // spring 그룹장, aws 비멤버(aws 는 공개 방)
    await failCode(list(q), "ROOM_NOT_FOUND");
    await failCode(list(q, "no-such-room"), "ROOM_NOT_FOUND");
    await as(q, "철수");                                         // sqld 승인 대기
    const p = await list(q, "sqld");
    assertEquals([p.viewer, p.rounds, p.hasExam], ["pending", [], false]);
    assertEquals(p.totals, { wrong: 0, retriedOk: 0, mastered: 0, locked: 0 });
    await asAnon(q);
    await failCode(list(q), "AUTH_REQUIRED");
  } },
  { name: "list: INACTIVE member still sees own note (D16) · ended room readable", run: async (q) => {
    const node = await published(q);
    await takeAs(q, "지은", node, JIEUN);
    await q("update public.room_members set status = 'INACTIVE' where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')", [await uidOf(q, "지은")]);
    await q("update public.rooms set status = 'ENDED' where slug = 'aws'");
    assertEquals((await list(q)).rounds[0].exams[0].items.length, 3);
  } },
]);

cases("wrong note 0046 · mine", db, [
  { name: "mine: all my rooms · same rounds as list · tone/title/status = me_tasks · id order · no pending/archived · anon", run: async (q) => {
    const node = await published(q);
    await takeAs(q, "철수", node, JIEUN);
    const m = await mine(q);
    const tasks = await rpc(q, "public.me_tasks()");
    // 철수: docker(그룹장) · aws · algo · spring — sqld(PENDING) 없음. INACTIVE 가 없으니 me_tasks 의 방과 같다
    assertEquals(m.studies.map((s: Row) => s.slug), tasks.studies.map((s: Row) => s.slug));
    assertEquals(m.studies.some((s: Row) => s.slug === "sqld"), false);
    for (const s of m.studies) {
      const t = tasks.studies.find((x: Row) => x.slug === s.slug);
      assertEquals([s.title, s.tone, s.status], [t.title, t.tone, t.status], s.slug);
    }
    const ids = await q("select r.slug from public.rooms r where r.slug = any($1::text[]) order by r.id", [m.studies.map((s: Row) => s.slug)]);
    assertEquals(m.studies.map((s: Row) => s.slug), ids.map((r) => r.slug));
    const aws = m.studies.find((s: Row) => s.slug === "aws");
    const l = await list(q);
    assertEquals(aws.rounds, l.rounds);                          // 같은 내부 함수(deepEqual)
    assertEquals(aws.totals, l.totals);
    assertEquals([aws.hasExam, aws.totals.wrong], [true, 3]);
    const spring = m.studies.find((s: Row) => s.slug === "spring");
    assertEquals([spring.hasExam, spring.rounds, spring.totals.wrong], [false, [], 0]);
    assertEquals(typeof m.today, "string");
    // 보관 방은 빠진다
    await q("update public.rooms set archived_at = now() where slug = 'spring'");
    assertEquals((await mine(q)).studies.some((s: Row) => s.slug === "spring"), false);
    await asAnon(q);
    await failCode(mine(q), "AUTH_REQUIRED");
  } },
  { name: "mine: INACTIVE member's room included (D18) · locked same as list", run: async (q) => {
    const node = await published(q, { ...Q4, reveal: "after_deadline" });
    await takeAs(q, "지은", node, JIEUN);
    await q("update public.room_members set status = 'INACTIVE' where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')", [await uidOf(q, "지은")]);
    const aws = (await mine(q)).studies.find((s: Row) => s.slug === "aws");
    assert(aws, "INACTIVE 방 포함");
    assertEquals(aws.rounds, (await list(q)).rounds);
    assertEquals([aws.rounds[0].exams[0].locked, "items" in aws.rounds[0].exams[0], aws.totals.locked], [true, false, 3]);
  } },
]);

cases("wrong note 0046 · practice & master", db, [
  { name: "practice: grades via exam_grade · counts · canon · batch", run: async (q) => {
    const node = await published(q);
    const [q1, q2, q3, q4] = await qids(q, node);
    await takeAs(q, "지은", node, [1, [0], null, "x"]);          // 전부 오답
    let r = await practice(q, [{ questionId: q4, answer: " IGW! " }]);
    assertEquals(Object.keys(r.results), [q4]);
    assertEquals(r.results[q4].correct, true);                   // exam_norm
    assertEquals([r.results[q4].practice.correctCount, r.results[q4].practice.wrongCount, r.results[q4].practice.lastCorrect], [1, 0, true]);
    assertEquals(r.results[q4].practice.lastAnswer, " IGW! ");
    assert(/Z$/.test(r.results[q4].practice.lastAt));
    assertEquals("totals" in r, false);                          // D21
    r = await practice(q, [{ questionId: q2, answer: [0] }]);   // 부분 선택 = 오답
    assertEquals([r.results[q2].correct, r.results[q2].practice.wrongCount], [false, 1]);
    r = await practice(q, [{ questionId: q2, answer: [2, 0, 0] }]);   // 중복·순서 → canon [0,2]
    assertEquals([r.results[q2].correct, r.results[q2].practice.correctCount, r.results[q2].practice.wrongCount], [true, 1, 1]);
    assertEquals(r.results[q2].practice.lastAnswer, [0, 2]);
    const ox = (await one(q, "select (public.exam_grade(q, 'true'::jsonb)).correct as v from public.exam_questions q where id = $1::bigint", [q3])).v;
    r = await practice(q, [{ questionId: q3, answer: true }]);
    assertEquals(r.results[q3].correct, ox);
    r = await practice(q, [{ questionId: q1, answer: "" }]);    // 빈 답 = 오답(모양 검사 안 함)
    assertEquals([r.results[q1].correct, r.results[q1].practice.lastAnswer], [false, null]);
    r = await practice(q, [{ questionId: q1, answer: 0.0 }, { questionId: q4, answer: "nat" }]);
    assertEquals(Object.keys(r.results).sort(), [q1, q4].sort());
    assertEquals([r.results[q1].correct, r.results[q1].practice.lastAnswer], [true, 0]);
    assertEquals([r.results[q4].correct, r.results[q4].practice.correctCount, r.results[q4].practice.wrongCount, r.results[q4].practice.lastCorrect], [false, 1, 1, false]);
    // 목록에 반영
    const items = (await list(q)).rounds[0].exams[0].items as Row[];
    assertEquals(items.find((i) => i.question.id === q2)!.practice.lastCorrect, true);
    assertEquals((await list(q)).totals, { wrong: 4, retriedOk: 2, mastered: 0, locked: 0 });   // q1·q2 맞힘, q3(ox true)는 오답
  } },
  { name: "practice: input validation — 1~50 · questionId string · answer shape · whole batch rolls back", run: async (q) => {
    const node = await published(q);
    const [q1, q2] = await qids(q, node);
    await takeAs(q, "지은", node, JIEUN);
    assertEquals((await failCode(practice(q, []), "VALIDATION_FAILED")).field, "answers");
    await failCode(practice(q, Array.from({ length: 51 }, () => ({ questionId: q1, answer: 0 }))), "VALIDATION_FAILED");
    await failCode(rpc(q, "public.wrong_note_practice('aws', '{}'::jsonb)"), "VALIDATION_FAILED");
    assertEquals((await failCode(practice(q, [{ questionId: q1, answer: 0 }, { questionId: q1, answer: 1 }]), "VALIDATION_FAILED")).field, "answers");   // 같은 문항 두 번
    assertEquals((await failCode(practice(q, [{ questionId: Number(q1) as unknown as string, answer: 0 }]), "VALIDATION_FAILED")).field, "questionId");
    assertEquals((await failCode(practice(q, [{ questionId: q1, answer: 9 }]), "VALIDATION_FAILED")).questionId, q1);
    await failCode(practice(q, [{ questionId: q2, answer: "x" }]), "VALIDATION_FAILED");
    // 앞 문항은 맞는 답이어도 뒤가 실패하면 기록이 없다
    await failCode(practice(q, [{ questionId: q1, answer: 0 }, { questionId: q2, answer: 7 }]), "VALIDATION_FAILED");
    assertEquals((await one(q, "select count(*)::int as c from public.exam_practice")).c, 0);
  } },
  { name: "practice: official records unchanged (attempts · answers · submissions · exams)", run: async (q) => {
    const node = await published(q);
    const [q1, q2, q3] = await qids(q, node);
    await takeAs(q, "지은", node, JIEUN);
    const snap = async () => JSON.stringify([
      await q("select id, status, score, max_score, correct_count, submitted_at from public.exam_attempts order by id"),
      await q("select attempt_id, question_id, answer, is_correct, earned, saved_at from public.exam_answers order by attempt_id, question_id"),
      await q("select * from public.submissions where node_id = $1::bigint order by id", [node]),
      await q("select * from public.exams where node_id = $1::bigint", [node]),
    ]);
    const before = await snap();
    await setNow(q, "2026-10-17T09:00:00+09:00");
    await practice(q, [{ questionId: q1, answer: 0 }]);
    await practice(q, [{ questionId: q2, answer: [0, 2] }, { questionId: q3, answer: false }]);
    await master(q, q1, true);
    assertEquals(await snap(), before);
  } },
  { name: "practice: NOT_IN (correct question · other's wrong · unsubmitted · archived) · LOCKED · other room NODE_NOT_FOUND · non-member", run: async (q) => {
    const node = await published(q);
    const [q1, , , q4] = await qids(q, node);
    await takeAs(q, "철수", node, [1, [0, 2], false, "IGW"]);    // 철수 1번 오답
    await takeAs(q, "지은", node, JIEUN);                        // 지은 4번 정답
    assertEquals((await failCode(practice(q, [{ questionId: q4, answer: "IGW" }]), "WRONG_NOTE_NOT_IN")).questionId, q4);
    await as(q, "철수");
    await failCode(practice(q, [{ questionId: q4, answer: "IGW" }]), "WRONG_NOTE_NOT_IN");   // 철수는 4번을 맞혔다
    await practice(q, [{ questionId: q1, answer: 0 }]);                                      // 자기 오답은 된다
    await as(q, "하나");                                                                      // 미제출
    await failCode(practice(q, [{ questionId: q1, answer: 0 }]), "WRONG_NOTE_NOT_IN");
    await failCode(master(q, q1, true), "WRONG_NOTE_NOT_IN");
    await as(q, "철수");                                                                      // 철수는 spring 멤버 — 다른 방 slug
    await failCode(practice(q, [{ questionId: q1, answer: 0 }], "spring"), "NODE_NOT_FOUND");
    await failCode(practice(q, [{ questionId: "999999999", answer: 0 }]), "NODE_NOT_FOUND");
    await as(q, "지훈");                                                                      // aws 비멤버
    await failCode(practice(q, [{ questionId: q1, answer: 0 }]), "ROOM_NOT_FOUND");
    await failCode(master(q, q1, true), "ROOM_NOT_FOUND");
    // 잠긴 시험(after_deadline 마감 전)
    const lockedNode = await published(q, { ...Q4, reveal: "after_deadline" }, "3주차 마감 시험");
    const [l1, , , l4] = await qids(q, lockedNode);
    await takeAs(q, "지은", lockedNode, JIEUN);
    assertEquals((await failCode(practice(q, [{ questionId: l1, answer: 0 }]), "WRONG_NOTE_LOCKED")).unlockDate, "2026-10-21");
    await failCode(master(q, l1, true), "WRONG_NOTE_LOCKED");
    // 공개 전엔 맞힌 문항(4번)도 LOCKED — 코드 차이로 문항별 정오가 새지 않는다(D3)
    await failCode(practice(q, [{ questionId: l4, answer: "IGW" }]), "WRONG_NOTE_LOCKED");
    await failCode(master(q, l4, true), "WRONG_NOTE_LOCKED");
    // 묶음 안에 잠긴 문항이 하나라도 있으면 전부 롤백
    await failCode(practice(q, [{ questionId: q1, answer: 0 }, { questionId: l1, answer: 0 }]), "WRONG_NOTE_LOCKED");
    assertEquals((await one(q, "select count(*)::int as c from public.exam_practice where user_id = $1::uuid", [await uidOf(q, "지은")])).c, 0);
    await setToday(q, "2026-10-22");
    assertEquals((await practice(q, [{ questionId: l1, answer: 0 }])).results[l1].correct, true);
    await failCode(practice(q, [{ questionId: l4, answer: "IGW" }]), "WRONG_NOTE_NOT_IN");   // 공개 뒤엔 맞힌 문항 = 노트에 없음
    await failCode(master(q, l4, true), "WRONG_NOTE_NOT_IN");
    // 보관된 리프 = 노트에 없음
    await as(q, "민수");
    await q("select public.node_archive('aws', $1::bigint)", [lockedNode]);
    await as(q, "지은");
    await failCode(practice(q, [{ questionId: l1, answer: 0 }]), "WRONG_NOTE_NOT_IN");
  } },
  { name: "master: on/off · list reflects · survives practice · no totals in response", run: async (q) => {
    const node = await published(q);
    const [q1, q2] = await qids(q, node);
    await takeAs(q, "지은", node, JIEUN);
    const r = await master(q, q1, true);
    assertEquals(r, { mastered: true });
    let v = await list(q);
    const it = (v.rounds[0].exams[0].items as Row[]).find((i) => i.question.id === q1)!;
    assertEquals([it.mastered, it.practice], [true, null]);      // 외웠어요만 → 연습 기록은 없다
    assertEquals(v.totals, { wrong: 3, retriedOk: 0, mastered: 1, locked: 0 });
    await practice(q, [{ questionId: q1, answer: 1 }]);
    assertEquals((await one(q, "select mastered_at is not null as v from public.exam_practice where question_id = $1::bigint", [q1])).v, true);
    await practice(q, [{ questionId: q2, answer: [0, 2] }]);
    assertEquals(await master(q, q2, true), { mastered: true });
    const p2 = await one(q, "select correct_count, wrong_count, last_correct from public.exam_practice where question_id = $1::bigint", [q2]);
    assertEquals([p2.correct_count, p2.wrong_count, p2.last_correct], [1, 0, true]);   // 외움이 연습 기록을 지우지 않는다
    assertEquals(await master(q, q1, false), { mastered: false });
    assertEquals((await one(q, "select mastered_at from public.exam_practice where question_id = $1::bigint", [q1])).mastered_at, null);
    v = await list(q);
    assertEquals(v.totals, { wrong: 3, retriedOk: 1, mastered: 1, locked: 0 });
    await failCode(rpc(q, "public.wrong_note_master('aws', $1::bigint, null)", [q1]), "VALIDATION_FAILED");
  } },
  { name: "cascade: question removed → practice row gone", run: async (q) => {
    const node = await published(q);
    const [q1] = await qids(q, node);
    await takeAs(q, "지은", node, JIEUN);
    await practice(q, [{ questionId: q1, answer: 0 }]);
    assertEquals((await one(q, "select count(*)::int as c from public.exam_practice where question_id = $1::bigint", [q1])).c, 1);
    await q("delete from public.exam_questions where id = $1::bigint", [q1]);
    assertEquals((await one(q, "select count(*)::int as c from public.exam_practice where question_id = $1::bigint", [q1])).c, 0);
    await expectFail(practice(q, [{ questionId: q1, answer: 0 }]), "NODE_NOT_FOUND");
  } },
]);

// ── 0051 다시 볼 문제(★) ──
const bookmark = (q: Q, qid: string, on: boolean, slug = "aws") => rpc(q, "public.wrong_note_bookmark($1, $2::bigint, $3)", [slug, qid, on]);
const itemOf = (v: Row, qid: string) => (v.rounds[0].exams[0].items as Row[]).find((i) => i.question.id === qid)!;

cases("wrong note 0051 · bookmark", db, [
  { name: "bookmark: table closed · RLS on · RPC authenticated only", run: async (q) => {
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert", "update", "delete"]) {
      assertEquals((await one(q, "select has_table_privilege($1, 'public.exam_bookmark', $2) as v", [role, priv])).v, false, `${role} ${priv}`);
    }
    assertEquals((await one(q, "select relrowsecurity as v from pg_class where oid = 'public.exam_bookmark'::regclass")).v, true);
    const can = async (role: string) => (await one(q, "select has_function_privilege($1, 'public.wrong_note_bookmark(text,bigint,boolean)', 'execute') as v", [role])).v;
    assertEquals([await can("authenticated"), await can("anon")], [true, false]);
  } },
  { name: "bookmark: on/off idempotent · independent of practice/master · list & mine reflect · totals unchanged", run: async (q) => {
    const node = await published(q);
    const [q1, q2] = await qids(q, node);
    await takeAs(q, "지은", node, JIEUN);
    assertEquals(itemOf(await list(q), q1).bookmarked, false);
    assertEquals(await bookmark(q, q1, true), { bookmarked: true });
    assertEquals(await bookmark(q, q1, true), { bookmarked: true });          // 멱등
    assertEquals((await one(q, "select count(*)::int as c from public.exam_bookmark")).c, 1);
    await master(q, q1, true);
    await practice(q, [{ questionId: q1, answer: 0 }]);                         // 다시 풀어 맞힘 + 외움이어도 ★ 유지
    let v = await list(q);
    assertEquals([itemOf(v, q1).bookmarked, itemOf(v, q1).mastered, itemOf(v, q2).bookmarked], [true, true, false]);
    assertEquals(v.totals, { wrong: 3, retriedOk: 1, mastered: 1, locked: 0 });  // 합계 모양은 0046 그대로
    const aws = (await mine(q)).studies.find((s: Row) => s.slug === "aws");
    assertEquals(aws.rounds, v.rounds);
    assertEquals(await bookmark(q, q1, false), { bookmarked: false });
    assertEquals(await bookmark(q, q1, false), { bookmarked: false });
    v = await list(q);
    assertEquals(itemOf(v, q1).bookmarked, false);
    await failCode(rpc(q, "public.wrong_note_bookmark('aws', $1::bigint, null)", [q1]), "VALIDATION_FAILED");
  } },
  { name: "bookmark: per user — others can't see or toggle mine · NOT_IN for correct/other's question · anon", run: async (q) => {
    const node = await published(q);
    const [q1, , , q4] = await qids(q, node);
    await takeAs(q, "지은", node, JIEUN);
    await takeAs(q, "철수", node, [0, [0, 2], false, null]);                  // 철수: 4번만 미답
    await as(q, "지은");
    await bookmark(q, q1, true);
    await failCode(bookmark(q, q4, true), "WRONG_NOTE_NOT_IN");                // 맞힌 문항
    await as(q, "철수");
    assertEquals(itemOf(await list(q), q4).bookmarked, false);
    assertEquals(JSON.stringify(await list(q)).includes('"bookmarked":true'), false);
    await failCode(bookmark(q, q1, true), "WRONG_NOTE_NOT_IN");                // 철수는 1번을 맞혔다 — 남의 오답
    await failCode(bookmark(q, q1, false), "WRONG_NOTE_NOT_IN");
    assertEquals((await one(q, "select count(*)::int as c from public.exam_bookmark where question_id = $1::bigint", [q1])).c, 1);  // 지은 것 그대로
    await as(q, "지훈");                                                       // 비멤버
    await failCode(bookmark(q, q1, true), "ROOM_NOT_FOUND");
    await asAnon(q);
    await failCode(bookmark(q, q1, true), "AUTH_REQUIRED");
  } },
  { name: "bookmark: locked before reveal — LOCKED (same code for wrong & correct) · no bookmarked/items leak · relock hides", run: async (q) => {
    const node = await published(q, { ...Q4, reveal: "after_deadline" });
    const [q1, , , q4] = await qids(q, node);
    await takeAs(q, "지은", node, JIEUN);
    await setToday(q, "2026-10-20");
    await failCode(bookmark(q, q1, true), "WRONG_NOTE_LOCKED");
    await failCode(bookmark(q, q4, true), "WRONG_NOTE_LOCKED");                // 맞힌 문항도 같은 코드 — 정오가 새지 않는다
    assertEquals((await one(q, "select count(*)::int as c from public.exam_bookmark")).c, 0);
    await setToday(q, "2026-10-22");
    await bookmark(q, q1, true);
    assertEquals(itemOf(await list(q), q1).bookmarked, true);
    // 마감 연장으로 다시 잠기면 items 째 빠진다 — ★ 도 안 보인다
    await as(q, "민수");
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-30\"}'::jsonb)", [node]);
    await as(q, "지은");
    const ex = (await list(q)).rounds[0].exams[0];
    assertEquals([ex.locked, "items" in ex, JSON.stringify(ex).includes("bookmarked")], [true, false, false]);
  } },
  { name: "bookmark: leaving room hides (row kept) · rejoin restores · question removed → cascade", run: async (q) => {
    const node = await published(q);
    const [q1] = await qids(q, node);
    await takeAs(q, "지은", node, JIEUN);
    await bookmark(q, q1, true);
    const uid = await uidOf(q, "지은");
    const room = "(select id from public.rooms where slug = 'aws')";
    await q(`update public.room_members set status = 'CANCELED' where user_id = $1::uuid and room_id = ${room}`, [uid]);
    assertEquals((await mine(q)).studies.some((s: Row) => s.slug === "aws"), false);
    await failCode(bookmark(q, q1, false), "ROOM_NOT_FOUND");
    assertEquals((await one(q, "select count(*)::int as c from public.exam_bookmark where user_id = $1::uuid", [uid])).c, 1);
    await q(`update public.room_members set status = 'ACTIVE' where user_id = $1::uuid and room_id = ${room}`, [uid]);
    assertEquals(itemOf(await list(q), q1).bookmarked, true);
    await q("delete from public.exam_questions where id = $1::bigint", [q1]);
    assertEquals((await one(q, "select count(*)::int as c from public.exam_bookmark where question_id = $1::bigint", [q1])).c, 0);
  } },
]);
