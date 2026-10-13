# 슥터디 백엔드 Implementation Plan — 04 제출·알림·이탈·잡·태그 (Phase 4–6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 과제 제출(본문·링크·첨부 Storage), 인앱 알림(생성·목록·설정·dedupe), 그룹장의 이탈 처리, pg_cron 잡 6종, 태그 사전·자동 선택을 Postgres 함수로 구현하고 PGlite 테스트로 고정한다.

**Architecture:** 모든 쓰기는 `SECURITY DEFINER SET search_path = ''` 함수. 알림은 `notify_publish()` 한 함수가 설정 필터·본인 제외·`dedupe_key` 멱등·한국어 템플릿 렌더링을 전담하고, 0002/0005 의 placeholder 를 `CREATE OR REPLACE` 로 교체하므로 plan 02/03 이 이미 넣은 호출이 그대로 실알림이 된다. 제출은 `submission_upsert()` 한 번에 본문·링크 교체·파일 연결·전원 제출 감지를 끝낸다. 태그는 SQL 키워드 매칭이 기본, LLM Edge Function 은 선택.

**Tech Stack:** Supabase(Postgres 15, Storage, pg_cron), PL/pgSQL, Deno + `@electric-sql/pglite` 0.3 테스트, (선택) Supabase Edge Function + `@anthropic-ai/sdk`.

**Spec:** `docs/backend/01-decisions.md`(D8·D10·D11·D12), `docs/backend/02-domain-and-schema.md`(§2 테이블, §5 Storage 정책, §6 함수, §7 cron, §8 시드), `docs/backend/03-api.md`(§0 에러, §3 이탈, §5 제출, §7 태그·알림·설정), `docs/backend/analysis/cross-cutting.md` §2.3–2.6, `docs/backend/analysis/mystudy.md` §2.2·§2.3.3·§2.3.4·§2.5, 공통 계약은 `2026-10-13-backend-00-overview.md`.

## Global Constraints

- 00 개요 "Global Constraints" 전부 적용. 특히: 마이그레이션 파일은 `0007_submissions.sql`, `0008_notifications.sql`, `0009_tags.sql`, `0010_cron.sql` 만 새로 만들고 0001~0006 은 수정하지 않는다.
- 에러 코드는 `03-api.md` §0 목록만: `VALIDATION_FAILED`, `INVALID_LINK`, `LEAVE_DECISION_MISSING`, `REASSIGN_REQUIRED`, `AUTH_REQUIRED`, `ONBOARDING_REQUIRED`, `NOT_LEADER`, `TASK_NOT_ASSIGNED`, `ROOM_NOT_FOUND`, `NODE_NOT_FOUND`, `NOT_FOUND`, `ROOM_NOT_ACTIVE`, `ROOM_NOT_EDITABLE`, `NODE_NOT_LEAF`, `ASSIGNEE_NOT_MEMBER`, `MEMBER_NOT_ACTIVE`, `CANNOT_DEACTIVATE_LEADER`, `TASK_NOT_STARTED`, `TASK_ARCHIVED`, `FILE_LIMIT_EXCEEDED`, `FILE_NOT_READY`, `TAG_LIMIT_EXCEEDED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`. (`TAG_LABEL_INVALID`·`FILE_COUNT_EXCEEDED` 는 분석 문서에만 있고 §0 에 없으므로 쓰지 않는다 → `VALIDATION_FAILED`·`FILE_LIMIT_EXCEEDED`.)
- 제한값(D10): 본문 ≤ 50,000자 · 링크 ≤ 20개(`http(s)://`) · 파일 ≤ 5개 × 10,485,760 bytes · MIME `image/png, image/jpeg, image/gif, image/webp, application/pdf, application/zip, application/x-zip-compressed, text/plain, text/markdown`.
- Storage 객체 경로(버킷 `attachments` 안): `{room_id}/{node_id}/{user_id}/{file_uuid}-{name}`. `files.id` = 경로 4번째 세그먼트 앞 36자 UUID(클라이언트가 `crypto.randomUUID()` 로 생성).
- 알림 15종 `kind` 는 `03-api.md` §7 `NotificationKind` 문자열 그대로. 제목은 생성 시점에 한국어로 렌더링해 저장.
- 알림 시각(D8): 상태 전환·회차 시작 00:00 KST, 리마인더·일일 요약 09:00 KST. cron 은 UTC(`02 §7` 표 그대로).
- 태그: 방당 ≤ 8, 자동 선택 ≤ 5, 자유 입력 라벨 1~20자, 자동 결과는 MANUAL 보존 + 억제 목록 존중.
- "지금" 은 `public.app_now()`(이 플랜에서 추가, `app.now` 설정 우선) — 지각 경계 테스트용. `now()` 를 지각 판정에 직접 쓰지 않는다.
- 테스트: PGlite, 사례마다 `begin … rollback`, 시드 기준일 `set_config('app.today','2026-10-12',true)`. 숫자 id 는 쿼리에서 `::text` 로 받아 문자열로 다룬다(PGlite 의 int8 → BigInt 혼동 방지).

## Review Focus

1. **자정 경계 지각** — 마감 10/03 과제를 KST 10/04 00:00:30(UTC 10/03 15:00:30) 에 제출하면 `is_late=true`, 23:59:59 KST 는 `false`. → Task 2 테스트 `is_late boundary`.
2. **이탈자 분모** — 공통 과제를 제출한 멤버를 이탈 처리하면 회차 집계는 그 사람을 빼고(5/8) 제출물은 그룹장이 계속 읽는다. INACTIVE 를 다시 이탈 처리하면 `MEMBER_NOT_ACTIVE`. → Task 5 테스트.
3. **cron 재실행** — 모든 `job_*` 는 같은 날 두 번 돌려도 두 번째는 0건(`dedupe_key`), 다른 날이면 새 키. → Task 6 각 잡 테스트의 "idempotent" 사례.
4. **옵션 알림 꺼짐** — `room_notification_settings` 가 꺼진 kind 는 행이 생기지 않고 반환값 0, 설정 행이 없으면 기본 ON. → Task 3 테스트 `optional kind filtered`.
5. **그룹장이 지운 AUTO 태그 복귀 금지** — `room_tags_put` 으로 AUTO 태그를 빼면 `room_tag_suppressions` 에 남아 다음 `tag_autoselect` 가 다시 붙이지 않고, 수동으로 다시 넣으면 억제가 풀린다. → Task 7 테스트.

---

## 파일 구성

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0007_submissions.sql` | `app_now`, `allowed_mime_types`, `storage_exists`, `file_json`, `submission_json`, `submission_upsert`, `file_register`, `task_node_json`, `task_get` (I9 트리거는 0002, Storage 버킷·정책은 0003 소유 — 참조만) |
| `supabase/migrations/0008_notifications.sql` | `notify_render`, `notify_enabled`, **`notify_publish`(placeholder 교체)**, `notifications_*`, `settings_*`, `leader_room`, `member_deactivate_preview`, `member_deactivate`, `job_*` 5종, `member_count_audit` |
| `supabase/migrations/0009_tags.sql` | 태그 사전 시드 19종, `usage_count` 트리거, `tag_term_hit`, `tag_slug_for`, `room_tag_json`, `tags_search`, `room_tags_get`, `room_tags_put`, `tag_apply_auto`, `tag_autoselect`, `room_tags_suggest` |
| `supabase/migrations/0010_cron.sql` | `cron.schedule` 7줄 |
| `supabase/seed.sql` (append) | 알림 설정 행, 철수 알림 3건, 제출 링크 샘플 |
| `supabase/tests/_pglite-stubs.ts` (append) | `storage` 스키마 스텁, `auth.role()` |
| `supabase/tests/_boot.ts` | PGlite 부팅(스텁 → 마이그레이션 전부 → 시드) + 공용 헬퍼 |
| `supabase/tests/_submit.ts` | `submission_upsert` 호출 헬퍼(`submit`, `sqlArr`) — 테스트 파일끼리 import 하지 않기 위한 공용 모듈 |
| `supabase/tests/submissions-sql.test.ts`, `files-sql.test.ts`, `task-get-sql.test.ts`, `notifications-sql.test.ts`, `deactivate-sql.test.ts`, `jobs-sql.test.ts`, `tags-sql.test.ts`, `cron-sql.test.ts` | PGlite 사례. `files-db.test.ts` 는 로컬 Supabase 전용(Storage 정책) |
| `supabase/functions/_shared/auth.ts`, `supabase/functions/suggest-tags/{index.ts,deno.json}` | (선택) LLM 태그 제안 Edge Function — 키워드 `room_tags_suggest` 로 fallback |

## 선행 Phase 와의 인터페이스 (orchestrator 가 plan 01/02/03 과 대조할 것)

**이 플랜이 소비하는 것(0002~0006 에 있어야 함):**
- `public.current_user_id()` — PGlite 에서는 `nullif(current_setting('app.uid', true), '')::uuid`. `public.require_user()`, `public.kst_today()`, `public.kst_deadline(date)`, `public.fail(text, text, jsonb default null)`, `public.iso(timestamptz)`(null 입력 → null), `public.task_code(date, date, timestamptz, boolean, date)`, `public.leaf_state(int, int, date, date, date)`, `public.pct(int, int)`, `public.person_json(uuid)`.
- `public.is_task_assignee(p_node bigint, p_user uuid)`, `public.can_read_room(bigint)`, `public.can_read_submissions(bigint)`.
- `public.assignment_resync(p_room bigint)`, `public.membership_result(p_room bigint, p_user uuid)`, `public.room_transition_active(p_room bigint, p_actor uuid)`, `public.room_transition_ended(p_room bigint)`.
- placeholder `public.notify_publish(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb) returns int` — **인자 이름·타입이 정확히 같아야** `CREATE OR REPLACE` 가 통한다(다르면 0008 첫 줄의 `drop function if exists` 가 처리하지만, 의존 함수가 있으면 실패하므로 이름을 맞출 것).
- 테스트에서 호출하는 plan 02/03 함수(가정 시그니처, 다르면 테스트 쪽을 고친다): `room_apply(p_slug text, p_invite_token text default null)`, `room_approve(p_slug text, p_user uuid)`, `room_reject(p_slug text, p_user uuid)`, `node_update(p_slug text, p_node_id bigint, p_patch jsonb)`.
- `supabase/tests/_pglite-stubs.ts` 의 `PGLITE_STUBS` 문자열(auth.users, `auth.uid()`, cron 스텁, `anon/authenticated/service_role` 롤).
- 시드: 방 slug 9개, 닉네임(민수·지은·철수·하나·도윤·가은·서연·지훈·현우 …), aws 트리(1주차 IAM 정책 이해 DLDM / VPC 실습 DMDM, 2주차 EC2 인스턴스 유형 정리(지정: 지은 D·철수 O) / S3 스토리지 클래스 발표자료(지정: 하나 O), 3주차 10/15 시작), spring 1주차 "섹션 1~5 정리 노트" DDDDD(D = end_date 18:00 KST). 도윤은 aws INACTIVE.

**plan 02/03 쪽 호출 계약(이 플랜의 `notify_publish` 가 기대하는 인자) — 이미 들어간 호출을 이 표로 점검:**

| kind | p_room | p_node | p_actor | p_recipients | p_dedupe_prefix 예 | p_model 필수 키 |
|---|---|---|---|---|---|---|
| JOIN_REQUESTED | 방 | null | 신청자 | `[leader_id]` | `JOIN_REQUESTED:room=1:user=<uuid>` | 없음(닉네임은 actor 로 조회) |
| JOIN_APPROVED / JOIN_REJECTED | 방 | null | 그룹장 | `[신청자]` | `JOIN_APPROVED:room=1:user=<uuid>` | 없음 |
| JOIN_EXPIRED | 방 | null | null | PENDING 전원 | `JOIN_EXPIRED:room=1` | 없음 |
| ROOM_STARTED / ROOM_ENDED | 방 | null | 조기 시작 actor 또는 null | ACTIVE 전원 | `ROOM_STARTED:room=1` | 없음 |
| SCHEDULE_CHANGED | 방 | null | 그룹장 | ACTIVE 전원 | `SCHEDULE_CHANGED:room=1:tx=<txid_current()>` (저장 1회 = 1건) | 없음 |
| TASK_ASSIGNED / TASK_UNASSIGNED | 방 | 리프 | 그룹장 | 추가/제외된 사람 | `TASK_ASSIGNED:node=42:tx=<txid_current()>` | 없음 |
| ROOM_START_BLOCKED | 방 | null | null | `[leader_id]` | `ROOM_START_BLOCKED:room=1:d=2026-10-12` | 없음 |

제목·링크는 `notify_publish` 가 방·노드·actor 를 id 로 조회해 채운다. `p_model` 은 `DEADLINE_REMINDER` 의 `days`, `TASK_COMPLETION_DIGEST` 의 `count` 처럼 추가 값만 넣는다. `p_dedupe_prefix` 가 null 이면 dedupe 없음(쓰지 말 것).

**태그 자동 선택 훅(plan 02/03 에 들어가야 할 가드):** `room_create`·`room_update`·`node_create`·`node_update`·`node_delete`·`node_archive` 의 **끝**(커밋 직전)에 아래 블록을 둔다. 0009 가 아직 없을 때(Phase 2·3 테스트)도 깨지지 않는다.

```sql
  if to_regproc('public.tag_autoselect') is not null then
    perform public.tag_autoselect(v_room_id);   -- v_room_id: 해당 함수의 방 id 변수
  end if;
```

plan 02/03 에 이 가드가 빠졌다면: 아직 배포 전이므로 0004/0006 에 추가한다(배포 후라면 0011 에서 `CREATE OR REPLACE` 로 본문 전체를 다시 쓴다). Task 7 의 "node_update 가 태그를 다시 고른다" 테스트가 이를 검증한다.

---

### Task 1: 테스트 부팅 헬퍼 + Storage 스텁

**Files:**
- Modify: `supabase/tests/_pglite-stubs.ts` (문자열 끝에 storage 스텁 추가)
- Create: `supabase/tests/_boot.ts`
- Test: `supabase/tests/boot-sql.test.ts`

**Interfaces:**
- Consumes: `PGLITE_STUBS`(plan 01), `supabase/migrations/*.sql`, `supabase/seed.sql`.
- Produces: `bootDb(): Promise<{db, q}>`, `Q`, `one`, `asUser`, `setToday`, `setNow`, `uidOf`, `roomId`, `nodeId`, `expectFail`, `cases` — 이후 모든 테스트가 이것만 import.

- [ ] **Step 1: `_pglite-stubs.ts` 에 storage 스텁 추가**

`PGLITE_STUBS` 템플릿 문자열의 **맨 끝**(닫는 백틱 앞)에 붙인다. plan 01 이 `auth.uid()` 를 이미 정의했으면 그대로 두고 `auth.role()` 만 없을 때 추가한다.

```sql
-- ── storage 스텁 (0007 의 버킷·정책이 닿는 것만) ──
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null, owner_id text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name));
create or replace function storage.foldername(p_name text) returns text[] language sql immutable as
  $$ select (string_to_array(p_name, '/'))[1 : array_length(string_to_array(p_name, '/'), 1) - 1] $$;
create or replace function auth.role() returns text language sql stable as
  $$ select case when nullif(current_setting('app.uid', true), '') is null then 'anon' else 'authenticated' end $$;
```

- [ ] **Step 2: `_boot.ts` 작성**

```ts
// supabase/tests/_boot.ts — PGlite 에 스텁 → 마이그레이션 전부(번호순) → 시드를 올린다. 모든 *-sql.test.ts 가 공유.
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { PGLITE_STUBS } from "./_pglite-stubs.ts";

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;
export type Q = (sql: string, params?: unknown[]) => Promise<Row[]>;
export type Case = { name: string; run: (q: Q) => Promise<void> };

export async function bootDb(): Promise<{ db: PGlite; q: Q }> {
  const db = new PGlite();
  await db.exec(PGLITE_STUBS);
  const dir = new URL("../migrations/", import.meta.url);
  const files = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await db.exec(await Deno.readTextFile(new URL(f, dir)));
  await db.exec(await Deno.readTextFile(new URL("../seed.sql", import.meta.url)));
  const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as Row[];
  return { db, q };
}

export const one = async (q: Q, sql: string, p: unknown[] = []): Promise<Row> => (await q(sql, p))[0];
export const asUser = (q: Q, uid: string | null) => q("select set_config('app.uid', $1, true)", [uid ?? ""]);
export const setToday = (q: Q, d: string) => q("select set_config('app.today', $1, true)", [d]);
export const setNow = (q: Q, iso: string) => q("select set_config('app.now', $1, true)", [iso]);
export const uidOf = async (q: Q, nick: string) => (await one(q, "select id::text as id from public.profiles where nickname = $1", [nick])).id as string;
export const roomId = async (q: Q, slug: string) => (await one(q, "select id::text as id from public.rooms where slug = $1", [slug])).id as string;
export const nodeId = async (q: Q, slug: string, title: string) =>
  (await one(q, "select n.id::text as id from public.goal_nodes n join public.rooms r on r.id = n.room_id where r.slug = $1 and n.title = $2", [slug, title])).id as string;
export const uuids = (xs: string[]) => "{" + xs.join(",") + "}";

export async function expectFail(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    const msg = String((e as Error).message);
    if (msg.includes(code)) return;
    throw new Error(`expected ${code}, got: ${msg}`);
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

export function cases(group: string, db: PGlite, q: Q, list: Case[]) {
  for (const c of list) {
    Deno.test({ name: `${group}: ${c.name}`, sanitizeResources: false, sanitizeOps: false, fn: async () => {
      await db.exec("begin");
      try { await setToday(q, "2026-10-12"); await c.run(q); } finally { await db.exec("rollback"); }
    } });
  }
}
```

- [ ] **Step 3: 부팅 테스트 작성**

```ts
// supabase/tests/boot-sql.test.ts
import { assert, assertEquals } from "jsr:@std/assert";
import { bootDb, cases, one } from "./_boot.ts";

const { db, q } = await bootDb();
cases("boot", db, q, [
  { name: "seed loaded: 9 rooms, aws leader 민수", run: async (q) => {
    assertEquals(Number((await one(q, "select count(*)::int as n from public.rooms")).n), 9);
    const r = await one(q, "select p.nickname from public.rooms r join public.profiles p on p.id = r.leader_id where r.slug = 'aws'");
    assertEquals(r.nickname, "민수");
  } },
  { name: "storage stub present", run: async (q) => {
    assert((await q("select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects'")).length === 1);
  } },
]);
```

- [ ] **Step 4: 실행**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/boot-sql.test.ts`
Expected: 2 passed. (0007~0010 이 아직 없어도 통과해야 한다 — 마이그레이션 디렉터리를 그대로 읽으므로.)

- [ ] **Step 5: Commit**

```bash
git add supabase/tests/_pglite-stubs.ts supabase/tests/_boot.ts supabase/tests/boot-sql.test.ts
git commit -m "test(db): PGlite boot helper and storage stubs for phase 4-6

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

## Phase 4 — 제출 · 첨부 · 과제 상세 (`0007_submissions.sql`)

### Task 2: `app_now` · `submission_upsert` · 제출 JSON

**Files:**
- Create: `supabase/migrations/0007_submissions.sql` (이 태스크 분량. Task 3·4 가 같은 파일 끝에 이어 붙인다 — 배포 전까지는 한 파일을 계속 편집)
- Create: `supabase/tests/_submit.ts`
- Test: `supabase/tests/submissions-sql.test.ts`

**Interfaces:**
- Consumes: `require_user`, `kst_today`, `kst_deadline`, `fail`, `iso`, `is_task_assignee`, `room_leaf_stats(p_room)`(plan 02), `notify_publish`(0004 자리표 — Task 5 가 실구현으로 교체), 시드 aws 트리(plan 03).
- Produces:
  ```sql
  public.app_now() returns timestamptz                              -- app.now 설정 우선, 없으면 now(). 지각 판정은 이것만 쓴다
  public.allowed_mime_types() returns text[]                        -- D10 MIME 9종
  public.storage_exists(p_bucket text, p_path text) returns boolean -- storage.objects 존재 (D15 래퍼)
  public.file_json(p_file public.files) returns jsonb               -- FileMeta
  public.submission_json(p_sub bigint) returns jsonb                -- Submission DTO
  public.submission_upsert(p_node bigint, p_body text, p_links text[], p_file_ids uuid[]) returns jsonb   -- Submission
  ```
  Task 3(`file_register`)·Task 4(`task_get`)·Task 5(`TASK_ALL_SUBMITTED` 관찰)·Task 7(`job_completion_digest`) 가 의존.

- [ ] **Step 1: 공용 제출 헬퍼 `supabase/tests/_submit.ts`**

테스트 파일끼리 import 하면 Deno 가 그 파일의 테스트까지 다시 등록하므로 헬퍼는 별도 모듈에 둔다.

```ts
// supabase/tests/_submit.ts — submission_upsert 호출 헬퍼 (submissions·files·notifications·deactivate·jobs 테스트 공용)
import { one, uuids, type Q } from "./_boot.ts";

/** text[] 리터럴. 큰따옴표만 이스케이프 */
export const sqlArr = (xs: string[]) => "{" + xs.map((x) => '"' + x.replace(/"/g, '\\"') + '"').join(",") + "}";

/** 현재 app.uid 사용자로 제출. 반환: Submission DTO */
export const submit = async (q: Q, node: string, body = "제출 본문", links: string[] = [], files: string[] = []) =>
  (await one(q, "select public.submission_upsert($1::bigint, $2, $3::text[], $4::uuid[]) as s", [node, body, sqlArr(links), uuids(files)])).s;
```

- [ ] **Step 2: 실패하는 테스트 `supabase/tests/submissions-sql.test.ts`**

```ts
import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { asUser, bootDb, cases, expectFail, nodeId, one, roomId, setNow, uidOf } from "./_boot.ts";
import { submit } from "./_submit.ts";

const { db, q } = await bootDb();
const NOW = "2026-10-12T03:00:00Z";   // KST 10/12 12:00

cases("submissions", db, q, [
  { name: "upsert: first submit fixes firstSubmittedAt/isLate, second keeps them and replaces links", run: async (q) => {
    await setNow(q, NOW);
    await asUser(q, await uidOf(q, "철수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");          // 10-08 ~ 10-14, 철수 O(미제출)
    const a = await submit(q, ec2, "첫 제출", ["https://a.example/1", "http://b.example/2"]);
    assertEquals(a.isLate, false);
    assertEquals(a.firstSubmittedAt, "2026-10-12T03:00:00.000Z");
    assertEquals(a.links, ["https://a.example/1", "http://b.example/2"]);
    assertEquals(a.files, []);
    assertEquals(a.bodyMd, "첫 제출");

    await setNow(q, "2026-10-16T03:00:00Z");                                // 마감 뒤에 고쳐도 지각으로 바뀌지 않는다
    const b = await submit(q, ec2, "고친 본문", ["https://c.example/3"]);
    assertEquals(b.id, a.id);
    assertEquals(b.firstSubmittedAt, a.firstSubmittedAt);
    assertEquals(b.isLate, false);
    assertEquals(b.bodyMd, "고친 본문");
    assertEquals(b.links, ["https://c.example/3"]);
    assertNotEquals(b.updatedAt, a.updatedAt);
    const n = await one(q, "select count(*)::int as n from public.submissions where node_id = $1::bigint", [ec2]);
    assertEquals(n.n, 2);                                                   // 지은(시드 D) + 철수
  } },

  { name: "is_late boundary: KST 00:00:30 after deadline → late (Review Focus 1)", run: async (q) => {
    await setNow(q, "2026-10-03T15:00:30Z");                                // = KST 10/04 00:00:30, 마감 10/03
    await asUser(q, await uidOf(q, "하나"));
    const s = await submit(q, await nodeId(q, "aws", "IAM 정책 이해"));     // 하나 M(미제출)
    assertEquals(s.isLate, true);
  } },

  { name: "is_late boundary: KST 23:59:59 on the end date → on time", run: async (q) => {
    await setNow(q, "2026-10-03T14:59:59Z");
    await asUser(q, await uidOf(q, "하나"));
    const s = await submit(q, await nodeId(q, "aws", "IAM 정책 이해"));
    assertEquals(s.isLate, false);
  } },

  { name: "guards: ROOM_NOT_ACTIVE / TASK_ARCHIVED / TASK_NOT_ASSIGNED / TASK_NOT_STARTED / AUTH_REQUIRED", run: async (q) => {
    await setNow(q, NOW);
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");       // 하나만 지정
    const alb = await nodeId(q, "aws", "ALB vs NLB 실습");                  // 10-15 시작
    const vpc = await nodeId(q, "aws", "VPC 실습");

    await asUser(q, await uidOf(q, "가은"));                                 // sqld 그룹장, RECRUIT
    await expectFail(submit(q, await nodeId(q, "sqld", "데이터 모델링 요약 노트")), "ROOM_NOT_ACTIVE");
    await asUser(q, await uidOf(q, "현우"));                                 // algo 그룹장, ENDED
    await expectFail(submit(q, await nodeId(q, "algo", "1주차 문제 풀이")), "ROOM_NOT_ACTIVE");

    await asUser(q, await uidOf(q, "철수"));
    await expectFail(submit(q, s3), "TASK_NOT_ASSIGNED");
    await expectFail(submit(q, alb), "TASK_NOT_STARTED");
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [vpc]);
    await expectFail(submit(q, vpc), "TASK_ARCHIVED");

    await asUser(q, await uidOf(q, "도윤"));                                 // aws INACTIVE
    await expectFail(submit(q, ec2), "TASK_NOT_ASSIGNED");
    await asUser(q, await uidOf(q, "가은"));                                 // 비멤버
    await expectFail(submit(q, ec2), "TASK_NOT_ASSIGNED");
    await expectFail(submit(q, "999999"), "NODE_NOT_FOUND");
    await asUser(q, null);
    await expectFail(submit(q, ec2), "AUTH_REQUIRED");
  } },

  { name: "limits: body 50k, INVALID_LINK (scheme / count), FILE_LIMIT_EXCEEDED, FILE_NOT_READY", run: async (q) => {
    await setNow(q, NOW);
    const cheolsu = await uidOf(q, "철수");
    await asUser(q, cheolsu);
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await expectFail(submit(q, ec2, "a".repeat(50001)), "VALIDATION_FAILED");
    await expectFail(submit(q, ec2, "x", ["ftp://nope"]), "INVALID_LINK");
    await expectFail(submit(q, ec2, "x", ["javascript:alert(1)"]), "INVALID_LINK");
    await expectFail(submit(q, ec2, "x", Array.from({ length: 21 }, (_, i) => `https://l.example/${i}`)), "INVALID_LINK");
    await expectFail(submit(q, ec2, "x", [], Array.from({ length: 6 }, () => crypto.randomUUID())), "FILE_LIMIT_EXCEEDED");

    const pending = crypto.randomUUID();
    await q(`insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes, status)
             values ($1::uuid, $2::uuid, $3::bigint, $4::bigint, 'ATTACHMENT', $5, 'a.png', 'image/png', 10, 'PENDING')`,
            [pending, cheolsu, await roomId(q, "aws"), ec2, `${await roomId(q, "aws")}/${ec2}/${cheolsu}/${pending}-a.png`]);
    await expectFail(submit(q, ec2, "x", [], [pending]), "FILE_NOT_READY");
    await expectFail(submit(q, ec2, "x", [], [crypto.randomUUID()]), "NOT_FOUND");
    // 담당자 아닌 사람의 파일 id 를 끼워 넣어도 NOT_FOUND
    await asUser(q, await uidOf(q, "지은"));
    await expectFail(submit(q, ec2, "x", [], [pending]), "NOT_FOUND");
  } },

  { name: "stats: 1주차 stays 5/8 after a resubmission; 하나 submitting IAM makes it 6/8", run: async (q) => {
    await setNow(q, NOW);
    const stat = async () => one(q, `select coalesce(sum(ls.asg), 0)::int as asg, coalesce(sum(ls.sub), 0)::int as sub
      from public.room_leaf_stats($1::bigint) ls join public.goal_nodes rd on rd.id = ls.round_id where rd.label = '1주차'`, [await roomId(q, "aws")]);
    assertEquals(await stat(), { asg: 8, sub: 5 });
    await asUser(q, await uidOf(q, "철수"));
    await submit(q, await nodeId(q, "aws", "IAM 정책 이해"), "다시 제출");   // 철수는 이미 D → 갱신
    assertEquals(await stat(), { asg: 8, sub: 5 });
    await asUser(q, await uidOf(q, "하나"));
    await submit(q, await nodeId(q, "aws", "IAM 정책 이해"));
    assertEquals(await stat(), { asg: 8, sub: 6 });
  } },
]);
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/submissions-sql.test.ts`
Expected: FAIL — `function public.submission_upsert(bigint, text, text[], uuid[]) does not exist`.

- [ ] **Step 4: `supabase/migrations/0007_submissions.sql` 작성**

```sql
-- 0007_submissions.sql — 과제 제출 · 첨부 · 과제 상세 (플랜 04 Task 2~4)
-- 배포 후 수정 금지. Task 3·4 가 이 파일 끝에 이어 붙인다.

-- ───────── "지금" (D5 지각 판정, 테스트는 app.now 로 고정) ─────────
create or replace function public.app_now() returns timestamptz
language sql stable as $$
  select coalesce(nullif(current_setting('app.now', true), '')::timestamptz, now())
$$;

-- ───────── 제한값 (D10) ─────────
create or replace function public.allowed_mime_types() returns text[]
language sql immutable as $$
  select array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
               'application/zip', 'application/x-zip-compressed', 'text/plain', 'text/markdown']
$$;

-- ───────── Storage 래퍼 (D15: Supabase 전용 기능은 얇은 래퍼로 격리) ─────────
create or replace function public.storage_exists(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path)
$$;

-- ───────── JSON 빌더 (03-api §5 FileMeta · Submission) ─────────
create or replace function public.file_json(p_file public.files) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', p_file.id::text, 'name', p_file.original_name, 'contentType', p_file.content_type,
                            'size', p_file.size_bytes, 'status', lower(p_file.status))
$$;

-- links 는 sort_order 순, files 는 READY 만 created_at 순
create or replace function public.submission_json(p_sub bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id::text, 'bodyMd', s.body_md,
    'links', coalesce((select jsonb_agg(l.url order by l.sort_order) from public.submission_links l where l.submission_id = s.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(public.file_json(f) order by f.created_at, f.id)
                       from public.files f where f.submission_id = s.id and f.status = 'READY'), '[]'::jsonb),
    'firstSubmittedAt', public.iso(s.first_submitted_at), 'isLate', s.is_late, 'updatedAt', public.iso(s.updated_at))
  from public.submissions s where s.id = p_sub
$$;

-- ───────── submission_upsert (D10, mystudy §2.2) ─────────
-- 선행: 방 ACTIVE·미보관, 리프 미보관, 담당자(released 아님), today ≥ start_date.
-- 최초 제출만 first_submitted_at/is_late 를 정한다(이후 갱신은 본문·링크·첨부만, I9 트리거가 두 컬럼 변경을 막는다).
-- 링크는 전부 교체, 첨부는 목록대로 연결하고 빠진 첨부는 soft delete(job_cleanup 이 객체까지 지운다).
create or replace function public.submission_upsert(p_node bigint, p_body text, p_links text[], p_file_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  v_now   timestamptz := public.app_now();
  n       public.goal_nodes;
  r       public.rooms;
  v_body  text := coalesce(p_body, '');
  v_links text[] := coalesce(p_links, '{}');
  v_files uuid[] := coalesce(p_file_ids, '{}');
  v_link  text;
  v_fid   uuid;
  v_fst   text;
  v_sid   bigint;
  v_new   boolean;
  v_asg   int;
  v_sub   int;
  v_mode  text;
  i       int;
begin
  select * into n from public.goal_nodes where id = p_node for update;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  select * into r from public.rooms where id = n.room_id;
  if r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('ROOM_NOT_ACTIVE', '진행중인 스터디에서만 제출할 수 있어요');
  end if;
  if n.archived_at is not null then perform public.fail('TASK_ARCHIVED', '보관된 과제에는 제출할 수 없어요'); end if;
  if n.task_type is null or not public.is_task_assignee(n.id, v_uid) then
    perform public.fail('TASK_NOT_ASSIGNED', '이 과제의 담당자가 아니에요');
  end if;
  if v_today < n.start_date then
    perform public.fail('TASK_NOT_STARTED', '아직 시작되지 않은 과제예요', jsonb_build_object('startDate', to_char(n.start_date, 'YYYY-MM-DD')));
  end if;

  if length(v_body) > 50000 then
    perform public.fail('VALIDATION_FAILED', '본문은 50,000자까지예요', '{"field":"bodyMd"}'::jsonb);
  end if;
  if cardinality(v_links) > 20 then
    perform public.fail('INVALID_LINK', '링크는 20개까지예요', '{"field":"links","reason":"count"}'::jsonb);
  end if;
  for i in 1 .. cardinality(v_links) loop
    v_link := trim(v_links[i]);
    if v_link !~* '^https?://[^[:space:]]+$' or length(v_link) > 2000 then
      perform public.fail('INVALID_LINK', 'http(s):// 로 시작하는 링크만 넣을 수 있어요', jsonb_build_object('field', 'links', 'index', i - 1));
    end if;
    v_links[i] := v_link;
  end loop;
  if cardinality(v_files) > 5 then
    perform public.fail('FILE_LIMIT_EXCEEDED', '첨부는 5개까지예요', '{"field":"fileIds"}'::jsonb);
  end if;
  foreach v_fid in array v_files loop
    select status into v_fst from public.files
    where id = v_fid and owner_user_id = v_uid and node_id = n.id and purpose = 'ATTACHMENT';
    if not found then perform public.fail('NOT_FOUND', '첨부 파일을 찾을 수 없어요', jsonb_build_object('fileId', v_fid::text)); end if;
    if v_fst <> 'READY' then perform public.fail('FILE_NOT_READY', '업로드가 끝나지 않은 파일이 있어요', jsonb_build_object('fileId', v_fid::text)); end if;
  end loop;

  -- xmax = 0 이면 INSERT 된 행(최초 제출). ON CONFLICT 분기는 first_submitted_at/is_late 를 건드리지 않는다
  insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
  values (n.id, v_uid, v_body, v_now, v_now >= public.kst_deadline(n.end_date), v_now)
  on conflict (node_id, user_id) do update set body_md = excluded.body_md
  returning id, (xmax = 0) into v_sid, v_new;

  delete from public.submission_links where submission_id = v_sid;
  insert into public.submission_links (submission_id, url, sort_order)
  select v_sid, u.url, u.ord - 1 from unnest(v_links) with ordinality as u(url, ord);

  update public.files set submission_id = null, status = 'DELETED', deleted_at = now()
  where submission_id = v_sid and status = 'READY' and not (id = any(v_files));
  update public.files set submission_id = v_sid where id = any(v_files);

  -- 전원 제출 감지: 최초 제출일 때만 sub 가 바뀐다. IMMEDIATE 면 지금, DAILY_DIGEST 면 job_completion_digest(0008) 가 어제 완료분을 모은다
  if v_new then
    select ls.asg, ls.sub into v_asg, v_sub from public.room_leaf_stats(r.id) ls where ls.node_id = n.id;
    if coalesce(v_asg, 0) > 0 and v_sub = v_asg then
      select completion_mode into v_mode from public.room_notification_settings where room_id = r.id;
      if coalesce(v_mode, 'DAILY_DIGEST') = 'IMMEDIATE' then
        perform public.notify_publish('TASK_ALL_SUBMITTED', r.id, n.id, v_uid, array[r.leader_id],
                                      'TASK_ALL_SUBMITTED:node=' || n.id, '{}'::jsonb);
      end if;
    end if;
  end if;

  return public.submission_json(v_sid);
end $$;
```

- [ ] **Step 5: 실행해서 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/submissions-sql.test.ts`
Expected: 6 passed. `updatedAt` 비교가 같은 값으로 실패하면 `set_updated_at` 트리거(0002)가 `now()` 를 쓰는지 확인 — 두 upsert 가 같은 트랜잭션이라 `now()` 가 같다. 그 경우 테스트의 두 번째 호출 앞에 `await q("select pg_sleep(0.01)")` 대신 `assertNotEquals` 를 `assert(b.updatedAt >= a.updatedAt)` 로 완화하고 주석을 남긴다(같은 트랜잭션 안에서 `now()` 는 고정값이 정상).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_submissions.sql supabase/tests/_submit.ts supabase/tests/submissions-sql.test.ts
git commit -m "feat(db): 0007 submission_upsert with late boundary, links, attachments

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 3: `file_register` · Storage 연동

**Files:**
- Modify: `supabase/migrations/0007_submissions.sql` (끝에 추가)
- Test: `supabase/tests/files-sql.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `allowed_mime_types`, `storage_exists`, `file_json`, `submission_upsert`; 0003(plan 01 Task 6)의 버킷 `attachments`(private, `file_size_limit=10485760`, `allowed_mime_types`=D10) 와 정책 `attachments_insert_assignee`(본인 폴더 ∧ 담당자) / `attachments_select_member`(`can_read_submissions`) / `attachments_delete_own`. **버킷·정책은 0003 이 전부 만들었으므로 여기서는 추가하지 않는다** — Step 3 의 주석으로만 참조한다.
- Produces: `public.file_register(p_node bigint, p_path text, p_name text, p_mime text, p_size bigint) returns jsonb` — FileMeta(`status: "ready"`). 업로드 흐름(03-api §5): 프론트가 `crypto.randomUUID()` 로 `fileId` 를 만들고 Storage `upload('{room}/{node}/{uid}/{fileId}-{name}')` → `file_register` → `submission_upsert(fileIds)`.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/files-sql.test.ts`**

```ts
import { assertEquals } from "jsr:@std/assert";
import { asUser, bootDb, cases, expectFail, nodeId, one, roomId, setNow, uidOf, type Q } from "./_boot.ts";
import { submit } from "./_submit.ts";

const { db, q } = await bootDb();

/** Storage 업로드를 흉내 낸다(storage.objects 스텁 행). metadata.size 가 서버가 아는 크기 */
async function uploaded(q: Q, path: string, owner: string, size = 1234, mime = "image/png") {
  await q("insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3::jsonb)",
          [path, owner, JSON.stringify({ size, mimetype: mime })]);
}
const register = (q: Q, node: string, path: string, name: string, mime: string, size: number) =>
  one(q, "select public.file_register($1::bigint, $2, $3, $4, $5::bigint) as f", [node, path, name, mime, size]).then((r) => r.f);

cases("files", db, q, [
  { name: "file_register: READY row from an uploaded object; size comes from storage metadata", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    const fid = crypto.randomUUID();
    const path = `${room}/${ec2}/${cheolsu}/${fid}-노트.png`;
    await uploaded(q, path, cheolsu, 4096);
    const f = await register(q, ec2, path, "노트.png", "image/png", 1234);
    assertEquals(f, { id: fid, name: "노트.png", contentType: "image/png", size: 4096, status: "ready" });
    // 같은 파일을 다시 등록해도 멱등
    assertEquals((await register(q, ec2, path, "노트.png", "image/png", 1234)).id, fid);

    const s = await submit(q, ec2, "첨부 있음", [], [fid]);
    assertEquals(s.files.length, 1);
    assertEquals(s.files[0].id, fid);
    // 다음 제출에서 빼면 soft delete 되고 목록에서 사라진다
    const s2 = await submit(q, ec2, "첨부 뺌", [], []);
    assertEquals(s2.files, []);
    const row = await one(q, "select status, (deleted_at is not null) as del, submission_id from public.files where id = $1::uuid", [fid]);
    assertEquals([row.status, row.del, row.submission_id], ["DELETED", true, null]);
  } },

  { name: "file_register: FILE_NOT_READY without object, FILE_TYPE_NOT_ALLOWED, FILE_TOO_LARGE, bad path, TASK_NOT_ASSIGNED", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    const fid = crypto.randomUUID();
    const path = `${room}/${ec2}/${cheolsu}/${fid}-a.pdf`;
    await expectFail(register(q, ec2, path, "a.pdf", "application/pdf", 10), "FILE_NOT_READY");
    await uploaded(q, path, cheolsu, 10, "application/pdf");
    await expectFail(register(q, ec2, path, "a.pdf", "text/html", 10), "FILE_TYPE_NOT_ALLOWED");
    await expectFail(register(q, ec2, path, "", "application/pdf", 10), "VALIDATION_FAILED");
    await expectFail(register(q, ec2, `${room}/${ec2}/${await uidOf(q, "지은")}/${fid}-a.pdf`, "a.pdf", "application/pdf", 10), "VALIDATION_FAILED");
    await expectFail(register(q, ec2, `${room}/${ec2}/${cheolsu}/not-a-uuid-a.pdf`, "a.pdf", "application/pdf", 10), "VALIDATION_FAILED");

    const big = crypto.randomUUID();
    const bigPath = `${room}/${ec2}/${cheolsu}/${big}-big.zip`;
    await uploaded(q, bigPath, cheolsu, 10485761, "application/zip");
    await expectFail(register(q, ec2, bigPath, "big.zip", "application/zip", 10), "FILE_TOO_LARGE");

    await asUser(q, await uidOf(q, "가은"));
    await expectFail(register(q, ec2, path, "a.pdf", "application/pdf", 10), "TASK_NOT_ASSIGNED");
    await asUser(q, null);
    await expectFail(register(q, ec2, path, "a.pdf", "application/pdf", 10), "AUTH_REQUIRED");
  } },

  { name: "file_register: 6th file per user per node → FILE_LIMIT_EXCEEDED", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    const room = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, cheolsu);
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID();
      const p = `${room}/${ec2}/${cheolsu}/${id}-${i}.txt`;
      await uploaded(q, p, cheolsu, 10, "text/plain");
      await register(q, ec2, p, `${i}.txt`, "text/plain", 10);
    }
    const id = crypto.randomUUID();
    const p = `${room}/${ec2}/${cheolsu}/${id}-6.txt`;
    await uploaded(q, p, cheolsu, 10, "text/plain");
    await expectFail(register(q, ec2, p, "6.txt", "text/plain", 10), "FILE_LIMIT_EXCEEDED");
  } },

  { name: "bucket + policies from 0003 are what file_register relies on", run: async (q) => {
    const bk = await one(q, "select file_size_limit::text as lim, allowed_mime_types as m from storage.buckets where id = 'attachments'");
    assertEquals(bk.lim, "10485760");
    assertEquals((bk.m as string[]).length, 9);
    const mt = await one(q, "select public.allowed_mime_types() as m");
    assertEquals((mt.m as string[]).sort(), (bk.m as string[]).sort());
  } },
]);
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/files-sql.test.ts`
Expected: FAIL — `function public.file_register(...) does not exist`.

- [ ] **Step 3: 0007 끝에 `file_register` 추가**

```sql
-- ───────── file_register (03-api §5 complete, D10) ─────────
-- 클라이언트가 Storage 에 직접 올린 뒤 호출. 경로 {room_id}/{node_id}/{user_id}/{file_uuid}-{name} 를 검증하고 files 행을 READY 로 만든다.
-- 버킷·Storage 정책은 0003(플랜 01 Task 6) 소유: attachments(private, 10MB, MIME 화이트리스트),
--   insert = 본인 폴더 ∧ is_task_assignee, select = can_read_submissions, delete = 본인. 여기서는 만들지 않는다.
-- 크기는 Storage 가 기록한 metadata.size 를 우선한다(클라이언트 값은 참고용).
create or replace function public.file_register(p_node bigint, p_path text, p_name text, p_mime text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  n      public.goal_nodes;
  r      public.rooms;
  v_seg  text[];
  v_id   uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_cnt  int;
  v_meta jsonb;
  v_size bigint;
  f      public.files;
begin
  select * into n from public.goal_nodes where id = p_node;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  select * into r from public.rooms where id = n.room_id;
  if r.status <> 'ACTIVE' or r.archived_at is not null then perform public.fail('ROOM_NOT_ACTIVE', '진행중인 스터디에서만 첨부할 수 있어요'); end if;
  if n.archived_at is not null then perform public.fail('TASK_ARCHIVED', '보관된 과제에는 첨부할 수 없어요'); end if;
  if not public.is_task_assignee(n.id, v_uid) then perform public.fail('TASK_NOT_ASSIGNED', '이 과제의 담당자가 아니에요'); end if;

  v_seg := string_to_array(coalesce(p_path, ''), '/');
  if cardinality(v_seg) <> 4 or v_seg[1] <> r.id::text or v_seg[2] <> n.id::text or v_seg[3] <> v_uid::text
     or v_seg[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-.+$' then
    perform public.fail('VALIDATION_FAILED', '첨부 경로가 올바르지 않아요', '{"field":"path"}'::jsonb);
  end if;
  v_id := left(v_seg[4], 36)::uuid;
  if length(v_name) < 1 or length(v_name) > 255 then
    perform public.fail('VALIDATION_FAILED', '파일 이름은 1~255자예요', '{"field":"name"}'::jsonb);
  end if;
  if p_mime is null or not (p_mime = any(public.allowed_mime_types())) then
    perform public.fail('FILE_TYPE_NOT_ALLOWED', '허용되지 않는 파일 형식이에요', jsonb_build_object('field', 'contentType', 'contentType', p_mime));
  end if;
  if p_size is null or p_size < 1 then
    perform public.fail('VALIDATION_FAILED', '파일 크기가 올바르지 않아요', '{"field":"size"}'::jsonb);
  end if;

  if not public.storage_exists('attachments', p_path) then
    perform public.fail('FILE_NOT_READY', '업로드가 아직 끝나지 않았어요', jsonb_build_object('fileId', v_id::text));
  end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'attachments' and o.name = p_path;
  v_size := coalesce((v_meta ->> 'size')::bigint, p_size);
  if v_size > 10485760 then
    perform public.fail('FILE_TOO_LARGE', '파일은 10MB까지예요', jsonb_build_object('field', 'size', 'size', v_size));
  end if;

  select count(*) into v_cnt from public.files
  where owner_user_id = v_uid and node_id = n.id and purpose = 'ATTACHMENT' and status in ('PENDING', 'READY') and id <> v_id;
  if v_cnt >= 5 then perform public.fail('FILE_LIMIT_EXCEEDED', '첨부는 과제당 5개까지예요', '{"field":"fileIds"}'::jsonb); end if;

  insert into public.files (id, owner_user_id, room_id, node_id, purpose, bucket_id, object_path, original_name, content_type, size_bytes, status, completed_at)
  values (v_id, v_uid, r.id, n.id, 'ATTACHMENT', 'attachments', p_path, v_name, p_mime, v_size, 'READY', now())
  on conflict (id) do update
    set status = 'READY', completed_at = now(), size_bytes = excluded.size_bytes, deleted_at = null
    where public.files.owner_user_id = excluded.owner_user_id and public.files.node_id = excluded.node_id
  returning * into f;
  if f.id is null then perform public.fail('NOT_FOUND', '다른 사용자의 파일 id 예요', jsonb_build_object('fileId', v_id::text)); end if;
  return public.file_json(f);
end $$;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/files-sql.test.ts supabase/tests/submissions-sql.test.ts`
Expected: 4 + 6 = 10 passed.

- [ ] **Step 5: 로컬 Supabase 에서 Storage 정책 실측 (`SUPABASE_URL` 있을 때만, 선택)**

`supabase/tests/files-db.test.ts` 를 만들어 plan 01 `_testenv.ts` 의 `userClient()` 로 (a) 담당자가 아닌 사용자의 `storage.from('attachments').upload('6/<ec2>/<uid>/<uuid>-x.png', blob)` 가 403, (b) 담당자 본인 폴더 업로드 성공 후 `file_register` 가 `ready` 를 돌려주는지 확인한다. 시드 사용자는 비밀번호가 없으므로 테스트 사용자를 aws 에 `room_join` 시키는 대신 `service()` 로 `room_members`·`task_assignments` 행을 직접 넣고 끝에 지운다(`RUN` 태그). PGlite 는 RLS 를 강제하지 않으므로 이 사례만 로컬 전용.

```ts
import { assertEquals } from "jsr:@std/assert";
import { dbTest, service, userClient } from "./_testenv.ts";

dbTest("storage: non-assignee upload rejected, assignee upload + file_register ready", async () => {
  const { u, c } = await userClient(1);
  const admin = service();
  const ec2 = (await admin.from("goal_nodes").select("id, room_id").eq("title", "EC2 인스턴스 유형 정리").single()).data!;
  const fid = crypto.randomUUID();
  const path = `${ec2.room_id}/${ec2.id}/${u.id}/${fid}-x.png`;
  const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const denied = await c.storage.from("attachments").upload(path, blob, { contentType: "image/png" });
  assertEquals(Boolean(denied.error), true);

  await admin.from("profiles").update({ nickname: "t1", nickname_normalized: "t1" }).eq("id", u.id);
  await admin.from("room_members").upsert({ room_id: ec2.room_id, user_id: u.id, role: "MEMBER", status: "ACTIVE", joined_at: new Date().toISOString() });
  await admin.from("task_assignments").upsert({ node_id: ec2.id, user_id: u.id, source: "DESIGNATED" });
  try {
    const ok = await c.storage.from("attachments").upload(path, blob, { contentType: "image/png" });
    assertEquals(ok.error, null);
    const { data, error } = await c.rpc("file_register", { p_node: ec2.id, p_path: path, p_name: "x.png", p_mime: "image/png", p_size: 4 });
    assertEquals(error, null);
    assertEquals(data.status, "ready");
  } finally {
    await admin.storage.from("attachments").remove([path]);
    await admin.from("files").delete().eq("id", fid);
    await admin.from("task_assignments").delete().eq("node_id", ec2.id).eq("user_id", u.id);
    await admin.from("room_members").delete().eq("room_id", ec2.room_id).eq("user_id", u.id);
  }
});
```

Run: `eval "$(supabase status -o env)"; SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY deno test --allow-read --allow-env --allow-net supabase/tests/files-db.test.ts`
Expected: 1 passed (환경변수 없으면 ignored 1). `member_count` 는 직접 넣은 행 때문에 어긋나지만 `member_count_audit()`(Task 7) 이 보정하므로 finally 에서 지우면 된다.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_submissions.sql supabase/tests/files-sql.test.ts supabase/tests/files-db.test.ts
git commit -m "feat(db): file_register validates path, MIME, size, count against storage

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 4: `task_get` — TaskDetail JSON

**Files:**
- Modify: `supabase/migrations/0007_submissions.sql` (끝에 추가)
- Test: `supabase/tests/task-get-sql.test.ts`

**Interfaces:**
- Consumes: `room_readable(p_room, p_uid, p_token)`(plan 02), `can_read_submissions`, `can_read_submission(p_node, p_author)`, `is_task_assignee`, `task_code`, `leaf_state`, `pct`, `person_json`, Task 2 `submission_json`.
- Produces:
  ```sql
  public.task_node_json(p_node bigint, p_uid uuid) returns jsonb   -- 리프 NodeDto(03-api §4). people 는 로그인 사용자에게만
  public.task_get(p_slug text, p_node bigint) returns jsonb        -- TaskDetail + today
  ```
  `path` 는 회차부터 **과제 자신까지**(`[{id,title,label}]`, 방은 프론트가 slug 로 앞에 붙인다). `submissions` 는 `can_read_submissions` 일 때만, 보관 노드는 그룹장·작성자 것만(`can_read_submission`).

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/task-get-sql.test.ts`**

```ts
import { assertEquals } from "jsr:@std/assert";
import { asUser, bootDb, cases, expectFail, nodeId, one, setNow, uidOf, type Q } from "./_boot.ts";

const { db, q } = await bootDb();
const get = async (q: Q, slug: string, node: string) => (await one(q, "select public.task_get($1, $2::bigint) as t", [slug, node])).t;

cases("task_get", db, q, [
  { name: "assignee view: node, path, people, mySubmission null, isAssignee, allSubmitted false, submissions", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, await uidOf(q, "철수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const t = await get(q, "aws", ec2);
    assertEquals(t.today, "2026-10-12");
    assertEquals(t.node.id, ec2);
    assertEquals(t.node.task.type, "designated");
    assertEquals(t.node.task.people.map((p: { nickname: string; status: string }) => [p.nickname, p.status]), [["지은", "done"], ["철수", "open"]]);
    assertEquals([t.node.task.assigned, t.node.task.submitted, t.node.task.state, t.node.pct], [2, 1, "progress", 50]);
    assertEquals(t.path.map((p: { label: string | null; title: string }) => [p.label, p.title]), [["2주차", "EC2·S3"], [null, "EC2 인스턴스 유형 정리"]]);
    assertEquals(t.mySubmission, null);
    assertEquals(t.isAssignee, true);
    assertEquals(t.allSubmitted, false);
    assertEquals(t.submissions.length, 1);
    assertEquals(t.submissions[0].author.nickname, "지은");
    assertEquals(typeof t.submissions[0].bodyMd, "string");
  } },

  { name: "after submitting: mySubmission filled, allSubmitted true, submissions 2", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await asUser(q, await uidOf(q, "철수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await q("select public.submission_upsert($1::bigint, '내 제출', '{}'::text[], '{}'::uuid[])", [ec2]);
    const t = await get(q, "aws", ec2);
    assertEquals(t.mySubmission.bodyMd, "내 제출");
    assertEquals(t.allSubmitted, true);
    assertEquals(t.node.task.state, "complete");
    assertEquals(t.submissions.length, 2);
  } },

  { name: "anon on a public room: meta only — people [], submissions [], isAssignee false", run: async (q) => {
    await asUser(q, null);
    const t = await get(q, "aws", await nodeId(q, "aws", "EC2 인스턴스 유형 정리"));
    assertEquals(t.node.task.people, []);
    assertEquals([t.node.task.assigned, t.node.task.submitted], [2, 1]);   // 집계 숫자는 공개
    assertEquals(t.submissions, []);
    assertEquals(t.mySubmission, null);
    assertEquals(t.isAssignee, false);
  } },

  { name: "non-member logged in: submissions []; PENDING sees meta; INACTIVE (도윤) still reads submissions", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, await uidOf(q, "가은"));
    assertEquals((await get(q, "aws", ec2)).submissions, []);
    await asUser(q, await uidOf(q, "도윤"));
    const t = await get(q, "aws", ec2);
    assertEquals(t.submissions.length, 1);
    assertEquals(t.isAssignee, false);
  } },

  { name: "archived node: leader sees all submissions, member sees only own (Review Focus 2 반쪽)", run: async (q) => {
    const iam = await nodeId(q, "aws", "IAM 정책 이해");                    // DLDM → 민수·지은·철수 3건
    await q("update public.goal_nodes set archived_at = now() where id = $1::bigint", [iam]);
    await asUser(q, await uidOf(q, "민수"));
    const leader = await get(q, "aws", iam);
    assertEquals(leader.node.archived, true);
    assertEquals(leader.submissions.length, 3);
    await asUser(q, await uidOf(q, "철수"));
    const me = await get(q, "aws", iam);
    assertEquals(me.submissions.map((s: { author: { nickname: string } }) => s.author.nickname), ["철수"]);
    assertEquals(me.mySubmission !== null, true);
  } },

  { name: "errors: private room anon → ROOM_NOT_FOUND, foreign node → NODE_NOT_FOUND, round → NODE_NOT_LEAF", run: async (q) => {
    await asUser(q, null);
    await expectFail(get(q, "spring", await nodeId(q, "spring", "섹션 1~5 정리 노트")), "ROOM_NOT_FOUND");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(get(q, "aws", await nodeId(q, "spring", "섹션 1~5 정리 노트")), "NODE_NOT_FOUND");
    await expectFail(get(q, "aws", await nodeId(q, "aws", "EC2·S3")), "NODE_NOT_LEAF");
    await expectFail(get(q, "nope", "1"), "ROOM_NOT_FOUND");
  } },
]);
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/task-get-sql.test.ts`
Expected: FAIL — `function public.task_get(text, bigint) does not exist`.

- [ ] **Step 3: 0007 끝에 `task_node_json`·`task_get` 추가**

```sql
-- ───────── 과제 상세 (03-api §5 TaskDetail) ─────────
-- 리프 NodeDto. 집계(assigned/submitted/pct)는 공개, 사람별 상태(people)는 로그인 사용자에게만(D7: 비로그인은 people []).
-- 보관 노드도 직접 집계한다(room_leaf_stats 는 보관을 제외하므로 쓰지 않는다).
create or replace function public.task_node_json(p_node bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id::text, 'parentId', n.parent_id::text, 'roundId', n.round_id::text, 'depth', n.depth, 'sortOrder', n.sort_order,
    'label', n.label, 'title', n.title, 'descriptionMd', n.description_md,
    'startDate', to_char(n.start_date, 'YYYY-MM-DD'), 'endDate', to_char(n.end_date, 'YYYY-MM-DD'),
    'archived', n.archived_at is not null,
    'task', jsonb_build_object(
      'type', lower(n.task_type),
      'people', case when p_uid is null then '[]'::jsonb else coalesce((
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
  cross join lateral (
    select count(a.id)::int as asg, count(s.id)::int as sub
    from public.task_assignments a
    left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
    where a.node_id = n.id and a.released_at is null) st
  where n.id = p_node and n.task_type is not null
$$;

-- 권한: 방을 읽을 수 있으면 메타, can_read_submissions 면 제출물(보관 노드는 그룹장·작성자 것만 — can_read_submission)
create or replace function public.task_get(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.current_user_id();
  r      public.rooms;
  n      public.goal_nodes;
  v_path jsonb;
  v_mine jsonb := null;
  v_subs jsonb := '[]'::jsonb;
  v_asg  int;
  v_sub  int;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '말단 과제만 상세를 볼 수 있어요'); end if;

  with recursive up as (
    select g.id, g.parent_id, g.title, g.label, 0 as lvl from public.goal_nodes g where g.id = n.id
    union all
    select g.id, g.parent_id, g.title, g.label, up.lvl + 1 from public.goal_nodes g join up on g.id = up.parent_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', up.id::text, 'title', up.title, 'label', up.label) order by up.lvl desc), '[]'::jsonb)
  into v_path from up;

  select count(a.id)::int, count(s.id)::int into v_asg, v_sub
  from public.task_assignments a
  left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
  where a.node_id = n.id and a.released_at is null;

  if v_uid is not null then
    select public.submission_json(s.id) into v_mine from public.submissions s where s.node_id = n.id and s.user_id = v_uid;
  end if;

  if public.can_read_submissions(r.id) then
    select coalesce(jsonb_agg(public.submission_json(s.id) || jsonb_build_object('author', public.person_json(s.user_id))
                              order by s.first_submitted_at, s.id), '[]'::jsonb)
    into v_subs
    from public.submissions s
    where s.node_id = n.id and public.can_read_submission(n.id, s.user_id);
  end if;

  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'node', public.task_node_json(n.id, v_uid),
    'path', v_path,
    'mySubmission', v_mine,
    'isAssignee', v_uid is not null and public.is_task_assignee(n.id, v_uid),
    'allSubmitted', v_asg > 0 and v_sub = v_asg,
    'submissions', v_subs);
end $$;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/task-get-sql.test.ts`
Expected: 6 passed. "archived node" 사례의 3건은 plan 03 시드가 IAM `DLDM` 을 민수 D·지은 L·철수 D 로 넣었을 때의 값 — 다르면 시드를 고치지 말고 `src/data/my-study.ts` 와 대조한다.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_submissions.sql supabase/tests/task-get-sql.test.ts
git commit -m "feat(db): task_get TaskDetail with path, people, submissions visibility

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

## Phase 5 — 알림 · 이탈 처리 · cron 잡 (`0008_notifications.sql`)

### Task 5: `notify_publish` 실구현 · 알림 목록/읽음 · 방 알림 설정

**Files:**
- Create: `supabase/migrations/0008_notifications.sql` (이 태스크 분량. Task 6·7 이 같은 파일 끝에 이어 붙인다)
- Test: `supabase/tests/notifications-sql.test.ts`

**Interfaces:**
- Consumes: 0004 의 placeholder `notify_publish(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb) returns int`(**같은 시그니처로 CREATE OR REPLACE**), `room_lock(p_slug)`, `room_readable`, `require_user`, `current_user_id`, `person_json`, `iso`, `fail`. 검증용으로 plan 02 `room_apply(p_slug)`, `room_approve(p_slug, p_user)`, `room_tick()`, plan 03 `node_update(p_slug, p_node_id, p_patch)`, Task 2 `submission_upsert`.
- Produces:
  ```sql
  public.notification_kinds() returns text[]                                   -- 15종
  public.notify_enabled(p_kind text, p_room bigint, p_model jsonb) returns boolean   -- 방 설정 필터, 행 없으면 true
  public.notify_render(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_model jsonb) returns jsonb  -- {title, body}
  public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text                     -- D8 링크 규칙(수신자별)
  public.notify_publish(...) returns int                                       -- 실제 생성 건수. 본인 제외, dedupe_key = prefix||':'||user
  public.notification_json(p_n public.notifications) returns jsonb            -- Notification DTO
  public.notifications_list(p_cursor text default null, p_limit int default 20) returns jsonb   -- {items, nextCursor}
  public.notifications_unread_count() returns jsonb                            -- {count}
  public.notifications_read(p_id bigint) returns void                          -- 본인 것 아니면 NOT_FOUND
  public.notifications_read_all() returns jsonb                                -- {updated}
  public.leader_room(p_slug text, p_lock boolean default false) returns public.rooms   -- require_user + NOT_LEADER
  public.settings_json(p_room bigint) returns jsonb                            -- NotificationSettings
  public.settings_get(p_slug text) returns jsonb
  public.settings_put(p_slug text, p_settings jsonb) returns jsonb             -- 전체 교체
  ```
  Task 6(`leader_room`, `notify_publish`), Task 7(`notify_publish`), Task 8(`leader_room`), plan 05 어댑터(`notifications_*`, `settings_*`) 가 의존. 내부 함수(`notify_*`, `storage_exists`)는 `anon/authenticated` 실행 권한을 회수한다.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/notifications-sql.test.ts`**

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import { asUser, bootDb, cases, expectFail, nodeId, one, roomId, setNow, setToday, uidOf, uuids, type Q } from "./_boot.ts";
import { submit } from "./_submit.ts";

const { db, q } = await bootDb();

/** notify_publish 직접 호출(테스트는 수퍼유저라 권한 회수에 걸리지 않는다). 반환: 생성 건수 */
const publish = async (q: Q, kind: string, room: string, node: string | null, actor: string | null, to: string[], prefix: string, model = "{}") =>
  Number((await one(q, "select public.notify_publish($1, $2::bigint, $3::bigint, $4::uuid, $5::uuid[], $6, $7::jsonb) as n",
                     [kind, room, node, actor, uuids(to), prefix, model])).n);
/** 시드 §4 의 'seed:*' 행은 제외한다(철수에게 3건 있다) */
const rowsOf = (q: Q, uid: string, kind?: string) =>
  q(`select kind, title, body, link, node_id::text as node_id, actor_user_id::text as actor, read_at from public.notifications
     where user_id = $1::uuid and ($2::text is null or kind = $2) and coalesce(dedupe_key, '') not like 'seed:%' order by id`,
    [uid, kind ?? null]);

cases("notifications", db, q, [
  { name: "dedupe: same prefix twice → 1 then 0 (Review Focus 3)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const cheolsu = await uidOf(q, "철수");
    assertEquals(await publish(q, "ROOM_STARTED", aws, null, null, [cheolsu], `ROOM_STARTED:${aws}`), 1);
    assertEquals(await publish(q, "ROOM_STARTED", aws, null, null, [cheolsu], `ROOM_STARTED:${aws}`), 0);
    assertEquals((await rowsOf(q, cheolsu, "ROOM_STARTED")).length, 1);
    // 다른 prefix 면 새 행
    assertEquals(await publish(q, "ROOM_STARTED", aws, null, null, [cheolsu], `ROOM_STARTED:${aws}:again`), 1);
  } },

  { name: "actor excluded; duplicates and nulls in recipients collapse", run: async (q) => {
    const aws = await roomId(q, "aws");
    const minsu = await uidOf(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    const n = await publish(q, "SCHEDULE_CHANGED", aws, null, minsu, [minsu, cheolsu, cheolsu], `SCHEDULE_CHANGED:${aws}:tx=1`);
    assertEquals(n, 1);
    assertEquals((await rowsOf(q, minsu, "SCHEDULE_CHANGED")).length, 0);
    const r = await rowsOf(q, cheolsu, "SCHEDULE_CHANGED");
    assertEquals(r.length, 1);
    assertEquals(r[0].actor, minsu);
    assertEquals(r[0].title, "AWS SAA 자격증 3개월 완주 일정이 변경됐어요");
    assertEquals(r[0].link, "/my-study/aws");
  } },

  { name: "optional kind filtered by room settings; missing settings row = ON (Review Focus 4)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const cheolsu = await uidOf(q, "철수");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await q("update public.room_notification_settings set reminder_d1 = false where room_id = $1::bigint", [aws]);
    assertEquals(await publish(q, "DEADLINE_REMINDER", aws, ec2, null, [cheolsu], `DEADLINE_REMINDER:node=${ec2}:d=1`, '{"days":1}'), 0);
    assertEquals(await publish(q, "DEADLINE_REMINDER", aws, ec2, null, [cheolsu], `DEADLINE_REMINDER:node=${ec2}:d=3`, '{"days":3}'), 1);
    await q("update public.room_notification_settings set task_assigned = false, room_start_end = false where room_id = $1::bigint", [aws]);
    assertEquals(await publish(q, "TASK_ASSIGNED", aws, ec2, null, [cheolsu], `TASK_ASSIGNED:node=${ec2}:tx=9`), 0);
    assertEquals(await publish(q, "TASK_UNASSIGNED", aws, ec2, null, [cheolsu], `TASK_UNASSIGNED:node=${ec2}:tx=9`), 0);
    assertEquals(await publish(q, "ROOM_ENDED", aws, null, null, [cheolsu], `ROOM_ENDED:${aws}`), 0);
    // 기본·잠금 kind 는 설정과 무관
    assertEquals(await publish(q, "ROUND_STARTED", aws, await nodeId(q, "aws", "EC2·S3"), null, [cheolsu], `ROUND_STARTED:node=x`), 1);
    // 설정 행이 없으면 기본 ON
    await q("delete from public.room_notification_settings where room_id = $1::bigint", [aws]);
    assertEquals(await publish(q, "DEADLINE_REMINDER", aws, ec2, null, [cheolsu], `DEADLINE_REMINDER:node=${ec2}:d=1:b`, '{"days":1}'), 1);
  } },

  { name: "titles and links per kind (Korean templates, task link carries ?task=)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const round3 = await nodeId(q, "aws", "고가용성 아키텍처");
    const minsu = await uidOf(q, "민수");
    const cheolsu = await uidOf(q, "철수");
    const gaeun = await uidOf(q, "가은");          // 비멤버

    await publish(q, "DEADLINE_REMINDER", aws, ec2, null, [cheolsu], `DR:${ec2}`, '{"days":1}');
    await publish(q, "JOIN_REQUESTED", aws, null, gaeun, [minsu], `JR:${gaeun}`);
    await publish(q, "JOIN_REJECTED", aws, null, minsu, [gaeun], `JX:${gaeun}`);
    await publish(q, "ROUND_STARTED", aws, round3, null, [cheolsu], `RS:${round3}`);
    await publish(q, "TASK_COMPLETION_DIGEST", aws, null, null, [minsu], `TCD:${aws}`, '{"count":3}');
    await publish(q, "TASK_ALL_SUBMITTED", aws, ec2, cheolsu, [minsu], `TAS:${ec2}`);
    await publish(q, "MEMBER_DEACTIVATED", aws, null, minsu, [cheolsu], `MD:${cheolsu}`);
    await publish(q, "ROOM_START_BLOCKED", aws, null, null, [minsu], `RSB:${aws}`);

    const c = await rowsOf(q, cheolsu);
    assertEquals(c.map((r) => [r.kind, r.title, r.link]), [
      ["DEADLINE_REMINDER", '"EC2 인스턴스 유형 정리" 마감 1일 전이에요', `/my-study/aws?task=${ec2}`],
      ["ROUND_STARTED", "AWS SAA 자격증 3개월 완주의 3주차가 시작됐어요", "/my-study/aws"],
      ["MEMBER_DEACTIVATED", "AWS SAA 자격증 3개월 완주 스터디에서 이탈 처리됐어요", "/my-study/aws"],
    ]);
    assertEquals(c[0].body, "AWS SAA 자격증 3개월 완주");                      // 과제 이벤트는 body 에 방 제목
    const m = await rowsOf(q, minsu);
    assertEquals(m.map((r) => [r.kind, r.title, r.link]), [
      ["JOIN_REQUESTED", "가은님이 AWS SAA 자격증 3개월 완주 참가를 신청했어요", "/my-study/aws"],
      ["TASK_COMPLETION_DIGEST", "어제 3개 과제가 전원 제출됐어요", "/my-study/aws"],
      ["TASK_ALL_SUBMITTED", '"EC2 인스턴스 유형 정리" 과제를 전원 제출했어요', `/my-study/aws?task=${ec2}`],
      ["ROOM_START_BLOCKED", "AWS SAA 자격증 3개월 완주 시작일이 지났지만 말단 과제가 없어 시작하지 못했어요", "/my-study/aws"],
    ]);
    const g = await rowsOf(q, gaeun);
    assertEquals(g.map((r) => [r.kind, r.link]), [["JOIN_REJECTED", "/rooms/aws"]]);   // 비참가자는 /rooms

    await expectFail(publish(q, "NOPE", aws, null, null, [cheolsu], "x"), "VALIDATION_FAILED");
    assertEquals(await publish(q, "ROOM_STARTED", aws, null, null, [], `empty:${aws}`), 0);
  } },

  { name: "list: cursor paging 20+8, unread_count, read, read_all, foreign id → NOT_FOUND", run: async (q) => {
    const aws = await roomId(q, "aws");
    const cheolsu = await uidOf(q, "철수");
    const minsu = await uidOf(q, "민수");
    for (let i = 0; i < 25; i++) await publish(q, "SCHEDULE_CHANGED", aws, null, null, [cheolsu], `page:${i}`);
    await asUser(q, cheolsu);
    const total = 25 + 3;                                                       // 시드 3건(Task 10) + 25
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: total });
    const p1 = (await one(q, "select public.notifications_list(null, 20) as l")).l;
    assertEquals(p1.items.length, 20);
    assert(p1.nextCursor !== null);
    assertEquals(p1.items[0].kind, "SCHEDULE_CHANGED");
    assertEquals(p1.items[0].room, { slug: "aws", title: "AWS SAA 자격증 3개월 완주" });
    assertEquals(p1.items[0].readAt, null);
    assertEquals(p1.items[0].actor, null);
    const p2 = (await one(q, "select public.notifications_list($1, 20) as l", [p1.nextCursor])).l;
    assertEquals(p2.items.length, total - 20);
    assertEquals(p2.nextCursor, null);
    assert(Number(p2.items[0].id) < Number(p1.items[19].id));

    await q("select public.notifications_read($1::bigint)", [p1.items[0].id]);
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: total - 1 });
    await q("select public.notifications_read($1::bigint)", [p1.items[0].id]);   // 멱등
    assertEquals((await one(q, "select public.notifications_read_all() as r")).r, { updated: total - 1 });
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: 0 });

    await publish(q, "ROOM_STARTED", aws, null, null, [minsu], `mine:${minsu}`);
    const other = await one(q, "select id::text as id from public.notifications where user_id = $1::uuid order by id desc limit 1", [minsu]);
    await expectFail(q("select public.notifications_read($1::bigint)", [other.id]), "NOT_FOUND");
    await asUser(q, null);
    await expectFail(q("select public.notifications_list(null, 20)"), "AUTH_REQUIRED");
    await expectFail(q("select public.notifications_unread_count()"), "AUTH_REQUIRED");
  } },

  { name: "settings_get/put: defaults, full replace, NOT_LEADER, VALIDATION_FAILED", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    const d = (await one(q, "select public.settings_get('aws') as s")).s;
    assertEquals(d, { reminderD1: true, reminderD3: true, taskAssigned: true, scheduleChanged: true, roomStartEnd: true, completionMode: "daily" });
    const put = (s: unknown) => one(q, "select public.settings_put('aws', $1::jsonb) as s", [JSON.stringify(s)]).then((r) => r.s);
    const u = await put({ ...d, reminderD3: false, completionMode: "immediate" });
    assertEquals([u.reminderD3, u.completionMode], [false, "immediate"]);
    assertEquals((await one(q, "select completion_mode as m from public.room_notification_settings where room_id = $1::bigint", [await roomId(q, "aws")])).m, "IMMEDIATE");
    await expectFail(put({ ...d, completionMode: "weekly" }), "VALIDATION_FAILED");
    await expectFail(put({ ...d, reminderD1: "yes" }), "VALIDATION_FAILED");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(q("select public.settings_get('aws')"), "NOT_LEADER");
    await expectFail(put(d), "NOT_LEADER");
    await asUser(q, null);
    await expectFail(q("select public.settings_get('aws')"), "AUTH_REQUIRED");
  } },

  { name: "TASK_ALL_SUBMITTED: immediate mode notifies leader at the final submission; digest mode does not", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");            // 지은 D, 철수 O
    const minsu = await uidOf(q, "민수");
    await asUser(q, await uidOf(q, "철수"));
    await submit(q, ec2);                                                      // DAILY_DIGEST(기본) → 즉시 알림 없음
    assertEquals((await rowsOf(q, minsu, "TASK_ALL_SUBMITTED")).length, 0);
    await q("delete from public.submissions where node_id = $1::bigint and user_id = $2::uuid", [ec2, await uidOf(q, "철수")]);
    await asUser(q, minsu);
    await q(`select public.settings_put('aws', '{"reminderD1":true,"reminderD3":true,"taskAssigned":true,"scheduleChanged":true,"roomStartEnd":true,"completionMode":"immediate"}'::jsonb)`);
    await asUser(q, await uidOf(q, "철수"));
    await submit(q, ec2);
    const r = await rowsOf(q, minsu, "TASK_ALL_SUBMITTED");
    assertEquals(r.length, 1);
    assertEquals(r[0].node_id, ec2);
    await submit(q, ec2, "수정");                                              // 갱신은 다시 알리지 않는다
    assertEquals((await rowsOf(q, minsu, "TASK_ALL_SUBMITTED")).length, 1);
  } },

  { name: "plan 02/03 placeholder calls now produce rows: JOIN_REQUESTED, JOIN_APPROVED, ROOM_STARTED+JOIN_EXPIRED (tick), SCHEDULE_CHANGED", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    const gaeun = await uidOf(q, "가은");                                      // sqld 그룹장(APPROVAL, RECRUIT)
    await asUser(q, seoyeon);
    await q("select public.room_apply('sqld')");
    const jr = await rowsOf(q, gaeun, "JOIN_REQUESTED");
    assertEquals(jr.length, 1);
    assertEquals(jr[0].title, "서연님이 SQLD 4주 벼락치기 참가를 신청했어요");
    await asUser(q, gaeun);
    await q("select public.room_approve('sqld', $1::uuid)", [seoyeon]);
    assertEquals((await rowsOf(q, seoyeon, "JOIN_APPROVED")).length, 1);   // link 는 room_approve 가 상태 갱신 뒤에 부르면 /my-study, 전이면 /rooms

    await setToday(q, "2026-10-26");                                          // sqld start_date
    await q("select public.room_tick()");
    assertEquals((await rowsOf(q, gaeun, "ROOM_STARTED")).length, 1);
    assertEquals((await rowsOf(q, seoyeon, "ROOM_STARTED")).length, 1);
    assertEquals((await rowsOf(q, await uidOf(q, "철수"), "JOIN_EXPIRED")).length, 1);   // 철수 PENDING → EXPIRED
    await q("select public.room_tick()");                                      // 재실행: 중복 없음 (Review Focus 3)
    assertEquals((await rowsOf(q, gaeun, "ROOM_STARTED")).length, 1);

    await setToday(q, "2026-10-12");
    await asUser(q, await uidOf(q, "민수"));
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await q("select public.node_update('aws', $1::bigint, '{\"endDate\":\"2026-10-15\"}'::jsonb)", [ec2]);
    const sc = await rowsOf(q, await uidOf(q, "철수"), "SCHEDULE_CHANGED");
    assertEquals(sc.length, 1);
    assertEquals((await rowsOf(q, await uidOf(q, "민수"), "SCHEDULE_CHANGED")).length, 0);   // actor 제외
  } },
]);
```

plan 02/03 의 함수 이름·인자가 다르면 **이 테스트 쪽을** 고친다(`room_apply(p_slug, p_invite_token)`, `room_approve(p_slug, p_user)`, `node_update(p_slug, p_node_id, p_patch)` 가 plan 03 의 계약).

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/notifications-sql.test.ts`
Expected: FAIL — "dedupe" 사례에서 `notify_publish` 가 0 을 돌려준다(자리표), `notifications_list` 없음.

- [ ] **Step 3: `supabase/migrations/0008_notifications.sql` 작성**

```sql
-- 0008_notifications.sql — 알림 · 설정 · 이탈 처리 · cron 잡 (플랜 04 Task 5~7)
-- 배포 후 수정 금지. Task 6·7 이 이 파일 끝에 이어 붙인다.
-- notify_publish 는 0004 의 자리표와 **같은 시그니처**로 CREATE OR REPLACE 한다(의존 함수가 있어 DROP 불가).

-- ───────── 알림 종류 (03-api §7 NotificationKind) ─────────
create or replace function public.notification_kinds() returns text[]
language sql immutable as $$
  select array['ROUND_STARTED', 'TASK_ALL_SUBMITTED', 'TASK_COMPLETION_DIGEST', 'JOIN_REQUESTED', 'JOIN_APPROVED', 'JOIN_REJECTED',
               'JOIN_EXPIRED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'SCHEDULE_CHANGED', 'ROOM_STARTED',
               'ROOM_ENDED', 'ROOM_START_BLOCKED', 'MEMBER_DEACTIVATED']
$$;

-- 옵션 kind 는 방 설정(cross-cutting §2.3.4)으로 거른다. 설정 행이 없으면 기본 ON. 기본·잠금 kind 는 항상 true
create or replace function public.notify_enabled(p_kind text, p_room bigint, p_model jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'DEADLINE_REMINDER' then case coalesce(p_model ->> 'days', '1') when '3' then s.reminder_d3 else s.reminder_d1 end
      when 'TASK_ASSIGNED'     then s.task_assigned
      when 'TASK_UNASSIGNED'   then s.task_assigned
      when 'SCHEDULE_CHANGED'  then s.schedule_changed
      when 'ROOM_STARTED'      then s.room_start_end
      when 'ROOM_ENDED'        then s.room_start_end
      else true end
    from public.room_notification_settings s where s.room_id = p_room), true)
$$;

-- 한국어 제목·본문 (생성 시점 스냅샷, cross-cutting §2.3.3). 과제 이벤트는 body 에 방 제목
create or replace function public.notify_render(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_model jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_room  text;
  v_node  text;
  v_label text;
  v_actor text;
  v_title text;
begin
  select title into v_room from public.rooms where id = p_room;
  select title, label into v_node, v_label from public.goal_nodes where id = p_node;
  select coalesce(nickname, '') into v_actor from public.profiles where id = p_actor;
  v_title := case p_kind
    when 'ROUND_STARTED'          then format('%s의 %s가 시작됐어요', v_room, coalesce(v_label, v_node))
    when 'TASK_ALL_SUBMITTED'     then format('"%s" 과제를 전원 제출했어요', v_node)
    when 'TASK_COMPLETION_DIGEST' then format('어제 %s개 과제가 전원 제출됐어요', coalesce(p_model ->> 'count', '0'))
    when 'JOIN_REQUESTED'         then format('%s님이 %s 참가를 신청했어요', v_actor, v_room)
    when 'JOIN_APPROVED'          then format('%s 참가가 승인됐어요', v_room)
    when 'JOIN_REJECTED'          then format('%s 참가 신청이 거절됐어요', v_room)
    when 'JOIN_EXPIRED'           then format('%s 참가 신청이 만료됐어요', v_room)
    when 'DEADLINE_REMINDER'      then format('"%s" 마감 %s일 전이에요', v_node, coalesce(p_model ->> 'days', '1'))
    when 'TASK_ASSIGNED'          then format('"%s" 과제 담당자로 지정됐어요', v_node)
    when 'TASK_UNASSIGNED'        then format('"%s" 과제 담당에서 제외됐어요', v_node)
    when 'SCHEDULE_CHANGED'       then format('%s 일정이 변경됐어요', v_room)
    when 'ROOM_STARTED'           then format('%s 스터디가 시작됐어요', v_room)
    when 'ROOM_ENDED'             then format('%s 스터디가 종료됐어요', v_room)
    when 'ROOM_START_BLOCKED'     then format('%s 시작일이 지났지만 말단 과제가 없어 시작하지 못했어요', v_room)
    when 'MEMBER_DEACTIVATED'     then format('%s 스터디에서 이탈 처리됐어요', v_room)
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', case when p_node is null then null else left(v_room, 500) end);
end $$;

-- 링크(D8): 과제 이벤트 → /my-study/{slug}?task={nodeId}, 방 이벤트 → 참가자(ACTIVE·그룹장)면 /my-study/{slug}, 아니면 /rooms/{slug}
create or replace function public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_node is not null and p_kind in ('TASK_ALL_SUBMITTED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED')
      then '/my-study/' || r.slug || '?task=' || p_node
    when r.leader_id = p_user
      or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_user and m.status = 'ACTIVE')
      then '/my-study/' || r.slug
    else '/rooms/' || r.slug end
  from public.rooms r where r.id = p_room
$$;

-- ───────── notify_publish (D8) — 0004 자리표 교체 ─────────
-- 설정 필터 → 템플릿 렌더 → 수신자별 INSERT (본인 제외, dedupe_key = prefix||':'||user, ON CONFLICT DO NOTHING). 반환: 실제 생성 건수
create or replace function public.notify_publish(
  p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_tpl jsonb;
  v_r   uuid;
  v_n   int := 0;
  v_c   int;
begin
  if p_kind is null or not (p_kind = any(public.notification_kinds())) then
    perform public.fail('VALIDATION_FAILED', '알 수 없는 알림 종류예요', jsonb_build_object('kind', p_kind));
  end if;
  if p_room is null then perform public.fail('VALIDATION_FAILED', '알림에는 방이 필요해요', jsonb_build_object('kind', p_kind)); end if;
  if coalesce(cardinality(p_recipients), 0) = 0 then return 0; end if;
  if not public.notify_enabled(p_kind, p_room, coalesce(p_model, '{}'::jsonb)) then return 0; end if;

  v_tpl := public.notify_render(p_kind, p_room, p_node, p_actor, coalesce(p_model, '{}'::jsonb));

  for v_r in select distinct u from unnest(p_recipients) u where u is not null and u is distinct from p_actor loop
    insert into public.notifications (user_id, kind, title, body, room_id, node_id, actor_user_id, link, dedupe_key)
    values (v_r, p_kind, v_tpl ->> 'title', v_tpl ->> 'body', p_room, p_node, p_actor,
            public.notify_link(p_kind, p_room, p_node, v_r),
            case when p_dedupe_prefix is null then null else left(p_dedupe_prefix || ':' || v_r, 160) end)
    on conflict (dedupe_key) do nothing;
    get diagnostics v_c = row_count;
    v_n := v_n + v_c;
  end loop;
  return v_n;
end $$;

-- ───────── 알림 읽기 (03-api §7, cross-cutting §2.3.1) ─────────
create or replace function public.notification_json(p_n public.notifications) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_n.id::text, 'kind', p_n.kind, 'title', p_n.title, 'body', p_n.body,
    'room', (select jsonb_build_object('slug', r.slug, 'title', r.title) from public.rooms r where r.id = p_n.room_id),
    'link', p_n.link,
    'actor', case when p_n.actor_user_id is null then null else public.person_json(p_n.actor_user_id) end,
    'createdAt', public.iso(p_n.created_at), 'readAt', public.iso(p_n.read_at))
$$;

-- 최신순, 커서 = 마지막 id(문자열). limit 1~50
create or replace function public.notifications_list(p_cursor text default null, p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.current_user_id();
  v_lim  int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cur  bigint := nullif(p_cursor, '')::bigint;
  v_rows jsonb;
  v_cnt  int;
  v_next text := null;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  select coalesce(jsonb_agg(public.notification_json(n) order by n.id desc), '[]'::jsonb), count(*)
  into v_rows, v_cnt
  from (select * from public.notifications
        where user_id = v_uid and (v_cur is null or id < v_cur)
        order by id desc limit v_lim + 1) n;
  if v_cnt > v_lim then
    v_next := v_rows -> (v_lim - 1) ->> 'id';
    select jsonb_agg(e order by i) into v_rows from jsonb_array_elements(v_rows) with ordinality as t(e, i) where i <= v_lim;
  end if;
  return jsonb_build_object('items', v_rows, 'nextCursor', v_next);
end $$;

create or replace function public.notifications_unread_count() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id();
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  return jsonb_build_object('count', (select count(*) from public.notifications where user_id = v_uid and read_at is null));
end $$;

create or replace function public.notifications_read(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id();
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  update public.notifications set read_at = coalesce(read_at, now()) where id = p_id and user_id = v_uid;
  if not found then perform public.fail('NOT_FOUND', '알림을 찾을 수 없어요'); end if;
end $$;

create or replace function public.notifications_read_all() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); v_n int;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  update public.notifications set read_at = now() where user_id = v_uid and read_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end $$;

-- ───────── 그룹장 전용 헬퍼 ─────────
-- p_lock=true 면 room_lock(FOR UPDATE), 아니면 단순 조회. 없으면 ROOM_NOT_FOUND, 그룹장 아니면 NOT_LEADER
create or replace function public.leader_room(p_slug text, p_lock boolean default false) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  if p_lock then
    r := public.room_lock(p_slug);
  else
    select * into r from public.rooms where slug = p_slug;
    if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  end if;
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  return r;
end $$;

-- ───────── 방 알림 설정 (03-api §7 NotificationSettings) ─────────
create or replace function public.settings_json(p_room bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reminderD1', coalesce(s.reminder_d1, true), 'reminderD3', coalesce(s.reminder_d3, true),
    'taskAssigned', coalesce(s.task_assigned, true), 'scheduleChanged', coalesce(s.schedule_changed, true),
    'roomStartEnd', coalesce(s.room_start_end, true),
    'completionMode', case when coalesce(s.completion_mode, 'DAILY_DIGEST') = 'IMMEDIATE' then 'immediate' else 'daily' end)
  from (select 1) x left join public.room_notification_settings s on s.room_id = p_room
$$;

create or replace function public.settings_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public.leader_room(p_slug);
  return public.settings_json(r.id);
end $$;

-- 전체 교체. 키 6개 전부 필수, 불리언은 jsonb boolean, completionMode ∈ daily|immediate
create or replace function public.settings_put(p_slug text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms;
  v_k   text;
  v_mode text := p_settings ->> 'completionMode';
begin
  r := public.leader_room(p_slug, true);
  foreach v_k in array array['reminderD1', 'reminderD3', 'taskAssigned', 'scheduleChanged', 'roomStartEnd'] loop
    if jsonb_typeof(p_settings -> v_k) is distinct from 'boolean' then
      perform public.fail('VALIDATION_FAILED', '알림 설정 값이 올바르지 않아요', jsonb_build_object('field', v_k));
    end if;
  end loop;
  if v_mode not in ('daily', 'immediate') then
    perform public.fail('VALIDATION_FAILED', '완료 알림 방식은 daily 또는 immediate 예요', '{"field":"completionMode"}'::jsonb);
  end if;
  insert into public.room_notification_settings (room_id, reminder_d1, reminder_d3, task_assigned, schedule_changed, room_start_end, completion_mode)
  values (r.id, (p_settings ->> 'reminderD1')::boolean, (p_settings ->> 'reminderD3')::boolean, (p_settings ->> 'taskAssigned')::boolean,
          (p_settings ->> 'scheduleChanged')::boolean, (p_settings ->> 'roomStartEnd')::boolean,
          case v_mode when 'immediate' then 'IMMEDIATE' else 'DAILY_DIGEST' end)
  on conflict (room_id) do update
    set reminder_d1 = excluded.reminder_d1, reminder_d3 = excluded.reminder_d3, task_assigned = excluded.task_assigned,
        schedule_changed = excluded.schedule_changed, room_start_end = excluded.room_start_end, completion_mode = excluded.completion_mode;
  return public.settings_json(r.id);
end $$;

-- ───────── 내부 함수 권한 회수 (클라이언트가 직접 알림을 만들 수 없게) ─────────
-- PostgreSQL 은 함수 생성 시 PUBLIC 에 EXECUTE 를 주므로 public 까지 회수하고 service_role 에만 다시 준다(Edge Function·cron 용)
revoke execute on function public.notify_publish(text, bigint, bigint, uuid, uuid[], text, jsonb) from public, anon, authenticated;
revoke execute on function public.notify_render(text, bigint, bigint, uuid, jsonb)             from public, anon, authenticated;
revoke execute on function public.notify_enabled(text, bigint, jsonb)                          from public, anon, authenticated;
revoke execute on function public.notify_link(text, bigint, bigint, uuid)                      from public, anon, authenticated;
revoke execute on function public.storage_exists(text, text)                                   from public, anon, authenticated;
grant  execute on function public.notify_publish(text, bigint, bigint, uuid, uuid[], text, jsonb) to service_role;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/notifications-sql.test.ts`
Expected: 8 passed. "list" 사례의 `total` 은 Task 10 의 시드 3건을 전제한다 — Task 10 전에는 `28` 이 `25` 로 나오므로 그때까지는 `const total = 25 + Number((await one(q, "select count(*)::int as n from public.notifications where user_id = $1::uuid", [cheolsu])).n)` 로 바꿔 두고, Task 10 에서 상수 3 으로 되돌린다(어느 쪽이든 통과). "placeholder calls" 사례가 `room_apply`·`node_update` 이름으로 실패하면 plan 02/03 의 실제 시그니처로 테스트를 고친다. `SCHEDULE_CHANGED` 가 0건이면 plan 03 `node_update` 가 기간 변경 시 `notify_publish('SCHEDULE_CHANGED', …)` 를 호출하는지 확인한다(00 개요 "plan 02/03 쪽 호출 계약").

- [ ] **Step 5: 권한 회수 확인 (PGlite)**

`notifications-sql.test.ts` 끝에 사례 하나 추가:

```ts
cases("notifications-grants", db, q, [
  { name: "internal functions are not executable by anon/authenticated, service_role keeps notify_publish", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, `select has_function_privilege($1, $2, 'execute') as v`, [role, fn])).v;
    const np = "public.notify_publish(text, bigint, bigint, uuid, uuid[], text, jsonb)";
    assertEquals(await can("anon", np), false);
    assertEquals(await can("authenticated", np), false);
    assertEquals(await can("service_role", np), true);
    assertEquals(await can("authenticated", "public.storage_exists(text, text)"), false);
    assertEquals(await can("authenticated", "public.notifications_list(text, int)"), true);
  } },
]);
```

Run: 같은 명령. Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0008_notifications.sql supabase/tests/notifications-sql.test.ts
git commit -m "feat(db): real notify_publish with settings filter, dedupe, Korean templates; notifications and settings RPC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 6: `member_deactivate_preview` · `member_deactivate`

**Files:**
- Modify: `supabase/migrations/0008_notifications.sql` (끝에 추가)
- Test: `supabase/tests/deactivate-sql.test.ts`

**Interfaces:**
- Consumes: Task 5 `leader_room`, `notify_publish`; plan 02 `room_release_seat(p_room)`, `assignment_resync(p_room)`, `membership_result(p_room, p_user)`, `room_leaf_stats`; Task 4 `task_get`.
- Produces:
  ```sql
  public.deactivate_pending(p_room bigint, p_user uuid) returns table (node_id bigint, title text, round_label text, others uuid[])
      -- 대상의 미제출 지정 과제(보관 제외) + 그 과제의 나머지 유효 담당자
  public.member_deactivate_preview(p_slug text, p_user uuid) returns jsonb   -- {today, tasks: [{nodeId, title, roundLabel, currentAssignees: Person[]}]}
  public.member_deactivate(p_slug text, p_user uuid, p_decisions jsonb default '[]') returns jsonb   -- MembershipResult(그룹장 시점)
  ```
  `p_decisions`: `[{ "nodeId": "42", "action": "exclude" | "reassign", "assigneeIds": ["<uuid>"] }]`. 검증을 전부 끝낸 뒤에만 쓴다(부분 적용 없음).

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/deactivate-sql.test.ts`**

```ts
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { asUser, bootDb, cases, expectFail, nodeId, one, roomId, uidOf, type Q } from "./_boot.ts";

const { db, q } = await bootDb();

const preview = async (q: Q, slug: string, user: string) => (await one(q, "select public.member_deactivate_preview($1, $2::uuid) as p", [slug, user])).p;
const deactivate = async (q: Q, slug: string, user: string, decisions: unknown[] = []) =>
  (await one(q, "select public.member_deactivate($1, $2::uuid, $3::jsonb) as r", [slug, user, JSON.stringify(decisions)])).r;
const roundStat = async (q: Q, slug: string, label: string) =>
  one(q, `select coalesce(sum(ls.asg), 0)::int as asg, coalesce(sum(ls.sub), 0)::int as sub
          from public.room_leaf_stats((select id from public.rooms where slug = $1)) ls
          join public.goal_nodes rd on rd.id = ls.round_id where rd.label = $2`, [slug, label]);
const leafStat = async (q: Q, node: string) =>
  one(q, "select asg, sub from public.room_leaf_stats((select room_id from public.goal_nodes where id = $1::bigint)) where node_id = $1::bigint", [node]);

cases("deactivate", db, q, [
  { name: "preview: only unsubmitted designated tasks of the target, with the other assignees", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    assertEquals((await preview(q, "aws", await uidOf(q, "지은"))).tasks, []);       // EC2 는 이미 제출(D)
    const hana = await preview(q, "aws", await uidOf(q, "하나"));
    assertEquals(hana.tasks.map((t: { title: string; roundLabel: string; currentAssignees: unknown[] }) => [t.title, t.roundLabel, t.currentAssignees]),
                 [["S3 스토리지 클래스 발표자료", "2주차", []]]);
    const cheolsu = await preview(q, "aws", await uidOf(q, "철수"));
    assertEquals(cheolsu.tasks.map((t: { title: string; currentAssignees: { nickname: string }[] }) => [t.title, t.currentAssignees.map((p) => p.nickname)]),
                 [["EC2 인스턴스 유형 정리", ["지은"]]]);
    assertEquals(typeof hana.today, "string");
  } },

  { name: "deactivate 지은 (submitted designated + common): counts drop, submissions stay readable by leader, member_count 3, notified, cannot rejoin (Review Focus 2)", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const jieun = await uidOf(q, "지은");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const iam = await nodeId(q, "aws", "IAM 정책 이해");
    await asUser(q, minsu);
    assertEquals(await roundStat(q, "aws", "1주차"), { asg: 8, sub: 5 });
    const r = await deactivate(q, "aws", jieun, []);                             // 미제출 지정 과제 없음 → 결정 불필요
    assertEquals(r.memberCount, 3);
    assertEquals(r.me, { state: "leader" });
    assertEquals(r.members.find((m: { nickname: string }) => m.nickname === "지은").status, "inactive");
    assertEquals(await roundStat(q, "aws", "1주차"), { asg: 6, sub: 4 });        // 지은 L(IAM)·M(VPC) 제외
    assertEquals(await leafStat(q, ec2), { asg: 1, sub: 0 });                     // 철수만 남음
    const m = await one(q, "select status, (left_at is not null) as left_set, member_count from public.room_members rm join public.rooms r on r.id = rm.room_id where r.slug = 'aws' and rm.user_id = $1::uuid", [jieun]);
    assertEquals([m.status, m.left_set, m.member_count], ["INACTIVE", true, 3]);
    assertEquals((await one(q, "select count(*)::int as n from public.task_assignments a join public.goal_nodes n on n.id = a.node_id where n.room_id = $1::bigint and a.user_id = $2::uuid and a.released_at is null", [await roomId(q, "aws"), jieun])).n, 0);
    // 제출물 보존 + 그룹장 열람
    assertEquals((await one(q, "select count(*)::int as n from public.submissions where user_id = $1::uuid and node_id in ($2::bigint, $3::bigint)", [jieun, ec2, iam])).n, 2);
    const t = (await one(q, "select public.task_get('aws', $1::bigint) as t", [ec2])).t;
    assertEquals(t.submissions.map((s: { author: { nickname: string } }) => s.author.nickname), ["지은"]);
    assertEquals(t.allSubmitted, false);
    // 알림
    const n = await q("select kind, link from public.notifications where user_id = $1::uuid and kind = 'MEMBER_DEACTIVATED'", [jieun]);
    assertEquals(n.length, 1);
    assertEquals(n[0].link, "/rooms/aws");                                        // 이미 참가자가 아니므로 /rooms
    // 재참가 거부 (ACTIVE 방이므로 모집 아님 / 이탈자) — 코드는 plan 02 의 room_apply 가 정한다
    await asUser(q, jieun);
    await assertRejects(() => q("select public.room_apply('aws')"));
    // 다시 이탈 처리 → MEMBER_NOT_ACTIVE
    await asUser(q, minsu);
    await expectFail(deactivate(q, "aws", jieun), "MEMBER_NOT_ACTIVE");
  } },

  { name: "도윤 is already INACTIVE: MEMBER_NOT_ACTIVE and 1주차 stays 5/8", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(deactivate(q, "aws", await uidOf(q, "도윤")), "MEMBER_NOT_ACTIVE");
    await expectFail(preview(q, "aws", await uidOf(q, "도윤")), "MEMBER_NOT_ACTIVE");
    assertEquals(await roundStat(q, "aws", "1주차"), { asg: 8, sub: 5 });
  } },

  { name: "guards: CANNOT_DEACTIVATE_LEADER, NOT_LEADER, ROOM_NOT_ACTIVE, non-member → MEMBER_NOT_ACTIVE, AUTH_REQUIRED", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    await asUser(q, minsu);
    await expectFail(deactivate(q, "aws", minsu), "CANNOT_DEACTIVATE_LEADER");
    await expectFail(deactivate(q, "aws", await uidOf(q, "가은")), "MEMBER_NOT_ACTIVE");
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(deactivate(q, "aws", await uidOf(q, "지은")), "NOT_LEADER");
    await asUser(q, await uidOf(q, "가은"));                                      // sqld RECRUIT
    await expectFail(deactivate(q, "sqld", await uidOf(q, "철수")), "ROOM_NOT_ACTIVE");
    await asUser(q, await uidOf(q, "현우"));                                      // algo ENDED
    await expectFail(deactivate(q, "algo", await uidOf(q, "철수")), "ROOM_NOT_ACTIVE");
    await asUser(q, null);
    await expectFail(deactivate(q, "aws", minsu), "AUTH_REQUIRED");
  } },

  { name: "decisions: missing → LEAVE_DECISION_MISSING, exclude to zero → REASSIGN_REQUIRED, reassign to non-member → ASSIGNEE_NOT_MEMBER, reassign ok + TASK_ASSIGNED", run: async (q) => {
    const minsu = await uidOf(q, "민수");
    const hana = await uidOf(q, "하나");
    const cheolsu = await uidOf(q, "철수");
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");
    await asUser(q, minsu);
    await expectFail(deactivate(q, "aws", hana, []), "LEAVE_DECISION_MISSING");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "exclude" }]), "REASSIGN_REQUIRED");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [] }]), "REASSIGN_REQUIRED");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [await uidOf(q, "가은")] }]), "ASSIGNEE_NOT_MEMBER");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [hana] }]), "ASSIGNEE_NOT_MEMBER");
    await expectFail(deactivate(q, "aws", hana, [{ nodeId: s3, action: "drop" }]), "VALIDATION_FAILED");
    // 아무것도 바뀌지 않았어야 한다
    assertEquals((await one(q, "select status from public.room_members rm join public.rooms r on r.id = rm.room_id where r.slug = 'aws' and rm.user_id = $1::uuid", [hana])).status, "ACTIVE");
    assertEquals(await leafStat(q, s3), { asg: 1, sub: 0 });

    const r = await deactivate(q, "aws", hana, [{ nodeId: s3, action: "reassign", assigneeIds: [cheolsu] }]);
    assertEquals(r.memberCount, 3);
    assertEquals(await leafStat(q, s3), { asg: 1, sub: 0 });
    const a = await one(q, "select user_id::text as u, source from public.task_assignments where node_id = $1::bigint and released_at is null", [s3]);
    assertEquals([a.u, a.source], [cheolsu, "DESIGNATED"]);
    assertEquals(await roundStat(q, "aws", "1주차"), { asg: 6, sub: 5 });        // 하나 M·M 제외
    const n = await q("select kind, node_id::text as node from public.notifications where user_id = $1::uuid and kind = 'TASK_ASSIGNED'", [cheolsu]);
    assertEquals(n, [{ kind: "TASK_ASSIGNED", node: s3 }]);
  } },

  { name: "exclude is fine when someone remains (철수 off EC2, 지은 stays)", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, await uidOf(q, "민수"));
    await deactivate(q, "aws", await uidOf(q, "철수"), [{ nodeId: ec2, action: "exclude" }]);
    assertEquals(await leafStat(q, ec2), { asg: 1, sub: 1 });
    assertEquals((await one(q, "select public.task_get('aws', $1::bigint) as t", [ec2])).t.allSubmitted, true);
  } },
]);
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/deactivate-sql.test.ts`
Expected: FAIL — `function public.member_deactivate_preview(text, uuid) does not exist`.

- [ ] **Step 3: 0008 끝에 이탈 처리 추가**

```sql
-- ───────── 이탈 처리 (D11, 03-api §3, mystudy §2.3.3) ─────────
-- 대상의 미제출 지정 과제(보관 제외) + 그 과제의 나머지 유효 담당자. 미리보기와 본처리가 같은 목록을 본다
create or replace function public.deactivate_pending(p_room bigint, p_user uuid)
returns table (node_id bigint, title text, round_label text, others uuid[])
language sql stable security definer set search_path = '' as $$
  select n.id, n.title::text, rd.label::text,
         coalesce((select array_agg(b.user_id order by b.assigned_at, b.id) from public.task_assignments b
                   where b.node_id = n.id and b.released_at is null and b.user_id <> p_user), '{}'::uuid[])
  from public.task_assignments a
  join public.goal_nodes n on n.id = a.node_id
  left join public.goal_nodes rd on rd.id = n.round_id
  where n.room_id = p_room and n.task_type = 'DESIGNATED' and n.archived_at is null
    and a.user_id = p_user and a.released_at is null
    and not exists (select 1 from public.submissions s where s.node_id = n.id and s.user_id = p_user)
  order by n.sort_order, n.id
$$;

-- 공통 검사: 그룹장 · 방 ACTIVE·미보관 · 대상 ≠ 그룹장 · 대상 ACTIVE. p_lock 이면 방·멤버 행을 잠근다
create or replace function public.deactivate_check(p_slug text, p_user uuid, p_lock boolean) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; v_status text;
begin
  r := public.leader_room(p_slug, p_lock);
  if r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('ROOM_NOT_ACTIVE', '진행중인 스터디에서만 이탈 처리할 수 있어요');
  end if;
  if p_user = r.leader_id then perform public.fail('CANNOT_DEACTIVATE_LEADER', '그룹장은 이탈 처리할 수 없어요'); end if;
  if p_lock then
    select status into v_status from public.room_members where room_id = r.id and user_id = p_user for update;
  else
    select status into v_status from public.room_members where room_id = r.id and user_id = p_user;
  end if;
  if not found or v_status <> 'ACTIVE' then perform public.fail('MEMBER_NOT_ACTIVE', '활성 참가자가 아니에요'); end if;
  return r;
end $$;

create or replace function public.member_deactivate_preview(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public.deactivate_check(p_slug, p_user, false);
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nodeId', p.node_id::text, 'title', p.title, 'roundLabel', p.round_label,
               'currentAssignees', (select coalesce(jsonb_agg(public.person_json(u)), '[]'::jsonb) from unnest(p.others) u)))
      from public.deactivate_pending(r.id, p_user) p), '[]'::jsonb));
end $$;

-- 1) 결정을 전부 검증(아무것도 바꾸지 않음) → 2) 대상 배정 전부 released, INACTIVE, 정원 -1 → 3) 재지정 INSERT + TASK_ASSIGNED
--    → 4) assignment_resync → 5) MEMBER_DEACTIVATED. 제출된 지정 과제의 행도 released 되고 제출물은 남는다(집계 제외, D4-3)
create or replace function public.member_deactivate(p_slug text, p_user uuid, p_decisions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  r        public.rooms;
  p        record;
  d        jsonb;
  v_action text;
  v_new    uuid[];
  v_adds   uuid[];
  v_id     uuid;
  v_plan   jsonb := '[]'::jsonb;    -- [{nodeId, adds: uuid[]}]
  v_item   jsonb;
begin
  r := public.deactivate_check(p_slug, p_user, true);
  if jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' then
    perform public.fail('VALIDATION_FAILED', 'decisions 는 배열이어야 해요', '{"field":"decisions"}'::jsonb);
  end if;

  -- 1. 검증
  for p in select * from public.deactivate_pending(r.id, p_user) loop
    select e into d from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) e where e ->> 'nodeId' = p.node_id::text limit 1;
    if d is null then
      perform public.fail('LEAVE_DECISION_MISSING', '미제출 지정 과제마다 처리 방법을 정해 주세요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    v_action := d ->> 'action';
    if v_action not in ('exclude', 'reassign') then
      perform public.fail('VALIDATION_FAILED', 'action 은 exclude 또는 reassign 이에요', jsonb_build_object('field', 'action', 'nodeId', p.node_id::text));
    end if;
    v_new := '{}'::uuid[];
    if v_action = 'reassign' then
      select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_new
      from jsonb_array_elements_text(coalesce(d -> 'assigneeIds', '[]'::jsonb)) x;
      foreach v_id in array v_new loop
        if v_id = p_user or not exists (
             select 1 from public.room_members m
             where m.room_id = r.id and m.user_id = v_id and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks)) then
          perform public.fail('ASSIGNEE_NOT_MEMBER', '활성 참가자에게만 재지정할 수 있어요', jsonb_build_object('nodeId', p.node_id::text, 'userId', v_id::text));
        end if;
      end loop;
    end if;
    v_adds := array(select unnest(v_new) except select unnest(p.others));
    if cardinality(p.others) + cardinality(v_adds) = 0 then
      perform public.fail('REASSIGN_REQUIRED', '담당자가 0명이 되는 과제는 다른 참가자에게 재지정해야 해요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    v_plan := v_plan || jsonb_build_object('nodeId', p.node_id::text, 'adds', to_jsonb(v_adds));
  end loop;

  -- 2. 대상 해제 + 상태 전환 + 정원
  update public.task_assignments a set released_at = now()
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = r.id and a.user_id = p_user and a.released_at is null;
  update public.room_members
     set status = 'INACTIVE', left_at = now(), decided_at = now(), decided_by = v_uid, updated_at = now()
   where room_id = r.id and user_id = p_user;
  perform public.room_release_seat(r.id);

  -- 3. 재지정
  for v_item in select e from jsonb_array_elements(v_plan) e loop
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_adds from jsonb_array_elements_text(v_item -> 'adds') x;
    if cardinality(v_adds) > 0 then
      insert into public.task_assignments (node_id, user_id, source)
      select (v_item ->> 'nodeId')::bigint, u, 'DESIGNATED' from unnest(v_adds) u
      on conflict (node_id, user_id) do update set released_at = null, source = 'DESIGNATED', assigned_at = now();
      perform public.notify_publish('TASK_ASSIGNED', r.id, (v_item ->> 'nodeId')::bigint, v_uid, v_adds,
                                    'TASK_ASSIGNED:node=' || (v_item ->> 'nodeId') || ':tx=' || txid_current(), '{}'::jsonb);
    end if;
  end loop;

  -- 4·5
  perform public.assignment_resync(r.id);
  perform public.notify_publish('MEMBER_DEACTIVATED', r.id, null, v_uid, array[p_user],
                                'MEMBER_DEACTIVATED:room=' || r.id || ':user=' || p_user, '{}'::jsonb);
  return public.membership_result(r.id, v_uid);
end $$;

revoke execute on function public.deactivate_pending(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.deactivate_check(text, uuid, boolean) from public, anon, authenticated;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/deactivate-sql.test.ts`
Expected: 6 passed. `r.members` 에서 지은이 `inactive` 로 보이지 않으면 plan 02 `room_members_json` 이 INACTIVE 를 포함하는지 확인(03-api §2 `members` 는 "ACTIVE 전원 + INACTIVE"). `memberCount` 가 4 그대로면 `room_release_seat` 이름을 plan 02 산출물 표와 대조.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_notifications.sql supabase/tests/deactivate-sql.test.ts
git commit -m "feat(db): member_deactivate_preview/member_deactivate with decisions, release, resync, notifications

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 7: cron 잡 함수 6종 (`job_*`, `member_count_audit`)

**Files:**
- Modify: `supabase/migrations/0008_notifications.sql` (끝에 추가)
- Test: `supabase/tests/jobs-sql.test.ts`

**Interfaces:**
- Consumes: Task 5 `notify_publish`, `kst_today`, Task 2 `submission_upsert`(digest 사례), plan 02 `room_create`, `room_tick`(이 플랜은 호출하지 않음 — 0010 이 cron 에 등록만).
- Produces (전부 `SECURITY DEFINER`, `anon/authenticated` 실행 불가, `service_role` 허용):
  ```sql
  public.job_draft_blocked() returns int        -- DRAFT & start_date ≤ today → 그룹장 ROOM_START_BLOCKED (room·day dedupe)
  public.job_round_started() returns int        -- depth 2 & start_date = today & 방 ACTIVE → ACTIVE 전원 ROUND_STARTED (node dedupe)
  public.job_deadline_reminder() returns int    -- 리프 end_date = today+1 / +3, 미제출 담당자, 설정 ON → DEADLINE_REMINDER (node·user·d dedupe)
  public.job_completion_digest() returns int    -- DAILY_DIGEST 방: 어제 전원 제출된 리프 수 → 그룹장 TASK_COMPLETION_DIGEST (room·day dedupe)
  public.job_cleanup() returns jsonb            -- {filesExpired, filesPurged, mailPurged}
  public.member_count_audit() returns int       -- I7 보정, 고친 방 수
  ```

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/jobs-sql.test.ts`**

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import { asUser, bootDb, cases, nodeId, one, roomId, setNow, setToday, uidOf, type Q } from "./_boot.ts";
import { submit } from "./_submit.ts";

const { db, q } = await bootDb();
const run = async (q: Q, fn: string) => (await one(q, `select public.${fn}() as n`)).n;
/** 시드 §4 의 'seed:*' 행은 제외 */
const kinds = (q: Q, uid: string, kind: string) =>
  q(`select title, node_id::text as node, room_id::text as room from public.notifications
     where user_id = $1::uuid and kind = $2 and coalesce(dedupe_key, '') not like 'seed:%' order by id`, [uid, kind]);

cases("jobs", db, q, [
  { name: "job_draft_blocked: DRAFT past start_date notifies leader once per day (idempotent)", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    await asUser(q, seoyeon);
    const d = (await one(q, "select public.room_create('Draft Room', '소개', '2026-11-01'::date, '2026-11-28'::date, 4, true, 'direct') as d")).d;
    assertEquals(await run(q, "job_draft_blocked"), 0);                        // 아직 start_date 전
    await setToday(q, "2026-11-01");
    assertEquals(Number(await run(q, "job_draft_blocked")), 1);
    assertEquals(Number(await run(q, "job_draft_blocked")), 0);                // 같은 날 재실행
    const n = await kinds(q, seoyeon, "ROOM_START_BLOCKED");
    assertEquals(n.length, 1);
    assertEquals(n[0].room, d.id);
    await setToday(q, "2026-11-02");
    assertEquals(Number(await run(q, "job_draft_blocked")), 1);                // 다음 날은 새 키
    assertEquals((await one(q, "select status from public.rooms where id = $1::bigint", [d.id])).status, "DRAFT");   // 전환은 안 한다
  } },

  { name: "job_round_started: aws 3주차 on 10/15 → ACTIVE members (4), not INACTIVE 도윤; idempotent", run: async (q) => {
    await setToday(q, "2026-10-15");
    const n = Number(await run(q, "job_round_started"));
    assert(n >= 4);
    const round3 = await nodeId(q, "aws", "고가용성 아키텍처");
    for (const nick of ["민수", "지은", "철수", "하나"]) {
      const r = await kinds(q, await uidOf(q, nick), "ROUND_STARTED");
      assertEquals(r.filter((x) => x.node === round3).length, 1, nick);
    }
    assertEquals((await kinds(q, await uidOf(q, "도윤"), "ROUND_STARTED")).length, 0);
    assertEquals(Number(await run(q, "job_round_started")), 0);
    await setToday(q, "2026-10-12");
    assertEquals(Number(await run(q, "job_round_started")), 0);                // 10/12 에 시작하는 회차: spring 2주차는 이미… (없으면 0)
  } },

  { name: "job_deadline_reminder: D-1 to unsubmitted assignees only; D-3 honors reminder_d3; idempotent", run: async (q) => {
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");            // end 10-14: 지은 D, 철수 O
    const s3 = await nodeId(q, "aws", "S3 스토리지 클래스 발표자료");        // end 10-14: 하나 O
    await setToday(q, "2026-10-13");
    const n1 = Number(await run(q, "job_deadline_reminder"));
    assert(n1 >= 2);
    const c = await kinds(q, await uidOf(q, "철수"), "DEADLINE_REMINDER");
    assertEquals(c.filter((x) => x.node === ec2).map((x) => x.title), ['"EC2 인스턴스 유형 정리" 마감 1일 전이에요']);
    assertEquals((await kinds(q, await uidOf(q, "하나"), "DEADLINE_REMINDER")).filter((x) => x.node === s3).length, 1);
    assertEquals((await kinds(q, await uidOf(q, "지은"), "DEADLINE_REMINDER")).filter((x) => x.node === ec2).length, 0);
    assertEquals(Number(await run(q, "job_deadline_reminder")), 0);

    await setToday(q, "2026-10-11");                                          // D-3
    await q("update public.room_notification_settings set reminder_d3 = false where room_id = $1::bigint", [await roomId(q, "aws")]);
    await run(q, "job_deadline_reminder");
    assertEquals((await kinds(q, await uidOf(q, "철수"), "DEADLINE_REMINDER")).filter((x) => x.title.includes("3일 전")).length, 0);
    await q("update public.room_notification_settings set reminder_d3 = true where room_id = $1::bigint", [await roomId(q, "aws")]);
    await run(q, "job_deadline_reminder");
    assertEquals((await kinds(q, await uidOf(q, "철수"), "DEADLINE_REMINDER")).filter((x) => x.title.includes("3일 전") && x.node === ec2).length, 1);
  } },

  { name: "job_completion_digest: leaves completed yesterday → one TASK_COMPLETION_DIGEST per room; IMMEDIATE rooms skipped; idempotent", run: async (q) => {
    const iam = await nodeId(q, "aws", "IAM 정책 이해");                       // 민수 D·지은 L·철수 D·하나 M
    const minsu = await uidOf(q, "민수");
    await setToday(q, "2026-10-11");
    await setNow(q, "2026-10-11T03:00:00Z");                                   // KST 10/11 12:00
    await asUser(q, await uidOf(q, "하나"));
    await submit(q, iam);                                                       // 이제 4/4, 마지막 제출일 = 10/11
    assertEquals((await kinds(q, minsu, "TASK_ALL_SUBMITTED")).length, 0);     // digest 모드
    await setToday(q, "2026-10-12");
    assert(Number(await run(q, "job_completion_digest")) >= 1);                // spring 1주차(DDDDD, end 10/11)도 어제 완료라 방마다 1건
    const d = await kinds(q, minsu, "TASK_COMPLETION_DIGEST");
    assertEquals(d.map((x) => x.title), ["어제 1개 과제가 전원 제출됐어요"]);
    assertEquals(Number(await run(q, "job_completion_digest")), 0);           // 같은 날 재실행
    await setToday(q, "2026-10-13");
    await run(q, "job_completion_digest");
    assertEquals((await kinds(q, minsu, "TASK_COMPLETION_DIGEST")).length, 1); // 그제 완료분은 안 센다

    await q("update public.room_notification_settings set completion_mode = 'IMMEDIATE' where room_id = $1::bigint", [await roomId(q, "aws")]);
    await setToday(q, "2026-10-12");
    await q("delete from public.notifications where kind = 'TASK_COMPLETION_DIGEST' and user_id = $1::uuid", [minsu]);
    await run(q, "job_completion_digest");
    assertEquals((await kinds(q, minsu, "TASK_COMPLETION_DIGEST")).length, 0); // IMMEDIATE 방은 제외
  } },

  { name: "job_cleanup: PENDING files older than 1h → DELETED; DELETED older than 7d purged with the storage object", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    const stale = crypto.randomUUID(), fresh = crypto.randomUUID(), old = crypto.randomUUID();
    const path = (id: string) => `${aws}/${ec2}/${cheolsu}/${id}-x.txt`;
    const ins = (id: string, status: string, created: string, deleted: string | null) =>
      q(`insert into public.files (id, owner_user_id, room_id, node_id, purpose, object_path, original_name, content_type, size_bytes, status, created_at, deleted_at)
         values ($1::uuid, $2::uuid, $3::bigint, $4::bigint, 'ATTACHMENT', $5, 'x.txt', 'text/plain', 1, $6, $7::timestamptz, $8::timestamptz)`,
        [id, cheolsu, aws, ec2, path(id), status, created, deleted]);
    await ins(stale, "PENDING", "2026-10-01T00:00:00Z", null);
    await ins(fresh, "PENDING", new Date().toISOString(), null);
    await ins(old, "DELETED", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");
    await q("insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)", [path(old), cheolsu]);
    const r = (await one(q, "select public.job_cleanup() as r")).r;
    assertEquals([r.filesExpired, r.filesPurged], [1, 1]);
    assertEquals((await one(q, "select status from public.files where id = $1::uuid", [stale])).status, "DELETED");
    assertEquals((await one(q, "select status from public.files where id = $1::uuid", [fresh])).status, "PENDING");
    assertEquals((await q("select 1 from public.files where id = $1::uuid", [old])).length, 0);
    assertEquals((await q("select 1 from storage.objects where name = $1", [path(old)])).length, 0);
  } },

  { name: "member_count_audit: repairs drifted member_count (I7)", run: async (q) => {
    await q("update public.rooms set member_count = 1 where slug = 'aws'");
    assertEquals(Number(await run(q, "member_count_audit")), 1);
    assertEquals((await one(q, "select member_count as n from public.rooms where slug = 'aws'")).n, 4);
    assertEquals(Number(await run(q, "member_count_audit")), 0);
  } },

  { name: "jobs are not executable by anon/authenticated", run: async (q) => {
    for (const fn of ["job_draft_blocked()", "job_round_started()", "job_deadline_reminder()", "job_completion_digest()", "job_cleanup()", "member_count_audit()"]) {
      assertEquals((await one(q, "select has_function_privilege('authenticated', $1, 'execute') as v", [`public.${fn}`])).v, false, fn);
      assertEquals((await one(q, "select has_function_privilege('service_role', $1, 'execute') as v", [`public.${fn}`])).v, true, fn);
    }
  } },
]);
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/jobs-sql.test.ts`
Expected: FAIL — `function public.job_draft_blocked() does not exist`.

- [ ] **Step 3: 0008 끝에 잡 함수 추가**

```sql
-- ───────── pg_cron 잡 (02 §7, cross-cutting §2.4). 전부 멱등: dedupe_key 또는 조건부 UPDATE ─────────
-- room_tick() 은 0004(플랜 02). 여기 잡들은 상태를 바꾸지 않고 알림·정리만 한다.

-- DRAFT 인데 start_date 가 지남 → 그룹장에게 하루 1건
create or replace function public.job_draft_blocked() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.kst_today(); r record; v_n int := 0;
begin
  for r in select id, leader_id from public.rooms where status = 'DRAFT' and archived_at is null and start_date <= v_today order by id loop
    v_n := v_n + public.notify_publish('ROOM_START_BLOCKED', r.id, null, null, array[r.leader_id],
                                       'ROOM_START_BLOCKED:room=' || r.id || ':d=' || to_char(v_today, 'YYYY-MM-DD'), '{}'::jsonb);
  end loop;
  return v_n;
end $$;

-- 회차(depth 2) 시작일 = today, 방 ACTIVE → ACTIVE 전원
create or replace function public.job_round_started() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.kst_today(); r record; v_members uuid[]; v_n int := 0;
begin
  for r in
    select n.id, n.room_id
    from public.goal_nodes n join public.rooms rm on rm.id = n.room_id
    where n.depth = 2 and n.archived_at is null and n.start_date = v_today and rm.status = 'ACTIVE' and rm.archived_at is null
    order by n.id
  loop
    select coalesce(array_agg(user_id), '{}'::uuid[]) into v_members from public.room_members where room_id = r.room_id and status = 'ACTIVE';
    v_n := v_n + public.notify_publish('ROUND_STARTED', r.room_id, r.id, null, v_members, 'ROUND_STARTED:node=' || r.id, '{}'::jsonb);
  end loop;
  return v_n;
end $$;

-- 리프 end_date = today + 1 (D-1) / + 3 (D-3), 유효 배정 중 미제출자만. 설정 필터는 notify_enabled(days) 가 한다
create or replace function public.job_deadline_reminder() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.kst_today(); v_d int; r record; v_n int := 0;
begin
  foreach v_d in array array[1, 3] loop
    for r in
      select n.id, n.room_id, array_agg(a.user_id) as users
      from public.goal_nodes n
      join public.rooms rm on rm.id = n.room_id
      join public.task_assignments a on a.node_id = n.id and a.released_at is null
      left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
      where n.task_type is not null and n.archived_at is null and rm.status = 'ACTIVE' and rm.archived_at is null
        and n.end_date = v_today + v_d and s.id is null
      group by n.id, n.room_id order by n.id
    loop
      v_n := v_n + public.notify_publish('DEADLINE_REMINDER', r.room_id, r.id, null, r.users,
                                         'DEADLINE_REMINDER:node=' || r.id || ':d=' || v_d, jsonb_build_object('days', v_d));
    end loop;
  end loop;
  return v_n;
end $$;

-- DAILY_DIGEST 방: 어제(KST) 마지막 제출로 전원 제출이 된 리프 수 → 그룹장 1건
create or replace function public.job_completion_digest() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.kst_today(); r record; v_n int := 0;
begin
  for r in
    select rm.id, rm.leader_id, count(*)::int as cnt
    from public.rooms rm
    left join public.room_notification_settings st on st.room_id = rm.id
    join lateral (
      select n.id
      from public.goal_nodes n
      join public.task_assignments a on a.node_id = n.id and a.released_at is null
      left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
      where n.room_id = rm.id and n.task_type is not null and n.archived_at is null
      group by n.id
      having count(a.id) > 0 and count(s.id) = count(a.id)
         and (max(s.first_submitted_at) at time zone 'Asia/Seoul')::date = v_today - 1) done on true
    where rm.status = 'ACTIVE' and rm.archived_at is null and coalesce(st.completion_mode, 'DAILY_DIGEST') = 'DAILY_DIGEST'
    group by rm.id, rm.leader_id order by rm.id
  loop
    v_n := v_n + public.notify_publish('TASK_COMPLETION_DIGEST', r.id, null, null, array[r.leader_id],
                                       'TASK_COMPLETION_DIGEST:room=' || r.id || ':d=' || to_char(v_today, 'YYYY-MM-DD'),
                                       jsonb_build_object('count', r.cnt));
  end loop;
  return v_n;
end $$;

-- 1시간 넘게 PENDING 인 첨부 → DELETED. DELETED 7일 경과 → Storage 객체 + 행 삭제. SENT 메일 30일 경과 삭제
create or replace function public.job_cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_expired int; v_purged int; v_mail int;
begin
  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'PENDING' and created_at < now() - interval '1 hour';
  get diagnostics v_expired = row_count;

  delete from storage.objects o
  using public.files f
  where o.bucket_id = f.bucket_id and o.name = f.object_path and f.status = 'DELETED' and f.deleted_at < now() - interval '7 days';
  delete from public.files where status = 'DELETED' and deleted_at < now() - interval '7 days';
  get diagnostics v_purged = row_count;

  delete from public.mail_outbox where status = 'SENT' and sent_at < now() - interval '30 days';
  get diagnostics v_mail = row_count;

  return jsonb_build_object('filesExpired', v_expired, 'filesPurged', v_purged, 'mailPurged', v_mail);
end $$;

-- I7 보정: member_count = COUNT(ACTIVE). 원자 증감이 어긋났을 때만 UPDATE
create or replace function public.member_count_audit() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  with c as (select room_id, count(*)::int as n from public.room_members where status = 'ACTIVE' group by room_id)
  update public.rooms r set member_count = c.n from c where c.room_id = r.id and r.member_count <> c.n;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.job_draft_blocked()     from public, anon, authenticated;
revoke execute on function public.job_round_started()     from public, anon, authenticated;
revoke execute on function public.job_deadline_reminder() from public, anon, authenticated;
revoke execute on function public.job_completion_digest() from public, anon, authenticated;
revoke execute on function public.job_cleanup()           from public, anon, authenticated;
revoke execute on function public.member_count_audit()    from public, anon, authenticated;
grant  execute on function public.job_draft_blocked(), public.job_round_started(), public.job_deadline_reminder(),
                          public.job_completion_digest(), public.job_cleanup(), public.member_count_audit() to service_role;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/jobs-sql.test.ts`
Expected: 7 passed. `job_completion_digest` 가 0 이면 시드의 IAM 제출 시각이 과거(10/03 18:00 KST, 10/04 09:00 KST)인지 확인 — `max(first_submitted_at)` 이 하나의 10/11 제출이어야 한다. `job_round_started` 의 `n >= 4` 는 같은 날 시작하는 다른 시드 회차가 있어도 통과하도록 둔 하한.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_notifications.sql supabase/tests/jobs-sql.test.ts
git commit -m "feat(db): cron job functions (draft blocked, round started, deadline reminder, digest, cleanup, member_count audit)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

## Phase 6 — 태그 (`0009_tags.sql`) · cron 등록 (`0010_cron.sql`) · 시드

### Task 8: 태그 사전 시드 · `tags_search` · `room_tags_get/put` · `tag_autoselect` · `tag_apply_auto`

**Files:**
- Create: `supabase/migrations/0009_tags.sql`
- Test: `supabase/tests/tags-sql.test.ts`

**Interfaces:**
- Consumes: Task 5 `leader_room`, plan 02 `room_readable`, `current_user_id`, `kst_today`, plan 03 `node_update`(훅 검증). 0001 `tags(slug, label UNIQUE, tone, aliases, kind, usage_count)`, `room_tags(room_id, tag_slug, source, sort_order)`, `room_tag_suppressions`.
- Produces:
  ```sql
  -- 사전 19종 (slug): aws, cloud, certificate, english, toeic, spring, backend, java, algorithm, coding-test,
  --   info-processing, cs, interview, react, frontend, docker, kubernetes, sql, data
  public.tag_term_hit(p_text text, p_term text) returns boolean          -- 대소문자 무시 부분 일치, 2자 이상
  public.tag_slug_for(p_label text) returns text                          -- 자유 입력 → 기존 라벨 재사용 또는 CUSTOM 생성(VALIDATION_FAILED 1~20자)
  public.room_tag_json(p_room bigint) returns jsonb                       -- RoomTag[]
  public.tags_search(p_q text default null) returns jsonb                 -- {items} 상위 20, usage_count DESC
  public.room_tags_get(p_slug text) returns jsonb                         -- {today, items}
  public.room_tags_put(p_slug text, p_slugs text[], p_free_labels text[]) returns jsonb   -- {today, items}, ≤8
  public.tag_apply_auto(p_room bigint, p_slugs text[]) returns jsonb      -- AUTO 교체·MANUAL 보존·억제 존중·≤8, RoomTag[]
  public.tag_autoselect(p_room bigint) returns int                        -- 키워드 점수 상위 5 → tag_apply_auto, 적용 수
  public.room_tags_suggest(p_slug text) returns jsonb                     -- 그룹장이 수동으로 다시 고르기 {today, items}
  ```
  **plan 02 시드와의 계약:** `seed.sql` 의 `room_tags` 행은 위 slug 를 참조해야 한다(aws: `aws`·`cloud` AUTO, `certification` MANUAL 등 `src/data/room-view.ts` 의 `auto` 플래그대로). plan 02 시드가 `tags` 사전 자체를 넣었다면 그 블록을 지운다 — 사전의 출처는 0009 하나다. plan 02/03 의 `room_*`/`node_*` 끝에 `if to_regproc('public.tag_autoselect') is not null then perform public.tag_autoselect(v_room_id); end if;` 가드가 있어야 "node_update 가 태그를 다시 고른다" 사례가 통과한다.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/tags-sql.test.ts`**

```ts
import { assert, assertEquals } from "jsr:@std/assert";
import { asUser, bootDb, cases, expectFail, nodeId, one, roomId, uidOf, type Q } from "./_boot.ts";
import { sqlArr } from "./_submit.ts";

const { db, q } = await bootDb();
const tagsOf = async (q: Q, slug: string) =>
  q("select rt.tag_slug as slug, rt.source from public.room_tags rt join public.rooms r on r.id = rt.room_id where r.slug = $1 order by rt.sort_order, rt.created_at, rt.tag_slug", [slug]);
const put = async (q: Q, slug: string, slugs: string[], free: string[] = []) =>
  (await one(q, "select public.room_tags_put($1, $2::text[], $3::text[]) as r", [slug, sqlArr(slugs), sqlArr(free)])).r;
const autoselect = async (q: Q, room: string) => Number((await one(q, "select public.tag_autoselect($1::bigint) as n", [room])).n);

cases("tags", db, q, [
  { name: "dictionary: 19 curated tags with palette tones; aws room tags from seed", run: async (q) => {
    const t = await q("select slug, label, tone, kind from public.tags where kind = 'CURATED' order by slug");
    assertEquals(t.length, 19);
    const by = Object.fromEntries(t.map((x) => [x.label, x.tone]));
    assertEquals(by["AWS"], "mint"); assertEquals(by["클라우드"], "blue"); assertEquals(by["자격증"], "peach");
    assertEquals(by["Spring"], "lav"); assertEquals(by["알고리즘"], "slate"); assertEquals(by["Kubernetes"], "lav");
    const aws = (await one(q, "select public.room_tags_get('aws') as r")).r;
    assertEquals(aws.items.map((x: { label: string; auto: boolean }) => [x.label, x.auto]), [["AWS", true], ["클라우드", true], ["자격증", false]]);
    assertEquals(typeof aws.today, "string");
    await expectFail(q("select public.room_tags_get('nope')"), "ROOM_NOT_FOUND");
    await asUser(q, null);
    await expectFail(q("select public.room_tags_get('spring')"), "ROOM_NOT_FOUND");   // 비공개 방
  } },

  { name: "tag_autoselect(aws): AWS, 자격증, 클라우드 lead; ≤5; AUTO replaced, MANUAL kept", run: async (q) => {
    const aws = await roomId(q, "aws");
    await q("delete from public.room_tags where room_id = $1::bigint", [aws]);
    await q("insert into public.room_tags (room_id, tag_slug, source, sort_order) values ($1::bigint, 'interview', 'MANUAL', 0), ($1::bigint, 'toeic', 'AUTO', 1)", [aws]);
    const n = await autoselect(q, aws);
    assert(n >= 3 && n <= 5, String(n));
    const t = await tagsOf(q, "aws");
    const auto = t.filter((x) => x.source === "AUTO").map((x) => x.slug);
    assertEquals(auto.slice(0, 3), ["aws", "certification", "cloud"]);
    assert(!auto.includes("toeic"));                                           // 옛 AUTO 는 교체
    assertEquals(t.filter((x) => x.source === "MANUAL").map((x) => x.slug), ["interview"]);
    assertEquals(await autoselect(q, aws), n);                                 // 멱등
    assertEquals((await tagsOf(q, "aws")).length, t.length);
  } },

  { name: "suppression: removing an AUTO tag via room_tags_put keeps it away from autoselect; adding it back lifts suppression (Review Focus 5)", run: async (q) => {
    const aws = await roomId(q, "aws");
    await asUser(q, await uidOf(q, "민수"));
    await autoselect(q, aws);
    let r = await put(q, "aws", ["certification"]);                            // AWS·클라우드 AUTO 제거
    assertEquals(r.items.map((x: { slug: string }) => x.slug), ["certification"]);
    const sup = await q("select tag_slug from public.room_tag_suppressions where room_id = $1::bigint order by 1", [aws]);
    assert(sup.map((x) => x.tag_slug).includes("aws"));
    assert(sup.map((x) => x.tag_slug).includes("cloud"));
    await autoselect(q, aws);
    const after = (await tagsOf(q, "aws")).map((x) => x.slug);
    assert(!after.includes("aws")); assert(!after.includes("cloud"));
    assert(after.includes("certification"));
    r = await put(q, "aws", ["certification", "aws"]);                         // 수동으로 다시 넣으면 억제 해제, MANUAL
    assertEquals((await tagsOf(q, "aws")).find((x) => x.slug === "aws")?.source, "MANUAL");
    assertEquals((await q("select 1 from public.room_tag_suppressions where room_id = $1::bigint and tag_slug = 'aws'", [aws])).length, 0);
    await put(q, "aws", ["certification"]);                                    // MANUAL 을 빼는 건 억제가 아니다
    assertEquals((await q("select 1 from public.room_tag_suppressions where room_id = $1::bigint and tag_slug = 'aws'", [aws])).length, 0);
  } },

  { name: "room_tags_put: limit 8, CUSTOM free labels (reuse by label), VALIDATION_FAILED, NOT_LEADER, usage_count", run: async (q) => {
    await asUser(q, await uidOf(q, "민수"));
    await expectFail(put(q, "aws", ["aws", "cloud", "certification", "english", "toeic", "spring", "backend", "java", "sql"]), "TAG_LIMIT_EXCEEDED");
    await expectFail(put(q, "aws", ["aws"], ["a".repeat(21)]), "VALIDATION_FAILED");
    await expectFail(put(q, "aws", ["aws"], ["   "]), "VALIDATION_FAILED");
    await expectFail(put(q, "aws", ["not-a-tag"]), "NOT_FOUND");
    const r = await put(q, "aws", ["aws"], ["나만의 태그", "spring"]);          // "spring" 은 라벨 Spring 과 같아 재사용
    assertEquals(r.items.map((x: { label: string; auto: boolean }) => [x.label, x.auto]), [["AWS", false], ["나만의 태그", false], ["Spring", false]]);
    const custom = await one(q, "select slug, kind, tone, usage_count from public.tags where label = '나만의 태그'");
    assertEquals(custom.kind, "CUSTOM");
    assert(String(custom.slug).startsWith("c-"));
    assertEquals(custom.usage_count, 1);
    assertEquals((await one(q, "select usage_count from public.tags where slug = 'cloud'")).usage_count,
                 Number((await one(q, "select count(*)::int as n from public.room_tags where tag_slug = 'cloud'")).n));
    await asUser(q, await uidOf(q, "철수"));
    await expectFail(put(q, "aws", ["aws"]), "NOT_LEADER");
    await asUser(q, await uidOf(q, "현우"));
    await expectFail(put(q, "algo", ["aws"]), "ROOM_NOT_EDITABLE");           // ENDED
  } },

  { name: "tags_search: label/alias ILIKE, top 20 by usage, empty q lists all (≤20)", run: async (q) => {
    const s = (await one(q, "select public.tags_search('클라') as r")).r;
    assertEquals(s.items.map((x: { slug: string }) => x.slug), ["cloud"]);
    const a = (await one(q, "select public.tags_search('쿠버') as r")).r;       // alias
    assertEquals(a.items[0].slug, "kubernetes");
    assertEquals(a.items[0].auto, false);
    const all = (await one(q, "select public.tags_search('') as r")).r;
    assert(all.items.length >= 19 && all.items.length <= 20);
    assertEquals((await one(q, "select public.tags_search('zzzz') as r")).r.items, []);
  } },

  { name: "node_update in plan 03 re-runs tag_autoselect (hook guard present)", run: async (q) => {
    const aws = await roomId(q, "aws");
    const ec2 = await nodeId(q, "aws", "EC2 인스턴스 유형 정리");
    await asUser(q, await uidOf(q, "민수"));
    await autoselect(q, aws);
    assert(!(await tagsOf(q, "aws")).some((x) => x.slug === "docker"));
    await q(`select public.node_update('aws', $1::bigint, '{"title":"EC2 인스턴스 유형 정리 (도커 컨테이너 실습)"}'::jsonb)`, [ec2]);
    const t = await tagsOf(q, "aws");
    assert(t.some((x) => x.slug === "docker" && x.source === "AUTO"), JSON.stringify(t));
  } },
]);
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/tags-sql.test.ts`
Expected: FAIL — "dictionary" 사례에서 19 가 아닌 수(plan 02 시드가 태그를 넣었으면 그 수, 아니면 0), `room_tags_get` 없음.

- [ ] **Step 3: `supabase/migrations/0009_tags.sql` 작성**

```sql
-- 0009_tags.sql — 태그 사전 · 방 태그 · 자동 선택 (플랜 04 Task 8). 배포 후 수정 금지.

-- ───────── 사전 시드 (D12, cross-cutting §2.6). 운영 데이터이므로 seed.sql 이 아니라 마이그레이션에 둔다 ─────────
-- tone 은 src/data/room-view.ts·my-study.ts 의 태그 칩 색. aliases 는 자동 선택용 소문자 키워드(2자 이상).
insert into public.tags (slug, label, tone, aliases, kind) values
  ('aws',             'AWS',        'mint',  array['amazon', '아마존', 'saa', 'iam', 'ec2', 's3', 'vpc', 'rds', 'dynamodb'], 'CURATED'),
  ('cloud',           '클라우드',    'blue',  array['cloud', '고가용성', '인프라', '오토스케일링', '로드밸런서'], 'CURATED'),
  ('certificate',   '자격증',      'peach', array['합격', '기출', '모의고사'], 'CURATED'),
  ('english',         '영어',        'blue',  array['english', '영단어', 'lc·rc'], 'CURATED'),
  ('toeic',           '토익',        'peach', array['toeic'], 'CURATED'),
  ('spring',          'Spring',     'lav',   array['스프링', 'jpa', '김영한', 'mvc'], 'CURATED'),
  ('backend',         '백엔드',      'blue',  array['backend', '서버', '서블릿'], 'CURATED'),
  ('java',            'Java',       'amber', array['자바'], 'CURATED'),
  ('algorithm',       '알고리즘',    'slate', array['백준', '프로그래머스', '그리디', 'bfs', 'dfs', '백트래킹', '최단경로'], 'CURATED'),
  ('coding-test',     '코딩테스트',  'mint',  array['코테', '문제 풀이', '1문제'], 'CURATED'),
  ('info-processing', '정보처리기사', 'amber', array['정처기', '실기'], 'CURATED'),
  ('cs',              'CS',         'amber', array['운영체제', '네트워크', 'computer science'], 'CURATED'),
  ('interview',       '면접',        'lav',   array['인터뷰', '모의 면접'], 'CURATED'),
  ('react',           'React',      'blue',  array['리액트', 'react.dev'], 'CURATED'),
  ('frontend',        '프론트엔드',  'mint',  array['frontend', '프론트'], 'CURATED'),
  ('docker',          'Docker',     'blue',  array['도커', '컨테이너'], 'CURATED'),
  ('kubernetes',      'Kubernetes', 'lav',   array['k8s', '쿠버네티스'], 'CURATED'),
  ('sql',             'SQL',        'amber', array['sqld', 'join', '서브쿼리', '윈도우 함수'], 'CURATED'),
  ('data',            '데이터',      'blue',  array['데이터 모델링', '데이터 분석'], 'CURATED')
on conflict (slug) do update set label = excluded.label, tone = excluded.tone, aliases = excluded.aliases, kind = excluded.kind;

-- ───────── usage_count 유지 ─────────
create or replace function public.room_tags_usage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.tags set usage_count = usage_count + 1 where slug = new.tag_slug;
    return new;
  elsif tg_op = 'DELETE' then
    update public.tags set usage_count = greatest(usage_count - 1, 0) where slug = old.tag_slug;
    return old;
  end if;
  return null;
end $$;
create trigger trg_room_tags_usage after insert or delete on public.room_tags
  for each row execute function public.room_tags_usage();
update public.tags t set usage_count = (select count(*) from public.room_tags rt where rt.tag_slug = t.slug);

-- ───────── 헬퍼 ─────────
-- 부분 일치(대소문자 무시). 와일드카드 문제를 피하려고 ILIKE 대신 position
create or replace function public.tag_term_hit(p_text text, p_term text) returns boolean
language sql immutable as $$
  select p_text is not null and length(trim(coalesce(p_term, ''))) >= 2 and position(lower(trim(p_term)) in lower(p_text)) > 0
$$;

create or replace function public.room_tag_json(p_room bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label, 'tone', t.tone, 'auto', rt.source = 'AUTO')
                            order by rt.sort_order, rt.created_at, t.slug), '[]'::jsonb)
  from public.room_tags rt join public.tags t on t.slug = rt.tag_slug
  where rt.room_id = p_room
$$;

-- 자유 입력 라벨 → slug. 같은 라벨(대소문자 무시)이 있으면 재사용, 없으면 CUSTOM 생성(slug = 'c-' || md5 앞 10자, tone = 라벨 해시)
create or replace function public.tag_slug_for(p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_label text := trim(coalesce(p_label, '')); v_slug text;
begin
  if length(v_label) < 1 or length(v_label) > 20 then
    perform public.fail('VALIDATION_FAILED', '태그는 1~20자예요', jsonb_build_object('field', 'freeLabels', 'label', v_label));
  end if;
  select slug into v_slug from public.tags where lower(label) = lower(v_label);
  if found then return v_slug; end if;
  v_slug := 'c-' || left(md5(lower(v_label)), 10);
  insert into public.tags (slug, label, tone, aliases, kind)
  values (v_slug, v_label, (array['mint', 'blue', 'peach', 'lav', 'amber', 'slate'])[1 + (abs(hashtext(lower(v_label))) % 6)], '{}', 'CUSTOM')
  on conflict (slug) do nothing;
  return v_slug;
end $$;

-- ───────── 읽기 (03-api §7) ─────────
create or replace function public.tags_search(p_q text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(x.j), '[]'::jsonb))
  from (select jsonb_build_object('slug', t.slug, 'label', t.label, 'tone', t.tone, 'auto', false) as j
        from public.tags t
        where nullif(trim(coalesce(p_q, '')), '') is null
           or t.label ilike '%' || trim(p_q) || '%'
           or exists (select 1 from unnest(t.aliases) a where a ilike '%' || trim(p_q) || '%')
        order by t.usage_count desc, t.label
        limit 20) x
$$;

create or replace function public.room_tags_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, public.current_user_id()) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'items', public.room_tag_json(r.id));
end $$;

-- ───────── 수동 편집 (그룹장, 전체 교체, ≤8) ─────────
-- 목록에서 빠진 AUTO 태그는 억제 목록에 넣고, 목록에 있는 태그는 억제를 푼다. 목록의 태그는 전부 MANUAL
create or replace function public.room_tags_put(p_slug text, p_slugs text[] default '{}', p_free_labels text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; v_slugs text[] := '{}'; v_s text; v_lab text;
begin
  r := public.leader_room(p_slug, true);
  if r.status = 'ENDED' then perform public.fail('ROOM_NOT_EDITABLE', '종료된 스터디의 태그는 바꿀 수 없어요'); end if;
  foreach v_s in array coalesce(p_slugs, '{}') loop
    if not exists (select 1 from public.tags where slug = v_s) then
      perform public.fail('NOT_FOUND', '없는 태그예요', jsonb_build_object('field', 'slugs', 'slug', v_s));
    end if;
    if not (v_s = any(v_slugs)) then v_slugs := v_slugs || v_s; end if;
  end loop;
  foreach v_lab in array coalesce(p_free_labels, '{}') loop
    v_s := public.tag_slug_for(v_lab);
    if not (v_s = any(v_slugs)) then v_slugs := v_slugs || v_s; end if;
  end loop;
  if cardinality(v_slugs) > 8 then perform public.fail('TAG_LIMIT_EXCEEDED', '태그는 8개까지예요', '{"field":"slugs"}'::jsonb); end if;

  insert into public.room_tag_suppressions (room_id, tag_slug)
  select r.id, rt.tag_slug from public.room_tags rt
  where rt.room_id = r.id and rt.source = 'AUTO' and not (rt.tag_slug = any(v_slugs))
  on conflict do nothing;
  delete from public.room_tag_suppressions where room_id = r.id and tag_slug = any(v_slugs);

  delete from public.room_tags where room_id = r.id and not (tag_slug = any(v_slugs));
  insert into public.room_tags (room_id, tag_slug, source, sort_order)
  select r.id, s.slug, 'MANUAL', s.ord - 1 from unnest(v_slugs) with ordinality as s(slug, ord)
  on conflict (room_id, tag_slug) do update set source = 'MANUAL', sort_order = excluded.sort_order;

  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'items', public.room_tag_json(r.id));
end $$;

-- ───────── 자동 선택 (D12, mystudy §2.5) ─────────
-- 머지: 사전에 있고 억제되지 않은 slug 만, 최대 5. AUTO 는 전부 교체, MANUAL 보존, 방당 8개 안에서만 추가. LLM(Edge Function)도 이 함수를 쓴다
create or replace function public.tag_apply_auto(p_room bigint, p_slugs text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_slugs text[]; v_room int;
begin
  select coalesce(array_agg(s.slug order by s.ord), '{}') into v_slugs
  from (select distinct on (x.slug) x.slug, x.ord from unnest(coalesce(p_slugs, '{}')) with ordinality as x(slug, ord) order by x.slug, x.ord) s
  join public.tags t on t.slug = s.slug
  where not exists (select 1 from public.room_tag_suppressions sp where sp.room_id = p_room and sp.tag_slug = s.slug);
  v_slugs := v_slugs[1:5];

  delete from public.room_tags where room_id = p_room and source = 'AUTO' and not (tag_slug = any(v_slugs));

  select 8 - count(*) into v_room from public.room_tags where room_id = p_room;
  insert into public.room_tags (room_id, tag_slug, source, sort_order)
  select p_room, s.slug, 'AUTO', 100 + s.ord
  from unnest(v_slugs) with ordinality as s(slug, ord)
  where not exists (select 1 from public.room_tags rt where rt.room_id = p_room and rt.tag_slug = s.slug)
  order by s.ord
  limit greatest(v_room, 0);
  return public.room_tag_json(p_room);
end $$;

-- 키워드 점수: 제목 3, 소개 2, 노드 제목 모음 1 (용어별 합). score > 0 상위 5 → tag_apply_auto. room_*/node_* 끝에서 가드 호출
create or replace function public.tag_autoselect(p_room bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_title text; v_intro text; v_nodes text; v_slugs text[];
begin
  select r.title, r.intro into v_title, v_intro from public.rooms r where r.id = p_room;
  if not found then return 0; end if;
  select string_agg(n.title, ' ' order by n.sort_order, n.id) into v_nodes
  from public.goal_nodes n where n.room_id = p_room and n.archived_at is null;

  select coalesce(array_agg(h.slug order by h.score desc, h.slug), '{}') into v_slugs
  from (
    select t.slug,
           sum(case when public.tag_term_hit(v_title, x.term) then 3 else 0 end
             + case when public.tag_term_hit(v_intro, x.term) then 2 else 0 end
             + case when public.tag_term_hit(v_nodes, x.term) then 1 else 0 end) as score
    from public.tags t
    cross join lateral unnest(array_append(t.aliases, t.label)) as x(term)
    group by t.slug
    having sum(case when public.tag_term_hit(v_title, x.term) then 3 else 0 end
             + case when public.tag_term_hit(v_intro, x.term) then 2 else 0 end
             + case when public.tag_term_hit(v_nodes, x.term) then 1 else 0 end) > 0
    order by 2 desc, 1
    limit 5) h;
  perform public.tag_apply_auto(p_room, v_slugs);
  return cardinality(v_slugs);
end $$;

-- 그룹장이 "다시 고르기" 를 누를 때(03-api §7 suggest 의 SQL 경로). LLM 경로는 Edge Function suggest-tags(Task 9)
create or replace function public.room_tags_suggest(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public.leader_room(p_slug, true);
  if r.status = 'ENDED' then perform public.fail('ROOM_NOT_EDITABLE', '종료된 스터디의 태그는 바꿀 수 없어요'); end if;
  perform public.tag_autoselect(r.id);
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'items', public.room_tag_json(r.id));
end $$;

revoke execute on function public.tag_apply_auto(bigint, text[]) from public, anon, authenticated;
revoke execute on function public.tag_autoselect(bigint)         from public, anon, authenticated;
revoke execute on function public.tag_slug_for(text)             from public, anon, authenticated;
grant  execute on function public.tag_apply_auto(bigint, text[]), public.tag_autoselect(bigint) to service_role;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/tags-sql.test.ts`
Expected: 6 passed. "aws room tags from seed" 가 비면 plan 02 시드의 `room_tags` 블록을 위 slug 로 맞춘다. "node_update re-runs" 가 실패하면 plan 03 `node_update` 끝에 가드 블록이 없는 것 — 0006 에 추가한다(이 플랜 서두 "태그 자동 선택 훅"). `autoselect` 상위 3 이 다르면 `aws` 의 intro(`SAA-C03 합격`)·노드 제목(`IAM`, `VPC`, `EC2`, `S3`, `고가용성`)이 시드에 그대로 들어갔는지 본다.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_tags.sql supabase/tests/tags-sql.test.ts
git commit -m "feat(db): tag dictionary, room_tags_put with suppressions, keyword tag_autoselect/tag_apply_auto

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 9 (선택, 기본 OFF): Edge Function `suggest-tags` — LLM 태그 제안

**Files:**
- Create: `supabase/functions/_shared/auth.ts`, `supabase/functions/suggest-tags/index.ts`, `supabase/functions/suggest-tags/deno.json`
- Modify: `README.md` (환경변수 표에 `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_TAG_SUGGEST` 두 줄)

**Interfaces:**
- Consumes: Task 8 `tag_apply_auto(p_room, p_slugs)`(service_role), `room_tags_suggest(p_slug)`(키워드 fallback), `tags` 사전, `rooms`, `goal_nodes`.
- Produces: `POST /functions/v1/suggest-tags { slug }` → `200 { items: RoomTag[], source: "llm" | "keyword" }`. 그룹장 JWT 필요(401/403). **배포하지 않으면 아무 영향 없다** — 프론트(plan 05)는 `NEXT_PUBLIC_TAG_SUGGEST=llm` 일 때만 이 함수를, 아니면 `room_tags_suggest` RPC 를 부른다.
- Secrets(Supabase 대시보드 → Edge Functions → Secrets 또는 `supabase secrets set`): `ANTHROPIC_API_KEY`. `SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 는 런타임이 자동 주입.

- [ ] **Step 1: `supabase/functions/_shared/auth.ts`** (chuck 프로젝트 패턴 그대로)

```ts
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Authorization: Bearer <user jwt> → 사용자 + 사용자 권한(RLS)의 클라이언트. 실패 시 null */
export async function authenticateUser(req: Request): Promise<{ user: User; supabaseClient: SupabaseClient } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const supabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await supabaseClient.auth.getUser();
  if (error || !user) return null;
  return { user, supabaseClient };
}

/** service_role 클라이언트 (RLS 우회 — tag_apply_auto 는 service_role 만 실행 가능) */
export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
```

- [ ] **Step 2: `supabase/functions/suggest-tags/deno.json`**

```json
{
  "imports": {
    "@anthropic-ai/sdk": "npm:@anthropic-ai/sdk@0.78.0",
    "@anthropic-ai/sdk/helpers/zod": "npm:@anthropic-ai/sdk@0.78.0/helpers/zod",
    "zod": "npm:zod@3.25.76"
  }
}
```

버전은 배포 시점의 최신 안정판으로 올린다(`npm view @anthropic-ai/sdk version`). `zodOutputFormat` 헬퍼는 SDK 의 `helpers/zod` 에 있다.

- [ ] **Step 3: `supabase/functions/suggest-tags/index.ts`**

```ts
// suggest-tags — 방 제목·소개·노드 제목 + 사전 slug 목록을 Claude 에 주고 0~5개 slug 를 받아 tag_apply_auto 로 머지한다.
// 사전 밖 slug 는 버린다(cross-cutting §2.6). 거부·타임아웃·파싱 실패 시 키워드 방식(room_tags_suggest)으로 fallback.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { authenticateUser, corsHeaders, getServiceClient } from "../_shared/auth.ts";

const MODEL = "claude-sonnet-5-5";
const Out = z.object({ slugs: z.array(z.string()).max(5) });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED" });

  const auth = await authenticateUser(req);
  if (!auth) return json(401, { code: "AUTH_REQUIRED" });
  const { slug } = await req.json().catch(() => ({}));
  if (typeof slug !== "string" || !slug) return json(400, { code: "VALIDATION_FAILED", details: { field: "slug" } });

  const admin = getServiceClient();
  const room = await admin.from("rooms").select("id, title, intro, description_md, leader_id, status").eq("slug", slug).maybeSingle();
  if (room.error || !room.data) return json(404, { code: "ROOM_NOT_FOUND" });
  if (room.data.leader_id !== auth.user.id) return json(403, { code: "NOT_LEADER" });
  if (room.data.status === "ENDED") return json(409, { code: "ROOM_NOT_EDITABLE" });

  const nodes = await admin.from("goal_nodes").select("title").eq("room_id", room.data.id).is("archived_at", null).order("sort_order");
  const dict = await admin.from("tags").select("slug, label, aliases").order("slug");
  if (nodes.error || dict.error) return json(500, { code: "UPSTREAM", message: (nodes.error ?? dict.error)!.message });

  // 키워드 fallback: 같은 머지 함수를 쓰는 SQL 경로. 사용자 권한으로 호출(그룹장 검사는 함수 안)
  const fallback = async (reason: string) => {
    const { data, error } = await auth.supabaseClient.rpc("room_tags_suggest", { p_slug: slug });
    if (error) return json(400, { code: error.message, message: error.details });
    return json(200, { ...data, source: "keyword", reason });
  };

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fallback("no_api_key");

  const client = new Anthropic({ apiKey, timeout: 8_000, maxRetries: 1 });
  const dictionary = dict.data.map((t) => `${t.slug}: ${t.label}${t.aliases?.length ? ` (${t.aliases.join(", ")})` : ""}`).join("\n");
  const prompt = [
    "다음 스터디 방에 어울리는 태그를 아래 사전에서만 0~5개 골라 slug 배열로 답해 주세요. 사전에 없는 slug 는 쓰지 마세요.",
    "", `제목: ${room.data.title}`, `소개: ${room.data.intro}`,
    `설명: ${String(room.data.description_md ?? "").slice(0, 2000)}`,
    `커리큘럼: ${nodes.data.map((n) => n.title).join(" / ")}`,
    "", "사전:", dictionary,
  ].join("\n");

  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: "low", format: zodOutputFormat(Out) },
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) return fallback(res.stop_reason ?? "no_output");
    const known = new Set(dict.data.map((t) => t.slug));
    const slugs = [...new Set(res.parsed_output.slugs)].filter((s) => known.has(s)).slice(0, 5);
    if (slugs.length === 0) return fallback("empty");
    const applied = await admin.rpc("tag_apply_auto", { p_room: room.data.id, p_slugs: slugs });
    if (applied.error) return json(400, { code: applied.error.message, message: applied.error.details });
    return json(200, { items: applied.data, source: "llm" });
  } catch (e) {
    if (e instanceof Anthropic.APIError) return fallback(`api_${e.status ?? "error"}`);
    return fallback("exception");
  }
});
```

- [ ] **Step 4: 타입 검사 · 로컬 호출**

Run:
```bash
cd /Users/picpal/Desktop/workspace/sgtudy/supabase/functions/suggest-tags && deno check index.ts
```
Expected: 오류 없음. 로컬 실행(선택, Docker 필요 — `vm_stat` 먼저):
```bash
supabase functions serve suggest-tags --env-file <(echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
curl -s -X POST http://127.0.0.1:54321/functions/v1/suggest-tags -H "Authorization: Bearer <민수 JWT>" -H "Content-Type: application/json" -d '{"slug":"aws"}'
```
Expected: `{"items":[...],"source":"llm"}` (키가 없으면 `"source":"keyword","reason":"no_api_key"`). 민수 JWT 는 로컬 Studio → Authentication 에서 Magic Link 로 로그인한 세션의 `access_token`, 또는 plan 01 `_testenv.ts` 의 `userClient()` 가 돌려주는 `c.auth.getSession()`.

- [ ] **Step 5: README 환경변수 표에 추가**

`README.md` 의 환경변수 표(plan 01 Task 3 가 만든 섹션) 끝에 두 줄:

```markdown
| `ANTHROPIC_API_KEY` | Supabase Edge Function secret | (선택) `suggest-tags` 가 LLM 태그 제안에 사용. 없으면 키워드 방식으로 동작 |
| `NEXT_PUBLIC_TAG_SUGGEST` | Vercel | `llm` 이면 프론트가 Edge Function 을, 그 외/미설정이면 `room_tags_suggest` RPC 를 부른다. 기본 미설정 |
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/auth.ts supabase/functions/suggest-tags README.md
git commit -m "feat(fn): optional suggest-tags Edge Function (Claude Sonnet 5.5, dictionary-validated, keyword fallback)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 10: `0010_cron.sql` · 시드 §4(알림·설정·링크)

**Files:**
- Create: `supabase/migrations/0010_cron.sql`
- Modify: `supabase/seed.sql` (끝에 §4 추가)
- Test: `supabase/tests/cron-sql.test.ts`, `supabase/tests/notifications-sql.test.ts`(Task 5 Step 4 의 `total` 상수를 `25 + 3` 으로 확정)

**Interfaces:**
- Consumes: `cron.schedule(name, schedule, command)`(호스팅 pg_cron / PGlite 스텁), `room_tick`(plan 02), Task 7 잡 6종. 시드: plan 02 방·멤버, plan 03 노드·제출.
- Produces: `cron.job` 7행. 시드: 철수 미읽음 알림 3건(`dedupe_key` `seed:*`), 모든 방의 `room_notification_settings` 행, 지은 EC2 제출의 링크 2개.

- [ ] **Step 1: 실패하는 테스트 `supabase/tests/cron-sql.test.ts`**

```ts
import { assertEquals } from "jsr:@std/assert";
import { asUser, bootDb, cases, nodeId, one, uidOf } from "./_boot.ts";

const { db, q } = await bootDb();

cases("cron+seed", db, q, [
  { name: "0010 registers 7 jobs with 02 §7 schedules (UTC)", run: async (q) => {
    const jobs = await q("select jobname, schedule, command from cron.job order by jobname");
    assertEquals(jobs.map((j) => [j.jobname, j.schedule, j.command]), [
      ["cleanup",            "0 19 * * *",  "select public.job_cleanup()"],
      ["completion_digest",  "0 0 * * *",   "select public.job_completion_digest()"],
      ["deadline_reminder",  "0 0 * * *",   "select public.job_deadline_reminder()"],
      ["draft_blocked",      "5 15 * * *",  "select public.job_draft_blocked()"],
      ["member_count_audit", "30 19 * * *", "select public.member_count_audit()"],
      ["room_tick",          "*/5 * * * *", "select public.room_tick()"],
      ["round_started",      "1 15 * * *",  "select public.job_round_started()"],
    ]);
  } },

  { name: "seed §4: 철수 has 3 unread notifications; every room has a settings row; 지은's EC2 submission has 2 links", run: async (q) => {
    const cheolsu = await uidOf(q, "철수");
    await asUser(q, cheolsu);
    assertEquals((await one(q, "select public.notifications_unread_count() as c")).c, { count: 3 });
    const l = (await one(q, "select public.notifications_list(null, 20) as l")).l;
    assertEquals(l.items.map((i: { kind: string }) => i.kind), ["SCHEDULE_CHANGED", "ROUND_STARTED", "DEADLINE_REMINDER"]);
    assertEquals(l.items[2].link, `/my-study/aws?task=${await nodeId(q, "aws", "EC2 인스턴스 유형 정리")}`);
    assertEquals(l.items[0].actor.nickname, "민수");
    const s = await one(q, "select count(*)::int as n from public.rooms r left join public.room_notification_settings st on st.room_id = r.id where st.room_id is null");
    assertEquals(s.n, 0);
    const links = await q(`select l.url from public.submission_links l join public.submissions s on s.id = l.submission_id
                           where s.node_id = $1::bigint and s.user_id = $2::uuid order by l.sort_order`,
                          [await nodeId(q, "aws", "EC2 인스턴스 유형 정리"), await uidOf(q, "지은")]);
    assertEquals(links.map((x) => x.url), ["https://docs.aws.amazon.com/ec2/latest/instancetypes/", "https://github.com/jieun/aws-notes/blob/main/ec2.md"]);
  } },
]);
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/cron-sql.test.ts`
Expected: FAIL — `cron.job` 0행, 철수 알림 0건.

- [ ] **Step 3: `supabase/migrations/0010_cron.sql`**

```sql
-- 0010_cron.sql — pg_cron 등록 (02 §7). 시각은 UTC(KST −9h).
-- PGlite 에는 pg_cron 이 없다: 확장은 있을 때만 켜고, cron.schedule 은 스텁(플랜 01)이 받는다. 호스팅에서는 대시보드 Database → Extensions 에서 pg_cron 을 켜 두면 이 블록이 no-op 이다.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
end $do$;

-- 같은 이름으로 다시 돌리면 pg_cron(≥1.4)·스텁 모두 갱신한다
select cron.schedule('room_tick',          '*/5 * * * *', 'select public.room_tick()');            -- 5분마다 RECRUIT→ACTIVE, ACTIVE→ENDED
select cron.schedule('draft_blocked',      '5 15 * * *',  'select public.job_draft_blocked()');     -- 00:05 KST
select cron.schedule('round_started',      '1 15 * * *',  'select public.job_round_started()');     -- 00:01 KST
select cron.schedule('deadline_reminder',  '0 0 * * *',   'select public.job_deadline_reminder()'); -- 09:00 KST
select cron.schedule('completion_digest',  '0 0 * * *',   'select public.job_completion_digest()'); -- 09:00 KST
select cron.schedule('cleanup',            '0 19 * * *',  'select public.job_cleanup()');           -- 04:00 KST
select cron.schedule('member_count_audit', '30 19 * * *', 'select public.member_count_audit()');    -- 04:30 KST
```

- [ ] **Step 4: `supabase/seed.sql` 끝에 §4 추가**

```sql
-- ═══════════ §4 알림 · 설정 · 제출 링크 (plan 04) ═══════════
-- 방 생성 함수를 거치지 않고 넣은 시드 방에도 설정 행을 보장
insert into public.room_notification_settings (room_id)
select id from public.rooms
on conflict (room_id) do nothing;

-- 철수 미읽음 3건 (헤더 배지·드롭다운). dedupe_key 로 멱등. 생성 시각은 기준일 10/12 전후
insert into public.notifications (user_id, kind, title, body, room_id, node_id, actor_user_id, link, dedupe_key, created_at)
select p.id, 'DEADLINE_REMINDER', '"EC2 인스턴스 유형 정리" 마감 1일 전이에요', r.title, r.id, n.id, null,
       '/my-study/aws?task=' || n.id, 'seed:DEADLINE_REMINDER:cheolsu', '2026-10-13 00:00:00+00'
from public.profiles p, public.rooms r
join public.goal_nodes n on n.room_id = r.id and n.title = 'EC2 인스턴스 유형 정리'
where p.nickname = '철수' and r.slug = 'aws'
on conflict (dedupe_key) do nothing;

insert into public.notifications (user_id, kind, title, body, room_id, node_id, actor_user_id, link, dedupe_key, created_at)
select p.id, 'ROUND_STARTED', r.title || '의 2주차가 시작됐어요', r.title, r.id, n.id, null,
       '/my-study/spring', 'seed:ROUND_STARTED:cheolsu', '2026-10-11 15:00:00+00'
from public.profiles p, public.rooms r
join public.goal_nodes n on n.room_id = r.id and n.depth = 2 and n.label = '2주차'
where p.nickname = '철수' and r.slug = 'spring'
on conflict (dedupe_key) do nothing;

insert into public.notifications (user_id, kind, title, body, room_id, node_id, actor_user_id, link, dedupe_key, created_at)
select p.id, 'SCHEDULE_CHANGED', r.title || ' 일정이 변경됐어요', null, r.id, null, a.id,
       '/my-study/aws', 'seed:SCHEDULE_CHANGED:cheolsu', '2026-10-12 01:30:00+00'
from public.profiles p, public.rooms r, public.profiles a
where p.nickname = '철수' and r.slug = 'aws' and a.nickname = '민수'
on conflict (dedupe_key) do nothing;

-- 지은의 EC2 제출(plan 03 시드 D) 에 링크 2개
insert into public.submission_links (submission_id, url, sort_order)
select s.id, x.url, x.ord
from public.submissions s
join public.goal_nodes n on n.id = s.node_id and n.title = 'EC2 인스턴스 유형 정리'
join public.profiles p on p.id = s.user_id and p.nickname = '지은'
cross join (values ('https://docs.aws.amazon.com/ec2/latest/instancetypes/', 0), ('https://github.com/jieun/aws-notes/blob/main/ec2.md', 1)) as x(url, ord)
where not exists (select 1 from public.submission_links l where l.submission_id = s.id and l.url = x.url);
```

- [ ] **Step 5: 실행해서 통과 확인 + 전체 회귀**

Run:
```bash
cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/cron-sql.test.ts
deno test --allow-read --allow-env supabase/tests/
```
Expected: cron+seed 2 passed. 전체: plan 01~03 사례 + 이 플랜 2(boot) + 6 + 4 + 6 + 9 + 6 + 7 + 6 + 2 = 48 passed 추가. `notifications-sql.test.ts` "list" 사례의 `total` 을 `25 + 3` 상수로 되돌려 둔 상태에서 통과해야 한다. 순서 단언 `["SCHEDULE_CHANGED","ROUND_STARTED","DEADLINE_REMINDER"]` 는 id 역순(삽입 역순)이다.

- [ ] **Step 6: 로컬 Supabase `db reset` 실측**

Run:
```bash
vm_stat | grep -E 'free|compressor'
supabase start && npm run db:reset
psql "$(supabase status -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["DB_URL"])')" -c "select jobname, schedule from cron.job order by 1;" -c "select count(*) from public.notifications;" -c "select public.job_deadline_reminder();"
```
Expected: 0007~0010 적용 로그, `cron.job` 7행(대시보드에서 pg_cron 이 꺼져 있으면 `schema "cron" does not exist` — Database → Extensions 에서 `pg_cron` 을 켜고 다시 reset), 알림 3건, `job_deadline_reminder()` 가 정수 반환(실제 날짜 기준이라 0 일 수 있음).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0010_cron.sql supabase/seed.sql supabase/tests/cron-sql.test.ts supabase/tests/notifications-sql.test.ts
git commit -m "feat(db): 0010 cron schedules; seed notifications, settings rows, submission links

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

## Phase 종료 게이트

1. `cd /Users/picpal/Desktop/workspace/sgtudy && deno test --allow-read --allow-env supabase/tests/` 전부 통과(plan 01~04).
2. `supabase db reset` 성공(0001~0010 + seed), Studio 에서 `cron.job` 7행·`tags` 19행·철수 알림 3건 확인.
3. 로컬 Supabase 가 떠 있으면 `files-db.test.ts`(Storage 정책) 통과.
4. `supabase gen types typescript --local > src/lib/supabase/database.types.ts` 재생성 → `submission_upsert`, `task_get`, `file_register`, `notifications_*`, `settings_*`, `member_deactivate*`, `tags_search`, `room_tags_*` 가 `Functions` 에 보인다. 커밋 `chore(db): regenerate types after phase 4-6`.
5. plan 05 로 넘어가기 전에 00 개요 "공통 계약" 의 `notify_publish` 시그니처가 0004·0008 양쪽에서 동일한지 `\df public.notify_publish` 로 한 번 더 확인(오버로드가 2개면 0004 의 placeholder 인자 이름이 달랐던 것 — 0008 첫 줄에 `drop function if exists public.notify_publish(text, bigint, bigint, uuid, uuid[], text, jsonb);` 를 추가하고 의존 함수가 있으면 그 함수들을 0008 에서 `CREATE OR REPLACE` 로 다시 정의한다).

## Self-Review 메모

- **스펙 커버리지:** 03-api §5(task_get, submission_upsert, file_register — presign/url 은 Storage SDK 직접) Task 2~4. §3 이탈 2종 Task 6. §7 알림 4종·설정 2종 Task 5, 태그 3종(+suggest SQL 경로 `room_tags_suggest`, LLM 경로 Task 9) Task 8. 02 §6 잡 7종 중 `room_tick` 은 plan 02, 나머지 6종 Task 7, §7 cron 7줄 Task 10, §8 시드(알림 3건·태그 19) Task 8·10. D8 15종 kind 템플릿·링크·본인 제외·dedupe Task 5. D10 제한값 전부 Task 2·3. D11 이탈 2단계·REASSIGN_REQUIRED Task 6. D12 머지 규칙·억제·≤8·CUSTOM Task 8. 빠진 것: `mail_outbox` 적재(2단계, D0 메일 — `job_cleanup` 의 SENT 정리만 둠), Realtime 배지(2단계).
- **Review Focus 매핑:** 1 → Task 2 "is_late boundary" 2사례. 2 → Task 6 "deactivate 지은"·"도윤" + Task 4 "archived node". 3 → Task 5 "dedupe"·"placeholder calls(tick 2회)", Task 7 모든 잡의 재실행 0건. 4 → Task 5 "optional kind filtered". 5 → Task 8 "suppression".
- **타입 일관성:** `notify_publish(text, bigint, bigint, uuid, uuid[], text, jsonb) returns int` 0004=0008. `leader_room(p_slug, p_lock)` 은 Task 5 정의, Task 6·8 사용. `submission_json(bigint)` Task 2 정의, Task 4 사용. `room_leaf_stats`·`room_readable`·`room_release_seat`·`membership_result`·`assignment_resync` 는 plan 02 산출물 표의 이름 그대로. 테스트 헬퍼는 전부 Task 1 `_boot.ts` + Task 2 `_submit.ts`.
- **알려진 가정(실행자가 맨 먼저 확인):** plan 02 `room_apply(p_slug)`·`room_approve(p_slug, p_user)`·`room_members_json` 의 INACTIVE 포함, plan 03 `node_update(p_slug, p_node_id, p_patch)` 가 기간 변경 시 `SCHEDULE_CHANGED` 를 부르고 끝에서 `tag_autoselect` 가드를 호출, plan 03 시드의 제출 시각(D = end_date 18:00 KST, L = 다음날 09:00 KST)과 `room_tags` slug. 어긋나면 **이 플랜의 테스트가 아니라 해당 플랜 쪽(배포 전이므로 0004~0006/seed)** 을 00 개요 계약에 맞춘다.
- **Placeholder 스캔:** "TBD/TODO/similar to" 없음. Task 9 의 SDK 버전 핀은 배포 시점 갱신이 의도된 값.
