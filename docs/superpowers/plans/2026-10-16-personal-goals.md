# 개인 목표 + "내 과제" 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀원 누구나 회차 아래에 자기 개인 목표(PERSONAL 리프)를 만들고·고치고·완료하며, 헤더 "내 과제"(`/tasks`)에서 여러 방의 내 배정 팀 과제 + 내 개인 목표를 한곳에서 본다. 팀 진척률·방 통계는 바뀌지 않는다.

**Architecture:** 백엔드 = 마이그레이션 `0014_personal_goals.sql` 하나(추가형): `goal_nodes.owner_id` + `task_type 'PERSONAL'`, 배정 행 없음, `is_task_assignee` 가 소유자를 담당자로 본다, 편집자 RPC 는 `node_get` 가드로 개인 목표를 거부, 새 RPC `personal_*`·`me_tasks`, 읽기 함수 재정의(노출 필터·팀만 집계). 프론트 = 타입/API → `model.ts` 순수 로직(개인 리프·롤업 제외·범위 필터·서버 index) → 진행목표 목록/상세/폼 → 보드·캘린더·간트·개요 → 새 라우트 `/tasks`(`src/components/tasks/**`) + 헤더 메뉴 → 내 일정 배지.

**Tech Stack:** Supabase Postgres(plpgsql, RLS) · Deno + PGlite DB 테스트(`npm run test:db`, 저장소 표준 — pgTAP 대신) · Next.js 16.4 App Router · React 19.3 · Tailwind v4 · vitest(node, `src/**/*.test.ts`)

**Spec:** `docs/superpowers/specs/2026-10-16-personal-goals-design.md` (이하 "스펙 §n")

## Global Constraints

- 마이그레이션은 **`supabase/migrations/0014_personal_goals.sql` 하나만** 만든다. 0001~0013 수정 금지. 0015 는 제출 기능 몫 — 건드리지 않는다.
- **추가형·무손실**: 기존 행을 UPDATE/DELETE 하지 않는다(새 제약은 기존 행이 이미 만족). `drop policy`·`drop constraint`·`drop function` 은 같은 파일에서 즉시 다시 만드는 것만.
- **재정의는 최신 정의를 복사해 고친다.** 0014 실행 직전 0013 이 같은 함수를 재정의했는지 Task 0 에서 확인하고, 했으면 0013 판을 복사한다. 대상: `node_get`, `is_task_assignee`, `curriculum_json`, `room_leaf_stats`, `task_node_json`, `task_get`, `tag_autoselect`, `assignment_resync`, `me_schedule_leaves`, `me_schedule`, 정책 `goal_nodes_select`.
- 함수 규칙: `security definer set search_path = ''`, 오류는 `public.fail(code, 한국어 문구, detail)`. 공개 RPC 만 GRANT(D7) — 내부 헬퍼는 GRANT 없음.
- 호스티드 적용(`supabase db push`)은 **사용자 승인 후 사용자가** 한다. 에이전트는 로컬(PGlite 테스트, 필요하면 로컬 supabase)만.
- 사용자 문구: 팀 과제 / 개인 목표 / 내 과제 / 진행목표(스펙 §6 표 그대로). 코드 식별자·`?tab=curriculum` 은 그대로.
- 한 페이지 스크롤(안쪽 세로 스크롤러 금지), 누르는 자리 ≥ 44px(`h-11`/`min-h-11`), `aria-label` 에 대상 제목, 390/820/1440 가로 스크롤 없음, 상태는 색 + 모양.
- Next API(라우트·metadata·searchParams)를 건드리기 전에 `node_modules/next/dist/docs/` 의 해당 가이드를 읽는다(AGENTS.md).
- 병행 작업: 제출 기능(`docs/superpowers/plans/2026-10-16-task-submission.md`)이 `state.ts`·`DetailView`·`LeafBody`·`CurriculumTab` 을 고치는 중이다. 프론트 Task 6+ 는 그 커밋 뒤에 시작하고, 충돌 시 그쪽 변경을 살린다. 줄 번호는 이 플랜 작성 시점 기준 — 항상 인용한 코드 조각으로 위치를 찾는다.
- 서브에이전트 금지(각 작업자 스스로 실행). dev 서버·빌드 전 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나, 끝나면 종료. 포트 3700(`lsof -iTCP:3700 -sTCP:LISTEN -P` 로 먼저 확인).
- 브라우저 확인은 `ego-browser` 스킬(자기 창). claude-in-chrome 금지. 로그인 정보는 `.superpowers/sdd/2026-10-14-editor-ux/common.md`.
- 커밋 전 게이트: DB 작업 = `npm run test:db`, 프론트 작업 = `npm run lint && npx tsc --noEmit && npx vitest run`. 커밋은 `git commit -- <paths>` 로 자기 파일만. 메시지 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx
  ```

## Review Focus

1. **팀 수치 불변** — 개인 목표를 만들고 완료해도 `curriculum_get.stats`, 회차 노드 `assigned/submitted/pct`, `room_get.stats/rounds/currentRound.tasks/myProgress`, `rooms_list` 내 진척이 그대로여야 한다. → Task 3 "팀 수치 불변" 케이스.
2. **노출 누수** — 공개 방 비로그인·외부인·대기자에게 남의 개인 목표가 `curriculum_get`·`task_get`·`me_schedule`(대기자 미리보기·과제 안 하는 그룹장)·표 직접 조회 어디로도 새지 않는다. → Task 1·3·4 노출 케이스.
3. **편집자 RPC 차단** — 위임 편집자·그룹장이 `node_update/move/delete/archive/create(부모)/indent` 로 개인 목표를 대상·부모로 쓰면 `PERSONAL_NODE`. 회차 삭제·보관은 개인 목표를 함께 처리하되 제출 있으면 삭제 거부. → Task 1 케이스.
4. **형제 index** — 서버 `node_move` index 는 개인 목표까지 센 형제 위치다. 화면은 팀 과제 먼저 그리므로 드래그·위/아래가 개인 목표 사이로 끼어도 의도한 자리에 가야 한다. → Task 7 `reorderIndex`·`dropPlan` 테스트.
5. **기존 테스트의 객체 전체 비교** — `myPermissions` 는 바꾸지 않고(새 값은 `personal` 키), 노드에 `ownerId` 가 추가돼 노드 객체 전체를 `assertEquals` 하는 테스트가 깨지면 기대값에 `ownerId: null` 을 더하는 것으로만 고친다(동작 변경으로 덮지 않는다). → Task 5.
6. **완료 취소 안전** — `personal_complete(false)` 는 내용(본문·링크·첨부)이 있는 제출을 지우지 않는다. → Task 2 케이스.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음(읽기만)

- [ ] **Step 1: 작업 트리·0013 상태**

Run: `git -C /Users/picpal/Desktop/workspace/sgtudy status --short && git -C /Users/picpal/Desktop/workspace/sgtudy log --oneline -10 && ls /Users/picpal/Desktop/workspace/sgtudy/supabase/migrations`
Expected: `0013_backlog_fixes.sql` 이 **커밋돼 있다**(`git log --oneline -- supabase/migrations/0013_backlog_fixes.sql` 결과 있음), `0014_*` 는 없다. 0013 이 커밋 전이면 **멈추고** 컨트롤러에 보고.

- [ ] **Step 2: 0013 이 0014 재정의 대상을 건드렸는지**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && grep -nE "function public\.(node_get|is_task_assignee|curriculum_json|room_leaf_stats|task_node_json|task_get|tag_autoselect|assignment_resync|me_schedule_leaves|me_schedule)\(|policy goal_nodes_select" supabase/migrations/0013_backlog_fixes.sql`
Expected: 결과 없음(작성 시점 기준 0013 은 tag_term_hit·tag_text_relevant·slugify·room_period_check·node_update·room_create·room_update·notify_render·member_deactivate·room_transition_active 만 재정의). 결과가 있으면 그 함수는 **0013 판을 복사 원본으로** 쓰고, 플랜 SQL 과의 차이를 Task 노트에 적는다.

- [ ] **Step 3: DB 테스트 기준선**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db 2>&1 | tail -5`
Expected: `ok | N passed | 0 failed`. 실패가 있으면 멈추고 보고(0013 작업 중일 수 있음).

- [ ] **Step 4: 호스티드 영향 조회 요청 (사용자 몫, 기록만)**

컨트롤러는 사용자에게 Supabase SQL 에디터(읽기 전용)에서 아래 결과를 요청해 플랜 노트에 남긴다. 결과와 무관하게 진행한다(0014 는 기존 행을 바꾸지 않는다).
```sql
select count(*) filter (where task_type not in ('COMMON','DESIGNATED')) as odd_types,
       count(*) filter (where depth > 3) as bundles
from goal_nodes;
```
Expected: `odd_types = 0` (아니면 새 CHECK 가 실패한다 → 멈춤).

> **Task 0 기록 (2026-10-16)**
> - 사용자 결정: 스펙 §11 D1~D7 **권장 기본값 전부 확정** — D1 같은 방 그룹장·참가자 공개(기본 화면 숨김, 칩으로 열기) · D2 체크 = 빈 제출, 내용 없는 완료만 취소 · D3 헤더 `/tasks` · D4 팀 진척률 제외 · D5 회차당 1인 20개 · D6 마감 알림 v1 없음 · D7 그룹장은 보관·삭제(제출 없을 때)만, 내용 수정 불가.
> - 0013 커밋됨(`729720c`). 0013 은 재정의 대상 함수·정책을 건드리지 않는다(grep 결과 없음). 최신 판: `node_get`·`room_leaf_stats`·`me_schedule_leaves`·`me_schedule` = 0006, `is_task_assignee`·`goal_nodes_select` = 0003, `curriculum_json` = 0011, `task_node_json`·`task_get` = 0007, `tag_autoselect` = 0009, `assignment_resync` = 0005.
> - 로컬에 제출 기능의 `0015_file_discard.sql`(미커밋, 로컬 적용됨)이 있다 — `file_discard` 만 정의, 0014 대상과 겹치지 않는다. 로컬 supabase 적용은 `supabase migration up --include-all`.
> - DB 테스트 기준선: 240 passed / 0 failed. 호스티드 조회(Step 4)는 사용자 몫 — 미수행.

---

### Task 1: 0014 — 스키마·가드·노출 헬퍼·RLS (judgment · opus)

**Files:**
- Create: `supabase/migrations/0014_personal_goals.sql` (§1~§4)
- Create: `supabase/tests/personal-goals-sql.test.ts`

**Interfaces:**
- Produces(SQL): 컬럼 `goal_nodes.owner_id`, 제약 `ck_goal_nodes_type`(재생성)·`ck_goal_nodes_owner`·`ck_goal_nodes_personal_depth`, 인덱스 `ix_goal_nodes_owner`, 트리거 `trg_goal_nodes_personal_guard`, 함수 `goal_nodes_personal_guard()`, `node_get(bigint,bigint)`(재정의), `personal_eligible(bigint,uuid)`, `personal_viewer(bigint,uuid)`, `personal_limit()`, `is_task_assignee(bigint,uuid)`(재정의), 정책 `goal_nodes_select`(재생성)
- Consumes: `public.fail`, `can_read_room`, `can_read_submissions`, `current_user_id`

- [ ] **Step 1: 실패하는 테스트 작성** — `supabase/tests/personal-goals-sql.test.ts`

```ts
// 0014 개인 목표 — 팀원이 회차 아래에 직접 만드는 PERSONAL 리프. 배정 행 없음, 소유자 = owner_id
import { assert, assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb } from "./_harness.ts";
import { nodeByTitle, roomId } from "./_curriculum-helpers.ts";
import { cases, one, type Q, type Row, uidOf } from "./_fixtures.ts";

const db = await openDb();
await applySeed(db);

/** aws 회차 id (라벨로) */
const roundOf = async (q: Q, label: string) =>
  (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = 'aws' and n.parent_id is null and n.label = $1", [label])).id as string;
/** 표에 직접 개인 목표 한 줄 (RPC 가 생기기 전 Task 1 용) */
async function rawPersonal(q: Q, round: string, owner: string, title: string): Promise<string> {
  const r = await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                          select n.room_id, n.id, n.id, 3, 99, $2, n.start_date, n.end_date, 'PERSONAL', $3::uuid from public.goal_nodes n where n.id = $1
                          returning id::text as id`, [round, title, owner]);
  return r.id as string;
}

cases("personal goals · schema", db, [
  { name: "제약: PERSONAL 은 owner 필수, owner 는 PERSONAL 에만, depth 3 만", run: async (q) => {
    const r2 = await roundOf(q, "2주차");
    const chulsu = await uidOf(q, "철수");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                        select room_id, id, id, 3, 99, 'x', start_date, end_date, 'PERSONAL' from public.goal_nodes where id = $1`, [r2]), "ck_goal_nodes_owner");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                        select room_id, id, id, 3, 99, 'x', start_date, end_date, 'COMMON', $2::uuid from public.goal_nodes where id = $1`, [r2, chulsu]), "ck_goal_nodes_owner");
    const aws = await roomId(q, "aws");
    const bundle = await nodeByTitle(q, aws, "로드밸런서 비교");   // 3주차 묶음(depth 3) 아래 = depth 4
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type, owner_id)
                        select room_id, id, round_id, 4, 99, 'x', start_date, end_date, 'PERSONAL', $2::uuid from public.goal_nodes where id = $1`, [bundle, chulsu]), "ck_goal_nodes_personal_depth");
  } },
  { name: "트리거: 개인 목표 아래에는 아무것도 못 둔다 (PERSONAL_NODE)", run: async (q) => {
    const p = await rawPersonal(q, await roundOf(q, "2주차"), await uidOf(q, "철수"), "개인 A");
    await expectFail(q(`insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                        select room_id, id, round_id, 4, 0, 'x', start_date, end_date, 'COMMON' from public.goal_nodes where id = $1`, [p]), "PERSONAL_NODE");
  } },
  { name: "node_* 는 개인 목표를 대상으로도 부모로도 못 쓴다 (그룹장도)", run: async (q) => {
    const r2 = await roundOf(q, "2주차");
    const r3 = await roundOf(q, "3주차");
    const p = await rawPersonal(q, r2, await uidOf(q, "철수"), "개인 A");
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(q("select public.node_update('aws', $1, '{\"title\":\"x\"}'::jsonb)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_move('aws', $1, $2, 0)", [p, r3]), "PERSONAL_NODE");
    await expectFail(q("select public.node_delete('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_archive('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_unarchive('aws', $1)", [p]), "PERSONAL_NODE");
    await expectFail(q("select public.node_create('aws', $1, 'x')", [p]), "PERSONAL_NODE");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
    await expectFail(q("select public.node_move('aws', $1, $2, 0)", [ec2, p]), "PERSONAL_NODE");
  } },
  { name: "회차 삭제는 개인 목표를 함께 지운다 (제출 없을 때)", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    const c0 = await one(q, "select public.node_create('aws', null, '임시 회차', null, null, '2026-12-01', '2026-12-07') as c");
    const round = (c0.c.nodes as Row[]).find((n) => n.title === "임시 회차")!.id as string;
    await rawPersonal(q, round, await uidOf(q, "철수"), "개인 B");
    const c = (await one(q, "select public.node_delete('aws', $1) as c", [round])).c;
    assertEquals((c.nodes as Row[]).some((n) => n.title === "개인 B"), false);
  } },
  { name: "is_task_assignee: 보관 아닌 개인 목표의 소유자만 참", run: async (q) => {
    const chulsu = await uidOf(q, "철수");
    const p = await rawPersonal(q, await roundOf(q, "2주차"), chulsu, "개인 A");
    const yes = async (u: string) => (await one(q, "select public.is_task_assignee($1, $2::uuid) as v", [p, u])).v as boolean;
    assertEquals([await yes(chulsu), await yes(await uidOf(q, "지은"))], [true, false]);
    await q("update public.goal_nodes set archived_at = now() where id = $1", [p]);
    assertEquals(await yes(chulsu), false);
  } },
  { name: "RLS 정책: 남의 개인 목표는 owner_id 조건이 붙는다", run: async (q) => {
    const pol = await one(q, "select pg_get_expr(polqual, polrelid) as e from pg_policy where polname = 'goal_nodes_select'");
    assert(String(pol.e).includes("owner_id"));
    assert(String(pol.e).includes("can_read_submissions"));
  } },
]);
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test -A --config supabase/tests/deno.json supabase/tests/personal-goals-sql.test.ts 2>&1 | tail -15`
Expected: FAIL (column "owner_id" does not exist 등).

- [ ] **Step 3: 마이그레이션 §1~§4 작성** — `supabase/migrations/0014_personal_goals.sql`

```sql
-- 0014_personal_goals.sql — 개인 목표(팀원이 회차 아래에 직접 등록하는 PERSONAL 리프) + 내 과제(me_tasks). 배포 후 수정 금지.
-- 추가형: 컬럼 1·제약·인덱스·트리거·정책 교체·함수 교체/추가. 기존 행은 owner_id null · task_type COMMON|DESIGNATED|null 로 새 제약을 모두 만족한다.
-- 모델(스펙 §5.1 P1): 개인 목표 = goal_nodes 리프(task_type 'PERSONAL', owner_id = 만든 사람, depth 3 = 회차 바로 아래).
--   task_assignments 행을 만들지 않는다 → 팀 진척(room_progress)·내 진척(rooms_list mine)·완료 알림(TASK_ALL_SUBMITTED·digest)·
--   이탈 결정(deactivate_pending)은 손대지 않아도 개인 목표를 세지 않는다. 방 통계(room_leaf_stats)만 명시적으로 뺀다.
--   제출 자격은 is_task_assignee 가 소유자도 참으로 본다 → submission_target·첨부 업로드 정책(is_my_task)·task_get.isAssignee 그대로 동작.
-- 재정의 함수는 각 함수의 최신 정의를 복사해 고친 것이다. 시그니처가 같으면 GRANT 유지.

-- ───────── 1. 컬럼·제약·인덱스 ─────────
alter table public.goal_nodes add column owner_id uuid references public.profiles(id);
alter table public.goal_nodes drop constraint ck_goal_nodes_type;
alter table public.goal_nodes add constraint ck_goal_nodes_type
  check (task_type is null or task_type in ('COMMON', 'DESIGNATED', 'PERSONAL'));
-- 개인 목표 ⇔ 소유자. task_type 이 null 일 때 비교가 null(=통과)로 빠지지 않게 is not distinct from
alter table public.goal_nodes add constraint ck_goal_nodes_owner
  check ((task_type is not distinct from 'PERSONAL') = (owner_id is not null));
-- 회차 바로 아래만 (묶음 아래·회차 자리 금지)
alter table public.goal_nodes add constraint ck_goal_nodes_personal_depth
  check (task_type is distinct from 'PERSONAL' or depth = 3);
create index ix_goal_nodes_owner on public.goal_nodes (owner_id, room_id) where owner_id is not null;

-- 개인 목표 아래에는 아무것도 둘 수 없다(직접 INSERT·UPDATE 경로 포함). RPC 경로는 node_get 가드가 먼저 막는다
create or replace function public.goal_nodes_personal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and exists (select 1 from public.goal_nodes p where p.id = new.parent_id and p.task_type = 'PERSONAL') then
    perform public.fail('PERSONAL_NODE', '개인 목표 아래에는 항목을 둘 수 없어요', jsonb_build_object('nodeId', new.parent_id::text));
  end if;
  return new;
end $$;
create trigger trg_goal_nodes_personal_guard
  before insert or update of parent_id on public.goal_nodes
  for each row execute function public.goal_nodes_personal_guard();

-- ───────── 2. 편집자 RPC(node_*) 에서 개인 목표 차단 (0006 판 + PERSONAL 거부) ─────────
-- node_create(부모)·update·delete·archive·unarchive·move(대상·부모)·indent·outdent 가 모두 이 함수를 지난다.
-- 회차를 지우거나 보관하면 서브트리(개인 목표 포함)는 기존 규칙대로 함께 처리된다(회차 자체는 PERSONAL 이 아니다).
create or replace function public.node_get(p_room bigint, p_node bigint) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes;
begin
  select * into n from public.goal_nodes where id = p_node and room_id = p_room;
  if not found then perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', p_node::text)); end if;
  if n.task_type = 'PERSONAL' then
    perform public.fail('PERSONAL_NODE', '개인 목표는 진행목표 편집으로 바꿀 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  return n;
end $$;

-- ───────── 3. 판정 헬퍼 (GRANT 없음 — D7) ─────────
-- 개인 목표 소유 자격: 그룹장 | ACTIVE 멤버
create or replace function public.personal_eligible(p_room bigint, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (
    exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = p_uid)
    or exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status = 'ACTIVE'))
$$;

-- 남의 개인 목표를 볼 수 있나: 그룹장 | ACTIVE·INACTIVE 멤버 (= can_read_submissions 범위의 임의 uid 판, 스펙 R3·D1)
create or replace function public.personal_viewer(p_room bigint, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (
    exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = p_uid)
    or exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE')))
$$;

-- 소유자당 회차당 보관 제외 상한 (스펙 R9·D5)
create or replace function public.personal_limit() returns int
language sql immutable set search_path = '' as $$ select 20 $$;

-- 0003 판 + 보관 아닌 개인 목표의 소유자. submission_target·is_my_task(첨부 업로드 정책)·task_get.isAssignee 가 이걸 본다
create or replace function public.is_task_assignee(p_node bigint, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_assignments a where a.node_id = p_node and a.user_id = p_user and a.released_at is null)
      or exists (select 1 from public.goal_nodes n
                 where n.id = p_node and n.task_type = 'PERSONAL' and n.owner_id = p_user and n.archived_at is null)
$$;

-- ───────── 4. RLS: 남의 개인 목표 행은 같은 방 그룹장·ACTIVE·INACTIVE 멤버만 ─────────
-- 공개 방 비로그인·외부인·승인 대기자에게는 팀 노드만. task_assignments·submissions 정책은 그대로(개인 목표엔 배정 행이 없고, 제출 열람은 원래 같은 범위)
drop policy goal_nodes_select on public.goal_nodes;
create policy goal_nodes_select on public.goal_nodes for select
  using (public.can_read_room(room_id)
         and (owner_id is null or owner_id = (select public.current_user_id()) or public.can_read_submissions(room_id)));
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test -A --config supabase/tests/deno.json supabase/tests/personal-goals-sql.test.ts 2>&1 | tail -8 && npm run test:db 2>&1 | tail -4`
Expected: 새 파일 PASS, 전체 0 failed. (`expectFail` 은 메시지에 제약 이름이 들어 있으면 통과 — PGlite 의 check 위반 메시지에 제약명이 나온다. 안 나오면 `23514` 로 바꾼다.)

- [ ] **Step 5: 커밋**

```bash
cd /Users/picpal/Desktop/workspace/sgtudy && git add supabase/migrations/0014_personal_goals.sql supabase/tests/personal-goals-sql.test.ts && git commit -m "feat(db): 0014 개인 목표 스키마·가드·노출 정책 (owner_id, PERSONAL, node_get 차단)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- supabase/migrations/0014_personal_goals.sql supabase/tests/personal-goals-sql.test.ts
```

---

### Task 2: 0014 — 쓰기 RPC `personal_*` (judgment · opus)

**Files:**
- Modify: `supabase/migrations/0014_personal_goals.sql` (§5 이어 붙이기)
- Modify: `supabase/tests/personal-goals-sql.test.ts` (`cases("personal goals · write", …)` 추가)

**Interfaces:**
- Produces(공개 RPC, authenticated):
  - `personal_create(p_slug text, p_round_id bigint, p_title text, p_start_date date default null, p_end_date date default null, p_description_md text default '') → jsonb` = Curriculum ∪ `{createdId, warnings}`
  - `personal_update(p_slug text, p_node_id bigint, p_patch jsonb) → jsonb` = Curriculum ∪ `{warnings}` (키: title·descriptionMd·startDate·endDate·roundId)
  - `personal_archive(p_slug text, p_node_id bigint, p_archived boolean) → jsonb`
  - `personal_delete(p_slug text, p_node_id bigint) → jsonb`
  - `personal_complete(p_slug text, p_node_id bigint, p_done boolean) → jsonb`
- Produces(내부): `personal_room(text, uuid)`, `personal_get(bigint, bigint, uuid)`, `personal_round(bigint, bigint)`, `personal_check(rooms, text, date, date)`, `personal_assert_capacity(bigint, uuid, bigint)`
- Consumes: `room_lock`, `room_readable`, `patch_date`, `node_renumber`, `curriculum_json`(Task 3 에서 재정의되지만 여기선 기존 판으로 충분), `kst_deadline`, `app_now`

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
const create = (q: Q, round: string, title: string, s?: string, e?: string) =>
  one(q, "select public.personal_create('aws', $1, $2, $3::date, $4::date) as c", [round, title, s ?? null, e ?? null]).then((r) => r.c as Row);
const nodeOf = (c: Row, id: string) => (c.nodes as Row[]).find((n) => n.id === id)!;

cases("personal goals · write", db, [
  { name: "create: 편집 권한 없는 ACTIVE 멤버, 기본 기간 = 회차, 끝 순서, 팀 수치 불변", run: async (q) => {
    const r3 = await roundOf(q, "3주차");
    await asUser(q, await uidOf(q, "철수"));
    const before = (await one(q, "select public.curriculum_get('aws', true) as c")).c;
    const c = await create(q, r3, "  Udemy 7강 듣기  ");
    const n = nodeOf(c, c.createdId);
    assertEquals([n.title, n.startDate, n.endDate, n.parentId, n.depth, n.task.type, n.task.assigned, n.task.submitted],
                 ["Udemy 7강 듣기", "2026-10-15", "2026-10-21", r3, 3, "personal", 1, 0]);
    assertEquals(n.sortOrder, Math.max(...(c.nodes as Row[]).filter((x) => x.parentId === r3).map((x) => x.sortOrder)));
    assertEquals(c.stats, before.stats);
    assertEquals(nodeOf(c, r3).pct, nodeOf(before, r3).pct);
    assertEquals(c.warnings, []);
  } },
  { name: "create 거부: 대기자·외부인·이탈자 / 종료 방 / 보관 회차 / 방 기간 밖 / 80자 초과 / 한도 20", run: async (q) => {
    const r3 = await roundOf(q, "3주차");
    await asUser(q, await uidOf(q, "서연"));
    await expectFail(create(q, r3, "x"), "NOT_ACTIVE_MEMBER");
    await asUser(q, await uidOf(q, "도윤"));                                   // INACTIVE
    await expectFail(create(q, r3, "x"), "NOT_ACTIVE_MEMBER");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(create(q, r3, "x", "2026-09-30", "2026-10-02"), "INVALID_PERIOD");
    await expectFail(create(q, r3, "가".repeat(81)), "INVALID_TITLE");
    for (let i = 0; i < 20; i++) await create(q, r3, `목표 ${i}`);
    await expectFail(create(q, r3, "21번째"), "PERSONAL_LIMIT_EXCEEDED");
    await asUser(q, await uidOf(q, "민수"));
    await q("select public.node_archive('aws', $1)", [await roundOf(q, "4주차")]);
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(create(q, await roundOf(q, "4주차"), "x"), "PARENT_ARCHIVED");
    await q("update public.rooms set status = 'ENDED' where slug = 'aws'");
    await expectFail(create(q, r3, "x"), "ROOM_NOT_EDITABLE");
  } },
  { name: "update: 소유자만, 회차 이동 + 기간을 한 번에, 회차 밖 경고", run: async (q) => {
    const r3 = await roundOf(q, "3주차");
    const r4 = await roundOf(q, "4주차");
    await asUser(q, await uidOf(q, "철수"));
    const id = (await create(q, r3, "A")).createdId as string;
    let c = (await one(q, "select public.personal_update('aws', $1, $2::jsonb) as c",
      [id, JSON.stringify({ roundId: r4, startDate: "2026-10-22", endDate: "2026-10-24", title: "A2" })])).c;
    assertEquals([nodeOf(c, id).parentId, nodeOf(c, id).roundId, nodeOf(c, id).startDate, nodeOf(c, id).title, c.warnings], [r4, r4, "2026-10-22", "A2", []]);
    c = (await one(q, "select public.personal_update('aws', $1, '{\"endDate\":\"2026-10-30\"}'::jsonb) as c", [id])).c;
    assertEquals(c.warnings, [{ code: "PERIOD_OUTSIDE_PARENT", nodeId: id }]);
    await expectFail(q("select public.personal_update('aws', $1, '{\"owner\":\"x\"}'::jsonb)", [id]), "VALIDATION_FAILED");
    await asUser(q, await uidOf(q, "민수"));                                   // 그룹장도 내용은 못 고친다
    await expectFail(q("select public.personal_update('aws', $1, '{\"title\":\"x\"}'::jsonb)", [id]), "NOT_OWNER");
    await asUser(q, await uidOf(q, "서연"));                                   // 외부인: 존재 숨김
    await expectFail(q("select public.personal_update('aws', $1, '{\"title\":\"x\"}'::jsonb)", [id]), "NODE_NOT_FOUND");
  } },
  { name: "complete: 빈 제출로 완료·지각 판정, 내용 없는 완료만 취소", run: async (q) => {
    const r2 = await roundOf(q, "2주차");                                      // 10.08–10.14, 오늘 10.12
    await asUser(q, await uidOf(q, "철수"));
    const id = (await create(q, r2, "B")).createdId as string;
    let c = (await one(q, "select public.personal_complete('aws', $1, true) as c", [id])).c;
    assertEquals([nodeOf(c, id).task.submitted, nodeOf(c, id).task.people[0].status], [1, "done"]);
    await one(q, "select public.personal_complete('aws', $1, true) as c", [id]);   // 멱등
    c = (await one(q, "select public.personal_complete('aws', $1, false) as c", [id])).c;
    assertEquals(nodeOf(c, id).task.submitted, 0);
    await q("select public.submission_upsert($1, '메모', '{}', '{}')", [id]);      // 제출 카드 경로도 소유자에게 열린다
    await expectFail(q("select public.personal_complete('aws', $1, false)", [id]), "SUBMISSION_HAS_CONTENT");
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(q("select public.personal_complete('aws', $1, true)", [id]), "NOT_OWNER");
  } },
  { name: "archive/delete: 소유자·그룹장, 그룹장은 제출 있으면 삭제 불가, 소유자는 제출째 삭제", run: async (q) => {
    const r2 = await roundOf(q, "2주차");
    const chulsu = await uidOf(q, "철수");
    await asUser(q, chulsu);
    const id = (await create(q, r2, "C")).createdId as string;
    await q("select public.personal_complete('aws', $1, true)", [id]);
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(q("select public.personal_delete('aws', $1)", [id]), "NODE_HAS_SUBMISSIONS");
    let c = (await one(q, "select public.personal_archive('aws', $1, true) as c", [id])).c;
    assertEquals(nodeOf(c, id).archived, true);
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(q("select public.personal_archive('aws', $1, false)", [id]), "NOT_OWNER");
    await asUser(q, chulsu);
    c = (await one(q, "select public.personal_archive('aws', $1, false) as c", [id])).c;
    assertEquals(nodeOf(c, id).archived, false);
    c = (await one(q, "select public.personal_delete('aws', $1) as c", [id])).c;
    assertEquals((c.nodes as Row[]).some((n) => n.id === id), false);
    assertEquals((await one(q, "select count(*)::int as n from public.submissions where node_id = $1", [id])).n, 0);
  } },
]);
```

- [ ] **Step 2: 실패 확인** — Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test -A --config supabase/tests/deno.json supabase/tests/personal-goals-sql.test.ts 2>&1 | tail -15` → Expected: FAIL(function personal_create does not exist).

- [ ] **Step 3: §5 작성** (파일 끝에 이어 붙인다)

```sql
-- ───────── 5. 개인 목표 쓰기 RPC ─────────
-- 공통 선행: 방 잠금 → 존재 은닉(못 읽으면 ROOM_NOT_FOUND) → 방 RECRUIT·ACTIVE·미보관
-- DRAFT 제외: 그룹장 혼자라 필요 없고, room_open_recruit 의 "말단 과제 1개 이상"(0004) 을 개인 목표가 통과시키면 안 된다
create or replace function public.personal_room(p_slug text, p_uid uuid) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public.room_lock(p_slug);
  if not public.room_readable(r.id, p_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.archived_at is not null or r.status not in ('RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_NOT_EDITABLE', '모집 중이거나 진행 중인 스터디에서만 개인 목표를 바꿀 수 있어요', jsonb_build_object('status', lower(r.status)));
  end if;
  return r;
end $$;

-- 같은 방의 개인 목표 한 건. 팀 노드 id·남의 목표(볼 수 없는 사람) → NODE_NOT_FOUND (존재 숨김)
create or replace function public.personal_get(p_room bigint, p_node bigint, p_uid uuid) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes;
begin
  select * into n from public.goal_nodes where id = p_node and room_id = p_room and task_type = 'PERSONAL';
  if not found or (n.owner_id is distinct from p_uid and not public.personal_viewer(p_room, p_uid)) then
    perform public.fail('NODE_NOT_FOUND', '개인 목표를 찾을 수 없어요', jsonb_build_object('nodeId', p_node::text));
  end if;
  return n;
end $$;

-- 담을 회차: 같은 방 루트 · 보관 아님 · 과제형 회차(A7) 아님
create or replace function public.personal_round(p_room bigint, p_round bigint) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare rd public.goal_nodes;
begin
  select * into rd from public.goal_nodes where id = p_round and room_id = p_room and parent_id is null;
  if not found then perform public.fail('NODE_NOT_FOUND', '회차를 찾을 수 없어요', jsonb_build_object('nodeId', coalesce(p_round::text, ''))); end if;
  if rd.archived_at is not null then
    perform public.fail('PARENT_ARCHIVED', '보관된 회차에는 개인 목표를 둘 수 없어요', jsonb_build_object('nodeId', rd.id::text));
  end if;
  if rd.task_type is not null then
    perform public.fail('VALIDATION_FAILED', '회차 아래에만 개인 목표를 둘 수 있어요', '{"field":"roundId"}'::jsonb);
  end if;
  return rd;
end $$;

-- 제목 1~80 · 시작 ≤ 끝 · 방 기간 안(팀원이 그룹장의 방 종료일 조정을 막지 않게, 스펙 §5.4)
create or replace function public.personal_check(r public.rooms, p_title text, p_s date, p_e date) returns void
language plpgsql set search_path = '' as $$
begin
  if p_title is null or length(p_title) < 1 or length(p_title) > 80 then
    perform public.fail('INVALID_TITLE', '제목은 1~80자예요', '{"field":"title"}'::jsonb);
  end if;
  if p_s > p_e then perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb); end if;
  if p_s < r.start_date or p_e > r.end_date then
    perform public.fail('INVALID_PERIOD', format('방 기간(%s – %s) 안에서 정해 주세요', to_char(r.start_date, 'MM.DD'), to_char(r.end_date, 'MM.DD')),
                        jsonb_build_object('field', case when p_s < r.start_date then 'startDate' else 'endDate' end, 'reason', 'room'));
  end if;
end $$;

create or replace function public.personal_assert_capacity(p_round bigint, p_uid uuid, p_except bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.goal_nodes
      where parent_id = p_round and owner_id = p_uid and archived_at is null and id is distinct from p_except) >= public.personal_limit() then
    perform public.fail('PERSONAL_LIMIT_EXCEEDED', format('회차마다 개인 목표는 %s개까지예요', public.personal_limit()),
                        jsonb_build_object('limit', public.personal_limit()));
  end if;
end $$;

create or replace function public.personal_create(
  p_slug text, p_round_id bigint, p_title text, p_start_date date default null, p_end_date date default null, p_description_md text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  r       public.rooms;
  rd      public.goal_nodes;
  v_title text := trim(coalesce(p_title, ''));
  v_desc  text := coalesce(p_description_md, '');
  v_s     date;
  v_e     date;
  v_n     int;
  v_id    bigint;
  v_warn  jsonb := '[]'::jsonb;
begin
  r := public.personal_room(p_slug, v_uid);
  if not public.personal_eligible(r.id, v_uid) then
    perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 개인 목표를 만들 수 있어요');
  end if;
  rd := public.personal_round(r.id, p_round_id);
  -- 기본 기간 = 회차 기간을 방 기간으로 자른 것 (방 밖으로 나간 기존 회차 대비)
  v_s := coalesce(p_start_date, greatest(rd.start_date, r.start_date));
  v_e := coalesce(p_end_date, least(rd.end_date, r.end_date));
  perform public.personal_check(r, v_title, v_s, v_e);
  if length(v_desc) > 20000 then perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb); end if;
  perform public.personal_assert_capacity(rd.id, v_uid, null);

  select count(*)::int into v_n from public.goal_nodes where parent_id = rd.id;
  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, description_md, start_date, end_date, task_type, owner_id)
  values (r.id, rd.id, rd.id, 3, v_n, v_title, v_desc, v_s, v_e, 'PERSONAL', v_uid)
  returning id into v_id;
  if v_s < rd.start_date or v_e > rd.end_date then
    v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_PARENT', 'nodeId', v_id::text);
  end if;
  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('createdId', v_id::text, 'warnings', v_warn);
end $$;

-- 소유자 전용. 회차 이동(roundId) + 기간 + 내용을 한 트랜잭션에 (스펙 §5.5)
create or replace function public.personal_update(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  r       public.rooms;
  n       public.goal_nodes;
  rd      public.goal_nodes;
  k       text;
  v_title text;
  v_desc  text;
  v_s     date;
  v_e     date;
  v_round bigint;
  v_sort  int;
  v_warn  jsonb := '[]'::jsonb;
begin
  r := public.personal_room(p_slug, v_uid);
  n := public.personal_get(r.id, p_node_id, v_uid);
  if n.owner_id <> v_uid then perform public.fail('NOT_OWNER', '본인 개인 목표만 고칠 수 있어요'); end if;
  if not public.personal_eligible(r.id, v_uid) then perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 개인 목표를 고칠 수 있어요'); end if;
  if n.archived_at is not null then
    perform public.fail('TASK_ARCHIVED', '보관된 목표는 고칠 수 없어요 · 먼저 보관을 해제해 주세요', jsonb_build_object('nodeId', n.id::text));
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요'); end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'descriptionMd', 'startDate', 'endDate', 'roundId') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
    if k in ('title', 'descriptionMd', 'roundId') and jsonb_typeof(p_patch->k) <> 'string' then
      perform public.fail('VALIDATION_FAILED', '문자열이어야 해요', jsonb_build_object('field', k));
    end if;
  end loop;

  v_title := case when p_patch ? 'title' then trim(p_patch->>'title') else n.title end;
  v_desc  := coalesce(p_patch->>'descriptionMd', n.description_md);
  if length(v_desc) > 20000 then perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb); end if;
  v_s := coalesce(public.patch_date(p_patch, 'startDate'), n.start_date);
  v_e := coalesce(public.patch_date(p_patch, 'endDate'), n.end_date);
  perform public.personal_check(r, v_title, v_s, v_e);

  v_round := n.parent_id;
  if p_patch ? 'roundId' then
    begin v_round := (p_patch->>'roundId')::bigint;
    exception when invalid_text_representation then perform public.fail('VALIDATION_FAILED', '회차 id 가 올바르지 않아요', '{"field":"roundId"}'::jsonb);
    end;
  end if;
  rd := public.personal_round(r.id, v_round);
  v_sort := n.sort_order;
  if rd.id <> n.parent_id then
    perform public.personal_assert_capacity(rd.id, v_uid, n.id);
    perform public.node_renumber(r.id, n.parent_id, n.id);
    select count(*)::int into v_sort from public.goal_nodes where parent_id = rd.id;
  end if;

  update public.goal_nodes
     set parent_id = rd.id, round_id = rd.id, sort_order = v_sort,
         title = v_title, description_md = v_desc, start_date = v_s, end_date = v_e, updated_at = now()
   where id = n.id;
  if v_s < rd.start_date or v_e > rd.end_date then
    v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_PARENT', 'nodeId', n.id::text);
  end if;
  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('warnings', v_warn);
end $$;

-- 소유자(자격 있음) 또는 그룹장(모더레이션, 스펙 R4·D7). 해제는 회차 보관 아님 + 소유자 자격 + 한도
create or replace function public.personal_archive(p_slug text, p_node_id bigint, p_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes;
begin
  if p_archived is null then perform public.fail('VALIDATION_FAILED', '보관 여부가 필요해요', '{"field":"archived"}'::jsonb); end if;
  r := public.personal_room(p_slug, v_uid);
  n := public.personal_get(r.id, p_node_id, v_uid);
  if not ((n.owner_id = v_uid and public.personal_eligible(r.id, v_uid)) or r.leader_id = v_uid) then
    perform public.fail('NOT_OWNER', '본인 개인 목표만 보관할 수 있어요');
  end if;
  if p_archived then
    update public.goal_nodes set archived_at = now(), updated_at = now() where id = n.id and archived_at is null;
  elsif n.archived_at is not null then
    if exists (select 1 from public.goal_nodes p where p.id = n.parent_id and p.archived_at is not null) then
      perform public.fail('PARENT_ARCHIVED', '회차가 보관 중이에요. 회차를 먼저 해제해 주세요', jsonb_build_object('nodeId', n.parent_id::text));
    end if;
    if not public.personal_eligible(r.id, n.owner_id) then
      perform public.fail('OWNER_NOT_ACTIVE', '팀을 떠난 팀원의 목표는 되살릴 수 없어요');
    end if;
    perform public.personal_assert_capacity(n.parent_id, n.owner_id, n.id);
    update public.goal_nodes set archived_at = null, updated_at = now() where id = n.id;
  end if;
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- 소유자: 제출·링크까지 삭제(첨부는 soft delete — Storage 객체는 정리 잡 몫). 그룹장: 제출 없을 때만(팀원 기록 보호)
create or replace function public.personal_delete(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes; v_owner boolean;
begin
  r := public.personal_room(p_slug, v_uid);
  n := public.personal_get(r.id, p_node_id, v_uid);
  v_owner := n.owner_id = v_uid and public.personal_eligible(r.id, v_uid);
  if not (v_owner or r.leader_id = v_uid) then perform public.fail('NOT_OWNER', '본인 개인 목표만 지울 수 있어요'); end if;
  if exists (select 1 from public.submissions s where s.node_id = n.id) then
    if not v_owner then
      perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 팀원 목표는 삭제할 수 없어요. 보관해 주세요', jsonb_build_object('nodeId', n.id::text));
    end if;
    update public.files set submission_id = null, status = 'DELETED', deleted_at = now()
     where submission_id in (select s.id from public.submissions s where s.node_id = n.id) and status <> 'DELETED';
    delete from public.submissions where node_id = n.id;      -- submission_links 는 cascade
  end if;
  delete from public.goal_nodes where id = n.id;              -- files.node_id 는 set null
  perform public.node_renumber(r.id, n.parent_id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- 완료 = 빈 제출 행(지각 = 마감 뒤 처음 완료). 취소 = 내용(본문·링크·첨부) 없는 제출만 삭제 (스펙 R5·D2).
-- 진행중 방만(제출과 같음). 시작일 검사는 없다 — 개인 목표는 미리 끝내도 된다
create or replace function public.personal_complete(p_slug text, p_node_id bigint, p_done boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_now timestamptz := public.app_now();
  r     public.rooms;
  n     public.goal_nodes;
  s     public.submissions;
begin
  if p_done is null then perform public.fail('VALIDATION_FAILED', '완료 여부가 필요해요', '{"field":"done"}'::jsonb); end if;
  r := public.room_lock(p_slug);
  if not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('ROOM_NOT_ACTIVE', '진행중인 스터디에서만 완료할 수 있어요');
  end if;
  n := public.personal_get(r.id, p_node_id, v_uid);
  if n.owner_id <> v_uid then perform public.fail('NOT_OWNER', '본인 개인 목표만 완료할 수 있어요'); end if;
  if not public.personal_eligible(r.id, v_uid) then perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 완료할 수 있어요'); end if;
  if n.archived_at is not null then perform public.fail('TASK_ARCHIVED', '보관된 목표는 완료할 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;

  select * into s from public.submissions where node_id = n.id and user_id = v_uid;
  if p_done and s.id is null then
    insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
    values (n.id, v_uid, '', v_now, v_now >= public.kst_deadline(n.end_date), v_now);
  elsif not p_done and s.id is not null then
    if s.body_md <> '' or exists (select 1 from public.submission_links l where l.submission_id = s.id)
       or exists (select 1 from public.files f where f.submission_id = s.id and f.status <> 'DELETED') then
      perform public.fail('SUBMISSION_HAS_CONTENT', '제출 내용이 있는 목표는 완료를 취소할 수 없어요');
    end if;
    delete from public.submissions where id = s.id;
  end if;
  return public.curriculum_json(r.id, v_uid, true);
end $$;

grant execute on function public.personal_create(text, bigint, text, date, date, text) to authenticated;
grant execute on function public.personal_update(text, bigint, jsonb)                  to authenticated;
grant execute on function public.personal_archive(text, bigint, boolean)               to authenticated;
grant execute on function public.personal_delete(text, bigint)                         to authenticated;
grant execute on function public.personal_complete(text, bigint, boolean)              to authenticated;
```

주의: 이 Task 시점의 `curriculum_json` 은 0011 판이라 개인 리프가 `assigned 0`·`people []` 이고 `stats.leafCount` 에 들어간다 → Step 1 의 세 단언(`create` 케이스의 `n.task.assigned`/`assertEquals(c.stats, before.stats)`, `complete` 케이스의 `task.submitted`/`people[0].status`)은 **Task 3 이후 통과**. Task 2 에서는 그 단언들을 `// Task 3` 주석으로 잠시 막고(나머지는 통과해야 함), Task 3 Step 4 에서 주석을 풀어 다시 돌린다.

- [ ] **Step 4: 통과 확인** — Run: `deno test … personal-goals-sql.test.ts` → Expected: write 케이스 중 Task 3 의존 단언 외 PASS. `npm run test:db` 0 failed.
- [ ] **Step 5: 커밋** — `git commit -m "feat(db): 0014 personal_create/update/archive/delete/complete" -- supabase/migrations/0014_personal_goals.sql supabase/tests/personal-goals-sql.test.ts` (끝 두 줄 포함)

---

### Task 3: 0014 — 읽기 경로 재정의 (judgment · opus)

**Files:**
- Modify: `supabase/migrations/0014_personal_goals.sql` (§6)
- Modify: `supabase/tests/personal-goals-sql.test.ts` (`cases("personal goals · read", …)`)

**Interfaces:**
- Produces: `curriculum_json`(노출 필터·`ownerId`·개인 task·stats 팀만·`personal:{canAdd,perRound}`), `room_leaf_stats`(팀만), `task_node_json`(개인 people·집계·`ownerId`), `task_get`(개인 노출 필터), `tag_autoselect`(개인 제목 제외), `assignment_resync`(자격 잃은 소유자의 개인 목표 보관)

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
const cur = (q: Q) => one(q, "select public.curriculum_get('aws', true) as c").then((r) => r.c as Row);
const hasTitle = (c: Row, t: string) => (c.nodes as Row[]).some((n) => n.title === t);

cases("personal goals · read", db, [
  { name: "노출: 소유자·그룹장·ACTIVE·INACTIVE 는 보고, 외부인·비로그인·대기자는 못 본다", run: async (q) => {
    await asUser(q, await uidOf(q, "철수"));
    const id = (await create(q, await roundOf(q, "3주차"), "철수 목표")).createdId as string;
    for (const nick of ["철수", "민수", "지은", "도윤"]) { await asUser(q, await uidOf(q, nick)); assert(hasTitle(await cur(q), "철수 목표"), nick); }
    await asUser(q, await uidOf(q, "서연")); assertEquals(hasTitle(await cur(q), "철수 목표"), false);
    await asAnon(q);                          assertEquals(hasTitle(await cur(q), "철수 목표"), false);
    await asAnon(q);
    await expectFail(q("select public.task_get('aws', $1)", [id]), "NODE_NOT_FOUND");
    await asUser(q, await uidOf(q, "지은"));
    const t = (await one(q, "select public.task_get('aws', $1) as t", [id])).t;
    assertEquals([t.node.task.type, t.node.ownerId, t.node.task.people.length, t.isAssignee], ["personal", await uidOf(q, "철수"), 1, false]);
  } },
  { name: "팀 수치 불변: 완료해도 stats·회차 pct·room_get stats/myProgress 그대로", run: async (q) => {
    await asUser(q, await uidOf(q, "철수"));
    const r2 = await roundOf(q, "2주차");
    const c0 = await cur(q);
    const d0 = (await one(q, "select public.room_get('aws') as d")).d;
    const id = (await create(q, r2, "D")).createdId as string;
    await q("select public.personal_complete('aws', $1, true)", [id]);
    const c1 = await cur(q);
    const d1 = (await one(q, "select public.room_get('aws') as d")).d;
    assertEquals([c1.stats, nodeOf(c1, r2).assigned, nodeOf(c1, r2).submitted], [c0.stats, nodeOf(c0, r2).assigned, nodeOf(c0, r2).submitted]);
    assertEquals([d1.stats, d1.rounds, d1.myProgress, d1.currentRound], [d0.stats, d0.rounds, d0.myProgress, d0.currentRound]);
    assertEquals([nodeOf(c1, id).assigned, nodeOf(c1, id).submitted, nodeOf(c1, id).task.state], [1, 1, "complete"]);
  } },
  { name: "curriculum.personal: canAdd(ACTIVE·그룹장·RECRUIT/ACTIVE), perRound 20, myPermissions 모양 그대로", run: async (q) => {
    await asUser(q, await uidOf(q, "지은"));
    let c = await cur(q);
    assertEquals([c.personal, c.myPermissions], [{ canAdd: true, perRound: 20 }, { canEditCurriculum: false }]);
    await asUser(q, await uidOf(q, "도윤"));
    assertEquals((await cur(q)).personal, { canAdd: false, perRound: 20 });
    await asAnon(q);
    assertEquals((await cur(q)).personal, { canAdd: false, perRound: 20 });
  } },
  { name: "자격 상실(INACTIVE) → resync 가 그 사람 개인 목표를 보관, 제출 보존, 재ACTIVE 후 본인 해제", run: async (q) => {
    const hana = await uidOf(q, "하나");
    await asUser(q, hana);
    const id = (await create(q, await roundOf(q, "2주차"), "하나 목표")).createdId as string;
    await q("select public.personal_complete('aws', $1, true)", [id]);
    // member_deactivate 는 하나의 단독 지정 과제(S3) 재지정 결정이 필요하다 — 여기선 resync 단계만 검증한다(이탈 RPC 끝은 resync)
    await q("update public.room_members set status = 'INACTIVE', left_at = now() where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')", [hana]);
    await q("select public.assignment_resync((select id from public.rooms where slug = 'aws'))");
    await asUser(q, await uidOf(q, "민수"));
    assertEquals(nodeOf(await cur(q), id).archived, true);
    assertEquals((await one(q, "select count(*)::int as n from public.submissions where node_id = $1", [id])).n, 1);
    await expectFail(q("select public.personal_archive('aws', $1, false)", [id]), "OWNER_NOT_ACTIVE");
    await q("update public.room_members set status = 'ACTIVE', left_at = null where user_id = $1::uuid and room_id = (select id from public.rooms where slug = 'aws')", [hana]);
    await asUser(q, hana);
    assertEquals(nodeOf((await one(q, "select public.personal_archive('aws', $1, false) as c", [id])).c, id).archived, false);
  } },
  { name: "자동 태그는 개인 목표 제목을 보지 않는다", run: async (q) => {
    const tagsOf = async () => (await q(`select rt.tag_slug as slug from public.room_tags rt
                                         join public.rooms r on r.id = rt.room_id where r.slug = 'aws' order by 1`)).map((t) => t.slug);
    await q("select public.tag_autoselect((select id from public.rooms where slug = 'aws'))");
    const before = await tagsOf();
    await asUser(q, await uidOf(q, "철수"));
    await create(q, await roundOf(q, "3주차"), "Kubernetes Docker React Java Spring 정리");   // 시드 CURATED 용어 여러 개
    await q("select public.tag_autoselect((select id from public.rooms where slug = 'aws'))");
    assertEquals(await tagsOf(), before);
  } },
]);
```


- [ ] **Step 2: 실패 확인** — `deno test … personal-goals-sql.test.ts` → FAIL(노출·assigned·personal 키).

- [ ] **Step 3: §6 작성**

```sql
-- ───────── 6. 읽기 경로 ─────────
-- 6a. 방 통계는 팀 과제만 (0006 판 + 유형 필터). room_round_stats·room_detail_json(stats·currentRound·myProgress·nextDue)·room_start 경고·
--     submission_upsert 의 TASK_ALL_SUBMITTED 가 이걸 본다 → 개인 목표는 팀 수치·전원 제출 알림에 들어가지 않는다
create or replace function public.room_leaf_stats(p_room bigint)
returns table (node_id bigint, round_id bigint, parent_id bigint, title text, task_type text,
               start_date date, end_date date, sort_order int, asg int, sub int)
language sql stable security definer set search_path = '' as $$
  select n.id, n.round_id, n.parent_id, n.title::text, n.task_type::text, n.start_date, n.end_date, n.sort_order, p.asg, p.sub
  from public.goal_nodes n
  join public.room_progress(p_room) p on p.node_id = n.id
  where n.room_id = p_room and n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null
$$;

-- 6b. Curriculum (0011 판 + 개인 목표). 남의 개인 목표는 personal_viewer 에게만. 개인 리프의 집계 = 소유자 1명(보관이면 0)
--     room_progress 는 배정 기반이라 개인 리프가 부모 롤업에 0 으로 들어간다(팀 수치 불변). stats 는 팀 리프만
create or replace function public.curriculum_json(p_room bigint, p_uid uuid, p_include_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  v_today   date := public.kst_today();
  v_people  boolean;     -- 팀 과제 people 노출: 그룹장 | ACTIVE·INACTIVE·PENDING 멤버
  v_viewer  boolean;     -- 남의 개인 목표 노출: 그룹장 | ACTIVE·INACTIVE 멤버 (0014)
  v_members jsonb;
  v_nodes   jsonb;
  v_stats   jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_people := p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')));
  v_viewer := public.personal_viewer(p_room, p_uid);

  select coalesce(jsonb_agg(
           public.person_json(m.user_id) || jsonb_build_object(
             'role', lower(m.role), 'status', lower(m.status),
             'doesTasks', m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks),
             'canEditCurriculum', public.member_can_edit_curriculum(r, m))
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  into v_members
  from public.room_members m
  where m.room_id = p_room and m.status in ('ACTIVE', 'INACTIVE');

  with recursive prog as materialized (
    select * from public.room_progress(p_room)),
  t as (
    select n.*, array[n.sort_order::bigint, n.id] as path
    from public.goal_nodes n where n.room_id = p_room and n.parent_id is null
    union all
    select c.*, t.path || array[c.sort_order::bigint, c.id]
    from public.goal_nodes c join t on c.parent_id = t.id),
  nodes as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id::text, 'parentId', t.parent_id::text, 'roundId', t.round_id::text,
             'depth', t.depth, 'sortOrder', t.sort_order, 'label', t.label, 'title', t.title,
             'descriptionMd', t.description_md,
             'startDate', to_char(t.start_date, 'YYYY-MM-DD'), 'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
             'archived', t.archived_at is not null,
             'ownerId', t.owner_id::text,
             'assigned', coalesce(ps.asg, p.asg), 'submitted', coalesce(ps.sub, p.sub),
             'pct', case when ps.asg is null then p.pct else public.pct(ps.asg, ps.sub) end,
             'task', case
               when t.task_type is null then null
               when t.task_type = 'PERSONAL' then jsonb_build_object(
                 'type', 'personal', 'assigned', ps.asg, 'submitted', ps.sub,
                 'state', public.leaf_state(ps.asg, ps.sub, t.start_date, t.end_date, v_today),
                 'people', jsonb_build_array(public.person_json(t.owner_id)
                             || jsonb_build_object('status', public.task_code(t.start_date, t.end_date, ps.first_at, ps.late, v_today))))
               else jsonb_build_object(
                 'type', lower(t.task_type),
                 'assigned', p.asg, 'submitted', p.sub,
                 'state', public.leaf_state(p.asg, p.sub, t.start_date, t.end_date, v_today),
                 -- people 은 의도적으로 멤버 순서(그룹장, joined_at, id) — room_get 의 assigned_at 순서와 다르다
                 'people', case when not v_people then '[]'::jsonb else coalesce((
                   select jsonb_agg(public.person_json(a.user_id)
                            || jsonb_build_object('status', public.task_code(t.start_date, t.end_date, s.first_submitted_at, s.is_late, v_today))
                            order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id)
                   from public.task_assignments a
                   join public.room_members m on m.room_id = p_room and m.user_id = a.user_id
                   left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
                   where a.node_id = t.id and a.released_at is null and t.archived_at is null), '[]'::jsonb) end) end)
             order by t.path), '[]'::jsonb) as j
    from t
    join prog p on p.node_id = t.id
    left join lateral (
      select case when t.archived_at is null then 1 else 0 end as asg,
             case when t.archived_at is null and s.id is not null then 1 else 0 end as sub,
             s.first_submitted_at as first_at, s.is_late as late
      from (select 1) one
      left join public.submissions s on s.node_id = t.id and s.user_id = t.owner_id) ps on t.task_type = 'PERSONAL'
    where (p_include_archived or t.archived_at is null)
      and (t.owner_id is null or t.owner_id = p_uid or v_viewer)),
  stats as (
    select jsonb_build_object(
      'overallPct', public.pct(coalesce(sum(p.asg), 0)::int, coalesce(sum(p.sub), 0)::int),
      'leafCount', count(*),
      'unassignedCount', count(*) filter (where n.task_type = 'DESIGNATED' and p.asg = 0)) as j
    from public.goal_nodes n join prog p on p.node_id = n.id
    where n.room_id = p_room and n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null)
  select (select j from nodes), (select j from stats) into v_nodes, v_stats;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'room', jsonb_build_object('slug', r.slug, 'status', lower(r.status), 'leaderDoesTasks', r.leader_does_tasks),
    'members', v_members, 'nodes', v_nodes, 'stats', v_stats,
    'myPermissions', jsonb_build_object('canEditCurriculum', public.can_edit_curriculum(r, p_uid)),
    'personal', jsonb_build_object(
      'canAdd', r.archived_at is null and r.status in ('RECRUIT', 'ACTIVE') and public.personal_eligible(p_room, p_uid),
      'perRound', public.personal_limit()));
end $$;

-- 6c. 과제 상세 노드 (0007 판 + 개인 목표: people = [소유자], 집계 = 소유자 1명, ownerId)
create or replace function public.task_node_json(p_node bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id::text, 'parentId', n.parent_id::text, 'roundId', n.round_id::text, 'depth', n.depth, 'sortOrder', n.sort_order,
    'label', n.label, 'title', n.title, 'descriptionMd', n.description_md,
    'startDate', to_char(n.start_date, 'YYYY-MM-DD'), 'endDate', to_char(n.end_date, 'YYYY-MM-DD'),
    'archived', n.archived_at is not null,
    'ownerId', n.owner_id::text,
    'task', jsonb_build_object(
      'type', lower(n.task_type),
      'people', case
        when n.task_type = 'PERSONAL' then
          case when p_uid is null or not (n.owner_id = p_uid or public.personal_viewer(n.room_id, p_uid)) then '[]'::jsonb
               else jsonb_build_array(public.person_json(n.owner_id) || jsonb_build_object('status',
                      public.task_code(n.start_date, n.end_date, ow.first_submitted_at, ow.is_late, public.kst_today()))) end
        when p_uid is null or n.archived_at is not null or not (
            exists (select 1 from public.rooms rr where rr.id = n.room_id and rr.leader_id = p_uid)
            or exists (select 1 from public.room_members m where m.room_id = n.room_id and m.user_id = p_uid
                         and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')))
          then '[]'::jsonb
        else coalesce((
          select jsonb_agg(public.person_json(a.user_id)
                           || jsonb_build_object('status', public.task_code(n.start_date, n.end_date, s.first_submitted_at, s.is_late, public.kst_today()))
                           order by a.assigned_at, a.id)
          from public.task_assignments a
          left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
          where a.node_id = n.id and a.released_at is null), '[]'::jsonb) end,
      'assigned', st.asg, 'submitted', st.sub,
      'state', public.leaf_state(st.asg, st.sub, n.start_date, n.end_date, public.kst_today())),
    'assigned', st.asg, 'submitted', st.sub, 'pct', public.pct(st.asg, st.sub))
  from public.goal_nodes n
  left join public.submissions ow on n.task_type = 'PERSONAL' and ow.node_id = n.id and ow.user_id = n.owner_id
  cross join lateral (
    select case when n.task_type = 'PERSONAL' then (case when n.archived_at is null then 1 else 0 end)
                else (select count(*)::int from public.task_assignments a where a.node_id = n.id and a.released_at is null) end as asg,
           case when n.task_type = 'PERSONAL' then (case when n.archived_at is null and ow.id is not null then 1 else 0 end)
                else (select count(s.id)::int from public.task_assignments a
                      join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
                      where a.node_id = n.id and a.released_at is null) end as sub) st
  where n.id = p_node and n.task_type is not null
$$;
```

6d `task_get`: 0007 판(`0007_submissions.sql:275-321`)을 그대로 복사하고, `if n.task_type is null then … NODE_NOT_LEAF …; end if;` 바로 다음에 아래 세 줄만 넣는다(GRANT 는 그대로라 다시 쓰지 않는다):

```sql
  -- 0014: 남의 개인 목표는 personal_viewer 에게만 (존재 숨김)
  if n.task_type = 'PERSONAL' and n.owner_id is distinct from v_uid and not public.personal_viewer(r.id, v_uid) then
    perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요');
  end if;
```

6e `tag_autoselect`: 0009 판(`0009_tags.sql:164-` 함수 끝까지)을 그대로 복사하고 노드 제목 모음 한 문장만 바꾼다:

```sql
  select string_agg(n.title, ' ' order by n.sort_order, n.id) into v_nodes
  from public.goal_nodes n where n.room_id = p_room and n.archived_at is null and n.task_type is distinct from 'PERSONAL';
```

6f `assignment_resync` (0005 판 + 0 단계):

```sql
create or replace function public.assignment_resync(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ldt    boolean;
  v_leader uuid;
begin
  select leader_does_tasks, leader_id into v_ldt, v_leader from public.rooms where id = p_room;
  if not found then return; end if;

  -- 0 (0014). 소유자가 더는 그룹장·ACTIVE 멤버가 아닌 개인 목표 → 보관(제출물은 남는다). 되살리기는 personal_archive(false)
  update public.goal_nodes n set archived_at = now(), updated_at = now()
  where n.room_id = p_room and n.task_type = 'PERSONAL' and n.archived_at is null
    and n.owner_id <> v_leader
    and not exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = n.owner_id and m.status = 'ACTIVE');

  -- 1. 원하는 (리프, 사용자) 조합을 채운다
  insert into public.task_assignments (node_id, user_id, source)
  select n.id, m.user_id, 'COMMON'
  from public.goal_nodes n
  cross join public.room_members m
  where n.room_id = p_room and n.task_type = 'COMMON' and n.archived_at is null
    and m.room_id = p_room and m.status = 'ACTIVE' and (m.role = 'MEMBER' or v_ldt)
  on conflict (node_id, user_id) do update
    set released_at = null, source = 'COMMON'
    where public.task_assignments.released_at is not null or public.task_assignments.source <> 'COMMON';

  -- 2a. 리프 보관 → COMMON·DESIGNATED 모두 해제(released_at = archived_at, D13) / COMMON 행인데 리프가 COMMON 아님 → 해제
  update public.task_assignments a set released_at = coalesce(n.archived_at, now())
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = p_room and a.released_at is null
    and (n.archived_at is not null or (a.source = 'COMMON' and n.task_type is distinct from 'COMMON'));

  -- 2b. 사용자가 담당 자격이 없음 → 해제 (COMMON: 자격 규칙, DESIGNATED: ACTIVE 멤버가 아닐 때만)
  update public.task_assignments a set released_at = now()
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = p_room and a.released_at is null
    and not exists (
      select 1 from public.room_members m
      where m.room_id = p_room and m.user_id = a.user_id and m.status = 'ACTIVE'
        and (a.source = 'DESIGNATED' or m.role = 'MEMBER' or v_ldt));
end $$;
```

- [ ] **Step 4: 통과 확인** — `deno test … personal-goals-sql.test.ts` 전부 PASS(Task 2 의 `// Task 3` 단언 주석 해제 포함). `npm run test:db 2>&1 | tail -20` → 실패가 **노드 객체 전체 비교에 `ownerId` 가 없어서**인 것만 남아야 한다(Task 5 에서 처리). 다른 실패는 멈추고 원인 분석.
- [ ] **Step 5: 커밋** — `feat(db): 0014 읽기 경로 — curriculum/task 노출 필터, 팀만 통계, 이탈 시 개인 목표 보관`

---

### Task 4: 0014 — `me_tasks` · 내 일정 (judgment · opus)

**Files:**
- Modify: `supabase/migrations/0014_personal_goals.sql` (§7)
- Modify: `supabase/tests/personal-goals-sql.test.ts` (`cases("personal goals · me", …)`)

**Interfaces:**
- Produces: `me_tasks() → jsonb MeTasks`(스펙 §5.6, authenticated), `me_schedule_leaves(uuid, date)`(반환에 `personal boolean` 추가 — drop/create), `me_schedule(date, date)`(`tasks[]`·`upcoming[]` 에 `personal`)

- [ ] **Step 1: 실패하는 테스트**

```ts
cases("personal goals · me", db, [
  { name: "me_tasks: 내 배정 팀 리프 + 내 개인 목표, 남의 것 없음, 방·회차·현재 회차", run: async (q) => {
    const jieun = await uidOf(q, "지은");
    await asUser(q, await uidOf(q, "철수"));
    await create(q, await roundOf(q, "2주차"), "철수 것");
    await asUser(q, jieun);
    const id = (await create(q, await roundOf(q, "2주차"), "지은 것")).createdId as string;
    const m = (await one(q, "select public.me_tasks() as m")).m;
    const titles = (m.items as Row[]).map((i) => i.title);
    assert(titles.includes("지은 것") && !titles.includes("철수 것"));
    assert(titles.includes("EC2 인스턴스 유형 정리"));            // 지은 지정 배정(시드 '-DO-')
    const aws = (m.studies as Row[]).find((s) => s.slug === "aws")!;
    assertEquals([aws.membership, aws.canAddPersonal, aws.currentRoundId], ["joined", true, await roundOf(q, "2주차")]);
    assertEquals((m.items as Row[]).find((i) => i.id === id)!.type, "personal");
    assertEquals(m.personalPerRound, 20);
    assert((m.rounds as Row[]).some((r) => r.slug === "aws" && r.label === "3주차" && r.canAdd === true));
  } },
  { name: "me_schedule: 내 개인 목표 포함(personal true), 대기자 미리보기·과제 안 하는 그룹장 화면에 남의 개인 목표 없음", run: async (q) => {
    await asUser(q, await uidOf(q, "지은"));
    await create(q, await roundOf(q, "2주차"), "지은 일정");
    const s = (await one(q, "select public.me_schedule('2026-10-01', '2026-10-31') as s")).s;
    assertEquals((s.tasks as Row[]).find((t) => t.title === "지은 일정")!.personal, true);
    assertEquals((s.tasks as Row[]).find((t) => t.title === "EC2 인스턴스 유형 정리")!.personal, false);
    // 과제 안 하는 그룹장: 시드 sqld 그룹장(leader_does_tasks=false)이 aws 멤버가 아니므로, aws 를 임시로 false 로 둔다
    await q("update public.rooms set leader_does_tasks = false where slug = 'aws'");
    await asUser(q, await uidOf(q, "민수"));
    const l = (await one(q, "select public.me_schedule('2026-10-01', '2026-10-31') as s")).s;
    assertEquals((l.tasks as Row[]).some((t) => t.title === "지은 일정"), false);
  } },
]);
```

- [ ] **Step 2: 실패 확인** — FAIL(me_tasks 없음, personal 키 없음).

- [ ] **Step 3: §7 작성**

```sql
-- ───────── 7. 내 일정·내 과제 ─────────
-- 7a. me_schedule_leaves (0006 판 + 개인). 반환 열이 늘어 create or replace 불가 → drop 후 create (내부 함수, GRANT 없음, me_schedule 만 부른다)
drop function public.me_schedule_leaves(uuid, date);
create function public.me_schedule_leaves(p_uid uuid, p_today date)
returns table (node_id bigint, room_id bigint, slug text, title text, s date, e date, st text, round text, personal boolean)
language sql stable security definer set search_path = '' as $$
  select n.id, r.id, r.slug::text, n.title::text, n.start_date, n.end_date,
         case when m.status = 'PENDING' or a.id is not null
              then public.task_code(n.start_date, n.end_date, sub.first_submitted_at, sub.is_late, p_today)
              else null end,
         coalesce(rn.label::text, (rn.sort_order + 1) || '주차'),
         false
  from public.rooms r
  join public.room_members m on m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE', 'PENDING')
  join public.goal_nodes n on n.room_id = r.id and n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null
  join public.goal_nodes rn on rn.id = n.round_id
  left join public.task_assignments a on a.node_id = n.id and a.user_id = p_uid and a.released_at is null
  left join public.submissions sub on sub.node_id = n.id and sub.user_id = p_uid
  where r.archived_at is null
    and (a.id is not null or m.status = 'PENDING' or (r.leader_id = p_uid and not r.leader_does_tasks))
  union all
  -- 0014: 내 개인 목표(보관 아님 — 자격을 잃으면 resync 가 보관한다)
  select n.id, r.id, r.slug::text, n.title::text, n.start_date, n.end_date,
         public.task_code(n.start_date, n.end_date, sub.first_submitted_at, sub.is_late, p_today),
         coalesce(rn.label::text, (rn.sort_order + 1) || '주차'),
         true
  from public.goal_nodes n
  join public.rooms r on r.id = n.room_id and r.archived_at is null
  join public.goal_nodes rn on rn.id = n.round_id
  left join public.submissions sub on sub.node_id = n.id and sub.user_id = p_uid
  where n.task_type = 'PERSONAL' and n.owner_id = p_uid and n.archived_at is null
$$;
```

7b `me_schedule`: 0006 판(`0006_curriculum.sql:721-772`)을 복사하고 `o` CTE 의 JSON 에 `'personal', l.personal` 하나만 더한다:

```sql
       o as (select l.*, jsonb_build_object(
               'id', l.node_id::text, 'slug', l.slug, 'title', l.title,
               's', to_char(l.s, 'YYYY-MM-DD'), 'e', to_char(l.e, 'YYYY-MM-DD'), 'st', l.st, 'round', l.round,
               'personal', l.personal) as j
             from l)
```

7c `me_tasks`:

```sql
-- 내 과제(스펙 §4.1·§5.6): 내가 그룹장이거나 ACTIVE 멤버인 미보관 방(DRAFT 는 그룹장만) — 내 유효 배정 팀 리프 + 내 개인 목표(보관 제외)
create or replace function public.me_tasks() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_today date := public.kst_today(); v_out jsonb;
begin
  with rm as materialized (
    select r.id, r.slug, r.title, r.status, r.leader_id = v_uid as is_leader
    from public.rooms r
    where r.archived_at is null
      and (r.leader_id = v_uid or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status = 'ACTIVE'))
      and (r.status <> 'DRAFT' or r.leader_id = v_uid)),
  rounds as (
    select n.id, n.room_id, n.label, n.title, n.start_date, n.end_date, n.sort_order, n.task_type
    from public.goal_nodes n join rm on rm.id = n.room_id
    where n.parent_id is null and n.archived_at is null),
  cur as (
    select rm.id as room_id, coalesce(public.room_current_round_id(rm.id, v_today),
             (select x.id from rounds x where x.room_id = rm.id order by x.start_date, x.sort_order, x.id limit 1)) as round_id
    from rm),
  items as (
    select n.id, n.room_id, n.round_id, n.parent_id, n.depth, n.title, n.task_type, n.start_date, n.end_date, s.first_submitted_at, s.is_late
    from public.goal_nodes n
    join rm on rm.id = n.room_id
    join public.task_assignments a on a.node_id = n.id and a.user_id = v_uid and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null
    union all
    select n.id, n.room_id, n.round_id, n.parent_id, n.depth, n.title, n.task_type, n.start_date, n.end_date, s.first_submitted_at, s.is_late
    from public.goal_nodes n
    join rm on rm.id = n.room_id
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.task_type = 'PERSONAL' and n.owner_id = v_uid and n.archived_at is null)
  select jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'personalPerRound', public.personal_limit(),
    'studies', (select coalesce(jsonb_agg(jsonb_build_object(
                  'slug', r.slug, 'title', r.title,
                  'tone', (array['mint', 'blue', 'peach', 'lav', 'amber', 'slate'])[1 + (r.id % 6)],
                  'status', lower(r.status),
                  'membership', case when r.is_leader then 'leader' else 'joined' end,
                  'currentRoundId', c.round_id::text,
                  'canAddPersonal', r.status in ('RECRUIT', 'ACTIVE'))
                  order by r.id), '[]'::jsonb)
                from rm r left join cur c on c.room_id = r.id),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', x.id::text, 'slug', r.slug, 'label', x.label, 'title', x.title,
                 'startDate', to_char(x.start_date, 'YYYY-MM-DD'), 'endDate', to_char(x.end_date, 'YYYY-MM-DD'),
                 'canAdd', x.task_type is null and r.status in ('RECRUIT', 'ACTIVE'))
                 order by r.id, x.sort_order, x.id), '[]'::jsonb)
               from rounds x join rm r on r.id = x.room_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id::text, 'slug', r.slug, 'roundId', i.round_id::text,
                'groupTitle', case when i.depth > 3 then (select g.title from public.goal_nodes g where g.id = i.parent_id) end,
                'title', i.title, 'type', lower(i.task_type),
                'startDate', to_char(i.start_date, 'YYYY-MM-DD'), 'endDate', to_char(i.end_date, 'YYYY-MM-DD'),
                'st', public.task_code(i.start_date, i.end_date, i.first_submitted_at, i.is_late, v_today),
                'submittedAt', public.iso(i.first_submitted_at))
                order by i.end_date, i.start_date, i.id), '[]'::jsonb)
              from items i join rm r on r.id = i.room_id))
  into v_out;
  return v_out;
end $$;

grant execute on function public.me_tasks() to authenticated;
```

(`me_schedule(date,date)` 는 create or replace 라 0006 의 GRANT 가 유지된다.)

- [ ] **Step 4: 통과 확인** — `deno test … personal-goals-sql.test.ts` PASS.
- [ ] **Step 5: 커밋** — `feat(db): 0014 me_tasks + 내 일정에 개인 목표`

---

### Task 5: DB 회귀 정리 + 0014 마감 (mechanical · sonnet)

**Files:**
- Modify: 실패하는 기존 `supabase/tests/*-sql.test.ts` 의 기대값만(노드 객체 전체 비교에 `ownerId: null` 추가)

- [ ] **Step 1:** Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db 2>&1 | grep -E "FAILED|=>|ownerId" | head -40`
- [ ] **Step 2:** 실패마다 원인이 "기대 객체에 `ownerId` 없음" 인지 확인하고 그 기대값에 `ownerId: null`(개인이면 uid)만 더한다. 다른 원인이면 **멈추고** Task 3 SQL 과 대조(복사 누락 의심).
- [ ] **Step 3:** Run: `npm run test:db 2>&1 | tail -3` → Expected: `0 failed`.
- [ ] **Step 4: 마이그레이션 자체 검토** — Run: `grep -nE "^(update|delete) " supabase/migrations/0014_personal_goals.sql` → Expected: 결과 없음(최상위 문장에 기존 행 변경 없음 — 함수 본문 안의 update/delete 는 들여쓰기돼 있어 걸리지 않는다).
- [ ] **Step 5: 커밋** — `test(db): 0014 노드 DTO ownerId 반영` (+ 끝 두 줄). 커밋 메시지 본문에 "호스티드 적용은 사용자 승인 후 `supabase db push`" 를 적는다.

---

### Task 6: 프론트 타입·API·문구 기반 (mechanical · sonnet)

**Files:**
- Modify: `src/lib/api/types.ts` (`TaskTypeDto` 에 `"personal"`, `NodeDto.ownerId?`, `Curriculum.personal?`, `ScheduleTask.personal?`, 새 `MeTasks`·`MeTaskItem`·`MeTaskStudy`·`MeTaskRound`)
- Modify: `src/data/my-study.ts` (`TaskType = "공통" | "지정" | "개인"`)
- Modify: `src/lib/api/format.ts` (`TASK_TYPE_KO.personal = "개인"`)
- Modify: `src/components/my-study/bits.tsx` (`TypeBadge`: 공통 mint · 지정 lav · 개인 peach)
- Create: `src/lib/api/personal.ts`, Test: `src/lib/api/personal.test.ts`
- Modify: `src/lib/routes.ts` (`tasks(q?)`, `task(slug, id)`), Test: `src/lib/routes.test.ts`
- Modify: `src/lib/api/errors.ts` (새 코드 문구 매핑이 있으면 — 기존 방식 확인 후 `PERSONAL_LIMIT_EXCEEDED`·`SUBMISSION_HAS_CONTENT`·`OWNER_NOT_ACTIVE`·`PERSONAL_NODE`·`NOT_OWNER`·`NOT_ACTIVE_MEMBER`)

**Interfaces (Produces):**
```ts
// src/lib/api/personal.ts
export const personalCreate = (slug: string, roundId: string, title: string, opts?: { start?: string; end?: string; desc?: string }, client?: Db) =>
  rpc<Curriculum & { createdId: string }>("personal_create", { p_slug: slug, p_round_id: roundId, p_title: title, p_start_date: opts?.start ?? null, p_end_date: opts?.end ?? null, p_description_md: opts?.desc ?? "" }, client);
export type PersonalPatch = Partial<{ title: string; descriptionMd: string; startDate: string; endDate: string; roundId: string }>;
export const personalUpdate = (slug: string, id: string, patch: PersonalPatch, client?: Db) => rpc<Curriculum>("personal_update", { p_slug: slug, p_node_id: id, p_patch: patch }, client);
export const personalArchive = (slug: string, id: string, archived: boolean, client?: Db) => rpc<Curriculum>("personal_archive", { p_slug: slug, p_node_id: id, p_archived: archived }, client);
export const personalDelete = (slug: string, id: string, client?: Db) => rpc<Curriculum>("personal_delete", { p_slug: slug, p_node_id: id }, client);
export const personalComplete = (slug: string, id: string, done: boolean, client?: Db) => rpc<Curriculum>("personal_complete", { p_slug: slug, p_node_id: id, p_done: done }, client);
export const fetchMyTasks = (client?: Db) => rpc<MeTasks>("me_tasks", {}, client);
// src/lib/routes.ts
tasks: (q?: Record<string, string>) => string   // "/tasks" + 정렬된 쿼리
task: (slug: string, id: string) => string        // `/my-study/${slug}?task=${id}` (제출 설계 §2.6 진입)
```

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/personal.test.ts`: `src/lib/api/my-study.test.ts` 의 rpc 목(mock client) 패턴을 복사해 각 함수가 RPC 이름·인자 키를 정확히 넘기는지(예: `personalComplete("aws","12",true)` → `["personal_complete", {p_slug:"aws", p_node_id:"12", p_done:true}]`). `routes.test.ts`: `routes.task("aws","12") === "/my-study/aws?task=12"`, `routes.tasks() === "/tasks"`, `routes.tasks({ study: "aws", scope: "all" }) === "/tasks?scope=all&study=aws"`.
- [ ] **Step 2:** Run: `npx vitest run src/lib/api/personal.test.ts src/lib/routes.test.ts` → FAIL.
- [ ] **Step 3:** 구현. `TaskType` 에 "개인" 을 더한 뒤 `npx tsc --noEmit` 이 가리키는 모든 `Record<TaskType, …>`·삼항(공통 ? :)을 개인을 명시하도록 고친다(개인이 지정으로 떨어지지 않게).
- [ ] **Step 4:** Run: `npm run lint && npx tsc --noEmit && npx vitest run` → PASS.
- [ ] **Step 5: 커밋** — `feat(api): 개인 목표 RPC 래퍼·타입·routes.tasks/task`

---

### Task 7: 트리 모델 — 개인 리프·롤업 제외·범위·서버 index (judgment · opus)

**Files:**
- Modify: `src/components/my-study/model.ts`, `src/components/my-study/rounds.ts`
- Modify: `src/components/my-study/fixtures.ts` (aws 픽스처에 개인 목표 2개: 철수 3주차 1개, 지은 3주차 1개(완료))
- Test: `src/components/my-study/model.test.ts`, `src/components/my-study/rounds.test.ts`

**Interfaces (Produces):**
```ts
// model.ts
LeafNode += { ownerId: string | null; personal: boolean }
Tree += { personal: LeafNode[] }          // 보관 제외 개인 리프(보이는 것 = 서버가 준 것). Tree.leaves 는 팀 리프만(의미 유지)
export type ItemScope = { meId: string | null; mineOnly: boolean; others: boolean; isEdit: boolean; isLeader: boolean };
export function inScope(n: TreeNode, sc: ItemScope): boolean;
export function visibleNodes(roots: ParentNode[], closed: Record<string, boolean>, sc?: ItemScope): TreeNode[];
   // 화면 순서: 각 부모의 kids 를 [팀(서버 순서), 내 개인(서버 순서), 남의 개인(멤버 순서→서버 순서)] 로 안정 분할. sc 없으면 지금과 같다(개인은 끝)
export function personalStats(personal: LeafNode[], userId: string, roundId?: string): { done: number; total: number };
// rounds.ts
reorderIndex(parent, id, dir)   // 이웃 = 서버 순서 kids 에서 dir 쪽 첫 "개인 아님" 형제의 index(자기 뺀 기준), 없으면 null
dropPlan(...)                   // 개인 행은 drag·over 대상이 아님(null). index 는 지금처럼 서버 순서 kids 기준
withPersonalAddRows(rows, roots, closed, canAdd): ListEntry[]   // 보기 모드: 펼친(보관 아닌) 회차마다 끝에 { kind: "padd", round }
ListEntry += { kind: "padd"; round: ParentNode }
```

규칙:
- `buildTree`: `n.task.type === "personal"` → `type: "개인"`, `personal: true`, `ownerId: n.ownerId ?? null`, people = 서버 값. 부모 롤업 `live = kids.filter(k => !k.archived && !(k.leaf && k.personal))` (팀 수치 불변 — 서버와 같음). `subAll` 은 개인 포함(삭제 거부 규칙이 서버 `node_has_submissions` 와 같아야 한다). `childCount` 는 그대로(모든 자식).
- `Tree.leaves` = `nodes.filter(n => n.leaf && !n.archived && !n.personal)`, `Tree.personal` = 개인·보관 제외.
- `inScope`: 부모 = 항상 true(빈 회차 안내는 화면 몫). 팀 리프 = `!mineOnly || !!myCode(n, meId)`. 개인 = `!isEdit && (n.ownerId === meId || (others && (!n.archived || isLeader)))`. 내 개인 목표가 보관됐으면 목록엔 보이되 흐리게(지금 보관 규칙).

- [ ] **Step 1: 실패하는 테스트** (model.test.ts 에 추가)

```ts
describe("개인 목표", () => {
  const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
  const r3 = t.roots.find((r) => r.label === "3주차")!;
  it("부모 롤업·leaves 에서 빠진다", () => {
    const team = r3.kids.filter((k) => !(k.leaf && k.personal));
    const sumAsg = team.reduce((a, k) => a + (k.archived ? 0 : k.asg), 0);
    expect(r3.asg).toBe(sumAsg);
    expect(t.leaves.some((l) => l.personal)).toBe(false);
    expect(t.personal.length).toBe(2);
  });
  it("visibleNodes: 팀 먼저, 내 것, (others 면) 남의 것 / 편집 모드엔 없음", () => {
    const sc = { meId: CHULSU, mineOnly: false, others: false, isEdit: false, isLeader: false };
    const rows = visibleNodes(t.roots, {}, sc).filter((n) => n.roundId === r3.id && n.d > 0);
    expect(rows.map((n) => (n.leaf && n.personal ? `P:${n.ownerId}` : "T"))).toEqual(["T", "T", `P:${CHULSU}`]);   // 묶음 + 묶음 안 과제, 철수 개인
    expect(visibleNodes(t.roots, {}, { ...sc, others: true }).some((n) => n.leaf && n.personal && n.ownerId === JIEUN)).toBe(true);
    expect(visibleNodes(t.roots, {}, { ...sc, isEdit: true }).some((n) => n.leaf && n.personal)).toBe(false);
  });
  it("mineOnly: 내게 배정 안 된 팀 과제는 빠진다", () => {
    const rows = visibleNodes(t.roots, {}, { meId: CHULSU, mineOnly: true, others: false, isEdit: false, isLeader: false });
    expect(rows.filter((n) => n.leaf && !n.personal).every((n) => n.leaf && !!myCode(n, CHULSU))).toBe(true);
  });
  it("personalStats", () => {
    expect(personalStats(t.personal, JIEUN)).toEqual({ done: 1, total: 1 });
  });
});
```

rounds.test.ts 에 추가:

```ts
it("reorderIndex: 개인 목표를 건너뛴 이웃 팀 과제와 자리를 바꾼다", () => {
  // 서버 순서 [T0, P, T1] 인 회차를 픽스처로 만든다 — T1 을 위로 → index 0, T0 를 아래로 → index 2(자기 뺀 [P, T1] 에서 T1 뒤)
  const round = mkRound([team("T0"), personal("P", CHULSU), team("T1")]);
  expect(reorderIndex(round, "T1", -1)).toBe(0);
  expect(reorderIndex(round, "T0", 1)).toBe(2);
  expect(reorderIndex(round, "T0", -1)).toBeNull();
});
it("dropPlan: 개인 행은 끌 수도, 놓을 자리도 아니다", () => {
  const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
  const p = t.personal[0];
  const ec2 = t.leaves.find((l) => l.title === "EC2 인스턴스 유형 정리")!;
  expect(dropPlan(t.nodes, p.id, ec2.id, "top")).toBeNull();
  expect(dropPlan(t.nodes, ec2.id, p.id, "top")).toBeNull();
});
it("withPersonalAddRows: 펼친 비보관 회차 끝에 padd, canAdd false 면 없음", () => { /* withAddRows 테스트와 같은 모양 */ });
```

(`mkRound/team/personal` 은 rounds.test.ts 안 지역 헬퍼 — `ParentNode`/`LeafNode` 최소 객체. `CHULSU`·`JIEUN` 은 fixtures 의 userId 상수.)

- [ ] **Step 2:** Run: `npx vitest run src/components/my-study/model.test.ts src/components/my-study/rounds.test.ts` → FAIL.
- [ ] **Step 3:** 구현(위 규칙). `reorderIndex`: `const sibs = parent.kids; const i = sibs.findIndex(k => k.id === id); if (i < 0) return null; let j = i + dir; while (j >= 0 && j < sibs.length && isPersonal(sibs[j])) j += dir; return j < 0 || j >= sibs.length ? null : j;` — 서버 계약 "자기를 뺀 새 형제 기준": 위로 = 이웃 자리 j(이웃이 자기보다 앞이라 자기를 빼도 그대로), 아래로 = 자기를 빼면 이웃이 j-1 로 당겨지므로 그 바로 뒤 = j. 두 방향 모두 j — 테스트로 확정한다.
- [ ] **Step 4:** Run: `npm run lint && npx tsc --noEmit && npx vitest run` → PASS (기존 model/rounds 테스트 포함).
- [ ] **Step 5: 커밋** — `feat(my-study): 트리 모델 개인 목표 — 롤업 제외·범위 필터·서버 index`

---

### Task 8: 진행목표 목록 — 칩·개인 행·"＋ 내 목표 추가" (judgment · opus)

**Files:**
- Modify: `src/components/my-study/state.ts` (`mineOnly: boolean`, `othersPersonal: boolean` — INITIAL false/false)
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx`, `tabs/TreeRow.tsx`, `tabs/QuickAdd.tsx`(톤·문구 prop), `tabs/ChildList.tsx`(팀만 — `kids.filter(!personal)`)
- Modify: `src/components/my-study/useCurriculumApi.ts` (`createPersonal(roundId, title)`, `completePersonal(id, done)`, `updatePersonal(id, patch, okText?)`, `archivePersonal(id, on)`, `removePersonal(id)` — 낙관적 처리 없음, 응답 Curriculum 으로 교체, 실패는 기존 `fail` 경로, 토스트 스펙 §6)
- Modify: `src/components/my-study/MyStudyScreen.tsx` (curriculum `personal.canAdd` 를 탭에 전달)
- Test: `src/components/my-study/state.test.ts` (INITIAL 값), `tabs/TreeRow.dom.test.ts` (개인 행: [개인] 배지, 드래그 핸들 없음, 삭제 버튼 없음, 소유자 칩)

동작(스펙 §4.3·§4.4):
- 툴바: 기존 "전체 진척률 · 과제 N개"(팀만 — `tree.leaves`) 오른쪽에 `Chip` 두 개 "내 것만"(`aria-pressed`)·"팀원 목표". 편집 모드에서는 두 칩 숨김.
- `rows = visibleNodes(tree.roots, S.closed, scope)`; 보기 모드 + `personal.canAdd` 이면 `withPersonalAddRows` 로 `padd` 줄 → `AddRow`(피치 톤, "＋ 내 목표 추가", `data-add-personal={round.id}`) / 열리면 `QuickAdd`(placeholder·aria 스펙 §6, `onAdd = t => api.createPersonal(round.id, t)`). 한 번에 하나(`S.quickAdd` 를 공유하되 값에 접두 `p:` — 편집 모드 빠른 추가와 충돌 없게).
- 회차에 한도(20) 도달 시 `padd` 대신 안내 줄(treeitem 아님 — 트리 밖 규칙 주의: tree 안에는 treeitem 만. 안내는 `padd` treeitem 의 비활성 내용으로 그린다).
- `mineOnly` 에서 회차 아래 보이는 자식이 0 이면 회차 행 다음에 treeitem "이 회차에 내 항목이 없어요"(비활성).
- `TreeRow` 개인 행: `TypeBadge "개인"`, 아바타 묶음·`sub/asg`·"담당자 미정" 대신 소유자(`ownerId === meId` → "나" 칩, 아니면 아바타 20px+이름) + 상태 라벨(`CODE_LABEL` 의 개인 완료 문구 변형: D "기한내 완료", L "늦게 완료"). 편집 모드에서는 애초에 안 그려진다.
- 편집 모드 안내 문구 끝에 " · 개인 목표는 보기 모드에서 관리해요".
- 회차 삭제 확인(`removePlan` 문구) — 개인 자식 수 n>0 이면 꼬리 " 팀원 개인 목표 {n}개도 함께 삭제돼요." (`model.ts` `removePlan` 에 `personalDescendants` 반영, model.test.ts 에 케이스 추가).

- [ ] **Step 1:** 실패하는 테스트(TreeRow.dom.test.ts 개인 행 3개 단언, state.test.ts INITIAL, model.test.ts removePlan 꼬리).
- [ ] **Step 2:** Run: `npx vitest run src/components/my-study` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npm run lint && npx tsc --noEmit && npx vitest run` → PASS.
- [ ] **Step 5:** 브라우저 확인(ego-browser, 3700): 철수(편집 권한 없음) 계정으로 aws 진행목표 → 3주차 "＋ 내 목표 추가" 로 2개 연속 추가 → 팀 진척률 숫자 불변 → "내 것만"/"팀원 목표" 토글 → 편집 모드 전환 시 개인 행 사라짐(민수 계정). 390/1440 스크린샷. 서버는 끝나면 종료.
- [ ] **Step 6: 커밋** — `feat(my-study): 진행목표 개인 목표 행·내 것만/팀원 목표 칩·내 목표 빠른 추가`

---

### Task 9: 개인 목표 상세·편집 폼·회차 상세 섹션 (judgment · opus)

**Files:**
- Create: `src/components/my-study/tabs/PersonalForm.tsx`
- Create: `src/components/my-study/tabs/PersonalSection.tsx` (회차 상세의 "내 개인 목표"·"팀원 개인 목표" 섹션)
- Create: `src/components/my-study/personal.ts` (순수: `personalActions(n, meId, isLeader, roomStatus): { edit; complete; archive; remove; note? }`, `completeLabel(code)`), Test: `src/components/my-study/personal.test.ts`
- Modify: `src/components/my-study/tabs/DetailView.tsx` (개인 리프 분기: 머리 버튼·소유자 표시·경고·PersonalForm 전환·⋯ 메뉴 / 회차일 때 PersonalSection)

동작(스펙 §4.5·§4.6):
- `personalActions`: 소유자(자격 = `curriculum.personal.canAdd` 와 같은 조건 + 방 상태) → edit·archive·remove, 방 ACTIVE 면 complete. 그룹장(남의 것) → archive, remove(제출 없을 때만 — `subAll === 0`), note "팀원이 만든 목표예요 · 그룹장은 보관·삭제만 할 수 있어요". 그 외 → 전부 false.
- 완료 버튼: "완료로 표시"/"완료 취소" (`aria-pressed`), busy 동안 비활성, `SUBMISSION_HAS_CONTENT` 는 토스트(스펙 문구).
- PersonalForm: 제목(maxLength 80) · 회차 `<select>`(`roundOptions(tree.roots)`) + `moveNote` 미리보기(이동 시 기간은 `movedPeriod({s,e,subAll:0}, from, to)` 로 제안해 날짜 입력에 채움 — 사용자가 고칠 수 있음) · 시작/마감 `<input type=date>`(min/max = 방 기간) · `MarkdownEditor maxHeight="none"` · [취소][저장]. 저장 = `api.updatePersonal(id, patch)` 1회. 미저장 이탈은 `InlineConfirm`(스펙 §4.6). 경고 `PERIOD_OUTSIDE_PARENT` → 폼 위 경고 줄.
- 제출 카드(병행 기능)는 개인 리프에서도 그대로 렌더(`LeafBody`) — 이 Task 는 그 위 머리 영역만 바꾼다. 내용 없는 완료 제출일 때 카드 표기는 제출 기능 쪽 요청 사항(스펙 §9 마지막 줄) — 여기서 구현하지 않는다.
- PersonalSection(회차 상세, 팀 `ChildList` 아래): "내 개인 목표 {n}개 · {d}개 완료" + 줄마다 44px 체크 버튼 + 제목·기간·상태(줄 본문 = 그 상세 `onOpen`) + 끝 "＋ 내 목표 추가"(canAdd 일 때, `QuickAdd`). "팀원 개인 목표 {n}개" = 접힌 버튼(`aria-expanded`), 펼치면 멤버별 줄 "{이름} ({n}) · {d}개 완료" → 다시 펼치면 그 사람 목표들(읽기 전용). 보관된 남의 것은 그룹장에게만.

- [ ] **Step 1: 실패하는 테스트** — `personal.test.ts`: 소유자/그룹장/다른 멤버/방 RECRUIT(완료 없음)/ENDED(전부 없음)/그룹장+제출 있음(remove false) 6케이스, `completeLabel("D") === "기한내 완료"`, `completeLabel("L") === "늦게 완료"`.
- [ ] **Step 2:** `npx vitest run src/components/my-study/personal.test.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 게이트 PASS.
- [ ] **Step 5:** 브라우저: 철수로 개인 목표 상세 → 완료/취소 → 편집에서 4주차로 이동(미리보기·결과 일치) → 민수로 같은 목표 상세(보관만 보임) → 지은으로(버튼 없음). 390/1440.
- [ ] **Step 6: 커밋** — `feat(my-study): 개인 목표 상세·편집 폼·회차 상세 개인 섹션`

---

### Task 10a: 보드·캘린더 (mechanical · sonnet)

**Files:**
- Modify: `src/components/my-study/tabs/BoardTab.tsx`, `tabs/CalendarTab.tsx`
- Test: `src/components/my-study/model.test.ts` (`boardSource(tree, mine, meId)`, `calendarSource(tree, who, meId)` 순수 함수를 model.ts 에 추가해 테스트)

규칙: `boardSource` = mine ? `[...tree.leaves.filter(mine), ...tree.personal.filter(owner === me)]` : `tree.leaves`. `calendarSource(who)`: "all" → leaves + 내 personal / "me" → 내 배정 leaves + 내 personal / userId X → X 배정 leaves + X 의 personal. 카드·막대에 [개인] 배지, 캘린더 개인 막대 = `border-dashed` + peach 톤. `noMine` 판정에 개인 포함.

- [ ] Step 1 테스트 작성 → Step 2 FAIL 확인 → Step 3 구현 → Step 4 게이트 → Step 5 커밋 `feat(my-study): 보드·캘린더에 개인 목표`

### Task 10b: 간트·개요 (judgment · opus)

**Files:**
- Modify: `src/components/my-study/tabs/GanttTab.tsx` (진행목표와 같은 두 칩 — 같은 state, `visibleNodes(…, scope)` 사용, 개인 막대 점선, 회차 막대·pct 는 팀만)
- Modify: `src/components/my-study/tabs/OverviewTab.tsx` (참가자 내 카드 줄 "개인 목표 이번 회차 {d}/{t} 완료 · 내 과제에서 보기 →" `routes.tasks({ study: slug })`; 그룹장 멤버 표 "개인 목표" 열 = `personalStats(tree.personal, userId, currentRoundId)`, 표 아래 "팀원 개인 목표 보기 →" = `update({ tab: "curriculum", curMode: "view", othersPersonal: true })`)
- Modify: `src/components/my-study/tabs/MemberAdminCard.tsx` (열이 거기 있으면)

- [ ] Step 1: model.test.ts 에 `personalStats(…, roundId)` 회차 필터 케이스 → Step 2 FAIL → Step 3 구현 → Step 4 게이트 → Step 5 브라우저(민수: 개요 열 → 링크 → 진행목표 팀원 목표 켜짐, 간트 점선 막대 390/1440) → Step 6 커밋 `feat(my-study): 간트·개요에 개인 목표`

---

### Task 11: 내 과제 순수 로직 `tasks/calc.ts` (mechanical · sonnet)

**Files:**
- Create: `src/components/tasks/calc.ts`, Test: `src/components/tasks/calc.test.ts`

**Interfaces (Produces):**
```ts
export type TasksFilter = { scope: "current" | "all"; group: "round" | "due"; type: "all" | "team" | "personal"; hideDone: boolean; study: string | "all" };
export const DEFAULT_FILTER: TasksFilter;                       // current / round / all / false / all
export function parseFilter(sp: URLSearchParams): TasksFilter;  // 모르는 값은 기본값
export function filterQuery(f: TasksFilter): Record<string, string>;   // 기본값과 같은 키는 뺀다 (routes.tasks 인자)
export const isDone = (st: TaskStatus) => st === "done" || st === "late";
export function applyFilter(m: MeTasks, f: TasksFilter): MeTaskItem[];
   // scope current = item.roundId === study.currentRoundId ∧ study.status ∈ {recruit, active}
export type RoundGroup = { study: MeTaskStudy; round: MeTaskRound | null; items: MeTaskItem[]; done: number; canAdd: boolean };
export function groupByRound(m: MeTasks, items: MeTaskItem[], f: TasksFilter): RoundGroup[];
   // 스터디 id 순 → 회차 순. scope current 면 아이템 없는 현재 회차도 빈 그룹으로(추가 줄 자리). 정렬: 미완료 먼저 → endDate → 팀 먼저 → 제목(ko)
   // canAdd = round.canAdd ∧ study.canAddPersonal ∧ 그 회차 내 개인 목표 수 < personalPerRound
export type DueSection = "overdue" | "today" | "week" | "next" | "later" | "done";
export function groupByDue(items: MeTaskItem[], today: string): { key: DueSection; label: string; items: MeTaskItem[] }[];
   // 이번 주 = 오늘~이번 주 토요일, 다음 주 = 그다음 일~토 (일~토 주, 내 일정 calc 와 같은 주 경계)
export function summary(m: MeTasks, items: MeTaskItem[]): { left: number; dueToday: number; personalDone: number; personalTotal: number };
export const statusText = (it: MeTaskItem) => string;           // 개인 done/late → "기한내 완료"/"늦게 완료", 그 외 CODE_LABEL
```

- [ ] **Step 1: 실패하는 테스트** — 픽스처 `MeTasks`(두 방, 방 A 현재 회차 2개 팀 + 2개 개인(1 완료), 방 B 종료 상태 1개)로: `parseFilter` 왕복, `applyFilter` scope current 가 종료 방을 빼고 all 이 넣음, hideDone, type, study; `groupByRound` 순서·빈 현재 회차 그룹·canAdd(한도 20 도달 픽스처); `groupByDue` 경계(오늘 = 금요일 2026-10-16 → 토 10-17 은 week, 10-18(일)~10-24 는 next, 지난 마감 미완료 = overdue, 완료 = done); `summary`.
- [ ] Step 2 FAIL → Step 3 구현 → Step 4 `npx vitest run src/components/tasks` PASS + 게이트 → Step 5 커밋 `feat(tasks): 내 과제 필터·묶기 순수 로직`

---

### Task 12: `/tasks` 화면 + 헤더 메뉴 (judgment · opus)

**Files:**
- Read first: `node_modules/next/dist/docs/` 의 App Router page·loading·metadata·searchParams 가이드(16.4 변경점)
- Create: `src/app/tasks/page.tsx`, `src/app/tasks/loading.tsx` (`src/app/schedule/page.tsx`·`loading.tsx` 패턴: `requireMe(routes.tasks())` 가드 + `fetchMyTasks(client)` 병렬, `metadata.title = "슥터디 내 과제"`)
- Create: `src/components/tasks/TasksScreen.tsx`, `TasksToolbar.tsx`, `TaskRow.tsx`, `RoundGroupCard.tsx`, `AddPersonalForm.tsx`, `TasksEmpty.tsx`
- Modify: `src/components/ui/AppHeader.tsx` (`NavKey += "tasks"`, NAV 3번째 "내 과제" 체크리스트 아이콘, `authOnly: true`)
- Modify: `src/components/ui/Skeleton.tsx` (`TasksSkeleton` — 기존 스켈레톤 모양 재사용)
- Test: `src/app/auth-pages.test.ts` 류에 `/tasks` 가 로그인 가드 대상인지 확인하는 테스트가 있으면 추가

동작(스펙 §4.1·§4.2):
- 상태: `data: MeTasks`(서버 초기값) · 필터는 `useSearchParams` → `parseFilter`, 바꾸면 `router.replace(routes.tasks(filterQuery(f)), { scroll: false })`.
- 변경 후 재조회: 완료 토글·추가는 `personalComplete`/`personalCreate` 성공 뒤 `fetchMyTasks()` 로 교체(busy 표시, 실패 토스트 `toApiError(e).message`). 낙관적 처리 없음.
- `TaskRow`: 왼쪽 44px — 개인이면 체크 버튼(`aria-pressed`, 방 ACTIVE 아닐 때 비활성 + title "스터디가 진행 중일 때 완료할 수 있어요"), 팀이면 `StatusIcon`(장식). 본문 = `<Link href={routes.task(slug, id)}>` — [유형 배지] 제목(줄바꿈) / 묶음 제목(있으면) · 기간 · D-day(`dday`) · 상태(`statusText`). 마감일 묶기에선 스터디 톤 점 + 회차 라벨 칩.
- `RoundGroupCard`: 머리(스터디 톤 점·회차 라벨 배지·제목·기간·`roundStatus`·"x/y 완료"), "전체" 범위의 지난 회차는 접힌 상태로 시작(머리 버튼 `aria-expanded` 44px). 끝 줄 = canAdd ? "＋ 내 목표 추가"(→ `QuickAdd` 재사용, `onAdd = personalCreate(slug, round.id, t)`) : 한도면 안내 줄.
- `AddPersonalForm`(머리 버튼): 스터디 select(추가 가능한 방만, 1개면 숨김) · 회차 select(그 방 `canAdd` 회차, 기본 = currentRoundId) · 제목 · [추가] [닫기]. 성공 토스트 "내 목표를 추가했어요".
- 빈 상태 3종(스펙 §6). 한 페이지 스크롤, `main` 은 내 일정과 같은 카드(`rounded-[20px] bg-surface`), 최대 폭 1080 가운데.
- 헤더: 390 에서 nav 4개가 한 줄 가로 스크롤 안에 들어가는지 확인(가로 페이지 스크롤 없음).

- [ ] **Step 1:** Next 문서 확인(읽은 파일 경로를 커밋 메시지 본문에 남긴다).
- [ ] **Step 2:** 화면 구현. 순수 로직은 Task 11 만 사용(새 판단 로직을 컴포넌트에 넣지 않는다).
- [ ] **Step 3:** 게이트 `npm run lint && npx tsc --noEmit && npx vitest run`.
- [ ] **Step 4:** 브라우저(ego-browser, 3700): 지은(aws·spring) 로그인 → 헤더 "내 과제" → 이번 회차 묶음·완료 체크/취소·회차 끝 빠른 추가·머리 폼 추가·필터 5종(URL 반영, 뒤로 가기 복원)·행 클릭 → 상세 제출 영역 포커스. 390/820/1440 스크린샷, 가로 스크롤 없음 확인(`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Step 5: 커밋** — `feat(tasks): 내 과제 페이지 /tasks + 헤더 메뉴`

---

### Task 13: 내 일정 [개인] 표시 (mechanical · sonnet)

**Files:**
- Modify: `src/lib/api/schedule.ts` (`toTask` 에 `personal: !!t.personal`), `src/data/schedule.ts` (`Task.personal?: boolean`)
- Modify: `src/components/schedule/DayPanel.tsx`, `ListView.tsx`, `UpcomingPanel.tsx`(제목 앞 [개인] 배지), `MonthGrid.tsx`(개인 막대 `border-dashed`), `Legend.tsx`("개인 목표" 항목)
- Test: `src/lib/api/schedule.test.ts` (`toScheduleData` 가 personal 을 옮기는지)

- [ ] Step 1 테스트 → Step 2 FAIL → Step 3 구현 → Step 4 게이트 → Step 5 커밋 `feat(schedule): 내 일정에 개인 목표 표시`

(주의: `src/lib/api/schedule.ts`·`src/components/schedule/DayPanel.tsx` 는 플랜 작성 시점에 다른 작업이 수정 중이었다 — 최신 커밋 위에서 작업.)

---

### Task 14: 통합 확인 + 보고 (judgment · opus)

**Files:** 없음(확인만, 필요 시 작은 수정은 해당 Task 파일로)

- [ ] **Step 1:** `npm run test:db` + `npm run lint && npx tsc --noEmit && npx vitest run` 전부 통과.
- [ ] **Step 2:** 스펙 §2 시나리오 S1~S14 를 브라우저로 한 번씩(S10 종료 방·S11 비로그인은 시드 방 상태를 로컬에서만 바꿔 확인 후 되돌림). 스펙 §10 수용 기준 1~11 체크 표를 보고서에 남긴다.
- [ ] **Step 3:** 390/820/1440 × (내 과제, 진행목표 보기, 개인 상세, 회차 상세, 간트, 내 일정) 스크린샷, 가로 스크롤·44px 위반 없음.
- [ ] **Step 4:** 보고: 커밋 목록, 호스티드 적용 안내(사용자가 승인 후 `supabase db push` — 0013 → 0014 순서, 0015 와 독립), 남은 요청(스펙 §9: 제출 카드의 "내용 없는 제출" 표기).

## 실행 순서·모델

| 순서 | Task | 모델 | 의존 |
|---|---|---|---|
| 1 | 0 선행 확인 | sonnet | — |
| 2 | 1 스키마·가드·RLS | opus | 0 |
| 3 | 2 쓰기 RPC | opus | 1 |
| 4 | 3 읽기 경로 | opus | 2 |
| 5 | 4 me_tasks·일정 | opus | 3 |
| 6 | 5 DB 회귀 | sonnet | 4 |
| 7 | 6 타입·API | sonnet | 5 (+ 제출 프론트 커밋) |
| 8 | 7 트리 모델 | opus | 6 |
| 9 | 8 진행목표 목록 | opus | 7 |
| 10 | 9 상세·폼·회차 섹션 | opus | 8 |
| 11 | 10a 보드·캘린더 | sonnet | 7 (8·9 와 병렬 가능) |
| 12 | 10b 간트·개요 | opus | 8 |
| 13 | 11 tasks calc | sonnet | 6 (7~10 과 병렬 가능) |
| 14 | 12 /tasks 화면 | opus | 11 |
| 15 | 13 내 일정 | sonnet | 6 |
| 16 | 14 통합 | opus | 전부 |
