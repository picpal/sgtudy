# 회차 시험(수동 출제 · AI 생성) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회차(·묶음) 아래 "과제 추가" 에서 **시험**을 고를 수 있다. 편집자가 문제·정답·해설을 직접 쓰거나(수동) 브리프를 적어 사용자의 AI(MCP)가 초안을 넣게 하고(AI), 검토 뒤 **발행**한다. 담당자는 기간 안에 풀고 중간 저장·제출하며, **서버가 채점**해 점수·정오·해설을 보여 준다(공개 시점은 출제자 선택). 그룹장·편집자는 응시 현황·문항별 정답률·멤버별 답안을 본다. 시험 제출 = 과제 제출(submissions 1행)이라 달성률·알림·내 일정은 무변경.

**Architecture:** DB = 마이그레이션 1개 `0037_round_exam.sql`(추가형). 표 4개(`exams`·`exam_questions`·`exam_attempts`·`exam_answers`, RLS on·정책 없음) + 트리거 2개(`exams_guard_leaf`·`submissions_guard_exam`) + RPC 9개 + `api_invoke` op 2개. 리프는 COMMON/DESIGNATED 그대로(스펙 D1) — 재정의는 `curriculum_json`·`task_node_json`(리프 `exam` 요약) · `notification_kinds`·`notify_render`·`notify_link`(`EXAM_PUBLISHED`) · `api_scope_of`·`api_invoke`(op 추가) 7개뿐. 웹 = 어댑터·순수 로직 `src/lib/api/exam.ts` + `src/components/my-study/exam.ts` → `QuickAdd` 종류 세그먼트 → `EditView` 「문제」 섹션(`ExamEditor`: 수동 탭·AI 탭) → `LeafBody` 가 시험 리프면 `ExamSection`(응시·결과) → 편집자 `ExamResults`. MCP 도구 2개는 AI 플랜 Task 8 뒤(Task 11).

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase PG17(plpgsql `security definer set search_path=''`, `public.fail`) · vitest(`src/**/*.test.ts`, DOM 은 `// @vitest-environment jsdom` + `renderToStaticMarkup`) · deno + PGlite SQL 테스트(`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-21-round-exam-design.md`. 스펙 §8 D1~D14 는 **권장안 기준(사용자 승인 대기)**. 승인 때 바뀌는 결정은 맨 끝 "결정에 따른 변경" 표를 따라 해당 Task 만 고친다.

## 번호 (중요)

- 호스티드 DB 는 **0036** 까지 적용됨(`0036_security_hardening.sql`, 커밋 `0c4f6d1`). 이 기능은 **`0037_round_exam.sql`** 하나.
- AI 플랜(0033~0035)은 DB 쪽이 끝났고 웹(Task 7~10, `/api/mcp`·`src/lib/mcp/*`)은 아직 없다. 이 플랜의 Task 11(MCP 도구)은 AI 플랜 Task 8 이 만든 `src/lib/mcp/tools.ts` 에 **추가**하는 작업이라 그 뒤에만 한다. Task 1~10 은 독립.
- 재정의 복사 원본(Task 0 Step 2 로 확정): `curriculum_json` ←0032 · `task_node_json` ←0024 · `notification_kinds`·`notify_render`·`notify_link` ←0034 · `api_scope_of` ←0033 · `api_invoke` ←0035(커밋 `d786c54` 반영된 현재 파일).

## Global Constraints

- 마이그레이션은 **`0037_round_exam.sql` 하나만**. 0001~0036 수정 금지. Task 0 에서 `0037_*` 가 이미 있으면 멈추고 번호를 컨트롤러와 다시 정한다.
- **재정의는 최신 판 복사 후 표시한 곳만 고친다.** `create or replace` 는 이름·인자명·기본값 동일 → GRANT 유지. 재정의 목록 밖의 함수(`node_create_core`·`node_create`·`node_update`·`node_delete`·`node_archive`·`node_make_parent`·`submission_upsert`·`submission_target`·`file_register`·`task_get`·`assignment_resync`·`room_progress`·`room_leaf_stats`·`me_schedule_leaves`·`me_tasks`·`job_*`·`api_rate_check`·`api_limits`)는 **재정의 금지** — 트리거·조인으로 흡수한다.
- 새 plpgsql 함수: `security definer set search_path = ''`, 객체는 `public.` 접두, 실패는 `perform public.fail(code, 한국어 문구, details)`. 공개 RPC 만 GRANT(`authenticated`). 내부 헬퍼는 0002 기본 권한으로 닫혀 있다 — 아무것도 하지 않는다. 표 4개는 `revoke all … from anon, authenticated`.
- **정답·해설 노출 규칙(스펙 §3.4)은 `exam_view` 한 곳**에서만 판정한다. 다른 함수는 `exam_view` 를 부른다. 숨길 때는 **키를 만들지 않는다**(null 이 아니라 키 없음).
- **채점은 `exam_submit` 안에서만**(`exam_grade`). `exam_answer_save` 는 모양 검사만. 점수·정오를 받는 RPC 인자는 없다.
- 시험 리프의 submissions 행은 `exam_submit` 만 만든다(`sgtudy.exam_submit` 트랜잭션 설정 + 트리거). 일반 제출 경로는 `EXAM_NODE`.
- 시간: 날짜는 `public.kst_today()`(테스트 `app.today`), 시각은 `public.app_now()`(테스트 `app.now`). 지각 = `app_now() >= kst_deadline(end_date)`(0022 와 동일).
- 잠금 순서: 방 행(`room_lock` — `node_assert_editable`·`exam_target` 이 잡는다) → 응시 행(`for update`). 사용자 advisory 잠금은 `api_invoke` 가 이미 잡는다.
- SQL 테스트는 `supabase/tests/*-sql.test.ts`(deno + PGlite, `_harness.ts`·`_fixtures.ts`·`_submit.ts`). 각 case 는 롤백된다. 시드 기준일 `2026-10-12`. 시험 시드는 만들지 않는다(테스트가 `aws` 3주차 `ALB vs NLB 실습`(COMMON, 10/15~10/21, 담당 민수·지은·철수·하나) 옆에 직접 만든다).
- 문구는 스펙 §4 그대로(한국어). 사용자 용어 "시험", "문항", "발행", "초안", "응시", "제출", "해설", "브리프".
- 한 페이지 스크롤: 새 안쪽 스크롤러 금지. 버튼·보기 행 ≥ 44px(`h-11`/`min-h-11`). 확인 폭 390 / 820 / 1440, 가로 스크롤 없음. 응시 화면 하단 고정 막대는 `sticky bottom-0`(DetailView 의 상단 `sticky top-0` 막대와 같은 방식).
- Supabase 는 `src/lib/api/*` 에서만 import. **새 npm 의존성 금지**(서버 Claude API 는 2단계 — 이 플랜에 없다). 새 Next API 를 쓰지 않는다. 다르게 써야 하면 먼저 `node_modules/next/dist/docs/` 해당 문서를 읽는다(AGENTS.md).
- 서브에이전트 금지(각 작업자 스스로 실행).
- 메모리: dev 서버·빌드 전에 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나, 끝나면 종료. dev 서버는 `npx next dev -p 3700`(먼저 `lsof -iTCP:3700 -sTCP:LISTEN -P`).
- 브라우저 확인은 `ego-browser` 스킬(자기 창). claude-in-chrome 금지. 쿠키/스토리지 삭제 금지.
- 호스티드 Supabase·Vercel 은 건드리지 않는다(`supabase db push` 는 사용자 승인 후 사용자가).
- 커밋 전 게이트: `npm run lint && npx tsc --noEmit && npx vitest run` (+ SQL 작업은 `npm run test:db`). 커밋은 `git commit -- <paths>` 로 자기 파일만(`.superpowers/`·`.context/`·`AGENTS.md`·`docs/00-initial-planning.md` 금지). 메시지 끝:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- 줄 번호는 작성 시점 기준 — 인용한 코드 조각으로 위치를 찾는다.

## Review Focus

1. **정답이 새지 않는다** — 제출 전 담당자·담당 아닌 멤버·익명의 `exam_get` 응답과 `curriculum_json`·`task_get` 응답 어디에도 `answer`·`explanation`·`results` **키가 없다**. 표 4개에 anon/authenticated SELECT 권한이 없다. → Task 1·2·3 테스트.
2. **채점은 서버** — `exam_answer_save` 에 점수 인자가 없고, `exam_submit` 이 `exam_grade` 로 채점·`max_score` 는 발행 시점 문항 합. 단답 정규화(`exam_norm`)·복수 전부 일치·OX 불리언. → Task 2.
3. **제출 = 과제 완료** — `exam_submit` 뒤 `room_progress`·`task_code`·`me_schedule` 이 다른 과제와 같은 값을 준다. `is_late` 규칙 동일. 전원 제출 알림(IMMEDIATE) 동일. → Task 2.
4. **우회 금지** — 시험 리프에 `submission_upsert`·`file_register` → `EXAM_NODE`. 일반 리프에 `exam_answer_save` → `EXAM_NOT_FOUND`. 시험 리프 아래 `node_create` → `EXAM_NODE`. → Task 1·2.
5. **잠금** — 제출 1건 뒤 `exam_put` 구조 변경은 `EXAM_LOCKED`, 문구·해설·`reveal` 은 허용. `exam_unpublish`·`exam_draft_put` 거부. → Task 1·4.
6. **공개 시점** — `after_deadline` 은 `kst_today() > end_date` 로만 판정. 기간 연장 → 다시 닫힘. 마감 뒤엔 미제출자도 해설을 본다. → Task 2.
7. **1인 1응시 · 동시성** — `exam_submit` 은 방 잠금 안에서 attempt `for update` + `IN_PROGRESS` 재검사. 두 번째 호출 `EXAM_ALREADY_SUBMITTED`. → Task 2.
8. **재정의 원본** — 7개 함수를 실제 최신 판에서 복사했는가(Task 0 Step 2). `api_invoke` 의 감사 insert 에 문항 본문이 들어가지 않는가(`questionCount` 만). → Task 3·4.
9. **화면 = 서버** — 응시 화면의 "답함 n/총" 과 저장 응답 `answered` 가 같다. 결과 화면이 `results` 없이도(마감 전 `after_deadline`) 점수만 그린다. → Task 5·9.
10. **편집 미저장 가드** — 문항 수정(`examDirty`)이 탭·뒤로 가기·다른 항목 이동에서 "저장하지 않은 수정이 있어요" 를 띄운다(기존 `S.uploading` 과 같은 경로). → Task 7.
11. **AI 경로 두 갈래** — MCP 없이도 "JSON 붙여넣기" 로 §3.2 계약이 검증돼 수동 탭 문항이 된다. `exam_draft_put` 은 PUBLISHED·잠김 거부. → Task 4·8.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음 (읽기만)

- [ ] **Step 1: 작업 트리·번호**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && git status --short && ls supabase/migrations | tail -3`
Expected: `supabase/migrations/**`·`supabase/tests/**`·`src/lib/api/**`·`src/components/my-study/**` 에 커밋 안 된 변경 없음(`.context/`·`docs/00-initial-planning.md` 는 무시). 마지막 파일이 `0036_security_hardening.sql`. `0037_*` 없음. 다르면 멈추고 보고.

- [ ] **Step 2: 복사 원본 확정**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && for f in curriculum_json task_node_json notification_kinds notify_render notify_link api_scope_of api_invoke node_make_parent submission_target submission_upsert node_assert_editable is_task_assignee room_leaf_stats; do echo "$f: $(grep -lE "create (or replace )?function public\.$f\(" supabase/migrations/*.sql | sort | tail -1 | xargs basename)"; done`
Expected: `curriculum_json: 0032…` · `task_node_json: 0024…` · `notification_kinds/notify_render/notify_link: 0034…` · `api_scope_of: 0033…` · `api_invoke: 0035…` · `node_make_parent: 0006…`(재정의 안 함 — 확인만) · `submission_target: 0007…` · `submission_upsert: 0022…` · `node_assert_editable: 0011…` · `is_task_assignee: 0014…` · `room_leaf_stats: 0014…`. 다르면 그 파일 판을 원본으로 쓰고 컨트롤러에 알린다.

- [ ] **Step 3: AI 웹 쪽 유무**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && ls src/lib/mcp src/app/api 2>&1 | head`
Expected: 둘 다 "No such file" → Task 11 은 보류(AI 플랜 Task 8 뒤). 있으면 Task 11 을 그 파일 기준으로 진행.

- [ ] **Step 4: 게이트 기준선**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 모두 통과(env 없이 돌리면 `*-db.test.ts` 는 ignored). 실패하면 멈추고 보고.

---

### Task 1: 0037 (1/4) — 스키마 · 계약 검증 · 출제 RPC(`exam_put`·`exam_publish`·`exam_unpublish`·`exam_brief_put`) · 가드 트리거 (opus)

**Files:**
- Create: `supabase/migrations/0037_round_exam.sql`
- Create: `supabase/tests/round-exam-sql.test.ts`

**Interfaces (이 Task 가 만드는 것):**
- 표 `exams` · `exam_questions` · `exam_attempts` · `exam_answers`(아래 DDL), RLS on, 권한 회수
- 트리거 `trg_exams_guard_leaf`(goal_nodes before update of task_type) · `trg_submissions_guard_exam`(submissions before insert)
- 내부 `exam_norm(text) → text`(immutable) · `exam_validate(jsonb) → jsonb`(정규화 문항 배열 `[{type,prompt,choices,answer,explanation,points}]`) · `exam_struct_key(jsonb) → text`(구조 비교용) · `exam_replace_questions(bigint, jsonb)` · `exam_submitted_count(bigint) → int` · `exam_lock_check(n, new_qs)` · `exam_row(bigint) → public.exams`
- RPC `exam_put(p_slug text, p_node bigint, p_exam jsonb) → jsonb` · `exam_publish(p_slug, p_node)` · `exam_unpublish(p_slug, p_node)` · `exam_brief_put(p_slug, p_node, p_brief jsonb)` — 모두 `exam_get` 모양(Task 2 의 `exam_view`; 이 Task 에서는 임시로 `exam_view` 의 편집자 모양 최소판을 만들고 Task 2 가 완성한다 → 아래 Step 3 의 `exam_view` 는 **Task 2 에서 다시 쓴다**, 이 Task 는 `exam_view_editor(n)` 만)

- [ ] **Step 1: 실패하는 테스트 작성** — `supabase/tests/round-exam-sql.test.ts`

```ts
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
      catch (e) { assert((e as Error).message.includes("VALIDATION_FAILED"), (e as Error).message); assert((e as Error).message.includes(field), `field ${field}: ${(e as Error).message}`); }
    };
    await bad({ choices: ["하나"] }, "choices");
    await bad({ answer: 4 }, "answer");
    await bad({ points: 11 }, "points");
    await bad({ prompt: "" }, "prompt");
    await bad({ type: "essay" }, "type");
    await expectFail(put(q, node, { questions: [{ type: "short", prompt: "x", answer: [] }] }), "VALIDATION_FAILED");
    await expectFail(put(q, node, { questions: Array.from({ length: 51 }, () => Q4.questions[2]) }), "VALIDATION_FAILED");
    await expectFail(put(q, node, { reveal: "never", questions: [] }), "VALIDATION_FAILED");
    // 0 문항 초안은 허용
    assertEquals((await put(q, node, { questions: [] })).exam.questionCount, 0);
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
    const u = await rpc(q, "public.exam_unpublish('aws', $1::bigint)", [node]);
    assertEquals(u.exam.status, "draft");
  } },
  { name: "guards: no child under exam leaf (EXAM_NODE) · no plain submission on exam leaf (EXAM_NODE) · exam_put on plain leaf creates exam", run: async (q) => {
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
  } },
  { name: "exam_brief_put: stored for editors · length limits", run: async (q) => {
    const node = await newExamLeaf(q);
    const v = await rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "IAM·VPC", theory: "IAM 정책은 …", count: 10, types: ["single", "ox"], difficulty: "normal" })]);
    assertEquals(v.exam.brief.count, 10);
    assertEquals(v.exam.brief.types, ["single", "ox"]);
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "x".repeat(201) })]), "VALIDATION_FAILED");
    await expectFail(rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "a", count: 0 })]), "VALIDATION_FAILED");
  } },
]);
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db -- --filter "0037"`
Expected: FAIL(표·함수 없음).

- [ ] **Step 3: 마이그레이션 작성(앞부분)** — `supabase/migrations/0037_round_exam.sql`

```sql
-- 0037_round_exam.sql — 2026-10-21 회차 시험(수동 출제 · AI 초안). 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-21-round-exam-design.md (D1~D14).
-- 추가형: 표 4개 + 트리거 2개 + RPC + 재정의 7개(최신 판 복사). 리프는 COMMON/DESIGNATED 그대로(D1), 제출 = submissions 1행(D2).
-- 재정의 원본: curriculum_json ←0032 · task_node_json ←0024 · notification_kinds·notify_render·notify_link ←0034 · api_scope_of ←0033 · api_invoke ←0035

-- ───────── 1. 스키마 ─────────
create table public.exams (
  node_id        bigint primary key references public.goal_nodes(id) on delete cascade,
  room_id        bigint not null references public.rooms(id) on delete cascade,
  status         varchar(10) not null default 'DRAFT',        -- DRAFT|PUBLISHED
  reveal         varchar(16) not null default 'AFTER_SUBMIT', -- AFTER_SUBMIT|AFTER_DEADLINE (D4)
  source         varchar(8)  not null default 'MANUAL',       -- MANUAL|AI (마지막으로 문항을 쓴 쪽)
  question_count int         not null default 0,
  total_points   int         not null default 0,
  brief          jsonb,                                       -- AI 브리프 {topic, theory, count, types, difficulty, note} (편집자 전용)
  published_at   timestamptz,
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  constraint ck_exams_status check (status in ('DRAFT', 'PUBLISHED')),
  constraint ck_exams_reveal check (reveal in ('AFTER_SUBMIT', 'AFTER_DEADLINE')),
  constraint ck_exams_source check (source in ('MANUAL', 'AI'))
);
create index ix_exams_room on public.exams (room_id);

create table public.exam_questions (
  id             bigint generated always as identity primary key,
  node_id        bigint not null references public.exams(node_id) on delete cascade,
  ord            int    not null,
  qtype          varchar(8) not null,                         -- SINGLE|MULTI|OX|SHORT (D5)
  prompt_md      text   not null,
  choices        jsonb,                                       -- SINGLE·MULTI: ["…"] 2~8개
  answer         jsonb  not null,                             -- SINGLE: 0 · MULTI: [0,2] · OX: true/false · SHORT: ["허용답", …]
  explanation_md text   not null default '',
  points         int    not null default 1,
  unique (node_id, ord),
  constraint ck_exam_questions_type   check (qtype in ('SINGLE', 'MULTI', 'OX', 'SHORT')),
  constraint ck_exam_questions_points check (points between 1 and 10)
);

create table public.exam_attempts (
  id            bigint generated always as identity primary key,
  node_id       bigint not null references public.exams(node_id) on delete cascade,
  user_id       uuid   not null references public.profiles(id),
  status        varchar(12) not null default 'IN_PROGRESS',   -- IN_PROGRESS|SUBMITTED (D3: 1회)
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  score         int,
  max_score     int,
  correct_count int,
  unique (node_id, user_id),
  constraint ck_exam_attempts_status check (status in ('IN_PROGRESS', 'SUBMITTED'))
);

create table public.exam_answers (
  attempt_id   bigint not null references public.exam_attempts(id) on delete cascade,
  question_id  bigint not null references public.exam_questions(id) on delete cascade,
  answer       jsonb  not null,
  is_correct   boolean,                                       -- exam_submit 만 채운다
  earned       int,
  saved_at     timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

alter table public.exams          enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts  enable row level security;
alter table public.exam_answers   enable row level security;
revoke all on public.exams, public.exam_questions, public.exam_attempts, public.exam_answers from anon, authenticated;

-- ───────── 2. 가드 트리거 ─────────
-- 시험 리프는 부모가 될 수 없다(D14) — node_make_parent 가 task_type 을 null 로 바꾸는 순간 막는다
create or replace function public.exams_guard_leaf() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.task_type is null and old.task_type is not null and exists (select 1 from public.exams x where x.node_id = new.id) then
    perform public.fail('EXAM_NODE', '시험 아래에는 항목을 둘 수 없어요', jsonb_build_object('nodeId', new.id::text));
  end if;
  return new;
end $$;
create trigger trg_exams_guard_leaf before update of task_type on public.goal_nodes
  for each row execute function public.exams_guard_leaf();

-- 시험 리프의 submissions 행은 exam_submit 만 만든다(§7-4). 일반 제출·첨부 등록은 EXAM_NODE
create or replace function public.submissions_guard_exam() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.exams x where x.node_id = new.node_id)
     and coalesce(current_setting('sgtudy.exam_submit', true), '') <> '1' then
    perform public.fail('EXAM_NODE', '시험은 문제를 풀어 제출해요', jsonb_build_object('nodeId', new.node_id::text));
  end if;
  return new;
end $$;
create trigger trg_submissions_guard_exam before insert on public.submissions
  for each row execute function public.submissions_guard_exam();

-- file_register 는 submission_target 만 거치고 submissions 를 만들지 않는다 → 시험 리프의 첨부 등록은 files 트리거로 막는다
create or replace function public.files_guard_exam() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.purpose = 'ATTACHMENT' and new.node_id is not null and exists (select 1 from public.exams x where x.node_id = new.node_id) then
    perform public.fail('EXAM_NODE', '시험에는 첨부를 올릴 수 없어요', jsonb_build_object('nodeId', new.node_id::text));
  end if;
  return new;
end $$;
create trigger trg_files_guard_exam before insert on public.files
  for each row execute function public.files_guard_exam();

-- ───────── 3. 계약 검증 (sgtudy.exam/v1, 스펙 §3.2) ─────────
create or replace function public.exam_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(lower(trim(normalize(coalesce(p, ''), NFC))), '[[:punct:]]', '', 'g'), '\s+', ' ', 'g')
$$;

-- 문항 배열 정규화. 실패는 VALIDATION_FAILED {field, index}. 반환: [{type, prompt, choices, answer, explanation, points}] (type 대문자)
create or replace function public.exam_validate(p_exam jsonb) returns jsonb
language plpgsql set search_path = '' as $$   -- fail() 을 부르므로 volatile 기본값(상수 접기 방지)
declare
  qs    jsonb;
  q     jsonb;
  i     int := 0;
  v_t   text;
  v_c   jsonb;
  v_a   jsonb;
  v_n   int;
  v_p   int;
  v_out jsonb := '[]'::jsonb;
  e     jsonb;
  j     int;
  seen  int[];
begin
  if p_exam is null or jsonb_typeof(p_exam) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '시험 내용이 올바르지 않아요', '{"field":"exam"}'::jsonb);
  end if;
  if p_exam ? 'reveal' and (p_exam ->> 'reveal') not in ('after_submit', 'after_deadline') then
    perform public.fail('VALIDATION_FAILED', '공개 시점은 after_submit 또는 after_deadline 이에요', '{"field":"reveal"}'::jsonb);
  end if;
  qs := coalesce(p_exam -> 'questions', '[]'::jsonb);
  if jsonb_typeof(qs) <> 'array' then perform public.fail('VALIDATION_FAILED', '문항은 배열이어야 해요', '{"field":"questions"}'::jsonb); end if;
  if jsonb_array_length(qs) > 50 then perform public.fail('VALIDATION_FAILED', '문항은 50개까지예요', '{"field":"questions"}'::jsonb); end if;

  for q in select * from jsonb_array_elements(qs) loop
    v_t := lower(q ->> 'type');
    if v_t not in ('single', 'multi', 'ox', 'short') then
      perform public.fail('VALIDATION_FAILED', '문항 유형은 single·multi·ox·short 예요', jsonb_build_object('field', 'type', 'index', i));
    end if;
    if length(trim(coalesce(q ->> 'prompt', ''))) < 1 or length(q ->> 'prompt') > 2000 then
      perform public.fail('VALIDATION_FAILED', '문제는 1~2,000자예요', jsonb_build_object('field', 'prompt', 'index', i));
    end if;
    if length(coalesce(q ->> 'explanation', '')) > 4000 then
      perform public.fail('VALIDATION_FAILED', '해설은 4,000자까지예요', jsonb_build_object('field', 'explanation', 'index', i));
    end if;
    v_p := coalesce((q ->> 'points')::int, 1);
    if v_p < 1 or v_p > 10 then perform public.fail('VALIDATION_FAILED', '배점은 1~10점이에요', jsonb_build_object('field', 'points', 'index', i)); end if;
    v_a := q -> 'answer';
    v_c := null;

    if v_t in ('single', 'multi') then
      v_c := q -> 'choices';
      if v_c is null or jsonb_typeof(v_c) <> 'array' or jsonb_array_length(v_c) < 2 or jsonb_array_length(v_c) > 8 then
        perform public.fail('VALIDATION_FAILED', '보기는 2~8개예요', jsonb_build_object('field', 'choices', 'index', i));
      end if;
      for e in select * from jsonb_array_elements(v_c) loop
        if jsonb_typeof(e) <> 'string' or length(trim(e #>> '{}')) < 1 or length(e #>> '{}') > 200 then
          perform public.fail('VALIDATION_FAILED', '보기는 1~200자예요', jsonb_build_object('field', 'choices', 'index', i));
        end if;
      end loop;
      v_n := jsonb_array_length(v_c);
      if v_t = 'single' then
        if v_a is null or jsonb_typeof(v_a) <> 'number' or (v_a #>> '{}')::numeric <> floor((v_a #>> '{}')::numeric)
           or (v_a #>> '{}')::int < 0 or (v_a #>> '{}')::int >= v_n then
          perform public.fail('VALIDATION_FAILED', '정답은 보기 번호(0부터) 하나예요', jsonb_build_object('field', 'answer', 'index', i));
        end if;
        v_a := to_jsonb((v_a #>> '{}')::int);
      else
        if v_a is null or jsonb_typeof(v_a) <> 'array' or jsonb_array_length(v_a) < 1 then
          perform public.fail('VALIDATION_FAILED', '정답은 보기 번호 배열이에요', jsonb_build_object('field', 'answer', 'index', i));
        end if;
        seen := '{}';
        for e in select * from jsonb_array_elements(v_a) loop
          if jsonb_typeof(e) <> 'number' or (e #>> '{}')::int < 0 or (e #>> '{}')::int >= v_n or (e #>> '{}')::int = any(seen) then
            perform public.fail('VALIDATION_FAILED', '정답 번호가 보기 범위를 벗어나거나 겹쳐요', jsonb_build_object('field', 'answer', 'index', i));
          end if;
          seen := seen || (e #>> '{}')::int;
        end loop;
        v_a := (select jsonb_agg(x order by x) from unnest(seen) x);     -- 정렬 저장(채점 비교 단순화)
      end if;
    elsif v_t = 'ox' then
      if v_a is null or jsonb_typeof(v_a) <> 'boolean' then
        perform public.fail('VALIDATION_FAILED', 'OX 정답은 true/false 예요', jsonb_build_object('field', 'answer', 'index', i));
      end if;
    else -- short
      if v_a is null or jsonb_typeof(v_a) <> 'array' or jsonb_array_length(v_a) < 1 or jsonb_array_length(v_a) > 10 then
        perform public.fail('VALIDATION_FAILED', '단답 정답은 허용 답 1~10개예요', jsonb_build_object('field', 'answer', 'index', i));
      end if;
      for e in select * from jsonb_array_elements(v_a) loop
        if jsonb_typeof(e) <> 'string' or length(public.exam_norm(e #>> '{}')) < 1 or length(e #>> '{}') > 200 then
          perform public.fail('VALIDATION_FAILED', '허용 답은 1~200자예요', jsonb_build_object('field', 'answer', 'index', i));
        end if;
      end loop;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'type', upper(v_t), 'prompt', q ->> 'prompt', 'choices', v_c, 'answer', v_a,
      'explanation', coalesce(q ->> 'explanation', ''), 'points', v_p));
    i := i + 1;
  end loop;
  return v_out;
end $$;

-- 구조 키: 유형·보기·정답·배점·순서 — 잠금 비교용(D6). prompt·explanation 은 제외
create or replace function public.exam_struct_key(p_qs jsonb) returns text
language sql immutable set search_path = '' as $$
  select md5(coalesce((select jsonb_agg(jsonb_build_array(e -> 'type', e -> 'choices', e -> 'answer', e -> 'points') order by o)
                       from jsonb_array_elements(p_qs) with ordinality x(e, o)), '[]'::jsonb)::text)
$$;

create or replace function public.exam_submitted_count(p_node bigint) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.exam_attempts a where a.node_id = p_node and a.status = 'SUBMITTED'
$$;

-- 현재 문항을 계약 모양(정답 포함, type 대문자)으로
create or replace function public.exam_questions_jsonb(p_node bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('type', q.qtype, 'prompt', q.prompt_md, 'choices', q.choices, 'answer', q.answer,
                                               'explanation', q.explanation_md, 'points', q.points) order by q.ord), '[]'::jsonb)
  from public.exam_questions q where q.node_id = p_node
$$;

-- 문항 교체. 잠긴 시험(제출 1건~)은 구조가 같을 때만(문구·해설 갱신) — 아니면 EXAM_LOCKED
create or replace function public.exam_replace_questions(p_node bigint, p_qs jsonb, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_sub int := public.exam_submitted_count(p_node);
  q     jsonb;
  i     int := 0;
begin
  if v_sub > 0 then
    if public.exam_struct_key(p_qs) <> public.exam_struct_key(public.exam_questions_jsonb(p_node)) then
      perform public.fail('EXAM_LOCKED', format('%s명이 제출해 문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요', v_sub),
                          jsonb_build_object('submitted', v_sub));
    end if;
    -- 구조 동일: 같은 ord 의 prompt·explanation 만 갱신(exam_answers 의 question_id 보존)
    for q in select * from jsonb_array_elements(p_qs) loop
      update public.exam_questions set prompt_md = q ->> 'prompt', explanation_md = q ->> 'explanation' where node_id = p_node and ord = i;
      i := i + 1;
    end loop;
  else
    delete from public.exam_questions where node_id = p_node;
    for q in select * from jsonb_array_elements(p_qs) loop
      insert into public.exam_questions (node_id, ord, qtype, prompt_md, choices, answer, explanation_md, points)
      values (p_node, i, q ->> 'type', q ->> 'prompt', q -> 'choices', q -> 'answer', q ->> 'explanation', (q ->> 'points')::int);
      i := i + 1;
    end loop;
  end if;
  update public.exams set question_count = jsonb_array_length(p_qs),
                          total_points = coalesce((select sum((e ->> 'points')::int) from jsonb_array_elements(p_qs) e), 0),
                          source = p_source, updated_at = now()
  where node_id = p_node;
end $$;

-- ───────── 4. 출제 RPC ─────────
-- 편집 관문: node_assert_editable(방 잠금·편집자·방 상태) + 리프(PERSONAL 제외) + 이 방 소속
create or replace function public.exam_editable_leaf(p_slug text, p_node bigint, out r public.rooms, out n public.goal_nodes)
language plpgsql security definer set search_path = '' as $$
begin
  r := public.node_assert_editable(p_slug);
  n := public.node_get(r.id, p_node);        -- NODE_NOT_FOUND(다른 방 포함) · PERSONAL_NODE
  if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '시험은 말단 과제에만 둘 수 있어요', jsonb_build_object('nodeId', n.id::text)); end if;
  if n.archived_at is not null then perform public.fail('TASK_ARCHIVED', '보관된 과제예요', jsonb_build_object('nodeId', n.id::text)); end if;
end $$;

create or replace function public.exam_put(p_slug text, p_node bigint, p_exam jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms;
  n     public.goal_nodes;
  v_uid uuid := public.current_user_id();
  v_qs  jsonb;
  v_rev text;
begin
  select * into r, n from public.exam_editable_leaf(p_slug, p_node);
  v_qs := public.exam_validate(p_exam);
  v_rev := upper(coalesce(p_exam ->> 'reveal', 'after_submit'));
  insert into public.exams (node_id, room_id, reveal, created_by) values (n.id, r.id, v_rev, v_uid)
  on conflict (node_id) do update set reveal = excluded.reveal, updated_at = now();
  perform public.exam_replace_questions(n.id, v_qs, 'MANUAL');
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

create or replace function public.exam_publish(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms;
  n     public.goal_nodes;
  x     public.exams;
  v_uid uuid := public.current_user_id();
  v_rcpt uuid[];
begin
  select * into r, n from public.exam_editable_leaf(p_slug, p_node);
  select * into x from public.exams where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
  if x.question_count < 1 then perform public.fail('EXAM_EMPTY', '문항을 하나 이상 넣어야 발행할 수 있어요'); end if;
  if x.status = 'PUBLISHED' then return public.exam_view(n.id, v_uid, v_uid); end if;   -- 멱등
  update public.exams set status = 'PUBLISHED', published_at = public.app_now(), updated_at = now() where node_id = n.id;
  select coalesce(array_agg(a.user_id), '{}') into v_rcpt from public.task_assignments a where a.node_id = n.id and a.released_at is null;
  perform public.notify_publish('EXAM_PUBLISHED', r.id, n.id, v_uid, v_rcpt, 'EXAM_PUBLISHED:' || r.id || ':' || n.id,
                                jsonb_build_object('count', x.question_count));
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

create or replace function public.exam_unpublish(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid := public.current_user_id(); v_sub int;
begin
  select * into r, n from public.exam_editable_leaf(p_slug, p_node);
  v_sub := public.exam_submitted_count(n.id);
  if v_sub > 0 then perform public.fail('EXAM_LOCKED', format('%s명이 제출해 초안으로 되돌릴 수 없어요', v_sub), jsonb_build_object('submitted', v_sub)); end if;
  update public.exams set status = 'DRAFT', published_at = null, updated_at = now() where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없어요'); end if;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

-- 브리프(AI 생성 입력). 없는 시험이면 빈 초안을 만든다
create or replace function public.exam_brief_put(p_slug text, p_node bigint, p_brief jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms; n public.goal_nodes; v_uid uuid := public.current_user_id();
  v_cnt int; v_diff text; e jsonb;
begin
  select * into r, n from public.exam_editable_leaf(p_slug, p_node);
  if p_brief is null or jsonb_typeof(p_brief) <> 'object' then perform public.fail('VALIDATION_FAILED', '브리프가 올바르지 않아요', '{"field":"brief"}'::jsonb); end if;
  if length(trim(coalesce(p_brief ->> 'topic', ''))) < 1 or length(p_brief ->> 'topic') > 200 then
    perform public.fail('VALIDATION_FAILED', '주제는 1~200자예요', '{"field":"topic"}'::jsonb); end if;
  if length(coalesce(p_brief ->> 'theory', '')) > 20000 then perform public.fail('VALIDATION_FAILED', '기반 이론은 20,000자까지예요', '{"field":"theory"}'::jsonb); end if;
  if length(coalesce(p_brief ->> 'note', '')) > 1000 then perform public.fail('VALIDATION_FAILED', '참고는 1,000자까지예요', '{"field":"note"}'::jsonb); end if;
  v_cnt := coalesce((p_brief ->> 'count')::int, 10);
  if v_cnt < 1 or v_cnt > 50 then perform public.fail('VALIDATION_FAILED', '문항 수는 1~50이에요', '{"field":"count"}'::jsonb); end if;
  v_diff := coalesce(p_brief ->> 'difficulty', 'normal');
  if v_diff not in ('easy', 'normal', 'hard') then perform public.fail('VALIDATION_FAILED', '난이도는 easy·normal·hard 예요', '{"field":"difficulty"}'::jsonb); end if;
  if p_brief ? 'types' then
    if jsonb_typeof(p_brief -> 'types') <> 'array' then perform public.fail('VALIDATION_FAILED', '유형은 배열이에요', '{"field":"types"}'::jsonb); end if;
    for e in select * from jsonb_array_elements(p_brief -> 'types') loop
      if (e #>> '{}') not in ('single', 'multi', 'ox', 'short') then perform public.fail('VALIDATION_FAILED', '유형은 single·multi·ox·short 예요', '{"field":"types"}'::jsonb); end if;
    end loop;
  end if;
  insert into public.exams (node_id, room_id, created_by) values (n.id, r.id, v_uid) on conflict (node_id) do nothing;
  update public.exams set brief = jsonb_strip_nulls(jsonb_build_object(
      'topic', trim(p_brief ->> 'topic'), 'theory', p_brief ->> 'theory', 'count', v_cnt,
      'types', coalesce(p_brief -> 'types', '["single","multi","ox"]'::jsonb), 'difficulty', v_diff, 'note', p_brief ->> 'note')),
    updated_at = now()
  where node_id = n.id;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

grant execute on function public.exam_put(text, bigint, jsonb)       to authenticated;
grant execute on function public.exam_publish(text, bigint)          to authenticated;
grant execute on function public.exam_unpublish(text, bigint)        to authenticated;
grant execute on function public.exam_brief_put(text, bigint, jsonb) to authenticated;
```

`exam_view(p_node, p_uid, p_for)` 는 Task 2 가 완성한다. 이 Task 를 단독으로 통과시키려면 Step 3 끝에 **임시** 편집자 전용 `exam_view` 를 두고 Task 2 에서 교체한다:

```sql
-- (Task 2 가 다시 정의) 편집자 모양 최소판
create or replace function public.exam_view(p_node bigint, p_uid uuid, p_for uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'node', jsonb_build_object('id', n.id::text, 'title', n.title, 'startDate', to_char(n.start_date, 'YYYY-MM-DD'), 'endDate', to_char(n.end_date, 'YYYY-MM-DD'), 'archived', n.archived_at is not null),
    'exam', jsonb_build_object('status', lower(x.status), 'reveal', lower(x.reveal), 'questionCount', x.question_count, 'totalPoints', x.total_points,
                               'source', lower(x.source), 'publishedAt', public.iso(x.published_at), 'locked', public.exam_submitted_count(x.node_id) > 0,
                               'submittedCount', public.exam_submitted_count(x.node_id), 'brief', x.brief),
    'viewer', jsonb_build_object('canEdit', true, 'isAssignee', public.is_task_assignee(n.id, p_uid), 'canTake', false, 'reason', null),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'prompt', q.prompt_md, 'choices', q.choices,
                                                              'answer', q.answer, 'explanation', q.explanation_md, 'points', q.points) order by q.ord), '[]'::jsonb)
                  from public.exam_questions q where q.node_id = x.node_id),
    'attempt', null)
  from public.exams x join public.goal_nodes n on n.id = x.node_id where x.node_id = p_node
$$;
```

- [ ] **Step 4: 알림 kind(이 Task 의 `exam_publish` 가 쓴다)** — `notification_kinds`·`notify_render`·`notify_link` 를 0034 판에서 **그대로 복사**해 0037 파일 §6 자리에 두고 다음만 더한다:
  1. `notification_kinds()` 배열 끝: `-- 0037` 줄 + `, 'EXAM_PUBLISHED'`.
  2. `notify_render()` 제목 `case` 에 `when 'EXAM_PUBLISHED' then format('"%s" 시험이 열렸어요', v_node)`. 본문: 기존 본문 분기 뒤에 `if p_kind = 'EXAM_PUBLISHED' then v_body := format('%s문항 · %s 마감', coalesce(p_model ->> 'count', '0'), to_char((select g.end_date from public.goal_nodes g where g.id = p_node), 'MM.DD')); end if;` 를 **기존 분기 순서·문구를 건드리지 않고** 추가.
  3. `notify_link()` 의 `'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'PERSONAL_ARCHIVED'` 목록에 `'EXAM_PUBLISHED'` 추가(→ `?task={id}`).
  4. `notify_enabled`(0008) 는 재정의하지 않는다 — 알 수 없는 kind 는 켜진 것으로 본다(Task 0 에서 `grep -n "notify_enabled" supabase/migrations/0008_notifications.sql` 로 확인; 아니면 보고).

- [ ] **Step 5: 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db -- --filter "0037"`
Expected: `schema & authoring` 묶음 전부 PASS. `spring` 리프 제목이 시드와 다르면 `grep -n "seed_leaf(r, '" supabase/seed.sql | grep -A0 spring` 로 첫 리프 제목을 쓴다.

- [ ] **Step 6: 전체 회귀**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db`
Expected: 0 failed. `notifications-sql.test.ts` 가 `notification_kinds()` 길이를 단언하면 +1 로 갱신한다(그 파일만 고치고 노트에 적는다).

- [ ] **Step 7: 커밋**

```bash
cd /Users/picpal/Desktop/workspace/sgtudy && git add supabase/migrations/0037_round_exam.sql supabase/tests/round-exam-sql.test.ts && git commit -m "feat(db): 0037 (1/4) 회차 시험 표·계약 검증·출제 RPC·가드 트리거·EXAM_PUBLISHED

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- supabase/migrations/0037_round_exam.sql supabase/tests/round-exam-sql.test.ts supabase/tests/notifications-sql.test.ts
```

---

### Task 2: 0037 (2/4) — 응시: `exam_get`·`exam_view`(노출 깎기)·`exam_answer_save`·`exam_submit`(서버 채점 · submissions 1행) (opus)

**Files:**
- Modify: `supabase/migrations/0037_round_exam.sql`(§5 응시 — Task 1 의 임시 `exam_view` 교체)
- Modify: `supabase/tests/round-exam-sql.test.ts`(묶음 추가)

**Interfaces:**
- 내부 `exam_target(p_node, p_uid) → public.goal_nodes`(응시 관문: 방 잠금·숨김·ACTIVE·보관·리프·담당자 + PUBLISHED + 시작일) · `exam_answer_shape_ok(q, answer) → boolean` · `exam_grade(q, answer, out correct boolean, out earned int)` · `exam_reveal_ok(x public.exams, n public.goal_nodes, a public.exam_attempts) → boolean` · `exam_view(p_node, p_uid, p_for)`(p_for = attempt 주인; 보통 p_uid, 편집자가 남의 답안을 볼 때만 다르다)
- RPC `exam_get(p_slug, p_node) → jsonb` · `exam_answer_save(p_node, p_question bigint, p_answer jsonb) → jsonb{savedAt, answered, total}` · `exam_submit(p_node) → jsonb`

- [ ] **Step 1: 실패하는 테스트 추가** — `round-exam-sql.test.ts` 끝에

```ts
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
const qids = async (q: Q, node: string) => (await q("select id::text as id from public.exam_questions where node_id = $1::bigint order by ord", [node])).map((r) => r.id as string);

cases("round exam 0037 · taking & reveal", db, [
  { name: "exam_get before submit: assignee gets questions WITHOUT answer/explanation keys · non-assignee no questions · anon EXAM_NOT_FOUND", run: async (q) => {
    const node = await published(q);
    await as(q, "지은");
    const v = await get(q, node);
    assertEquals(v.viewer.canTake, true);
    assertEquals(v.questions.length, 4);
    for (const x of v.questions) { assertEquals("answer" in x, false); assertEquals("explanation" in x, false); }
    assertEquals(v.attempt, null);
    assertEquals("brief" in v.exam, false);
    await q("update public.rooms set leader_does_tasks = false where slug = 'aws'");
    await q("select public.assignment_resync((select id from public.rooms where slug = 'aws'))");
    await as(q, "민수");                                     // 그룹장(과제 안 함) = 편집자 → 정답 본다
    assertEquals("answer" in (await get(q, node)).questions[0], true);
    await as(q, "도윤");                                     // INACTIVE 멤버: 문항 없음
    const d = await get(q, node);
    assertEquals(d.questions, null);
    assertEquals(d.viewer.reason, "not_assignee");
    await asAnon(q);
    await expectFail(get(q, node), "EXAM_NOT_FOUND");
  } },
  { name: "draft exam: assignee sees status only (reason not_published) · before start not_started", run: async (q) => {
    const node = await newExamLeaf(q);
    await put(q, node, Q4);
    await as(q, "지은");
    const v = await get(q, node);
    assertEquals(v.viewer.reason, "not_published");
    assertEquals(v.questions, null);
    await as(q, "민수");
    await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
    await as(q, "지은");                                     // 오늘 10/12 < 10/15
    assertEquals((await get(q, node)).viewer.reason, "not_started");
    await expectFail(save(q, node, (await qids(q, node))[0], 0), "TASK_NOT_STARTED");
  } },
  { name: "exam_answer_save: shape check per type · creates IN_PROGRESS · answered/total · plain leaf EXAM_NOT_FOUND", run: async (q) => {
    const node = await published(q);
    const ids = await qids(q, node);
    await as(q, "지은");
    let r = await save(q, node, ids[0], 0);
    assertEquals([r.answered, r.total], [1, 4]);
    await expectFail(save(q, node, ids[0], 9), "VALIDATION_FAILED");
    await expectFail(save(q, node, ids[1], 0), "VALIDATION_FAILED");        // multi 는 배열
    await expectFail(save(q, node, ids[2], "O"), "VALIDATION_FAILED");      // ox 는 boolean
    await expectFail(save(q, node, ids[3], "x".repeat(201)), "VALIDATION_FAILED");
    r = await save(q, node, ids[1], [2, 0]);
    assertEquals(r.answered, 2);
    assertEquals((await one(q, "select status from public.exam_attempts where node_id = $1::bigint", [node])).status, "IN_PROGRESS");
    const plain = await nodeId(q, "aws", "ALB vs NLB 실습");
    await expectFail(save(q, plain, ids[0], 0), "EXAM_NOT_FOUND");
    await expectFail(save(q, node, "0", 0), "NOT_FOUND");                   // 다른 시험의 문항 id
  } },
  { name: "exam_submit: server grading (single·multi all-or-nothing·ox·short normalized) · submissions row · progress · answers revealed (after_submit)", run: async (q) => {
    const node = await published(q);
    const ids = await qids(q, node);
    await as(q, "지은");
    await save(q, node, ids[0], 0);           // 정답
    await save(q, node, ids[1], [0]);         // 부분 → 오답
    await save(q, node, ids[2], false);       // 정답
    await save(q, node, ids[3], " internet  GATEWAY ");   // 정규화 → 정답
    const v = await rpc(q, "public.exam_submit($1::bigint)", [node]);
    assertEquals(v.attempt.status, "submitted");
    assertEquals([v.attempt.score, v.attempt.maxScore, v.attempt.correctCount], [3, 5, 3]);
    assertEquals(v.attempt.isLate, false);
    assertEquals(v.attempt.results[ids[1]], { correct: false, earned: 0 });
    assertEquals(v.questions[1].answer, [0, 2]);
    assertEquals(v.questions[1].explanation, "IAM 은 글로벌");
    // submissions 1행 → 기존 집계가 "제출" 로 본다
    const s = await one(q, "select body_md, is_late from public.submissions where node_id = $1::bigint and user_id = $2::uuid", [node, await uidOf(q, "지은")]);
    assertEquals([s.body_md, s.is_late], ["", false]);
    const p = await one(q, "select asg, sub from public.room_progress((select id from public.rooms where slug = 'aws')) where node_id = $1::bigint", [node]);
    assertEquals([p.asg, p.sub], [4, 1]);
    const st = await one(q, "select st from public.me_schedule_leaves($1::uuid, '2026-10-16') where node_id = $2::bigint", [await uidOf(q, "지은"), node]);
    assertEquals(st.st, "done");
    await expectFail(rpc(q, "public.exam_submit($1::bigint)", [node]), "EXAM_ALREADY_SUBMITTED");
    await expectFail(save(q, node, ids[0], 1), "EXAM_ALREADY_SUBMITTED");
  } },
  { name: "exam_submit: unanswered questions count wrong · late after deadline · empty attempt allowed (0점)", run: async (q) => {
    const node = await published(q);
    await setToday(q, "2026-10-22");
    await setNow(q, "2026-10-22T09:00:00+09:00");
    await as(q, "철수");
    const v = await rpc(q, "public.exam_submit($1::bigint)", [node]);
    assertEquals([v.attempt.score, v.attempt.correctCount, v.attempt.isLate], [0, 0, true]);
  } },
  { name: "reveal after_deadline: after submit only score · after end_date answers for everyone incl. non-submitters · extending end_date closes again", run: async (q) => {
    const node = await newExamLeaf(q);
    await put(q, node, { ...Q4, reveal: "after_deadline" });
    await rpc(q, "public.exam_publish('aws', $1::bigint)", [node]);
    await setToday(q, "2026-10-16"); await setNow(q, "2026-10-16T12:00:00+09:00");
    const ids = await qids(q, node);
    await as(q, "지은");
    await save(q, node, ids[0], 0);
    let v = await rpc(q, "public.exam_submit($1::bigint)", [node]);
    assertEquals(v.attempt.score, 1);
    assertEquals(v.attempt.results, null);
    assertEquals("answer" in v.questions[0], false);
    await setToday(q, "2026-10-22");
    v = await get(q, node);
    assertEquals(v.attempt.results[ids[0]].correct, true);
    assertEquals("answer" in v.questions[0], true);
    await as(q, "하나");                                     // 미제출자도 마감 뒤엔 본다
    assertEquals("answer" in (await get(q, node)).questions[0], true);
    await as(q, "민수");
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-25\"}'::jsonb)", [node]);
    await as(q, "지은");
    assertEquals("answer" in (await get(q, node)).questions[0], false);   // 연장 → 다시 닫힘
  } },
  { name: "all-submitted notification (IMMEDIATE) fires from exam_submit like a normal task", run: async (q) => {
    const node = await published(q);
    await q("update public.room_notification_settings set completion_mode = 'IMMEDIATE' where room_id = (select id from public.rooms where slug = 'aws')");
    for (const n of ["지은", "철수", "하나", "민수"]) { await as(q, n); await rpc(q, "public.exam_submit($1::bigint)", [node]); }
    const notes = await q("select 1 from public.notifications where kind = 'TASK_ALL_SUBMITTED' and node_id = $1::bigint", [node]);
    assertEquals(notes.length, 1);
  } },
  { name: "archived exam leaf: take blocked (TASK_ARCHIVED) · editor still sees answers", run: async (q) => {
    const node = await published(q);
    await as(q, "민수");
    await q("select public.node_archive('aws', $1::bigint)", [node]);
    await as(q, "지은");
    await expectFail(save(q, node, (await qids(q, node))[0], 0), "TASK_ARCHIVED");
    await as(q, "민수");
    assertEquals((await get(q, node)).exam.status, "published");
  } },
]);
```

- [ ] **Step 2: 실패 확인** — `npm run test:db -- --filter "taking"` → FAIL.

- [ ] **Step 3: 마이그레이션 §5 응시** — Task 1 의 임시 `exam_view` 를 지우고 다음으로 교체

```sql
-- ───────── 5. 응시 ─────────
-- 응시 관문 = submission_target(방 잠금·숨김·ACTIVE·보관·리프·담당자) + 시험 존재·발행 + 시작일. 마감 뒤는 허용(지각)
create or replace function public.exam_target(p_node bigint, p_uid uuid) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes; x public.exams;
begin
  select * into x from public.exams where node_id = p_node;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', p_node::text)); end if;
  n := public.submission_target(p_node, p_uid);
  if x.status <> 'PUBLISHED' then perform public.fail('EXAM_NOT_PUBLISHED', '아직 발행되지 않은 시험이에요'); end if;
  if public.kst_today() < n.start_date then
    perform public.fail('TASK_NOT_STARTED', '아직 시작되지 않은 시험이에요', jsonb_build_object('startDate', to_char(n.start_date, 'YYYY-MM-DD')));
  end if;
  return n;
end $$;

create or replace function public.exam_answer_shape_ok(q public.exam_questions, p_answer jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case q.qtype
    when 'SINGLE' then jsonb_typeof(p_answer) = 'number' and (p_answer #>> '{}')::numeric = floor((p_answer #>> '{}')::numeric)
                       and (p_answer #>> '{}')::int between 0 and jsonb_array_length(q.choices) - 1
    when 'MULTI'  then jsonb_typeof(p_answer) = 'array' and jsonb_array_length(p_answer) <= jsonb_array_length(q.choices)
                       and not exists (select 1 from jsonb_array_elements(p_answer) e
                                       where jsonb_typeof(e) <> 'number' or (e #>> '{}')::int < 0 or (e #>> '{}')::int >= jsonb_array_length(q.choices))
    when 'OX'     then jsonb_typeof(p_answer) = 'boolean'
    when 'SHORT'  then jsonb_typeof(p_answer) = 'string' and length(p_answer #>> '{}') <= 200
    else false end
$$;

-- 채점(D12·D13). 답이 없거나 모양이 틀리면 오답 0점
create or replace function public.exam_grade(q public.exam_questions, p_answer jsonb, out correct boolean, out earned int)
language plpgsql immutable set search_path = '' as $$
begin
  correct := false;
  if p_answer is not null and public.exam_answer_shape_ok(q, p_answer) then
    correct := case q.qtype
      when 'SINGLE' then (p_answer #>> '{}')::int = (q.answer #>> '{}')::int
      when 'MULTI'  then (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (select distinct (e #>> '{}')::int as x from jsonb_array_elements(p_answer) e) s) = q.answer
      when 'OX'     then (p_answer #>> '{}')::boolean = (q.answer #>> '{}')::boolean
      when 'SHORT'  then exists (select 1 from jsonb_array_elements_text(q.answer) a where public.exam_norm(a) = public.exam_norm(p_answer #>> '{}'))
      end;
  end if;
  earned := case when correct then q.points else 0 end;
end $$;

-- 정답·해설·정오 공개 여부(스펙 §3.4). 편집자는 호출 전에 걸러진다
create or replace function public.exam_reveal_ok(x public.exams, n public.goal_nodes, a public.exam_attempts) returns boolean
language sql stable set search_path = '' as $$
  select case x.reveal
    when 'AFTER_SUBMIT'   then a.status = 'SUBMITTED'
    when 'AFTER_DEADLINE' then public.kst_today() > n.end_date
    else false end
$$;

-- 보는 사람(p_uid)에 따라 깎은 시험 JSON. p_for = 응시 행 주인(편집자가 남의 답안을 볼 때만 p_uid 와 다르다)
create or replace function public.exam_view(p_node bigint, p_uid uuid, p_for uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  x        public.exams;
  n        public.goal_nodes;
  r        public.rooms;
  a        public.exam_attempts;
  v_edit   boolean;
  v_asg    boolean;
  v_member boolean;
  v_reveal boolean;
  v_reason text;
  v_qs     jsonb;
  v_att    jsonb;
  v_sub    int;
begin
  select * into x from public.exams where node_id = p_node;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', p_node::text)); end if;
  select * into n from public.goal_nodes where id = p_node;
  select * into r from public.rooms where id = n.room_id;
  v_edit := public.can_edit_curriculum(r, p_uid);
  v_member := p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')));
  if not v_edit and not v_member then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', p_node::text)); end if;
  if p_for is distinct from p_uid and not v_edit then perform public.fail('FORBIDDEN', '다른 사람의 답안은 편집자만 볼 수 있어요'); end if;

  v_asg := p_uid is not null and public.is_task_assignee(n.id, p_uid);
  select * into a from public.exam_attempts where node_id = p_node and user_id = p_for;
  v_sub := public.exam_submitted_count(p_node);
  v_reveal := v_edit or public.exam_reveal_ok(x, n, a);

  v_reason := case
    when a.status = 'SUBMITTED' then 'submitted'
    when r.status <> 'ACTIVE' or r.archived_at is not null then 'room_not_active'
    when n.archived_at is not null then 'archived'
    when not v_asg then 'not_assignee'
    when x.status <> 'PUBLISHED' then 'not_published'
    when public.kst_today() < n.start_date then 'not_started'
    else null end;

  -- 문항: 편집자 | 담당자(스펙 §3.4 — 담당 아닌 멤버는 요약만). 정답·해설 키는 v_reveal 일 때만 만든다
  if v_edit or v_asg then
    select coalesce(jsonb_agg(
      jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'prompt', q.prompt_md, 'choices', q.choices, 'points', q.points)
      || case when v_reveal then jsonb_build_object('answer', q.answer, 'explanation', q.explanation_md) else '{}'::jsonb end
      order by q.ord), '[]'::jsonb)
    into v_qs from public.exam_questions q where q.node_id = p_node;
    -- 초안은 담당자에게 문항을 보여 주지 않는다(편집자 제외)
    if not v_edit and x.status <> 'PUBLISHED' then v_qs := null; end if;
  end if;

  if a.id is not null then
    v_att := jsonb_build_object(
      'status', lower(a.status),
      'answers', coalesce((select jsonb_object_agg(e.question_id::text, e.answer) from public.exam_answers e where e.attempt_id = a.id), '{}'::jsonb),
      'score', a.score, 'maxScore', a.max_score, 'correctCount', a.correct_count,
      'submittedAt', public.iso(a.submitted_at),
      'isLate', (select s.is_late from public.submissions s where s.node_id = p_node and s.user_id = p_for),
      'results', case when v_reveal and a.status = 'SUBMITTED' then
        coalesce((select jsonb_object_agg(e.question_id::text, jsonb_build_object('correct', e.is_correct, 'earned', e.earned))
                  from public.exam_answers e where e.attempt_id = a.id), '{}'::jsonb) end);
  end if;

  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'node', jsonb_build_object('id', n.id::text, 'title', n.title, 'startDate', to_char(n.start_date, 'YYYY-MM-DD'),
                               'endDate', to_char(n.end_date, 'YYYY-MM-DD'), 'archived', n.archived_at is not null),
    'exam', jsonb_build_object('status', lower(x.status), 'reveal', lower(x.reveal), 'questionCount', x.question_count,
                               'totalPoints', x.total_points, 'publishedAt', public.iso(x.published_at))
            || case when v_edit then jsonb_build_object('source', lower(x.source), 'locked', v_sub > 0, 'submittedCount', v_sub, 'brief', x.brief) else '{}'::jsonb end,
    'viewer', jsonb_build_object('canEdit', v_edit, 'isAssignee', v_asg, 'canTake', v_reason is null, 'reason', v_reason),
    'questions', v_qs,
    'attempt', v_att);
end $$;

create or replace function public.exam_get(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); r public.rooms; n public.goal_nodes;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

create or replace function public.exam_answer_save(p_node bigint, p_question bigint, p_answer jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  n     public.goal_nodes;
  q     public.exam_questions;
  a     public.exam_attempts;
  v_cnt int;
  v_tot int;
begin
  n := public.exam_target(p_node, v_uid);
  select * into q from public.exam_questions where id = p_question and node_id = n.id;
  if not found then perform public.fail('NOT_FOUND', '문항을 찾을 수 없어요', jsonb_build_object('questionId', p_question::text)); end if;
  if p_answer is null or not public.exam_answer_shape_ok(q, p_answer) then
    perform public.fail('VALIDATION_FAILED', '답 모양이 문항 유형과 맞지 않아요', jsonb_build_object('field', 'answer', 'questionId', q.id::text));
  end if;
  insert into public.exam_attempts (node_id, user_id) values (n.id, v_uid) on conflict (node_id, user_id) do nothing;
  select * into a from public.exam_attempts where node_id = n.id and user_id = v_uid for update;
  if a.status = 'SUBMITTED' then perform public.fail('EXAM_ALREADY_SUBMITTED', '이미 제출한 시험이에요'); end if;
  insert into public.exam_answers (attempt_id, question_id, answer, saved_at) values (a.id, q.id, p_answer, public.app_now())
  on conflict (attempt_id, question_id) do update set answer = excluded.answer, saved_at = excluded.saved_at;
  select count(*) into v_cnt from public.exam_answers where attempt_id = a.id;
  select count(*) into v_tot from public.exam_questions where node_id = n.id;
  return jsonb_build_object('savedAt', public.iso(public.app_now()), 'answered', v_cnt, 'total', v_tot);
end $$;

-- 제출 = 채점 + SUBMITTED + submissions 1행(본문 ''). 빈 응시(답 없음)도 제출된다(0점)
create or replace function public.exam_submit(p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  v_now  timestamptz := public.app_now();
  n      public.goal_nodes;
  r      public.rooms;
  a      public.exam_attempts;
  q      public.exam_questions;
  v_c    boolean;
  v_e    int;
  v_score int := 0;
  v_max  int := 0;
  v_cnt  int := 0;
  v_asg  int;
  v_sub  int;
  v_mode text;
begin
  n := public.exam_target(p_node, v_uid);
  select * into r from public.rooms where id = n.room_id;
  insert into public.exam_attempts (node_id, user_id) values (n.id, v_uid) on conflict (node_id, user_id) do nothing;
  select * into a from public.exam_attempts where node_id = n.id and user_id = v_uid for update;
  if a.status = 'SUBMITTED' then perform public.fail('EXAM_ALREADY_SUBMITTED', '이미 제출한 시험이에요'); end if;

  for q in select * from public.exam_questions where node_id = n.id order by ord loop
    select g.correct, g.earned into v_c, v_e
    from public.exam_grade(q, (select e.answer from public.exam_answers e where e.attempt_id = a.id and e.question_id = q.id)) g;
    insert into public.exam_answers (attempt_id, question_id, answer, is_correct, earned, saved_at)
    values (a.id, q.id, 'null'::jsonb, v_c, v_e, v_now)
    on conflict (attempt_id, question_id) do update set is_correct = excluded.is_correct, earned = excluded.earned;
    v_score := v_score + v_e; v_max := v_max + q.points; v_cnt := v_cnt + case when v_c then 1 else 0 end;
  end loop;
  update public.exam_attempts set status = 'SUBMITTED', submitted_at = v_now, score = v_score, max_score = v_max, correct_count = v_cnt where id = a.id;

  -- 과제 제출 1행(0022 규칙과 같은 지각 판정). 트리거는 이 설정으로만 연다
  perform set_config('sgtudy.exam_submit', '1', true);
  insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
  values (n.id, v_uid, '', v_now, v_now >= public.kst_deadline(n.end_date), v_now);
  perform set_config('sgtudy.exam_submit', '0', true);

  -- 전원 제출 감지(submission_upsert 0022 와 동일)
  select ls.asg, ls.sub into v_asg, v_sub from public.room_leaf_stats(r.id) ls where ls.node_id = n.id;
  if coalesce(v_asg, 0) > 0 and v_sub = v_asg then
    select completion_mode into v_mode from public.room_notification_settings where room_id = r.id;
    if coalesce(v_mode, 'DAILY_DIGEST') = 'IMMEDIATE' then
      perform public.notify_publish('TASK_ALL_SUBMITTED', r.id, n.id, v_uid, array[r.leader_id], 'TASK_ALL_SUBMITTED:' || r.id || ':' || n.id, '{}'::jsonb);
    end if;
  end if;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

grant execute on function public.exam_get(text, bigint)                    to authenticated, anon;   -- anon 은 EXAM_NOT_FOUND 로 끝난다(존재 숨김)
grant execute on function public.exam_answer_save(bigint, bigint, jsonb)   to authenticated;
grant execute on function public.exam_submit(bigint)                       to authenticated;
```

`exam_answers.answer` 가 `not null` 이므로 미답 문항의 채점 행은 `'null'::jsonb`(JSON null) 로 넣는다 — `exam_view.answers` 에서 JSON null 로 나오면 웹이 "답 없음" 으로 본다(`exam.ts` 의 `isAnswered`).

- [ ] **Step 4: 통과 + 전체 회귀** — `npm run test:db -- --filter "0037"` PASS → `npm run test:db` 0 failed.

- [ ] **Step 5: 커밋**

```bash
cd /Users/picpal/Desktop/workspace/sgtudy && git commit -m "feat(db): 0037 (2/4) 시험 응시·서버 채점·공개 규칙·submissions 연동

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- supabase/migrations/0037_round_exam.sql supabase/tests/round-exam-sql.test.ts
```

---

### Task 3: 0037 (3/4) — 편집자 결과(`exam_results`·`exam_attempt_get`) · `curriculum_json`·`task_node_json` 재정의(리프 `exam` 요약) (opus)

**Files:**
- Modify: `supabase/migrations/0037_round_exam.sql`(§6 결과 · §7 재정의)
- Modify: `supabase/tests/round-exam-sql.test.ts`

**Interfaces:**
- RPC `exam_results(p_slug, p_node) → jsonb`(스펙 §5.4) · `exam_attempt_get(p_slug, p_node, p_user uuid) → jsonb`(`exam_view(n, uid, p_user)`)
- `curriculum_json` ←0032 복사 + 리프 노드에 `'exam', (select jsonb_build_object('status', lower(x.status), 'questionCount', x.question_count, 'totalPoints', x.total_points, 'reveal', lower(x.reveal)) from public.exams x where x.node_id = t.id)`(없으면 null — `jsonb_build_object` 가 null 값을 키로 싣는 것은 허용: 웹 `NodeDto.exam?: … | null`)
- `task_node_json` ←0024 복사 + 같은 `'exam'` 키

- [ ] **Step 1: 실패하는 테스트**

```ts
cases("round exam 0037 · results & tree", db, [
  { name: "exam_results: editor only · avg/max · per-question correct rate · members incl. non-submitters · attempt_get of a member", run: async (q) => {
    const node = await published(q);
    const ids = await qids(q, node);
    await as(q, "지은"); await save(q, node, ids[0], 0); await save(q, node, ids[2], false); await rpc(q, "public.exam_submit($1::bigint)", [node]);
    await as(q, "철수"); await save(q, node, ids[0], 1); await rpc(q, "public.exam_submit($1::bigint)", [node]);
    await expectFail(rpc(q, "public.exam_results('aws', $1::bigint)", [node]), "NOT_CURRICULUM_EDITOR");
    await as(q, "민수");
    const r = await rpc(q, "public.exam_results('aws', $1::bigint)", [node]);
    assertEquals([r.submitted, r.assigned, r.maxScore], [2, 4, 5]);
    assertEquals(r.avg, 1);                                  // (2 + 0) / 2
    assertEquals(r.max, 2);
    assertEquals(r.questions[0].correctRate, 50);
    assertEquals(r.questions[3].correctRate, 0);
    const jieun = r.members.find((m: Row) => m.nickname === "지은");
    assertEquals([jieun.score, jieun.status], [2, "done"]);
    assertEquals(r.members.find((m: Row) => m.nickname === "하나").score, null);
    const a = await rpc(q, "public.exam_attempt_get('aws', $1::bigint, $2::uuid)", [node, await uidOf(q, "철수")]);
    assertEquals(a.attempt.answers[ids[0]], 1);
    assertEquals(a.attempt.results[ids[0]].correct, false);
    await as(q, "지은");
    await expectFail(rpc(q, "public.exam_attempt_get('aws', $1::bigint, $2::uuid)", [node, await uidOf(q, "철수")]), "FORBIDDEN");
  } },
  { name: "curriculum_get/task_get carry exam summary (no answers) · plain leaf exam null", run: async (q) => {
    const node = await published(q);
    await as(q, "지은");
    const c = await rpc(q, "public.curriculum_get('aws', false)");
    const leaf = (c.nodes as Row[]).find((x) => x.id === node)!;
    assertEquals(leaf.exam, { status: "published", questionCount: 4, totalPoints: 5, reveal: "after_submit" });
    assertEquals((c.nodes as Row[]).find((x) => x.title === "ALB vs NLB 실습")!.exam, null);
    assertEquals(JSON.stringify(c).includes("명시적 Deny 가 먼저예요"), false);
    const t = await rpc(q, "public.task_get('aws', $1::bigint)", [node]);
    assertEquals(t.node.exam.status, "published");
    assertEquals(t.mySubmission, null);
  } },
]);
```

- [ ] **Step 2: 실패 확인** — `--filter "results"` FAIL.

- [ ] **Step 3: §6 결과**

```sql
-- ───────── 6. 편집자 결과 ─────────
create or replace function public.exam_results(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  r     public.rooms;
  n     public.goal_nodes;
  x     public.exams;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.require_curriculum_editor(r, v_uid);
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  select * into x from public.exams where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요'); end if;

  return jsonb_build_object(
    'submitted', public.exam_submitted_count(n.id),
    'assigned', (select count(*) from public.task_assignments a where a.node_id = n.id and a.released_at is null),
    'maxScore', x.total_points,
    'avg', (select round(avg(a.score)::numeric, 1) from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'),
    'max', (select max(a.score) from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'),
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'points', q.points,
                    'correctRate', (select public.pct(count(*)::int, count(*) filter (where e.is_correct)::int)
                                    from public.exam_answers e join public.exam_attempts a on a.id = e.attempt_id
                                    where e.question_id = q.id and a.status = 'SUBMITTED')) order by q.ord), '[]'::jsonb)
                  from public.exam_questions q where q.node_id = n.id),
    'members', (select coalesce(jsonb_agg(public.person_json(a.user_id) || jsonb_build_object(
                    'status', public.task_code(n.start_date, n.end_date, s.first_submitted_at, s.is_late, public.kst_today()),
                    'score', t.score, 'submittedAt', public.iso(t.submitted_at), 'isLate', s.is_late)
                  order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
                from public.task_assignments a
                join public.room_members m on m.room_id = r.id and m.user_id = a.user_id
                left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
                left join public.exam_attempts t on t.node_id = n.id and t.user_id = a.user_id and t.status = 'SUBMITTED'
                where a.node_id = n.id and a.released_at is null));
end $$;

create or replace function public.exam_attempt_get(p_slug text, p_node bigint, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  return public.exam_view(n.id, v_uid, p_user);   -- 편집자가 아니면 exam_view 가 FORBIDDEN
end $$;

grant execute on function public.exam_results(text, bigint)             to authenticated;
grant execute on function public.exam_attempt_get(text, bigint, uuid)   to authenticated;
```

`public.pct(asg, sub)` 는 asg 0 이면 null 을 준다(0002) — `correctRate` 가 응시 0 이면 null, 테스트는 응시 2 기준.

- [ ] **Step 4: §7 재정의** — `curriculum_json`(0032 판 전체 복사) 의 `nodes` CTE `jsonb_build_object(...)` 에 `'createdBy', …` 줄 다음 `'exam', (select jsonb_build_object('status', lower(x.status), 'questionCount', x.question_count, 'totalPoints', x.total_points, 'reveal', lower(x.reveal)) from public.exams x where x.node_id = t.id),   -- 0037` 한 줄. `task_node_json`(0024 판 복사) 의 `'createdBy', …` 다음에 `n.id` 로 같은 줄. 두 함수 머리 주석에 `-- 0037: 리프 exam 요약(정답 없음)`.

- [ ] **Step 5: 통과 + 전체 회귀 + 커밋**

```bash
cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db && git commit -m "feat(db): 0037 (3/4) 시험 결과·멤버 답안·트리/상세 exam 요약

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- supabase/migrations/0037_round_exam.sql supabase/tests/round-exam-sql.test.ts
```

---

### Task 4: 0037 (4/4) — AI 통로: `exam_brief_text`·`exam_draft_put` + `api_scope_of`·`api_invoke` 재정의 (opus)

**Files:**
- Modify: `supabase/migrations/0037_round_exam.sql`(§8 API)
- Modify: `supabase/tests/round-exam-sql.test.ts` · `supabase/tests/api-invoke-sql.test.ts`(op 목록 단언이 있으면 +2)

**Interfaces:**
- `exam_brief_text(p_slug, p_node) → jsonb {study:{slug,title}, task:{id,title,startDate,endDate}, exam:{status,questionCount}, brief, contract(text), constraints:{maxQuestions:50, types:[…], pointsRange:[1,10]}}` — 편집자만(`require_curriculum_editor`), 브리프 없으면 `brief: null` + `contract` 는 그대로(AI 가 주제를 사용자에게 묻게)
- `exam_draft_put(p_slug, p_node, p_exam) → jsonb {questionCount, totalPoints, warnings:[{code,message}]}` — `exam_editable_leaf` + PUBLISHED 면 `EXAM_PUBLISHED`, 잠김이면 `EXAM_LOCKED`, `exam_validate` 후 `exam_replace_questions(…, 'AI')`, `reveal` 은 바꾸지 않는다. 경고: 브리프 `count` 와 다르면 `COUNT_MISMATCH`, 브리프 `types` 밖 유형이 있으면 `TYPE_NOT_IN_BRIEF`
- `api_scope_of` ←0033 + `when 'exam_get_brief' then 'read'` · `when 'exam_draft_put' then 'curriculum:write'`
- `api_invoke` ←0035 복사: ① 해석 분기 `elsif p_op in ('curriculum_get', …)` 목록에 두 op 추가(`study` 해석 → `v_slug`·`v_room`), ② 디스패치 `when 'exam_get_brief' then public.exam_brief_text(v_slug, (v_args ->> 'task')::bigint)` · `when 'exam_draft_put' then public.exam_draft_put(v_slug, (v_args ->> 'task')::bigint, v_args -> 'exam')`, ③ 감사 `summary`: `when p_op = 'exam_draft_put' then jsonb_strip_nulls(jsonb_build_object('task', nullif(v_args ->> 'task', '') , 'questionCount', v_data -> 'questionCount'))` — **문항 본문은 싣지 않는다**. `task` 는 `^[0-9]{1,19}$` 일 때만. 그 외 줄은 그대로.
- 레이트리밋: `api_rate_check` 재정의 금지 → `exam_draft_put` 은 분당 60 한도만 받는다. 2단계에 `api_limits` 확장 시 함께(노트에 적는다).

- [ ] **Step 1: 실패하는 테스트**

```ts
cases("round exam 0037 · api ops", db, [
  { name: "api_invoke exam_get_brief (session): brief + contract · exam_draft_put writes DRAFT source ai with warnings · audit has no question text", run: async (q) => {
    const node = await newExamLeaf(q);
    await rpc(q, "public.exam_brief_put('aws', $1::bigint, $2::jsonb)", [node, JSON.stringify({ topic: "IAM", theory: "정책 평가 …", count: 2, types: ["single", "ox"] })]);
    // 세션 경로: PGlite 스텁 auth.uid() = app.uid (api-invoke-sql.test.ts 와 같은 방식 — 이미 as(q,'민수') 상태)
    const b = await rpc(q, "public.api_invoke(null, 'exam_get_brief', $1::jsonb)", [JSON.stringify({ study: "aws", task: node })]);
    assertEquals(b.ok, true);
    assertEquals(b.data.brief.topic, "IAM");
    assert((b.data.contract as string).includes("sgtudy.exam/v1"));
    const d = await rpc(q, "public.api_invoke(null, 'exam_draft_put', $1::jsonb)", [JSON.stringify({ study: "aws", task: node, exam: { questions: [Q4.questions[0], Q4.questions[1], Q4.questions[2]] } })]);
    assertEquals(d.ok, true);
    assertEquals(d.data.questionCount, 3);
    assertEquals((d.data.warnings as Row[]).map((w) => w.code).sort(), ["COUNT_MISMATCH", "TYPE_NOT_IN_BRIEF"]);
    assertEquals((await one(q, "select source, status from public.exams where node_id = $1::bigint", [node])).source, "AI");
    const audit = await one(q, "select summary::text as s from public.api_audit where op = 'exam_draft_put' order by id desc limit 1");
    assertEquals((audit.s as string).includes("IAM 정책 평가"), false);
    assert((audit.s as string).includes('"questionCount": 3') || (audit.s as string).includes('"questionCount":3'));
  } },
  { name: "exam_draft_put refused on PUBLISHED (EXAM_PUBLISHED) and on locked", run: async (q) => {
    const node = await published(q);
    await as(q, "민수");
    const d = await rpc(q, "public.api_invoke(null, 'exam_draft_put', $1::jsonb)", [JSON.stringify({ study: "aws", task: node, exam: Q4 })]);
    assertEquals(d.ok, false);
    assertEquals(d.error.code, "EXAM_PUBLISHED");
  } },
  { name: "scopes: exam_get_brief read · exam_draft_put curriculum:write", run: async (q) => {
    assertEquals((await one(q, "select public.api_scope_of('exam_get_brief') as v")).v, "read");
    assertEquals((await one(q, "select public.api_scope_of('exam_draft_put') as v")).v, "curriculum:write");
  } },
]);
```

(세션 경로: PGlite 스텁 `auth.uid()` 가 `app.uid` 를 읽으므로 `as(q, '민수')` 만으로 `api_invoke(null, …)` 이 세션 사용자로 돈다 — `api-invoke-sql.test.ts` 와 같은 방식. `notification_kinds()` 길이·목록을 단언하는 테스트(`backlog2`·`curriculum-plan`·`editor-notify`)가 깨지면 `EXAM_PUBLISHED` 를 더해 갱신하고 노트에 적는다.)

- [ ] **Step 2: 실패 확인 → Step 3: §8 작성**

```sql
-- ───────── 8. AI 통로 (api_invoke op 2개, 스펙 §3.5) ─────────
create or replace function public.exam_contract_text() returns text
language sql immutable set search_path = '' as $$
  select $t$sgtudy.exam/v1 — create_exam_draft 의 exam 인자 모양:
{"questions":[
 {"type":"single","prompt":"문제(마크다운, ≤2000자)","choices":["보기1","보기2","보기3","보기4"],"answer":0,"explanation":"해설(≤4000자)","points":1},
 {"type":"multi","prompt":"…","choices":["…","…","…"],"answer":[0,2],"explanation":"…","points":2},
 {"type":"ox","prompt":"…","answer":true,"explanation":"…"},
 {"type":"short","prompt":"…","answer":["허용 답1","허용 답2"],"explanation":"…"}]}
규칙: 문항 1~50 · choices 2~8개(각 ≤200자) · answer 는 0부터 세는 보기 번호 · multi 는 전부 맞아야 정답 · short 는 정규화(소문자·공백·구두점 제거) 뒤 정확 일치라 허용 답을 여러 개 · points 1~10(기본 1) · 한국어로 · 해설에는 왜 정답인지와 오답 보기가 틀린 이유를 짧게.
초안으로 저장되며 편집자가 웹에서 검토·발행한다. 발행된 시험은 덮어쓸 수 없다.$t$
$$;

create or replace function public.exam_brief_text(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes; x public.exams;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.require_curriculum_editor(r, v_uid);
  n := public.node_get(r.id, p_node);
  if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '시험은 말단 과제에만 둘 수 있어요'); end if;
  select * into x from public.exams where node_id = n.id;
  return jsonb_build_object(
    'study', jsonb_build_object('slug', r.slug, 'title', r.title),
    'task', jsonb_build_object('id', n.id::text, 'title', n.title, 'startDate', to_char(n.start_date, 'YYYY-MM-DD'), 'endDate', to_char(n.end_date, 'YYYY-MM-DD')),
    'exam', case when x.node_id is null then jsonb_build_object('status', 'none', 'questionCount', 0)
                 else jsonb_build_object('status', lower(x.status), 'questionCount', x.question_count) end,
    'brief', x.brief,
    'contract', public.exam_contract_text(),
    'constraints', jsonb_build_object('maxQuestions', 50, 'types', '["single","multi","ox","short"]'::jsonb, 'pointsRange', '[1,10]'::jsonb));
end $$;

create or replace function public.exam_draft_put(p_slug text, p_node bigint, p_exam jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.rooms; n public.goal_nodes; x public.exams; v_uid uuid := public.current_user_id();
  v_qs jsonb; v_warn jsonb := '[]'::jsonb; v_types jsonb; e jsonb;
begin
  select * into r, n from public.exam_editable_leaf(p_slug, p_node);
  select * into x from public.exams where node_id = n.id;
  if x.status = 'PUBLISHED' then perform public.fail('EXAM_PUBLISHED', '발행된 시험은 AI 초안으로 덮어쓸 수 없어요 · 웹에서 초안으로 되돌리거나 새 과제를 만들어 주세요'); end if;
  if public.exam_submitted_count(n.id) > 0 then perform public.fail('EXAM_LOCKED', '제출된 응시가 있어 문항을 바꿀 수 없어요'); end if;
  v_qs := public.exam_validate(p_exam);
  if jsonb_array_length(v_qs) < 1 then perform public.fail('VALIDATION_FAILED', '문항을 하나 이상 넣어 주세요', '{"field":"questions"}'::jsonb); end if;
  insert into public.exams (node_id, room_id, created_by) values (n.id, r.id, v_uid) on conflict (node_id) do nothing;
  perform public.exam_replace_questions(n.id, v_qs, 'AI');
  if x.brief is not null then
    if (x.brief ->> 'count')::int <> jsonb_array_length(v_qs) then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'COUNT_MISMATCH', 'message', format('브리프는 %s문항인데 %s문항이 왔어요', x.brief ->> 'count', jsonb_array_length(v_qs))));
    end if;
    v_types := coalesce(x.brief -> 'types', '[]'::jsonb);
    if jsonb_array_length(v_types) > 0 and exists (select 1 from jsonb_array_elements(v_qs) q where not v_types ? lower(q ->> 'type')) then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'TYPE_NOT_IN_BRIEF', 'message', '브리프에 없는 문항 유형이 섞여 있어요'));
    end if;
  end if;
  return jsonb_build_object('questionCount', jsonb_array_length(v_qs),
                            'totalPoints', (select sum((q ->> 'points')::int) from jsonb_array_elements(v_qs) q), 'warnings', v_warn);
end $$;
-- 두 함수는 api_invoke 전용(GRANT 없음). 웹은 exam_brief_put·exam_put 을 쓴다
```

그 뒤 `api_scope_of`(0033 판 복사 + 2줄)·`api_invoke`(0035 판 복사 + Interfaces 의 ①②③). 파일 머리 주석의 재정의 원본 목록에 둘을 적는다.

- [ ] **Step 4: 통과 + 전체 회귀 + 커밋**

```bash
cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db && npm run lint && npx tsc --noEmit && git commit -m "feat(db): 0037 (4/4) AI 브리프·초안 op(exam_get_brief·exam_draft_put) api_invoke 연결

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- supabase/migrations/0037_round_exam.sql supabase/tests/round-exam-sql.test.ts supabase/tests/api-invoke-sql.test.ts
```

---

### Task 5: 웹 순수 모듈 — 타입·어댑터 `src/lib/api/exam.ts` · 순수 로직 `src/components/my-study/exam.ts` (sonnet)

**Files:**
- Modify: `src/lib/api/types.ts`(`NodeDto.exam`, `ExamView`·`ExamQuestion`·`ExamBrief`·`ExamResults`, `NOTIFICATION_KINDS` + `"EXAM_PUBLISHED"` `// 0037`)
- Create: `src/lib/api/exam.ts`, `src/lib/api/exam.test.ts`
- Create: `src/components/my-study/exam.ts`, `src/components/my-study/exam.test.ts`
- Modify: `src/components/my-study/model.ts`(`LeafNode.exam: NodeDto["exam"] | null` — `toTree` 가 DTO 값을 그대로 싣는다; `fixtures.ts` 리프에 `exam: null`)

**Interfaces:**
```ts
// types.ts
export type ExamQType = "single" | "multi" | "ox" | "short";
export type ExamReveal = "after_submit" | "after_deadline";
export type ExamSummary = { status: "draft" | "published"; questionCount: number; totalPoints: number; reveal: ExamReveal };
export type ExamQuestion = { id: string; ord: number; type: ExamQType; prompt: string; choices: string[] | null; points: number; answer?: unknown; explanation?: string };
export type ExamBrief = { topic: string; theory?: string; count: number; types: ExamQType[]; difficulty: "easy" | "normal" | "hard"; note?: string };
export type ExamAttempt = { status: "in_progress" | "submitted"; answers: Record<string, unknown>; score: number | null; maxScore: number | null; correctCount: number | null;
  submittedAt: string | null; isLate: boolean | null; results: Record<string, { correct: boolean; earned: number }> | null };
export type ExamViewerReason = "not_published" | "not_started" | "archived" | "not_assignee" | "submitted" | "room_not_active";
export type ExamView = { today: string; node: { id: string; title: string; startDate: string; endDate: string; archived: boolean };
  exam: ExamSummary & { publishedAt: string | null; source?: "manual" | "ai"; locked?: boolean; submittedCount?: number; brief?: ExamBrief | null };
  viewer: { canEdit: boolean; isAssignee: boolean; canTake: boolean; reason: ExamViewerReason | null };
  questions: ExamQuestion[] | null; attempt: ExamAttempt | null };
export type ExamResults = { submitted: number; assigned: number; maxScore: number; avg: number | null; max: number | null;
  questions: { id: string; ord: number; type: ExamQType; points: number; correctRate: number | null }[];
  members: (Person & { status: TaskStatus; score: number | null; submittedAt: string | null; isLate: boolean | null })[] };
// NodeDto 에 `exam?: ExamSummary | null;  // 0037`

// src/lib/api/exam.ts — 어댑터(0037). 컴포넌트는 이 파일만 부른다
export type ExamDraftQuestion = { type: ExamQType; prompt: string; choices: string[]; answer: number | number[] | boolean | string[]; explanation: string; points: number };
export type ExamDraft = { reveal: ExamReveal; questions: ExamDraftQuestion[] };
export const fetchExam = (slug: string, nodeId: string, client?: Db) => rpc<ExamView>("exam_get", { p_slug: slug, p_node: Number(nodeId) }, client);
export const putExam = (slug: string, nodeId: string, draft: ExamDraft, client?: Db) => rpc<ExamView>("exam_put", { p_slug: slug, p_node: Number(nodeId), p_exam: toContract(draft) }, client);
export const publishExam = (slug: string, nodeId: string, on: boolean, client?: Db) => rpc<ExamView>(on ? "exam_publish" : "exam_unpublish", { p_slug: slug, p_node: Number(nodeId) }, client);
export const putExamBrief = (slug: string, nodeId: string, brief: ExamBrief, client?: Db) => rpc<ExamView>("exam_brief_put", { p_slug: slug, p_node: Number(nodeId), p_brief: brief }, client);
export const saveExamAnswer = (nodeId: string, questionId: string, answer: unknown, client?: Db) => rpc<{ savedAt: string; answered: number; total: number }>("exam_answer_save", { p_node: Number(nodeId), p_question: Number(questionId), p_answer: answer }, client);
export const submitExam = (nodeId: string, client?: Db) => rpc<ExamView>("exam_submit", { p_node: Number(nodeId) }, client);
export const fetchExamResults = (slug: string, nodeId: string, client?: Db) => rpc<ExamResults>("exam_results", { p_slug: slug, p_node: Number(nodeId) }, client);
export const fetchExamAttempt = (slug: string, nodeId: string, userId: string, client?: Db) => rpc<ExamView>("exam_attempt_get", { p_slug: slug, p_node: Number(nodeId), p_user: userId }, client);
/** 서버 ExamView.questions(편집자 모양) → 편집 초안. answer 가 없으면(비편집자) 빈 초안 */
export function toDraft(v: ExamView): ExamDraft;
/** 초안 → sgtudy.exam/v1 (서버 exam_validate 와 같은 모양; single/ox/short 는 choices 제거) */
export function toContract(d: ExamDraft): { reveal: ExamReveal; questions: unknown[] };
/** JSON 붙여넣기 가져오기(스펙 §4.2 AI 탭): 문자열 → ExamDraft | {error: 한국어}. 서버 규칙의 클라이언트 사전 검사(길이·개수·범위·유형). 코드블록 ``` 감싸기·앞뒤 설명 문장 허용(첫 '{' 부터 마지막 '}' 까지) */
export function parseExamJson(text: string, reveal: ExamReveal): { ok: true; draft: ExamDraft } | { ok: false; error: string };
/** 저장 전 클라이언트 검증 — 서버와 같은 문구. 첫 오류만 {index, field, message} */
export function validateDraft(d: ExamDraft): { index: number; field: string; message: string } | null;

// src/components/my-study/exam.ts — 순수 로직(React 무관)
export const QTYPE_KO: Record<ExamQType, string> = { single: "객관식", multi: "복수 선택", ox: "O/X", short: "단답" };
export const REVEAL_KO: Record<ExamReveal, string> = { after_submit: "제출하면 바로", after_deadline: "마감 뒤" };
export const isAnswered = (a: unknown): boolean;                       // null/undefined/''/[] → false
export const answeredCount = (qs: ExamQuestion[], answers: Record<string, unknown>) => number;
/** 응시 화면 안내 문구(스펙 §4.3). canTake 면 null */
export function takeNote(v: ExamView, personalQuiet: boolean): string | null;   // not_published "아직 발행되지 않은 시험이에요" · not_started "MM.DD 부터 풀 수 있어요" · archived "보관된 시험이에요" · not_assignee → 기존 notAssignedText(false) (quiet 면 null) · room_not_active "스터디가 진행 중일 때 풀 수 있어요"
/** 결과 카드 요약 "4/5점 (80%) · 3/4 문항 정답" · 공개 전이면 "4/5점 (80%) · 정답·해설은 MM.DD 마감 뒤에 열려요" */
export function resultSummary(v: ExamView): { headline: string; sub: string | null };
/** 제출 확인 문구: 미답 n → "답하지 않은 n문항이 있어요 · 제출하면 다시 풀 수 없어요", 0 → "제출하면 다시 풀 수 없어요" */
export const submitAsk = (unanswered: number) => string;
/** 문항별 표시 상태: 내 답·정답·정오 (결과 화면). reveal 전이면 correct null·answer undefined */
export function questionResult(q: ExamQuestion, a: ExamAttempt | null): { mine: unknown; answer: unknown; correct: boolean | null; earned: number | null };
/** 편집 화면 잠금 문구(locked·submittedCount) */
export const lockText = (n: number) => `${n}명이 제출해 문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요`;
/** AI 탭 지시문(스펙 §4.2) — slug·과제 id·브리프 요약으로 Claude Code 에 붙여 넣을 텍스트 */
export function aiInstruction(slug: string, nodeId: string, title: string, brief: ExamBrief | null): string;
/** 초안 편집 리듀서(불변): add(type) · remove(i) · move(i, dir) · patch(i, partial) · choiceAdd/Remove/Set · setAnswer — 구조 잠금이면 type/choices/answer/points/add/remove/move 거부(그대로 반환) */
export function draftReduce(d: ExamDraft, locked: boolean, action: DraftAction): ExamDraft;
export const EMPTY_DRAFT: ExamDraft = { reveal: "after_submit", questions: [] };
export const newQuestion = (type: ExamQType): ExamDraftQuestion;      // single/multi 보기 4개 빈 문자열·answer 0/[]; ox true; short [""]
export const draftDirty = (a: ExamDraft, b: ExamDraft) => boolean;    // JSON 비교
```

- [ ] **Step 1: 테스트** — `exam.test.ts`(lib): `toContract` 가 single 의 `choices` 유지·ox 의 `choices` 제거·short `answer` 배열 trim; `parseExamJson` 이 ```json 코드블록·앞뒤 문장을 벗기고, 51문항·보기 1개·answer 범위 밖·모르는 type 을 한국어 오류로; `validateDraft` 첫 오류. `exam.test.ts`(components): `answeredCount`(''·[]·null 미답), `takeNote` 6개 사유, `resultSummary` 공개 전/후, `submitAsk`, `questionResult` multi 정오, `draftReduce` 잠금 시 구조 변경 무시·prompt 변경 허용, `aiInstruction` 에 slug·id·`get_exam_brief`·`create_exam_draft` 포함, `newQuestion` 기본값.

- [ ] **Step 2: 실패 확인** → **Step 3: 구현** → **Step 4: `npx vitest run src/lib/api/exam.test.ts src/components/my-study/exam.test.ts` PASS · `npx tsc --noEmit`** → **Step 5: 커밋** `feat(web): 시험 어댑터·타입·순수 로직(exam.ts)`.

---

### Task 6: 과제 추가 — 종류 세그먼트(과제/시험) · 생성 흐름 (sonnet)

**Files:**
- Modify: `src/components/my-study/tabs/QuickAdd.tsx`, `QuickAdd.dom.test.ts`
- Modify: `src/components/my-study/useCurriculumApi.ts`(`create(parent, {title, open, taskType, exam?: true})`), `useCurriculumApi.dom.test.ts`
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx:338`·`EditView.tsx:468`·`ChildList.tsx`(onAdd 시그니처에 `exam` 전달)
- Modify: `src/components/my-study/tabs/TreeRow.tsx`·`bits.tsx`(`ExamBadge`: "시험" + 초안이면 "초안" — `n.exam` 있을 때 `TypeBadge` 옆)

**Interfaces:**
```ts
// QuickAdd: onAdd(title, type?, kind?: "task" | "exam") — personal 은 kind 없음
// 종류 세그먼트 <Seg label="추가할 종류" options={[["task","과제"],["exam","시험"]]}/> 유형 세그먼트 앞. 시험이면 placeholder "시험 제목을 쓰고 Enter · Esc 닫기", 안내 줄 "시험은 초안으로 만들어져요 · 문제를 쓰고 발행해야 팀원에게 열려요"
// useCurriculumApi.create: exam 이면 nodeCreate → 응답 트리에서 새 리프 id(제목·부모로 찾기, 기존 justAdded 로직) → putExam(slug, id, EMPTY_DRAFT) → update({ curMode:"edit", editSel:id, editFrom:"list", justAdded:id, quickAdd:null }) 로 출제 화면으로. putExam 실패 시 토스트 "시험을 만들지 못했어요 · 과제는 추가됐어요" (리프는 남는다 — 편집 화면 「문제」 섹션에서 다시 만들 수 있다)
```

- [ ] **Step 1: DOM 테스트** — 종류 세그먼트 렌더·"시험" 선택 시 안내 줄·Enter 가 `onAdd(t, "공통", "exam")`; personal 톤에는 종류 세그먼트 없음. `useCurriculumApi` 테스트: `create(..., {exam:true})` 가 `node_create` 뒤 `exam_put` 을 부르고 `editSel` 을 새 id 로.
- [ ] **Step 2~4: 구현 · 게이트 · 커밋** `feat(my-study): 과제 추가에 시험 종류 · 트리 시험 배지`.

---

### Task 7: 출제 화면 — `EditView` 「문제」 섹션 `ExamEditor`(수동 탭) · 발행 · 미저장 가드 (opus)

**Files:**
- Create: `src/components/my-study/tabs/ExamEditor.tsx`, `ExamEditor.dom.test.ts`
- Create: `src/components/my-study/tabs/ExamQuestionForm.tsx`(문항 1개 카드: 유형 select·문제 textarea·보기 목록(라디오/체크 = 정답)·OX 토글·단답 허용 답 칩·해설·배점·⋯ 위/아래/삭제)
- Create: `src/components/my-study/useExamEditor.ts`(`fetchExam` → `toDraft` → `draftReduce` 상태 · `save()`=`putExam` · `publish()` · `dirty`)
- Modify: `src/components/my-study/tabs/EditView.tsx`(시험 리프(`n.leaf && n.exam`)면 담당자 블록 아래 `<ExamEditor …/>`; `onExamDirty` 를 `update({ uploading: dirty ? n.id : null })` 와 같은 경로로 `S.examDirty` 로 올린다)
- Modify: `src/components/my-study/state.ts`(`examDirty: string | null` + `editUnsaved` 에 포함), `state.test.ts`

**UI(스펙 §4.2):** 머리 줄 "문제 · 초안/발행됨 · n문항 · m점 · [발행]/[초안으로]" · 탭 [직접 작성][AI 로 생성](Task 8) · 문항 카드 목록 · [+ 문항 추가 ▾] · 공개 라디오 · [문제 저장](h-11 전체폭, dirty 아닐 때 비활성). 잠김이면 구조 입력 `aria-disabled` + `lockText`. 발행은 `InlineConfirm`("팀원 n명에게 알림이 가요") 뒤 `publishExam(true)`; 문항 0 이면 비활성 + 이유. 발행된 뒤 초안으로 되돌리기는 제출 0 일 때만(서버 `EXAM_LOCKED` → 토스트).

- [ ] **Step 1: DOM 테스트** — 초안 4문항 렌더(유형별 입력), 정답 라디오 변경 → `putExam` 호출 인자에 반영, 잠김 상태에서 유형 select `aria-disabled`·추가 버튼 없음, 문항 0 발행 버튼 `disabled`, `dirty` 콜백.
- [ ] **Step 2~4: 구현 · 게이트 · 브라우저 확인(390/820: 보기 행 44px, 가로 스크롤 없음) · 커밋** `feat(my-study): 시험 출제 화면(수동)·발행·미저장 가드`.

---

### Task 8: AI 탭 — 브리프 저장 · 지시문 복사 · 초안 불러오기 · JSON 붙여넣기 (sonnet)

**Files:**
- Create: `src/components/my-study/tabs/ExamAiTab.tsx`, `ExamAiTab.dom.test.ts`
- Modify: `ExamEditor.tsx`(탭 전환)

**UI(스펙 §4.2 AI 탭):** 주제·기반 이론(textarea, 20,000자 카운터)·문항 수·난이도 세그먼트·유형 체크 4개·참고 · [브리프 저장](`putExamBrief`) · "AI 에게 넘기기" 안내 2단계(① `/me` 「AI 연결」 토큰 + MCP 연결 — Task 11 전엔 "곧 제공" 문구 대신 **JSON 붙여넣기 안내를 먼저**) · 지시문 박스(`aiInstruction`) + [지시문 복사](`navigator.clipboard`, 실패 시 선택 가능한 textarea) · [초안 새로 불러오기](`fetchExam` → `toDraft` → 수동 탭 교체, dirty 면 `InlineConfirm` "작성 중인 문항을 AI 초안으로 바꿀까요?") · "MCP 없이: JSON 붙여넣기" textarea + [가져오기](`parseExamJson` → 수동 탭 초안으로, 오류는 한국어 한 줄).

- [ ] **Step 1: DOM 테스트** — 브리프 폼 저장 인자, 지시문에 slug·id, 붙여넣기 오류 문구, 가져오기 성공 시 `onDraft` 호출.
- [ ] **Step 2~4: 구현 · 게이트 · 커밋** `feat(my-study): 시험 AI 탭(브리프·지시문·JSON 가져오기)`.

---

### Task 9: 응시 · 결과 화면 `ExamSection`(`LeafBody` 분기) (opus)

**Files:**
- Create: `src/components/my-study/tabs/ExamSection.tsx`, `ExamSection.dom.test.ts`
- Create: `src/components/my-study/tabs/ExamQuestionView.tsx`(문항 1개: 응시 모드 입력 / 결과 모드 내 답·정답·정오·해설 `<details>`)
- Create: `src/components/my-study/useExamTake.ts`(`fetchExam`·답 상태·`saveExamAnswer` 400ms 디바운스·`answered/total`·`submitExam`·오류 토스트·재시도)
- Modify: `src/components/my-study/tabs/LeafBody.tsx`(`n.exam` 이면 `NodeAttachments` 뒤 `ExamSection`, `SubmissionSection` 대신 — 단 제출 현황은 `SubmissionStatusList` 를 `ExamSection` 안에서 재사용(`useTaskDetail` 의 rows, 점수 없음))
- Modify: `src/components/my-study/tabs/DetailView.tsx`(머리 `kind` "시험", 메타 줄 "· n문항 m점")

**UI(스펙 §4.3·4.4):** 상태별 안내(`takeNote`) → 응시(문항 목록 + `sticky bottom-0` 막대 "n/총 답함 · 저장됨/저장 중…/저장 실패 [다시 시도]" + [제출하기] h-11) → `InlineConfirm(submitAsk)` → 결과 카드(`resultSummary`) + 문항별 결과 + 제출 현황. 제출 뒤 `onSubmitted()`(기존 커리큘럼 재조회). 입력 요소: single 라디오·multi 체크·ox 두 버튼(`aria-pressed`)·short `input maxLength=200`. 모두 `min-h-11`. Esc 는 입력 안에서 나가기 아님(DetailView 규칙 그대로).

- [ ] **Step 1: DOM 테스트** — reason 별 안내, 응시 모드 4유형 입력 렌더, 미답 2 → 확인 문구, 결과 모드 정오·해설, `after_deadline` 마감 전 점수만(해설 없음·"MM.DD 마감 뒤에 열려요").
- [ ] **Step 2~4: 구현 · 게이트 · 브라우저 확인(390: 하단 막대가 입력을 가리지 않게 `pb-20`) · 커밋** `feat(my-study): 시험 응시·결과·해설 화면`.

---

### Task 10: 편집자 결과 보기 `ExamResults` (sonnet)

**Files:**
- Create: `src/components/my-study/tabs/ExamResults.tsx`, `ExamResults.dom.test.ts`
- Modify: `ExamSection.tsx`(`viewer.canEdit` 면 하단 「결과」 섹션 — `fetchExamResults`; 멤버 [답안 ▸] → `fetchExamAttempt` 로 그 사람의 `ExamQuestionView` 결과 모드(읽기 전용) 인라인 펼침)

**UI(스펙 §4.5):** 요약 줄 · 문항별 정답률(`ProgressBar` 재사용, 2열 grid, 390 은 1열) · 멤버 표(점수·제출일·지각·[답안 ▸], 미제출 "—").

- [ ] **Step 1: DOM 테스트** — 요약·정답률·미제출 표기·[답안 ▸] 클릭 시 `fetchExamAttempt` 호출.
- [ ] **Step 2~4: 구현 · 게이트 · 커밋** `feat(my-study): 시험 결과 보기(편집자)`.

---

### Task 11: MCP 도구 `get_exam_brief`·`create_exam_draft` + prompt `draft-exam` (opus · **AI 플랜 Task 8 뒤**)

**Files:**
- Modify: `src/lib/mcp/tools.ts`, `tools.test.ts`(도구 7 → 9), `src/lib/mcp/prompts.ts`(prompt 1 → 2)

**Interfaces:** AI 플랜 Task 8 의 `ToolDef` 형식. `get_exam_brief(study, task)`(readOnly, op `exam_get_brief`; `task` = 숫자 id 또는 제목 정확 일치 — 제목 해석은 `get_curriculum` 과 같은 TS 측 해석기 재사용, 유일할 때만) → 텍스트: 브리프 줄 + 계약 전문. `create_exam_draft(study, task, exam)`(idempotent, op `exam_draft_put`, `exam` 은 zod 로 §3.2 모양) → "초안 저장 — n문항 m점 · 경고 … · 웹에서 검토·발행: {origin}/my-study/{slug}?tab=curriculum&item={id}". prompt `draft-exam(study, task)` = "get_exam_brief 로 읽고 … 계약대로 create_exam_draft" 지침(정적).

- [ ] Step 1 테스트(도구 이름·annotations·텍스트 포맷) → 구현 → 게이트 → 커밋 `feat(mcp): 시험 브리프 읽기·초안 저장 도구`.

---

### Task 12: 배포 안내 · 마무리 (mechanical · sonnet)

- [ ] **Step 1: 전체 게이트** — `npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run` 모두 통과.
- [ ] **Step 2: 시나리오(로컬 supabase + dev 서버, ego-browser, 마스터 계정)** — aws 3주차에 시험 추가 → 4문항 작성 → 발행(알림 3건) → 지은으로 390 에서 응시·중간 저장·새로고침 뒤 답 유지·제출 → 점수·해설 → 민수 결과 표·지은 답안 → `after_deadline` 시험 하나 더 만들어 제출 뒤 점수만 보이는지. 스크린샷 390/820/1440.
- [ ] **Step 3: 배포 노트** — 컨트롤러에 전달: `supabase db push`(0037) 는 사용자 승인 후 사용자가. 호스티드 `authenticated` 역할 `statement_timeout`(8s) 안에 `exam_submit`(문항 50 × 채점)이 끝나는지 로컬에서 `explain analyze` 로 확인한 값 적기. AI 경로는 Task 11 전까지 "JSON 붙여넣기" 임을 README/릴리스 노트에 한 줄.

---

## 결정에 따른 변경 (스펙 §8 — 권장안 아닌 쪽을 고를 때만)

| 결정 | 다른 선택 | 바뀌는 Task |
|---|---|---|
| D1 | `task_type = 'EXAM'` | Task 1(체크 제약·`node_create_core` 재정의) · Task 3(`curriculum_json` 외 `me_schedule_leaves`·`room_leaf_stats`·`assignment_resync` 등 `task_type in (…)` 전부) — **권장하지 않음** |
| D2 | 합격선 | Task 1 `exams.pass_score int` · Task 2 `exam_submit` 이 `score < pass_score` 면 submissions 를 만들지 않고 `attempt.passed=false`(재응시 필요 → D3 도 바뀐다) · Task 9 결과 배지 |
| D3 | 재응시 허용 | Task 1 `exam_attempts.no int` + unique(node,user,no) · Task 2 `exam_submit` 이 submissions 는 첫 제출에만 · Task 9 "다시 풀기" |
| D4 | 항상 제출 직후 | Task 1 `reveal` 열·검증 제거 · Task 2 `exam_reveal_ok` 단순화 · Task 7 라디오 제거 |
| D6 | 자유 수정 + 재채점 | Task 1 `exam_replace_questions` 잠금 제거 + Task 2 에 `exam_regrade(node)`(제출된 attempt 전부 재채점·점수 변경 알림 kind 추가) |
| D7 | 점수 전원 공개 | Task 3 `exam_results` 를 멤버에게도 + Task 9 제출 현황에 점수 열 |
| D8 | 서버 Claude API(B안) | 새 Task: `src/app/api/exam/generate/route.ts`(Node 런타임, `@anthropic-ai/sdk` 의존성 추가 — Global Constraints 예외 승인 필요, `claude-opus-5-5`, `output_config.format` JSON 스키마 = §3.2, 스트리밍 `finalMessage()`, `ANTHROPIC_API_KEY` 서버 env, 본문 64KB, 사용자당 일 10회 표 `exam_ai_quota`, 결과는 `exam_draft_put` 으로 저장) + AI 탭 [AI 로 생성] 버튼. **`claude-api` 스킬을 읽고 쓴다** |
| D11 | `TASK_ASSIGNED` 재사용 | Task 1 Step 4 생략(재정의 3개 제거), `exam_publish` 가 `TASK_ASSIGNED` 로 보냄(문구 어색 — 권장하지 않음) |
| D13 | 복수 부분 점수 | Task 2 `exam_grade` MULTI: 맞힌 보기 비율 × points(내림) · Task 9 표시 "1/2점" |
