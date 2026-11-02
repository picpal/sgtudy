# MCP 계획서 경로 core 분리 (0056) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP(PAT) 경로가 anon `statement_timeout` 3s 를 넘기는 주원인 — 내부 호출마다 만들어 버리는 `curriculum_json` — 을 없앤다. 웹 RPC 응답·알림·데이터 결과는 바이트 단위로 그대로.

**Architecture:** `node_update`·`node_move`·`personal_create` 본문을 json 을 만들지 않는 `*_core` 로 옮기고(0034 `node_create_core` 와 같은 방식), 공개 RPC 는 `core → curriculum_json 한 번` 의 얇은 래퍼가 된다. `plan_run`(MCP 미리보기·적용)과 `personal_create_many`(개인 목표 일괄)는 core 를 부른다. 방 단위 재계산(`room_leaf_stats`·`assignment_resync`·`room_progress`)은 그대로 둔다(아래 「범위 밖」).

**Tech Stack:** Postgres plpgsql 마이그레이션, PGlite(Deno) `*-sql` 테스트, 로컬 Supabase + `bench.mjs`(MCP 실측).

**Spec:** `docs/superpowers/specs/2026-10-19-ai-integration-design.md` §11 (「`node_update`/`node_move` 가 호출마다 `curriculum_json` 을 만든다 → 3단계에서 core 분리」, 「`personal_create_many` … 후속 core 분리」). 실측: mcp-3s-bench 2026-11-02 — 담당 지정 48 + 방 1,098노드 preview 3/3 TIMEOUT, `node_update` 시간의 ~80% 가 버려지는 `curriculum_json`.

## Global Constraints

- 새 마이그레이션 `supabase/migrations/0056_plan_core_split.sql` 한 파일. 0055 는 exam-ai-toggle 작업 중 — 건드리지 않는다. 배포 후 수정 금지 머리말.
- 재정의는 **가장 최근 판 복사**: `node_update` ← 0028(`0028_backlog_f.sql:10`), `node_move` ← 0006(`0006_curriculum.sql:552`, 이후 재정의 없음), `personal_create` ← 0014(`0014_personal_goals.sql:153`), `plan_run` ← 0038(`0038_plan_exam.sql:377`), `personal_create_many` ← 0035(`0035_api_invoke.sql:27`). 0039~0055 에 이 다섯의 재정의 없음(grep 확인).
- 공개 함수는 `create or replace` · 이름·인자·기본값·반환형 동일 → 기존 GRANT(`node_update`·`node_move`·`personal_create` to authenticated) 유지. `security definer set search_path = ''` 유지.
- 새 `*_core` 는 GRANT 없음(0002 기본 권한이 public·anon·authenticated execute 를 걷는다) — security definer 호출자만 부른다.
- core 는 래퍼가 하던 **검사·잠금·쓰기·알림·태그를 같은 순서로 전부** 한다. 래퍼가 더하는 것은 마지막 `curriculum_json(r.id, v_uid, true)` 뿐.
- 운영 반영·배포·push·`next build` 금지(이 작업 범위).

## 함수 계약 (0056)

| 함수 | 반환 | 비고 |
|---|---|---|
| `node_update_core(p_slug text, p_node_id bigint, p_patch jsonb) → jsonb` | `{roomId, warnings, shifted}` | 0028 본문 그대로, 마지막 `return` 만 교체 |
| `node_update(...)` | `curriculum_json(roomId, current_user_id(), true) \|\| {warnings, shifted}` | 키 순서·내용 동일(jsonb) |
| `node_move_core(p_slug text, p_node_id bigint, p_parent_id bigint, p_index int) → bigint` | room id | 0006 본문, `return` 교체 |
| `node_move(...)` | `curriculum_json(room, uid, true)` | `node_indent`·`node_outdent` 는 node_move 를 그대로 부른다(변경 없음) |
| `personal_create_core(p_slug, p_round_id, p_title, p_start_date, p_end_date, p_description_md) → jsonb` | `{roomId, createdId, warnings}` | 기본값 없음(호출자가 모두 넘긴다) |
| `personal_create(...)` | `curriculum_json(...) \|\| {createdId, warnings}` | |
| `plan_run` | 불변 | `node_update`→`node_update_core`(2곳), `node_move`→`node_move_core`(1곳) |
| `personal_create_many` | 불변 | `personal_create`→`personal_create_core` |

## Review Focus

1. 웹 `node_update` 응답이 분리 전과 같아야 한다 — 특히 `warnings`(PERIOD_OUTSIDE_*, UNASSIGNED_TASK) 와 `shifted`(묶음 이동) 가 `curriculum_json` 키를 덮는 기존 병합 순서. → Task 1 회귀 테스트가 분리 전 결과를 고정.
2. 실패 경로(TASK_ARCHIVED·ASSIGNEE_HAS_SUBMISSION 등) 코드·순서 불변 — core 가 같은 문장을 같은 순서로 실행하므로 기존 `*-sql` 전체가 회귀망.
3. `plan_run` dry-run 되감기: core 가 서브트랜잭션 안에서 알림을 쓰고 되감기는 그대로여야 한다(`notifications` 요약 동일).
4. `personal_create` 기본 인자(`p_start_date`·`p_end_date` null → 회차∩방 기간) — 래퍼가 null 을 그대로 core 에 넘겨야 기본 기간이 같다.
5. 권한: `*_core` 가 authenticated 로 직접 불리지 않는다(EXECUTE 없음). → Task 1 테스트.

## 범위 밖 (개선안 B — 보고만)

- 호출마다 방 전체인 `room_leaf_stats`(저장 전 `v_open`·저장 후 TASK_ALL_SUBMITTED 판정), `assignment_resync`, `room_progress`(UNASSIGNED_TASK). 계획 끝에서 한 번으로 모으면 **TASK_ALL_SUBMITTED 판정이 담당 해제 직후 상태를 보지 못하고**(update op 의 담당 해제 → 즉시 모드 알림), UNASSIGNED_TASK 경고가 resync 전 값을 본다 → 알림·경고 판정 순서가 바뀐다. 이번에는 제외하고 A 이후 실측으로 필요성을 판단한다.

---

### Task 1: 회귀·성능 테스트 먼저 (실패 확인)

**Files:**
- Create: `supabase/tests/plan-core-sql.test.ts`

**Interfaces:**
- Consumes: `_harness.ts`(`openDb`·`applySeed`·`expectFail`), `_fixtures.ts`(`cases`·`one`·`nodeId`·`uidOf`), `_curriculum-helpers.ts`(`mkRoom`)
- Produces: `cjCalls(q) → number` 헬퍼 = `pg_stat_get_xact_function_calls('public.curriculum_json(bigint,uuid,boolean)'::regprocedure)` (사례 첫머리 `set local track_functions = 'all'`). PGlite 에서 동작 확인함(현재 트랜잭션 누적).

- [ ] **Step 1: 테스트 작성** — 사례:
  - `node_update 웹 응답 = curriculum_json || {warnings, shifted}`: 시드 aws 방에서 (a) 담당 지정(`assigneeIds`), (b) 기간을 방 밖으로(PERIOD_OUTSIDE_ROOM), (c) 회차 `shiftDescendants` 이동 각각 호출 → 응답에서 `warnings`·`shifted` 를 뺀 나머지가 같은 트랜잭션의 `curriculum_json(room, uid, true)` 와 `assertEquals`, `warnings`·`shifted` 는 기대값.
  - `node_move · personal_create 웹 응답 = curriculum_json(+createdId·warnings)` 같은 방식.
  - `plan_run 은 curriculum_json 을 부르지 않는다`: 담당 지정 create 3 + update 2(assigneeIds·endDate) + move 1 계획 preview·apply → 각각 `cjCalls` 증가 0. (분리 전: 6)
  - `personal_create_many 는 curriculum_json 을 부르지 않는다`: 목표 3개 → 증가 0. 결과 `count = 3`, `createdIds` 3개.
  - `웹 RPC 는 한 번만`: `node_update` 1회 → 증가 1.
  - `core 는 authenticated 가 직접 못 부른다`: `has_function_privilege('authenticated', 'public.node_update_core(text,bigint,jsonb)', 'execute')` 등 3개 false.
  - `큰 방 성능`: mkRoom → 회차 20 × 리프 50(~1,020노드, generate_series INSERT) + 멤버 2명 ACTIVE·방 ACTIVE → 담당 지정 create 48 개 계획 preview 시간 측정, `assert(ms < BOUND)`. BOUND 는 Step 2 에서 분리 전 시간을 재고 정한다. 〔실행 결과〕 PGlite 는 분리 전 10.4s → 후 6.9s(1,050노드면 120s → 53s) 이고 남은 시간의 대부분이 assignment_resync 라서, 차이가 기계 부하보다 작다. 그래서 상한은 15s 로 느슨하게 두고(회귀 감지용) 분리 여부는 호출 수 사례로 판정한다.
- [ ] **Step 2: 실패 확인** — `deno test -A --config supabase/tests/deno.json supabase/tests/plan-core-sql.test.ts` → core 미존재·호출 수 ≠ 0 으로 FAIL, 웹 응답 사례는 PASS(현재 동작 고정).

### Task 2: 0056 마이그레이션

**Files:**
- Create: `supabase/migrations/0056_plan_core_split.sql`

- [ ] **Step 1:** 「함수 계약」 표대로 다섯 판을 복사해 고친다. core 본문은 원본과 diff 가 `return` 줄(+ `declare` 에 필요한 변수)만 나야 한다 — `diff <(sed -n …0028…) <(sed -n …0056…)` 로 확인.
- [ ] **Step 2:** `plan-core-sql` PASS, 이어서 `npm run test:db` 중 `*-sql` 전체(`deno test -A --config supabase/tests/deno.json supabase/tests/*-sql.test.ts`) PASS.
- [ ] **Step 3:** `.claude/skills/verify-formal-exam-answer-exposure/SKILL.md` 대응표 `EditorSetEnd`·`EditorSetAssigned` 행을 `0056_plan_core_split.sql` `node_update_core` 로 갱신(`coverage.lock` 은 node_update 를 해시하지 않음 → `run.sh` drift 영향 없음, 실행해 종료 코드 확인).
- [ ] **Step 4:** `npm run lint`·`npx tsc --noEmit`·`npm test` PASS. 커밋(내 파일만 add).

### Task 3: 로컬 실측·스펙 반영

- [ ] **Step 1:** 로컬 Supabase·:3100 이 비었을 때(team-lead 신호) `supabase migration up` 으로 0056 적용 → `bench.mjs` 같은 조건(담당 48 + 방 1,098, NO_APPLY=1) 3회. 기준: 3s 안, 이전 3/3 TIMEOUT 과 비교.
- [ ] **Step 2:** 스펙 §11 해당 행에 실측 전후·0056·남은 B 를 적는다. 커밋.

## 운영 반영 순서 (이번 작업에서는 하지 않음)

1. 0055(exam-ai-toggle) 가 먼저 나가든 같이 나가든 무관(겹치는 함수 없음). 0056 은 함수 교체만 → 무중단, 앱 배포 불필요(TS 변경 없음).
2. 적용 후 확인: `select has_function_privilege('authenticated','public.node_update(text,bigint,jsonb)','execute')` true, core 3개 false. MCP preview 1회.
3. 롤백: 0057 로 0028·0006·0014·0038·0035 판을 다시 `create or replace`(core 는 남겨도 무해) — 데이터 변경 없음.

## 실행 결과 (2026-11-02)

- 로컬 Supabase, 같은 DB·한 트랜잭션, `set role anon` + `statement_timeout 3s` 로 `api_invoke` 직접 호출(MCP 라우트와 같은 DB 경로), 끝에 롤백했다. 방 1,115노드 + 담당 지정 48 미리보기: 0054 `TIMEOUT` ×3 → 0056 600·615·609ms. 개인 목표 20개: 1,033·1,027·1,040ms → 4.5·4.1·4.0ms.
- `*-db`(api-invoke·curriculum) 8/8 은 0056 적용 상태에서 통과했다. 이어서 되돌림 스크립트(위 「롤백」과 같은 내용)로 0054 정의를 복원하고 GRANT 유지까지 확인했다.
