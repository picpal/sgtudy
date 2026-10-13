# 슥터디 백엔드 Implementation Plan — 03 커리큘럼 · 진척률 · 내 스터디/일정 (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목표 트리(회차·중간 노드·리프 과제)의 생성/수정/이동/삭제/보관을 불변식 I1~I6 과 함께 Postgres 함수로 구현하고, 트리 롤업(`room_progress`)·커리큘럼 JSON(`curriculum_get`)·내 스터디(`me_studies`)·내 일정(`me_schedule`)을 제공하며, 목업 `src/data/my-study.ts` 의 PLANS 트리와 제출 코드를 시드로 재현해 "aws 24% · spring 34% · algo 87% · sqld null" 을 회귀값으로 고정한다.

**Architecture:** 구조 변경(생성·삭제·보관·이동)은 즉시 RPC 1회, 내용 변경(제목·설명·기간·라벨·타입·담당자)은 `node_update(p_patch)` 1회(D9). 모든 노드 쓰기 함수는 `node_assert_editable(p_slug)` 로 방 행을 `FOR UPDATE` 잠그고(그룹장·편집 가능 상태 검사) 끝에서 반드시 `assignment_resync(room_id)` 를 호출한다(I8). 집계는 `room_progress(p_room)` 하나가 `WITH RECURSIVE` 로 리프 asg/sub 를 조상에 합산하고(보관 제외), 플랜 02 의 `room_leaf_stats` 는 `CREATE OR REPLACE` 로 `room_progress` 에 위임시켜 방 상세·커리큘럼·내 스터디가 같은 숫자를 보게 한다. 알림은 플랜 02 의 `notify_publish` 자리표(항상 0)를 호출만 해 두고 0008(플랜 04)이 실체화한다. 태그 자동 선택은 `to_regproc('public.tag_autoselect')` 가 있을 때만 호출한다(0009, 플랜 04).

**Tech Stack:** Postgres 15 plpgsql(Supabase), PGlite 0.3 + Deno 테스트(플랜 01 하네스 `_harness.ts`), 로컬 Supabase 는 Phase 종료 게이트의 `db reset` 확인에만.

**Spec:** `docs/backend/01-decisions.md`(D4·D5·D9), `docs/backend/02-domain-and-schema.md`(§2 goal_nodes/task_assignments/submissions, §3 I1~I6, §4.1~4.2·4.4, §6, §8), `docs/backend/03-api.md`(§0 에러, §4 Curriculum/NodeDto, §6 me_studies/me_schedule), `docs/backend/analysis/mystudy.md`(전체), `docs/backend/analysis/schedule.md`(§3·§5). 프론트 거울: `src/components/my-study/model.ts`(buildTree·leafState·memberStats), `src/data/my-study.ts`(PLANS — 시드가 그대로 재현), `src/data/schedule.ts`, `src/data/room-view.ts`(toeic/cs/docker/jcg/react 회차). 공통 계약·전역 제약은 `2026-10-13-backend-00-overview.md`.

## Global Constraints

(00 개요 "Global Constraints" 전부 + 아래)

- 파일: `supabase/migrations/0006_curriculum.sql`(신규, 이 플랜의 태스크가 같은 파일 끝에 이어 붙인다 — 배포 전까지만), `supabase/seed.sql`(§3 커리큘럼 섹션 **추가** — §1·§2 는 플랜 01·02 소유), `supabase/tests/_curriculum-helpers.ts`, `supabase/tests/curriculum-sql.test.ts`, `supabase/tests/progress-sql.test.ts`, `supabase/tests/me-studies-sql.test.ts`, `supabase/tests/me-schedule-sql.test.ts`, 그리고 **플랜 02 의 `supabase/tests/_cases-rooms.ts`**(시드 §3 이 깨뜨리는 사례 3개를 이 플랜 Task 2 Step 5 가 소유해 다시 쓴다 — 리뷰 B1). 그 외 파일은 건드리지 않는다.
- 모든 쓰기 함수 `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, 읽기 전용 헬퍼는 `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`. 테이블 `public.` 한정, 인자 `p_` 접두, JSON 키 camelCase, 숫자 id 는 `::text`, 날짜 `to_char(d,'YYYY-MM-DD')`, 시각 `public.iso()`.
- 에러는 `public.fail(code, detail, hint)` 만. 이 플랜이 쓰는 코드: `AUTH_REQUIRED, ONBOARDING_REQUIRED, VALIDATION_FAILED, INVALID_PERIOD, INVALID_TITLE, NOT_LEADER, ROOM_NOT_FOUND, NODE_NOT_FOUND, ROOM_NOT_EDITABLE, NODE_HAS_SUBMISSIONS, NODE_DEPTH_EXCEEDED, NODE_NOT_LEAF, PARENT_ARCHIVED, ROOT_CANNOT_OUTDENT, ASSIGNEE_NOT_MEMBER, ASSIGNEE_HAS_SUBMISSION, SCHEDULE_RANGE_INVALID`(전부 03-api §0 목록).
- 경고(warnings) code: `PERIOD_OUTSIDE_PARENT`, `PERIOD_OUTSIDE_ROOM`, `UNASSIGNED_TASK`. 형식 `{code, nodeId}`.
- `goal_nodes.task_type`·`task_assignments.source` 는 대문자(`COMMON|DESIGNATED`), JSON 으로 나갈 때만 `lower()`. RPC 입력 `taskType` 은 소문자 `common|designated` 를 받아 `upper()`.
- "오늘"은 `public.kst_today()` 만. 테스트 기준일 `2026-10-12`(`setToday(q, "2026-10-12")`).
- **함수 권한(D7, GRANT-only)**: 0002 의 default privileges 로 새 함수는 기본 비공개. `03-api.md` RPC 열의 공개 함수만 GRANT 한다 — `curriculum_get` → `anon, authenticated`(공개), `node_create`·`node_update`·`node_move`·`node_delete`·`node_archive`·`node_unarchive`·`me_studies`·`me_schedule` → `authenticated`. 내부 함수(`node_subtree`, `node_has_submissions`, `node_assert_editable`, `node_get`, `room_progress`, `curriculum_json`, `me_schedule_leaves`, `goal_nodes_guard`)와 03-api 에 없는 래퍼 `node_indent`·`node_outdent` 는 GRANT 하지 않는다. `revoke … from anon, authenticated` 는 쓰지 않는다(PUBLIC 기본 권한을 못 지운다 — 리뷰 D1). Task 8 에 `has_function_privilege('anon', …) = false` 단언(`curriculum_json`, `me_schedule_leaves` 포함).
- **`goal_nodes` 형태 트리거**(02 §6, Task 1): 루트 = depth 2·round_id 자기 자신·label 필수, 하위 = label 없음·depth = 부모+1·round_id = 부모 round_id. 직접 INSERT(시드·테스트·service_role)도 막힌다.
- **depth-2 리프 허용(A7)**: 회차가 곧 과제인 depth-2 리프(task_type 있음)를 허용한다 — `node_create(parent=null, taskType=…)` 로 만들 수 있고, `node_move` 로 리프를 회차로 올리면 `task_type` 을 유지하고 label 은 `{n}주차` 로 채운다. 회차 label 은 null 로 지울 수 없다(`node_update` → `VALIDATION_FAILED`).
- 알림 호출은 `notify_publish` 계약(개요): 행위자 제외는 0008 이 하므로 호출부는 수신자에서 본인을 빼지 않는다. dedupe prefix(D8): 행위 이벤트(`SCHEDULE_CHANGED`·`TASK_ASSIGNED`·`TASK_UNASSIGNED`) = `KIND:room:node:` || `txid_current()`.
- 편집 가능 상태: 방 `DRAFT·RECRUIT·ACTIVE` ∧ `archived_at IS NULL`. 그 외 `ROOM_NOT_EDITABLE`. 그룹장 아니면 `public.require_leader(r, uid)` — 방을 읽을 수 없는 외부인은 `ROOM_NOT_FOUND`(존재 은닉, plan 02 최종 리뷰 I-2), 읽을 수 있으면 `NOT_LEADER`. bare `NOT_LEADER` 직접 raise 금지.
- 노드 쓰기 함수는 전부 편집용 `Curriculum` JSON(보관 노드 포함)을 돌려준다. `curriculum_get(p_slug, p_include_archived default false)` 만 보관 제외가 기본.
- 커밋 메시지 끝 두 줄 트레일러:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx
  ```

## 플랜 01·02 에서 가져오는 것 (Consumes — 전 태스크 공통)

```sql
-- 0002_functions_core.sql (플랜 01)
public.current_user_id() returns uuid
public.require_user() returns uuid                 -- AUTH_REQUIRED / ONBOARDING_REQUIRED
public.kst_today() returns date
public.kst_deadline(p_end date) returns timestamptz
public.fail(p_code text, p_detail text, p_hint jsonb default null) returns void
public.iso(p_ts timestamptz) returns text
public.task_code(p_s date, p_e date, p_first timestamptz, p_late boolean, p_today date) returns text   -- planned|open|done|late|missed
public.leaf_state(p_asg int, p_sub int, p_s date, p_e date, p_today date) returns text                -- unassigned|complete|planned|delayed|progress
public.pct(p_asg int, p_sub int) returns int        -- asg=0 → null, half-up
public.person_json(p_user uuid) returns jsonb       -- {userId, nickname, tone}
-- 0004_rooms.sql (플랜 02)
public.notify_publish(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb) returns int  -- 자리표(0)
public.room_lock(p_slug text) returns public.rooms   -- FOR UPDATE, 없으면 ROOM_NOT_FOUND
public.room_readable(p_room bigint, p_uid uuid, p_token text default null) returns boolean
public.room_leaf_stats(p_room bigint) returns table(node_id, round_id, parent_id, title, task_type, start_date, end_date, sort_order, asg int, sub int)  -- Task 1 이 CREATE OR REPLACE
public.room_create(p_title, p_intro, p_start_date, p_end_date, p_max_members, p_is_public, p_join_mode, …) returns jsonb
public.patch_date(p_patch jsonb, p_key text) returns date   -- 형식 오류 VALIDATION_FAILED (D11) — node_update 가 쓴다
public.room_release_seat(p_room bigint) returns void
-- 0005_membership.sql (플랜 02)
public.assignment_resync(p_room bigint) returns void  -- D4, 멱등. 보관 리프는 COMMON·DESIGNATED 모두 released_at = archived_at (D13)
```

```ts
// supabase/tests/_harness.ts (플랜 01 Task 2 — 이름 그대로)
export type Q = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export async function migrationFiles(): Promise<string[]>;
export async function openDb(): Promise<PGlite>;                 // 스텁 + supabase/migrations/*.sql 전부(번호순)
export async function applySeed(db: PGlite): Promise<void>;      // supabase/seed.sql
export function makeQ(db: PGlite): Q;
export function withCase(db: PGlite, fn: (q: Q) => Promise<void>): () => Promise<void>;   // begin … rollback, 문장마다 savepoint
export async function newUser(q: Q, email?: string): Promise<string>;
export const asUser: (q: Q, uid: string) => Promise<void>;
export const asAnon: (q: Q) => Promise<void>;
export const setToday: (q: Q, ymd: string) => Promise<void>;
export async function expectFail(p: Promise<unknown>, code: string): Promise<void>;
export function sqlTest(name: string, fn: () => Promise<void>): void;
```

시드 고정값(플랜 01·02): 사용자 UUID `00000000-0000-4000-8000-0000000000NN`(NN 은 플랜 01 Task 8 의 `seed_users.n`), 방 id = toeic 1, cs 2, sqld 3, docker 4, jcg 5, aws 6, react 7, algo 8, spring 9. 멤버십(플랜 02 §2 시드 — 전 방 `leader_does_tasks=true` 로 넣는다): aws 민수 LEADER·지은·철수·하나 ACTIVE·도윤 INACTIVE / spring 지훈 LEADER·철수·소율·민재·아린 / sqld 가은 LEADER(이 플랜 시드 §3 이 `leader_does_tasks=false` 로 바꾼다)·철수 PENDING / algo 현우 LEADER·철수·보람·지성·다은·유진 / toeic 서연·도현 / cs 예린·승호·나연 / docker 철수 LEADER / jcg 수민·태윤·하은·준서 / react 태호·은지·시우·다인·현준. 테스트는 번호를 믿지 않고 `uid(q, '민수')`·`roomId(q, 'aws')` 로 런타임 조회한다(`_curriculum-helpers.ts`).

## 이 플랜이 내놓는 것 (Produces — 플랜 04·05 가 의존)

```sql
-- 0006_curriculum.sql
public.node_subtree(p_node bigint) returns setof bigint               -- 자기 포함 서브트리 id (플랜 04 member_deactivate·task_get 재사용)
public.node_has_submissions(p_node bigint) returns boolean            -- 서브트리 어느 리프에든 제출물
public.node_assert_editable(p_slug text) returns public.rooms         -- room_lock + require_leader + ROOM_NOT_EDITABLE
public.node_get(p_room bigint, p_node bigint) returns public.goal_nodes   -- 방 소속 검사, 없으면 NODE_NOT_FOUND
public.goal_nodes_guard() returns trigger + trigger trg_goal_nodes_guard  -- depth·round_id·label 형태 검사(A1)
public.room_progress(p_room bigint) returns table(node_id bigint, asg int, sub int, pct int)   -- 전 노드 롤업(보관 제외), 플랜 04 task_get·job_* 재사용
public.room_leaf_stats(p_room bigint)  -- 시그니처 동일, 본문만 room_progress 위임으로 교체 (CREATE OR REPLACE).
                                       -- 계층: room_progress → room_leaf_stats → (플랜 02, 교체 안 함) room_round_stats·room_detail_json·rooms_list
public.curriculum_json(p_room bigint, p_uid uuid, p_include_archived boolean) returns jsonb
public.curriculum_get(p_slug text, p_include_archived boolean default false) returns jsonb
public.node_create(p_slug text, p_parent_id bigint default null, p_title text default null, p_label text default null,
                   p_task_type text default null, p_start_date date default null, p_end_date date default null, p_index int default null) returns jsonb
public.node_update(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb   -- Curriculum + warnings
public.node_move(p_slug text, p_node_id bigint, p_parent_id bigint, p_index int) returns jsonb
public.node_indent(p_slug text, p_node_id bigint) / node_outdent(p_slug text, p_node_id bigint) returns jsonb   -- E12·E13 래퍼
public.node_delete(p_slug text, p_node_id bigint) returns jsonb
public.node_archive(p_slug text, p_node_id bigint) / node_unarchive(p_slug text, p_node_id bigint) returns jsonb
public.me_studies() returns jsonb
public.me_schedule(p_from date, p_to date) returns jsonb
```

플랜 05 어댑터 가정 시그니처(`…-05-frontend-integration.md` 표)와 일치한다. 시드(§3) 가 만드는 숫자: aws 6/25=24%(회차 5/8·1/3·0/4·0/4·0/6), spring 12/35=34%, algo 68/78=87%, sqld 0/0=null, react 4주차 3/10, 참가자 aws 민수 2/5·지은 2/7·철수 2/6·하나 0/7. **철수 aws 진척은 방 목록 슬롯·참가자 통계 모두 2/6=33%**(D5 — 목업의 2/4=50%·참가자 2/3·2/4·2/4·0/4 는 1~3주차만 센 값이라 폐기). 철수 aws 다음 마감 EC2 10/14(OPEN 만, D14).

## Review Focus

스펙이 암시하지만 자연히 테스트되지 않을 입력 5가지. 각각 소유 태스크에 테스트를 박았다.

1. **제출물 있는 리프 구조 변경 4종**(00 개요 Review Focus 4) — 하위 추가 / 지정→공통 / 삭제 / 담당자 제거 전부 거부, 보관은 허용되고 집계에서 빠진다. → Task 4(create·delete·archive), Task 5(update).
2. **이동으로 깊이 초과** — depth 3 노드가 자식 2단(depth 5)을 달고 depth 4 아래로 들어가면 서브트리 최대 깊이 7 → `NODE_DEPTH_EXCEEDED`. 자기 자신·자기 후손 아래로 이동은 `VALIDATION_FAILED`. → Task 6.
3. **보관된 리프의 담당 해제·복구** — 보관하면 COMMON 행이 released 되고 해제하면 복구된다(제출물·`is_late` 그대로). 보관 리프는 `me_schedule`·`me_studies.when` 에서 사라진다. → Task 2(resync), Task 8.
4. **그룹장 `leader_does_tasks=false`** — 공통 리프 담당자에서 빠져 `asg` 가 멤버 수−1, `curriculum_get.members[].doesTasks=false`, `me_schedule` 에서는 보이되 `st=null` 이고 upcoming 제외. → Task 2, Task 3, Task 8.
5. **대기자(PENDING) 미리보기** — 배정이 없어도 그 방의 모든 리프가 `st=planned` 로 일정에 나오고, 마커도 나온다. 승인 전에는 `curriculum_get.people` 은 보인다(멤버 범주). → Task 3, Task 8.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0006_curriculum.sql` | `goal_nodes` 형태 트리거, 헬퍼 4개, `room_progress`, `room_leaf_stats` 본문 교체, `curriculum_json`/`curriculum_get`, `node_*` 9개, `me_studies`, `me_schedule`, 공개 RPC GRANT |
| `supabase/seed.sql` | (추가) §3 커리큘럼: aws/spring/sqld/algo = PLANS 원본, toeic/cs/docker/jcg/react = room-view 회차, 제출물, `assignment_resync` |
| `supabase/tests/_curriculum-helpers.ts` | `uid`, `roomId`, `mkRoom`, `mkRound`, `mkLeaf`, `submit`, `progress`, `nodeByTitle` |
| `supabase/tests/progress-sql.test.ts` | 트리거 + `room_progress` 단위 + 시드 회귀(24/34/87/null, 회차, 참가자) + resync 규칙 + RF3(제출자 이탈·INACTIVE 재신청) |
| `supabase/tests/_cases-rooms.ts` (플랜 02 파일) | Task 2 Step 5: 시드 §3 이 깨뜨리는 사례 3개를 전체 시드 값으로 교체, `seedAwsTree` 삭제 |
| `supabase/tests/curriculum-sql.test.ts` | `curriculum_get` DTO + `node_*` 불변식 매트릭스 |
| `supabase/tests/me-studies-sql.test.ts` | `me_studies` 그룹·when |
| `supabase/tests/me-schedule-sql.test.ts` | `me_schedule` 창·st·마커·upcoming·범위 오류 |

태스크 순서: 1(헬퍼·`room_progress`) → 2(시드 §3·회귀) → 3(`curriculum_get`) → 4(`node_create`·`node_delete`·보관) → 5(`node_update`) → 6(`node_move`·indent/outdent) → 7(`me_studies`) → 8(`me_schedule`).

---

### Task 1: 0006 골격 — 트리 헬퍼 · `room_progress` · `room_leaf_stats` 위임

**Files:**
- Create: `supabase/migrations/0006_curriculum.sql`
- Create: `supabase/tests/_curriculum-helpers.ts`, `supabase/tests/progress-sql.test.ts`

**Interfaces:**
- Consumes: `room_lock`, `require_user`, `fail`, `pct`, `assignment_resync`, `room_create`(테스트의 `mkRoom`).
- Produces: `goal_nodes_guard()` + `trg_goal_nodes_guard`(A1), `node_subtree`, `node_has_submissions`, `node_assert_editable`, `node_get`, `room_progress`, 본문 교체된 `room_leaf_stats`. 테스트 헬퍼 `_curriculum-helpers.ts`. 이 Task 의 함수는 전부 내부용 — GRANT 없음.

- [ ] **Step 1: 테스트 헬퍼 `supabase/tests/_curriculum-helpers.ts`**

```ts
import type { Q } from "./_harness.ts";
import { asUser, setToday } from "./_harness.ts";

export const TODAY = "2026-10-12";

/** 시드 사용자 id 를 닉네임으로 찾는다(번호 규칙에 의존하지 않는다) */
export async function uid(q: Q, nickname: string): Promise<string> {
  const r = await q("select id::text as id from public.profiles where nickname = $1", [nickname]);
  if (r.length !== 1) throw new Error(`seed user ${nickname} not found`);
  return r[0].id as string;
}

export async function roomId(q: Q, slug: string): Promise<string> {
  const r = await q("select id::text as id from public.rooms where slug = $1", [slug]);
  if (r.length !== 1) throw new Error(`seed room ${slug} not found`);
  return r[0].id as string;
}

/** 시드와 무관한 DRAFT 방을 leader 가 만든다. 기간 2026-11-01 ~ 2026-11-28, 정원 6, 공개, direct */
export async function mkRoom(q: Q, leaderNick: string, over: Partial<{ s: string; e: string; title: string }> = {}) {
  await setToday(q, TODAY);
  const leader = await uid(q, leaderNick);
  await asUser(q, leader);
  const [row] = await q(
    `select public.room_create($1, $2, $3::date, $4::date, 6, true, 'direct') as d`,
    [over.title ?? "커리큘럼 테스트 Curriculum Test", "소개", over.s ?? "2026-11-01", over.e ?? "2026-11-28"],
  );
  const d = row.d as Record<string, unknown>;
  return { id: d.id as string, slug: d.slug as string, leader };
}

/** 회차(depth 2) 직접 INSERT — node_create 가 생기기 전(Task 1~3) 과 시드 검증용 */
export async function mkRound(q: Q, room: string, label: string, title: string, s: string, e: string): Promise<string> {
  const [{ n }] = await q("select count(*)::int as n from public.goal_nodes where room_id = $1 and parent_id is null", [room]);
  const [r] = await q(
    `insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
     values ($1, null, 2, $2, $3, $4, $5::date, $6::date) returning id::text as id`,
    [room, n, label, title, s, e],
  );
  await q("update public.goal_nodes set round_id = id where id = $1", [r.id]);
  return r.id as string;
}

/** 리프 직접 INSERT (부모 depth+1, round_id 상속). type: COMMON|DESIGNATED, null 이면 중간 노드 */
export async function mkLeaf(q: Q, parent: string, title: string, type: "COMMON" | "DESIGNATED" | null, s: string, e: string): Promise<string> {
  const [p] = await q("select room_id::text as room_id, round_id::text as round_id, depth from public.goal_nodes where id = $1", [parent]);
  const [{ n }] = await q("select count(*)::int as n from public.goal_nodes where parent_id = $1", [parent]);
  const [r] = await q(
    `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
     values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9) returning id::text as id`,
    [p.room_id, parent, p.round_id, (p.depth as number) + 1, n, title, s, e, type],
  );
  return r.id as string;
}

/** 제출물 직접 INSERT. late=false → end_date 18:00 KST, true → 다음날 09:00 KST */
export async function submit(q: Q, node: string, nick: string, late = false): Promise<void> {
  const u = await uid(q, nick);
  await q(
    `insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late)
     select $1, $2::uuid, '테스트 제출',
            case when $3 then ((n.end_date + 1)::timestamp + interval '9 hours') at time zone 'Asia/Seoul'
                 else (n.end_date::timestamp + interval '18 hours') at time zone 'Asia/Seoul' end, $3
     from public.goal_nodes n where n.id = $1`,
    [node, u, late],
  );
}

export type Prog = { asg: number; sub: number; pct: number | null };
/** room_progress 를 node_id → {asg, sub, pct} 맵으로 */
export async function progress(q: Q, room: string): Promise<Record<string, Prog>> {
  const rows = await q("select node_id::text as id, asg, sub, pct from public.room_progress($1)", [room]);
  const out: Record<string, Prog> = {};
  for (const r of rows) out[r.id as string] = { asg: r.asg as number, sub: r.sub as number, pct: (r.pct as number | null) ?? null };
  return out;
}

export async function nodeByTitle(q: Q, room: string, title: string): Promise<string> {
  const r = await q("select id::text as id from public.goal_nodes where room_id = $1 and title = $2 order by id", [room, title]);
  if (r.length !== 1) throw new Error(`node "${title}" in room ${room}: ${r.length} rows`);
  return r[0].id as string;
}

export const sortIds = (a: string[]) => [...a].sort((x, y) => Number(x) - Number(y));
```

- [ ] **Step 2: 실패하는 테스트 `supabase/tests/progress-sql.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { mkLeaf, mkRoom, mkRound, progress, submit, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

sqlTest("goal_nodes_guard: 직접 INSERT/UPDATE 도 depth=부모+1·round_id 일치·label 은 depth 2 만 (A1)", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const ins = (cols: string, vals: unknown[]) =>
    q(`insert into public.goal_nodes (${cols}) values (${vals.map((_, i) => "$" + (i + 1)).join(",")}) returning id::text as id, round_id::text as round_id`, vals);
  // 루트: round_id 를 비워 두면 자기 id 로 채운다
  const [root] = await ins("room_id, parent_id, depth, sort_order, label, title, start_date, end_date", [room.id, null, 2, 0, "1주차", "R", "2026-11-01", "2026-11-07"]);
  assertEquals(root.round_id, root.id);
  // 하위: round_id 를 비워 두면 부모의 round_id 를 물려받는다
  const [child] = await ins("room_id, parent_id, depth, sort_order, title, start_date, end_date, task_type", [room.id, root.id, 3, 0, "C", "2026-11-01", "2026-11-03", "COMMON"]);
  assertEquals(child.round_id, root.id);
  const base = "room_id, parent_id, depth, sort_order, title, start_date, end_date";
  await expectFail(ins(base, [room.id, root.id, 4, 1, "깊이 틀림", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  await expectFail(ins(base + ", round_id", [room.id, root.id, 3, 1, "회차 틀림", "2026-11-01", "2026-11-03", child.id]), "VALIDATION_FAILED");
  await expectFail(ins(base + ", label", [room.id, root.id, 3, 1, "하위 라벨", "2026-11-01", "2026-11-03", "x"]), "VALIDATION_FAILED");
  await expectFail(ins(base, [room.id, null, 3, 1, "루트 깊이 3", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  await expectFail(ins(base, [room.id, null, 2, 1, "루트 라벨 없음", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  const other = await mkRoom(q, "지훈", { title: "다른 방 Other" });
  await expectFail(ins(base, [other.id, root.id, 3, 0, "다른 방 부모", "2026-11-01", "2026-11-03"]), "VALIDATION_FAILED");
  // UPDATE 도 같은 규칙: 회차 라벨 지우기·하위에 라벨
  await expectFail(q("update public.goal_nodes set label = null where id = $1", [root.id]), "VALIDATION_FAILED");
  await expectFail(q("update public.goal_nodes set label = 'x' where id = $1", [child.id]), "VALIDATION_FAILED");
  // depth-2 리프(회차 자체가 과제)는 허용(A7)
  const [leafRoot] = await ins("room_id, parent_id, depth, sort_order, label, title, start_date, end_date, task_type",
    [room.id, null, 2, 1, "2주차", "회차 과제", "2026-11-08", "2026-11-14", "COMMON"]);
  assertEquals(leafRoot.round_id, leafRoot.id);
}));

sqlTest("node_subtree / node_has_submissions: 자기 포함 서브트리, 제출물은 어느 깊이든 감지", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  const mid = await mkLeaf(q, r1, "중간", null, "2026-11-01", "2026-11-07");
  const leaf = await mkLeaf(q, mid, "리프", "COMMON", "2026-11-01", "2026-11-03");
  const r2 = await mkRound(q, room.id, "2주차", "회차2", "2026-11-08", "2026-11-14");
  const rows = await q("select id::text as id from public.node_subtree($1) as id order by id", [r1]);
  assertEquals(rows.map((x) => x.id), [r1, mid, leaf].sort((a, b) => Number(a) - Number(b)));
  assertEquals((await q("select public.node_has_submissions($1) as b", [r1]))[0].b, false);
  await q("select public.assignment_resync($1)", [room.id]);
  await submit(q, leaf, "서연");
  assertEquals((await q("select public.node_has_submissions($1) as b", [r1]))[0].b, true);
  assertEquals((await q("select public.node_has_submissions($1) as b", [mid]))[0].b, true);
  assertEquals((await q("select public.node_has_submissions($1) as b", [r2]))[0].b, false);
}));

sqlTest("node_assert_editable: 그룹장·상태·보관 검사, node_get: 방 소속", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  assertEquals((await q("select (public.node_assert_editable($1)).id::text as id", [room.slug]))[0].id, room.id);
  await asUser(q, await uid(q, "민수"));
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "NOT_LEADER");
  await asAnon(q);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "AUTH_REQUIRED");
  await asUser(q, room.leader);
  await expectFail(q("select public.node_assert_editable($1)", ["no-such-room"]), "ROOM_NOT_FOUND");
  await q("update public.rooms set status = 'ENDED' where id = $1", [room.id]);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "ROOM_NOT_EDITABLE");
  await q("update public.rooms set status = 'ACTIVE', archived_at = now() where id = $1", [room.id]);
  await expectFail(q("select public.node_assert_editable($1)", [room.slug]), "ROOM_NOT_EDITABLE");
  // node_get: 다른 방의 노드 id 는 NODE_NOT_FOUND
  const other = await mkRoom(q, "지훈", { title: "다른 방 Other" });
  assertEquals((await q("select (public.node_get($1, $2)).id::text as id", [room.id, r1]))[0].id, r1);
  await expectFail(q("select public.node_get($1, $2)", [other.id, r1]), "NODE_NOT_FOUND");
}));

sqlTest("room_progress: 리프 asg/sub 를 조상까지 합산, 보관 서브트리 제외, pct half-up", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await mkRoom(q, "서연");
  // 서연(그룹장, leader_does_tasks=true) + 민수 + 지훈 = 담당 3명
  for (const n of ["민수", "지훈"]) {
    await q(`insert into public.room_members (room_id, user_id, role, status, joined_at) values ($1, $2::uuid, 'MEMBER', 'ACTIVE', now())`, [room.id, await uid(q, n)]);
  }
  await q("update public.rooms set member_count = 3 where id = $1", [room.id]);
  const r1 = await mkRound(q, room.id, "1주차", "회차", "2026-11-01", "2026-11-07");
  const mid = await mkLeaf(q, r1, "중간", null, "2026-11-01", "2026-11-07");
  const a = await mkLeaf(q, mid, "A", "COMMON", "2026-11-01", "2026-11-03");       // 3명
  const b = await mkLeaf(q, r1, "B", "DESIGNATED", "2026-11-04", "2026-11-07");   // 지정 1명
  const c = await mkLeaf(q, r1, "C", "COMMON", "2026-11-04", "2026-11-07");       // 3명, 보관 예정
  await q(`insert into public.task_assignments (node_id, user_id, source) values ($1, $2::uuid, 'DESIGNATED')`, [b, await uid(q, "민수")]);
  await q("select public.assignment_resync($1)", [room.id]);
  await submit(q, a, "서연"); await submit(q, a, "민수", true);
  await submit(q, b, "민수");
  await submit(q, c, "지훈");
  let p = await progress(q, room.id);
  assertEquals(p[a], { asg: 3, sub: 2, pct: 67 });
  assertEquals(p[b], { asg: 1, sub: 1, pct: 100 });
  assertEquals(p[c], { asg: 3, sub: 1, pct: 33 });
  assertEquals(p[mid], { asg: 3, sub: 2, pct: 67 });
  assertEquals(p[r1], { asg: 7, sub: 4, pct: 57 });            // 4/7 = 57.14
  // C 보관 → 집계 제외(행은 0/0, pct null). resync 가 C 의 COMMON 행을 released 로 돌린다
  await q("update public.goal_nodes set archived_at = now() where id = $1", [c]);
  await q("select public.assignment_resync($1)", [room.id]);
  p = await progress(q, room.id);
  assertEquals(p[c], { asg: 0, sub: 0, pct: null });
  assertEquals(p[r1], { asg: 4, sub: 3, pct: 75 });
  // room_leaf_stats 는 같은 숫자를 돌려주고 보관 리프는 빠진다
  const ls = await q("select node_id::text as id, asg, sub from public.room_leaf_stats($1) order by node_id", [room.id]);
  assertEquals(ls, [{ id: a, asg: 3, sub: 2 }, { id: b, asg: 1, sub: 1 }]);
  // 빈 방은 빈 집합
  const empty = await mkRoom(q, "지훈", { title: "빈 방 Empty" });
  assertEquals(Object.keys(await progress(q, empty.id)).length, 0);
}));
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "node_subtree"`
Expected: FAIL — `function public.node_subtree(bigint) does not exist` (0006 파일이 없어 마이그레이션 적용 수는 0005 까지).

- [ ] **Step 4: `supabase/migrations/0006_curriculum.sql` 골격**

```sql
-- 0006_curriculum.sql — 커리큘럼 트리 · 진척률 · 내 스터디/일정 (플랜 03 Task 1~8)
-- 배포 후 수정 금지. Task 3~8 이 이 파일 끝에 함수를 이어 붙인다.
-- 권한(D7): 함수는 0002 의 default privileges 로 기본 비공개. 공개 RPC 만 각 Task 끝에서 GRANT 한다.

-- ───────── goal_nodes 형태 보강 트리거 (02 §6, I3·I4, 리뷰 A1) ─────────
-- node_* 함수가 지키는 형태를 직접 INSERT/UPDATE 경로(시드·테스트·service_role)에서도 강제한다.
--   루트(parent null): depth 2, round_id = 자기 id(비우면 채움), label 필수(공백 불가)
--   하위: label 없음. INSERT 이거나 parent_id 가 바뀐 행은 같은 방·depth = 부모+1·round_id = 부모 round_id(비우면 채움)
--   parent_id 가 그대로이고 depth·round_id 만 바뀌는 행 = node_move 의 서브트리 일괄 재기록이다. 같은 문장 안에서 부모 행도
--   바뀌어 행 단위로는 부모의 새 값을 볼 수 없으므로 부모 관계 검사를 건너뛴다(이동한 노드 자신은 parent_id 가 바뀌어 검사된다).
--   depth-2 리프(task_type 있음)는 허용한다(A7).
create or replace function public.goal_nodes_guard() returns trigger
language plpgsql set search_path = '' as $$
declare p public.goal_nodes;
begin
  if new.parent_id is null then
    new.round_id := coalesce(new.round_id, new.id);
    if new.depth <> 2 or new.round_id <> new.id then
      perform public.fail('VALIDATION_FAILED', '회차는 depth 2 이고 round_id 가 자기 자신이어야 해요',
                          jsonb_build_object('nodeId', new.id::text, 'field', 'depth'));
    end if;
    if new.label is null or btrim(new.label) = '' then
      perform public.fail('VALIDATION_FAILED', '회차에는 라벨이 있어야 해요', jsonb_build_object('nodeId', new.id::text, 'field', 'label'));
    end if;
  else
    if new.label is not null then
      perform public.fail('VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', jsonb_build_object('nodeId', new.id::text, 'field', 'label'));
    end if;
    if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
      select * into p from public.goal_nodes where id = new.parent_id;
      new.round_id := coalesce(new.round_id, p.round_id);
      if p.room_id <> new.room_id or new.depth <> p.depth + 1 or new.round_id is distinct from p.round_id then
        perform public.fail('VALIDATION_FAILED', '상위 항목과 깊이·회차·방이 맞지 않아요',
                            jsonb_build_object('nodeId', new.id::text, 'parentId', new.parent_id::text));
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger trg_goal_nodes_guard
  before insert or update of parent_id, depth, round_id, label, room_id on public.goal_nodes
  for each row execute function public.goal_nodes_guard();

-- ───────── 트리 헬퍼 ─────────
-- 자기 자신을 포함한 서브트리 id 집합
create or replace function public.node_subtree(p_node bigint) returns setof bigint
language sql stable security definer set search_path = '' as $$
  with recursive t as (
    select n.id from public.goal_nodes n where n.id = p_node
    union all
    select c.id from public.goal_nodes c join t on c.parent_id = t.id)
  select id from t
$$;

-- 서브트리 어느 리프에든 제출물이 있으면 true (I1·I6 — 삭제·부모 전환·타입 변경 금지의 근거)
create or replace function public.node_has_submissions(p_node bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.submissions s where s.node_id in (select public.node_subtree(p_node)))
$$;

-- 모든 노드 쓰기 함수의 첫 줄: 방 잠금 + 그룹장 + 편집 가능 상태(DRAFT·RECRUIT·ACTIVE, 보관 아님)
create or replace function public.node_assert_editable(p_slug text) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);   -- 외부인(못 읽음) ROOM_NOT_FOUND, 그 외 NOT_LEADER (plan 02 I-2)
  if r.archived_at is not null or r.status not in ('DRAFT', 'RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_NOT_EDITABLE', '종료되었거나 보관된 방은 편집할 수 없어요', jsonb_build_object('status', lower(r.status)));
  end if;
  return r;
end $$;

-- 방 소속 노드 조회. 다른 방의 노드도 NODE_NOT_FOUND
create or replace function public.node_get(p_room bigint, p_node bigint) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes;
begin
  select * into n from public.goal_nodes where id = p_node and room_id = p_room;
  if not found then perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', p_node::text)); end if;
  return n;
end $$;

-- ───────── 진척률 롤업 (D5, 02 §4.1) ─────────
-- 모든 노드 한 행씩. 리프 = (유효 배정, 그중 제출), 부모 = 보관 아닌 후손 리프의 합. 보관 노드와 그 하위는 0/0(pct null).
create or replace function public.room_progress(p_room bigint)
returns table (node_id bigint, asg int, sub int, pct int)
language sql stable security definer set search_path = '' as $$
  with recursive leaf as (
    select n.id, n.parent_id, count(a.id)::int as asg, count(s.id)::int as sub
    from public.goal_nodes n
    left join public.task_assignments a on a.node_id = n.id and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
    where n.room_id = p_room and n.task_type is not null and n.archived_at is null
    group by n.id, n.parent_id),
  up as (
    select l.id as node_id, l.asg, l.sub, l.parent_id from leaf l
    union all
    select p.id, u.asg, u.sub, p.parent_id
    from up u join public.goal_nodes p on p.id = u.parent_id)
  select n.id, coalesce(sum(u.asg), 0)::int, coalesce(sum(u.sub), 0)::int,
         public.pct(coalesce(sum(u.asg), 0)::int, coalesce(sum(u.sub), 0)::int)
  from public.goal_nodes n
  left join up u on u.node_id = n.id
  where n.room_id = p_room
  group by n.id
$$;

-- 플랜 02 의 room_leaf_stats 를 같은 시그니처로 교체: 숫자는 room_progress 에서 가져온다 (room_get·rooms_list 가 자동으로 같은 값을 본다)
create or replace function public.room_leaf_stats(p_room bigint)
returns table (node_id bigint, round_id bigint, parent_id bigint, title text, task_type text,
               start_date date, end_date date, sort_order int, asg int, sub int)
language sql stable security definer set search_path = '' as $$
  select n.id, n.round_id, n.parent_id, n.title::text, n.task_type::text, n.start_date, n.end_date, n.sort_order, p.asg, p.sub
  from public.goal_nodes n
  join public.room_progress(p_room) p on p.node_id = n.id
  where n.room_id = p_room and n.task_type is not null and n.archived_at is null
$$;
```

`CREATE OR REPLACE` 는 반환 타입이 플랜 02 와 글자 단위로 같아야 한다. 다르면 `cannot change return type of existing function` 이 나므로 0004 의 정의를 열어 열 이름·타입 순서를 맞춘다.

- [ ] **Step 5: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "sql"`
Expected: progress 사례 4개(트리거 포함) PASS, 플랜 01·02 의 기존 사례도 전부 PASS(`room_leaf_stats` 교체로 `room_get` 숫자가 바뀌면 안 된다. 플랜 01·02 의 직접 INSERT 는 전부 루트=depth 2+label, 하위=depth+1 이라 트리거에 걸리지 않는다 — 걸리면 그 INSERT 가 형태를 어긴 것).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0006_curriculum.sql supabase/tests/_curriculum-helpers.ts supabase/tests/progress-sql.test.ts
git commit -m "feat(db): 0006 goal_nodes guard trigger, tree helpers, room_progress rollup, room_leaf_stats delegation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 2: `seed.sql` §3 커리큘럼 — PLANS 트리 · 제출 코드 · 회귀값

**Files:**
- Modify: `supabase/seed.sql` (§2 방·멤버 섹션 아래, 마지막 기준일(`internal.settings` 'today') 줄 위에 §3 추가)
- Modify: `supabase/tests/progress-sql.test.ts` (시드 회귀 + RF3 사례 추가)
- Modify: `supabase/tests/_cases-rooms.ts` (**플랜 02 파일** — 시드 §3 이 깨뜨리는 사례 3개를 전체 시드 값으로 교체, `seedAwsTree` 삭제. 이 갱신의 소유자는 이 Task 다 — 리뷰 B1)

**Interfaces:**
- Consumes: 플랜 02 시드의 방 9개·멤버십, `assignment_resync`, `room_release_seat`, `room_apply`/`room_join`, Task 1 의 `room_progress`.
- Produces: `goal_nodes`·`task_assignments`·`submissions` 시드 행. 회귀값(플랜 04·05 테스트가 참조): aws 24%(5/8·1/3·0/4·0/4·0/6, 노드 14 = 회차 5 + 중간 1 + 리프 8), spring 34%, algo 87%, sqld null, react 4주차 3/10, aws IAM people = 민수 done·지은 late·철수 done·하나 missed(today 2026-10-12), **철수 aws 2/6=33%**(방 목록 슬롯·참가자 통계 동일, D5), 민수 2/5(다음 마감 없음 — ALB 10/15 시작 전), 철수 aws 다음 마감 EC2 2026-10-14(OPEN 만). 도윤의 IAM 제출물(released 배정)은 플랜 05 "이탈자 제출물 조회" 재료.

- [ ] **Step 1: 실패하는 회귀 테스트 — `supabase/tests/progress-sql.test.ts` 끝에 추가**

```ts
async function roundStats(q: Parameters<typeof progress>[0], slug: string) {
  const room = await roomId(q, slug);
  const p = await progress(q, room);
  const rounds = await q("select id::text as id, label from public.goal_nodes where room_id = $1 and parent_id is null order by sort_order", [room]);
  return { room, p, rounds: rounds.map((r) => ({ label: r.label as string, ...p[r.id as string] })) };
}

async function overall(q: Parameters<typeof progress>[0], slug: string) {
  const room = await roomId(q, slug);
  const [r] = await q(
    `select public.pct(coalesce(sum(asg),0)::int, coalesce(sum(sub),0)::int) as pct, coalesce(sum(asg),0)::int as asg, coalesce(sum(sub),0)::int as sub
     from public.room_progress($1) p join public.goal_nodes n on n.id = p.node_id where n.parent_id is null and n.archived_at is null`, [room]);
  return { pct: r.pct as number | null, asg: r.asg as number, sub: r.sub as number };
}

sqlTest("seed §3: aws 24% — 회차 5/8·1/3·0/4·0/4·0/6, 트리 모양이 PLANS 와 같다", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const { room, rounds } = await roundStats(q, "aws");
  assertEquals(rounds.map((r) => [r.label, r.sub, r.asg]), [["1주차", 5, 8], ["2주차", 1, 3], ["3주차", 0, 4], ["4주차", 0, 4], ["5주차", 0, 6]]);
  assertEquals(await overall(q, "aws"), { pct: 24, asg: 25, sub: 6 });
  const nodes = await q(
    `select depth, label, title, task_type, to_char(start_date,'YYYY-MM-DD') as s, to_char(end_date,'YYYY-MM-DD') as e
     from public.goal_nodes where room_id = $1 order by id`, [room]);
  assertEquals(nodes.length, 14);   // 회차 5 + 중간 1 + 리프 8 (PLANS.aws)
  assertEquals(nodes[0], { depth: 2, label: "1주차", title: "IAM·VPC", task_type: null, s: "2026-10-01", e: "2026-10-07" });
  assertEquals(nodes.find((n) => n.title === "로드밸런서 비교"), { depth: 3, label: null, title: "로드밸런서 비교", task_type: null, s: "2026-10-15", e: "2026-10-21" });
  assertEquals(nodes.find((n) => n.title === "ALB vs NLB 실습")?.depth, 4);
  assertEquals(nodes.filter((n) => n.task_type === "DESIGNATED").map((n) => n.title), ["EC2 인스턴스 유형 정리", "S3 스토리지 클래스 발표자료", "DynamoDB 설계 퀴즈"]);
  // round_id 는 depth-2 조상
  const [{ bad }] = await q(
    `select count(*)::int as bad from public.goal_nodes n
     where n.room_id = $1 and n.round_id <> (select coalesce(r.id, n.id) from public.goal_nodes r where r.id = n.round_id and r.parent_id is null)`, [room]);
  assertEquals(bad, 0);
}));

sqlTest("seed §3: spring 34%, algo 87%(13주 68/78), sqld null(가은 leader_does_tasks=false), react 4주차 3/10", withCase(db, async (q) => {
  await setToday(q, TODAY);
  assertEquals(await overall(q, "spring"), { pct: 34, asg: 35, sub: 12 });
  assertEquals((await roundStats(q, "spring")).rounds.map((r) => [r.sub, r.asg]), [[9, 10], [3, 10], [0, 10], [0, 5]]);
  assertEquals(await overall(q, "algo"), { pct: 87, asg: 78, sub: 68 });
  assertEquals((await roundStats(q, "algo")).rounds.map((r) => [r.label, r.sub, r.asg]), [["1–4주차", 23, 24], ["5–8주차", 21, 24], ["9–13주차", 24, 30]]);
  assertEquals(await overall(q, "sqld"), { pct: null, asg: 0, sub: 0 });
  const sq = await roundStats(q, "sqld");
  assertEquals(sq.rounds.map((r) => r.label), ["1주차", "2주차", "3주차", "4주차"]);
  const [{ n: sqLeaves }] = await q("select count(*)::int as n from public.goal_nodes where room_id = $1 and task_type is not null", [sq.room]);
  assertEquals(sqLeaves, 9);
  const re = await roundStats(q, "react");
  assertEquals(re.rounds.map((r) => [r.label, r.sub, r.asg]), [["1주차", 10, 10], ["2주차", 10, 10], ["3주차", 9, 10], ["4주차", 3, 10], ["5주차", 0, 10], ["6주차", 0, 10], ["7주차", 0, 10], ["8주차", 0, 10]]);
  // 모집중 방: 회차 수·리프 수가 room-view 목업과 같다 (toeic 8/16, cs 12/24, docker 6/8, jcg 2/6)
  for (const [slug, rounds, leaves] of [["toeic", 8, 16], ["cs", 12, 24], ["docker", 6, 8], ["jcg", 2, 6]] as const) {
    const room = await roomId(q, slug);
    const [{ r, l }] = await q(
      `select count(*) filter (where parent_id is null)::int as r, count(*) filter (where task_type is not null)::int as l from public.goal_nodes where room_id = $1`, [room]);
    assertEquals([slug, r, l], [slug, rounds, leaves]);
  }
}));

sqlTest("seed §3: aws 참가자 done/total — 민수 2/5 지은 2/7 철수 2/6 하나 0/7, 도윤은 released 행만", withCase(db, async (q) => {
  const room = await roomId(q, "aws");
  const rows = await q(
    `select p.nickname, count(*) filter (where s.id is not null)::int as done, count(*)::int as total
     from public.task_assignments a
     join public.goal_nodes n on n.id = a.node_id and n.archived_at is null
     join public.profiles p on p.id = a.user_id
     left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
     where n.room_id = $1 and a.released_at is null group by p.nickname order by p.nickname`, [room]);
  assertEquals(rows, [
    { nickname: "민수", done: 2, total: 5 }, { nickname: "지은", done: 2, total: 7 },
    { nickname: "철수", done: 2, total: 6 }, { nickname: "하나", done: 0, total: 7 },
  ]);
  const [dy] = await q(
    `select count(*)::int as n, bool_and(a.released_at is not null) as released
     from public.task_assignments a join public.profiles p on p.id = a.user_id join public.goal_nodes n on n.id = a.node_id
     where n.room_id = $1 and p.nickname = '도윤'`, [room]);
  assertEquals(dy, { n: 1, released: true });
  const [sub] = await q(`select count(*)::int as n from public.submissions s join public.profiles p on p.id = s.user_id join public.goal_nodes n on n.id = s.node_id where n.room_id = $1 and p.nickname = '도윤'`, [room]);
  assertEquals(sub.n, 1);
}));

sqlTest("resync 규칙: 공통 리프 × ACTIVE, INACTIVE 는 released, leader_does_tasks=false 는 그룹장 제외, 재활성화 복구", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await roomId(q, "aws");
  const iam = await nodeByTitle(q, room, "IAM 정책 이해");
  const cnt = async () => (await q("select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null", [iam]))[0].n;
  assertEquals(await cnt(), 4);
  // 하나 이탈 → released(제출물 보존), 분모 3
  const hana = await uid(q, "하나");
  await q("update public.room_members set status = 'INACTIVE', left_at = now() where room_id = $1 and user_id = $2::uuid", [room, hana]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals(await cnt(), 3);
  assertEquals((await progress(q, room))[iam], { asg: 3, sub: 3, pct: 100 });
  // 재활성화 → 같은 행 복구
  await q("update public.room_members set status = 'ACTIVE', left_at = null where room_id = $1 and user_id = $2::uuid", [room, hana]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals(await cnt(), 4);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1", [iam]))[0].n, 5);  // 도윤 released 포함, 행 삭제 없음
  // 그룹장 제외
  await q("update public.rooms set leader_does_tasks = false where id = $1", [room]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals(await cnt(), 3);
  assertEquals((await progress(q, room))[iam], { asg: 3, sub: 2, pct: 67 });
  await q("update public.rooms set leader_does_tasks = true where id = $1", [room]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals(await cnt(), 4);
}));

sqlTest("RF3 이탈자 분모: 제출자(철수) INACTIVE → IAM 3/4 → 2/3, released 행·제출물 유지, 그룹장은 계속 조회", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await roomId(q, "aws");
  const iam = await nodeByTitle(q, room, "IAM 정책 이해");
  const chulsoo = await uid(q, "철수");
  assertEquals((await progress(q, room))[iam], { asg: 4, sub: 3, pct: 75 });
  // member_deactivate(플랜 04) 의 전구체: 상태 전환 + 자리 반납 + resync
  await q("update public.room_members set status = 'INACTIVE', left_at = now() where room_id = $1 and user_id = $2::uuid", [room, chulsoo]);
  await q("select public.room_release_seat($1)", [room]);
  await q("select public.assignment_resync($1)", [room]);
  assertEquals((await progress(q, room))[iam], { asg: 3, sub: 2, pct: 67 });            // 분모에서 빠지고 제출도 집계 제외
  const [row] = await q("select released_at is not null as released from public.task_assignments where node_id = $1 and user_id = $2::uuid", [iam, chulsoo]);
  assertEquals(row.released, true);                                                     // 행 삭제 없음
  assertEquals((await q("select count(*)::int as n from public.submissions where node_id = $1 and user_id = $2::uuid", [iam, chulsoo]))[0].n, 1);
  await asUser(q, await uid(q, "민수"));
  assertEquals((await q("select public.can_read_submission($1, $2::uuid) as b", [iam, chulsoo]))[0].b, true);   // 그룹장 조회 유지
}));

sqlTest("RF3: RECRUIT 방의 INACTIVE 행은 room_apply·room_join 모두 MEMBER_NOT_ACTIVE (재참가 거부)", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const chulsoo = await uid(q, "철수");
  // sqld(RECRUIT·APPROVAL): 철수 행을 INACTIVE 로 만든다(이탈 처리 결과를 흉내)
  await q("update public.room_members set status = 'INACTIVE', left_at = now() where room_id = $1 and user_id = $2::uuid", [await roomId(q, "sqld"), chulsoo]);
  // cs(RECRUIT·DIRECT): INACTIVE 행을 직접 만든다
  await q(`insert into public.room_members (room_id, user_id, role, status, joined_at, left_at)
           values ($1, $2::uuid, 'MEMBER', 'INACTIVE', now(), now())`, [await roomId(q, "cs"), chulsoo]);
  await asUser(q, chulsoo);
  await expectFail(q("select public.room_apply('sqld')"), "MEMBER_NOT_ACTIVE");
  await expectFail(q("select public.room_join('cs')"), "MEMBER_NOT_ACTIVE");
}));
```

파일 상단 import 를 `import { mkLeaf, mkRoom, mkRound, nodeByTitle, progress, roomId, submit, uid, TODAY } from "./_curriculum-helpers.ts";` 로 바꾼다.

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "seed §3|RF3"`
Expected: `seed §3` 3건 FAIL — `rounds` 가 빈 배열(aws 에 goal_nodes 없음). RF3 두 건도 FAIL(IAM 노드 없음 → `nodeByTitle` 오류 / sqld 는 이미 MEMBER_NOT_ACTIVE 로 PASS 할 수 있다).

- [ ] **Step 3: `supabase/seed.sql` 에 §3 추가**

§2(플랜 02) 바로 아래, 파일 마지막 `insert into internal.settings … 'today' …` 줄 **위**에 붙인다(그 줄은 항상 마지막). 제출물 시드는 이 섹션이 소유한다 — 플랜 04 의 §4 는 제출물을 다시 넣지 않는다. 임시 함수는 `pg_temp` 스키마라 세션이 끝나면 사라진다(`supabase db reset` 도 PGlite 도 한 세션).

```sql
-- ═══════════ §3 커리큘럼 (plan 03) ═══════════
-- src/data/my-study.ts PLANS 원본(aws·spring·sqld·algo)과 src/data/room-view.ts 회차(toeic·cs·docker·jcg·react).
-- 코드 문자열은 PLANS.members 순서: D 기한내(end_date 18:00 KST) / L 지각(end_date+1 09:00 KST) / M·O·P 미제출 / - 미배정.
-- 공통 리프의 배정은 섹션 끝 assignment_resync 가 만든다. 지정 리프는 '-' 아닌 자리만 DESIGNATED 행.
-- 멱등: goal_nodes 가 하나라도 있으면 건너뛴다(플랜 01 seed 테스트가 seed.sql 을 두 번 적용한다).

create or replace function pg_temp.kst_at(p_d date, p_h int) returns timestamptz
language sql as $$ select (p_d::timestamp + make_interval(hours => p_h)) at time zone 'Asia/Seoul' $$;

create or replace function pg_temp.seed_round(p_slug text, p_label text, p_title text, p_s date, p_e date) returns bigint
language plpgsql as $$
declare v_room bigint; v_id bigint; v_n int;
begin
  select id into v_room from public.rooms where slug = p_slug;
  if v_room is null then raise exception 'seed §3: room % missing (plan 02 §2 first)', p_slug; end if;
  select count(*) into v_n from public.goal_nodes where room_id = v_room and parent_id is null;
  insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
  values (v_room, null, 2, v_n, p_label, p_title, p_s, p_e) returning id into v_id;
  update public.goal_nodes set round_id = v_id where id = v_id;
  return v_id;
end $$;

-- 중간 노드(자식을 가질 노드). task_type null
create or replace function pg_temp.seed_node(p_parent bigint, p_title text, p_s date, p_e date) returns bigint
language plpgsql as $$
declare p public.goal_nodes; v_id bigint; v_n int;
begin
  select * into p from public.goal_nodes where id = p_parent;
  select count(*) into v_n from public.goal_nodes where parent_id = p_parent;
  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date)
  values (p.room_id, p.id, p.round_id, p.depth + 1, v_n, p_title, p_s, p_e) returning id into v_id;
  return v_id;
end $$;

-- 리프 + 코드. p_names 는 p_codes 와 같은 순서의 닉네임
create or replace function pg_temp.seed_leaf(p_parent bigint, p_title text, p_type text, p_s date, p_e date,
                                             p_codes text default null, p_names text[] default null) returns bigint
language plpgsql as $$
declare p public.goal_nodes; v_id bigint; v_n int; i int; v_c text; v_user uuid;
begin
  select * into p from public.goal_nodes where id = p_parent;
  select count(*) into v_n from public.goal_nodes where parent_id = p_parent;
  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
  values (p.room_id, p.id, p.round_id, p.depth + 1, v_n, p_title, p_s, p_e, p_type) returning id into v_id;
  if p_codes is null then return v_id; end if;
  if length(p_codes) <> coalesce(array_length(p_names, 1), 0) then
    raise exception 'seed §3: codes "%" vs names % length mismatch (%)', p_codes, p_names, p_title;
  end if;
  for i in 1 .. length(p_codes) loop
    v_c := substr(p_codes, i, 1);
    select id into v_user from public.profiles where nickname = p_names[i];
    if v_user is null then raise exception 'seed §3: user % missing', p_names[i]; end if;
    if p_type = 'DESIGNATED' and v_c <> '-' then
      insert into public.task_assignments (node_id, user_id, source) values (v_id, v_user, 'DESIGNATED');
    end if;
    if v_c = 'D' then
      insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late)
      values (v_id, v_user, '## ' || p_title || E'\n\n' || p_names[i] || ' 제출', pg_temp.kst_at(p_e, 18), false);
    elsif v_c = 'L' then
      insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late)
      values (v_id, v_user, '## ' || p_title || E'\n\n' || p_names[i] || ' 지각 제출', pg_temp.kst_at(p_e + 1, 9), true);
    end if;
  end loop;
  return v_id;
end $$;

do $seed3$
declare
  aws    text[] := array['민수', '지은', '철수', '하나'];
  spring text[] := array['지훈', '철수', '소율', '민재', '아린'];
  sqld   text[] := array['가은'];
  algo   text[] := array['현우', '철수', '보람', '지성', '다은', '유진'];
  react  text[] := array['태호', '은지', '시우', '다인', '현준'];
  r bigint; r1 bigint; r2 bigint; r3 bigint; m bigint; w int; s date; v_codes text;
  algo_codes text[] := array['DDDDDD', 'DDDMDD', 'DDDDDD', 'DDDDDD', 'DDDDDM', 'DDDMDD', 'DDMDDD', 'DDDDDD',
                             'DMDDDD', 'DDDMDD', 'DMDDDD', 'DDDDMM', 'DDDDDM'];   -- algoMiss: 2 지성, 5 유진, 6 지성, 7 보람, 9 철수, 10 지성, 11 철수, 12 다은·유진, 13 유진
  toeic_t text[] := array['LC Part 1·2', 'RC Part 5·6', 'LC Part 3·4', 'RC Part 7', 'LC 종합', 'RC 종합', '실전 모의고사 ①', '실전 모의고사 ②'];
  cs_t    text[] := array['운영체제 ① 프로세스·스레드', '운영체제 ② 메모리', '네트워크 ① TCP/IP', '네트워크 ② HTTP·HTTPS',
                          '데이터베이스 ① 인덱스', '데이터베이스 ② 트랜잭션', '운영체제 ③ 동기화', '네트워크 ③ DNS·CDN',
                          '데이터베이스 ③ 정규화', '자료구조 총정리', '종합 질문', '모의 면접'];
  docker_t text[] := array['컨테이너와 이미지', 'Dockerfile·Compose', '쿠버네티스 기본 오브젝트', '서비스·인그레스', '설정·스토리지', '배포 파이프라인'];
  docker_n int[]  := array[2, 1, 2, 1, 1, 1];
  react_t text[] := array['UI 표현하기 ①', 'UI 표현하기 ②', '상호작용 더하기', '상태 관리하기', '탈출구(Escape Hatches)', '탈출구 ②', '종합 프로젝트 ①', '종합 프로젝트 ②'];
  react_a text[] := array['JSX·컴포넌트 정리 노트', '조건부 렌더링 노트', '이벤트·state 노트', '리듀서로 상태 로직 옮기기', 'ref·effect 노트', '커스텀 훅 노트', '미니 앱 설계 노트', '미니 앱 완성'];
  react_b text[] := array['props 예제', '리스트 렌더링 예제', '렌더링 과정 예제', 'Context로 props 전달 줄이기', 'effect 의존성 예제', '커스텀 훅 예제', '미니 앱 1차 구현', '회고 노트'];
begin
  if exists (select 1 from public.goal_nodes) then
    raise notice 'seed §3: goal_nodes already present — skipped';
    return;
  end if;

  -- ── aws (PLANS.aws) ──
  r := pg_temp.seed_round('aws', '1주차', 'IAM·VPC', '2026-10-01', '2026-10-07');
  perform pg_temp.seed_leaf(r, 'IAM 정책 이해', 'COMMON', '2026-10-01', '2026-10-03', 'DLDM', aws);
  perform pg_temp.seed_leaf(r, 'VPC 실습',      'COMMON', '2026-10-04', '2026-10-07', 'DMDM', aws);
  r := pg_temp.seed_round('aws', '2주차', 'EC2·S3', '2026-10-08', '2026-10-14');
  perform pg_temp.seed_leaf(r, 'EC2 인스턴스 유형 정리',       'DESIGNATED', '2026-10-08', '2026-10-14', '-DO-', aws);
  perform pg_temp.seed_leaf(r, 'S3 스토리지 클래스 발표자료', 'DESIGNATED', '2026-10-10', '2026-10-14', '---O', aws);
  r := pg_temp.seed_round('aws', '3주차', '고가용성 아키텍처', '2026-10-15', '2026-10-21');
  m := pg_temp.seed_node(r, '로드밸런서 비교', '2026-10-15', '2026-10-21');
  perform pg_temp.seed_leaf(m, 'ALB vs NLB 실습', 'COMMON', '2026-10-15', '2026-10-21', 'PPPP', aws);
  r := pg_temp.seed_round('aws', '4주차', '오토스케일링', '2026-10-22', '2026-10-28');
  perform pg_temp.seed_leaf(r, 'Auto Scaling 정책 정리', 'COMMON', '2026-10-22', '2026-10-28', 'PPPP', aws);
  r := pg_temp.seed_round('aws', '5주차', '데이터베이스', '2026-10-29', '2026-11-04');
  perform pg_temp.seed_leaf(r, 'RDS·Aurora 비교',    'COMMON',     '2026-10-29', '2026-11-04', 'PPPP', aws);
  perform pg_temp.seed_leaf(r, 'DynamoDB 설계 퀴즈', 'DESIGNATED', '2026-11-01', '2026-11-04', '-P-P', aws);

  -- ── spring (PLANS.spring) ──
  r := pg_temp.seed_round('spring', '1주차', '핵심 원리 기본편 (전반)', '2026-10-05', '2026-10-11');
  perform pg_temp.seed_leaf(r, '섹션 1~5 정리 노트',  'COMMON', '2026-10-05', '2026-10-11', 'DDDDD', spring);
  perform pg_temp.seed_leaf(r, '스프링 컨테이너 실습', 'COMMON', '2026-10-08', '2026-10-11', 'DLDDM', spring);
  r := pg_temp.seed_round('spring', '2주차', '핵심 원리 기본편 (후반)', '2026-10-12', '2026-10-18');
  perform pg_temp.seed_leaf(r, '섹션 6~7 정리 노트',         'COMMON', '2026-10-12', '2026-10-18', 'DODDO', spring);
  perform pg_temp.seed_leaf(r, '싱글톤 컨테이너 실습 코드', 'COMMON', '2026-10-15', '2026-10-18', 'PPPPP', spring);
  r := pg_temp.seed_round('spring', '3주차', '스프링 MVC 1편', '2026-10-19', '2026-10-25');
  perform pg_temp.seed_leaf(r, 'MVC 구조 이해 노트',   'COMMON', '2026-10-19', '2026-10-25', 'PPPPP', spring);
  perform pg_temp.seed_leaf(r, '서블릿→MVC 리팩토링', 'COMMON', '2026-10-22', '2026-10-25', 'PPPPP', spring);
  r := pg_temp.seed_round('spring', '4주차', 'MVC 1편 (후반)', '2026-10-26', '2026-11-01');
  perform pg_temp.seed_leaf(r, 'MVC 1편 섹션 5~7 노트', 'COMMON', '2026-10-26', '2026-11-01', 'PPPPP', spring);

  -- ── sqld (PLANS.sqld) — 가은은 leader_does_tasks=false 라 공통 리프 asg=0 (D5: sqld null) ──
  update public.rooms set leader_does_tasks = false where slug = 'sqld';
  r := pg_temp.seed_round('sqld', '1주차', '데이터 모델링의 이해', '2026-10-26', '2026-11-01');
  perform pg_temp.seed_leaf(r, '데이터 모델링 요약 노트', 'COMMON', '2026-10-26', '2026-11-01', 'P', sqld);
  perform pg_temp.seed_leaf(r, '1과목 기출 풀이',         'COMMON', '2026-10-29', '2026-11-01', 'P', sqld);
  r := pg_temp.seed_round('sqld', '2주차', 'SQL 기본', '2026-11-02', '2026-11-08');
  perform pg_temp.seed_leaf(r, 'SELECT·JOIN 정리',        'COMMON',     '2026-11-02', '2026-11-05', 'P', sqld);
  perform pg_temp.seed_leaf(r, '내장 함수 실습',          'COMMON',     '2026-11-04', '2026-11-08', 'P', sqld);
  perform pg_temp.seed_leaf(r, '2과목 기출 풀이 (전반)', 'DESIGNATED', '2026-11-06', '2026-11-08', '-', sqld);
  r := pg_temp.seed_round('sqld', '3주차', 'SQL 활용', '2026-11-09', '2026-11-15');
  perform pg_temp.seed_leaf(r, '서브쿼리·윈도우 함수',    'COMMON', '2026-11-09', '2026-11-15', 'P', sqld);
  perform pg_temp.seed_leaf(r, '2과목 기출 풀이 (후반)', 'COMMON', '2026-11-12', '2026-11-15', 'P', sqld);
  r := pg_temp.seed_round('sqld', '4주차', '모의고사', '2026-11-16', '2026-11-22');
  perform pg_temp.seed_leaf(r, '모의고사 1회', 'COMMON', '2026-11-16', '2026-11-19', 'P', sqld);
  perform pg_temp.seed_leaf(r, '모의고사 2회', 'COMMON', '2026-11-20', '2026-11-22', 'P', sqld);

  -- ── algo (PLANS.algo: algoGroup/algoWeek — 그룹 e 는 마지막 주 e 인 09-29) ──
  r1 := pg_temp.seed_round('algo', '1–4주차',  '구현 · 그리디',          '2026-07-01', '2026-07-28');
  r2 := pg_temp.seed_round('algo', '5–8주차',  'BFS · DFS · 백트래킹',   '2026-07-29', '2026-08-25');
  r3 := pg_temp.seed_round('algo', '9–13주차', 'DP · 최단경로',          '2026-08-26', '2026-09-29');
  for w in 1 .. 13 loop
    s := date '2026-07-01' + (w - 1) * 7;
    perform pg_temp.seed_leaf(case when w <= 4 then r1 when w <= 8 then r2 else r3 end,
                              w || '주차 문제 풀이', 'COMMON', s, s + 6, algo_codes[w], algo);
  end loop;

  -- ── react (room-view: 8회차 매주 월요일, 공통 2개씩, 3주차 9/10, 4주차 3/10) ──
  for w in 1 .. 8 loop
    s := date '2026-09-21' + (w - 1) * 7;
    r := pg_temp.seed_round('react', w || '주차', react_t[w], s, s + 6);
    v_codes := case when w <= 2 then 'DDDDD' when w = 3 then 'DDDDD' when w = 4 then 'DDODO' else 'PPPPP' end;
    perform pg_temp.seed_leaf(r, react_a[w], 'COMMON', s, s + 6, v_codes, react);
    v_codes := case when w <= 2 then 'DDDDD' when w = 3 then 'DDDDM' when w = 4 then 'PPPPP' else 'PPPPP' end;
    perform pg_temp.seed_leaf(r, react_b[w], 'COMMON', case when w = 4 then s + 3 else s end, s + 6, v_codes, react);
  end loop;

  -- ── toeic (8회차 매주 월요일 11-02~, 공통 2개씩) ──
  for w in 1 .. 8 loop
    s := date '2026-11-02' + (w - 1) * 7;
    r := pg_temp.seed_round('toeic', w || '주차', toeic_t[w], s, s + 6);
    perform pg_temp.seed_leaf(r, toeic_t[w] || ' 오답 노트', 'COMMON', s, s + 4);
    perform pg_temp.seed_leaf(r, '주말 모의고사 ' || w || '회', 'COMMON', s + 5, s + 6);
  end loop;

  -- ── cs (12회차, 월 3일·목 4일 교대, 10-19~11-29, 공통 2개씩) ──
  for w in 1 .. 12 loop
    s := date '2026-10-19' + ((w - 1) / 2) * 7 + case when w % 2 = 1 then 0 else 3 end;
    r := pg_temp.seed_round('cs', w || '회차', cs_t[w], s, s + case when w % 2 = 1 then 2 else 3 end);
    perform pg_temp.seed_leaf(r, '질문 1 답변', 'COMMON', s, s + case when w % 2 = 1 then 2 else 3 end);
    perform pg_temp.seed_leaf(r, '질문 2 답변', 'COMMON', s, s + case when w % 2 = 1 then 2 else 3 end);
  end loop;

  -- ── docker (6회차 매주 월요일 11-09~, 공통 2·1·2·1·1·1 = 8) ──
  for w in 1 .. 6 loop
    s := date '2026-11-09' + (w - 1) * 7;
    r := pg_temp.seed_round('docker', w || '주차', docker_t[w], s, s + 6);
    perform pg_temp.seed_leaf(r, docker_t[w] || ' 실습 ①', 'COMMON', s, s + 6);
    if docker_n[w] = 2 then perform pg_temp.seed_leaf(r, docker_t[w] || ' 실습 ②', 'COMMON', s + 3, s + 6); end if;
  end loop;

  -- ── jcg (2회차, 공통 3개씩) ──
  r := pg_temp.seed_round('jcg', '1주차', '필기 복습 · 기출 1회독', '2026-10-19', '2026-10-25');
  perform pg_temp.seed_leaf(r, '필기 핵심 요약',   'COMMON', '2026-10-19', '2026-10-21');
  perform pg_temp.seed_leaf(r, '기출 1회독',       'COMMON', '2026-10-21', '2026-10-25');
  perform pg_temp.seed_leaf(r, '오답 단원 정리',   'COMMON', '2026-10-24', '2026-10-25');
  r := pg_temp.seed_round('jcg', '2주차', '약점 단원 · 기출 2~3회독', '2026-10-26', '2026-11-01');
  perform pg_temp.seed_leaf(r, '약점 단원 집중',   'COMMON', '2026-10-26', '2026-10-28');
  perform pg_temp.seed_leaf(r, '기출 2회독',       'COMMON', '2026-10-28', '2026-10-30');
  perform pg_temp.seed_leaf(r, '기출 3회독·총정리', 'COMMON', '2026-10-30', '2026-11-01');

  -- ── 이탈자 도윤(aws INACTIVE): IAM 에 released 배정 + 제출물 (집계 제외, 제출물 보존 — D4·D14) ──
  insert into public.task_assignments (node_id, user_id, source, assigned_at, released_at)
  select n.id, p.id, 'COMMON', pg_temp.kst_at('2026-10-01', 0), pg_temp.kst_at('2026-10-06', 10)
  from public.goal_nodes n join public.rooms r on r.id = n.room_id, public.profiles p
  where r.slug = 'aws' and n.title = 'IAM 정책 이해' and p.nickname = '도윤';
  insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late)
  select n.id, p.id, '## IAM 정책 이해' || E'\n\n' || '도윤 제출(이탈 전)', pg_temp.kst_at('2026-10-03', 18), false
  from public.goal_nodes n join public.rooms r on r.id = n.room_id, public.profiles p
  where r.slug = 'aws' and n.title = 'IAM 정책 이해' and p.nickname = '도윤';

  -- ── 공통 리프 배정 실체화 (D4) ──
  perform public.assignment_resync(id) from public.rooms;
end $seed3$;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "progress|seed §3|RF3|resync"`
Expected: progress 10 사례 PASS. **플랜 02 `rooms:` 중 3건은 이 시점에 FAIL 한다**(시드 트리 위에 `seedAwsTree` 가 회차를 또 붙이거나 빈 트리를 가정) — Step 5 에서 고친다.

PGlite 가 `pg_temp.` 함수 생성을 거부하면(`schema "pg_temp" does not exist`) 네 함수를 `public._seed3_kst_at`·`public._seed3_seed_round`·`public._seed3_seed_node`·`public._seed3_seed_leaf` 로 만들고(본문의 `pg_temp.` 호출도 같은 이름으로), DO 블록 뒤에 아래 네 줄을 붙인다:
```sql
drop function public._seed3_seed_leaf(bigint, text, text, date, date, text, text[]);
drop function public._seed3_seed_node(bigint, text, date, date);
drop function public._seed3_seed_round(text, text, text, date, date);
drop function public._seed3_kst_at(date, int);
```

- [ ] **Step 5: 플랜 02 사례 3개를 전체 시드 값으로 교체 (이 Task 소유 — 리뷰 B1)**

시드 §3 이 들어오면 플랜 02 `_cases-rooms.ts` 의 세 사례가 깨진다: `seedAwsTree` 가 aws 에 회차를 중복으로 붙이고, react `team null/0`·algo `final 0/0/0`·toeic `rounds: []`·stats 0 을 가정한다. 헬퍼 호출을 빼고 아래로 **통째로 바꾼다**. 숫자는 이 Task 의 회귀값과 같은 출처다(D5·D14: 철수 2/6=33%, nextDue/nextTask 는 OPEN 만).

① `rooms_list: progress (seedAwsTree 부분 트리) …` 사례 →

```ts
  {
    name: "rooms_list: progress (시드 §3) — 철수 aws mine 2/6 next EC2 10/14, 민수 mine 2/5 next null, 서연 team 2/5, react team 4/8, algo final 68/78·3회차",
    run: async (q) => {
      await setToday(q, TODAY);
      const [{ ec2, alb }] = await q(`select (select id::text from public.goal_nodes where room_id = 6 and title = 'EC2 인스턴스 유형 정리') as ec2,
                                             (select id::text from public.goal_nodes where room_id = 6 and title = 'ALB vs NLB 실습') as alb`);
      await asUser(q, USERS.철수);
      let by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      // 철수 aws: IAM D·VPC D·EC2 O·ALB·AutoScaling·RDS = 2/6 = 33% (목업 50% 폐기, D5)
      assertEquals(by.aws.progress, { kind: "mine", submitted: 2, assigned: 6, nextTask: { nodeId: ec2, title: "EC2 인스턴스 유형 정리", dueDate: "2026-10-14" } });
      assertEquals(by.aws.membership, { role: "member", status: "active" });
      assertEquals(by.react.progress, { kind: "team", currentRound: { index: 4, label: "4주차", title: "상태 관리하기" }, totalRounds: 8 });
      assertEquals(by.algo.progress, { kind: "final", submitted: 68, assigned: 78, totalRounds: 3 });
      assertEquals(by.algo.membership, { role: "member", status: "active" });
      // 민수(그룹장·담당): IAM·VPC·ALB·AutoScaling·RDS = 2/5. 10/12 에 OPEN 인 미제출 없음(ALB 10/15 시작) → null
      await asUser(q, USERS.민수);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "mine", submitted: 2, assigned: 5, nextTask: null });
      // 그룹장이 과제를 안 하면 team
      await q(`update public.rooms set leader_does_tasks = false where id = 6`);
      await q(`select public.assignment_resync(6)`);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "team", currentRound: { index: 2, label: "2주차", title: "EC2·S3" }, totalRounds: 5 });
      await asUser(q, USERS.서연);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "team", currentRound: { index: 2, label: "2주차", title: "EC2·S3" }, totalRounds: 5 });
      // 철수가 EC2 를 제출하면 10/12 엔 OPEN 미제출이 없어 null, 10/15 에 ALB(10/21)
      await asUser(q, USERS.철수);
      await q(`insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late) values ($1, $2, 'x', now(), false)`, [ec2, USERS.철수]);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals([by.aws.progress.submitted, by.aws.progress.assigned, by.aws.progress.nextTask], [3, 6, null]);
      await setToday(q, "2026-10-15");
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress.nextTask, { nodeId: alb, title: "ALB vs NLB 실습", dueDate: "2026-10-21" });
      await setToday(q, TODAY);
      // 도윤(INACTIVE) 은 mine 이 아니고 team
      await asUser(q, USERS.도윤);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress.kind, "team");
      assertEquals(by.aws.membership, { role: "member", status: "inactive" });
    },
  },
```

② `room_get: me.state matrix …` 사례의 toeic 단언 두 줄(`[r.currentRound, r.rounds, …]`, `r.stats`) →

```ts
      // toeic(RECRUIT, 시드 §3: 8회차 × 공통 2) — 모집중에도 배정 실체화(D4): 서연(그룹장)·도현 × 16 = 32
      assertEquals([r.currentRound, r.rounds.length, r.myProgress, r.invite, r.pendingCount], [null, 8, null, null, 0]);
      assertEquals(r.rounds[0], { id: r.rounds[0].id, label: "1주차", title: "LC Part 1·2", startDate: "2026-11-02", endDate: "2026-11-08", leafCount: 2, assigned: 4, submitted: 0, pct: 0 });
      assertEquals(r.stats, { roundCount: 8, leafCount: 16, commonCount: 16, designatedCount: 0, totalAssignments: 32, totalSubmissions: 0, overallPct: 0, unassignedCount: 0, startWeekdays: [1] });
```

③ `room_get: aws with tree (seedAwsTree 부분 트리) …` 사례 →

```ts
  {
    name: "room_get: aws (시드 §3) — currentRound 2주차 tasks/people, rounds 5/8·1/3·0/4·0/4·0/6, stats 24%, myProgress 2/6 next EC2, 도윤 inactive listed",
    run: async (q) => {
      await setToday(q, TODAY);
      const [{ ec2, s3 }] = await q(`select (select id::text from public.goal_nodes where room_id = 6 and title = 'EC2 인스턴스 유형 정리') as ec2,
                                            (select id::text from public.goal_nodes where room_id = 6 and title = 'S3 스토리지 클래스 발표자료') as s3`);
      await asUser(q, USERS.철수);
      const [{ r }] = await q(`select public.room_get($1) as r`, ["aws"]);
      assertEquals(r.members.map((m: any) => [m.nickname, m.status]),
        [["민수", "active"], ["지은", "active"], ["철수", "active"], ["하나", "active"], ["도윤", "inactive"]]);
      assertEquals(r.rounds.map((x: any) => [x.label, x.leafCount, x.assigned, x.submitted, x.pct]),
        [["1주차", 2, 8, 5, 63], ["2주차", 2, 3, 1, 33], ["3주차", 1, 4, 0, 0], ["4주차", 1, 4, 0, 0], ["5주차", 2, 6, 0, 0]]);
      assertEquals([r.currentRound.label, r.currentRound.title, r.currentRound.startDate, r.currentRound.endDate], ["2주차", "EC2·S3", "2026-10-08", "2026-10-14"]);
      assertEquals(r.currentRound.tasks.map((x: any) => [x.id, x.title, x.type, x.startDate, x.endDate, x.people.map((p: any) => `${p.nickname}:${p.status}`).sort()]), [
        [ec2, "EC2 인스턴스 유형 정리", "designated", "2026-10-08", "2026-10-14", ["지은:done", "철수:open"]],
        [s3, "S3 스토리지 클래스 발표자료", "designated", "2026-10-10", "2026-10-14", ["하나:open"]],
      ]);
      assertEquals(r.stats, { roundCount: 5, leafCount: 8, commonCount: 5, designatedCount: 3, totalAssignments: 25, totalSubmissions: 6, overallPct: 24, unassignedCount: 0, startWeekdays: [4] });
      // 철수 2/6 = 33% (방 목록 슬롯과 같은 값, D5), 다음 마감은 OPEN 인 EC2
      assertEquals(r.myProgress, { submitted: 2, assigned: 6, nextDue: { nodeId: ec2, title: "EC2 인스턴스 유형 정리", roundLabel: "2주차", dueDate: "2026-10-14" } });
      // 1주차 안(10/05)에서 보면 current 가 1주차 — IAM(10/01–10/03) 은 이미 마감: 하나 missed
      await setToday(q, "2026-10-05");
      const [{ r2 }] = await q(`select public.room_get($1) as r2`, ["aws"]);
      assertEquals(r2.currentRound.label, "1주차");
      assertEquals(r2.currentRound.tasks[0].people.map((p: any) => `${p.nickname}:${p.status}`).sort(), ["민수:done", "지은:late", "철수:done", "하나:missed"].sort());
      // 시작 전이면 null
      await setToday(q, "2026-09-30");
      assertEquals((await q(`select public.room_get($1) as r3`, ["aws"]))[0].r3.currentRound, null);
      // 비로그인은 집계는 보되 myProgress 없음
      await setToday(q, TODAY);
      await asAnon(q);
      const [{ an }] = await q(`select public.room_get($1) as an`, ["aws"]);
      assertEquals([an.me, an.myProgress, an.rounds.length, an.currentRound.tasks.length], [null, null, 5, 2]);
    },
  },
```

마지막으로 `_cases-rooms.ts` 에서 `seedAwsTree` 함수와 그 위 JSDoc 을 지운다(더 이상 호출하는 곳이 없고, 남겨 두면 시드 위에 회차를 중복으로 붙인다).

Run: `npm run test:db`
Expected: 플랜 01 46 + 플랜 02 29(`rooms:` 22 · `membership:` 7) + 이 플랜 progress 10 전부 PASS. 철수 aws `2/6`, 민수 `2/5`, react `{4, 8}`, algo `68/78·3`, toeic rounds 8 이 위 값과 다르면 시드 §3 의 트리·코드가 PLANS 와 다른 것 — 시드를 고친다(기대값을 맞추지 않는다).

- [ ] **Step 6: 로컬 Supabase 로 실측(선택, 메모리 확인 후)**

Run:
```bash
vm_stat | grep -E 'free|compressor'
npm run db:reset
```
Expected: `Seeding data from supabase/seed.sql` 뒤 오류 없음. Studio 에서 `select count(*) from goal_nodes` = 14(aws)+11(spring)+13(sqld)+16(algo)+24(react)+24(toeic)+36(cs)+14(docker)+8(jcg) = 160. `select current_setting('app.today')` = `2026-10-12`(seed 마지막 줄, 새 연결에서).

- [ ] **Step 7: Commit**

```bash
git add supabase/seed.sql supabase/tests/progress-sql.test.ts supabase/tests/_cases-rooms.ts
git commit -m "feat(db): seed §3 curriculum trees, submissions, regression values; rewrite plan 02 tree cases to seed values

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 3: `curriculum_json` · `curriculum_get` (03-api §4 Curriculum/NodeDto)

**Files:**
- Modify: `supabase/migrations/0006_curriculum.sql` (끝에 추가)
- Create: `supabase/tests/curriculum-sql.test.ts`

**Interfaces:**
- Consumes: Task 1 `room_progress`, 플랜 01 `person_json`·`task_code`·`leaf_state`·`kst_today`·`iso`, 플랜 02 `room_readable`.
- Produces: `curriculum_json(p_room bigint, p_uid uuid, p_include_archived boolean) returns jsonb`(내부·GRANT 없음, Task 4~6 의 쓰기 함수가 반환값으로 쓴다), `curriculum_get(p_slug text, p_include_archived boolean default false) returns jsonb`(공개 RPC, `anon, authenticated`). JSON 모양:
  ```ts
  { today, room: { slug, status, leaderDoesTasks },
    members: (Person & { role, status: "active"|"inactive", doesTasks })[],      // 그룹장 먼저, joined_at 순
    nodes: NodeDto[],                                                             // 전위(pre-order), sort_order 순
    stats: { overallPct, leafCount, unassignedCount } }
  NodeDto = { id, parentId, roundId, depth, sortOrder, label, title, descriptionMd, startDate, endDate, archived,
              assigned, submitted, pct, task: { type, people: (Person & {status})[], assigned, submitted, state } | null }
  ```
  `people` 는 `p_uid` 가 그룹장·멤버(ACTIVE·INACTIVE·PENDING)일 때만 채우고 그 외(비로그인·비멤버)는 `[]`(D7, mystudy §7-20). 순서 = 멤버 순서(그룹장, joined_at, id).

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/curriculum-sql.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { mkLeaf, mkRoom, mkRound, nodeByTitle, roomId, submit, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

type Node = Record<string, any>;
const get = async (q: Parameters<typeof uid>[0], slug: string, archived = false) =>
  (await q("select public.curriculum_get($1, $2) as c", [slug, archived]))[0].c as Record<string, any>;
const peopleOf = (n: Node) => Object.fromEntries((n.task.people as Node[]).map((p) => [p.nickname, p.status]));

sqlTest("curriculum_get(aws): 전위 순서·집계·IAM people(민수 done 지은 late 철수 done 하나 missed)·stats", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  const c = await get(q, "aws");
  assertEquals(c.today, TODAY);
  assertEquals(c.room, { slug: "aws", status: "active", leaderDoesTasks: true });
  assertEquals(c.members[0].nickname, "민수");                                   // 그룹장 먼저
  assertEquals(c.members.map((m: Node) => [m.nickname, m.role, m.status, m.doesTasks]).sort(),
    [["민수", "leader", "active", true], ["지은", "member", "active", true], ["철수", "member", "active", true], ["하나", "member", "active", true], ["도윤", "member", "inactive", false]].sort());
  const titles = c.nodes.map((n: Node) => n.title);
  assertEquals(titles, ["IAM·VPC", "IAM 정책 이해", "VPC 실습", "EC2·S3", "EC2 인스턴스 유형 정리", "S3 스토리지 클래스 발표자료",
    "고가용성 아키텍처", "로드밸런서 비교", "ALB vs NLB 실습", "오토스케일링", "Auto Scaling 정책 정리", "데이터베이스", "RDS·Aurora 비교", "DynamoDB 설계 퀴즈"]);
  const iam = c.nodes[1];
  assertEquals([iam.depth, iam.parentId, iam.roundId, iam.sortOrder, iam.label, iam.archived], [3, c.nodes[0].id, c.nodes[0].id, 0, null, false]);
  assertEquals([iam.startDate, iam.endDate, iam.assigned, iam.submitted, iam.pct], ["2026-10-01", "2026-10-03", 4, 3, 75]);
  assertEquals(iam.task.type, "common");
  assertEquals(iam.task.state, "delayed");                       // sub<asg, e<today
  assertEquals(peopleOf(iam), { 민수: "done", 지은: "late", 철수: "done", 하나: "missed" });
  assertEquals(iam.task.people.map((p: Node) => p.nickname), ["민수", "지은", "철수", "하나"]);
  assertEquals(typeof iam.task.people[0].userId, "string");
  assertEquals(iam.task.people[0].tone, "mint");
  const ec2 = c.nodes[4];
  assertEquals([ec2.task.type, ec2.task.state], ["designated", "progress"]);
  assertEquals(peopleOf(ec2), { 지은: "done", 철수: "open" });
  const alb = c.nodes[8];
  assertEquals([alb.depth, alb.roundId === c.nodes[6].id, alb.task.state], [4, true, "planned"]);
  assertEquals(c.nodes[0].task, null);
  assertEquals([c.nodes[0].assigned, c.nodes[0].submitted, c.nodes[0].pct], [8, 5, 63]);
  assertEquals(c.nodes[0].descriptionMd, "");
  assertEquals(c.stats, { overallPct: 24, leafCount: 8, unassignedCount: 0 });
}));

sqlTest("curriculum_get: 비로그인·비멤버는 people=[] (집계는 보임), 대기자는 people 보임, 비공개 방 비멤버는 ROOM_NOT_FOUND", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asAnon(q);
  let c = await get(q, "aws");
  assertEquals(c.members.length, 5);
  assertEquals(c.nodes[1].task.people, []);
  assertEquals([c.nodes[1].assigned, c.nodes[1].submitted], [4, 3]);
  await asUser(q, await uid(q, "서연"));                          // 로그인했지만 aws 비멤버
  c = await get(q, "aws");
  assertEquals(c.nodes[1].task.people, []);
  await asUser(q, await uid(q, "철수"));                          // sqld PENDING
  c = await get(q, "sqld");
  assertEquals(c.room.leaderDoesTasks, false);
  assertEquals(c.members, [{ ...c.members[0], role: "leader", status: "active", doesTasks: false }]);
  assertEquals(c.stats, { overallPct: null, leafCount: 9, unassignedCount: 1 });
  assertEquals(c.nodes.filter((n: Node) => n.task).every((n: Node) => n.task.people.length === 0 && n.task.state === "unassigned"), true);
  assertEquals((await get(q, "spring")).room.slug, "spring");   // 비공개지만 철수는 멤버
  await asUser(q, await uid(q, "서연"));
  await expectFail(q("select public.curriculum_get($1, false)", ["spring"]), "ROOM_NOT_FOUND");   // 비공개 + 비멤버
  await expectFail(q("select public.curriculum_get($1, false)", ["no-such"]), "ROOM_NOT_FOUND");
}));

sqlTest("curriculum_get: includeArchived 기본 false — 보관 서브트리는 빠지고 true 면 archived=true 로 포함, 집계는 항상 제외", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await roomId(q, "aws");
  const w1 = await nodeByTitle(q, room, "IAM·VPC");
  await asUser(q, await uid(q, "민수"));
  await q("update public.goal_nodes set archived_at = now() where id in (select public.node_subtree($1))", [w1]);
  await q("select public.assignment_resync($1)", [room]);
  let c = await get(q, "aws");
  assertEquals(c.nodes.map((n: Node) => n.title).includes("IAM 정책 이해"), false);
  assertEquals(c.stats, { overallPct: 6, leafCount: 6, unassignedCount: 0 });     // 1/17, 리프 8 - 2
  c = await get(q, "aws", true);
  const iam = c.nodes.find((n: Node) => n.title === "IAM 정책 이해");
  assertEquals([iam.archived, iam.assigned, iam.submitted, iam.pct, iam.task.people, iam.task.state], [true, 0, 0, null, [], "unassigned"]);
  assertEquals(c.nodes[0].title, "IAM·VPC");
}));

sqlTest("curriculum_get: 빈 방은 nodes=[], stats null/0", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");
  const c = await get(q, room.slug);
  assertEquals(c.nodes, []);
  assertEquals(c.stats, { overallPct: null, leafCount: 0, unassignedCount: 0 });
  assertEquals(c.members.length, 1);
}));
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "curriculum_get"`
Expected: FAIL — `function public.curriculum_get(text, boolean) does not exist`.

- [ ] **Step 3: 0006 에 추가**

```sql
-- ───────── Curriculum JSON (03-api §4) ─────────
create or replace function public.curriculum_json(p_room bigint, p_uid uuid, p_include_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  v_today   date := public.kst_today();
  v_people  boolean;     -- people 노출: 그룹장 | ACTIVE·INACTIVE·PENDING 멤버
  v_members jsonb;
  v_nodes   jsonb;
  v_stats   jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_people := p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')));

  select coalesce(jsonb_agg(
           public.person_json(m.user_id) || jsonb_build_object(
             'role', lower(m.role), 'status', lower(m.status),
             'doesTasks', m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks))
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  into v_members
  from public.room_members m
  where m.room_id = p_room and m.status in ('ACTIVE', 'INACTIVE');

  with recursive t as (
    select n.*, array[n.sort_order::bigint, n.id] as path
    from public.goal_nodes n where n.room_id = p_room and n.parent_id is null
    union all
    select c.*, t.path || array[c.sort_order::bigint, c.id]
    from public.goal_nodes c join t on c.parent_id = t.id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id::text, 'parentId', t.parent_id::text, 'roundId', t.round_id::text,
           'depth', t.depth, 'sortOrder', t.sort_order, 'label', t.label, 'title', t.title,
           'descriptionMd', t.description_md,
           'startDate', to_char(t.start_date, 'YYYY-MM-DD'), 'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
           'archived', t.archived_at is not null,
           'assigned', p.asg, 'submitted', p.sub, 'pct', p.pct,
           'task', case when t.task_type is null then null else jsonb_build_object(
             'type', lower(t.task_type),
             'assigned', p.asg, 'submitted', p.sub,
             'state', public.leaf_state(p.asg, p.sub, t.start_date, t.end_date, v_today),
             'people', case when not v_people then '[]'::jsonb else coalesce((
               select jsonb_agg(public.person_json(a.user_id)
                        || jsonb_build_object('status', public.task_code(t.start_date, t.end_date, s.first_submitted_at, s.is_late, v_today))
                        order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id)
               from public.task_assignments a
               join public.room_members m on m.room_id = p_room and m.user_id = a.user_id
               left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
               where a.node_id = t.id and a.released_at is null and t.archived_at is null), '[]'::jsonb) end) end)
           order by t.path), '[]'::jsonb)
  into v_nodes
  from t join public.room_progress(p_room) p on p.node_id = t.id
  where p_include_archived or t.archived_at is null;

  select jsonb_build_object(
    'overallPct', public.pct(coalesce(sum(p.asg), 0)::int, coalesce(sum(p.sub), 0)::int),
    'leafCount', count(*),
    'unassignedCount', count(*) filter (where n.task_type = 'DESIGNATED' and p.asg = 0))
  into v_stats
  from public.goal_nodes n join public.room_progress(p_room) p on p.node_id = n.id
  where n.room_id = p_room and n.task_type is not null and n.archived_at is null;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'room', jsonb_build_object('slug', r.slug, 'status', lower(r.status), 'leaderDoesTasks', r.leader_does_tasks),
    'members', v_members, 'nodes', v_nodes, 'stats', v_stats);
end $$;
-- curriculum_json 은 임의 p_uid 를 받는 내부 빌더 — GRANT 없음(D7)

-- 공개 RPC. 비공개 방 비멤버·보관 방 비멤버는 ROOM_NOT_FOUND (D7)
create or replace function public.curriculum_get(p_slug text, p_include_archived boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); v_room bigint;
begin
  select id into v_room from public.rooms where slug = p_slug;
  if v_room is null or not public.room_readable(v_room, v_uid) then
    perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요');
  end if;
  return public.curriculum_json(v_room, v_uid, coalesce(p_include_archived, false));
end $$;

grant execute on function public.curriculum_get(text, boolean) to anon, authenticated;
```

`parent_id::text` 가 null 이면 `jsonb_build_object` 는 JSON `null` 을 넣는다(`parentId: null`) — 회차의 기대값과 일치. `path` 의 `sort_order` 가 형제끼리 같아도(손상 데이터) `id` 로 안정 정렬된다.

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "curriculum_get"`
Expected: 4 사례 PASS. `overallPct: 6` 은 1/17(IAM·VPC 보관 뒤 EC2 1/3 + 나머지 0/14) = 5.88 → 6.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_curriculum.sql supabase/tests/curriculum-sql.test.ts
git commit -m "feat(db): curriculum_json / curriculum_get

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 4: `node_create` · `node_delete` · `node_archive` · `node_unarchive`

**Files:**
- Modify: `supabase/migrations/0006_curriculum.sql` (끝에 추가)
- Modify: `supabase/tests/curriculum-sql.test.ts` (사례 추가)

**Interfaces:**
- Consumes: Task 1 헬퍼 4개, Task 3 `curriculum_json`, 플랜 02 `assignment_resync`.
- Produces: `node_create(p_slug, p_parent_id, p_title, p_label, p_task_type, p_start_date, p_end_date, p_index) returns jsonb`, `node_delete(p_slug, p_node_id)`, `node_archive(p_slug, p_node_id)`, `node_unarchive(p_slug, p_node_id)` — 전부 편집용 Curriculum(보관 포함) 반환. 규칙: 회차 기본값 `title='새 회차'`, `label='{n}주차'`, `start=마지막 회차 end+1`(없으면 방 start), `end=start+6`, `taskType` 이 없으면 빈 부모·있으면 회차 자체가 과제인 **depth-2 리프**(A7 — `node_move` 로 리프가 회차가 될 때와 같은 모양); 하위 기본값 `title='새 과제'`, `taskType=common`, 기간=부모, 맨 뒤. 제출물 없는 리프 아래에 자식을 만들면 그 리프는 부모로 전환(`task_type=null`, 배정 released). 제출물 있으면 `NODE_HAS_SUBMISSIONS`. 부모 depth 5 → `NODE_DEPTH_EXCEEDED`. 보관된 부모 → `PARENT_ARCHIVED`. 삭제는 서브트리에 제출물이 없을 때만, 형제 `sort_order` 0..n-1 재부여. 보관/해제는 서브트리 전파, 부모가 보관 중이면 해제 불가 `PARENT_ARCHIVED`. 보관하면 resync 가 COMMON·DESIGNATED 배정을 모두 해제하고(`released_at = archived_at`, D13 — Storage 업로드도 막힘), 해제하면 COMMON 은 resync 가, DESIGNATED 는 `released_at = 그 리프의 archived_at` 인 행만 `node_unarchive` 가 되살린다. 권한: 네 함수 모두 `authenticated`.

- [ ] **Step 1: 실패하는 테스트 — `curriculum-sql.test.ts` 끝에 추가**

```ts
const call = (q: Parameters<typeof uid>[0], fn: string, args: unknown[]) =>
  q(`select public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as c`, args).then((r) => r[0].c as Record<string, any>);
const byTitle = (c: Record<string, any>, title: string): Node => c.nodes.find((n: Node) => n.title === title);

sqlTest("node_create(회차): 기본값 label/title/기간, index 로 앞에 끼우기, 회차는 빈 부모(task=null)", withCase(db, async (q) => {
  const room = await mkRoom(q, "서연");                              // 2026-11-01 ~ 11-28
  let c = await call(q, "node_create", [room.slug]);
  assertEquals(c.nodes.length, 1);
  assertEquals([c.nodes[0].label, c.nodes[0].title, c.nodes[0].startDate, c.nodes[0].endDate, c.nodes[0].depth, c.nodes[0].task, c.nodes[0].sortOrder],
    ["1주차", "새 회차", "2026-11-01", "2026-11-07", 2, null, 0]);
  assertEquals(c.nodes[0].roundId, c.nodes[0].id);
  c = await call(q, "node_create", [room.slug, null, "두 번째", "OT"]);
  assertEquals([c.nodes[1].label, c.nodes[1].title, c.nodes[1].startDate, c.nodes[1].endDate], ["OT", "두 번째", "2026-11-08", "2026-11-14"]);
  c = await q(`select public.node_create($1, null, '앞', null, null, '2026-10-30'::date, null, 0) as c`, [room.slug]).then((r) => r[0].c);
  assertEquals(c.nodes.map((n: Node) => [n.title, n.sortOrder]), [["앞", 0], ["새 회차", 1], ["두 번째", 2]]);
  assertEquals([c.nodes[0].label, c.nodes[0].endDate], ["3주차", "2026-11-05"]);     // label 은 "회차 수+1", end = start+6
  // 공백만 있는 제목은 trim 뒤 빈 문자열 → 기본값 '새 회차'(UI 에서 제목 비우고 추가). 81자는 INVALID_TITLE
  c = await q(`select public.node_create($1, null, '   ') as c`, [room.slug]).then((r) => r[0].c);
  assertEquals(c.nodes[3].title, "새 회차");
  await expectFail(q(`select public.node_create($1, null, $2)`, [room.slug, "가".repeat(81)]), "INVALID_TITLE");
  await expectFail(q(`select public.node_create($1, null, 'x', null, null, '2026-11-10'::date, '2026-11-09'::date)`, [room.slug]), "INVALID_PERIOD");
  // 회차에 taskType → 회차 자체가 과제인 depth-2 리프(A7). 잘못된 값은 VALIDATION_FAILED
  c = await q(`select public.node_create($1, null, '회차 과제', null, 'common') as c`, [room.slug]).then((r) => r[0].c);
  const rl = byTitle(c, "회차 과제");
  assertEquals([rl.depth, rl.label, rl.roundId === rl.id, rl.task.type, rl.task.assigned], [2, "5주차", true, "common", 1]);
  await expectFail(q(`select public.node_create($1, null, 'x', null, 'weird')`, [room.slug]), "VALIDATION_FAILED");
  await asUser(q, await uid(q, "민수"));
  await expectFail(q(`select public.node_create($1)`, [room.slug]), "NOT_LEADER");
}));

sqlTest("node_create(하위): 기본값·부모 기간 상속·resync, 리프→부모 전환, 제출물 있는 리프·깊이 6·보관 부모는 거부", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const room = await mkRoom(q, "서연");
  let c = await call(q, "node_create", [room.slug]);
  const round = c.nodes[0].id;
  c = await call(q, "node_create", [room.slug, round]);
  const leaf = byTitle(c, "새 과제");
  assertEquals([leaf.depth, leaf.parentId, leaf.roundId, leaf.startDate, leaf.endDate, leaf.task.type, leaf.sortOrder], [3, round, round, "2026-11-01", "2026-11-07", "common", 0]);
  assertEquals([leaf.task.assigned, leaf.task.people.length], [1, 1]);          // 그룹장 서연 자동 배정(resync)
  c = await q(`select public.node_create($1, $2, '지정', null, 'designated', '2026-11-02'::date, '2026-11-03'::date, 0) as c`, [room.slug, round]).then((r) => r[0].c);
  assertEquals(c.nodes.slice(1).map((n: Node) => [n.title, n.sortOrder]), [["지정", 0], ["새 과제", 1]]);
  assertEquals(byTitle(c, "지정").task, { ...byTitle(c, "지정").task, type: "designated", assigned: 0, state: "unassigned" });
  // 제출물 없는 리프 아래 자식 → 리프가 부모로 전환되고 배정 released
  c = await call(q, "node_create", [room.slug, leaf.id, "손자"]);
  const conv = byTitle(c, "새 과제");
  assertEquals([conv.task, byTitle(c, "손자").depth, byTitle(c, "손자").roundId], [null, 4, round]);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null", [leaf.id]))[0].n, 0);
  // 깊이: 4 → 5 는 되고, 5 아래는 NODE_DEPTH_EXCEEDED
  c = await call(q, "node_create", [room.slug, byTitle(c, "손자").id, "증손"]);
  assertEquals(byTitle(c, "증손").depth, 5);
  await expectFail(q(`select public.node_create($1, $2)`, [room.slug, byTitle(c, "증손").id]), "NODE_DEPTH_EXCEEDED");
  await expectFail(q(`select public.node_create($1, $2, 'x', null, 'weird')`, [room.slug, round]), "VALIDATION_FAILED");
  await expectFail(q(`select public.node_create($1, $2, 'x', '라벨')`, [room.slug, round]), "VALIDATION_FAILED");  // 하위엔 label 불가
  await expectFail(q(`select public.node_create($1, 999999)`, [room.slug]), "NODE_NOT_FOUND");
  // 제출물 있는 리프(aws IAM) 아래 자식 → NODE_HAS_SUBMISSIONS
  const aws = await roomId(q, "aws");
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  await asUser(q, await uid(q, "민수"));
  await expectFail(q(`select public.node_create($1, $2)`, ["aws", iam]), "NODE_HAS_SUBMISSIONS");
  // 보관된 부모 아래 → PARENT_ARCHIVED
  const w4 = await nodeByTitle(q, aws, "오토스케일링");
  await call(q, "node_archive", ["aws", w4]);
  await expectFail(q(`select public.node_create($1, $2)`, ["aws", w4]), "PARENT_ARCHIVED");
  // 다른 방의 노드 id → NODE_NOT_FOUND, 종료 방 → ROOM_NOT_EDITABLE
  await asUser(q, await uid(q, "현우"));
  await expectFail(q(`select public.node_create($1, $2)`, ["algo", w4]), "ROOM_NOT_EDITABLE");
}));

sqlTest("node_delete: 서브트리에 제출물이 있으면 NODE_HAS_SUBMISSIONS, 없으면 cascade + 형제 재정렬", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const w1 = await nodeByTitle(q, aws, "IAM·VPC");
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  await expectFail(call(q, "node_delete", ["aws", iam]), "NODE_HAS_SUBMISSIONS");
  await expectFail(call(q, "node_delete", ["aws", w1]), "NODE_HAS_SUBMISSIONS");      // 회차도 하위 제출물 때문에 불가
  const w3 = await nodeByTitle(q, aws, "고가용성 아키텍처");                             // 3주차: 중간 노드 + 리프, 제출물 없음
  const alb = await nodeByTitle(q, aws, "ALB vs NLB 실습");
  const c = await call(q, "node_delete", ["aws", w3]);
  assertEquals(c.nodes.filter((n: Node) => n.depth === 2).map((n: Node) => [n.label, n.sortOrder]), [["1주차", 0], ["2주차", 1], ["4주차", 2], ["5주차", 3]]);
  assertEquals((await q("select count(*)::int as n from public.goal_nodes where id in ($1, $2)", [w3, alb]))[0].n, 0);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1", [alb]))[0].n, 0);
  assertEquals(c.stats, { overallPct: 29, leafCount: 7, unassignedCount: 0 });    // 6/21, 리프 8 → 7
  await expectFail(call(q, "node_delete", ["aws", w3]), "NODE_NOT_FOUND");
  await asUser(q, await uid(q, "철수"));
  await expectFail(call(q, "node_delete", ["aws", iam]), "NOT_LEADER");
}));

sqlTest("node_archive/unarchive: 서브트리 전파, 집계·배정 제외/복구(is_late 보존), 부모 보관 중이면 PARENT_ARCHIVED", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const w1 = await nodeByTitle(q, aws, "IAM·VPC");
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  const vpc = await nodeByTitle(q, aws, "VPC 실습");
  let c = await call(q, "node_archive", ["aws", w1]);
  assertEquals([byTitle(c, "IAM·VPC").archived, byTitle(c, "IAM 정책 이해").archived, byTitle(c, "VPC 실습").archived], [true, true, true]);
  assertEquals(c.stats, { overallPct: 6, leafCount: 6, unassignedCount: 0 });      // 1/17, 리프 8 - 2
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id in ($1, $2) and released_at is null", [iam, vpc]))[0].n, 0);
  assertEquals((await q("select count(*)::int as n from public.submissions where node_id = $1", [iam]))[0].n, 4);   // 민수·지은·철수 + 도윤(이탈) 제출물 보존
  await expectFail(call(q, "node_unarchive", ["aws", iam]), "PARENT_ARCHIVED");
  c = await call(q, "node_archive", ["aws", w1]);                                   // 멱등
  assertEquals(byTitle(c, "IAM·VPC").archived, true);
  c = await call(q, "node_unarchive", ["aws", w1]);
  assertEquals([byTitle(c, "IAM·VPC").archived, byTitle(c, "IAM 정책 이해").archived], [false, false]);
  assertEquals(c.stats.overallPct, 24);
  assertEquals(peopleOf(byTitle(c, "IAM 정책 이해")), { 민수: "done", 지은: "late", 철수: "done", 하나: "missed" });
  // 리프 하나만 보관하면 그 리프만
  c = await call(q, "node_archive", ["aws", vpc]);
  assertEquals([byTitle(c, "VPC 실습").archived, byTitle(c, "IAM 정책 이해").archived, byTitle(c, "IAM·VPC").assigned], [true, false, 4]);
  // D13: 지정 리프 보관 → DESIGNATED 행도 해제(업로드 차단), 해제하면 같은 담당자로 복구
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
  const [지은, 철수] = [await uid(q, "지은"), await uid(q, "철수")];
  await call(q, "node_archive", ["aws", ec2]);
  assertEquals((await q("select public.is_task_assignee($1, $2::uuid) as b", [ec2, 철수]))[0].b, false);
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null", [ec2]))[0].n, 0);
  c = await call(q, "node_unarchive", ["aws", ec2]);
  assertEquals(peopleOf(byTitle(c, "EC2 인스턴스 유형 정리")), { 지은: "done", 철수: "open" });
  assertEquals((await q("select public.is_task_assignee($1, $2::uuid) as b", [ec2, 지은]))[0].b, true);
}));
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "node_"`
Expected: 새 사례 4개 FAIL — `function public.node_create(text) does not exist` 등.

- [ ] **Step 3: 0006 에 추가**

```sql
-- ───────── node_create (03-api §4 기본값, mystudy E1·E2) ─────────
create or replace function public.node_create(
  p_slug text, p_parent_id bigint default null, p_title text default null, p_label text default null,
  p_task_type text default null, p_start_date date default null, p_end_date date default null, p_index int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r        public.rooms;
  p        public.goal_nodes;
  v_uid    uuid;
  v_id     bigint;
  v_depth  int;
  v_round  bigint;
  v_title  text := nullif(trim(coalesce(p_title, '')), '');
  v_label  text := nullif(trim(coalesce(p_label, '')), '');
  v_type   text;
  v_s      date;
  v_e      date;
  v_n      int;
  v_idx    int;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();

  if p_parent_id is null then
    -- 회차: taskType 이 없으면 빈 부모(자식을 달아야 과제가 된다), 있으면 회차 자체가 과제인 depth-2 리프(A7)
    v_type := case when p_task_type is null then null else upper(p_task_type) end;
    if v_type is not null and v_type not in ('COMMON', 'DESIGNATED') then
      perform public.fail('VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', '{"field":"taskType"}'::jsonb);
    end if;
    select count(*)::int, max(end_date) + 1 into v_n, v_s from public.goal_nodes where room_id = r.id and parent_id is null;
    v_depth := 2;
    v_title := coalesce(v_title, '새 회차');
    v_label := coalesce(v_label, (v_n + 1) || '주차');
    v_s     := coalesce(p_start_date, v_s, r.start_date);
    v_e     := coalesce(p_end_date, v_s + 6);
  else
    p := public.node_get(r.id, p_parent_id);
    if p.archived_at is not null then
      perform public.fail('PARENT_ARCHIVED', '보관된 항목 아래에는 추가할 수 없어요', jsonb_build_object('nodeId', p.id::text));
    end if;
    if p.depth >= 5 then
      perform public.fail('NODE_DEPTH_EXCEEDED', '최대 5단계까지만 만들 수 있어요', jsonb_build_object('nodeId', p.id::text));
    end if;
    if v_label is not null then
      perform public.fail('VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', '{"field":"label"}'::jsonb);
    end if;
    if p.task_type is not null then
      -- 리프 → 부모 전환 (I1). 제출물이 있으면 불가
      if public.node_has_submissions(p.id) then
        perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 과제 아래에는 추가할 수 없어요. 보관해 주세요', jsonb_build_object('nodeId', p.id::text));
      end if;
      update public.goal_nodes set task_type = null, updated_at = now() where id = p.id;
      update public.task_assignments set released_at = now() where node_id = p.id and released_at is null;
    end if;
    select count(*)::int into v_n from public.goal_nodes where parent_id = p.id;
    v_depth := p.depth + 1;
    v_round := p.round_id;
    v_title := coalesce(v_title, '새 과제');
    v_type  := upper(coalesce(p_task_type, 'common'));
    if v_type not in ('COMMON', 'DESIGNATED') then
      perform public.fail('VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', '{"field":"taskType"}'::jsonb);
    end if;
    v_s := coalesce(p_start_date, p.start_date);
    v_e := coalesce(p_end_date, p.end_date);
  end if;

  if length(v_title) > 80 then perform public.fail('INVALID_TITLE', '제목은 1~80자예요', '{"field":"title"}'::jsonb); end if;
  if v_label is not null and length(v_label) > 20 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 20자까지예요', '{"field":"label"}'::jsonb); end if;
  if v_s > v_e then perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb); end if;

  v_idx := least(greatest(coalesce(p_index, v_n), 0), v_n);
  update public.goal_nodes set sort_order = sort_order + 1
  where room_id = r.id and parent_id is not distinct from p_parent_id and sort_order >= v_idx;

  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, label, title, start_date, end_date, task_type)
  values (r.id, p_parent_id, v_round, v_depth, v_idx, v_label, v_title, v_s, v_e, v_type)
  returning id into v_id;
  if p_parent_id is null then update public.goal_nodes set round_id = v_id where id = v_id; end if;

  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- ───────── node_delete (E8) ─────────
create or replace function public.node_delete(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if public.node_has_submissions(n.id) then
    perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 항목은 삭제할 수 없어요. 보관해 주세요', jsonb_build_object('nodeId', n.id::text));
  end if;
  delete from public.goal_nodes where id = n.id;          -- parent_id cascade 로 서브트리·배정 삭제
  update public.goal_nodes g set sort_order = s.rn - 1
  from (select id, row_number() over (order by sort_order, id) as rn
        from public.goal_nodes where room_id = r.id and parent_id is not distinct from n.parent_id) s
  where g.id = s.id;
  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- ───────── node_archive / node_unarchive (E9·E10, I5) ─────────
create or replace function public.node_archive(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  update public.goal_nodes set archived_at = now(), updated_at = now()
  where id in (select public.node_subtree(n.id)) and archived_at is null;
  perform public.assignment_resync(r.id);                  -- 보관 리프의 COMMON·DESIGNATED 행 released (released_at = archived_at, D13)
  return public.curriculum_json(r.id, v_uid, true);
end $$;

create or replace function public.node_unarchive(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if n.parent_id is not null and exists (select 1 from public.goal_nodes p where p.id = n.parent_id and p.archived_at is not null) then
    perform public.fail('PARENT_ARCHIVED', '상위 항목이 보관 중이에요. 상위 항목을 먼저 해제해 주세요', jsonb_build_object('nodeId', n.parent_id::text));
  end if;
  -- 보관 때문에 풀린 DESIGNATED 행만 되살린다: resync 가 released_at = 리프의 archived_at 으로 찍어 두었다(D13)
  update public.task_assignments a set released_at = null
  from public.goal_nodes g
  where g.id = a.node_id and g.id in (select public.node_subtree(n.id)) and g.archived_at is not null
    and a.source = 'DESIGNATED' and a.released_at = g.archived_at;
  update public.goal_nodes set archived_at = null, updated_at = now()
  where id in (select public.node_subtree(n.id)) and archived_at is not null;
  perform public.assignment_resync(r.id);                  -- COMMON 행 복구, 그사이 ACTIVE 가 아니게 된 담당자의 DESIGNATED 는 다시 해제
  return public.curriculum_json(r.id, v_uid, true);
end $$;

grant execute on function public.node_create(text, bigint, text, text, text, date, date, int) to authenticated;
grant execute on function public.node_delete(text, bigint)    to authenticated;
grant execute on function public.node_archive(text, bigint)   to authenticated;
grant execute on function public.node_unarchive(text, bigint) to authenticated;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "node_"`
Expected: 4 사례 PASS. `node_delete` 사례의 `overallPct: 29` 는 3주차(0/4) 삭제 후 6/21 = 28.57 → 29.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_curriculum.sql supabase/tests/curriculum-sql.test.ts
git commit -m "feat(db): node_create / node_delete / node_archive / node_unarchive

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 5: `node_update` — 내용 변경 1회 PATCH · 담당자 · 경고 · 알림 호출

**Files:**
- Modify: `supabase/migrations/0006_curriculum.sql` (끝에 추가)
- Modify: `supabase/tests/curriculum-sql.test.ts` (사례 추가)

**Interfaces:**
- Consumes: Task 1 헬퍼, Task 3 `curriculum_json`, 플랜 02 `notify_publish`(자리표)·`assignment_resync`, (있으면) 플랜 04 `tag_autoselect(p_room bigint)`.
- Produces: `node_update(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb` — Curriculum(보관 포함) + `warnings: {code, nodeId}[]`. `p_patch` 키: `title, descriptionMd, startDate, endDate, label, taskType, assigneeIds`. 규칙: 타입 변경은 리프만(`NODE_NOT_LEAF`), 제출물 있으면 양방향 모두 `NODE_HAS_SUBMISSIONS`; `assigneeIds` 는 결과 타입이 DESIGNATED 일 때만 적용(COMMON 이면 무시), 각 id 는 ACTIVE 멤버(그룹장은 `leader_does_tasks`) 아니면 `ASSIGNEE_NOT_MEMBER`, 제출물 있는 담당자 제거는 `ASSIGNEE_HAS_SUBMISSION`, 0명 허용(경고 `UNASSIGNED_TASK`); 공통→지정 전환에 `assigneeIds` 가 없으면 현재 담당자 승계(E6). 지정 행은 `source='DESIGNATED'`. 방이 ACTIVE 면 기간 변경 → `SCHEDULE_CHANGED`(담당자 전원을 넘긴다 — 행위자 제외는 `notify_publish` 계약), 담당자 추가/제거 → `TASK_ASSIGNED`/`TASK_UNASSIGNED`. 세 알림 모두 행위 이벤트라 prefix 는 `KIND:room:node:` || `txid_current()`(D8 — 해제 후 재배정도 새 알림). `label` 은 회차(depth 2)만, **회차 label 을 null·빈 문자열로 지울 수 없다**(A7 → `VALIDATION_FAILED`). 날짜 형식 오류는 `patch_date` 로 `VALIDATION_FAILED`(D11). `title`/`descriptionMd` 가 바뀌면 `tag_autoselect` 가 존재할 때만 호출. 권한: `authenticated`.

- [ ] **Step 1: 실패하는 테스트 — `curriculum-sql.test.ts` 끝에 추가**

```ts
const upd = (q: Parameters<typeof uid>[0], slug: string, node: string, patch: Record<string, unknown>) =>
  q(`select public.node_update($1, $2, $3::jsonb) as c`, [slug, node, JSON.stringify(patch)]).then((r) => r[0].c as Record<string, any>);

sqlTest("node_update: 제목·설명·기간·라벨, 경고 PERIOD_OUTSIDE_PARENT/ROOM, 검증 오류", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const w1 = await nodeByTitle(q, aws, "IAM·VPC");
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
  let c = await upd(q, "aws", w1, { label: "OT", title: "오리엔테이션", descriptionMd: "# 첫 주" });
  assertEquals([byTitle(c, "오리엔테이션").label, byTitle(c, "오리엔테이션").descriptionMd, c.warnings], ["OT", "# 첫 주", []]);
  c = await upd(q, "aws", ec2, { startDate: "2026-10-09", endDate: "2026-10-13" });
  assertEquals([byTitle(c, "EC2 인스턴스 유형 정리").startDate, byTitle(c, "EC2 인스턴스 유형 정리").endDate, c.warnings], ["2026-10-09", "2026-10-13", []]);
  c = await upd(q, "aws", ec2, { endDate: "2026-10-16" });                               // 부모 2주차는 10-14 까지
  assertEquals(c.warnings, [{ code: "PERIOD_OUTSIDE_PARENT", nodeId: ec2 }]);
  c = await upd(q, "aws", w1, { startDate: "2026-09-30" });                              // 방은 10-01 부터
  assertEquals(c.warnings, [{ code: "PERIOD_OUTSIDE_ROOM", nodeId: w1 }]);
  await expectFail(upd(q, "aws", ec2, { label: "x" }), "VALIDATION_FAILED");             // 리프에 label
  await expectFail(upd(q, "aws", w1, { label: null }), "VALIDATION_FAILED");             // 회차 label 지우기 금지(A7)
  await expectFail(upd(q, "aws", w1, { label: "  " }), "VALIDATION_FAILED");
  await expectFail(upd(q, "aws", ec2, { startDate: "2026-02-30" }), "VALIDATION_FAILED"); // D11: 22008 원문 대신
  await expectFail(upd(q, "aws", ec2, { endDate: 20261014 }), "VALIDATION_FAILED");
  await expectFail(upd(q, "aws", ec2, { nope: 1 }), "VALIDATION_FAILED");
  await expectFail(upd(q, "aws", ec2, { title: "  " }), "INVALID_TITLE");
  await expectFail(upd(q, "aws", ec2, { startDate: "2026-10-20" }), "INVALID_PERIOD");  // start > end(10-16)
  await expectFail(upd(q, "aws", ec2, { descriptionMd: "x".repeat(20001) }), "VALIDATION_FAILED");
  await expectFail(q(`select public.node_update($1, $2, 'null'::jsonb)`, ["aws", ec2]), "VALIDATION_FAILED");
  await asUser(q, await uid(q, "철수"));
  await expectFail(upd(q, "aws", ec2, { title: "x" }), "NOT_LEADER");
}));

sqlTest("node_update(taskType): 제출물 있으면 양방향 NODE_HAS_SUBMISSIONS, 회차는 NODE_NOT_LEAF, 공통→지정은 담당자 승계·source DESIGNATED", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const iam = await nodeByTitle(q, aws, "IAM 정책 이해");
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");
  const w1 = await nodeByTitle(q, aws, "IAM·VPC");
  const alb = await nodeByTitle(q, aws, "ALB vs NLB 실습");
  await expectFail(upd(q, "aws", iam, { taskType: "designated" }), "NODE_HAS_SUBMISSIONS");
  await expectFail(upd(q, "aws", ec2, { taskType: "common" }), "NODE_HAS_SUBMISSIONS");
  await expectFail(upd(q, "aws", w1, { taskType: "common" }), "NODE_NOT_LEAF");
  await expectFail(upd(q, "aws", alb, { taskType: "weird" }), "VALIDATION_FAILED");
  let c = await upd(q, "aws", alb, { taskType: "designated" });
  assertEquals([byTitle(c, "ALB vs NLB 실습").task.type, Object.keys(peopleOf(byTitle(c, "ALB vs NLB 실습"))).sort(), c.warnings], ["designated", ["민수", "지은", "철수", "하나"], []]);
  const src = await q("select source, count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null group by source", [alb]);
  assertEquals(src, [{ source: "DESIGNATED", n: 4 }]);
  c = await upd(q, "aws", alb, { taskType: "common" });
  assertEquals((await q("select source, count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null group by source", [alb])), [{ source: "COMMON", n: 4 }]);
  // 공통 리프의 assigneeIds 는 무시된다
  c = await upd(q, "aws", alb, { assigneeIds: [await uid(q, "철수")] });
  assertEquals(byTitle(c, "ALB vs NLB 실습").task.assigned, 4);
}));

sqlTest("node_update(assigneeIds): 교체·해제·0명 경고, ASSIGNEE_NOT_MEMBER(이탈자·비멤버·leader_does_tasks=false 그룹장), ASSIGNEE_HAS_SUBMISSION", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const s3 = await nodeByTitle(q, aws, "S3 스토리지 클래스 발표자료");    // 지정, 하나 O, 제출 없음
  const ec2 = await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리");         // 지정, 지은 D, 철수 O
  const [지은, 철수, 하나, 도윤, 서연, 민수] = await Promise.all(["지은", "철수", "하나", "도윤", "서연", "민수"].map((n) => uid(q, n)));
  let c = await upd(q, "aws", s3, { assigneeIds: [지은, 철수] });
  assertEquals([peopleOf(byTitle(c, "S3 스토리지 클래스 발표자료")), c.warnings], [{ 지은: "open", 철수: "open" }, []]);
  const rows = await q("select user_id::text as u, source, released_at is null as live from public.task_assignments where node_id = $1 order by id", [s3]);
  assertEquals(rows.map((r) => [r.u, r.source, r.live]).sort(), [[지은, "DESIGNATED", true], [철수, "DESIGNATED", true], [하나, "DESIGNATED", false]].sort());
  c = await upd(q, "aws", s3, { assigneeIds: [] });
  assertEquals([byTitle(c, "S3 스토리지 클래스 발표자료").task.state, c.warnings, c.stats.unassignedCount], ["unassigned", [{ code: "UNASSIGNED_TASK", nodeId: s3 }], 1]);
  c = await upd(q, "aws", s3, { assigneeIds: [하나] });                   // 같은 행 복구
  assertEquals((await q("select count(*)::int as n from public.task_assignments where node_id = $1", [s3]))[0].n, 3);
  await expectFail(upd(q, "aws", s3, { assigneeIds: [도윤] }), "ASSIGNEE_NOT_MEMBER");   // INACTIVE
  await expectFail(upd(q, "aws", s3, { assigneeIds: [서연] }), "ASSIGNEE_NOT_MEMBER");   // 비멤버
  await expectFail(upd(q, "aws", s3, { assigneeIds: ["not-a-uuid"] }), "VALIDATION_FAILED");
  await expectFail(upd(q, "aws", ec2, { assigneeIds: [철수] }), "ASSIGNEE_HAS_SUBMISSION");   // 지은(제출) 제거
  c = await upd(q, "aws", ec2, { assigneeIds: [지은] });                   // 철수(미제출) 제거는 가능
  assertEquals(peopleOf(byTitle(c, "EC2 인스턴스 유형 정리")), { 지은: "done" });
  assertEquals(c.stats.overallPct, 25);                                    // 6/24
  await q("update public.rooms set leader_does_tasks = false where id = $1", [aws]);
  await expectFail(upd(q, "aws", s3, { assigneeIds: [민수] }), "ASSIGNEE_NOT_MEMBER");
}));

sqlTest("node_update: ACTIVE 방 기간 변경·담당자 교체가 알림 호출 경로를 지나도 한 번에 적용된다(0008 전에는 자리표)", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  const s3 = await nodeByTitle(q, aws, "S3 스토리지 클래스 발표자료");
  const [지은, 하나] = [await uid(q, "지은"), await uid(q, "하나")];
  const c = await upd(q, "aws", s3, { endDate: "2026-10-15", assigneeIds: [지은] });
  assertEquals([byTitle(c, "S3 스토리지 클래스 발표자료").endDate, c.warnings], ["2026-10-15", [{ code: "PERIOD_OUTSIDE_PARENT", nodeId: s3 }]]);
  // SCHEDULE_CHANGED·TASK_ASSIGNED(지은)·TASK_UNASSIGNED(하나) 호출 뒤의 상태 — 알림 건수 단언은 0008 을 만드는 플랜 04 몫
  const rows = await q("select user_id::text as u, source, released_at is null as live from public.task_assignments where node_id = $1", [s3]);
  assertEquals(rows.map((x) => [x.u, x.source, x.live]).sort(), [[지은, "DESIGNATED", true], [하나, "DESIGNATED", false]].sort());
}));
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "node_update"`
Expected: 4 사례 FAIL — `function public.node_update(text, bigint, jsonb) does not exist`.

- [ ] **Step 3: 0006 에 추가**

```sql
-- ───────── node_update (E3~E7, I2·I6, D9) ─────────
create or replace function public.node_update(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  n         public.goal_nodes;
  p         public.goal_nodes;
  v_uid     uuid;
  k         text;
  v_title   text;
  v_desc    text;
  v_s       date;
  v_e       date;
  v_label   text;
  v_type    text;
  v_ids     uuid[];          -- null = 담당자 변경 없음
  v_cur     uuid[];
  v_added   uuid[] := '{}';
  v_removed uuid[] := '{}';
  v_bad     uuid;
  v_asg     int;
  v_rcpt    uuid[];
  v_warn    jsonb := '[]'::jsonb;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'descriptionMd', 'startDate', 'endDate', 'label', 'taskType', 'assigneeIds') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;

  -- 제목·설명·기간·라벨
  v_title := case when p_patch ? 'title' then trim(coalesce(p_patch->>'title', '')) else n.title end;
  if v_title is null or length(v_title) < 1 or length(v_title) > 80 then
    perform public.fail('INVALID_TITLE', '제목은 1~80자예요', '{"field":"title"}'::jsonb);
  end if;
  v_desc := coalesce(p_patch->>'descriptionMd', n.description_md);
  if length(v_desc) > 20000 then
    perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb);
  end if;
  v_s := coalesce(public.patch_date(p_patch, 'startDate'), n.start_date);   -- 형식 오류 → VALIDATION_FAILED (D11)
  v_e := coalesce(public.patch_date(p_patch, 'endDate'), n.end_date);
  if v_s > v_e then perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb); end if;
  v_label := n.label;
  if p_patch ? 'label' then
    if n.depth <> 2 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', '{"field":"label"}'::jsonb); end if;
    v_label := nullif(trim(coalesce(p_patch->>'label', '')), '');
    if v_label is null then perform public.fail('VALIDATION_FAILED', '회차 라벨은 비울 수 없어요', '{"field":"label"}'::jsonb); end if;   -- A7
    if length(v_label) > 20 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 20자까지예요', '{"field":"label"}'::jsonb); end if;
  end if;

  -- 과제 유형 (리프만, 제출물 있으면 양방향 불가)
  v_type := n.task_type;
  if p_patch ? 'taskType' then
    if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '하위 항목이 있는 노드에는 과제 유형을 줄 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
    v_type := upper(coalesce(p_patch->>'taskType', ''));
    if v_type not in ('COMMON', 'DESIGNATED') then
      perform public.fail('VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', '{"field":"taskType"}'::jsonb);
    end if;
    if v_type <> n.task_type and public.node_has_submissions(n.id) then
      perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 과제는 유형을 바꿀 수 없어요', jsonb_build_object('nodeId', n.id::text));
    end if;
  end if;

  -- 담당자 (결과 타입이 DESIGNATED 일 때만)
  if v_type = 'DESIGNATED' and p_patch ? 'assigneeIds' then
    if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '하위 항목이 있는 노드에는 담당자를 줄 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
    if jsonb_typeof(p_patch->'assigneeIds') <> 'array' then
      perform public.fail('VALIDATION_FAILED', '담당자 목록이 올바르지 않아요', '{"field":"assigneeIds"}'::jsonb);
    end if;
    begin
      select coalesce(array_agg(distinct x::uuid), '{}') into v_ids from jsonb_array_elements_text(p_patch->'assigneeIds') x;
    exception when invalid_text_representation then
      perform public.fail('VALIDATION_FAILED', '담당자 id 가 올바르지 않아요', '{"field":"assigneeIds"}'::jsonb);
    end;
    select u into v_bad from unnest(v_ids) u
    where not exists (select 1 from public.room_members m
                      where m.room_id = r.id and m.user_id = u and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks))
    limit 1;
    if v_bad is not null then
      perform public.fail('ASSIGNEE_NOT_MEMBER', '활성 참가자만 담당자로 지정할 수 있어요', jsonb_build_object('field', 'assigneeIds', 'userId', v_bad::text));
    end if;
  elsif v_type = 'DESIGNATED' and n.task_type = 'COMMON' then
    -- 공통 → 지정 전환, 담당자 미지정: 전환 직전 담당자 승계 (E6)
    select coalesce(array_agg(user_id), '{}') into v_ids from public.task_assignments where node_id = n.id and released_at is null;
  end if;

  if v_ids is not null then
    select coalesce(array_agg(user_id), '{}') into v_cur from public.task_assignments where node_id = n.id and released_at is null;
    select coalesce(array_agg(u), '{}') into v_removed from unnest(v_cur) u where u <> all(v_ids);
    select coalesce(array_agg(u), '{}') into v_added   from unnest(v_ids) u where u <> all(v_cur);
    select s.user_id into v_bad from public.submissions s where s.node_id = n.id and s.user_id = any(v_removed) limit 1;
    if v_bad is not null then
      perform public.fail('ASSIGNEE_HAS_SUBMISSION', '이미 제출한 담당자는 뺄 수 없어요. 과제를 보관해 주세요', jsonb_build_object('field', 'assigneeIds', 'userId', v_bad::text));
    end if;
    update public.task_assignments set released_at = now()
    where node_id = n.id and released_at is null and user_id = any(v_removed);
    insert into public.task_assignments (node_id, user_id, source)
    select n.id, u, 'DESIGNATED' from unnest(v_ids) u
    on conflict (node_id, user_id) do update set released_at = null, source = 'DESIGNATED';
  end if;

  update public.goal_nodes set
    title = v_title, description_md = v_desc, start_date = v_s, end_date = v_e, label = v_label,
    task_type = v_type, updated_at = now()
  where id = n.id;
  perform public.assignment_resync(r.id);

  -- 경고 (D9: 부모·방 기간 밖 허용 + 경고, 담당자 0명 경고)
  if n.parent_id is not null then
    select * into p from public.goal_nodes where id = n.parent_id;
    if v_s < p.start_date or v_e > p.end_date then
      v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_PARENT', 'nodeId', n.id::text);
    end if;
  end if;
  if v_s < r.start_date or v_e > r.end_date then
    v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', n.id::text);
  end if;
  if v_type = 'DESIGNATED' then
    select asg into v_asg from public.room_progress(r.id) where node_id = n.id;
    if coalesce(v_asg, 0) = 0 then v_warn := v_warn || jsonb_build_object('code', 'UNASSIGNED_TASK', 'nodeId', n.id::text); end if;
  end if;

  -- 알림 (진행중 방만. 0008 전에는 자리표가 0 을 돌려준다)
  -- 행위자(v_uid) 제외는 notify_publish 계약이 맡는다 — 여기서는 담당자 전원을 넘긴다(A5).
  -- 세 알림 모두 행위 이벤트 → prefix 'KIND:room:node:' || txid_current() (D8: 같은 사람 해제 후 재배정도 새 알림, 한 저장 안에서는 1건)
  if r.status = 'ACTIVE' and v_type is not null then
    if (v_s, v_e) is distinct from (n.start_date, n.end_date) then
      select coalesce(array_agg(user_id), '{}') into v_rcpt
      from public.task_assignments where node_id = n.id and released_at is null;
      if cardinality(v_rcpt) > 0 then
        perform public.notify_publish('SCHEDULE_CHANGED', r.id, n.id, v_uid, v_rcpt,
          'SCHEDULE_CHANGED:' || r.id || ':' || n.id || ':' || txid_current(),
          jsonb_build_object('title', v_title, 'startDate', to_char(v_s, 'YYYY-MM-DD'), 'endDate', to_char(v_e, 'YYYY-MM-DD')));
      end if;
    end if;
    if cardinality(v_added) > 0 then
      perform public.notify_publish('TASK_ASSIGNED', r.id, n.id, v_uid, v_added,
        'TASK_ASSIGNED:' || r.id || ':' || n.id || ':' || txid_current(),
        jsonb_build_object('title', v_title, 'endDate', to_char(v_e, 'YYYY-MM-DD')));
    end if;
    if cardinality(v_removed) > 0 then
      perform public.notify_publish('TASK_UNASSIGNED', r.id, n.id, v_uid, v_removed,
        'TASK_UNASSIGNED:' || r.id || ':' || n.id || ':' || txid_current(),
        jsonb_build_object('title', v_title));
    end if;
  end if;

  -- 태그 자동 선택 (0009 가 있을 때만 — 플랜 04)
  if (p_patch ? 'title' or p_patch ? 'descriptionMd') and to_regproc('public.tag_autoselect') is not null then
    execute 'select public.tag_autoselect($1)' using r.id;
  end if;

  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('warnings', v_warn);
end $$;

grant execute on function public.node_update(text, bigint, jsonb) to authenticated;
```

`to_regproc('public.tag_autoselect')` 는 같은 이름의 함수가 둘 이상이면 null 을 돌려주므로 플랜 04 는 `tag_autoselect(bigint)` 하나만 만든다. `EXECUTE … USING` 을 쓰는 이유는 함수가 없을 때도 이 함수가 컴파일되게 하려는 것.

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "node_update"`
Expected: 4 사례 PASS. `overallPct: 25` 는 EC2 가 1/2 → 1/1 이 되어 6/24.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_curriculum.sql supabase/tests/curriculum-sql.test.ts
git commit -m "feat(db): node_update with invariants, assignees, warnings, notify hooks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 6: `node_move` · `node_indent` · `node_outdent`

**Files:**
- Modify: `supabase/migrations/0006_curriculum.sql` (끝에 추가)
- Modify: `supabase/tests/curriculum-sql.test.ts` (사례 추가)

**Interfaces:**
- Consumes: Task 1 헬퍼, Task 3 `curriculum_json`, Task 4 `node_create`(테스트).
- Produces: `node_move(p_slug text, p_node_id bigint, p_parent_id bigint, p_index int) returns jsonb`(`p_parent_id` null = 회차로), `node_indent(p_slug, p_node_id)`(직전 형제 아래 맨 뒤), `node_outdent(p_slug, p_node_id)`(조부모 아래, 부모 다음). 권한: `node_move` 만 `authenticated`(03-api §4). `node_indent`/`node_outdent` 는 03-api 에 없는 래퍼라 GRANT 하지 않는다(프론트는 `node_move` 를 쓴다 — 필요해지면 03-api 에 올리고 GRANT). 규칙: 자기 자신·후손 아래 → `VALIDATION_FAILED`; 보관 부모 → `PARENT_ARCHIVED`; 제출물 있는 리프 아래 → `NODE_HAS_SUBMISSIONS`, 없는 리프는 부모로 전환; 이동 후 서브트리 최대 depth > 5 → `NODE_DEPTH_EXCEEDED`; 회차가 되면 `label` 기본 `{n}주차`(이미 있으면 유지), 회차에서 내려가면 `label=null`; **리프를 회차로 올리면 `task_type` 을 유지한 depth-2 리프가 된다**(A7 — 허용, `node_create(parent=null, taskType)` 와 같은 모양); 서브트리 `depth`·`round_id` 재기록(I3·I4); 옛 형제·새 형제 `sort_order` 재부여; 회차 `node_outdent` → `ROOT_CANNOT_OUTDENT`; 직전 형제 없는 `node_indent` → `VALIDATION_FAILED`.

- [ ] **Step 1: 실패하는 테스트 — `curriculum-sql.test.ts` 끝에 추가**

```ts
const mv = (q: Parameters<typeof uid>[0], slug: string, node: string, parent: string | null, index: number | null) =>
  q(`select public.node_move($1, $2, $3, $4) as c`, [slug, node, parent, index]).then((r) => r[0].c as Record<string, any>);
const order = (c: Record<string, any>) => c.nodes.map((n: Node) => `${n.title}@${n.depth}#${n.sortOrder}`);

/** 서연의 새 방에 R1[A, B], R2 를 node_create 로 만든다 */
async function twoRounds(q: Parameters<typeof uid>[0]) {
  const room = await mkRoom(q, "서연");
  let c = await call(q, "node_create", [room.slug, null, "R1"]);
  const r1 = byTitle(c, "R1").id;
  c = await call(q, "node_create", [room.slug, r1, "A"]);
  c = await call(q, "node_create", [room.slug, r1, "B"]);
  c = await call(q, "node_create", [room.slug, null, "R2"]);
  return { room, r1, r2: byTitle(c, "R2").id, a: byTitle(c, "A").id, b: byTitle(c, "B").id, c };
}

sqlTest("node_move: 같은 부모 안 순서 변경, index 클램프, 회차 순서 변경", withCase(db, async (q) => {
  const t = await twoRounds(q);
  assertEquals(order(t.c), ["R1@2#0", "A@3#0", "B@3#1", "R2@2#1"]);
  let c = await mv(q, t.room.slug, t.b, t.r1, 0);
  assertEquals(order(c), ["R1@2#0", "B@3#0", "A@3#1", "R2@2#1"]);
  c = await mv(q, t.room.slug, t.b, t.r1, 99);                                   // 끝으로 클램프
  assertEquals(order(c), ["R1@2#0", "A@3#0", "B@3#1", "R2@2#1"]);
  c = await mv(q, t.room.slug, t.r2, null, 0);
  assertEquals(order(c), ["R2@2#0", "R1@2#1", "A@3#0", "B@3#1"]);
  assertEquals([byTitle(c, "R2").roundId, byTitle(c, "R2").label], [t.r2, "2주차"]);  // 라벨 유지
}));

sqlTest("node_move: 다른 부모로 — depth·round_id 재기록, 회차↔하위 전환 시 label, outdent/indent 래퍼", withCase(db, async (q) => {
  const t = await twoRounds(q);
  let c = await mv(q, t.room.slug, t.a, t.r2, null);
  assertEquals(order(c), ["R1@2#0", "B@3#0", "R2@2#1", "A@3#0"]);
  assertEquals(byTitle(c, "A").roundId, t.r2);
  assertEquals(byTitle(c, "A").task.assigned, 1);                               // 공통 배정 유지(resync)
  c = await mv(q, t.room.slug, t.r2, t.r1, 0);                                  // 회차 R2(자식 A) 를 R1 아래로
  assertEquals(order(c), ["R1@2#0", "R2@3#0", "A@4#0", "B@3#1"]);
  assertEquals([byTitle(c, "R2").label, byTitle(c, "R2").roundId, byTitle(c, "A").roundId], [null, t.r1, t.r1]);
  c = await call(q, "node_outdent", [t.room.slug, t.r2]);                        // 조부모(없음=루트) 아래, R1 다음
  assertEquals(order(c), ["R1@2#0", "B@3#0", "R2@2#1", "A@3#0"]);
  assertEquals([byTitle(c, "R2").label, byTitle(c, "A").roundId], ["2주차", t.r2]);
  await expectFail(call(q, "node_outdent", [t.room.slug, t.r1]), "ROOT_CANNOT_OUTDENT");
  await expectFail(call(q, "node_indent", [t.room.slug, t.r1]), "VALIDATION_FAILED");   // 직전 형제 없음
  c = await call(q, "node_indent", [t.room.slug, t.r2]);                         // R2 → R1 의 마지막 자식
  assertEquals(order(c), ["R1@2#0", "B@3#0", "R2@3#1", "A@4#0"]);
  c = await call(q, "node_indent", [t.room.slug, t.r2]);                         // R2 → 직전 형제 B(리프, 제출 없음) 아래 → B 는 부모로 전환
  assertEquals(order(c), ["R1@2#0", "B@3#0", "R2@4#0", "A@5#0"]);
  assertEquals(byTitle(c, "B").task, null);
  // 리프를 회차로 올리면 task_type 유지 + label {n}주차 (A7)
  c = await call(q, "node_create", [t.room.slug, t.r1, "L"]);
  c = await mv(q, t.room.slug, byTitle(c, "L").id, null, null);
  const L = byTitle(c, "L");
  assertEquals([L.depth, L.label, L.roundId === L.id, L.task.type, L.task.assigned], [2, "2주차", true, "common", 1]);   // 이 시점 회차는 R1 하나 → 2주차
  await expectFail(mv(q, t.room.slug, t.r1, t.a, null), "VALIDATION_FAILED");  // 자기 후손 아래
  await expectFail(mv(q, t.room.slug, t.r1, t.r1, null), "VALIDATION_FAILED");
  await expectFail(mv(q, t.room.slug, t.a, 999999, null), "NODE_NOT_FOUND");
}));

sqlTest("node_move: 서브트리 깊이 초과·보관 부모·제출물 있는 리프 아래 거부", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const t = await twoRounds(q);
  // R1 > A > X > Y (A 는 부모로 전환됨). 서브트리 A 는 3단(3,4,5)
  let c = await call(q, "node_create", [t.room.slug, t.a, "X"]);
  c = await call(q, "node_create", [t.room.slug, byTitle(c, "X").id, "Y"]);
  assertEquals(byTitle(c, "Y").depth, 5);
  await expectFail(mv(q, t.room.slug, t.a, t.b, null), "NODE_DEPTH_EXCEEDED");    // A(3단 서브트리) 를 depth 3 아래로 → 6
  c = await mv(q, t.room.slug, t.a, t.r2, null);                                     // depth 2 아래는 가능
  assertEquals([byTitle(c, "A").depth, byTitle(c, "Y").depth, byTitle(c, "Y").roundId], [3, 5, t.r2]);
  await call(q, "node_archive", [t.room.slug, t.r2]);
  await expectFail(mv(q, t.room.slug, t.b, t.r2, null), "PARENT_ARCHIVED");
  // 제출물 있는 리프 아래 (aws: VPC → IAM)
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  await expectFail(mv(q, "aws", await nodeByTitle(q, aws, "VPC 실습"), await nodeByTitle(q, aws, "IAM 정책 이해"), null), "NODE_HAS_SUBMISSIONS");
  await asUser(q, await uid(q, "철수"));
  await expectFail(mv(q, "aws", await nodeByTitle(q, aws, "VPC 실습"), null, 0), "NOT_LEADER");
}));
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "node_move"`
Expected: 3 사례 FAIL — `function public.node_move(text, bigint, bigint, integer) does not exist`.

- [ ] **Step 3: 0006 에 추가**

```sql
-- ───────── node_move (E11~E13, I1·I3·I4) ─────────
create or replace function public.node_move(p_slug text, p_node_id bigint, p_parent_id bigint, p_index int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r          public.rooms;
  n          public.goal_nodes;
  p          public.goal_nodes;
  v_uid      uuid;
  v_depth    int;
  v_round    bigint;
  v_max      int;
  v_delta    int;
  v_n        int;
  v_idx      int;
  v_label    text;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);

  if p_parent_id is not null then
    p := public.node_get(r.id, p_parent_id);
    if p.id in (select public.node_subtree(n.id)) then
      perform public.fail('VALIDATION_FAILED', '자기 자신이나 하위 항목 아래로는 옮길 수 없어요', jsonb_build_object('field', 'parentId'));
    end if;
    if p.archived_at is not null then
      perform public.fail('PARENT_ARCHIVED', '보관된 항목 아래로는 옮길 수 없어요', jsonb_build_object('nodeId', p.id::text));
    end if;
    v_depth := p.depth + 1;
    v_round := p.round_id;
  else
    v_depth := 2;
    v_round := n.id;
  end if;

  select max(depth) into v_max from public.goal_nodes where id in (select public.node_subtree(n.id));
  v_delta := v_depth - n.depth;
  if v_max + v_delta > 5 then
    perform public.fail('NODE_DEPTH_EXCEEDED', '최대 5단계까지만 만들 수 있어요', jsonb_build_object('nodeId', n.id::text));
  end if;

  if p_parent_id is not null and p.task_type is not null then
    if public.node_has_submissions(p.id) then
      perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 과제 아래로는 옮길 수 없어요. 보관해 주세요', jsonb_build_object('nodeId', p.id::text));
    end if;
    update public.goal_nodes set task_type = null, updated_at = now() where id = p.id;
    update public.task_assignments set released_at = now() where node_id = p.id and released_at is null;
  end if;

  -- 옛 형제 재정렬 (자기 제외)
  update public.goal_nodes g set sort_order = s.rn - 1
  from (select id, row_number() over (order by sort_order, id) as rn
        from public.goal_nodes where room_id = r.id and parent_id is not distinct from n.parent_id and id <> n.id) s
  where g.id = s.id;

  -- 새 형제 사이에 끼우기 (자기 제외한 수로 클램프)
  select count(*)::int into v_n from public.goal_nodes
  where room_id = r.id and parent_id is not distinct from p_parent_id and id <> n.id;
  v_idx := least(greatest(coalesce(p_index, v_n), 0), v_n);
  update public.goal_nodes set sort_order = sort_order + 1
  where room_id = r.id and parent_id is not distinct from p_parent_id and id <> n.id and sort_order >= v_idx;

  -- 회차가 되면 label 기본 {n}주차(있으면 유지). task_type 은 건드리지 않는다 → 리프는 depth-2 리프가 된다(A7, 트리거가 허용)
  v_label := case when p_parent_id is null then coalesce(n.label, (v_n + 1) || '주차') else null end;
  update public.goal_nodes
  set parent_id = p_parent_id, sort_order = v_idx, depth = v_depth, round_id = v_round, label = v_label, updated_at = now()
  where id = n.id;
  update public.goal_nodes set depth = depth + v_delta, round_id = v_round, updated_at = now()
  where id in (select public.node_subtree(n.id)) and id <> n.id;

  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- 내어쓰기: 조부모 아래, 부모 바로 다음. 회차는 불가
create or replace function public.node_outdent(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; p public.goal_nodes;
begin
  r := public.node_assert_editable(p_slug);
  n := public.node_get(r.id, p_node_id);
  if n.parent_id is null then
    perform public.fail('ROOT_CANNOT_OUTDENT', '회차는 더 내어쓸 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  select * into p from public.goal_nodes where id = n.parent_id;
  return public.node_move(p_slug, n.id, p.parent_id, p.sort_order + 1);
end $$;

-- 들여쓰기: 직전 형제 아래 맨 뒤
create or replace function public.node_indent(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_prev bigint;
begin
  r := public.node_assert_editable(p_slug);
  n := public.node_get(r.id, p_node_id);
  select id into v_prev from public.goal_nodes
  where room_id = r.id and parent_id is not distinct from n.parent_id and id <> n.id and sort_order < n.sort_order
  order by sort_order desc, id desc limit 1;
  if v_prev is null then
    perform public.fail('VALIDATION_FAILED', '바로 위 항목이 없어 들여쓸 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  return public.node_move(p_slug, n.id, v_prev, null);
end $$;

grant execute on function public.node_move(text, bigint, bigint, int) to authenticated;
```

`node_outdent`/`node_indent` 가 `node_assert_editable` 을 부르고 `node_move` 가 다시 부른다 — 같은 트랜잭션 안 `FOR UPDATE` 재잠금은 즉시 성공한다.

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "node_move"`
Expected: 3 사례 PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_curriculum.sql supabase/tests/curriculum-sql.test.ts
git commit -m "feat(db): node_move / node_indent / node_outdent

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 7: `me_studies` — 사이드바 그룹 · when

**Files:**
- Modify: `supabase/migrations/0006_curriculum.sql` (끝에 추가)
- Create: `supabase/tests/me-studies-sql.test.ts`

**Interfaces:**
- Consumes: `require_user`, `kst_today`, 시드 §2·§3.
- Produces: `me_studies() returns jsonb` = `{ today, groups: [{kind:"active", items}, {kind:"recruit", items}, {kind:"ended", items}] }`, `items[] = { slug, title, intro, membership: "leader"|"joined"|"pending", when: { kind: "deadline"|"start"|"end", date } }`. 규칙(03-api §6): active = ACTIVE 방 ∧ (그룹장|ACTIVE 멤버), recruit = RECRUIT|DRAFT 방 ∧ (그룹장|ACTIVE|PENDING), ended = ENDED 방 ∧ (그룹장|ACTIVE 멤버). 보관·INACTIVE 제외. `when`: active → 내 OPEN 과제(미제출, `s ≤ today ≤ e`, 보관 아님) 중 최소 `e` 를 `deadline`, 없으면 방 `end_date` 를 `end`; recruit → `start`; ended → `end`. 정렬: active = when 날짜, recruit = start_date, ended = end_date 내림차순, 동률은 방 id. 세 그룹은 비어도 항상 돌려준다. `when.deadline` 은 OPEN 만(D14) — 방 목록 `nextTask`·방 상세 `nextDue` 와 같은 규칙. 권한: `authenticated`.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/me-studies-sql.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { nodeByTitle, roomId, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

const studies = async (q: Parameters<typeof uid>[0]) => (await q("select public.me_studies() as s"))[0].s as Record<string, any>;
const flat = (s: Record<string, any>) => s.groups.map((g: any) => [g.kind, g.items.map((i: any) => [i.slug, i.membership, i.when.kind, i.when.date])]);

sqlTest("me_studies(철수): 진행중 aws 10-14·spring 10-18, 모집중 sqld(pending) 10-26·docker(leader) 11-09, 종료 algo 09-30", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  const s = await studies(q);
  assertEquals(s.today, TODAY);
  assertEquals(flat(s), [
    ["active",  [["aws", "joined", "deadline", "2026-10-14"], ["spring", "joined", "deadline", "2026-10-18"]]],
    ["recruit", [["sqld", "pending", "start", "2026-10-26"], ["docker", "leader", "start", "2026-11-09"]]],
    ["ended",   [["algo", "joined", "end", "2026-09-30"]]],
  ]);
  const aws = s.groups[0].items[0];
  assertEquals([aws.title, typeof aws.intro], ["AWS SAA 자격증 3개월 완주", "string"]);
}));

sqlTest("me_studies: OPEN 과제가 없으면 when=end(방 종료일), 보관 방·이탈 방은 빠진다, 비로그인 AUTH_REQUIRED", withCase(db, async (q) => {
  await setToday(q, TODAY);
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));                                      // 그룹장: IAM·VPC 제출, EC2 미담당 → OPEN 없음
  let s = await studies(q);
  assertEquals(s.groups[0].items.map((i: any) => [i.slug, i.membership, i.when]), [["aws", "leader", { kind: "end", date: "2026-12-31" }]]);
  // 철수의 EC2 를 보관하면 철수도 end 로 떨어진다
  await q("select public.node_archive($1, $2)", ["aws", await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리")]);
  await asUser(q, await uid(q, "철수"));
  s = await studies(q);
  assertEquals(s.groups[0].items.map((i: any) => [i.slug, i.when]), [["spring", { kind: "deadline", date: "2026-10-18" }], ["aws", { kind: "end", date: "2026-12-31" }]]);  // when 날짜순
  // 보관된 방은 사라진다
  await q("update public.rooms set archived_at = now() where slug = 'algo'");
  s = await studies(q);
  assertEquals(s.groups[2], { kind: "ended", items: [] });
  // 이탈자(도윤)는 aws 가 없다
  await asUser(q, await uid(q, "도윤"));
  s = await studies(q);
  assertEquals(s.groups.map((g: any) => g.items.length), [0, 0, 0]);
  await asAnon(q);
  await expectFail(q("select public.me_studies()"), "AUTH_REQUIRED");
}));

sqlTest("me_studies: 모집중 방은 PENDING 뿐 아니라 ACTIVE 멤버도, DRAFT 방은 그룹장만", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "도현"));                                      // toeic ACTIVE 멤버(모집중)
  let s = await studies(q);
  assertEquals(flat(s)[1], ["recruit", [["toeic", "joined", "start", "2026-11-02"]]]);
  await asUser(q, await uid(q, "서연"));                                      // toeic 그룹장 + 새 DRAFT 방
  await q(`select public.room_create('초안 방 Draft', '소개', '2026-12-01'::date, '2026-12-20'::date, 4, true, 'direct')`);
  s = await studies(q);
  assertEquals(s.groups[1].items.map((i: any) => [i.title, i.membership, i.when.date]),
    [["토익 900 8주 챌린지", "leader", "2026-11-02"], ["초안 방 Draft", "leader", "2026-12-01"]]);
}));
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "me_studies"`
Expected: 3 사례 FAIL — `function public.me_studies() does not exist`.

- [ ] **Step 3: 0006 에 추가**

```sql
-- ───────── me_studies (03-api §6, mystudy §1.1·§3.8) ─────────
create or replace function public.me_studies() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  v_out   jsonb;
begin
  with mine as (
    select r.id, r.slug, r.title, r.intro, r.start_date, r.end_date,
           case when r.leader_id = v_uid then 'leader' when m.status = 'PENDING' then 'pending' else 'joined' end as membership,
           case when r.status = 'ACTIVE' then 'active' when r.status in ('RECRUIT', 'DRAFT') then 'recruit' else 'ended' end as kind
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = v_uid
    where r.archived_at is null
      and (r.leader_id = v_uid or m.status = 'ACTIVE' or (m.status = 'PENDING' and r.status in ('RECRUIT', 'DRAFT')))),
  due as (
    -- 내 OPEN 과제(미제출, 기간 안, 보관 아님) 중 가장 빠른 마감
    select n.room_id, min(n.end_date) as d
    from public.goal_nodes n
    join public.task_assignments a on a.node_id = n.id and a.user_id = v_uid and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.task_type is not null and n.archived_at is null and s.id is null
      and n.start_date <= v_today and v_today <= n.end_date
    group by n.room_id),
  items as (
    select m.*, d.d,
           jsonb_build_object('slug', m.slug, 'title', m.title, 'intro', m.intro, 'membership', m.membership,
             'when', case m.kind
               when 'active'  then jsonb_build_object('kind', case when d.d is null then 'end' else 'deadline' end,
                                                      'date', to_char(coalesce(d.d, m.end_date), 'YYYY-MM-DD'))
               when 'recruit' then jsonb_build_object('kind', 'start', 'date', to_char(m.start_date, 'YYYY-MM-DD'))
               else                jsonb_build_object('kind', 'end',   'date', to_char(m.end_date, 'YYYY-MM-DD')) end) as j
    from mine m left join due d on d.room_id = m.id)
  select jsonb_build_array(
    jsonb_build_object('kind', 'active',  'items', coalesce((select jsonb_agg(j order by coalesce(d, end_date), id) from items where kind = 'active'),  '[]'::jsonb)),
    jsonb_build_object('kind', 'recruit', 'items', coalesce((select jsonb_agg(j order by start_date, id)          from items where kind = 'recruit'), '[]'::jsonb)),
    jsonb_build_object('kind', 'ended',   'items', coalesce((select jsonb_agg(j order by end_date desc, id)       from items where kind = 'ended'),   '[]'::jsonb)))
  into v_out;
  return jsonb_build_object('today', to_char(v_today, 'YYYY-MM-DD'), 'groups', v_out);
end $$;

grant execute on function public.me_studies() to authenticated;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "me_studies"`
Expected: 3 사례 PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_curriculum.sql supabase/tests/me-studies-sql.test.ts
git commit -m "feat(db): me_studies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 8: `me_schedule(p_from, p_to)` — 창·내 상태·마커·다가오는 마감

**Files:**
- Modify: `supabase/migrations/0006_curriculum.sql` (끝에 추가)
- Create: `supabase/tests/me-schedule-sql.test.ts`

**Interfaces:**
- Consumes: `require_user`, `kst_today`, `task_code`, `fail`, 시드 §2·§3.
- Produces: `me_schedule_leaves(p_uid uuid, p_today date) returns table(node_id, room_id, slug, title, s, e, st, round)`(내부: 내 방의 보관 아닌 리프 중 "내 것" — 유효 배정 | PENDING 방 전체 | 그룹장 `leader_does_tasks=false` 는 `st=null`), `me_schedule(p_from date, p_to date) returns jsonb` = `{ today, studies, tasks, markers, upcoming }`(03-api §6 ScheduleResponse). 규칙(schedule §3·§5): `from ≤ to`, `to − from ≤ 62` 아니면 `SCHEDULE_RANGE_INVALID`; `studies` = 창과 무관하게 내 방 전부(그룹장|ACTIVE|PENDING, 보관 제외), `tone = ['mint','blue','peach','lav','amber','slate'][id % 6]`; `tasks` = `s ≤ to ∧ e ≥ from`; `markers` = depth-2 회차 `start_date ∈ [from,to]`; `upcoming` = `st ∈ {open, planned} ∧ today ≤ e ≤ today+7`, `e, slug, s, id` 순.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/me-schedule-sql.test.ts`**

```ts
import { assertEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, openDb, setToday, sqlTest, withCase } from "./_harness.ts";
import { nodeByTitle, roomId, uid, TODAY } from "./_curriculum-helpers.ts";

const db = await openDb();
await applySeed(db);

type R = Record<string, any>;
const sched = async (q: Parameters<typeof uid>[0], from: string, to: string) =>
  (await q("select public.me_schedule($1::date, $2::date) as s", [from, to]))[0].s as R;

sqlTest("me_schedule(철수 09-27~11-07): studies 5개·tone, tasks 19개(st), markers 11개, upcoming EC2 < 섹션 6~7 < 싱글톤", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  const s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals(s.today, TODAY);
  assertEquals(s.studies.map((x: R) => [x.slug, x.membership, x.status, x.tone]),
    [["sqld", "pending", "recruit", "lav"], ["docker", "leader", "recruit", "amber"], ["aws", "joined", "active", "mint"], ["algo", "joined", "ended", "peach"], ["spring", "joined", "active", "lav"]]);
  assertEquals([s.studies[2].title, s.studies[2].startDate, s.studies[2].endDate], ["AWS SAA 자격증 3개월 완주", "2026-10-01", "2026-12-31"]);
  const byTitle = (t: string) => s.tasks.find((x: R) => x.title === t);
  assertEquals(s.tasks.length, 19);                                          // aws 6 + spring 7 + sqld 5(미리보기) + algo 13주차 1
  assertEquals(s.tasks.filter((x: R) => x.slug === "sqld").every((x: R) => x.st === "planned"), true);
  assertEquals(byTitle("EC2 인스턴스 유형 정리"), { ...byTitle("EC2 인스턴스 유형 정리"), slug: "aws", s: "2026-10-08", e: "2026-10-14", st: "open", round: "2주차" });
  assertEquals([byTitle("IAM 정책 이해").st, byTitle("스프링 컨테이너 실습").st, byTitle("섹션 1~5 정리 노트").st, byTitle("싱글톤 컨테이너 실습 코드").st], ["done", "late", "done", "planned"]);
  assertEquals([byTitle("13주차 문제 풀이").st, byTitle("13주차 문제 풀이").round], ["done", "9–13주차"]);
  assertEquals(typeof byTitle("EC2 인스턴스 유형 정리").id, "string");
  assertEquals(s.tasks.find((x: R) => x.title === "S3 스토리지 클래스 발표자료"), undefined);   // 철수 미담당
  assertEquals(s.markers.length, 11);
  assertEquals(s.markers.filter((m: R) => m.slug === "sqld"), [{ date: "2026-10-26", slug: "sqld", round: "1주차" }, { date: "2026-11-02", slug: "sqld", round: "2주차" }]);
  assertEquals(s.markers[0], { date: "2026-10-01", slug: "aws", round: "1주차" });
  assertEquals(s.upcoming.map((x: R) => [x.title, x.e, x.st]), [["EC2 인스턴스 유형 정리", "2026-10-14", "open"], ["섹션 6~7 정리 노트", "2026-10-18", "open"], ["싱글톤 컨테이너 실습 코드", "2026-10-18", "planned"]]);
}));

sqlTest("me_schedule: 창 밖 제외·upcoming 은 창과 독립, 보관 리프 제외, 11월 창에서 sqld 미리보기·docker(그룹장) 과제", withCase(db, async (q) => {
  await setToday(q, TODAY);
  await asUser(q, await uid(q, "철수"));
  let s = await sched(q, "2026-11-08", "2026-12-12");
  assertEquals(s.tasks.filter((x: R) => x.slug === "aws").length, 0);
  assertEquals(s.tasks.filter((x: R) => x.slug === "sqld").length, 6);         // 내장 함수(e=11-08 겹침)·2과목 전반 + 3주차 2 + 4주차 2. SELECT·JOIN(11-05 끝)은 제외
  assertEquals(s.tasks.filter((x: R) => x.slug === "docker").every((x: R) => x.st === "planned"), true);
  assertEquals(s.tasks.filter((x: R) => x.slug === "docker").length, 7);       // 1~5주차 7개. 6주차(12-14 시작)는 창 밖
  assertEquals(s.upcoming.map((x: R) => x.title), ["EC2 인스턴스 유형 정리", "섹션 6~7 정리 노트", "싱글톤 컨테이너 실습 코드"]);
  // EC2 보관 → tasks·upcoming 에서 사라진다
  const aws = await roomId(q, "aws");
  await asUser(q, await uid(q, "민수"));
  await q("select public.node_archive($1, $2)", ["aws", await nodeByTitle(q, aws, "EC2 인스턴스 유형 정리")]);
  await asUser(q, await uid(q, "철수"));
  s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals(s.tasks.find((x: R) => x.title === "EC2 인스턴스 유형 정리"), undefined);
  assertEquals(s.upcoming.map((x: R) => x.title), ["섹션 6~7 정리 노트", "싱글톤 컨테이너 실습 코드"]);
  // 오늘이 10-20 이면 섹션 6~7 은 missed, upcoming 은 ALB(10-21, planned)·MVC(10-25)·서블릿(10-25)
  await setToday(q, "2026-10-20");
  s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals(s.tasks.find((x: R) => x.title === "VPC 실습").st, "done");
  assertEquals(s.tasks.find((x: R) => x.title === "섹션 6~7 정리 노트").st, "missed");
  assertEquals(s.upcoming.map((x: R) => [x.title, x.e]), [["ALB vs NLB 실습", "2026-10-21"], ["MVC 구조 이해 노트", "2026-10-25"], ["서블릿→MVC 리팩토링", "2026-10-25"]]);
}));

sqlTest("me_schedule: leader_does_tasks=false 그룹장(가은)은 st=null 로 보이고 upcoming 제외, 이탈자 제외, 범위·인증 오류", withCase(db, async (q) => {
  await setToday(q, "2026-10-27");
  await asUser(q, await uid(q, "가은"));
  let s = await sched(q, "2026-10-25", "2026-11-28");
  assertEquals(s.studies.map((x: R) => [x.slug, x.membership]), [["sqld", "leader"]]);
  assertEquals([s.tasks.length, s.tasks.every((x: R) => x.st === null), s.upcoming], [9, true, []]);
  await asUser(q, await uid(q, "도윤"));                                          // aws INACTIVE
  s = await sched(q, "2026-09-27", "2026-11-07");
  assertEquals([s.studies, s.tasks, s.markers], [[], [], []]);
  await asUser(q, await uid(q, "철수"));
  await expectFail(q("select public.me_schedule('2026-09-01'::date, '2026-11-03'::date)"), "SCHEDULE_RANGE_INVALID");   // 63일
  assertEquals((await sched(q, "2026-09-01", "2026-11-02")).today, "2026-10-27");                                     // 62일은 허용
  await expectFail(q("select public.me_schedule('2026-11-03'::date, '2026-11-01'::date)"), "SCHEDULE_RANGE_INVALID");
  await expectFail(q("select public.me_schedule(null, '2026-11-01'::date)"), "SCHEDULE_RANGE_INVALID");
  await asAnon(q);
  await expectFail(q("select public.me_schedule('2026-10-01'::date, '2026-10-31'::date)"), "AUTH_REQUIRED");
}));

sqlTest("privileges (D7): 플랜 03 내부 함수는 anon·authenticated 실행 불가, 공개 RPC 만 GRANT", withCase(db, async (q) => {
  const can = async (role: string, fn: string) =>
    (await q("select has_function_privilege($1, $2, 'execute') as ok", [role, fn]))[0].ok as boolean;
  // 임의 uid 를 받는 빌더(리뷰 D1 의 노출 경로) + 트리 헬퍼 + 03-api 에 없는 래퍼
  for (const fn of [
    "public.curriculum_json(bigint,uuid,boolean)", "public.me_schedule_leaves(uuid,date)",
    "public.room_progress(bigint)", "public.node_subtree(bigint)", "public.node_has_submissions(bigint)",
    "public.node_assert_editable(text)", "public.node_get(bigint,bigint)", "public.goal_nodes_guard()",
    "public.node_indent(text,bigint)", "public.node_outdent(text,bigint)",
  ]) {
    assertEquals(await can("anon", fn), false, `anon → ${fn}`);
    assertEquals(await can("authenticated", fn), false, `authenticated → ${fn}`);
  }
  assertEquals(await can("anon", "public.curriculum_get(text,boolean)"), true);
  for (const fn of ["public.node_create(text,bigint,text,text,text,date,date,integer)", "public.node_update(text,bigint,jsonb)",
                    "public.node_move(text,bigint,bigint,integer)", "public.node_delete(text,bigint)", "public.node_archive(text,bigint)",
                    "public.node_unarchive(text,bigint)", "public.me_studies()", "public.me_schedule(date,date)"]) {
    assertEquals(await can("anon", fn), false, fn);
    assertEquals(await can("authenticated", fn), true, fn);
  }
}));
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "me_schedule|privileges \(D7\): 플랜 03"`
Expected: 4 사례 FAIL — `function public.me_schedule(date, date) does not exist`(privileges 사례는 없는 함수 이름에서 실패).

- [ ] **Step 3: 0006 에 추가**

```sql
-- ───────── me_schedule (03-api §6, schedule §3·§5, 02 §4.4) ─────────
-- 내 방(그룹장|ACTIVE|PENDING, 보관 아님)의 보관 아닌 리프 중 "내 것":
--   유효 배정 → st = task_code / PENDING 방 → 전체 리프 미리보기(st 는 날짜 기준) / 그룹장 leader_does_tasks=false → 보이되 st null
create or replace function public.me_schedule_leaves(p_uid uuid, p_today date)
returns table (node_id bigint, room_id bigint, slug text, title text, s date, e date, st text, round text)
language sql stable security definer set search_path = '' as $$
  select n.id, r.id, r.slug::text, n.title::text, n.start_date, n.end_date,
         case when m.status = 'PENDING' or a.id is not null
              then public.task_code(n.start_date, n.end_date, sub.first_submitted_at, sub.is_late, p_today)
              else null end,
         coalesce(rn.label::text, (rn.sort_order + 1) || '주차')
  from public.rooms r
  join public.room_members m on m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE', 'PENDING')
  join public.goal_nodes n on n.room_id = r.id and n.task_type is not null and n.archived_at is null
  join public.goal_nodes rn on rn.id = n.round_id
  left join public.task_assignments a on a.node_id = n.id and a.user_id = p_uid and a.released_at is null
  left join public.submissions sub on sub.node_id = n.id and sub.user_id = p_uid
  where r.archived_at is null
    and (a.id is not null or m.status = 'PENDING' or (r.leader_id = p_uid and not r.leader_does_tasks))
$$;
-- me_schedule_leaves 는 임의 p_uid 를 받는 내부 함수 — GRANT 없음(D7)

create or replace function public.me_schedule(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := public.require_user();
  v_today    date := public.kst_today();
  v_studies  jsonb;
  v_tasks    jsonb;
  v_markers  jsonb;
  v_upcoming jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 62 then
    perform public.fail('SCHEDULE_RANGE_INVALID', '조회 기간은 62일 이내여야 해요', jsonb_build_object('from', to_char(p_from, 'YYYY-MM-DD'), 'to', to_char(p_to, 'YYYY-MM-DD')));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', r.slug, 'title', r.title,
           'membership', case when r.leader_id = v_uid then 'leader' when m.status = 'PENDING' then 'pending' else 'joined' end,
           'tone', (array['mint', 'blue', 'peach', 'lav', 'amber', 'slate'])[1 + (r.id % 6)],
           'status', lower(r.status),
           'startDate', to_char(r.start_date, 'YYYY-MM-DD'), 'endDate', to_char(r.end_date, 'YYYY-MM-DD'))
           order by r.id), '[]'::jsonb)
  into v_studies
  from public.rooms r
  join public.room_members m on m.room_id = r.id and m.user_id = v_uid
  where r.archived_at is null and (r.leader_id = v_uid or m.status in ('ACTIVE', 'PENDING'));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.node_id::text, 'slug', l.slug, 'title', l.title,
           's', to_char(l.s, 'YYYY-MM-DD'), 'e', to_char(l.e, 'YYYY-MM-DD'), 'st', l.st, 'round', l.round)
           order by l.s, l.e, l.slug, l.node_id), '[]'::jsonb)
  into v_tasks
  from public.me_schedule_leaves(v_uid, v_today) l
  where l.s <= p_to and l.e >= p_from;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.node_id::text, 'slug', l.slug, 'title', l.title,
           's', to_char(l.s, 'YYYY-MM-DD'), 'e', to_char(l.e, 'YYYY-MM-DD'), 'st', l.st, 'round', l.round)
           order by l.e, l.slug, l.s, l.node_id), '[]'::jsonb)
  into v_upcoming
  from public.me_schedule_leaves(v_uid, v_today) l
  where l.st in ('open', 'planned') and l.e between v_today and v_today + 7;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(n.start_date, 'YYYY-MM-DD'), 'slug', r.slug,
           'round', coalesce(n.label::text, (n.sort_order + 1) || '주차'))
           order by n.start_date, r.slug, n.sort_order), '[]'::jsonb)
  into v_markers
  from public.rooms r
  join public.room_members m on m.room_id = r.id and m.user_id = v_uid and m.status in ('ACTIVE', 'PENDING')
  join public.goal_nodes n on n.room_id = r.id and n.parent_id is null and n.archived_at is null
  where r.archived_at is null and n.start_date between p_from and p_to;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'studies', v_studies, 'tasks', v_tasks, 'markers', v_markers, 'upcoming', v_upcoming);
end $$;

grant execute on function public.me_schedule(date, date) to authenticated;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db`
Expected: me_schedule 3 + privileges 1 사례 PASS, 이 플랜 전체(progress 10 · curriculum 15 · me_studies 3 · me_schedule 4 = 32) + 플랜 01(46)·02(29) 전 사례 PASS. 11월 창(11-08~12-12) sqld 6건 = 내장 함수(11-04~11-08, `e >= from` 로 포함)·2과목 전반·서브쿼리·2과목 후반·모의고사 1·2. 5건이면 겹침 판정이 `s >= from` 으로 잘못 짜인 것.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0006_curriculum.sql supabase/tests/me-schedule-sql.test.ts
git commit -m "feat(db): me_schedule with window, my status, markers, upcoming

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

## Phase 종료 게이트

- [ ] `npm run test:db` 전부 통과 — 플랜 01(46) + 플랜 02(29, Task 2 Step 5 로 시드 값에 맞춘 사례 3개 포함) + 이 플랜 32(progress 10 · curriculum 15 · me_studies 3 · me_schedule 4). `npm test` · `npm run lint` · `npx tsc --noEmit` 도 통과(프론트는 건드리지 않았으므로 변화 없음).
- [ ] `vm_stat | grep -E 'free|compressor'` 확인 후 `npm run db:reset` — 0001→…→0006→seed 가 오류 없이 적용되고 `select count(*) from goal_nodes` = 160, `select public.pct(sum(asg)::int, sum(sub)::int) from public.room_progress(6) p join goal_nodes n on n.id = p.node_id where n.parent_id is null` = 24.
- [ ] `npm run db:types` 로 `src/lib/supabase/database.types.ts` 재생성 — `Functions` 에 `curriculum_get, node_create, node_update, node_move, node_indent, node_outdent, node_delete, node_archive, node_unarchive, me_studies, me_schedule` 가 보이고 내부 함수(`node_subtree`, `room_progress`, `curriculum_json`, `me_schedule_leaves`, `node_get`, `node_assert_editable`, `node_has_submissions`, `node_indent`, `node_outdent`)는 GRANT 가 없어(0002 default privileges) anon/authenticated 가 호출할 수 없다(PostgREST 스키마 캐시에는 보일 수 있다 — 호출하면 `permission denied for function`). `SUPABASE_URL` 이 있으면 anon 으로 `rpc('curriculum_json', {p_room: 9, p_uid: <지훈>, p_include_archived: true})` 가 에러인지 한 번 확인한다.
- [ ] 플랜 02 의 사례 3개가 Task 2 Step 5 로 실제 시드 트리 값을 단언한다: aws `stats.overallPct=24`, `rounds` 5개(5/8·1/3·0/4·0/4·0/6), `currentRound` = 2주차(tasks 2개, EC2 people 지은 done·철수 open), 철수 `myProgress = {submitted 2, assigned 6, nextDue EC2 2026-10-14}` = 방 목록 슬롯 2/6=33%, 민수 2/5·nextTask null, react team {4, 8}, algo final 68/78·3, toeic rounds 8. 숫자가 다르면 `room_leaf_stats` 교체(Task 1)가 0004 의 시그니처와 다르거나 시드가 PLANS 와 다른 것.
- [ ] 다음 계획(`…-04-submission-notification-tags.md`)에 넘기는 것: ① `notify_publish` 를 0008 에서 `CREATE OR REPLACE` 하면 `node_update` 의 `SCHEDULE_CHANGED`/`TASK_ASSIGNED`/`TASK_UNASSIGNED` 호출이 그대로 살아난다 — dedupe prefix 는 `'<KIND>:<room>:<node>:' || txid_current()`(D8 행위 이벤트), 수신자에는 행위자가 섞여 들어오므로 0008 이 `p_actor` 를 뺀다(개요 계약). 이 플랜의 node_update 사례는 알림 건수를 단언하지 않는다 — 0008 이 생기면 플랜 04 가 같은 호출로 건수(행위자 제외·재배정 재알림)를 단언한다. ② `tag_autoselect(p_room bigint)` 는 **이 시그니처 하나만** 만든다(`to_regproc` 가 오버로드를 null 로 본다). ③ `member_deactivate` 는 `node_subtree`·`room_progress` 를 쓰고 끝에 `assignment_resync` 를 부른다. ④ `task_get` 은 `curriculum_json` 의 NodeDto 한 건 + `path` 를 `round_id`/`parent_id` 로 만든다. ⑤ `submission_upsert` 선행 조건 `TASK_ARCHIVED` 는 `goal_nodes.archived_at`, `TASK_NOT_ASSIGNED` 는 `task_assignments.released_at is null`(보관 리프는 DESIGNATED 까지 released — D13 이라 Storage INSERT 정책의 `is_task_assignee` 도 거짓). ⑥ 시드 §3 의 도윤 released 행 + 제출물은 "이탈자 제출물 조회" 사례 재료.

## Self-Review 메모

- 스펙 커버리지: 03-api §4 전 RPC(`curriculum_get` Task 3, `node_create`/`node_delete`/`node_archive`/`node_unarchive` Task 4, `node_update` Task 5, `node_move` Task 6 — E12·E13 래퍼 `node_indent`/`node_outdent` 추가), §6 `me_studies` Task 7·`me_schedule` Task 8, 02 §3 I1(create·move 리프→부모 전환)·I2(`NODE_NOT_LEAF`)·I3(depth)·I4(round_id 재기록)·I5(archive 전파·`PARENT_ARCHIVED`)·I6(`NODE_HAS_SUBMISSIONS`·`ASSIGNEE_HAS_SUBMISSION`)·I8(모든 쓰기 끝 resync), §4.1 롤업(`room_progress`)·§4.2 사람별 코드(`curriculum_json.people`)·§4.4 일정 쿼리(`me_schedule_leaves`), §8 시드 goal_nodes/task_assignments/submissions 행(Task 2), D4 실체화(모집중 docker 그룹장 배정이 일정에 planned 로 나온다), D5 회귀값 4종, D9 전 항목(편집 단위·불변식·기간 경고·빈 부모 유지·`is_late` 재계산 금지·편집 가능 상태). 미포함(의도): `moreRounds`/`currentRound` 같은 문구 파생은 프론트 어댑터(D13); 노드 `description_md` 길이 20k 는 mystudy E5 의 제안값.
- 이름 일치: 플랜 02 `room_leaf_stats` 반환 열(`node_id, round_id, parent_id, title, task_type, start_date, end_date, sort_order, asg, sub`) 그대로; 플랜 05 가정 시그니처(`node_update(p_slug, p_node_id, p_patch)`, `node_move(p_slug, p_node_id, p_parent_id, p_index)`, `curriculum_get(p_slug, p_include_archived)`, `me_schedule(p_from, p_to)`) 와 일치; 하네스는 플랜 01 Task 2 의 `_harness.ts` 하나(`openDb/applySeed/withCase(db, fn)/sqlTest/asUser/asAnon/setToday/expectFail(promise, code)`)를 import 만 한다. Task 2 Step 5 가 고치는 플랜 02 사례 파일은 그 플랜의 `expectFailSql(q, sql, params, code)` 를 그대로 쓴다. 사용자 id 는 닉네임 조회라 번호 체계와 무관.
- 시드 주의: `sqld.leader_does_tasks=false` 는 §3 에서 강제한다(플랜 02 §2 가 true 로 넣었어도 D5 "sqld null" 이 이긴다). algo 9–13주차 회차 `end_date` 는 PLANS 계산값 09-29(목업 문구 "09.30" 과 하루 차이) — 트리를 따른다. PGlite 가 `pg_temp` 함수를 거부하면 Task 2 Step 4 의 대안(`public._seed3_*` 네 함수 + drop 네 줄). seed 섹션: §1 사용자(01) → §2 방·멤버·태그(02) → §3 커리큘럼·배정·제출(03) → §4 알림 등(04, 태그·제출 재삽입 금지) → 마지막 줄 `app.today`.
- Review Focus 5건 전부 소유 태스크 테스트에 박음(1→Task 4·5, 2→Task 6, 3→Task 2·4·8, 4→Task 2·3·8, 5→Task 3·8). 개요 Review Focus 3(이탈자 분모)의 Phase 3 몫 = Task 2 의 `RF3 …` 두 사례(제출자 철수 이탈 IAM 3/4→2/3·제출물 유지·그룹장 조회 / RECRUIT INACTIVE 재신청 `MEMBER_NOT_ACTIVE`).
- 자리표 점검: "TBD/TODO/나중에" 없음. 모든 함수 본문·테스트 코드가 실려 있고, 다른 플랜의 함수는 "Consumes" 블록에 시그니처가 있다.
