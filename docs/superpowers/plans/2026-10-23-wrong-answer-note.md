# 오답노트(내 스터디 탭) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내 스터디에 「오답노트」 탭. 내가 제출한 시험의 오답(미답 포함)을 회차별로 모아 보여 주고, 문항마다 정답·해설을 접었다 펼치며, 문항 하나 또는 시험 묶음으로 **다시 풀기**(서버 채점·연습 기록, 공식 점수 불변)를 한다. 정답·해설이 공개되지 않은 시험(`after_deadline` 마감 전)은 서버가 잠금(개수만)으로 돌려준다. 「내 과제」(`/tasks`)에서도 「과제 · 오답노트」 보기 전환으로 **모든 스터디의 오답**을 스터디 칩 필터와 함께 보고, 같은 컴포넌트로 다시 풀기·해설을 쓴다.

**Architecture:** DB = 마이그레이션 1개 `0046_wrong_note.sql`(추가형). 표 1개 `exam_practice`(RLS on·정책 없음) + 인덱스 + RPC 4개(`wrong_note_list`·`wrong_note_mine`·`wrong_note_practice`·`wrong_note_master`). 목록 두 RPC 는 내부 `wrong_note_rounds(p_room, p_uid)` 하나를 부른다(노출 규칙 한 곳). 0037 의 `exam_reveal_ok`·`exam_grade`·`exam_answer_shape_ok`·`exam_answer_canon`·`exam_viewer_member` 를 **호출만** 하고 재정의는 0개. 웹 = 어댑터 `src/lib/api/wrongNote.ts` + 순수 로직 `src/components/my-study/wrongNote.ts` + **공용 목록 `src/components/my-study/WrongNoteList.tsx`**(`studies[]` 를 받아 스터디 h2 → 회차 h3 → 시험 카드 → 문항; 다시 풀기·해설·외움 포함) + 훅 `useWrongNote.ts`(로더를 인자로 받아 방·전체 공용) → 방 탭 `tabs/WrongNoteTab.tsx`(길이 1) · `/tasks` `tasks/TasksNotesView.tsx`(여러 개). 탭 등록은 `routes.MY_STUDY_TABS`·`StudyHeaderInfo.TABS`·`MyStudyScreen` 분기 1줄. `/tasks` 는 `calc.ts` `TasksFilter.view` + `TasksToolbar` Seg + `TasksScreen` 분기. `ExamQuestionView` 는 `explanationOpen` prop 추가만.

**Tech Stack:** Next.js 16.4.2 (App Router) · React 19 · Tailwind v4 · Supabase PG17(plpgsql `security definer set search_path=''`, `public.fail`) · vitest(`src/**/*.test.ts`, DOM 은 `// @vitest-environment jsdom`) · deno + PGlite SQL 테스트(`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-23-wrong-answer-note-design.md`(D1~D21 권장안). 결정이 바뀌면 맨 끝 "결정에 따른 변경" 표.

## 번호 (중요)

- 마이그레이션 번호는 **0046** 고정. 0045 는 md-images 작업이 쓴다(아직 파일이 없어도 0046 을 쓴다). `0046_*` 가 이미 있으면 멈추고 컨트롤러와 번호를 다시 정한다.
- 0037 함수 서명(복사하지 않고 호출만): `exam_reveal_ok(x public.exams, n public.goal_nodes, a public.exam_attempts) → boolean` · `exam_grade(q public.exam_questions, p_answer jsonb, out correct boolean, out earned int)` · `exam_answer_shape_ok(q, jsonb) → boolean` · `exam_answer_canon(q, jsonb) → jsonb` · `exam_is_answered(jsonb)` · `exam_viewer_member(r public.rooms, uid)` · `room_readable(room_id, uid)` · `require_user()` · `iso(timestamptz)` · `kst_today()` · `app_now()`.

## Global Constraints

- 마이그레이션은 **`0046_wrong_note.sql` 하나**. 0001~0045 수정 금지. 0037 함수 재정의 금지(호출만).
- 새 plpgsql 함수: `security definer set search_path = ''`, 객체는 `public.` 접두, 실패는 `perform public.fail(code, 한국어 문구, details)`. 공개 RPC 3개만 `grant execute … to authenticated`. 표는 `revoke all … from anon, authenticated`.
- **정답·해설 노출은 `wrong_note_list` 한 곳**, 판정은 `public.exam_reveal_ok` 호출. 숨길 때는 **키를 만들지 않는다**(`case when … then jsonb_build_object(...) else '{}'::jsonb end`).
- **연습은 `exam_attempts`·`exam_answers`·`submissions`·`exams` 에 쓰지 않는다.** 채점은 `exam_grade` 호출만. 클라이언트는 정오를 계산하지 않는다.
- 시간: `public.kst_today()`(테스트 `app.today`), `public.app_now()`(테스트 `app.now`).
- **건드리지 않는 파일**(다른 작업 진행 중): `ExamSection.tsx`·`ExamResults.tsx`·`SubmitPanel.tsx`·`markdown.ts`·`MarkdownView.tsx`. `MyStudyScreen.tsx` 는 탭 분기 한 줄만, exam-results-card 커밋 뒤에.
- `/tasks` 쪽은 `TasksScreen.tsx`·`TasksToolbar.tsx`·`calc.ts` 에 **보기 전환·필터 키 하나**만 더한다. 오답노트 본문은 `tasks/TasksNotesView.tsx` 로 뗀다. 과제 보기의 동작(정렬·완료 토글·개인 목표 추가)은 바꾸지 않는다 — `TasksScreen.order`·`stale` 테스트가 그대로 통과해야 한다.
- 연습·외움 응답에 `totals` 없음(D21). 머리줄은 항상 클라이언트 `totalsOf`.
- SQL 테스트는 `supabase/tests/*-sql.test.ts`(deno + PGlite, `_harness.ts`·`_fixtures.ts`·`_submit.ts`). 시드 기준일 `2026-10-12`. 시험은 `round-exam-sql.test.ts` 의 `newExamLeaf`·`Q4`·`put` 과 같은 방식으로 테스트 안에서 만든다(aws 3주차 `ALB vs NLB 실습` 옆, 담당 민수·지은·철수·하나).
- 문구는 스펙 §6 그대로(해요체). 용어: "오답노트", "다시 풀기", "채점", "외웠어요", "정답·해설".
- 한 페이지 스크롤: 새 안쪽 스크롤러 금지. 버튼·보기 행 ≥ 44px. 확인 폭 390 / 820 / 1440, 가로 스크롤 없음. 묶음 채점 막대는 `sticky bottom-0`.
- Supabase 는 `src/lib/api/*` 에서만 import. 새 npm 의존성 금지. 새 Next API 라우트 없음. Next 문서가 필요하면 `node_modules/next/dist/docs/` 를 읽는다(AGENTS.md).
- 서브에이전트 금지(각 작업자 스스로 실행).
- 메모리: dev 서버·빌드 전에 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나. dev 서버는 `npx next dev -p 3700`(먼저 `lsof -iTCP:3700 -sTCP:LISTEN -P`).
- 브라우저 확인은 `ego-browser` 스킬(자기 창). claude-in-chrome 금지.
- 호스티드 Supabase·Vercel 은 건드리지 않는다(`supabase db push` 는 사용자 승인 후 사용자가).
- 커밋 전 게이트: `npm run lint && npx tsc --noEmit && npx vitest run` (+ SQL 작업은 `npm run test:db`). 커밋은 `git commit -- <paths>` 로 자기 파일만(`.context/`·`AGENTS.md`·`docs/00-initial-planning.md` 금지). 메시지 끝:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  ```
- 줄 번호는 작성 시점 기준 — 인용한 코드 조각으로 위치를 찾는다.

## Review Focus

1. **잠긴 시험에 키가 없다** — `after_deadline` 마감 전 `wrong_note_list` 응답의 그 시험에 `items`·`question`·`answer`·`explanation` **키가 없다**(`"items" in exam === false`). 마감 뒤 열리고, 기간 연장하면 다시 잠긴다. → Task 1.
2. **본인만** — 남의 오답 id 로 `wrong_note_practice`·`wrong_note_master` 는 `WRONG_NOTE_NOT_IN`. `p_user` 인자가 없다. → Task 2.
3. **공식 기록 불변** — 연습 전후 `exam_attempts`·`exam_answers`·`submissions` 스냅샷이 같다. → Task 2.
4. **채점 단일 원천** — `wrong_note_practice` 가 `public.exam_grade` 를 부른다(자체 비교식 없음). 클라이언트 `wrongNote.ts` 에 정오 계산 함수가 없다. → Task 2·3.
5. **탭 키 한 곳** — `MY_STUDY_TABS` 에만 `"wrong"` 을 더하고 `TABS`·`screenKeyOf`·`settingsBackOf`·테스트가 따라온다. → Task 4.
6. **기본 상태에 정답 없음** — 문항 기본 렌더에 「정답」 태그가 없고, 「정답·해설 ▸」 를 열어야 보인다. `stripKey` 가 키를 **지운다**(undefined 대입 아님). → Task 5·6.
7. **ExamQuestionView 호환** — `explanationOpen` 기본값 false 로 기존 `ExamSection`·`ExamResults` 스냅샷·DOM 테스트가 그대로 통과. → Task 6.
8. **두 목록 RPC 가 같은 내부 함수** — `wrong_note_list`·`wrong_note_mine` 모두 `wrong_note_rounds` 를 부르고, 같은 방의 `rounds` 가 deepEqual. `wrong_note_mine` 에 PENDING·보관 방이 없다. → Task 1.
9. **`/tasks` 과제 보기 불변** — `?view=` 가 없으면 기존 화면과 DOM 이 같다(Seg 하나 추가 외). 오답노트 보기에서 다시 풀기 호출에 **그 카드의 slug** 가 들어간다. → Task 7.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음 (읽기만)

- [ ] **Step 1: 작업 트리·번호**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && git status --short && ls supabase/migrations | tail -3`
Expected: `supabase/migrations/0046_*` 없음. `src/components/my-study/tabs/ExamSection.tsx` 등 exam-results-card 의 변경이 아직 미커밋이면 **Task 4 의 `MyStudyScreen.tsx` 한 줄은 보류**(나머지 Task 는 진행). `0046_*` 가 있으면 멈추고 보고.

- [ ] **Step 2: 호출할 0037 함수 서명 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && grep -nE "create or replace function public\.(exam_reveal_ok|exam_grade|exam_answer_shape_ok|exam_answer_canon|exam_is_answered|exam_viewer_member|exam_closed)\(" supabase/migrations/*.sql`
Expected: 전부 `0037_round_exam.sql` 한 곳(이후 재정의 없음). 다른 파일에 재정의가 있으면 그 판의 서명을 쓴다.

- [ ] **Step 3: 게이트 기준선**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 모두 통과. 실패하면 멈추고 보고(다른 작업의 미커밋 변경 때문일 수 있다 — 어느 테스트인지 적는다).

---

### Task 1: 0046 (1/2) — 표 · 인덱스 · `wrong_note_list` · `wrong_note_mine` (opus)

**Files:**
- Create: `supabase/migrations/0046_wrong_note.sql`
- Create: `supabase/tests/wrong-note-sql.test.ts`

**Interfaces:**
- 표 `public.exam_practice`(스펙 §4.1 DDL 그대로) + `ix_exam_practice_user_node` + `ix_exam_attempts_user`
- 내부(GRANT 없음): `wrong_note_room(p_slug text, p_uid uuid) → public.rooms`(slug·`room_readable`·`exam_viewer_member` 관문, 실패 `ROOM_NOT_FOUND`) · `wrong_note_practice_json(p public.exam_practice) → jsonb`(`{lastCorrect, correctCount, wrongCount, lastAnswer, lastAt}`, 행 없으면 null) · `wrong_note_totals(p_room bigint, p_uid uuid) → jsonb`(`{wrong, retriedOk, mastered, locked}`) · `wrong_note_has_exam(p_room bigint) → boolean` · `wrong_note_root(p_node bigint) → public.goal_nodes`(재귀로 루트) · **`wrong_note_rounds(p_room bigint, p_uid uuid) → jsonb`**(스펙 §4.2 `rounds` 배열 — 노출 규칙은 여기 한 곳)
- RPC `wrong_note_list(p_slug text) → jsonb`(스펙 §4.2 — 관문 + `rounds`·`totals`·`hasExam` 조립) · **`wrong_note_mine() → jsonb`**(스펙 §4.2-b — 내 방 전부, 방마다 같은 세 함수), 둘 다 `authenticated`

- [ ] **Step 1: 실패하는 테스트 작성** — `supabase/tests/wrong-note-sql.test.ts`

`round-exam-sql.test.ts` 상단의 `as`·`rpc`·`newExamLeaf`·`Q4`·`put` 을 그대로 복사(import 는 못 한다 — 그 파일은 테스트 본문). 지은의 응시 헬퍼를 추가한다:

```ts
/** 지은이 풀고 제출 — answers 는 문항 ord 순 [단일, 복수, OX, 단답] (null = 미답). 시험은 발행돼 있어야 한다 */
async function takeAs(q: Q, nick: string, node: string, answers: unknown[]) {
  await as(q, nick);
  const qs = await q("select id::text as id from public.exam_questions where node_id = $1::bigint order by ord", [node]);
  for (let i = 0; i < qs.length; i++) if (answers[i] !== null)
    await q("select public.exam_answer_save($1::bigint, $2::bigint, $3::jsonb)", [node, qs[i].id, JSON.stringify(answers[i])]);
  return (await rpc(q, "public.exam_submit($1::bigint)", [node])) as Row;
}
const list = (q: Q) => rpc(q, "public.wrong_note_list('aws')");
```

케이스(스펙 §8 SQL 1~3·6 일부·8):
- `exam_practice closed to clients · RLS on`(0037 테스트 1 과 같은 형식).
- `list: wrong + unanswered, ord order, keys present, mine, round title` — 민수가 시험 만들고 `put(Q4)`·`exam_publish`, `setToday('2026-10-16')`, 지은 `takeAs(..., [1, [0], null, "igw"])`(1번 오답·2번 오답·3번 미답·4번 정답) → `list()`: `rounds.length===1`, `rounds[0].title` 이 3주차 루트 제목(`select title from goal_nodes where id = (select parent_id … )` 로 루트 구해 비교), `exams[0].items.length===3`, `items.map(i=>i.no)` = `[1,2,3]`, `items[0].question.answer===0`, `typeof items[0].question.explanation==="string"`, `items[0].mine===1`, `items[2].mine===null`, `items[0].practice===null`, `items[0].mastered===false`, `exams[0].score===1 && maxScore===5`, `totals.wrong===3`, `hasExam===true`.
- `list: perfect exam omitted · no exam room → hasExam false` — 철수가 전부 맞히고 제출 → 철수의 `list()` 는 `rounds=[]`, `hasExam=true`, `totals.wrong=0`. 시험 만들기 전 시점(다른 케이스 — 각 case 는 롤백)에서 `hasExam=false`.
- `list: after_deadline locked before deadline · opens after · relocks on extend` — `put({...Q4, reveal:"after_deadline"})`·발행, 지은 제출(2문항 오답). `setToday('2026-10-20')` → `exams[0].locked===true`, `lockedCount===2`, `unlockDate==="2026-10-21"`, **`assertEquals("items" in exams[0], false)`**, `totals.locked===2`, `totals.wrong===0`. `setToday('2026-10-22')` → `locked===false`, `items.length===2`. 민수가 `node_update` 로 `end_date` 를 `2026-10-25` 로 연장(0028 `node_update(slug, id, patch)` — 기존 테스트에서 호출 모양을 확인해 그대로) → 다시 `locked===true`.
- `list: archived leaf omitted` — 지은 제출 뒤 민수 `node_archive` → 지은 `list()` 에 그 시험 없음.
- `list: non-member ROOM_NOT_FOUND · pending viewer` — spring 전용 멤버(시드에서 aws 에 없는 사람, `_fixtures` 확인 — 없으면 `asAnon` 과 새 가입자)로 `expectFail(list(q), "ROOM_NOT_FOUND")`. PENDING(시드의 aws 승인 대기자가 있으면 그 사람, 없으면 이 케이스는 `viewer` 문자열 검사만 남기고 `TODO` 로 적는다) → `viewer==="pending"`, `rounds` 없음.
- `mine: all my rooms · same rounds as list · order · no pending/archived · anon`(스펙 §8 SQL 9) — 지은이 aws 시험 오답 → `public.wrong_note_mine()`: `studies.length` = 지은의 참가 방 수(시드 `me_studies` 로 기대값: `select jsonb_array_length(...)` 로 뽑아 비교), `studies.find(s=>s.slug==='aws').rounds` 가 `list().rounds` 와 `assertEquals`(deepEqual), 시험 없는 방 `hasExam===false`·`rounds=[]`, 각 `s.tone`·`s.title`·`s.status` 가 `me_tasks().studies` 의 같은 slug 와 같음, 순서 = `me_studies(false)` 의 slug 순. 보관 방(시드에 있으면)·PENDING 방 없음. `asAnon` → `AUTH_REQUIRED`.

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db -- wrong-note` (실행 방식은 `package.json` 의 `test:db` 스크립트대로 — 파일 필터가 안 되면 전체)
Expected: `function public.wrong_note_list(text) does not exist` 류로 실패.

- [ ] **Step 2: 마이그레이션 작성** — `supabase/migrations/0046_wrong_note.sql`

머리 주석은 0044 형식(날짜·스펙 경로·"추가형"·절 목차). 절: 1 스키마 · 2 내부 헬퍼 · 3 읽기 RPC(방·전체) · (Task 2 가 4 연습 · 5 외움 · 6 GRANT 를 덧붙인다).

`wrong_note_rounds(p_room, p_uid)` 가 아래 `with mine … select … into v_rounds` 전체를 갖고 `v_rounds` 를 돌려준다. 두 RPC 는 껍데기:

```sql
create or replace function public.wrong_note_list(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.wrong_note_room(p_slug, v_uid);       -- ROOM_NOT_FOUND · PENDING 은 통과(아래서 분기)
  if exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status = 'PENDING')
     and r.leader_id <> v_uid then
    return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'viewer', 'pending', 'hasExam', false,
                              'totals', jsonb_build_object('wrong', 0, 'retriedOk', 0, 'mastered', 0, 'locked', 0), 'rounds', '[]'::jsonb);
  end if;
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'viewer', 'member',
    'hasExam', public.wrong_note_has_exam(r.id), 'totals', public.wrong_note_totals(r.id, v_uid), 'rounds', public.wrong_note_rounds(r.id, v_uid));
end $$;

-- 내 방 전부(D18) — me_studies(false) 와 같은 자격·순서. 방마다 wrong_note_list 와 같은 세 함수
create or replace function public.wrong_note_mine() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'studies', (select coalesce(jsonb_agg(jsonb_build_object('slug', r.slug, 'title', r.title, 'tone', <me_tasks 의 tone 식>, 'status', <me_tasks 의 status 식>,
                   'hasExam', public.wrong_note_has_exam(r.id), 'totals', public.wrong_note_totals(r.id, v_uid), 'rounds', public.wrong_note_rounds(r.id, v_uid))
                 order by <me_studies 의 order by>), '[]'::jsonb)
                from public.rooms r
                where r.archived_at is null and (r.leader_id = v_uid or exists (
                  select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status in ('ACTIVE', 'INACTIVE')))));
end $$;
```

`<…>` 자리는 Task 0 Step 2 에서 `me_tasks`(0042)·`me_studies`(0032) 의 실제 식을 읽어 **그대로** 쓴다(tone·status 문자열·정렬이 `/tasks` 스터디 칩과 같아야 한다).

`wrong_note_rounds` 본문(plpgsql, `security definer set search_path = ''`):

```sql
  -- 내가 제출한 시험(보관 제외) 하나당 한 행. 잠금은 exam_reveal_ok(행 전체를 넘긴다)
  with mine as (
    select a, x, n, public.wrong_note_root(n.id) as root, public.exam_reveal_ok(x, n, a) as open
    from public.exam_attempts a
    join public.exams x on x.node_id = a.node_id
    join public.goal_nodes n on n.id = a.node_id
    where a.user_id = v_uid and a.status = 'SUBMITTED' and x.room_id = r.id and n.archived_at is null),
  ex as (
    select (root).id as root_id, (root).title as root_title, (root).sort_order as root_ord, (n).sort_order as leaf_ord,
      jsonb_build_object('nodeId', (n).id::text, 'title', (n).title, 'endDate', to_char((n).end_date, 'YYYY-MM-DD'),
        'reveal', lower((x).reveal), 'score', (a).score, 'maxScore', (a).max_score, 'correctCount', (a).correct_count,
        'questionCount', (x).question_count, 'locked', not open)
      || case when open then jsonb_build_object('items', (
             select coalesce(jsonb_agg(jsonb_build_object(
               'question', jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'prompt', q.prompt_md,
                                              'choices', q.choices, 'points', q.points, 'answer', q.answer, 'explanation', q.explanation_md),
               'no', q.ord + 1, 'mine', e.answer, 'practice', public.wrong_note_practice_json(p), 'mastered', p.mastered_at is not null)
               order by q.ord), '[]'::jsonb)
             from public.exam_answers e join public.exam_questions q on q.id = e.question_id
             left join public.exam_practice p on p.user_id = v_uid and p.question_id = q.id
             where e.attempt_id = (a).id and e.is_correct = false))
         else jsonb_build_object('lockedCount', greatest((x).question_count - coalesce((a).correct_count, 0), 0),
                                 'unlockDate', to_char((n).end_date, 'YYYY-MM-DD')) end as j,
      open, (a).correct_count as cc, (x).question_count as qc
    from mine)
  select coalesce(jsonb_agg(jsonb_build_object('id', g.root_id::text, 'title', g.root_title, 'exams', g.exams) order by g.root_ord, g.root_id), '[]'::jsonb)
  into v_rounds
  from (select root_id, root_title, root_ord, jsonb_agg(j order by leaf_ord) as exams
        from ex where (not open and qc - coalesce(cc, 0) > 0) or (open and jsonb_array_length(j -> 'items') > 0)
        group by root_id, root_title, root_ord) g;
  return v_rounds;
```

(`r.id` 자리는 `p_room`, `v_uid` 는 `p_uid`.) `wrong_note_has_exam(p_room)` = `exists (select 1 from public.exams x join public.goal_nodes n on n.id = x.node_id where x.room_id = p_room and x.status = 'PUBLISHED' and n.archived_at is null)`.

주의: PGlite(PG17) 에서 `jsonb_agg` 안 상관 서브쿼리에 복합 열 `(a).id` 를 쓰는 것이 막히면 `mine` 을 임시 표로 풀거나 루프로 바꾼다(스펙 §10 첫 항목). `wrong_note_totals` 는 같은 조인에서 `wrong = count(open 오답)`, `retriedOk = count(open 오답 ∧ p.last_correct)`, `mastered = count(open 오답 ∧ p.mastered_at not null)`, `locked = sum(잠긴 시험의 lockedCount)`.

- [ ] **Step 3: 테스트 통과**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db`
Expected: 새 케이스 전부 통과, 기존 `round-exam-sql` 등 통과(0037 함수를 건드리지 않았으므로).

- [ ] **Step 4: 게이트·커밋**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run && git add supabase/migrations/0046_wrong_note.sql supabase/tests/wrong-note-sql.test.ts && git commit -m "feat(db): 0046 오답노트 — exam_practice 표 · wrong_note_list/mine(회차별 내 오답, 공개 전 잠금)" -- supabase/migrations/0046_wrong_note.sql supabase/tests/wrong-note-sql.test.ts`

---

### Task 2: 0046 (2/2) — `wrong_note_practice` · `wrong_note_master` · GRANT (opus)

**Files:**
- Modify: `supabase/migrations/0046_wrong_note.sql`(절 4·5·6 추가 — 아직 배포 전이라 같은 파일)
- Modify: `supabase/tests/wrong-note-sql.test.ts`

**Interfaces:**
- 내부 `wrong_note_target(p_room bigint, p_uid uuid, p_question bigint, out q public.exam_questions, out x public.exams, out n public.goal_nodes, out a public.exam_attempts)` — 관문 2·3(스펙 §4.3): 문항이 이 방 시험인가(`NODE_NOT_FOUND`) → 내 SUBMITTED 응시 + `exam_answers.is_correct=false`(`WRONG_NOTE_NOT_IN`) → `exam_reveal_ok`(`WRONG_NOTE_LOCKED`, details `{unlockDate}`)
- RPC `wrong_note_practice(p_slug text, p_answers jsonb) → jsonb {results: {[qid]: {correct, practice}}}` · `wrong_note_master(p_slug text, p_question bigint, p_on boolean) → jsonb {mastered}`(합계 없음 — D21)

- [ ] **Step 1: 실패하는 테스트 추가**(스펙 §8 SQL 4~7)

- `practice: grades via exam_grade · counts · canon · batch` — 지은 오답 3개 중 단답(4번은 정답이었으니 Q4 를 지은이 `[1,[0],null,"x"]` 로 틀리게 다시 구성) → `wrong_note_practice('aws', [{questionId: q4, answer: " IGW! "}])` → `results[q4].correct===true`, `practice.correctCount===1`, `lastCorrect===true`; 복수 `[0]` → false, `wrongCount===1`; OX `true` → `exam_grade` 결과와 일치(`select (public.exam_grade(q, '"true"'...)).correct` 로 기대값을 서버에서 뽑아 비교 — 자체 계산 금지); 빈 답 `""` → false. 두 문항 배열 한 번 → `results` 키 2개. 51개 → `VALIDATION_FAILED`. `last_answer` 가 canon(`[0]` 저장 시 `[0]`, `1.0` → `1`).
- `practice: official records unchanged` — 연습 전 `select score, correct_count from exam_attempts`, `select question_id, is_correct, earned from exam_answers order by question_id`, `select * from submissions where node_id=…` 를 JSON 으로 스냅샷 → 연습 3회 → 다시 뽑아 `assertEquals`.
- `practice: NOT_IN (correct question · other's wrong · unsubmitted) · LOCKED · other room` — 맞힌 문항 id, 철수의 오답 id(철수로 제출해 둔 뒤 지은으로 호출), 하나(미제출)로 호출, `after_deadline` 마감 전 시험 → 각 코드. spring 방 slug + aws 문항 → `NODE_NOT_FOUND`.
- `master: on/off · survives practice · locked` — `wrong_note_master('aws', q, true)` → `mastered===true`, `list().…items[].mastered===true`, `list().totals.mastered===1`; 그 문항 연습 → `select mastered_at … is not null`; `false` → null; 잠긴 문항 → `WRONG_NOTE_LOCKED`. 연습·외움 응답에 `totals` 키 없음(`"totals" in r === false`).
- `cascade: question removed → practice row gone` — 제출 전 시험(응시 행 없음 → `exam_unpublish` 가능)에선 노트에 못 들어가므로, 대신 `delete from public.exam_questions where id=…` 를 직접 실행(테스트는 롤백) → `exam_practice` 행 0.

- [ ] **Step 2: 구현**

`wrong_note_practice` 골격:

```sql
create or replace function public.wrong_note_practice(p_slug text, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user(); r public.rooms; v_now timestamptz := public.app_now();
  it jsonb; t record; v_c boolean; v_e int; p public.exam_practice; v_res jsonb := '{}'::jsonb;
begin
  r := public.wrong_note_room(p_slug, v_uid);
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) not between 1 and 50 then
    perform public.fail('VALIDATION_FAILED', '한 번에 1~50문항을 채점할 수 있어요', jsonb_build_object('field', 'answers'));
  end if;
  for it in select * from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(it -> 'questionId') <> 'string' or (it ->> 'questionId') !~ '^\d+$' then
      perform public.fail('VALIDATION_FAILED', '문항 id 가 올바르지 않아요', jsonb_build_object('field', 'questionId'));
    end if;
    select * into t from public.wrong_note_target(r.id, v_uid, (it ->> 'questionId')::bigint);
    if not public.exam_answer_shape_ok(t.q, it -> 'answer') and public.exam_is_answered(it -> 'answer') then
      perform public.fail('VALIDATION_FAILED', '답을 확인해 주세요', jsonb_build_object('questionId', it ->> 'questionId'));
    end if;
    select g.correct, g.earned into v_c, v_e from public.exam_grade(t.q, it -> 'answer') g;   -- 채점은 여기(0037) 하나
    insert into public.exam_practice as ep (user_id, question_id, node_id, last_correct, correct_count, wrong_count, last_answer, last_practiced_at, updated_at)
    values (v_uid, (t.q).id, (t.q).node_id, v_c, case when v_c then 1 else 0 end, case when v_c then 0 else 1 end,
            case when public.exam_is_answered(it -> 'answer') then public.exam_answer_canon(t.q, it -> 'answer') else 'null'::jsonb end, v_now, v_now)
    on conflict (user_id, question_id) do update set
      last_correct = excluded.last_correct, correct_count = ep.correct_count + excluded.correct_count,
      wrong_count = ep.wrong_count + excluded.wrong_count, last_answer = excluded.last_answer,
      last_practiced_at = v_now, updated_at = v_now                                   -- mastered_at 은 그대로(D8)
    returning * into p;
    v_res := v_res || jsonb_build_object((t.q).id::text, jsonb_build_object('correct', v_c, 'practice', public.wrong_note_practice_json(p)));
  end loop;
  return jsonb_build_object('results', v_res);
end $$;
```

`wrong_note_master` 는 `wrong_note_target` 뒤 `insert … on conflict do update set mastered_at = case when p_on then v_now else null end, updated_at = v_now`. GRANT 4개(`list`·`mine`·`practice`·`master`)를 절 6 에.

- [ ] **Step 3: 테스트 통과 · 게이트 · 커밋**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run && git commit -m "feat(db): 0046 오답노트 — 다시 풀기(서버 채점·연습 기록) · 외웠어요" -- supabase/migrations/0046_wrong_note.sql supabase/tests/wrong-note-sql.test.ts`

---

### Task 3: 웹 어댑터 · 타입 · 순수 로직 (sonnet)

**Files:**
- Modify: `src/lib/api/types.ts`(`WrongNote`·`WrongNoteMine`·`WrongNoteStudy`·`WrongNoteRound`·`WrongNoteExam`·`WrongNoteItem`·`WrongNotePractice`·`WrongNoteTotals`·`WrongNotePracticeResult` — 스펙 §4.2·4.2-b·4.3 모양, 시험 타입 블록 아래에)
- Create: `src/lib/api/wrongNote.ts`, `src/lib/api/wrongNote.test.ts`
- Create: `src/components/my-study/wrongNote.ts`, `src/components/my-study/wrongNote.test.ts`

**Interfaces:**
- `fetchWrongNote(slug, client?) → Promise<WrongNote>`(`rpc("wrong_note_list", {p_slug})`) · **`fetchWrongNoteMine(client?) → Promise<WrongNoteMine>`**(`rpc("wrong_note_mine", {})`) · `practiceWrongNote(slug, answers: {questionId: string; answer: unknown}[]) → Promise<WrongNotePracticeResult>`(`p_answers`) · `masterWrongNote(slug, questionId, on) → Promise<{mastered: boolean}>`(`p_question: Number(id)`, `p_on`)
- 화면 공용 모양 `type NoteStudy = { slug: string; title?: string; tone?: Tone; hasExam: boolean; rounds: WrongNoteRound[] }` — 방 응답은 `[{slug, hasExam, rounds}]` 하나로, 전체 응답은 `studies` 그대로 매핑(`toNoteStudies(view: WrongNote, slug)` · `toNoteStudiesMine(m: WrongNoteMine)`)
- `WRONG_NOTE_ERROR_KO`(`WRONG_NOTE_NOT_IN`·`WRONG_NOTE_LOCKED`·`VALIDATION_FAILED` 기본 문구, 서버 문구 우선 — `exam.ts` 의 `textOf` 와 같은 규칙) · `wrongNoteErrorAction(e: ApiError) → {kind: "refetch"|"field"|"login"|"toast", text}`(`NOT_IN`·`LOCKED`·`NODE_NOT_FOUND`·`ROOM_NOT_FOUND` = refetch)
- 순수(`components/my-study/wrongNote.ts`, 전부 `NoteStudy[]` 기준 — 방 하나든 여럿이든 같은 함수): `type Filter = "all" | "open" | "retriedOk"` · `FILTER_KO` · `applyFilter(studies, filter, showMastered, studySlug: string | "all") → studies`(빈 시험·빈 회차 제거, 스터디 섹션은 남긴다) · `totalsOf(studies) → WrongNoteTotals`(**클라이언트 정본, D21**) · `totalsLine(t) → "오답 12문항 · 다시 풀어 맞힘 4 · 외움 2"`(0 인 항목은 생략, `locked>0` 이면 "· 잠김 n") · `emptyState(studies, {pending}) → {text, masteredLink?: boolean} | null`(스펙 §6.2 표 + §6.5 전 스터디 분기) · `studyEmptyLine(s) → "아직 시험이 없는 방이에요" | "틀린 문항이 없어요" | null` · `lockedLine(ex)` · `examHeadLine(ex)` · `itemBadge(it)`(미답 「미답」·오답 「오답」 + 연습 `lastCorrect` 참 「다시 풀어 맞힘」 / 거짓 「또 틀림」, 외움 「외움」) · `stripKey(q: ExamQuestion) → ExamQuestion`(**`delete` 로 `answer`·`explanation` 키 제거**한 사본) · `batchSummary(results, n) → "5문항 중 3 맞힘"` · `mergePractice(studies, results) → studies` · `setMastered(studies, qid, on)`

- [ ] **Step 1: 테스트 작성** — `wrongNote.test.ts`(순수): 스펙 §8 "vitest(순수)" 항목 전부 + `totalsOf` 가 두 스터디 합산·외움 제외·잠금 합산, `applyFilter` 의 `studySlug` 가 섹션을 거른다. 특히 `expect("answer" in stripKey(q)).toBe(false)`. `api/wrongNote.test.ts`: `rpc` 모킹으로 인자 이름(`p_slug`·`p_answers`·`p_question` 숫자·`p_on`, `wrong_note_mine` 은 `{}`) 확인(`notices.test.ts` 패턴).
- [ ] **Step 2: 구현** — 파일 머리 주석은 `exam.ts`·`notices.ts` 와 같은 투(「오답노트 어댑터 (0046_wrong_note.sql). 컴포넌트는 이 파일만 부른다」).
- [ ] **Step 3: 게이트 · 커밋** `feat(wrong-note): 어댑터·타입·순수 로직`

---

### Task 4: 탭 등록 · `WrongNoteTab` 목록(회차·시험 카드·잠금·필터·빈 상태) (opus)

**Files:**
- Modify: `src/lib/routes.ts`(`MY_STUDY_TABS` 끝에 `"wrong"`) · `src/lib/routes.test.ts`(화이트리스트 루프는 자동, `slice(0,2)` 그대로)
- Modify: `src/components/my-study/StudyHeaderInfo.tsx`(`TABS` 끝 `["wrong", "오답노트"]`) · `StudyHeaderInfo.dom.test.ts`·`MyStudyScreen.dom.test.ts`(탭 수 단언이 있으면 7)
- Modify: `src/components/my-study/MyStudyScreen.tsx` — `{S.tab === "gantt" && …}` 아래 한 줄 `{S.tab === "wrong" && <WrongNoteTab slug={detail.slug} viewerPending={detail.me?.state === "pending"} toast={setToast} />}`(**exam-results-card 커밋 뒤**. 미커밋이면 이 한 줄만 보류하고 나머지 커밋, 컨트롤러에 알림)
- Create: `src/components/my-study/useWrongNote.ts` — **로더를 인자로**: `useWrongNote(load: () => Promise<NoteStudy[]>, deps)` → `{studies, error, loading, refetch, practice(slug, answers), master(slug, qid, on), busy}`. 연습·외움은 응답을 `mergePractice`·`setMastered` 로 반영; 실패는 `wrongNoteErrorAction` → 토스트, refetch 류는 다시 받기. 방 탭은 `() => fetchWrongNote(slug).then(v => toNoteStudies(v, slug))`, `/tasks`(Task 7)는 `() => fetchWrongNoteMine().then(toNoteStudiesMine)`
- Create: **`src/components/my-study/WrongNoteList.tsx`**(공용 본문: 머리줄·필터 칩·외움 토글·스터디 `h2`(`title` 이 있을 때만, `/tasks` 의 과제 보기 `h2` 와 같은 마크업: 점·제목·「오답노트 ›」 링크)·회차 `h3`·시험 카드·문항·잠금 카드·빈 상태. props: `studies, pending, onPractice(slug, answers), onMaster(slug, qid, on), busy, studyFilter?: string, barInset?: string`(묶음 채점 막대의 음수 마진 클래스 — 방 탭 `-mx-7 max-[901px]:-mx-4`, `/tasks` 는 Task 7 에서 맞춘다)) + `WrongNoteList.dom.test.ts`
- Create: `src/components/my-study/tabs/WrongNoteTab.tsx`(얇은 껍데기: `useWrongNote` + `WrongNoteList` + `viewerPending`), `WrongNoteTab.dom.test.ts`

**UI(스펙 §6.1·6.2·6.3)**: 머리줄 `totalsLine(totalsOf(studies))` + 칩 3개(`role="radiogroup"`, 공지·보드의 칩 스타일 재사용 — `BoardTab` 의 회차 칩 클래스를 찾아 같은 클래스) + 「외운 문제 n개 보기」 체크(`mastered===0` 이면 숨김) → (스터디 `h2`) → 회차 `h3` → 시험 카드(`rounded-[14px] border border-line bg-surface-2`, 머리: 제목·`examHeadLine`·[이 시험 다시 풀기](이 Task 에선 `disabled` 자리만)) → 문항 `<ol>` 에 `ExamQuestionView mode="result" q={stripKey(q)} mine={it.mine} correct={null} earned={null}` + 배지. 잠금 카드는 `lockedLine` + 자물쇠 아이콘(기존 `bits.tsx` 아이콘 유형 확인, 없으면 인라인 svg), 버튼 없음. 빈 상태는 `emptyState`·`studyEmptyLine`. 로딩 스켈레톤·오류+[다시 시도] 는 `ExamSection` 과 같은 마크업.

- [ ] **Step 1: 테스트** — `WrongNoteList.dom.test.ts`(순수 props, API 모킹 없음): 목록 렌더(회차 h3 2개·시험 카드·「2.」 번호·내 답 태그), `title` 없는 스터디 1개면 `h2` 없음 / 2개면 `h2`·「오답노트 ›」 href, 기본 상태에 「정답」 태그 **없음**, 필터 칩 「다시 풀어 맞힘」 → `lastCorrect` 참인 항목만, `studyFilter` 로 섹션 하나만, 외운 문제 토글, 잠금 카드 문구·버튼 없음, 빈 상태 4종 + 스터디 단위 빈 줄. `WrongNoteTab.dom.test.ts`(`vi.mock("@/lib/api/wrongNote")`): 마운트에 `fetchWrongNote("aws")`, 오류 → [다시 시도] 재호출, `viewerPending` 문구. `StudyHeaderInfo.dom.test`: 탭 7개·마지막 「오답노트」. `MyStudyScreen.dom.test`: 기존 "TABS 순서 = MY_STUDY_TABS" 가 그대로 통과(둘 다 바꿨으므로).
- [ ] **Step 2: 구현** → `npx vitest run src/components/my-study src/lib` 통과.
- [ ] **Step 3: 브라우저 확인** — dev 서버(3700), 로컬 supabase 에 0046 적용 상태, 마스터 계정으로 aws 방 → 오답노트 탭(시험·제출이 없으면 빈 상태만 확인). 390/820/1440 에서 탭 막대 가로 스크롤·카드 줄바꿈·가로 스크롤 없음.
- [ ] **Step 4: 게이트 · 커밋** `feat(wrong-note): 오답노트 탭 — 회차별 내 오답 · 공개 전 잠금 · 필터`

---

### Task 5: 다시 풀기 — 문항 · 시험 묶음 (opus)

**Files:**
- Modify: `src/components/my-study/WrongNoteList.tsx`(카드·문항을 `WrongNoteExamCard`·`WrongNoteItem` 로 분리 — 파일이 300줄을 넘으면 `WrongNoteItem.tsx` 로), `WrongNoteList.dom.test.ts`
- Modify: `src/components/my-study/useWrongNote.ts`(`practice(slug, answers)` 결과를 `mergePractice` 로 반영)

**동작(스펙 §6.1)**:
- 문항 상태 기계(컴포넌트 로컬): `idle`(기본) → [다시 풀기] → `take`(답 `null` 로 시작, `ExamQuestionView mode="take" q={stripKey(q)} onChange`) → [채점](`busy` 동안 비활성, 미답이면 `InlineConfirm` 없이 그냥 오답 채점 — 서버와 같다) → `done`(`mode="result" q={q}`(키 있음) `correct={r.correct} earned={correct? q.points : 0}` + 배지 ✓ 맞혔어요 / ✗ 또 틀렸어요 + 해설 자동 펼침 — Task 6 의 `explanationOpen`, 이 Task 에선 prop 없이 닫힘 허용) → [한 번 더] → `take` / [닫기] → `idle`(배지는 `practice` 반영).
- 묶음: 카드 [이 시험 다시 풀기] → 카드의 모든 `idle` 문항을 `take` 로, 카드 하단 막대(`sticky bottom-0 z-[2] -mx-7 … max-[901px]:-mx-4`, `ExamSection` 의 막대 클래스 복사) 「n/m 답함 · [채점] [그만두기]」. [채점] = `practice(모든 문항)` 한 번 → 전부 `done`, 막대 「`batchSummary`」 + [닫기]. [그만두기] → 전부 `idle`, 입력 버림(D15). 묶음 중엔 문항별 [채점]·[외웠어요] 숨김.
- 필터 변경·외움으로 `take` 중인 문항이 목록에서 빠지면 입력도 버린다(상태는 문항 id 키 Map, 사라진 id 는 정리).

- [ ] **Step 1: 테스트** — [다시 풀기] → 라디오 보임·「정답」 태그 없음 → 선택 → [채점] → `onPractice` 인자 `("aws", [{questionId:"2", answer:[0,1]}])`(**카드의 slug** — 두 스터디 fixture 에서 spring 카드는 `"spring"`) → 결과: ✓ 배지·「정답」 태그·`totalsOf` 머리줄 갱신. 묶음: 버튼 → 모든 문항 take·막대 「0/2 답함」 → 두 문항 답 → 「2/2 답함」 → [채점] 호출 1회·인자 2개 → 「2문항 중 1 맞힘」. 오류 `WRONG_NOTE_LOCKED` → 토스트 + `fetchWrongNote` 재호출. `busy` 중 [채점] 중복 클릭 1회만.
- [ ] **Step 2: 구현** → 테스트 통과.
- [ ] **Step 3: 브라우저** — 390 에서 묶음 막대가 화면 아래 고정되고 문항 마지막 행이 가려지지 않는지(`scroll-mb-20` 은 `ExamQuestionView` 가 이미 준다).
- [ ] **Step 4: 게이트 · 커밋** `feat(wrong-note): 다시 풀기 — 문항 하나 · 시험 묶음(서버 채점)`

---

### Task 6: 정답·해설 보기 · 외웠어요 · `explanationOpen` (sonnet)

**Files:**
- Modify: `src/components/my-study/tabs/ExamQuestionView.tsx` — `explanationOpen?: boolean` prop(기본 false) → `<details open={explanationOpen}>`. 다른 변경 없음
- Modify: `src/components/my-study/WrongNoteList.tsx`(또는 `WrongNoteItem.tsx`), `WrongNoteList.dom.test.ts`
- Modify: `src/components/my-study/useWrongNote.ts`(`master(slug, qid, on)`)

**동작**:
- `idle` 문항 아래 「정답·해설 ▸」 `<details>`(`ExamQuestionView` 의 해설 details 와 같은 클래스): 열면 `ExamQuestionView mode="result" q={q}`(키 있음) 로 **정답 표시된 보기 목록**을 다시 그리고(기본 렌더의 `stripKey` 판 대신 — 즉 details 안에서만 키 있는 판), 그 아래 해설 `MarkdownView`. 해설 빈 문자열 → 「해설이 없는 문항이에요」(D13, `text-muted`). `done` 상태는 `explanationOpen` 로 자동 펼침(해설 없으면 같은 문구).
- [외웠어요](`idle` 에서만) → `master(qid, true)` → 항목 제거(`setMastered`) + 토스트 「외운 문제로 옮겼어요 · 「외운 문제 보기」로 되돌릴 수 있어요」. 외운 문제 보기 켜면 배지 「외움」 + [다시 노트에] → `master(qid, false)`.

- [ ] **Step 1: 테스트** — details 닫힘: 「정답」 태그 0개·해설 글 없음 → 열기: 정답 행 태그·해설 마크다운. 해설 빈 문항 → D13 문구. `done` 뒤 details `open` 속성. [외웠어요] → `masterWrongNote("aws","2",true)`·항목 사라짐·토글 켜면 복귀·[다시 노트에] → `false`. `ExamQuestionView` 기존 테스트(`ExamSection.dom`·`ExamResults.dom`) 변경 없이 통과.
- [ ] **Step 2: 구현** → 통과.
- [ ] **Step 3: 게이트 · 커밋** `feat(wrong-note): 정답·해설 보기 · 외웠어요`

---

### Task 7: 내 과제 `/tasks` — 「과제 · 오답노트」 보기 전환 (opus) — 스펙 D17~D21 · §6.5

**Files:**
- Modify: `src/components/tasks/calc.ts`(`TasksFilter.view: "tasks" | "notes"`, `DEFAULT_FILTER.view = "tasks"`, `parseFilter`(`view=notes` 만 인정) · `filterQuery`(기본값이면 키 없음) · `normalizeFilter` 는 그대로), `calc.test.ts`
- Modify: `src/components/tasks/TasksToolbar.tsx`(첫 줄 맨 앞에 `Seg` 「과제 · 오답노트」(`label="보기"`), `filter.view === "notes"` 면 기간·묶기·유형·완료 숨기기를 **그리지 않는다**(스터디 칩 줄은 그대로)), `TasksToolbar.dom.test.ts`
- Create: `src/components/tasks/TasksNotesView.tsx`(`useWrongNote(() => fetchWrongNoteMine().then(toNoteStudiesMine))` + `WrongNoteList studies pending={false} studyFilter={filter.study} barInset="<TasksScreen 본문 패딩에 맞춘 음수 마진>"` + 로딩·오류·`TasksEmpty noStudy`), `TasksNotesView.dom.test.ts`
- Modify: `src/components/tasks/TasksScreen.tsx` — `filter.view === "notes"` 면 요약 줄(`pieces`)·「＋ 내 목표 추가」 머리 버튼·`renderBody()` 대신 `<TasksNotesView filter={filter} toast={setToast} refreshKey={…} />`. 과제 보기 코드는 **옮기지 않는다**(diff 는 분기 추가만). `progressChangedSince` 재조회 때 `refreshKey` 를 올려 오답도 다시 받는다(D19)
- Create: `src/components/tasks/TasksScreen.notes.dom.test.ts`

**Interfaces:**
- `TasksFilter.view` · `routes.tasks({view: "notes", study})` 는 기존 `routes.tasks(q)` 그대로(키 정렬)
- `TasksNotesView({ filter, toast, refreshKey })` — 한 번 받으면 유지(`useWrongNote` 가 `deps=[refreshKey]`), 과제 보기로 갔다 와도 컴포넌트가 언마운트되므로 재요청이 생긴다 → **`TasksScreen` 이 `useWrongNote` 를 들고 `TasksNotesView` 에 내려 준다**(언마운트돼도 데이터 유지, D19). 로드는 `view === "notes"` 가 처음 된 렌더에서(`enabled` 인자)

- [ ] **Step 1: 테스트**
  - `calc.test.ts`: `parseFilter("view=notes")` → `"notes"`, 그 밖 → `"tasks"`; `filterQuery({view:"notes", study:"aws"})` → `{view:"notes", study:"aws"}`; 기본은 키 없음. 기존 케이스 전부 그대로.
  - `TasksToolbar.dom.test.ts`: `view="notes"` 면 기간·묶기·유형·완료 숨기기 **없음**, 스터디 칩 있음, Seg 「오답노트」 `aria-pressed`; `view="tasks"` 는 기존 단언 그대로(스냅샷이 있으면 Seg 추가만 반영).
  - `TasksScreen.notes.dom.test.ts`(`vi.mock("@/lib/api/wrongNote")`·`@/lib/api/personal`): `?view=notes` 마운트 → `fetchWrongNoteMine` 1회·`h2` 스터디 2개·「오답노트 ›」 href = `routes.myStudyTab("aws","wrong")`; `?view=notes&study=aws` → aws 섹션만; Seg 「과제」 → `replaceState` 주소에 `view` 없음·`fetchMyTasks` 재호출 없음; 다시 「오답노트」 → `fetchWrongNoteMine` **재호출 없음**(1회 그대로); spring 카드 [다시 풀기]·[채점] → `practiceWrongNote("spring", …)`; 요약 줄·「＋ 내 목표 추가」 안 보임; 스터디 0 → `TasksEmpty noStudy`.
  - `TasksScreen.order`·`stale` 기존 테스트 무변경 통과.
- [ ] **Step 2: 구현** → `npx vitest run src/components/tasks src/components/my-study src/lib` 통과.
- [ ] **Step 3: 브라우저** — `/tasks` 390/820/1440: Seg 가 첫 줄 맨 앞, 오답노트 보기에서 툴바가 두 줄(Seg 줄 + 스터디 칩 줄)로 줄고 본문이 바로 따라오는지, 묶음 채점 막대가 본문 폭에 맞는지(`barInset`), 가로 스크롤 없음. `?view=notes&study=aws` 새로고침 → 같은 화면.
- [ ] **Step 4: 게이트 · 커밋** `feat(tasks): 내 과제에 「오답노트」 보기 — 전 스터디 오답, 스터디 칩 연동`

---

### Task 8: 시나리오 · 마무리 (mechanical · sonnet)

- [ ] **Step 1: 전체 게이트** — `npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run` 모두 통과. `MyStudyScreen.tsx` 한 줄이 Task 4 에서 보류됐으면 지금 넣고(exam-results-card 커밋 확인) 게이트 다시.
- [ ] **Step 2: 시나리오(로컬 supabase + dev 서버, ego-browser, 마스터 계정)** — 스펙 §8 시나리오 그대로: 시험 제출(2문항 틀림) → 오답노트 탭 → 해설 토글 → 문항 다시 풀기(맞힘·틀림) → 시험 묶음 → 외웠어요/되돌리기 → 필터 → `after_deadline` 시험 잠금 카드 → `/tasks` 「오답노트」 전환 → 스터디 칩 aws → 같은 문항 다시 풀기 → 「오답노트 ›」 로 방 탭 → 390/820/1440 스크린샷. 공식 점수가 진행목표 상세(`ExamSection` 결과 카드)에서 그대로인지 확인.
- [ ] **Step 3: 배포 노트** — 컨트롤러에 전달: `supabase db push`(0045 → 0046 순서, md-images 가 0045 를 먼저 배포해야 한다 — 독립이지만 번호 순서) 는 사용자 승인 후 사용자가. 호스티드 `statement_timeout` 안에 `wrong_note_list`·`wrong_note_mine`(방 수 × 시험 수) 이 끝나는지 로컬 `explain analyze` 값 한 줄.

---

## 결정에 따른 변경 (스펙 §3 — 권장안 아닌 쪽을 고를 때만)

| 결정 | 다른 선택 | 바뀌는 Task |
|---|---|---|
| D3 | (a) 공개 전 시험 숨김 | Task 1 `wrong_note_list` 에서 `not open` 행 제거·`totals.locked` 삭제 · Task 4 잠금 카드 삭제 |
| D5 | 정답을 연습 응답에서만 | Task 1 목록에서 `answer`·`explanation` 제거 · Task 2 응답에 둘 추가 · Task 6 「정답·해설 보기」 가 RPC(`wrong_note_reveal(qid)` 신설) 를 부른다 — 호출 수 증가, 권장하지 않음 |
| D6 | 클라이언트 채점·저장 없음 | Task 2 삭제 · Task 3 `examNorm` 기반 채점 함수 추가(단답 정규화 불일치 위험) · 필터 「다시 풀어 맞힘」 삭제(기록 없음) |
| D8 | 연습에서 맞히면 자동 제거 | Task 1 목록 조인에 `p.last_correct is distinct from true` 조건 · Task 6 [외웠어요] 삭제 · 되돌리기 없음 |
| D12 | 탭 배지 | Task 1 `wrong_note_count(p_slug) → int` 추가 · Task 4 `MyStudyScreen` 이 공지 인박스처럼 마운트 때 호출, `StudyHeaderInfo` 에 `wrongCount` prop |
| D12 | 탭 위치를 진행목표 뒤로 | Task 4 `MY_STUDY_TABS` 삽입 위치 + `routes.test` `slice(0,2)` 는 그대로 |
| D16 | 종료·보관된 방 숨김 | Task 1 `wrong_note_room` 에 `r.status='ACTIVE' and archived_at is null` · Task 4 빈 상태 문구 추가 |
| D17 | `/tasks` 같은 화면 아래 섹션 | Task 7 `TasksFilter.view` 삭제, `TasksScreen` 본문 끝에 `<TasksNotesView>` 고정 + 툴바 변경 없음(스터디 칩만 공유). 접힘 기본(`<details>`)을 두어 과제가 밀리지 않게 |
| D18 | `wrong_note_list(p_slug nullable)` 하나 | Task 1 `wrong_note_mine` 삭제, `wrong_note_list(p_slug text default null)` 가 null 이면 `studies` 모양을 돌려준다(응답 모양이 둘 — 어댑터가 분기). GRANT 서명 `(text)` 그대로 |
| D19 | `/tasks` 서버 동시 로드 | Task 7 `src/app/tasks/page.tsx` 에서 `fetchWrongNoteMine(client)` 를 `me_tasks` 와 `Promise.all`, `TasksScreen initialNotes` prop. 과제 보기 첫 응답이 느려진다 — 권장하지 않음 |
