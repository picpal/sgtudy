# 슥터디 백엔드 Implementation Plan — 02 방 · 멤버십 (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방 생성·수정·상태 전환(DRAFT→RECRUIT→ACTIVE→ENDED, 보관)·목록/상세 집계 JSON·멤버십 상태 머신(참가/신청/취소/승인/거절)·초대 링크·`room_tick()` 을 Postgres 함수로 구현하고, 목업 9개 방·멤버를 시드한다.

**Architecture:** 모든 쓰기 함수는 `room_lock(p_slug)` 로 방 행을 `FOR UPDATE` 잠근 뒤 상태를 검사하고, 정원은 `UPDATE rooms SET member_count = member_count + 1 WHERE … member_count < max_members RETURNING id` 한 문장으로 판정한다(D3). 공통 과제 담당자는 `assignment_resync(p_room)` 하나가 멱등하게 실체화한다(D4). 읽기 함수(`rooms_list`, `room_get`)는 `SECURITY DEFINER` 로 두고 공개 범위(scope·visibility·초대 토큰)를 함수 안에서 명시적으로 거른다 — 비공개 방은 `ROOM_NOT_FOUND`. 알림은 `notify_publish()` **no-op 자리표**를 0004 에 만들어 호출부를 지금 컴파일하고, 0008(플랜 04)이 같은 시그니처로 `CREATE OR REPLACE` 한다.

**Tech Stack:** Postgres 15 plpgsql(Supabase), PGlite 0.3 + Deno 테스트(플랜 01 하네스), 로컬 Supabase(동시성 사례 1건).

**Spec:** `docs/backend/01-decisions.md`(D2·D3·D4·D11·D13), `docs/backend/02-domain-and-schema.md`(§2 rooms/room_members/room_invites/task_assignments, §3 I7·I8·I10·I11, §4.3, §6, §7, §8), `docs/backend/03-api.md`(§0 에러, §2 방, §3 멤버십·초대), `docs/backend/analysis/main.md`(§3 파생값, §7), `docs/backend/analysis/roomview.md`(§2 상태 머신, §3 계산, §6 DTO), `docs/backend/analysis/mystudy.md` §2.3.1(필드 잠금 표). 공통 계약·전역 제약은 `2026-10-13-backend-00-overview.md`.

## Global Constraints

(00 개요 "Global Constraints" 전부 + 아래)

- 파일: `supabase/migrations/0004_rooms.sql`, `supabase/migrations/0005_membership.sql`, `supabase/seed.sql`(방·멤버·초대·알림설정 섹션 **추가**, 사용자 섹션은 플랜 01 소유), `supabase/tests/_cases-rooms.ts`, `supabase/tests/_cases-membership.ts`, `supabase/tests/rooms-sql.test.ts`, `supabase/tests/membership-sql.test.ts`, `supabase/tests/rooms-db.test.ts`. 다른 파일은 만들지도 고치지도 않는다.
- 모든 함수 `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`(읽기 전용 헬퍼는 `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''`), 테이블은 `public.` 한정, 인자는 `p_` 접두, JSON 키 camelCase, 숫자 id 는 `::text`, 날짜 `to_char(d,'YYYY-MM-DD')`, 시각은 `public.iso()`.
- 에러는 반드시 `public.fail(code, detail, hint)` 로. 코드는 `03-api.md` §0 목록에 있는 것만: `AUTH_REQUIRED, ONBOARDING_REQUIRED, VALIDATION_FAILED, INVALID_PERIOD, INVALID_TITLE, CAPACITY_BELOW_CURRENT, NOT_LEADER, NOT_MEMBER, OWNER_CANNOT_LEAVE, ROOM_NOT_FOUND, INVITE_NOT_FOUND, NOT_FOUND, ROOM_FULL, ROOM_NOT_RECRUITING, ROOM_NOT_EDITABLE, ROOM_STATUS_INVALID, ROOM_NO_LEAF_TASK, ALREADY_MEMBER, ALREADY_PENDING, ALREADY_DECIDED, JOIN_MODE_MISMATCH, OWNER_CANNOT_JOIN, FIELD_LOCKED, MEMBER_NOT_ACTIVE, TAG_LIMIT_EXCEEDED, INVITE_REVOKED`.
- "오늘"은 `public.kst_today()` 만. 테스트 기준일 `2026-10-12`.
- `rooms.status` 값은 대문자 `DRAFT|RECRUIT|ACTIVE|ENDED`, JSON 으로 나갈 때만 `lower()`. `room_members.status` 도 대문자, JSON 은 `lower()`.
- 멤버십 쓰기 함수는 끝에서 반드시 `public.assignment_resync(room_id)` 를 호출한다(I8).
- 이 플랜은 플랜 01 의 산출물(0001·0002·0003, `_harness.ts`, `_pglite-stubs.ts`, 시드 사용자)을 전제한다. 하네스 이름은 아래 "플랜 01 에서 가져오는 것" 에 고정.

## 플랜 01 에서 가져오는 것 (Consumes — 전 태스크 공통)

```sql
-- 0002_functions_core.sql
public.current_user_id() returns uuid                          -- 비로그인 null
public.require_user() returns uuid                             -- AUTH_REQUIRED / ONBOARDING_REQUIRED
public.kst_today() returns date
public.fail(p_code text, p_detail text, p_hint jsonb default null) returns void   -- RAISE … ERRCODE P0001
public.iso(p_ts timestamptz) returns text                      -- null 이면 null
public.task_code(p_s date, p_e date, p_first timestamptz, p_late boolean, p_today date) returns text
public.pct(p_asg int, p_sub int) returns int                    -- asg=0 → null
public.person_json(p_user uuid) returns jsonb                  -- {userId, nickname, tone}
public.slugify(p_title text, p_id bigint) returns text         -- 한글만이면 'r-' || base36(id)
```

```ts
// supabase/tests/_harness.ts (플랜 01 Task 2 — 실제 export. 이 이름 그대로 쓴다)
export type Q = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export async function openDb(): Promise<PGlite>;                       // 스텁 + supabase/migrations/*.sql 전부(번호순 자동 탐색)
export async function applySeed(db: PGlite): Promise<void>;            // supabase/seed.sql
export function withCase(db: PGlite, fn: (q: Q) => Promise<void>): () => Promise<void>;  // begin … rollback
export function sqlTest(name: string, fn: () => Promise<void>): void;  // Deno.test 등록
export async function asUser(q: Q, uid: string): Promise<void>;        // set_config('app.uid', uid, true)
export async function asAnon(q: Q): Promise<void>;                     // set_config('app.uid', '', true)  ← 비로그인은 이걸로(asUser(q, null) 금지)
export async function setToday(q: Q, ymd: string): Promise<void>;
// supabase/tests/_testenv.ts (플랜 01 Task 2 — 로컬 supabase)
export const hasEnv: boolean;  export const RUN: string;
export function service(): SupabaseClient;  export function anon(): SupabaseClient;
export async function userClient(n?: number): Promise<{ u: { id: string; email: string; password: string }; c: SupabaseClient }>;
export function dbTest(name: string, fn: () => Promise<void>): void;   // hasEnv 아니면 ignore
```

시드 사용자(플랜 01 Task 8): UUID `00000000-0000-4000-8000-0000000000NN`, NN 은 **플랜 01 seed_users 의 n** — 철수 01, 민수 02, 서연 03, 지훈 04, 현우 05, 수민 06, 예린 07, 태호 08, 가은 09, 민재 10, 보람 11, 도현 12, 하은 13, 시우 14, 지은 15, 소율 16, 지성 17, 은지 18, 하나 19, 다은 20, 태윤 21, 나연 22, 다인 23, 도윤 24, 아린 25, 유진 26, 준서 27, 현준 28, 승호 29. 이 플랜은 그 표를 `_cases-rooms.ts` 의 `USERS` 상수로 한 번 적는다(별도 `_seed-users.ts` 는 없다).

`openDb()` 는 `supabase/migrations/*.sql` 을 **번호순으로 자동 탐색**하므로 0004·0005 를 등록하는 배열은 없다 — 파일을 만들면 바로 부팅에 포함된다. 사례 파일(`_cases-*.ts`)은 편의상 `Q` 를 `Record<string, any>[]` 반환형으로 재선언한다(하네스 `Q` 와 상호 대입 가능).

## 이 플랜이 내놓는 것 (Produces — 플랜 03·04 가 의존)

```sql
-- 0004_rooms.sql
public.notify_publish(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb) returns int
   -- Phase 2 자리표: 항상 0. 0008 이 CREATE OR REPLACE 로 교체(시그니처 동일). p_dedupe_prefix 는 '<KIND>:<room_id>[:<extra>]' 형식, 0008 이 ':'||recipient 를 붙여 dedupe_key 로 쓴다.
public.room_lock(p_slug text) returns public.rooms            -- FOR UPDATE, 없으면 ROOM_NOT_FOUND
public.room_readable(p_room bigint, p_uid uuid, p_token text default null) returns boolean
public.room_leaf_stats(p_room bigint) returns table(node_id bigint, round_id bigint, parent_id bigint, title text, task_type text, start_date date, end_date date, sort_order int, asg int, sub int)
   -- 보관 아닌 리프 × (유효 배정 수, 그중 제출 수). 플랜 03 curriculum_get·me_studies 가 재사용
public.room_me_json(p_room bigint, p_uid uuid) returns jsonb   -- {state} | null
public.room_members_json(p_room bigint, p_uid uuid) returns jsonb
public.room_detail_json(p_room bigint, p_uid uuid) returns jsonb   -- RoomDetail(today 포함)
public.invite_ensure(p_room bigint, p_by uuid) returns text    -- 활성 토큰 반환, 없으면 생성
public.room_take_seat(p_room bigint) / room_release_seat(p_room bigint) returns void   -- 원자 증감, ROOM_FULL
public.room_transition_active(p_room bigint, p_actor uuid) returns void
public.room_transition_ended(p_room bigint) returns void
public.room_tick() returns jsonb                                -- {activated, ended}
public.room_round_stats(p_room bigint) returns table(round_id bigint, label text, title text, start_date date, end_date date, sort_order int, leaf_count int, asg int, sub int)
   -- 회차별 합산. 플랜 03 이 0006 에서 CREATE OR REPLACE 로 본문 교체 가능(시그니처 고정); room_progress(p_room) 는 이 위에
public.room_current_round_id(p_room bigint, p_today date) returns bigint
public.room_in_scope(p_room bigint, p_scope text, p_uid uuid) / room_matches(p_room bigint, p_status text, p_q text, p_tags text[]) returns boolean
public.rooms_list(p_scope text, p_status text, p_q text, p_tags text[], p_page int, p_size int, p_sort text) returns jsonb
public.room_get(p_slug text, p_invite_token text default null) returns jsonb
public.room_create(...), room_update(p_slug, p_patch jsonb), room_open_recruit, room_start, room_archive, room_unarchive, room_delete
-- 0005_membership.sql
public.assignment_resync(p_room bigint) returns void
public.membership_result(p_room bigint, p_user uuid) returns jsonb
public.invite_check(p_room bigint, p_token text) returns boolean   -- 활성 true / 회전됨 INVITE_REVOKED / 그 외 false
public.room_join(p_slug text, p_invite_token text default null), room_apply(p_slug text, p_invite_token text default null),
public.room_leave(p_slug), room_cancel_application(p_slug), room_approve(p_slug, p_user uuid), room_reject(p_slug, p_user uuid)  -- 전부 MembershipResult jsonb
public.room_applications(p_slug), room_members_get(p_slug)        -- {today, items}
public.invite_get(p_slug), invite_rotate(p_slug)                   -- {today, token, url}
public.invite_preview(p_token), invite_join(p_token)              -- InvitePreview / MembershipResult
-- 내부 전용(anon·authenticated 에 EXECUTE revoke): 위 헬퍼 전부 + room_join_precheck, room_decide_precheck, invite_resolve
```

시드 고정값(플랜 03·04·05 테스트가 참조): `rooms.id` = toeic 1, cs 2, sqld 3, docker 4, jcg 5, aws 6, react 7, algo 8, spring 9. 초대 토큰 = `'seed-' || slug`. 태그 slug 19개(Task 3 표)는 플랜 04 `0009_tags.sql` 과 동일해야 한다.

## Review Focus

스펙이 암시하지만 자연히 테스트되지 않을 입력 5가지. 각각 소유 태스크에 테스트를 박았다.

1. **정원 race** — 1/2 방에 두 세션이 동시에 `room_join` → 정확히 한 명 ACTIVE, 한 명 `ROOM_FULL`, `member_count = 2`. (Task 8, 로컬 supabase `rooms-db.test.ts`)
2. **거절·취소 뒤 재신청** — REJECTED/CANCELED 행이 있는 사용자가 다시 `room_apply` 하면 새 행이 아니라 **같은 행**이 PENDING 으로 돌아오고 `applied_at` 이 갱신된다(UNIQUE 위반 없음). (Task 5)
3. **보관된 방의 노출** — `rooms_list` 어느 scope 에도 안 나오고, `tabCounts` 에도 안 세고, `room_get` 은 그룹장·기존 멤버만 성공, 비멤버는 `ROOM_NOT_FOUND`. (Task 4, Task 7)
4. **`room_tick` 과 보관·DRAFT** — 보관된 RECRUIT 방(불가능한 조합이지만 데이터 손상 대비)과 start_date 지난 DRAFT 방은 tick 이 건드리지 않는다. (Task 2)
5. **초대 토큰 회전 뒤 옛 링크** — `invite_rotate` 뒤 옛 토큰으로 `invite_preview`/`room_get`/`invite_join` 하면 각각 `INVITE_REVOKED` / `ROOM_NOT_FOUND`(비공개) / `INVITE_REVOKED`. (Task 6, Task 7)

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/0004_rooms.sql` | notify 자리표, 방 헬퍼(lock/readable/leaf_stats/json 빌더/invite_ensure/seat), 방 쓰기 함수 7개, 상태 전환 2개, `room_tick`, `room_round_stats`/`room_current_round_id`/`room_in_scope`/`room_matches`, `rooms_list`, `room_get`, 내부 함수 revoke |
| `supabase/migrations/0005_membership.sql` | `assignment_resync`, `membership_result`, 멤버십 쓰기 6개 + 읽기 2개, 초대 4개 |
| `supabase/seed.sql` | (추가 §2) 태그 사전 19종(0009 와 같은 slug, `on conflict do nothing`)·방 9개·멤버·초대·알림설정·`assignment_resync` |
| `supabase/tests/_cases-rooms.ts` | 방 사례(생성·수정 잠금·상태 전환·tick·목록·상세) — PGlite/로컬 공용 |
| `supabase/tests/_cases-membership.ts` | 멤버십·초대 사례 |
| `supabase/tests/rooms-sql.test.ts`, `membership-sql.test.ts` | PGlite 러너 |
| `supabase/tests/rooms-db.test.ts` | 로컬 supabase: 정원 race·RLS 스모크·RPC 에러 전달(`SUPABASE_URL` 등 있을 때만) |

태스크 순서: 1(0004 골격·헬퍼·room_create·notify 자리표) → 2(상태 전환·tick·update 잠금·open_recruit·archive·delete) → 3(seed.sql §2 방·멤버·초대·태그 — 이후 사례가 시드 방을 참조) → 4(rooms_list) → 5(0005 멤버십 상태 머신) → 6(초대) → 7(room_get) → 8(로컬 supabase 동시성·RLS·에러 전달). Task 1 부터 0005 의 `assignment_resync` 를 호출하므로 Task 1 Step 3 에서 0005 파일을 `assignment_resync` 만 담은 상태로 먼저 만든다.

---

### Task 1: 0004 골격 — notify 자리표 · 방 헬퍼 · `room_create` · `assignment_resync`

**Files:**
- Create: `supabase/migrations/0004_rooms.sql` (이 태스크 분량. Task 2~4 가 같은 파일 끝에 이어 붙인다 — 배포 전까지는 한 파일을 계속 편집)
- Create: `supabase/migrations/0005_membership.sql` (`assignment_resync` 만)
- Create: `supabase/tests/_cases-rooms.ts`, `supabase/tests/rooms-sql.test.ts`

**Interfaces:**
- Consumes: 플랜 01 공통 계약 전부(위 표). 테이블 `rooms, room_members, room_invites, room_notification_settings, room_tags, tags, goal_nodes, task_assignments, submissions, profiles`.
- Produces: `notify_publish`(자리표), `room_lock`, `room_readable`, `room_leaf_stats`, `room_me_json`, `room_members_json`, `room_detail_json`, `invite_ensure`, `room_take_seat`, `room_release_seat`, `room_create`, `assignment_resync`. 테스트 쪽: `USERS`, `TODAY`, `expectFail`, `createRoom`, `seedLeaves`, `Case`, `ROOM_CASES`.

- [ ] **Step 1: 하네스 확인**

플랜 01 의 `openDb()` 는 `supabase/migrations/*.sql` 을 자동 탐색하므로 등록 작업이 없다. `supabase/tests/_harness.ts` 에 `openDb, applySeed, withCase, sqlTest, asUser, asAnon, setToday` 가 export 돼 있는지만 확인한다.

- [ ] **Step 2: 실패하는 테스트 — room_create 가 DRAFT 방 + 그룹장 행 + 초대 + 알림설정을 만든다**

`supabase/tests/_cases-rooms.ts`:

```ts
import { asAnon, asUser, setToday } from "./_harness.ts";
import { assertEquals, assertRejects } from "@std/assert";

/** 사례 파일 전용 느슨한 Q (하네스 Q 와 상호 대입 가능) */
export type Q = (sql: string, params?: unknown[]) => Promise<Record<string, any>[]>;

export const TODAY = "2026-10-12";

/** 플랜 01 seed_users 번호 → 고정 UUID */
const NAMES = ["철수","민수","서연","지훈","현우","수민","예린","태호","가은","민재","보람","도현","하은","시우","지은","소율","지성","은지","하나","다은","태윤","나연","다인","도윤","아린","유진","준서","현준","승호"] as const;
export const USERS = Object.fromEntries(
  NAMES.map((n, i) => [n, `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`]),
) as Record<(typeof NAMES)[number], string>;

/** P0001 에러를 code(message) 로 단언한다. fail() 은 MESSAGE=code, DETAIL=문구, HINT=json */
export async function expectFail(q: Q, sql: string, params: unknown[], code: string) {
  await assertRejects(
    () => q(sql, params),
    Error,
    code,
    `expected ${code}`,
  );
}

/** 시드와 무관한 새 방을 서연이 만든다(DRAFT). 반환: RoomDetail */
export async function createRoom(q: Q, leader: string, over: Partial<{
  title: string; intro: string; startDate: string; endDate: string; maxMembers: number; isPublic: boolean; joinMode: "direct" | "approval";
}> = {}) {
  await asUser(q, leader);
  const a = {
    title: "테스트 방 Test Room", intro: "소개", startDate: "2026-11-01", endDate: "2026-11-28",
    maxMembers: 4, isPublic: true, joinMode: "direct" as const, ...over,
  };
  const [row] = await q(
    `select public.room_create($1,$2,$3::date,$4::date,$5,$6,$7) as d`,
    [a.title, a.intro, a.startDate, a.endDate, a.maxMembers, a.isPublic, a.joinMode],
  );
  return row.d as Record<string, any>;
}

/** 회차 1개 + 리프 N개를 직접 INSERT 한다(Phase 3 node_create 전까지 테스트 전용). round_id 는 회차 자신. */
export async function seedLeaves(q: Q, roomId: string, leaves: { title: string; type: "COMMON" | "DESIGNATED"; s: string; e: string }[], round = { label: "1주차", title: "회차", s: "2026-11-01", e: "2026-11-07" }) {
  const [r] = await q(
    `insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
     values ($1, null, 2, 0, $2, $3, $4::date, $5::date) returning id`,
    [roomId, round.label, round.title, round.s, round.e],
  );
  await q(`update public.goal_nodes set round_id = id where id = $1`, [r.id]);
  const ids: string[] = [];
  for (const [i, l] of leaves.entries()) {
    const [n] = await q(
      `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
       values ($1, $2, $2, 3, $3, $4, $5::date, $6::date, $7) returning id`,
      [roomId, r.id, i, l.title, l.s, l.e, l.type],
    );
    ids.push(String(n.id));
  }
  await q(`select public.assignment_resync($1)`, [roomId]);
  return { roundId: String(r.id), leafIds: ids };
}

export type Case = { name: string; run: (q: Q) => Promise<void> };

export const ROOM_CASES: Case[] = [
  {
    name: "room_create: DRAFT 방 + 그룹장 ACTIVE 행 + member_count 1 + 초대 토큰 + 알림 설정",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연);
      assertEquals(d.status, "draft");
      assertEquals(d.memberCount, 1);
      assertEquals(d.me, { state: "leader" });
      assertEquals(d.leader.nickname, "서연");
      assertEquals(d.members.length, 1);
      assertEquals(d.members[0].role, "leader");
      assertEquals(typeof d.invite.url, "string");
      assertEquals(d.invite.url.startsWith("/invite/"), true);
      assertEquals(d.pendingCount, 0);
      assertEquals(d.today, TODAY);
      const [m] = await q(`select role, status from public.room_members where room_id = $1 and user_id = $2`, [d.id, USERS.서연]);
      assertEquals([m.role, m.status], ["LEADER", "ACTIVE"]);
      const [s] = await q(`select count(*)::int as n from public.room_notification_settings where room_id = $1`, [d.id]);
      assertEquals(s.n, 1);
      const [i] = await q(`select count(*)::int as n from public.room_invites where room_id = $1 and revoked_at is null`, [d.id]);
      assertEquals(i.n, 1);
    },
  },
  {
    name: "room_create: slug 는 slugify 결과이고 충돌 시 -2",
    run: async (q) => {
      await setToday(q, TODAY);
      // 라틴 문자 제목 → slugify 결과가 id 와 무관하므로 같은 제목 두 번이면 충돌한다
      const a = await createRoom(q, USERS.서연, { title: "Docker Basics" });
      const b = await createRoom(q, USERS.서연, { title: "Docker Basics" });
      const [{ base }] = await q(`select public.slugify($1, $2::bigint) as base`, ["Docker Basics", a.id]);
      assertEquals(a.slug, base);
      assertEquals(b.slug, `${base}-2`);
    },
  },
  {
    name: "room_create: 검증 실패 코드",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.서연);
      const call = `select public.room_create($1,$2,$3::date,$4::date,$5,$6,$7)`;
      await expectFail(q, call, ["   ", "소개", "2026-11-01", "2026-11-28", 4, true, "direct"], "INVALID_TITLE");
      await expectFail(q, call, ["제목", "소개", "2026-11-28", "2026-11-01", 4, true, "direct"], "INVALID_PERIOD");
      await expectFail(q, call, ["제목", "소개", "2026-10-11", "2026-11-01", 4, true, "direct"], "INVALID_PERIOD"); // 과거 시작일
      await expectFail(q, call, ["제목", "소개", "2026-11-01", "2026-11-28", 1, true, "direct"], "VALIDATION_FAILED");
      await expectFail(q, call, ["제목", "소개", "2026-11-01", "2026-11-28", 4, true, "open"], "VALIDATION_FAILED");
      await asAnon(q);
      await expectFail(q, call, ["제목", "소개", "2026-11-01", "2026-11-28", 4, true, "direct"], "AUTH_REQUIRED");
    },
  },
];
```

`supabase/tests/rooms-sql.test.ts`:

```ts
import { applySeed, openDb, sqlTest, withCase } from "./_harness.ts";
import { ROOM_CASES } from "./_cases-rooms.ts";

const db = await openDb();
await applySeed(db);

for (const c of ROOM_CASES) sqlTest(`rooms: ${c.name}`, withCase(db, c.run));
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "rooms:"`
Expected: FAIL — `function public.room_create(...) does not exist`

- [ ] **Step 4: `0005_membership.sql` 을 `assignment_resync` 만으로 먼저 생성**

`supabase/migrations/0005_membership.sql`:

```sql
-- 0005_membership.sql — 멤버십 상태 머신 · 초대 (플랜 02 Task 1·5)
-- 배포 후 수정 금지. Task 5 가 이 파일 끝에 함수를 이어 붙인다.

-- ───────── D4: 공통 과제 담당자 실체화 (멱등) ─────────
-- 1. 보관 아닌 COMMON 리프 × 담당 자격자(ACTIVE 멤버, 그룹장은 leader_does_tasks) → 없으면 INSERT, released 면 복구
-- 2. 유효 행인데 (리프가 COMMON 아님 | 리프 보관 | 사용자가 담당 자격 없음) → released_at = now()
--    DESIGNATED 행도 사용자가 ACTIVE 멤버가 아니면 released (CANCELED 참가자, INACTIVE 는 member_deactivate 가 먼저 결정)
-- 3. 행은 절대 삭제하지 않는다(제출물 보존)
create or replace function public.assignment_resync(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ldt boolean;
begin
  select leader_does_tasks into v_ldt from public.rooms where id = p_room;
  if not found then return; end if;

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

  -- 2a. COMMON 행인데 리프가 COMMON 이 아니거나 보관됨 → 해제
  update public.task_assignments a set released_at = now()
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = p_room and a.released_at is null and a.source = 'COMMON'
    and (n.task_type is distinct from 'COMMON' or n.archived_at is not null);

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

- [ ] **Step 5: `0004_rooms.sql` 골격 작성 (자리표 · 헬퍼 · room_create)**

`supabase/migrations/0004_rooms.sql`:

```sql
-- 0004_rooms.sql — 방 생성/수정/상태 전환 · 목록/상세 집계 (플랜 02 Task 1~4)
-- 배포 후 수정 금지.

-- ───────── 알림 자리표 (0008 이 같은 시그니처로 CREATE OR REPLACE) ─────────
-- p_dedupe_prefix: '<KIND>:<room_id>[:<extra>]'. 0008 은 prefix || ':' || recipient 를 dedupe_key 로 쓴다.
create or replace function public.notify_publish(
  p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb)
returns int language sql security definer set search_path = '' as $$
  select 0
$$;

-- ───────── 방 헬퍼 ─────────
-- 방 행을 FOR UPDATE 로 잠근다. 모든 쓰기 함수의 첫 줄. 없으면 ROOM_NOT_FOUND(비공개 방도 같은 코드 — D7)
create or replace function public.room_lock(p_slug text) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug for update;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  return r;
end $$;

-- 읽기 가능 여부: 그룹장 | 멤버(ACTIVE·INACTIVE·PENDING) | (보관 아님 ∧ DRAFT 아님 ∧ (공개 | 유효 초대 토큰))
create or replace function public.room_readable(p_room bigint, p_uid uuid, p_token text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r where r.id = p_room and (
         (p_uid is not null and r.leader_id = p_uid)
      or (p_uid is not null and exists (
            select 1 from public.room_members m
            where m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE','INACTIVE','PENDING')))
      or (r.archived_at is null and r.status <> 'DRAFT' and (
            r.visibility = 'PUBLIC'
         or (p_token is not null and exists (
               select 1 from public.room_invites i
               where i.room_id = r.id and i.token = p_token and i.revoked_at is null))))))
$$;

-- 보관 아닌 리프별 (유효 배정 수, 그중 제출 수). 회차·방 집계는 이걸 합산한다(02 §4.1)
create or replace function public.room_leaf_stats(p_room bigint)
returns table (node_id bigint, round_id bigint, parent_id bigint, title text, task_type text,
               start_date date, end_date date, sort_order int, asg int, sub int)
language sql stable security definer set search_path = '' as $$
  select n.id, n.round_id, n.parent_id, n.title::text, n.task_type::text, n.start_date, n.end_date, n.sort_order,
         count(a.id)::int, count(s.id)::int
  from public.goal_nodes n
  left join public.task_assignments a on a.node_id = n.id and a.released_at is null
  left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
  where n.room_id = p_room and n.task_type is not null and n.archived_at is null
  group by n.id
$$;

-- me.state: null(비로그인) | leader | active | pending | inactive | none(REJECTED·CANCELED·EXPIRED·행 없음)
create or replace function public.room_me_json(p_room bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when p_uid is null then null
    when exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = p_uid) then jsonb_build_object('state', 'leader')
    else jsonb_build_object('state', coalesce((
      select case m.status when 'ACTIVE' then 'active' when 'PENDING' then 'pending' when 'INACTIVE' then 'inactive' else 'none' end
      from public.room_members m where m.room_id = p_room and m.user_id = p_uid), 'none'))
  end
$$;

-- RoomDetail.members: ACTIVE 전원 + INACTIVE + 내 PENDING 행. 그룹장 먼저, 그다음 참가 확정 순
create or replace function public.room_members_json(p_room bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           public.person_json(m.user_id)
           || jsonb_build_object('role', lower(m.role), 'status', lower(m.status), 'joinedAt', public.iso(m.joined_at))
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  from public.room_members m
  where m.room_id = p_room
    and (m.status in ('ACTIVE', 'INACTIVE') or (m.status = 'PENDING' and m.user_id = p_uid))
$$;

-- 활성 초대 토큰을 돌려주고, 없으면 만든다(I10: 방당 활성 토큰 1개). 토큰 = uuid 의 32 hex
create or replace function public.invite_ensure(p_room bigint, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  select token into v_token from public.room_invites where room_id = p_room and revoked_at is null;
  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '');
    insert into public.room_invites (token, room_id, created_by) values (v_token, p_room, p_by);
  end if;
  return v_token;
end $$;

-- 정원 원자 증감 (D3). 자리 없으면 ROOM_FULL
create or replace function public.room_take_seat(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  update public.rooms set member_count = member_count + 1, updated_at = now()
  where id = p_room and member_count < max_members
  returning id into v_id;
  if v_id is null then perform public.fail('ROOM_FULL', '정원이 찼어요', '{"field":"maxMembers"}'::jsonb); end if;
end $$;

create or replace function public.room_release_seat(p_room bigint) returns void
language sql security definer set search_path = '' as $$
  update public.rooms set member_count = greatest(member_count - 1, 0), updated_at = now() where id = p_room
$$;

-- ───────── RoomDetail JSON (03-api §2) ─────────
create or replace function public.room_detail_json(p_room bigint, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r          public.rooms;
  v_today    date := public.kst_today();
  v_is_leader boolean;
  v_does_tasks boolean;        -- 내가 담당 자격(ACTIVE 멤버, 그룹장은 leader_does_tasks)
  v_tags     jsonb;
  v_members  jsonb;
  v_rounds   jsonb;
  v_stats    jsonb;
  v_current  jsonb := null;
  v_cur_id   bigint;
  v_my       jsonb := null;
  v_invite   jsonb := null;
  v_pending  int := 0;
begin
  select * into r from public.rooms where id = p_room;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;

  v_is_leader  := p_uid is not null and r.leader_id = p_uid;
  v_does_tasks := p_uid is not null and exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = p_uid and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks));
  v_members := public.room_members_json(p_room, p_uid);

  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label, 'tone', t.tone, 'auto', rt.source = 'AUTO')
                            order by rt.sort_order, t.slug), '[]'::jsonb)
  into v_tags
  from public.room_tags rt join public.tags t on t.slug = rt.tag_slug
  where rt.room_id = p_room;

  -- 회차(depth 2) 집계: 리프 asg/sub 를 round_id 로 합산
  with rnd as (
    select n.id, n.label, n.title, n.start_date, n.end_date, n.sort_order,
           count(l.node_id)::int as leaf_count, coalesce(sum(l.asg), 0)::int as asg, coalesce(sum(l.sub), 0)::int as sub
    from public.goal_nodes n
    left join public.room_leaf_stats(p_room) l on l.round_id = n.id
    where n.room_id = p_room and n.depth = 2 and n.archived_at is null
    group by n.id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id::text, 'label', label, 'title', title,
           'startDate', to_char(start_date, 'YYYY-MM-DD'), 'endDate', to_char(end_date, 'YYYY-MM-DD'),
           'leafCount', leaf_count, 'assigned', asg, 'submitted', sub, 'pct', public.pct(asg, sub))
           order by sort_order, id), '[]'::jsonb)
  into v_rounds from rnd;

  -- stats (roomview §3.7 glance 원재료)
  select jsonb_build_object(
    'roundCount', (select count(*) from public.goal_nodes n where n.room_id = p_room and n.depth = 2 and n.archived_at is null),
    'leafCount', count(*),
    'commonCount', count(*) filter (where l.task_type = 'COMMON'),
    'designatedCount', count(*) filter (where l.task_type = 'DESIGNATED'),
    'totalAssignments', coalesce(sum(l.asg), 0),
    'totalSubmissions', coalesce(sum(l.sub), 0),
    'overallPct', public.pct(coalesce(sum(l.asg), 0)::int, coalesce(sum(l.sub), 0)::int),
    'unassignedCount', count(*) filter (where l.asg = 0),
    'startWeekdays', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb) from (
        select distinct extract(isodow from n.start_date)::int as d
        from public.goal_nodes n where n.room_id = p_room and n.depth = 2 and n.archived_at is null) w))
  into v_stats
  from public.room_leaf_stats(p_room) l;

  -- 현재 회차: ACTIVE 일 때만. 오늘을 포함하는 회차 중 start 가 가장 늦은 것, 없으면 직전 회차 (roomview §3.3)
  if r.status = 'ACTIVE' then
    select n.id into v_cur_id
    from public.goal_nodes n
    where n.room_id = p_room and n.depth = 2 and n.archived_at is null and n.start_date <= v_today
    order by (n.end_date >= v_today) desc, n.start_date desc, n.sort_order desc
    limit 1;
  end if;
  if v_cur_id is not null then
    select (select e from jsonb_array_elements(v_rounds) e where e->>'id' = v_cur_id::text)
           || jsonb_build_object('tasks', coalesce((
                select jsonb_agg(jsonb_build_object(
                         'id', ls.node_id::text, 'title', ls.title, 'type', lower(ls.task_type),
                         'startDate', to_char(ls.start_date, 'YYYY-MM-DD'), 'endDate', to_char(ls.end_date, 'YYYY-MM-DD'),
                         'people', coalesce((
                           select jsonb_agg(public.person_json(a.user_id)
                                    || jsonb_build_object('status', public.task_code(ls.start_date, ls.end_date, s.first_submitted_at, s.is_late, v_today))
                                    order by a.assigned_at, a.id)
                           from public.task_assignments a
                           left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
                           where a.node_id = ls.node_id and a.released_at is null), '[]'::jsonb))
                       order by ls.start_date, ls.sort_order, ls.node_id)
                from public.room_leaf_stats(p_room) ls where ls.round_id = v_cur_id), '[]'::jsonb))
    into v_current;
  end if;

  -- 내 진척률: 담당 자격이 있으면 상태 무관(모집중 sqld 0/2 도 D4 실체화 덕에 같은 쿼리)
  if v_does_tasks then
    select jsonb_build_object(
      'submitted', count(*) filter (where s.id is not null),
      'assigned', count(*),
      'nextDue', (
        select jsonb_build_object('nodeId', l2.node_id::text, 'title', l2.title, 'roundLabel', rn.label,
                                  'dueDate', to_char(l2.end_date, 'YYYY-MM-DD'))
        from public.room_leaf_stats(p_room) l2
        join public.task_assignments a2 on a2.node_id = l2.node_id and a2.user_id = p_uid and a2.released_at is null
        join public.goal_nodes rn on rn.id = l2.round_id
        left join public.submissions s2 on s2.node_id = l2.node_id and s2.user_id = p_uid
        where s2.id is null and l2.end_date >= v_today
        order by l2.end_date, rn.sort_order, l2.sort_order, l2.node_id
        limit 1))
    into v_my
    from public.room_leaf_stats(p_room) l
    join public.task_assignments a on a.node_id = l.node_id and a.user_id = p_uid and a.released_at is null
    left join public.submissions s on s.node_id = l.node_id and s.user_id = p_uid;
  end if;

  if v_is_leader then
    v_invite := jsonb_build_object('url', '/invite/' || public.invite_ensure(p_room, p_uid));
    select count(*)::int into v_pending from public.room_members m where m.room_id = p_room and m.status = 'PENDING';
  end if;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'id', r.id::text, 'slug', r.slug, 'title', r.title, 'intro', r.intro,
    'descriptionMd', r.description_md, 'rulesMd', r.rules_md,
    'status', lower(r.status), 'archived', r.archived_at is not null,
    'isPublic', r.visibility = 'PUBLIC', 'joinMode', lower(r.join_mode),
    'startDate', to_char(r.start_date, 'YYYY-MM-DD'), 'endDate', to_char(r.end_date, 'YYYY-MM-DD'),
    'maxMembers', r.max_members, 'minMembers', r.min_members,
    'memberCount', r.member_count,
    'leader', public.person_json(r.leader_id), 'leaderDoesTasks', r.leader_does_tasks,
    'tags', v_tags, 'members', v_members, 'me', public.room_me_json(p_room, p_uid),
    'currentRound', v_current, 'rounds', v_rounds, 'stats', v_stats, 'myProgress', v_my,
    'invite', v_invite, 'pendingCount', v_pending);
end $$;

-- ───────── room_create (03-api §2 CreateRoom) ─────────
create or replace function public.room_create(
  p_title text, p_intro text, p_start_date date, p_end_date date, p_max_members int,
  p_is_public boolean, p_join_mode text,
  p_description_md text default '', p_rules_md text default '', p_min_members int default null,
  p_leader_does_tasks boolean default true, p_cover_file_id uuid default null, p_tag_slugs text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_today  date := public.kst_today();
  v_title  text := trim(coalesce(p_title, ''));
  v_intro  text := trim(coalesce(p_intro, ''));
  v_id     bigint;
  v_base   text;
  v_slug   text;
  v_n      int := 2;
begin
  if length(v_title) < 1 or length(v_title) > 60 then
    perform public.fail('INVALID_TITLE', '제목은 1~60자예요', '{"field":"title"}'::jsonb);
  end if;
  if length(v_intro) < 1 or length(v_intro) > 100 then
    perform public.fail('VALIDATION_FAILED', '한 줄 소개는 1~100자예요', '{"field":"intro"}'::jsonb);
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb);
  end if;
  if p_start_date < v_today then
    perform public.fail('INVALID_PERIOD', '시작일은 오늘 이후여야 해요', '{"field":"startDate"}'::jsonb);
  end if;
  if p_max_members is null or p_max_members < 2 or p_max_members > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  if p_min_members is not null and (p_min_members < 1 or p_min_members > p_max_members) then
    perform public.fail('VALIDATION_FAILED', '최소 인원은 1~정원 사이예요', '{"field":"minMembers"}'::jsonb);
  end if;
  if p_join_mode not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;
  if coalesce(cardinality(p_tag_slugs), 0) > 8 then
    perform public.fail('TAG_LIMIT_EXCEEDED', '태그는 8개까지예요', '{"field":"tagSlugs"}'::jsonb);
  end if;

  -- slug 는 id 가 필요하므로 임시값으로 넣고 바로 갱신
  insert into public.rooms (slug, title, intro, description_md, rules_md, start_date, end_date, max_members, min_members,
                            visibility, join_mode, leader_id, leader_does_tasks, cover_file_id, status, member_count)
  values ('tmp-' || replace(gen_random_uuid()::text, '-', ''), v_title, v_intro, coalesce(p_description_md, ''), coalesce(p_rules_md, ''),
          p_start_date, p_end_date, p_max_members, p_min_members,
          case when p_is_public then 'PUBLIC' else 'PRIVATE' end, upper(p_join_mode), v_uid, coalesce(p_leader_does_tasks, true),
          p_cover_file_id, 'DRAFT', 1)
  returning id into v_id;

  v_base := public.slugify(v_title, v_id);
  v_slug := v_base;
  while exists (select 1 from public.rooms where slug = v_slug) loop
    v_slug := v_base || '-' || v_n;
    v_n := v_n + 1;
  end loop;
  update public.rooms set slug = v_slug where id = v_id;

  insert into public.room_members (room_id, user_id, role, status, joined_at)
  values (v_id, v_uid, 'LEADER', 'ACTIVE', now());
  insert into public.room_notification_settings (room_id) values (v_id);
  perform public.invite_ensure(v_id, v_uid);

  insert into public.room_tags (room_id, tag_slug, source, sort_order)
  select v_id, t.slug, 'MANUAL', s.ord - 1
  from unnest(p_tag_slugs) with ordinality as s(slug, ord)
  join public.tags t on t.slug = s.slug;

  return public.room_detail_json(v_id, v_uid);
end $$;
```

- [ ] **Step 6: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "rooms:"`
Expected: PASS 3 사례. (`INVALID_PERIOD` 두 번째 단언은 "과거 시작일" 분기 — 통과 못 하면 `p_start_date < v_today` 검사 순서를 확인.)

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0004_rooms.sql supabase/migrations/0005_membership.sql supabase/tests/_cases-rooms.ts supabase/tests/rooms-sql.test.ts
git commit -m "feat(db): rooms helpers, room_create, assignment_resync, notify_publish placeholder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 2: 방 상태 전환 · `room_tick` · `room_update` 필드 잠금

**Files:**
- Modify: `supabase/migrations/0004_rooms.sql` (끝에 추가)
- Modify: `supabase/tests/_cases-rooms.ts` (사례 추가)

**Interfaces:**
- Consumes: Task 1 의 `room_lock`, `room_detail_json`, `room_leaf_stats`, `notify_publish`, `assignment_resync`.
- Produces: `room_transition_active(p_room bigint, p_actor uuid)`, `room_transition_ended(p_room bigint)`, `room_tick() returns jsonb {activated:int, ended:int}`, `room_open_recruit(p_slug)`, `room_start(p_slug)`, `room_archive(p_slug)`, `room_unarchive(p_slug)`, `room_delete(p_slug) returns void`, `room_update(p_slug text, p_patch jsonb)`. 플랜 04 의 `job_*` 는 `room_transition_*` 를 호출하지 않는다(tick 이 유일한 호출자). 플랜 03 `node_*` 는 `room_lock` + 편집 가능 상태 검사(DRAFT·RECRUIT·ACTIVE, 보관 아님)를 같은 방식으로 한다.

- [ ] **Step 1: 실패하는 테스트 — 상태 전환·tick·잠금**

`supabase/tests/_cases-rooms.ts` 의 `ROOM_CASES` 배열에 추가:

```ts
  {
    name: "room_open_recruit: 리프 없으면 ROOM_NO_LEAF_TASK, 있으면 RECRUIT",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연);
      await expectFail(q, `select public.room_open_recruit($1)`, [d.slug], "ROOM_NO_LEAF_TASK");
      await seedLeaves(q, d.id, [{ title: "과제 1", type: "COMMON", s: "2026-11-01", e: "2026-11-07" }]);
      const [{ r }] = await q(`select public.room_open_recruit($1) as r`, [d.slug]);
      assertEquals(r.status, "recruit");
      // 그룹장은 leader_does_tasks 기본 true → 공통 리프 1건 배정됨
      assertEquals(r.myProgress, { submitted: 0, assigned: 1, nextDue: { nodeId: r.rounds[0] && (await q(`select id::text as id from public.goal_nodes where room_id = $1 and task_type is not null`, [d.id]))[0].id, title: "과제 1", roundLabel: "1주차", dueDate: "2026-11-07" } });
      // 두 번 열면 ROOM_STATUS_INVALID, 다른 사람은 NOT_LEADER
      await expectFail(q, `select public.room_open_recruit($1)`, [d.slug], "ROOM_STATUS_INVALID");
      await asUser(q, USERS.민수);
      await expectFail(q, `select public.room_open_recruit($1)`, [d.slug], "NOT_LEADER");
    },
  },
  {
    name: "room_start: RECRUIT → ACTIVE, start_date=today, PENDING→EXPIRED, 담당자 없는 지정 과제는 warnings",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연, { joinMode: "approval" });
      await seedLeaves(q, d.id, [
        { title: "공통", type: "COMMON", s: "2026-11-01", e: "2026-11-07" },
        { title: "지정", type: "DESIGNATED", s: "2026-11-01", e: "2026-11-07" },
      ]);
      await q(`select public.room_open_recruit($1)`, [d.slug]);
      await asUser(q, USERS.민수);
      await q(`select public.room_apply($1)`, [d.slug]);
      await asUser(q, USERS.서연);
      const [{ r }] = await q(`select public.room_start($1) as r`, [d.slug]);
      assertEquals(r.status, "active");
      assertEquals(r.startDate, TODAY);
      assertEquals(r.warnings.length, 1);
      assertEquals(r.warnings[0].code, "UNASSIGNED_TASK");
      const [m] = await q(`select status from public.room_members where room_id = $1 and user_id = $2`, [d.id, USERS.민수]);
      assertEquals(m.status, "EXPIRED");
      const [row] = await q(`select started_at is not null as s from public.rooms where id = $1`, [d.id]);
      assertEquals(row.s, true);
      await expectFail(q, `select public.room_start($1)`, [d.slug], "ROOM_STATUS_INVALID");
    },
  },
  {
    name: "room_tick: start_date 지난 RECRUIT 전부 ACTIVE(이틀 누락 포함), PENDING→EXPIRED, 재실행은 0건, DRAFT·보관은 무시",
    run: async (q) => {
      await setToday(q, TODAY);
      const a = await createRoom(q, USERS.서연, { title: "Tick A", startDate: "2026-10-13", endDate: "2026-10-20", joinMode: "approval" });
      const b = await createRoom(q, USERS.서연, { title: "Tick B", startDate: "2026-10-14", endDate: "2026-10-20" });
      const c = await createRoom(q, USERS.서연, { title: "Tick C draft", startDate: "2026-10-13", endDate: "2026-10-20" });
      for (const d of [a, b]) {
        await asUser(q, USERS.서연);
        await seedLeaves(q, d.id, [{ title: "t", type: "COMMON", s: "2026-10-13", e: "2026-10-20" }]);
        await q(`select public.room_open_recruit($1)`, [d.slug]);
      }
      await seedLeaves(q, c.id, [{ title: "t", type: "COMMON", s: "2026-10-13", e: "2026-10-20" }]); // c 는 DRAFT 그대로
      await asUser(q, USERS.민수);
      await q(`select public.room_apply($1)`, [a.slug]);
      // 보관된 RECRUIT(손상 데이터) — tick 이 건드리지 않아야 한다
      await q(`update public.rooms set archived_at = now() where id = $1`, [b.id]);
      const [{ r: before }] = await q(`select public.room_tick() as r`);
      assertEquals(before, { activated: 0, ended: 0 });           // 10/12: 아직 시작일 전
      await setToday(q, "2026-10-15");                              // 이틀 건너뜀
      const [{ r: t1 }] = await q(`select public.room_tick() as r`);
      assertEquals(t1, { activated: 1, ended: 0 });                 // a 만 (b 보관, c DRAFT)
      const rows = await q(`select slug, status from public.rooms where id = any($1::bigint[]) order by id`, [[a.id, b.id, c.id]]);
      assertEquals(rows.map((x) => x.status), ["ACTIVE", "RECRUIT", "DRAFT"]);
      const [m] = await q(`select status from public.room_members where room_id = $1 and user_id = $2`, [a.id, USERS.민수]);
      assertEquals(m.status, "EXPIRED");
      const [{ r: t2 }] = await q(`select public.room_tick() as r`);
      assertEquals(t2, { activated: 0, ended: 0 });                 // 멱등
      await setToday(q, "2026-10-21");                              // end_date 다음날
      const [{ r: t3 }] = await q(`select public.room_tick() as r`);
      assertEquals(t3, { activated: 0, ended: 1 });
      const [e] = await q(`select status, ended_at is not null as x from public.rooms where id = $1`, [a.id]);
      assertEquals([e.status, e.x], ["ENDED", true]);
    },
  },
  {
    name: "room_update: 상태별 필드 잠금 (DRAFT/RECRUIT 전부 가능, ACTIVE 는 startDate 등 FIELD_LOCKED, ENDED 전부 잠금)",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연, { startDate: "2026-10-13", endDate: "2026-10-31" });
      const upd = `select public.room_update($1, $2::jsonb) as r`;
      // RECRUIT 단계(DRAFT 동일): startDate 변경 가능(≥ today), 과거는 INVALID_PERIOD
      let [{ r }] = await q(upd, [d.slug, JSON.stringify({ startDate: "2026-10-14", minMembers: 2, isPublic: false, joinMode: "approval", leaderDoesTasks: false })]);
      assertEquals([r.startDate, r.minMembers, r.isPublic, r.joinMode, r.leaderDoesTasks], ["2026-10-14", 2, false, "approval", false]);
      await expectFail(q, upd, [d.slug, JSON.stringify({ startDate: "2026-10-11" })], "INVALID_PERIOD");
      await expectFail(q, upd, [d.slug, JSON.stringify({ endDate: "2026-10-13" })], "INVALID_PERIOD");   // end < start
      await expectFail(q, upd, [d.slug, JSON.stringify({ maxMembers: 1 })], "VALIDATION_FAILED");
      await expectFail(q, upd, [d.slug, JSON.stringify({ slug: "x" })], "FIELD_LOCKED");               // I11
      await expectFail(q, upd, [d.slug, JSON.stringify({ title: "" })], "INVALID_TITLE");
      // 정원 축소 < member_count → CAPACITY_BELOW_CURRENT (리프 만들고 모집 열어 민수 참가 후 2명)
      await seedLeaves(q, d.id, [{ title: "t", type: "COMMON", s: "2026-10-14", e: "2026-10-20" }]);
      await q(`select public.room_update($1, $2::jsonb)`, [d.slug, JSON.stringify({ joinMode: "direct", isPublic: true })]);
      await q(`select public.room_open_recruit($1)`, [d.slug]);
      await asUser(q, USERS.민수);
      await q(`select public.room_join($1)`, [d.slug]);
      await asUser(q, USERS.서연);
      await q(upd, [d.slug, JSON.stringify({ maxMembers: 2 })]);
      await expectFail(q, upd, [d.slug, JSON.stringify({ maxMembers: 1 })], "VALIDATION_FAILED");      // 범위(2~100) 먼저
      await q(upd, [d.slug, JSON.stringify({ maxMembers: 3 })]);
      await asUser(q, USERS.현우);
      await q(`select public.room_join($1)`, [d.slug]);                                                 // 3/3
      await asUser(q, USERS.서연);
      await expectFail(q, upd, [d.slug, JSON.stringify({ maxMembers: 2 })], "CAPACITY_BELOW_CURRENT");
      // ACTIVE 단계
      await q(`select public.room_start($1)`, [d.slug]);
      for (const k of ["startDate", "minMembers", "isPublic", "joinMode", "leaderDoesTasks"]) {
        await expectFail(q, upd, [d.slug, JSON.stringify({ [k]: k === "startDate" ? "2026-10-20" : k === "minMembers" ? 1 : k === "joinMode" ? "direct" : true })], "FIELD_LOCKED");
      }
      [{ r }] = await q(upd, [d.slug, JSON.stringify({ title: "바뀐 제목", endDate: "2026-11-15", maxMembers: 5 })]);
      assertEquals([r.title, r.endDate, r.maxMembers], ["바뀐 제목", "2026-11-15", 5]);
      await expectFail(q, upd, [d.slug, JSON.stringify({ endDate: "2026-10-19" })], "INVALID_PERIOD");  // 노드 e(10/20) 보다 앞
      await expectFail(q, upd, [d.slug, JSON.stringify({ endDate: "2026-10-11" })], "INVALID_PERIOD");  // today 보다 앞
      // ENDED 단계: 전부 잠금
      await setToday(q, "2026-11-16");
      await q(`select public.room_tick()`);
      await expectFail(q, upd, [d.slug, JSON.stringify({ title: "x" })], "FIELD_LOCKED");
      // 보관: ROOM_NOT_EDITABLE
      await q(`select public.room_archive($1)`, [d.slug]);
      await expectFail(q, upd, [d.slug, JSON.stringify({ title: "x" })], "ROOM_NOT_EDITABLE");
      await expectFail(q, `select public.room_update($1, $2::jsonb)`, ["no-such-room", "{}"], "ROOM_NOT_FOUND");
    },
  },
  {
    name: "room_update: leaderDoesTasks 변경은 배정을 재동기화하고 기간 밖 노드는 warnings",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연, { startDate: "2026-11-01", endDate: "2026-11-30" });
      const { leafIds } = await seedLeaves(q, d.id, [{ title: "t", type: "COMMON", s: "2026-11-01", e: "2026-11-07" }]);
      const cnt = async () => (await q(`select count(*)::int as n from public.task_assignments where node_id = $1 and released_at is null`, [leafIds[0]]))[0].n;
      assertEquals(await cnt(), 1);
      await q(`select public.room_update($1, $2::jsonb)`, [d.slug, JSON.stringify({ leaderDoesTasks: false })]);
      assertEquals(await cnt(), 0);
      await q(`select public.room_update($1, $2::jsonb)`, [d.slug, JSON.stringify({ leaderDoesTasks: true })]);
      assertEquals(await cnt(), 1);
      const [{ r }] = await q(`select public.room_update($1, $2::jsonb) as r`, [d.slug, JSON.stringify({ startDate: "2026-11-03" })]);
      assertEquals(r.warnings, [{ code: "PERIOD_OUTSIDE_ROOM", nodeId: leafIds[0] }, { code: "PERIOD_OUTSIDE_ROOM", nodeId: r.rounds[0].id }].sort((x, y) => Number(x.nodeId) - Number(y.nodeId)));
    },
  },
  {
    name: "room_archive/unarchive/delete: 상태 제약",
    run: async (q) => {
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연);
      await expectFail(q, `select public.room_archive($1)`, [d.slug], "ROOM_STATUS_INVALID");   // DRAFT 는 보관 불가
      await expectFail(q, `select public.room_unarchive($1)`, [d.slug], "ROOM_STATUS_INVALID"); // 보관 아님
      await asUser(q, USERS.민수);
      await expectFail(q, `select public.room_delete($1)`, [d.slug], "NOT_LEADER");
      await asUser(q, USERS.서연);
      await q(`select public.room_delete($1)`, [d.slug]);
      const [{ n }] = await q(`select count(*)::int as n from public.rooms where id = $1`, [d.id]);
      assertEquals(n, 0);
      // ACTIVE 방은 삭제 불가, 보관 가능, 해제 시 상태 복귀
      await expectFail(q, `select public.room_delete($1)`, ["aws"], "NOT_LEADER");
      await asUser(q, USERS.민수);
      await expectFail(q, `select public.room_delete($1)`, ["aws"], "ROOM_STATUS_INVALID");
      const [{ r }] = await q(`select public.room_archive($1) as r`, ["aws"]);
      assertEquals([r.archived, r.status], [true, "active"]);
      const [{ r: r2 }] = await q(`select public.room_unarchive($1) as r`, ["aws"]);
      assertEquals([r2.archived, r2.status], [false, "active"]);
    },
  },
```

> 첫 사례의 `nextDue.nodeId` 단언이 길다. 아래처럼 바꿔 쓰는 편이 읽기 좋다 — 둘 중 하나만 남긴다:
> ```ts
> const [{ id: leafId }] = await q(`select id::text as id from public.goal_nodes where room_id = $1 and task_type is not null`, [d.id]);
> assertEquals(r.myProgress, { submitted: 0, assigned: 1, nextDue: { nodeId: leafId, title: "과제 1", roundLabel: "1주차", dueDate: "2026-11-07" } });
> ```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "rooms:"`
Expected: 새 사례 6개 FAIL — `function public.room_open_recruit(text) does not exist` 등.

- [ ] **Step 3: 0004 에 상태 전환·tick·update 추가**

`supabase/migrations/0004_rooms.sql` 끝에 추가:

```sql
-- ───────── 상태 전환 (D2) ─────────
-- RECRUIT → ACTIVE. 조건부 UPDATE 라 두 번 불러도 두 번째는 아무 일도 하지 않는다. tick 과 room_start 가 공유.
create or replace function public.room_transition_active(p_room bigint, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_expired uuid[];
  v_members uuid[];
begin
  update public.rooms set status = 'ACTIVE', started_at = now(), updated_at = now()
  where id = p_room and status = 'RECRUIT';
  if not found then return; end if;

  with x as (
    update public.room_members set status = 'EXPIRED', decided_at = now(), updated_at = now()
    where room_id = p_room and status = 'PENDING'
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_expired from x;

  perform public.assignment_resync(p_room);

  select coalesce(array_agg(user_id), '{}') into v_members
  from public.room_members where room_id = p_room and status = 'ACTIVE';

  if cardinality(v_expired) > 0 then
    perform public.notify_publish('JOIN_EXPIRED', p_room, null, p_actor, v_expired, 'JOIN_EXPIRED:' || p_room, '{}'::jsonb);
  end if;
  perform public.notify_publish('ROOM_STARTED', p_room, null, p_actor, v_members, 'ROOM_STARTED:' || p_room, '{}'::jsonb);
end $$;

-- ACTIVE → ENDED (end_date 다음날 00:00 KST 이후 tick 이 호출)
create or replace function public.room_transition_ended(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_members uuid[];
begin
  update public.rooms set status = 'ENDED', ended_at = now(), updated_at = now()
  where id = p_room and status = 'ACTIVE';
  if not found then return; end if;
  select coalesce(array_agg(user_id), '{}') into v_members
  from public.room_members where room_id = p_room and status = 'ACTIVE';
  perform public.notify_publish('ROOM_ENDED', p_room, null, null, v_members, 'ROOM_ENDED:' || p_room, '{}'::jsonb);
end $$;

-- pg_cron 5분마다(0010, 플랜 04). 보관 방·DRAFT 는 건드리지 않는다. 결과 {activated, ended}
create or replace function public.room_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.kst_today();
  v_id    bigint;
  v_act   int := 0;
  v_end   int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('room_tick'));
  for v_id in
    select id from public.rooms where status = 'RECRUIT' and archived_at is null and start_date <= v_today order by id
  loop
    perform public.room_transition_active(v_id, null);
    v_act := v_act + 1;
  end loop;
  for v_id in
    select id from public.rooms where status = 'ACTIVE' and end_date < v_today order by id
  loop
    perform public.room_transition_ended(v_id);
    v_end := v_end + 1;
  end loop;
  return jsonb_build_object('activated', v_act, 'ended', v_end);
end $$;

-- ───────── 그룹장 상태 액션 ─────────
create or replace function public.room_open_recruit(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.status <> 'DRAFT' then perform public.fail('ROOM_STATUS_INVALID', '준비중인 방만 모집을 시작할 수 있어요'); end if;
  if not exists (select 1 from public.goal_nodes n where n.room_id = r.id and n.task_type is not null and n.archived_at is null) then
    perform public.fail('ROOM_NO_LEAF_TASK', '말단 과제가 1개 이상 있어야 모집을 시작할 수 있어요');
  end if;
  update public.rooms set status = 'RECRUIT', updated_at = now() where id = r.id;
  perform public.assignment_resync(r.id);
  return public.room_detail_json(r.id, v_uid);
end $$;

-- "지금 시작": start_date = today 로 당기고 ACTIVE 전환. 담당자 없는 지정 과제는 warnings(차단 안 함)
create or replace function public.room_start(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  v_warn  jsonb;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.status <> 'RECRUIT' then perform public.fail('ROOM_STATUS_INVALID', '모집중인 방만 시작할 수 있어요'); end if;
  if v_today > r.end_date then perform public.fail('INVALID_PERIOD', '종료일이 이미 지났어요', '{"field":"endDate"}'::jsonb); end if;
  update public.rooms set start_date = v_today, updated_at = now() where id = r.id;
  perform public.room_transition_active(r.id, v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('code', 'UNASSIGNED_TASK', 'nodeId', ls.node_id::text) order by ls.node_id), '[]'::jsonb)
  into v_warn
  from public.room_leaf_stats(r.id) ls where ls.task_type = 'DESIGNATED' and ls.asg = 0;
  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn);
end $$;

create or replace function public.room_archive(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.status not in ('ACTIVE', 'ENDED') or r.archived_at is not null then
    perform public.fail('ROOM_STATUS_INVALID', '진행중이거나 종료된 방만 보관할 수 있어요');
  end if;
  update public.rooms set archived_at = now(), updated_at = now() where id = r.id;
  return public.room_detail_json(r.id, v_uid);
end $$;

create or replace function public.room_unarchive(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.archived_at is null then perform public.fail('ROOM_STATUS_INVALID', '보관된 방이 아니에요'); end if;
  update public.rooms set archived_at = null, updated_at = now() where id = r.id;
  return public.room_detail_json(r.id, v_uid);
end $$;

-- DRAFT·RECRUIT 만 하드 삭제(FK cascade). ACTIVE 이후는 room_archive
create or replace function public.room_delete(p_slug text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.status not in ('DRAFT', 'RECRUIT') then perform public.fail('ROOM_STATUS_INVALID', '진행중이거나 종료된 방은 삭제할 수 없어요. 보관해 주세요'); end if;
  delete from public.rooms where id = r.id;
end $$;

-- ───────── room_update: 상태별 필드 잠금 (mystudy §2.3.1, D11) ─────────
-- p_patch 는 UpdateRoom 부분 객체(camelCase). 받은 키만 바꾼다. 'slug' 는 항상 FIELD_LOCKED(I11)
create or replace function public.room_update(p_slug text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_today  date := public.kst_today();
  r        public.rooms;
  v_phase  text;                 -- recruit(DRAFT·RECRUIT) | active | ended
  v_locked text[];
  k        text;
  v_title  text;
  v_intro  text;
  v_start  date;
  v_end    date;
  v_max    int;
  v_min    int;
  v_ldt    boolean;
  v_node_max_end date;
  v_warn   jsonb := '[]'::jsonb;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.archived_at is not null then perform public.fail('ROOM_NOT_EDITABLE', '보관된 방은 수정할 수 없어요'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요');
  end if;

  v_phase := case when r.status in ('DRAFT', 'RECRUIT') then 'recruit' when r.status = 'ACTIVE' then 'active' else 'ended' end;
  v_locked := case v_phase
    when 'recruit' then array['slug']
    when 'active'  then array['slug', 'startDate', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks']
    else array['slug', 'title', 'intro', 'descriptionMd', 'rulesMd', 'coverFileId', 'startDate', 'endDate',
               'maxMembers', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks'] end;

  for k in select jsonb_object_keys(p_patch) loop
    if k = any(v_locked) then
      perform public.fail('FIELD_LOCKED', '지금 상태에서는 바꿀 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
    if k not in ('title', 'intro', 'descriptionMd', 'rulesMd', 'coverFileId', 'startDate', 'endDate',
                 'maxMembers', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;

  v_title := case when p_patch ? 'title' then trim(p_patch->>'title') else r.title end;
  v_intro := case when p_patch ? 'intro' then trim(p_patch->>'intro') else r.intro end;
  v_start := coalesce((p_patch->>'startDate')::date, r.start_date);
  v_end   := coalesce((p_patch->>'endDate')::date, r.end_date);
  v_max   := coalesce((p_patch->>'maxMembers')::int, r.max_members);
  v_min   := case when p_patch ? 'minMembers' then (p_patch->>'minMembers')::int else r.min_members end;
  v_ldt   := coalesce((p_patch->>'leaderDoesTasks')::boolean, r.leader_does_tasks);

  if length(v_title) < 1 or length(v_title) > 60 then
    perform public.fail('INVALID_TITLE', '제목은 1~60자예요', '{"field":"title"}'::jsonb);
  end if;
  if length(v_intro) < 1 or length(v_intro) > 100 then
    perform public.fail('VALIDATION_FAILED', '한 줄 소개는 1~100자예요', '{"field":"intro"}'::jsonb);
  end if;
  if p_patch ? 'startDate' and v_start < v_today then
    perform public.fail('INVALID_PERIOD', '시작일은 오늘 이후여야 해요', '{"field":"startDate"}'::jsonb);
  end if;
  if v_start > v_end then
    perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb);
  end if;
  if v_phase = 'active' and p_patch ? 'endDate' then
    select max(n.end_date) into v_node_max_end from public.goal_nodes n where n.room_id = r.id and n.archived_at is null;
    if v_end < v_today or (v_node_max_end is not null and v_end < v_node_max_end) then
      perform public.fail('INVALID_PERIOD', '진행중에는 종료일을 오늘과 마지막 과제 마감 이후로만 바꿀 수 있어요', '{"field":"endDate"}'::jsonb);
    end if;
  end if;
  if v_max < 2 or v_max > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  if v_max < r.member_count then
    perform public.fail('CAPACITY_BELOW_CURRENT', '현재 참가자 수보다 적게 줄일 수 없어요', jsonb_build_object('field', 'maxMembers', 'memberCount', r.member_count));
  end if;
  if v_min is not null and (v_min < 1 or v_min > v_max) then
    perform public.fail('VALIDATION_FAILED', '최소 인원은 1~정원 사이예요', '{"field":"minMembers"}'::jsonb);
  end if;
  if p_patch ? 'joinMode' and (p_patch->>'joinMode') not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;

  update public.rooms set
    title = v_title, intro = v_intro,
    description_md = coalesce(p_patch->>'descriptionMd', description_md),
    rules_md       = coalesce(p_patch->>'rulesMd', rules_md),
    cover_file_id  = case when p_patch ? 'coverFileId' then (p_patch->>'coverFileId')::uuid else cover_file_id end,
    start_date = v_start, end_date = v_end, max_members = v_max, min_members = v_min,
    visibility = case when p_patch ? 'isPublic' then (case when (p_patch->>'isPublic')::boolean then 'PUBLIC' else 'PRIVATE' end) else visibility end,
    join_mode  = case when p_patch ? 'joinMode' then upper(p_patch->>'joinMode') else join_mode end,
    leader_does_tasks = v_ldt, updated_at = now()
  where id = r.id;

  if v_ldt <> r.leader_does_tasks then perform public.assignment_resync(r.id); end if;

  -- 방 기간 밖으로 나간 노드(보관 제외)는 경고 (D9)
  if p_patch ? 'startDate' or p_patch ? 'endDate' then
    select coalesce(jsonb_agg(jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', n.id::text) order by n.id), '[]'::jsonb)
    into v_warn
    from public.goal_nodes n
    where n.room_id = r.id and n.archived_at is null and (n.start_date < v_start or n.end_date > v_end);
  end if;

  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn);
end $$;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "rooms:"`
Expected: PASS 9 사례. `room_start` 사례는 Task 5 의 `room_apply` 가 아직 없어 FAIL 한다 → 이 한 사례만 Task 5 Step 4 이후 통과(여기서는 "`function public.room_apply(text) does not exist`" 로 실패하는 것을 확인하고 넘어간다). `room_update` 잠금 사례도 `room_join` 을 쓰므로 동일.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_rooms.sql supabase/tests/_cases-rooms.ts
git commit -m "feat(db): room status transitions, room_tick, room_update field locks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 3: `seed.sql` §2 — 태그 사전 · 방 9개 · 멤버 · 초대 · 알림 설정

**Files:**
- Modify: `supabase/seed.sql` (플랜 01 §1 사용자 아래에 §2 를 **추가**. §1 은 건드리지 않는다)
- Modify: `supabase/tests/_cases-rooms.ts` (시드 검증 사례 추가)

**Interfaces:**
- Consumes: 플랜 01 §1 의 `public.profiles`(nickname 으로 사람을 찾는다), Task 1 의 `assignment_resync`.
- Produces (플랜 03·04·05 테스트가 참조하는 고정값):
  - `rooms.id` = toeic 1, cs 2, sqld 3, docker 4, jcg 5, aws 6, react 7, algo 8, spring 9. `overriding system value` 로 박고 시퀀스를 9 뒤로 옮긴다.
  - 상태·기간·정원·공개·참가 방식은 `src/data/rooms.ts` 값. docker `member_count = 1`(D3), spring 만 `PRIVATE`.
  - `room_members`: aws 민수 LEADER·지은·철수·하나 ACTIVE, 도윤 INACTIVE / sqld 가은 LEADER, 철수 PENDING / docker 철수 LEADER / toeic 서연·도현 / cs 예린·승호·나연 / jcg 수민·태윤·하은·준서 / react 태호·은지·시우·다인·현준 / algo 현우·철수·보람·지성·다은·유진 / spring 지훈·철수·민재·소율·아린.
  - 초대 토큰 = `'seed-' || slug`(9개, 전부 활성). `room_notification_settings` 9행(기본값).
  - `tags` 19종 — **slug 를 플랜 04 의 `0009_tags.sql` 이 그대로 써야 한다**(둘 다 `on conflict (slug) do nothing`): `aws AWS mint`, `cloud 클라우드 blue`, `certificate 자격증 peach`, `english 영어 blue`, `toeic 토익 peach`, `spring Spring mint`, `backend 백엔드 slate`, `java Java amber`, `algorithm 알고리즘 slate`, `coding-test 코딩테스트 mint`, `info-processing 정보처리기사 amber`, `cs CS amber`, `interview 면접 lav`, `react React blue`, `frontend 프론트엔드 mint`, `docker Docker blue`, `kubernetes Kubernetes lav`, `sql SQL amber`, `data 데이터 blue`.
  - `room_tags`(순서 = 카드 노출 순서, `src/data/room-view.ts` 의 `auto` 플래그): toeic 영어A·토익A / cs CS·면접M / sqld SQL·데이터·자격증M / docker Docker·Kubernetes·클라우드M / jcg 자격증·정보처리기사M / aws AWS·클라우드·자격증M / react React·프론트엔드 / algo 알고리즘·코딩테스트 / spring Spring·백엔드·Java (표시 없으면 AUTO).
  - 시드 전체가 멱등(두 번 적용해도 행 수 동일 — 플랜 01 "seed: is idempotent" 사례가 이 섹션까지 두 번 돌린다).

- [ ] **Step 1: 실패하는 테스트 — 시드 방·멤버·태그 숫자**

`supabase/tests/_cases-rooms.ts` 의 `ROOM_CASES` 에 추가:

```ts
  {
    name: "seed: 9 rooms with fixed ids, mock capacity/status, 19 tags, invites, settings",
    run: async (q) => {
      const rows = await q(`select id::text as id, slug, status, visibility, join_mode, member_count, max_members, min_members,
                                   to_char(start_date,'YYYY-MM-DD') as s, to_char(end_date,'YYYY-MM-DD') as e
                            from public.rooms where id <= 9 order by id`);
      assertEquals(rows.map((r) => [r.id, r.slug]), [
        ["1","toeic"],["2","cs"],["3","sqld"],["4","docker"],["5","jcg"],["6","aws"],["7","react"],["8","algo"],["9","spring"]]);
      const by = Object.fromEntries(rows.map((r) => [r.slug, r]));
      assertEquals([by.toeic.status, by.toeic.member_count, by.toeic.max_members, by.toeic.s, by.toeic.e], ["RECRUIT", 2, 8, "2026-11-02", "2026-12-27"]);
      assertEquals([by.cs.member_count, by.cs.max_members, by.cs.s], [3, 6, "2026-10-19"]);
      assertEquals([by.sqld.status, by.sqld.join_mode, by.sqld.member_count, by.sqld.max_members], ["RECRUIT", "APPROVAL", 1, 5]);
      assertEquals([by.docker.member_count, by.docker.max_members, by.docker.s], [1, 6, "2026-11-09"]);
      assertEquals([by.jcg.join_mode, by.jcg.member_count, by.jcg.max_members], ["APPROVAL", 4, 4]);
      assertEquals([by.aws.status, by.aws.join_mode, by.aws.member_count, by.aws.max_members, by.aws.s, by.aws.e], ["ACTIVE", "APPROVAL", 4, 6, "2026-10-01", "2026-12-31"]);
      assertEquals([by.react.status, by.react.member_count, by.react.max_members, by.react.s, by.react.e], ["ACTIVE", 5, 8, "2026-09-21", "2026-11-15"]);
      assertEquals([by.algo.status, by.algo.member_count, by.algo.max_members, by.algo.s, by.algo.e], ["ENDED", 6, 6, "2026-07-01", "2026-09-30"]);
      assertEquals([by.spring.status, by.spring.visibility, by.spring.join_mode, by.spring.member_count, by.spring.max_members, by.spring.e], ["ACTIVE", "PRIVATE", "APPROVAL", 5, 5, "2027-01-31"]);
      // I7: member_count = ACTIVE 행 수
      const bad = await q(`select r.slug from public.rooms r where r.id <= 9
                           and r.member_count <> (select count(*) from public.room_members m where m.room_id = r.id and m.status = 'ACTIVE')`);
      assertEquals(bad, []);
      const [aws] = await q(`select string_agg(p.nickname || ':' || m.role || ':' || m.status, ',' order by (m.role = 'LEADER') desc, m.joined_at, m.id) as x
                             from public.room_members m join public.profiles p on p.id = m.user_id where m.room_id = 6`);
      assertEquals(aws.x, "민수:LEADER:ACTIVE,지은:MEMBER:ACTIVE,철수:MEMBER:ACTIVE,하나:MEMBER:ACTIVE,도윤:MEMBER:INACTIVE");
      const [sq] = await q(`select status, applied_at is not null as a from public.room_members where room_id = 3 and user_id = $1`, [USERS.철수]);
      assertEquals([sq.status, sq.a], ["PENDING", true]);
      assertEquals((await q(`select count(*)::int as n from public.tags`))[0].n, 19);
      assertEquals((await q(`select count(*)::int as n from public.room_tags where room_id <= 9`))[0].n, 22);
      assertEquals((await q(`select string_agg(t.label, ',' order by rt.sort_order) as x from public.room_tags rt join public.tags t on t.slug = rt.tag_slug where rt.room_id = 6`))[0].x, "AWS,클라우드,자격증");
      assertEquals((await q(`select count(*)::int as n from public.room_invites where token like 'seed-%' and revoked_at is null`))[0].n, 9);
      assertEquals((await q(`select count(*)::int as n from public.room_notification_settings where room_id <= 9`))[0].n, 9);
      // 시퀀스가 9 뒤로 옮겨져 새 방을 만들 수 있다
      await setToday(q, TODAY);
      const d = await createRoom(q, USERS.서연);
      assertEquals(Number(d.id) > 9, true);
    },
  },
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "rooms: seed"`
Expected: FAIL — `rows.map` 결과가 `[]`.

- [ ] **Step 3: `supabase/seed.sql` 에 §2 추가**

플랜 01 §1 블록 바로 아래에 붙인다. 사람은 닉네임으로 찾고, 방은 slug 로 찾는다.

```sql
-- ═══════════ §2 태그 사전 · 방 · 멤버 · 초대 · 알림 설정 (plan 02) ═══════════
-- 기준일 2026-10-12. 숫자는 src/data/rooms.ts · src/data/room-view.ts 와 일치(docker 는 D3 에 따라 1/6).
-- 태그 slug 는 0009_tags.sql(plan 04) 과 같아야 한다. 양쪽 모두 on conflict (slug) do nothing.
insert into public.tags (slug, label, tone, aliases) values
  ('aws', 'AWS', 'mint', '{"amazon web services"}'),
  ('cloud', '클라우드', 'blue', '{"cloud"}'),
  ('certificate', '자격증', 'peach', '{"자격","certificate"}'),
  ('english', '영어', 'blue', '{"english"}'),
  ('toeic', '토익', 'peach', '{"toeic"}'),
  ('spring', 'Spring', 'mint', '{"스프링","spring boot"}'),
  ('backend', '백엔드', 'slate', '{"backend","서버"}'),
  ('java', 'Java', 'amber', '{"자바"}'),
  ('algorithm', '알고리즘', 'slate', '{"algorithm","ps"}'),
  ('coding-test', '코딩테스트', 'mint', '{"코테","coding test"}'),
  ('info-processing', '정보처리기사', 'amber', '{"정처기"}'),
  ('cs', 'CS', 'amber', '{"컴퓨터공학","computer science"}'),
  ('interview', '면접', 'lav', '{"interview"}'),
  ('react', 'React', 'blue', '{"리액트"}'),
  ('frontend', '프론트엔드', 'mint', '{"frontend","프론트"}'),
  ('docker', 'Docker', 'blue', '{"도커"}'),
  ('kubernetes', 'Kubernetes', 'lav', '{"k8s","쿠버네티스"}'),
  ('sql', 'SQL', 'amber', '{"sqld","쿼리"}'),
  ('data', '데이터', 'blue', '{"data"}')
on conflict (slug) do nothing;

-- 방 9개. id 고정(overriding system value). started_at/ended_at 은 KST 00:00.
insert into public.rooms (id, slug, title, intro, description_md, rules_md, start_date, end_date, max_members, min_members,
                          visibility, join_mode, leader_id, leader_does_tasks, status, member_count, started_at, ended_at, created_at, updated_at)
overriding system value
select v.id, v.slug, v.title, v.intro, v.description_md, v.rules_md, v.start_date::date, v.end_date::date, v.max_members, v.min_members,
       v.visibility, v.join_mode, p.id, true, v.status, v.member_count,
       v.started_at::timestamptz, v.ended_at::timestamptz, v.created_at::timestamptz, v.created_at::timestamptz
from (values
  (1, 'toeic', '토익 900 8주 챌린지', '매일 LC·RC 한 세트씩 풀고 오답 노트를 공유해요. 주말엔 모의고사 1회.',
   '8주 동안 매일 LC·RC 한 세트를 풀고, 틀린 문제는 오답 노트로 정리해 공유합니다. 주말에는 실전 모의고사 1회를 시간 맞춰 풀고 점수를 기록해요.',
   E'- 오답 노트에는 틀린 이유와 정답 근거를 함께 적어 주세요.\n- 모의고사는 120분 시간을 지켜서 풀어요.',
   '2026-11-02', '2026-12-27', 8, 4, 'PUBLIC', 'DIRECT', '서연', 'RECRUIT', 2, null, null, '2026-10-01 10:00+09'),
  (2, 'cs', 'CS 면접 질문 주 2회 — 운영체제·네트워크·데이터베이스 단골 질문 완전 정복하고 모의 면접까지', '운영체제·네트워크·DB 단골 질문을 주 2회 나눠 답변을 작성하고 서로 리뷰해요.',
   '월·목 주 2회, 회차마다 단골 면접 질문 2개에 대한 답변을 작성합니다. 서로의 답변에 댓글로 꼬리 질문을 남기고, 마지막 주에는 화상 모의 면접을 진행해요.',
   E'- 답변은 1분 안에 말할 수 있는 분량으로 작성해요.\n- 다른 사람 답변에 꼬리 질문을 1개 이상 남겨 주세요.',
   '2026-10-19', '2026-11-30', 6, 3, 'PUBLIC', 'DIRECT', '예린', 'RECRUIT', 3, null, null, '2026-10-02 10:00+09'),
  (3, 'sqld', 'SQLD 4주 벼락치기', '데이터 모델링부터 SQL 활용까지 4회차. 마지막 주는 모의고사로 마무리해요.',
   '11월 SQLD 시험 직전 4주 동안 핵심만 빠르게 정리합니다. 회차마다 요약 노트와 기출 풀이를 제출하고, 마지막 주에는 모의고사 2회를 함께 풀어요.',
   E'- 기출 풀이는 틀린 문제와 이유를 함께 적어 주세요.\n- 모의고사는 정해진 시간(90분)을 지켜 풀어요.',
   '2026-10-26', '2026-11-22', 5, 3, 'PUBLIC', 'APPROVAL', '가은', 'RECRUIT', 1, null, null, '2026-10-03 10:00+09'),
  (4, 'docker', 'Docker·K8s 입문 6주', '컨테이너 기초부터 쿠버네티스 배포까지, 매주 실습 결과를 스크린샷과 링크로 공유해요.',
   '도커 이미지 빌드부터 쿠버네티스에 서비스를 배포하기까지 6주 동안 단계별로 실습합니다. 매주 실습 결과를 스크린샷과 저장소 링크로 공유해요.',
   E'- 실습 환경은 각자 로컬(Docker Desktop 또는 minikube)을 사용해요.\n- 막힌 부분은 제출물에 그대로 적어 주면 함께 풀어 봐요.',
   '2026-11-09', '2026-12-20', 6, 2, 'PUBLIC', 'DIRECT', '철수', 'RECRUIT', 1, null, null, '2026-10-04 10:00+09'),
  (5, 'jcg', '정보처리기사 실기 2주 완성', '기출 회독 3회와 약점 단원 집중. 매일 저녁 9시 진도 체크.',
   '실기 시험 직전 2주 동안 기출을 3회독하고, 자주 틀리는 단원을 골라 집중적으로 다시 풉니다. 매일 저녁 9시에 진도를 체크해요.',
   E'- 매일 21시까지 그날 푼 회차를 제출해 주세요.\n- 오답은 단원별로 모아서 정리해요.',
   '2026-10-19', '2026-11-01', 4, 3, 'PUBLIC', 'APPROVAL', '수민', 'RECRUIT', 4, null, null, '2026-10-05 10:00+09'),
  (6, 'aws', 'AWS SAA 자격증 3개월 완주', 'IAM부터 고가용성 아키텍처까지, 매주 회차별 과제로 SAA-C03 합격까지 함께 달려요.',
   'AWS Solutions Architect – Associate(SAA-C03) 합격을 목표로 3개월간 13회차를 진행합니다. 매주 목요일에 새 회차가 열리고, 회차마다 공통 과제와 지정 과제가 있어요.',
   E'- 마감은 회차 마지막 날 23:59(KST)예요. 늦게라도 제출하면 지각으로 기록돼요.\n- 2회 연속 미제출 시 그룹장과 상의 후 이탈 처리될 수 있어요.',
   '2026-10-01', '2026-12-31', 6, 3, 'PUBLIC', 'APPROVAL', '민수', 'ACTIVE', 4, '2026-10-01 00:00+09', null, '2026-09-15 10:00+09'),
  (7, 'react', '리액트 공식문서 함께 읽기', 'react.dev Learn 섹션을 주차별로 읽고, 챕터마다 작은 예제를 만들어 공유합니다.',
   'react.dev의 Learn 섹션을 8주에 나눠 읽습니다. 챕터마다 핵심을 정리하고, 직접 만든 작은 예제를 CodeSandbox 링크로 공유해요.',
   E'- 예제는 공식문서와 다른 주제로 직접 만들어 주세요.\n- 정리 노트에는 이해가 안 된 부분도 솔직하게 적어요.',
   '2026-09-21', '2026-11-15', 8, 3, 'PUBLIC', 'DIRECT', '태호', 'ACTIVE', 5, '2026-09-21 00:00+09', null, '2026-09-01 10:00+09'),
  (8, 'algo', '알고리즘 매일 1문제', '백준·프로그래머스에서 하루 한 문제. 풀이와 회고를 짧게 남기는 13주 습관 만들기.',
   '매일 한 문제를 풀고 짧은 회고를 남기는 습관 스터디였어요. 주 단위로 7문제 중 5문제 이상 풀면 그 주 과제를 달성한 것으로 봤습니다.',
   E'- 풀이 언어는 자유, 회고는 3줄 이내로 남겨요.\n- 주 5문제 이상 풀면 주간 과제 달성으로 기록해요.',
   '2026-07-01', '2026-09-30', 6, 2, 'PUBLIC', 'DIRECT', '현우', 'ENDED', 6, '2026-07-01 00:00+09', '2026-10-01 00:00+09', '2026-06-15 10:00+09'),
  (9, 'spring', 'Spring 김영한 로드맵 완강', '핵심 원리부터 JPA 활용까지 로드맵 순서대로, 섹션별 정리 노트를 제출합니다.',
   '김영한 스프링 로드맵을 순서대로 완강합니다. 섹션을 묶어 회차로 나누고, 회차마다 정리 노트와 실습 저장소 링크를 제출해요.',
   E'- 정리 노트는 섹션별 핵심 개념 3가지 이상을 포함해요.\n- 실습 코드는 공개 저장소 링크로 공유해요.',
   '2026-10-05', '2027-01-31', 5, null, 'PRIVATE', 'APPROVAL', '지훈', 'ACTIVE', 5, '2026-10-05 00:00+09', null, '2026-09-20 10:00+09')
) as v(id, slug, title, intro, description_md, rules_md, start_date, end_date, max_members, min_members,
       visibility, join_mode, leader, status, member_count, started_at, ended_at, created_at)
join public.profiles p on p.nickname = v.leader
on conflict (id) do nothing;

select setval(pg_get_serial_sequence('public.rooms', 'id'), greatest((select max(id) from public.rooms), 9));

-- 멤버. joined_at 은 "참가 확정 순"(그룹장 먼저). 철수 sqld 는 PENDING, 도윤 aws 는 INACTIVE.
insert into public.room_members (room_id, user_id, role, status, applied_at, joined_at, left_at)
select r.id, p.id, v.role, v.status, v.applied_at::timestamptz, v.joined_at::timestamptz, v.left_at::timestamptz
from (values
  ('toeic', '서연', 'LEADER', 'ACTIVE', null, '2026-10-01 10:00+09', null),
  ('toeic', '도현', 'MEMBER', 'ACTIVE', null, '2026-10-06 12:00+09', null),
  ('cs', '예린', 'LEADER', 'ACTIVE', null, '2026-10-02 10:00+09', null),
  ('cs', '승호', 'MEMBER', 'ACTIVE', null, '2026-10-04 09:00+09', null),
  ('cs', '나연', 'MEMBER', 'ACTIVE', null, '2026-10-05 09:00+09', null),
  ('sqld', '가은', 'LEADER', 'ACTIVE', null, '2026-10-03 10:00+09', null),
  ('sqld', '철수', 'MEMBER', 'PENDING', '2026-10-10 09:00+09', null, null),
  ('docker', '철수', 'LEADER', 'ACTIVE', null, '2026-10-04 10:00+09', null),
  ('jcg', '수민', 'LEADER', 'ACTIVE', null, '2026-10-05 10:00+09', null),
  ('jcg', '태윤', 'MEMBER', 'ACTIVE', '2026-10-06 09:00+09', '2026-10-06 10:00+09', null),
  ('jcg', '하은', 'MEMBER', 'ACTIVE', '2026-10-07 09:00+09', '2026-10-07 10:00+09', null),
  ('jcg', '준서', 'MEMBER', 'ACTIVE', '2026-10-08 09:00+09', '2026-10-08 10:00+09', null),
  ('aws', '민수', 'LEADER', 'ACTIVE', null, '2026-09-15 10:00+09', null),
  ('aws', '지은', 'MEMBER', 'ACTIVE', '2026-09-20 09:00+09', '2026-09-20 10:00+09', null),
  ('aws', '철수', 'MEMBER', 'ACTIVE', '2026-09-21 09:00+09', '2026-09-21 10:00+09', null),
  ('aws', '하나', 'MEMBER', 'ACTIVE', '2026-09-22 09:00+09', '2026-09-22 10:00+09', null),
  ('aws', '도윤', 'MEMBER', 'INACTIVE', '2026-09-23 09:00+09', '2026-09-23 10:00+09', '2026-10-06 09:00+09'),
  ('react', '태호', 'LEADER', 'ACTIVE', null, '2026-09-01 10:00+09', null),
  ('react', '은지', 'MEMBER', 'ACTIVE', null, '2026-09-05 10:00+09', null),
  ('react', '시우', 'MEMBER', 'ACTIVE', null, '2026-09-06 10:00+09', null),
  ('react', '다인', 'MEMBER', 'ACTIVE', null, '2026-09-07 10:00+09', null),
  ('react', '현준', 'MEMBER', 'ACTIVE', null, '2026-09-08 10:00+09', null),
  ('algo', '현우', 'LEADER', 'ACTIVE', null, '2026-06-15 10:00+09', null),
  ('algo', '철수', 'MEMBER', 'ACTIVE', null, '2026-06-20 10:00+09', null),
  ('algo', '보람', 'MEMBER', 'ACTIVE', null, '2026-06-21 10:00+09', null),
  ('algo', '지성', 'MEMBER', 'ACTIVE', null, '2026-06-22 10:00+09', null),
  ('algo', '다은', 'MEMBER', 'ACTIVE', null, '2026-06-23 10:00+09', null),
  ('algo', '유진', 'MEMBER', 'ACTIVE', null, '2026-06-24 10:00+09', null),
  ('spring', '지훈', 'LEADER', 'ACTIVE', null, '2026-09-20 10:00+09', null),
  ('spring', '철수', 'MEMBER', 'ACTIVE', '2026-09-25 09:00+09', '2026-09-25 10:00+09', null),
  ('spring', '민재', 'MEMBER', 'ACTIVE', '2026-09-26 09:00+09', '2026-09-26 10:00+09', null),
  ('spring', '소율', 'MEMBER', 'ACTIVE', '2026-09-27 09:00+09', '2026-09-27 10:00+09', null),
  ('spring', '아린', 'MEMBER', 'ACTIVE', '2026-09-28 09:00+09', '2026-09-28 10:00+09', null)
) as v(slug, nickname, role, status, applied_at, joined_at, left_at)
join public.rooms r on r.slug = v.slug
join public.profiles p on p.nickname = v.nickname
on conflict (room_id, user_id) do nothing;

-- 방 태그(노출 순서 = sort_order, auto = room-view.ts 의 ✦)
insert into public.room_tags (room_id, tag_slug, source, sort_order)
select r.id, v.tag, case when v.auto then 'AUTO' else 'MANUAL' end, v.ord
from (values
  ('toeic', 'english', true, 0), ('toeic', 'toeic', true, 1),
  ('cs', 'cs', true, 0), ('cs', 'interview', false, 1),
  ('sqld', 'sql', true, 0), ('sqld', 'data', true, 1), ('sqld', 'certificate', false, 2),
  ('docker', 'docker', true, 0), ('docker', 'kubernetes', true, 1), ('docker', 'cloud', false, 2),
  ('jcg', 'certificate', true, 0), ('jcg', 'info-processing', false, 1),
  ('aws', 'aws', true, 0), ('aws', 'cloud', true, 1), ('aws', 'certificate', false, 2),
  ('react', 'react', true, 0), ('react', 'frontend', true, 1),
  ('algo', 'algorithm', true, 0), ('algo', 'coding-test', true, 1),
  ('spring', 'spring', true, 0), ('spring', 'backend', true, 1), ('spring', 'java', true, 2)
) as v(slug, tag, auto, ord)
join public.rooms r on r.slug = v.slug
on conflict (room_id, tag_slug) do nothing;

-- 초대 토큰(방당 활성 1개) · 알림 설정(기본값)
insert into public.room_invites (token, room_id, created_by)
select 'seed-' || r.slug, r.id, r.leader_id from public.rooms r where r.id <= 9
on conflict (token) do nothing;

insert into public.room_notification_settings (room_id)
select r.id from public.rooms r where r.id <= 9
on conflict (room_id) do nothing;

-- D4: 공통 과제 담당자 실체화(지금은 노드가 없어 no-op, plan 03 시드 §3 뒤에 다시 호출된다)
select public.assignment_resync(r.id) from public.rooms r;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db`
Expected: `rooms: seed …` PASS. Task 2 의 `room_archive/unarchive/delete` 사례(aws·민수 참조)도 이제 PASS. 플랜 01 `seed: is idempotent` 도 그대로 PASS(§2 전부 `on conflict do nothing`). 아직 FAIL 인 것은 `room_start`·`room_update 잠금` 2건(`room_apply`/`room_join` 미구현 — Task 5 에서 해소).

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql supabase/tests/_cases-rooms.ts
git commit -m "feat(db): seed §2 rooms, members, tags, invites, notification settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 4: `rooms_list` — 목록 집계 JSON (RoomListResponse)

**Files:**
- Modify: `supabase/migrations/0004_rooms.sql` (끝에 추가)
- Modify: `supabase/tests/_cases-rooms.ts` (`seedAwsTree` 헬퍼 + 사례 7개)

**Interfaces:**
- Consumes: Task 1 `room_leaf_stats`, `person_json`, `pct`, `kst_today`, `current_user_id`, `fail`; Task 3 시드.
- Produces:
  - `public.room_round_stats(p_room bigint) returns table(round_id bigint, label text, title text, start_date date, end_date date, sort_order int, leaf_count int, asg int, sub int)` — 보관 아닌 회차(depth 2) × 리프 합산. **플랜 03 이 0006 에서 `create or replace` 로 본문을 바꿀 수 있다**(시그니처 고정). 플랜 03 의 `room_progress(p_room)` 는 이 함수 위에 얹는다.
  - `public.room_current_round_id(p_room bigint, p_today date) returns bigint` — roomview §3.3 규칙(오늘 포함 회차 중 start 최신, 없으면 직전 회차). `room_detail_json` 이 인라인한 것과 같은 규칙.
  - `public.room_in_scope(p_room bigint, p_scope text, p_uid uuid) returns boolean` — public: 공개 ∧ DRAFT 아님 / mine: 내 MEMBER 행이 ACTIVE·PENDING / created: 내가 그룹장. 셋 다 보관 제외.
  - `public.room_matches(p_room bigint, p_status text, p_q text, p_tags text[]) returns boolean` — 상태 칩·검색(제목 + 태그 label/aliases ILIKE)·태그 OR.
  - `public.rooms_list(p_scope text default 'public', p_status text default 'all', p_q text default null, p_tags text[] default null, p_page int default 0, p_size int default 24, p_sort text default 'default') returns jsonb` — `RoomListResponse` + `today`.
  - 정렬 `default`: ACTIVE → RECRUIT → DRAFT → ENDED, `start_date asc`, `created_at desc`, `id desc`. `latest`: `created_at desc, id desc`. `startDate`: `start_date asc, id desc`.
  - 시드 기대값(철수 로그인): public 8장 순서 `react, aws, jcg, cs, sqld, toeic, docker, algo` · tabCounts `{public 8, mine 4, created 1}` · public facets 16개(자격증 3, 클라우드 2 선두) · mine facets 10개.

- [ ] **Step 1: `seedAwsTree` 헬퍼 + 실패하는 테스트**

`supabase/tests/_cases-rooms.ts` 에 헬퍼를 추가한다(Task 7 `room_get` 사례도 재사용). 플랜 03 시드 §3 가 생기면 이 헬퍼와 숫자가 겹치지 않도록 **사례 안에서만** 쓰고 롤백된다.

```ts
/**
 * 시드 aws(id 6) 에 최소 트리를 붙인다 — roomview §3.1 의 1·2·3주차 리프 5개.
 *   1주차 10/01–10/07: IAM 정책 이해(공통), VPC 실습(공통)
 *   2주차 10/08–10/14: EC2 인스턴스 유형 정리(지정: 지은·철수), S3 스토리지 클래스 발표자료(지정: 하나, 10/10–)
 *   3주차 10/15–10/21: ALB vs NLB 실습(공통)
 * 제출: IAM 민수D 지은L 철수D / VPC 민수D 철수D / EC2 지은D  → 1주차 5/8, 2주차 1/3, 3주차 0/4, 철수 2/4, 다음 마감 EC2 10/14
 */
export async function seedAwsTree(q: Q) {
  const AWS = "6";
  const r1 = await seedLeaves(q, AWS, [
    { title: "IAM 정책 이해", type: "COMMON", s: "2026-10-01", e: "2026-10-07" },
    { title: "VPC 실습", type: "COMMON", s: "2026-10-01", e: "2026-10-07" },
  ], { label: "1주차", title: "IAM·VPC", s: "2026-10-01", e: "2026-10-07" });
  const r2 = await seedLeaves(q, AWS, [
    { title: "EC2 인스턴스 유형 정리", type: "DESIGNATED", s: "2026-10-08", e: "2026-10-14" },
    { title: "S3 스토리지 클래스 발표자료", type: "DESIGNATED", s: "2026-10-10", e: "2026-10-14" },
  ], { label: "2주차", title: "EC2·S3", s: "2026-10-08", e: "2026-10-14" });
  const r3 = await seedLeaves(q, AWS, [
    { title: "ALB vs NLB 실습", type: "COMMON", s: "2026-10-15", e: "2026-10-21" },
  ], { label: "3주차", title: "고가용성 아키텍처", s: "2026-10-15", e: "2026-10-21" });
  const [iam, vpc] = r1.leafIds, [ec2, s3] = r2.leafIds, [alb] = r3.leafIds;
  await q(`insert into public.task_assignments (node_id, user_id, source) values ($1,$3,'DESIGNATED'), ($1,$4,'DESIGNATED'), ($2,$5,'DESIGNATED')`,
    [ec2, s3, USERS.지은, USERS.철수, USERS.하나]);
  // D = end_date 18:00 KST, L = end_date + 1일 09:00 KST (is_late)
  const sub = (node: string, uid: string, at: string, late = false) =>
    q(`insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late) values ($1, $2, '제출', $3::timestamptz, $4)`, [node, uid, at, late]);
  await sub(iam, USERS.민수, "2026-10-07 18:00+09");
  await sub(iam, USERS.지은, "2026-10-08 09:00+09", true);
  await sub(iam, USERS.철수, "2026-10-07 18:00+09");
  await sub(vpc, USERS.민수, "2026-10-07 18:00+09");
  await sub(vpc, USERS.철수, "2026-10-07 18:00+09");
  await sub(ec2, USERS.지은, "2026-10-12 10:00+09");
  return { rounds: [r1.roundId, r2.roundId, r3.roundId], iam, vpc, ec2, s3, alb };
}

/** rooms_list 호출 → 응답 JSON */
export async function listRooms(q: Q, a: Partial<{ scope: string; status: string; q: string; tags: string[]; page: number; size: number; sort: string }> = {}) {
  const [{ r }] = await q(
    `select public.rooms_list($1, $2, $3, $4::text[], $5, $6, $7) as r`,
    [a.scope ?? "public", a.status ?? "all", a.q ?? null, a.tags ?? null, a.page ?? 0, a.size ?? 24, a.sort ?? "default"],
  );
  return r as Record<string, any>;
}
```

`ROOM_CASES` 에 추가:

```ts
  {
    name: "rooms_list: 철수 public — 8장 정렬, tabCounts 8/4/1, jcg isFull, docker 1/6, facets 자격증3·클라우드2",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const r = await listRooms(q);
      assertEquals(r.today, TODAY);
      assertEquals([r.page, r.size, r.totalElements], [0, 24, 8]);
      assertEquals(r.items.map((x: any) => x.slug), ["react", "aws", "jcg", "cs", "sqld", "toeic", "docker", "algo"]);
      assertEquals(r.tabCounts, { public: 8, mine: 4, created: 1 });
      const by = Object.fromEntries(r.items.map((x: any) => [x.slug, x]));
      assertEquals([by.jcg.status, by.jcg.isFull, by.jcg.memberCount, by.jcg.maxMembers, by.jcg.joinMode], ["recruit", true, 4, 4, "approval"]);
      assertEquals([by.toeic.isFull, by.toeic.memberCount], [false, 2]);
      assertEquals([by.docker.memberCount, by.docker.membership, by.docker.progress], [1, { role: "leader", status: "active" }, { kind: "recruit" }]);
      assertEquals([by.sqld.membership, by.sqld.progress], [{ role: "member", status: "pending" }, { kind: "recruit" }]);
      assertEquals(by.toeic.membership, null);
      assertEquals(by.aws.leader, { userId: USERS.민수, nickname: "민수", tone: "mint" });
      assertEquals(by.aws.tags.map((t: any) => [t.slug, t.auto]), [["aws", true], ["cloud", true], ["certificate", false]]);
      assertEquals([by.aws.startDate, by.aws.endDate, by.aws.isPublic, by.aws.id], ["2026-10-01", "2026-12-31", true, "6"]);
      assertEquals(r.tagFacets.length, 16);
      assertEquals(r.tagFacets[0], { slug: "certificate", label: "자격증", count: 3 });
      assertEquals(r.tagFacets[1], { slug: "cloud", label: "클라우드", count: 2 });
      assertEquals(r.tagFacets.slice(2).every((f: any) => f.count === 1), true);
    },
  },
  {
    name: "rooms_list: mine 4(sqld pending 포함), created 1, facets 는 scope 기준",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const mine = await listRooms(q, { scope: "mine" });
      assertEquals(mine.items.map((x: any) => x.slug), ["aws", "spring", "sqld", "algo"]);   // active(start asc) → recruit → ended
      assertEquals(mine.totalElements, 4);
      assertEquals(mine.items.find((x: any) => x.slug === "spring").isPublic, false);
      assertEquals(mine.tagFacets.length, 10);
      assertEquals(mine.tagFacets[0], { slug: "certificate", label: "자격증", count: 2 });
      const created = await listRooms(q, { scope: "created" });
      assertEquals(created.items.map((x: any) => x.slug), ["docker"]);
      assertEquals(created.tabCounts, { public: 8, mine: 4, created: 1 });
    },
  },
  {
    name: "rooms_list: anon — public 8, mine/created 0, membership null, mine scope → AUTH_REQUIRED; 비공개·DRAFT 숨김",
    run: async (q) => {
      await setToday(q, TODAY);
      await asAnon(q);
      const r = await listRooms(q);
      assertEquals(r.totalElements, 8);
      assertEquals(r.tabCounts, { public: 8, mine: 0, created: 0 });
      assertEquals(r.items.every((x: any) => x.membership === null), true);
      assertEquals(r.items.some((x: any) => x.slug === "spring"), false);
      await expectFail(q, `select public.rooms_list('mine','all',null,null,0,24,'default')`, [], "AUTH_REQUIRED");
      await expectFail(q, `select public.rooms_list('created','all',null,null,0,24,'default')`, [], "AUTH_REQUIRED");
      // DRAFT 는 public 에 안 보이고 created 에만 status draft 로
      const d = await createRoom(q, USERS.서연, { title: "Draft Only" });
      await asAnon(q);
      assertEquals((await listRooms(q)).totalElements, 8);
      await asUser(q, USERS.서연);
      assertEquals((await listRooms(q)).totalElements, 8);
      const c = await listRooms(q, { scope: "created" });
      assertEquals(c.items.map((x: any) => [x.slug, x.status, x.progress.kind]), [[d.slug, "draft", "recruit"]]);
      assertEquals(c.tabCounts.created, 1);
    },
  },
  {
    name: "rooms_list: progress — aws mine 2/4 next EC2 10/14, 민수(그룹장·담당) mine, 서연 team 2/3, react team null/0, algo final 0/0/0",
    run: async (q) => {
      await setToday(q, TODAY);
      const t = await seedAwsTree(q);
      await asUser(q, USERS.철수);
      let by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "mine", submitted: 2, assigned: 4, nextTask: { nodeId: t.ec2, title: "EC2 인스턴스 유형 정리", dueDate: "2026-10-14" } });
      assertEquals(by.aws.membership, { role: "member", status: "active" });
      assertEquals(by.react.progress, { kind: "team", currentRound: null, totalRounds: 0 });
      assertEquals(by.algo.progress, { kind: "final", submitted: 0, assigned: 0, totalRounds: 0 });
      assertEquals(by.algo.membership, { role: "member", status: "active" });
      await asUser(q, USERS.민수);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "mine", submitted: 2, assigned: 4, nextTask: { nodeId: t.ec2, title: "EC2 인스턴스 유형 정리", dueDate: "2026-10-14" } });
      // 그룹장이 과제를 안 하면 team
      await q(`update public.rooms set leader_does_tasks = false where id = 6`);
      await q(`select public.assignment_resync(6)`);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "team", currentRound: { index: 2, label: "2주차", title: "EC2·S3" }, totalRounds: 3 });
      await asUser(q, USERS.서연);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress, { kind: "team", currentRound: { index: 2, label: "2주차", title: "EC2·S3" }, totalRounds: 3 });
      // 철수가 EC2 를 제출하면 nextTask 는 3주차 ALB(10/21)
      await asUser(q, USERS.철수);
      await q(`insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late) values ($1, $2, 'x', now(), false)`, [t.ec2, USERS.철수]);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress.nextTask, { nodeId: t.alb, title: "ALB vs NLB 실습", dueDate: "2026-10-21" });
      // 도윤(INACTIVE) 은 mine 이 아니고 team
      await asUser(q, USERS.도윤);
      by = Object.fromEntries((await listRooms(q)).items.map((x: any) => [x.slug, x]));
      assertEquals(by.aws.progress.kind, "team");
      assertEquals(by.aws.membership, { role: "member", status: "inactive" });
    },
  },
  {
    name: "rooms_list: 상태 칩·검색·태그 OR·페이지·정렬",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const slugs = async (a: Parameters<typeof listRooms>[1]) => (await listRooms(q, a)).items.map((x: any) => x.slug);
      assertEquals(await slugs({ status: "recruit" }), ["jcg", "cs", "sqld", "toeic", "docker"]);
      assertEquals(await slugs({ status: "active" }), ["react", "aws"]);
      assertEquals(await slugs({ status: "ended" }), ["algo"]);
      assertEquals(await slugs({ q: "토익" }), ["toeic"]);
      assertEquals(await slugs({ q: "AWS" }), ["aws"]);            // 태그 label
      assertEquals(await slugs({ q: "aws" }), ["aws"]);            // ILIKE
      assertEquals(await slugs({ q: "k8s" }), ["docker"]);         // 태그 alias
      assertEquals(await slugs({ q: "  " }), ["react", "aws", "jcg", "cs", "sqld", "toeic", "docker", "algo"]);   // 공백은 무시
      assertEquals(await slugs({ q: "없는검색어" }), []);
      assertEquals(await slugs({ tags: ["cloud", "certificate"] }), ["aws", "jcg", "sqld", "docker"]);          // OR
      assertEquals(await slugs({ tags: ["cloud"], status: "recruit" }), ["docker"]);
      // 상태·검색·태그 필터는 tabCounts·facets 에 영향 없음
      const f = await listRooms(q, { tags: ["cloud"], status: "recruit", q: "Docker" });
      assertEquals([f.totalElements, f.tabCounts.public, f.tagFacets.length], [1, 8, 16]);
      // 페이지
      const p1 = await listRooms(q, { size: 3, page: 1 });
      assertEquals([p1.page, p1.size, p1.totalElements, p1.items.map((x: any) => x.slug)], [1, 3, 8, ["cs", "sqld", "toeic"]]);
      assertEquals((await listRooms(q, { size: 3, page: 5 })).items, []);
      // 정렬
      assertEquals(await slugs({ sort: "latest" }), ["jcg", "docker", "sqld", "cs", "toeic", "aws", "react", "algo"]);   // created_at desc
      assertEquals(await slugs({ sort: "startDate" }), ["algo", "react", "aws", "jcg", "cs", "sqld", "toeic", "docker"]); // 같은 10/19 면 created_at desc → jcg(10/05) 가 cs(10/02) 앞
      // 검증
      await expectFail(q, `select public.rooms_list('everyone','all',null,null,0,24,'default')`, [], "VALIDATION_FAILED");
      await expectFail(q, `select public.rooms_list('public','full',null,null,0,24,'default')`, [], "VALIDATION_FAILED");
      await expectFail(q, `select public.rooms_list('public','all',null,null,0,24,'popular')`, [], "VALIDATION_FAILED");
    },
  },
  {
    name: "rooms_list: 보관된 방은 모든 scope·tabCounts·facets 에서 빠진다 (Review Focus 3)",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.민수);
      await q(`select public.room_archive('aws')`);
      await asUser(q, USERS.철수);
      const pub = await listRooms(q);
      assertEquals(pub.items.some((x: any) => x.slug === "aws"), false);
      assertEquals(pub.tabCounts, { public: 7, mine: 3, created: 1 });
      assertEquals(pub.tagFacets.find((f: any) => f.slug === "certificate").count, 2);
      assertEquals((await listRooms(q, { scope: "mine" })).items.some((x: any) => x.slug === "aws"), false);
      await asUser(q, USERS.민수);
      assertEquals((await listRooms(q, { scope: "created" })).items, []);
      await q(`select public.room_unarchive('aws')`);
      assertEquals((await listRooms(q, { scope: "created" })).items.map((x: any) => x.slug), ["aws"]);
    },
  },
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "rooms: rooms_list"`
Expected: 6개 FAIL — `function public.rooms_list(...) does not exist`.

- [ ] **Step 3: 0004 에 회차 집계 헬퍼 · scope/matches · `rooms_list` 추가**

`supabase/migrations/0004_rooms.sql` 끝에 추가:

```sql
-- ───────── 회차 집계 (플랜 03 이 0006 에서 CREATE OR REPLACE 로 본문을 바꿀 수 있다 — 시그니처 고정) ─────────
create or replace function public.room_round_stats(p_room bigint)
returns table (round_id bigint, label text, title text, start_date date, end_date date, sort_order int, leaf_count int, asg int, sub int)
language sql stable security definer set search_path = '' as $$
  select n.id, n.label::text, n.title::text, n.start_date, n.end_date, n.sort_order,
         count(l.node_id)::int, coalesce(sum(l.asg), 0)::int, coalesce(sum(l.sub), 0)::int
  from public.goal_nodes n
  left join public.room_leaf_stats(p_room) l on l.round_id = n.id
  where n.room_id = p_room and n.depth = 2 and n.archived_at is null
  group by n.id
$$;

-- 현재 회차: 오늘을 포함하는 회차 중 start 가 가장 늦은 것, 없으면 직전 회차 (roomview §3.3). room_detail_json 과 같은 규칙
create or replace function public.room_current_round_id(p_room bigint, p_today date) returns bigint
language sql stable security definer set search_path = '' as $$
  select n.id from public.goal_nodes n
  where n.room_id = p_room and n.depth = 2 and n.archived_at is null and n.start_date <= p_today
  order by (n.end_date >= p_today) desc, n.start_date desc, n.sort_order desc
  limit 1
$$;

-- ───────── 목록 scope · 필터 (main §3-6, §3-8) ─────────
create or replace function public.room_in_scope(p_room bigint, p_scope text, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room and r.archived_at is null and (
         (p_scope = 'public'  and r.visibility = 'PUBLIC' and r.status <> 'DRAFT')
      or (p_scope = 'mine'    and p_uid is not null and exists (
            select 1 from public.room_members m
            where m.room_id = r.id and m.user_id = p_uid and m.role = 'MEMBER' and m.status in ('ACTIVE', 'PENDING')))
      or (p_scope = 'created' and p_uid is not null and r.leader_id = p_uid)))
$$;

create or replace function public.room_matches(p_room bigint, p_status text, p_q text, p_tags text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room
      and (p_status = 'all' or r.status = upper(p_status))
      and (p_q is null
           or r.title ilike '%' || p_q || '%'
           or exists (select 1 from public.room_tags rt join public.tags t on t.slug = rt.tag_slug
                      where rt.room_id = r.id
                        and (t.label ilike '%' || p_q || '%'
                             or exists (select 1 from unnest(t.aliases) a where a ilike '%' || p_q || '%'))))
      and (p_tags is null or exists (select 1 from public.room_tags rt where rt.room_id = r.id and rt.tag_slug = any(p_tags))))
$$;

-- ───────── rooms_list (03-api §2 RoomListResponse) ─────────
-- 02 §4.3: 페이지 id 집합에 대해 멤버십·태그·회차·팀 집계·내 집계·다음 마감을 각각 1회씩 모아 jsonb_agg
create or replace function public.rooms_list(
  p_scope text default 'public', p_status text default 'all', p_q text default null, p_tags text[] default null,
  p_page int default 0, p_size int default 24, p_sort text default 'default')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.current_user_id();
  v_today  date := public.kst_today();
  v_scope  text := coalesce(p_scope, 'public');
  v_status text := coalesce(p_status, 'all');
  v_q      text := nullif(trim(coalesce(p_q, '')), '');
  v_tags   text[] := case when p_tags is null or cardinality(p_tags) = 0 then null else p_tags end;
  v_page   int := greatest(coalesce(p_page, 0), 0);
  v_size   int := least(greatest(coalesce(p_size, 24), 1), 100);
  v_sort   text := coalesce(p_sort, 'default');
  v_total  int;
  v_items  jsonb;
  v_counts jsonb;
  v_facets jsonb;
begin
  if v_scope not in ('public', 'mine', 'created') then
    perform public.fail('VALIDATION_FAILED', 'scope 는 public·mine·created 중 하나예요', '{"field":"scope"}'::jsonb);
  end if;
  if v_status not in ('all', 'recruit', 'active', 'ended') then
    perform public.fail('VALIDATION_FAILED', 'status 는 all·recruit·active·ended 중 하나예요', '{"field":"status"}'::jsonb);
  end if;
  if v_sort not in ('default', 'latest', 'startDate') then
    perform public.fail('VALIDATION_FAILED', 'sort 는 default·latest·startDate 중 하나예요', '{"field":"sort"}'::jsonb);
  end if;
  if v_scope <> 'public' and v_uid is null then
    perform public.fail('AUTH_REQUIRED', '로그인이 필요해요');
  end if;

  -- 탭 총계: 필터와 무관한 고정값(main §1-3). 비로그인은 mine/created 0
  select jsonb_build_object(
    'public',  count(*) filter (where public.room_in_scope(r.id, 'public', v_uid)),
    'mine',    count(*) filter (where v_uid is not null and public.room_in_scope(r.id, 'mine', v_uid)),
    'created', count(*) filter (where v_uid is not null and public.room_in_scope(r.id, 'created', v_uid)))
  into v_counts
  from public.rooms r where r.archived_at is null;

  -- 태그 facet: 현재 scope 집합(상태·검색·태그 미적용), count desc → label
  select coalesce(jsonb_agg(jsonb_build_object('slug', f.slug, 'label', f.label, 'count', f.n) order by f.n desc, f.label), '[]'::jsonb)
  into v_facets
  from (
    select t.slug, t.label, count(*)::int as n
    from public.rooms r
    join public.room_tags rt on rt.room_id = r.id
    join public.tags t on t.slug = rt.tag_slug
    where public.room_in_scope(r.id, v_scope, v_uid)
    group by t.slug, t.label) f;

  select count(*)::int into v_total
  from public.rooms r
  where public.room_in_scope(r.id, v_scope, v_uid) and public.room_matches(r.id, v_status, v_q, v_tags);

  with page as (
    select r.*, row_number() over () as ord
    from (
      select r.* from public.rooms r
      where public.room_in_scope(r.id, v_scope, v_uid) and public.room_matches(r.id, v_status, v_q, v_tags)
      order by
        case when v_sort = 'default' then case r.status when 'ACTIVE' then 0 when 'RECRUIT' then 1 when 'DRAFT' then 2 else 3 end end,
        case when v_sort in ('default', 'startDate') then r.start_date end,
        r.created_at desc, r.id desc
      limit v_size offset v_page * v_size) r
  ),
  mem as (
    select m.room_id, lower(m.role) as role, lower(m.status) as status
    from public.room_members m
    where v_uid is not null and m.user_id = v_uid and m.room_id in (select id from page)
  ),
  tg as (
    select rt.room_id,
           jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label, 'tone', t.tone, 'auto', rt.source = 'AUTO')
                     order by rt.sort_order, t.slug) as tags
    from public.room_tags rt join public.tags t on t.slug = rt.tag_slug
    where rt.room_id in (select id from page)
    group by rt.room_id
  ),
  rs as (
    select p.id as room_id, count(x.round_id)::int as total_rounds,
           coalesce(sum(x.asg), 0)::int as asg, coalesce(sum(x.sub), 0)::int as sub
    from page p left join lateral public.room_round_stats(p.id) x on true
    group by p.id
  ),
  cur as (
    select p.id as room_id, c.idx, c.label, c.title
    from page p
    cross join lateral (
      select x.idx, x.label, x.title
      from (select rr.round_id, rr.label, rr.title, row_number() over (order by rr.sort_order, rr.round_id)::int as idx
            from public.room_round_stats(p.id) rr) x
      where x.round_id = public.room_current_round_id(p.id, v_today)) c
    where p.status = 'ACTIVE'
  ),
  does as (   -- 내가 담당 자격: ACTIVE 멤버, 그룹장은 leader_does_tasks
    select p.id as room_id from page p
    where v_uid is not null and exists (
      select 1 from public.room_members m
      where m.room_id = p.id and m.user_id = v_uid and m.status = 'ACTIVE' and (m.role = 'MEMBER' or p.leader_does_tasks))
  ),
  mine as (
    select n.room_id, count(*) filter (where s.id is not null)::int as submitted, count(*)::int as assigned
    from public.goal_nodes n
    join public.task_assignments a on a.node_id = n.id and a.user_id = v_uid and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.room_id in (select room_id from does) and n.task_type is not null and n.archived_at is null
    group by n.room_id
  ),
  nxt as (   -- 미제출 ∧ end_date ≥ today 중 마감 빠른 것, 같은 날이면 트리 순서 (main §3-2)
    select distinct on (n.room_id) n.room_id, n.id as node_id, n.title, n.end_date
    from public.goal_nodes n
    join public.task_assignments a on a.node_id = n.id and a.user_id = v_uid and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.room_id in (select room_id from does) and n.task_type is not null and n.archived_at is null
      and s.id is null and n.end_date >= v_today
    order by n.room_id, n.end_date, n.sort_order, n.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id::text, 'slug', p.slug, 'title', p.title, 'intro', p.intro,
    'status', lower(p.status), 'isFull', p.status = 'RECRUIT' and p.member_count >= p.max_members,
    'isPublic', p.visibility = 'PUBLIC', 'joinMode', lower(p.join_mode),
    'memberCount', p.member_count, 'maxMembers', p.max_members,
    'leader', public.person_json(p.leader_id), 'tags', coalesce(tg.tags, '[]'::jsonb),
    'startDate', to_char(p.start_date, 'YYYY-MM-DD'), 'endDate', to_char(p.end_date, 'YYYY-MM-DD'),
    'membership', case when mem.room_id is null then null else jsonb_build_object('role', mem.role, 'status', mem.status) end,
    'progress', case
      when p.status in ('RECRUIT', 'DRAFT') then jsonb_build_object('kind', 'recruit')
      when p.status = 'ACTIVE' and d.room_id is not null then jsonb_build_object(
        'kind', 'mine', 'submitted', coalesce(mi.submitted, 0), 'assigned', coalesce(mi.assigned, 0),
        'nextTask', case when nx.node_id is null then null
                         else jsonb_build_object('nodeId', nx.node_id::text, 'title', nx.title, 'dueDate', to_char(nx.end_date, 'YYYY-MM-DD')) end)
      when p.status = 'ACTIVE' then jsonb_build_object(
        'kind', 'team',
        'currentRound', case when c.idx is null then null else jsonb_build_object('index', c.idx, 'label', c.label, 'title', c.title) end,
        'totalRounds', rs.total_rounds)
      else jsonb_build_object('kind', 'final', 'submitted', rs.sub, 'assigned', rs.asg, 'totalRounds', rs.total_rounds) end
  ) order by p.ord), '[]'::jsonb)
  into v_items
  from page p
  left join mem  on mem.room_id = p.id
  left join tg   on tg.room_id = p.id
  left join rs   on rs.room_id = p.id
  left join cur c on c.room_id = p.id
  left join does d on d.room_id = p.id
  left join mine mi on mi.room_id = p.id
  left join nxt nx on nx.room_id = p.id;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'items', v_items, 'page', v_page, 'size', v_size, 'totalElements', v_total,
    'tabCounts', v_counts, 'tagFacets', v_facets);
end $$;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db -- --filter "rooms: rooms_list"`
Expected: 6 PASS. (`page` CTE 의 `row_number() over ()` 는 안쪽 서브쿼리의 정렬을 따른다 — 순서가 어긋나면 `order by p.ord` 대신 안쪽 서브쿼리에 `row_number() over (order by …)` 를 같은 정렬식으로 넣는다.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_rooms.sql supabase/tests/_cases-rooms.ts
git commit -m "feat(db): rooms_list with scope/status/search/tag facets and per-card progress

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 5: `0005_membership.sql` — 멤버십 상태 머신 (join/apply/leave/cancel/approve/reject + 읽기 2개)

**Files:**
- Modify: `supabase/migrations/0005_membership.sql` (Task 1 의 `assignment_resync` 아래에 추가)
- Create: `supabase/tests/_cases-membership.ts`, `supabase/tests/membership-sql.test.ts`

**Interfaces:**
- Consumes: Task 1 `room_lock`, `room_take_seat`, `room_release_seat`, `room_me_json`, `room_members_json`, `notify_publish`, `assignment_resync`, `person_json`, `require_user`, `fail`, `iso`; Task 2 `room_start`(사례에서), Task 3 시드(jcg 4/4, sqld 철수 PENDING).
- Produces (플랜 04 `member_deactivate` 와 플랜 05 어댑터가 호출):
  - `public.membership_result(p_room bigint, p_user uuid) returns jsonb` — `{ today, me, memberCount, members, pendingCount }`. `pendingCount` 는 p_user 가 그룹장일 때만.
  - `public.invite_check(p_room bigint, p_token text) returns boolean` — 활성 토큰이면 true, 그 방의 **회전된** 토큰이면 `INVITE_REVOKED`, 그 외 false. Task 6 `invite_*` 도 쓴다.
  - `public.room_join(p_slug text, p_invite_token text default null)`, `public.room_apply(p_slug text, p_invite_token text default null)`, `public.room_leave(p_slug text)`, `public.room_cancel_application(p_slug text)`, `public.room_approve(p_slug text, p_user uuid)`, `public.room_reject(p_slug text, p_user uuid)` — 전부 `returns jsonb`(MembershipResult).
  - `public.room_applications(p_slug text) returns jsonb` — `{ today, items: (Person & { appliedAt })[] }`, 그룹장.
  - `public.room_members_get(p_slug text) returns jsonb` — `{ today, items: RoomDetail["members"] }` 전 상태, 그룹장.
  - 검사 순서(모든 참가 함수 공통): `require_user` → `room_lock` → 보관·상태(`ROOM_NOT_RECRUITING`) → 그룹장(`OWNER_CANNOT_JOIN`) → 비공개 접근(`ROOM_NOT_FOUND` / `INVITE_REVOKED`) → 참가 방식(`JOIN_MODE_MISMATCH`) → 기존 행(`ALREADY_MEMBER` / `ALREADY_PENDING` / `MEMBER_NOT_ACTIVE`) → 정원(`ROOM_FULL`).
  - 재신청·재참가는 **같은 행** 의 status 되돌림(D3). INACTIVE 는 재참가 거부(`MEMBER_NOT_ACTIVE`).
  - 알림(자리표 호출): `JOIN_REQUESTED`(그룹장, prefix `JOIN_REQUESTED:<room>:<user>:<applied_at epoch>` — 거절 후 재신청도 다시 알림), `JOIN_APPROVED`/`JOIN_REJECTED`(신청자, prefix `<KIND>:<room>:<user>:<decided_at epoch>`).

- [ ] **Step 1: 실패하는 테스트 — 표 기반 상태 머신 + 정원**

`supabase/tests/_cases-membership.ts`:

```ts
import { asAnon, asUser, setToday } from "./_harness.ts";
import { assertEquals, assertNotEquals } from "@std/assert";
import { type Case, type Q, TODAY, USERS, createRoom, expectFail, seedLeaves } from "./_cases-rooms.ts";

/** 리프 1개(공통) + 지정 1개를 가진 RECRUIT 방. 반환: { id, slug, leafIds } */
export async function openRoom(q: Q, leader: string, over: Parameters<typeof createRoom>[2] = {}) {
  const d = await createRoom(q, leader, over);
  const { leafIds } = await seedLeaves(q, d.id, [
    { title: "공통", type: "COMMON", s: "2026-11-01", e: "2026-11-07" },
    { title: "지정", type: "DESIGNATED", s: "2026-11-01", e: "2026-11-07" },
  ]);
  await q(`select public.room_open_recruit($1)`, [d.slug]);
  return { id: String(d.id), slug: d.slug as string, leafIds };
}

const member = async (q: Q, room: string, uid: string) =>
  (await q(`select id::text as id, role, status, applied_at, joined_at, decided_at, decided_by::text as decided_by, left_at
            from public.room_members where room_id = $1 and user_id = $2`, [room, uid]))[0] ?? null;
const count = async (q: Q, room: string) => (await q(`select member_count from public.rooms where id = $1`, [room]))[0].member_count as number;
const asg = async (q: Q, node: string, uid: string) =>
  (await q(`select released_at is null as live from public.task_assignments where node_id = $1 and user_id = $2`, [node, uid]))[0]?.live ?? null;

type Step = { as: string | null; fn: string; args?: unknown[]; code?: string; note?: string };
async function runTable(q: Q, slug: string, steps: Step[]) {
  for (const s of steps) {
    if (s.as === null) await asAnon(q); else await asUser(q, s.as);
    const sql = `select public.${s.fn}($1${(s.args ?? []).map((_, i) => `, $${i + 2}`).join("")}) as r`;
    if (s.code) await expectFail(q, sql, [slug, ...(s.args ?? [])], s.code);
    else await q(sql, [slug, ...(s.args ?? [])]);
  }
}

export const MEMBERSHIP_CASES: Case[] = [
  {
    name: "direct room: join/leave/rejoin state table, same row reused, assignments follow",
    run: async (q) => {
      await setToday(q, TODAY);
      const r = await openRoom(q, USERS.서연, { maxMembers: 3 });
      await runTable(q, r.slug, [
        { as: null, fn: "room_join", code: "AUTH_REQUIRED" },
        { as: USERS.서연, fn: "room_join", code: "OWNER_CANNOT_JOIN" },
        { as: USERS.서연, fn: "room_leave", code: "OWNER_CANNOT_LEAVE" },
        { as: USERS.현우, fn: "room_leave", code: "NOT_MEMBER" },
        { as: USERS.민수, fn: "room_apply", code: "JOIN_MODE_MISMATCH" },
        { as: USERS.민수, fn: "room_join" },
        { as: USERS.민수, fn: "room_join", code: "ALREADY_MEMBER" },
        { as: USERS.민수, fn: "room_cancel_application", code: "ALREADY_DECIDED" },
      ]);
      const m1 = await member(q, r.id, USERS.민수);
      assertEquals([m1.role, m1.status, m1.joined_at !== null], ["MEMBER", "ACTIVE", true]);
      assertEquals(await count(q, r.id), 2);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), true);          // 공통 리프 배정
      // MembershipResult 모양
      await asUser(q, USERS.민수);
      await q(`select public.room_leave($1)`, [r.slug]);
      const [{ res }] = await q(`select public.room_join($1) as res`, [r.slug]);
      assertEquals(res.me, { state: "active" });
      assertEquals([res.memberCount, res.pendingCount, res.today], [2, 0, TODAY]);
      assertEquals(res.members.map((x: any) => [x.nickname, x.role, x.status]), [["서연", "leader", "active"], ["민수", "member", "active"]]);
      // leave → CANCELED, 자리 반납, 배정 해제. 재참가는 같은 행
      await q(`select public.room_leave($1)`, [r.slug]);
      const m2 = await member(q, r.id, USERS.민수);
      assertEquals([m2.id, m2.status, m2.left_at !== null], [m1.id, "CANCELED", true]);
      assertEquals(await count(q, r.id), 1);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), false);
      await expectFail(q, `select public.room_leave($1)`, [r.slug], "NOT_MEMBER");
      await expectFail(q, `select public.room_cancel_application($1)`, [r.slug], "NOT_FOUND");
      await q(`select public.room_join($1)`, [r.slug]);
      const m3 = await member(q, r.id, USERS.민수);
      assertEquals([m3.id, m3.status, m3.left_at], [m1.id, "ACTIVE", null]);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), true);
      // INACTIVE 는 재참가 거부 (member_deactivate 는 플랜 04 — 여기선 행을 직접 바꾼다)
      await q(`update public.room_members set status = 'INACTIVE', left_at = now() where room_id = $1 and user_id = $2`, [r.id, USERS.민수]);
      await q(`select public.room_release_seat($1)`, [r.id]);
      await expectFail(q, `select public.room_join($1)`, [r.slug], "MEMBER_NOT_ACTIVE");
      // ACTIVE 방에서는 참가·취소 불가
      await asUser(q, USERS.현우);
      await q(`select public.room_join($1)`, [r.slug]);
      await asUser(q, USERS.서연);
      await q(`select public.room_start($1)`, [r.slug]);
      await asUser(q, USERS.현우);
      await expectFail(q, `select public.room_leave($1)`, [r.slug], "ROOM_NOT_RECRUITING");
      await asUser(q, USERS.지훈);
      await expectFail(q, `select public.room_join($1)`, [r.slug], "ROOM_NOT_RECRUITING");
      // DRAFT 방도 모집중이 아니다
      const d = await createRoom(q, USERS.서연, { title: "Draft" });
      await asUser(q, USERS.지훈);
      await expectFail(q, `select public.room_join($1)`, [d.slug], "ROOM_NOT_RECRUITING");
      await expectFail(q, `select public.room_join($1)`, ["no-such-room"], "ROOM_NOT_FOUND");
    },
  },
  {
    name: "approval room: apply/reject/re-apply/cancel/approve table — same row, applied_at refreshed (Review Focus 2)",
    run: async (q) => {
      await setToday(q, TODAY);
      const r = await openRoom(q, USERS.서연, { joinMode: "approval", maxMembers: 3 });
      await runTable(q, r.slug, [
        { as: USERS.민수, fn: "room_join", code: "JOIN_MODE_MISMATCH" },
        { as: USERS.민수, fn: "room_apply" },
        { as: USERS.민수, fn: "room_apply", code: "ALREADY_PENDING" },
        { as: USERS.현우, fn: "room_approve", args: [USERS.민수], code: "NOT_LEADER" },
        { as: USERS.현우, fn: "room_applications", code: "NOT_LEADER" },
        { as: USERS.현우, fn: "room_members_get", code: "NOT_LEADER" },
      ]);
      const m1 = await member(q, r.id, USERS.민수);
      assertEquals([m1.status, m1.applied_at !== null, m1.joined_at], ["PENDING", true, null]);
      assertEquals(await count(q, r.id), 1);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), null);         // PENDING 은 배정 없음
      // 신청자 시점 결과: 내 PENDING 행이 members 에 보임
      await asUser(q, USERS.민수);
      const [{ res }] = await q(`select public.membership_result($1, $2) as res`, [r.id, USERS.민수]);
      assertEquals(res.me, { state: "pending" });
      assertEquals(res.members.map((x: any) => [x.nickname, x.status]), [["서연", "active"], ["민수", "pending"]]);
      assertEquals(res.pendingCount, 0);
      // 그룹장 읽기
      await asUser(q, USERS.서연);
      const [{ apps }] = await q(`select public.room_applications($1) as apps`, [r.slug]);
      assertEquals(apps.items.map((x: any) => x.nickname), ["민수"]);
      assertEquals(typeof apps.items[0].appliedAt, "string");
      const [{ all }] = await q(`select public.room_members_get($1) as all`, [r.slug]);
      assertEquals(all.items.map((x: any) => [x.nickname, x.role, x.status]), [["서연", "leader", "active"], ["민수", "member", "pending"]]);
      // 거절 → 같은 행 REJECTED, decided_by 서연
      const [{ rej }] = await q(`select public.room_reject($1, $2) as rej`, [r.slug, USERS.민수]);
      assertEquals([rej.me, rej.pendingCount, rej.memberCount], [{ state: "leader" }, 0, 1]);
      const m2 = await member(q, r.id, USERS.민수);
      assertEquals([m2.id, m2.status, m2.decided_by], [m1.id, "REJECTED", USERS.서연]);
      await runTable(q, r.slug, [
        { as: USERS.서연, fn: "room_reject", args: [USERS.민수], code: "ALREADY_DECIDED" },
        { as: USERS.서연, fn: "room_approve", args: [USERS.민수], code: "ALREADY_DECIDED" },
        { as: USERS.서연, fn: "room_approve", args: [USERS.현우], code: "NOT_FOUND" },
        { as: USERS.민수, fn: "room_cancel_application", code: "ALREADY_DECIDED" },
      ]);
      // 재신청: 같은 행, applied_at 갱신, decided_* 초기화
      await q(`update public.room_members set applied_at = applied_at - interval '1 day' where id = $1`, [m1.id]);
      const before = (await member(q, r.id, USERS.민수)).applied_at;
      await asUser(q, USERS.민수);
      await q(`select public.room_apply($1)`, [r.slug]);
      const m3 = await member(q, r.id, USERS.민수);
      assertEquals([m3.id, m3.status, m3.decided_at, m3.decided_by], [m1.id, "PENDING", null, null]);
      assertNotEquals(m3.applied_at, before);
      // 신청 취소 → CANCELED, 두 번째는 NOT_FOUND
      await q(`select public.room_cancel_application($1)`, [r.slug]);
      assertEquals((await member(q, r.id, USERS.민수)).status, "CANCELED");
      await expectFail(q, `select public.room_cancel_application($1)`, [r.slug], "NOT_FOUND");
      // 세 번째 신청 → 승인 → ACTIVE, joined_at, 자리 +1, 배정 생성
      await q(`select public.room_apply($1)`, [r.slug]);
      await asUser(q, USERS.서연);
      const [{ ok }] = await q(`select public.room_approve($1, $2) as ok`, [r.slug, USERS.민수]);
      assertEquals([ok.me, ok.memberCount, ok.pendingCount], [{ state: "leader" }, 2, 0]);
      assertEquals(ok.members.map((x: any) => x.nickname), ["서연", "민수"]);
      const m4 = await member(q, r.id, USERS.민수);
      assertEquals([m4.id, m4.status, m4.joined_at !== null, m4.decided_by], [m1.id, "ACTIVE", true, USERS.서연]);
      assertEquals(await count(q, r.id), 2);
      assertEquals(await asg(q, r.leafIds[0], USERS.민수), true);
      await asUser(q, USERS.민수);
      await expectFail(q, `select public.room_cancel_application($1)`, [r.slug], "ALREADY_DECIDED");
      await expectFail(q, `select public.room_apply($1)`, [r.slug], "ALREADY_MEMBER");
      // 승인은 RECRUIT 에서만
      await asUser(q, USERS.현우);
      await q(`select public.room_apply($1)`, [r.slug]);
      await asUser(q, USERS.서연);
      await q(`select public.room_start($1)`, [r.slug]);                       // 현우 PENDING → EXPIRED
      assertEquals((await member(q, r.id, USERS.현우)).status, "EXPIRED");
      await expectFail(q, `select public.room_approve($1, $2)`, [r.slug, USERS.현우], "ROOM_NOT_RECRUITING");
      await asUser(q, USERS.현우);
      await expectFail(q, `select public.room_cancel_application($1)`, [r.slug], "ALREADY_DECIDED");
    },
  },
  {
    name: "capacity: jcg 4/4 join→ROOM_FULL, apply→ROOM_FULL; approve beyond capacity → ROOM_FULL keeps PENDING; sqld approve 철수",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      await expectFail(q, `select public.room_apply($1)`, ["jcg"], "ROOM_FULL");
      await q(`update public.rooms set join_mode = 'DIRECT' where slug = 'jcg'`);
      await expectFail(q, `select public.room_join($1)`, ["jcg"], "ROOM_FULL");
      assertEquals(await member(q, "5", USERS.철수), null);
      assertEquals(await count(q, "5"), 4);
      // 승인 초과
      const r = await openRoom(q, USERS.서연, { joinMode: "approval", maxMembers: 2 });
      await asUser(q, USERS.민수); await q(`select public.room_apply($1)`, [r.slug]);
      await asUser(q, USERS.현우); await q(`select public.room_apply($1)`, [r.slug]);
      await asUser(q, USERS.서연);
      await q(`select public.room_approve($1, $2)`, [r.slug, USERS.민수]);
      await expectFail(q, `select public.room_approve($1, $2)`, [r.slug, USERS.현우], "ROOM_FULL");
      assertEquals((await member(q, r.id, USERS.현우)).status, "PENDING");
      assertEquals(await count(q, r.id), 2);
      // 시드: 가은이 철수 승인 → sqld 2/5
      await asUser(q, USERS.가은);
      const [{ res }] = await q(`select public.room_approve($1, $2) as res`, ["sqld", USERS.철수]);
      assertEquals([res.memberCount, res.pendingCount], [2, 0]);
      assertEquals((await member(q, "3", USERS.철수)).status, "ACTIVE");
    },
  },
  {
    name: "private room: join needs a valid invite token (ROOM_NOT_FOUND without, INVITE_REVOKED with rotated)",
    run: async (q) => {
      await setToday(q, TODAY);
      const r = await openRoom(q, USERS.서연, { isPublic: false });
      const [{ token }] = await q(`select token from public.room_invites where room_id = $1 and revoked_at is null`, [r.id]);
      await asUser(q, USERS.민수);
      await expectFail(q, `select public.room_join($1)`, [r.slug], "ROOM_NOT_FOUND");
      await expectFail(q, `select public.room_join($1, $2)`, [r.slug, "bogus"], "ROOM_NOT_FOUND");
      await q(`update public.room_invites set revoked_at = now() where token = $1`, [token]);
      await expectFail(q, `select public.room_join($1, $2)`, [r.slug, token], "INVITE_REVOKED");
      await q(`update public.room_invites set revoked_at = null where token = $1`, [token]);
      const [{ res }] = await q(`select public.room_join($1, $2) as res`, [r.slug, token]);
      assertEquals(res.me, { state: "active" });
      // 공개 방은 토큰이 없어도, 엉뚱해도 된다
      await asUser(q, USERS.현우);
      await q(`select public.room_join($1, $2)`, ["toeic", "bogus"]);
      assertEquals(await count(q, "1"), 3);
    },
  },
];
```

`supabase/tests/membership-sql.test.ts`:

```ts
import { applySeed, openDb, sqlTest, withCase } from "./_harness.ts";
import { MEMBERSHIP_CASES } from "./_cases-membership.ts";

const db = await openDb();
await applySeed(db);

for (const c of MEMBERSHIP_CASES) sqlTest(`membership: ${c.name}`, withCase(db, c.run));
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "membership:"`
Expected: 4 FAIL — `function public.room_join(text) does not exist`.

- [ ] **Step 3: 0005 에 멤버십 함수 추가**

`supabase/migrations/0005_membership.sql` 끝에 추가:

```sql
-- ───────── MembershipResult (03-api §3) ─────────
create or replace function public.membership_result(p_room bigint, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'me', public.room_me_json(p_room, p_user),
    'memberCount', r.member_count,
    'members', public.room_members_json(p_room, p_user),
    'pendingCount', case when r.leader_id = p_user
                         then (select count(*)::int from public.room_members m where m.room_id = p_room and m.status = 'PENDING')
                         else 0 end)
  from public.rooms r where r.id = p_room
$$;

-- 초대 토큰 검사: 활성 → true, 그 방의 회전된 토큰 → INVITE_REVOKED, 그 외 false
create or replace function public.invite_check(p_room bigint, p_token text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_revoked timestamptz; v_found boolean;
begin
  if p_token is null then return false; end if;
  select revoked_at, true into v_revoked, v_found from public.room_invites where token = p_token and room_id = p_room;
  if v_found is null then return false; end if;
  if v_revoked is not null then perform public.fail('INVITE_REVOKED', '만료된 초대 링크예요'); end if;
  return true;
end $$;

-- 참가 공통 선행 검사. 반환: 내 기존 행(없으면 null)
create or replace function public.room_join_precheck(r public.rooms, p_uid uuid, p_token text, p_mode text)
returns public.room_members language plpgsql security definer set search_path = '' as $$
declare m public.room_members;
begin
  if r.archived_at is not null or r.status <> 'RECRUIT' then
    perform public.fail('ROOM_NOT_RECRUITING', '모집중인 방이 아니에요');
  end if;
  if r.leader_id = p_uid then perform public.fail('OWNER_CANNOT_JOIN', '그룹장은 이미 참가자예요'); end if;
  if r.visibility = 'PRIVATE' and not public.invite_check(r.id, p_token) then
    perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요');
  end if;
  if r.join_mode <> p_mode then
    perform public.fail('JOIN_MODE_MISMATCH',
      case when p_mode = 'DIRECT' then '승인제 방이에요. 참가 신청을 해 주세요' else '바로 참가할 수 있는 방이에요' end,
      jsonb_build_object('joinMode', lower(r.join_mode)));
  end if;
  select * into m from public.room_members where room_id = r.id and user_id = p_uid;
  if found then
    if m.status = 'ACTIVE' then perform public.fail('ALREADY_MEMBER', '이미 참가한 방이에요'); end if;
    if m.status = 'PENDING' then perform public.fail('ALREADY_PENDING', '이미 참가 신청한 방이에요'); end if;
    if m.status = 'INACTIVE' then perform public.fail('MEMBER_NOT_ACTIVE', '이탈 처리된 방에는 다시 참가할 수 없어요'); end if;
    return m;
  end if;
  return null;
end $$;

-- ───────── room_join: RECRUIT·DIRECT, 정원 원자 판정 (D3) ─────────
create or replace function public.room_join(p_slug text, p_invite_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  m := public.room_join_precheck(r, v_uid, p_invite_token, 'DIRECT');
  perform public.room_take_seat(r.id);                       -- ROOM_FULL
  insert into public.room_members (room_id, user_id, role, status, joined_at)
  values (r.id, v_uid, 'MEMBER', 'ACTIVE', now())
  on conflict (room_id, user_id) do update
    set status = 'ACTIVE', role = 'MEMBER', joined_at = now(), left_at = null,
        decided_at = null, decided_by = null, updated_at = now();
  perform public.assignment_resync(r.id);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── room_apply: RECRUIT·APPROVAL, 대기자는 정원 미포함(단 이미 찼으면 ROOM_FULL) ─────────
create or replace function public.room_apply(p_slug text, p_invite_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members; v_now timestamptz := now();
begin
  r := public.room_lock(p_slug);
  m := public.room_join_precheck(r, v_uid, p_invite_token, 'APPROVAL');
  if r.member_count >= r.max_members then
    perform public.fail('ROOM_FULL', '정원이 찼어요', '{"field":"maxMembers"}'::jsonb);
  end if;
  insert into public.room_members (room_id, user_id, role, status, applied_at)
  values (r.id, v_uid, 'MEMBER', 'PENDING', v_now)
  on conflict (room_id, user_id) do update
    set status = 'PENDING', role = 'MEMBER', applied_at = excluded.applied_at,
        decided_at = null, decided_by = null, left_at = null, updated_at = now();
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_REQUESTED', r.id, null, v_uid, array[r.leader_id],
    'JOIN_REQUESTED:' || r.id || ':' || v_uid || ':' || floor(extract(epoch from v_now))::bigint,
    jsonb_build_object('applicant', public.person_json(v_uid)));
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── room_leave: RECRUIT 의 MEMBER 만. ACTIVE → CANCELED, 자리 반납, 배정 해제 ─────────
create or replace function public.room_leave(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  select * into m from public.room_members where room_id = r.id and user_id = v_uid and status = 'ACTIVE';
  if not found then perform public.fail('NOT_MEMBER', '참가 중인 방이 아니에요'); end if;
  if m.role = 'LEADER' then perform public.fail('OWNER_CANNOT_LEAVE', '그룹장은 참가를 취소할 수 없어요'); end if;
  if r.archived_at is not null or r.status <> 'RECRUIT' then
    perform public.fail('ROOM_NOT_RECRUITING', '모집 기간에만 참가를 취소할 수 있어요');
  end if;
  update public.room_members set status = 'CANCELED', left_at = now(), updated_at = now() where id = m.id;
  perform public.room_release_seat(r.id);
  perform public.assignment_resync(r.id);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── room_cancel_application: PENDING 본인 → CANCELED ─────────
create or replace function public.room_cancel_application(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  select * into m from public.room_members where room_id = r.id and user_id = v_uid;
  if not found or m.status = 'CANCELED' then perform public.fail('NOT_FOUND', '취소할 참가 신청이 없어요'); end if;
  if m.status <> 'PENDING' then perform public.fail('ALREADY_DECIDED', '이미 처리된 신청이에요. 새로고침해 주세요'); end if;
  update public.room_members set status = 'CANCELED', decided_at = now(), updated_at = now() where id = m.id;
  perform public.assignment_resync(r.id);
  return public.membership_result(r.id, v_uid);
end $$;

-- 승인·거절 공통: 그룹장, RECRUIT, 대상 PENDING. 반환: 대상 행
create or replace function public.room_decide_precheck(r public.rooms, p_uid uuid, p_user uuid)
returns public.room_members language plpgsql security definer set search_path = '' as $$
declare m public.room_members;
begin
  if r.leader_id <> p_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.archived_at is not null or r.status <> 'RECRUIT' then
    perform public.fail('ROOM_NOT_RECRUITING', '모집중인 방에서만 신청을 처리할 수 있어요');
  end if;
  select * into m from public.room_members where room_id = r.id and user_id = p_user;
  if not found then perform public.fail('NOT_FOUND', '참가 신청을 찾을 수 없어요'); end if;
  if m.status <> 'PENDING' then perform public.fail('ALREADY_DECIDED', '이미 처리된 신청이에요'); end if;
  return m;
end $$;

-- ───────── room_approve: PENDING → ACTIVE (정원 원자 판정) ─────────
create or replace function public.room_approve(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members; v_now timestamptz := now();
begin
  r := public.room_lock(p_slug);
  m := public.room_decide_precheck(r, v_uid, p_user);
  perform public.room_take_seat(r.id);                       -- ROOM_FULL → 행은 PENDING 그대로
  update public.room_members
     set status = 'ACTIVE', joined_at = v_now, decided_at = v_now, decided_by = v_uid, updated_at = now()
   where id = m.id;
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_APPROVED', r.id, null, v_uid, array[p_user],
    'JOIN_APPROVED:' || r.id || ':' || p_user || ':' || floor(extract(epoch from v_now))::bigint, '{}'::jsonb);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── room_reject: PENDING → REJECTED ─────────
create or replace function public.room_reject(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members; v_now timestamptz := now();
begin
  r := public.room_lock(p_slug);
  m := public.room_decide_precheck(r, v_uid, p_user);
  update public.room_members set status = 'REJECTED', decided_at = v_now, decided_by = v_uid, updated_at = now() where id = m.id;
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_REJECTED', r.id, null, v_uid, array[p_user],
    'JOIN_REJECTED:' || r.id || ':' || p_user || ':' || floor(extract(epoch from v_now))::bigint, '{}'::jsonb);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── 그룹장 읽기 ─────────
create or replace function public.room_applications(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 볼 수 있어요'); end if;
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(public.person_json(m.user_id) || jsonb_build_object('appliedAt', public.iso(m.applied_at)) order by m.applied_at, m.id)
      from public.room_members m where m.room_id = r.id and m.status = 'PENDING'), '[]'::jsonb));
end $$;

create or replace function public.room_members_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 볼 수 있어요'); end if;
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(public.person_json(m.user_id)
               || jsonb_build_object('role', lower(m.role), 'status', lower(m.status), 'joinedAt', public.iso(m.joined_at))
               order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.applied_at nulls last, m.id)
      from public.room_members m where m.room_id = r.id), '[]'::jsonb));
end $$;
```

- [ ] **Step 4: 실행해서 통과 확인 (이전에 미뤄둔 rooms 사례 포함)**

Run: `npm run test:db`
Expected: `membership:` 4 PASS. `rooms: room_start …`, `rooms: room_update: 상태별 필드 잠금 …` 두 사례도 이제 PASS(`room_apply`/`room_join` 생김). 전체 녹색.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_membership.sql supabase/tests/_cases-membership.ts supabase/tests/membership-sql.test.ts
git commit -m "feat(db): membership state machine (join/apply/leave/cancel/approve/reject) with atomic capacity

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 6: 초대 — `invite_get` · `invite_rotate` · `invite_preview` · `invite_join`

**Files:**
- Modify: `supabase/migrations/0005_membership.sql` (끝에 추가 + 내부 함수 revoke)
- Modify: `supabase/tests/_cases-membership.ts` (사례 추가)

**Interfaces:**
- Consumes: Task 1 `invite_ensure`, `room_lock`, `room_me_json`, `person_json`; Task 5 `room_join`, `room_apply`, `invite_check`; Task 3 시드 토큰 `seed-<slug>`.
- Produces:
  - `public.invite_get(p_slug text) returns jsonb` — `{ today, token, url }`, 그룹장. 없으면 생성.
  - `public.invite_rotate(p_slug text) returns jsonb` — 옛 토큰 전부 `revoked_at`, 새 토큰 발급. 같은 모양.
  - `public.invite_resolve(p_token text) returns public.rooms` — 내부. 없음 `INVITE_NOT_FOUND`, 회전됨 `INVITE_REVOKED`, 방이 DRAFT·보관이면 `INVITE_NOT_FOUND`(숨김).
  - `public.invite_preview(p_token text) returns jsonb` — 비로그인 허용. `{ today, room: { slug, title, intro, startDate, endDate, memberCount, maxMembers, status, isPublic, joinMode, tags }, leader, me }`.
  - `public.invite_join(p_token text) returns jsonb` — 로그인. `join_mode` 가 DIRECT 면 `room_join(slug, token)`, APPROVAL 이면 `room_apply(slug, token)` 에 위임(비공개 우회·에러 코드 동일).
  - 0004·0005 의 내부 전용 함수는 `revoke execute … from anon, authenticated`(플랜 01 종료 게이트 지침).

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/_cases-membership.ts` 의 `MEMBERSHIP_CASES` 에 추가:

```ts
  {
    name: "invite_get/rotate: leader only, seed token, rotation revokes old (Review Focus 5)",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.민수);
      await expectFail(q, `select public.invite_get($1)`, ["docker"], "NOT_LEADER");
      await expectFail(q, `select public.invite_rotate($1)`, ["docker"], "NOT_LEADER");
      await asUser(q, USERS.철수);
      const [{ g }] = await q(`select public.invite_get($1) as g`, ["docker"]);
      assertEquals(g, { today: TODAY, token: "seed-docker", url: "/invite/seed-docker" });
      const [{ n }] = await q(`select public.invite_rotate($1) as n`, ["docker"]);
      assertNotEquals(n.token, "seed-docker");
      assertEquals([n.url, n.token.length], [`/invite/${n.token}`, 32]);
      const [{ cnt }] = await q(`select count(*)::int as cnt from public.room_invites where room_id = 4 and revoked_at is null`);
      assertEquals(cnt, 1);
      await asAnon(q);
      await expectFail(q, `select public.invite_preview($1)`, ["seed-docker"], "INVITE_REVOKED");
      await expectFail(q, `select public.invite_preview($1)`, ["no-such-token"], "INVITE_NOT_FOUND");
      const [{ p }] = await q(`select public.invite_preview($1) as p`, [n.token]);
      assertEquals(p.room.slug, "docker");
      // 토큰이 없던 방(초대 행 삭제)도 invite_get 이 만들어 준다
      await asUser(q, USERS.철수);
      await q(`delete from public.room_invites where room_id = 4`);
      const [{ g2 }] = await q(`select public.invite_get($1) as g2`, ["docker"]);
      assertEquals(g2.token.length, 32);
      await expectFail(q, `select public.invite_get($1)`, ["no-such-room"], "ROOM_NOT_FOUND");
    },
  },
  {
    name: "invite_preview: anon OK with me null, member state, DRAFT hidden, private room visible via token",
    run: async (q) => {
      await setToday(q, TODAY);
      await asAnon(q);
      const [{ p }] = await q(`select public.invite_preview($1) as p`, ["seed-toeic"]);
      assertEquals(p.today, TODAY);
      assertEquals(p.me, null);
      assertEquals(p.room, {
        slug: "toeic", title: "토익 900 8주 챌린지", intro: "매일 LC·RC 한 세트씩 풀고 오답 노트를 공유해요. 주말엔 모의고사 1회.",
        startDate: "2026-11-02", endDate: "2026-12-27", memberCount: 2, maxMembers: 8, status: "recruit", isPublic: true, joinMode: "direct",
        tags: [{ slug: "english", label: "영어", tone: "blue", auto: true }, { slug: "toeic", label: "토익", tone: "peach", auto: true }],
      });
      assertEquals(p.leader, { userId: USERS.서연, nickname: "서연", tone: "blue" });
      await asUser(q, USERS.철수);
      assertEquals((await q(`select public.invite_preview($1) as p`, ["seed-toeic"]))[0].p.me, { state: "none" });
      assertEquals((await q(`select public.invite_preview($1) as p`, ["seed-sqld"]))[0].p.me, { state: "pending" });
      assertEquals((await q(`select public.invite_preview($1) as p`, ["seed-docker"]))[0].p.me, { state: "leader" });
      // 비공개 spring 도 토큰으로 미리보기 가능(비멤버·비로그인)
      await asAnon(q);
      assertEquals((await q(`select public.invite_preview($1) as p`, ["seed-spring"]))[0].p.room.isPublic, false);
      // DRAFT 방은 토큰이 있어도 숨김
      const d = await createRoom(q, USERS.서연);
      const [{ token }] = await q(`select token from public.room_invites where room_id = $1`, [d.id]);
      await asAnon(q);
      await expectFail(q, `select public.invite_preview($1)`, [token], "INVITE_NOT_FOUND");
      // 보관된 방도 숨김
      await asUser(q, USERS.민수);
      await q(`select public.room_archive('aws')`);
      await asAnon(q);
      await expectFail(q, `select public.invite_preview($1)`, ["seed-aws"], "INVITE_NOT_FOUND");
    },
  },
  {
    name: "invite_join: join_mode-aware, private bypass, owner/anon/revoked errors",
    run: async (q) => {
      await setToday(q, TODAY);
      const direct = await openRoom(q, USERS.서연, { isPublic: false, title: "Private Direct" });
      const appr = await openRoom(q, USERS.서연, { isPublic: false, joinMode: "approval", title: "Private Approval" });
      const tok = async (id: string) => (await q(`select token from public.room_invites where room_id = $1 and revoked_at is null`, [id]))[0].token as string;
      const td = await tok(direct.id), ta = await tok(appr.id);
      await asAnon(q);
      await expectFail(q, `select public.invite_join($1)`, [td], "AUTH_REQUIRED");
      await asUser(q, USERS.서연);
      await expectFail(q, `select public.invite_join($1)`, [td], "OWNER_CANNOT_JOIN");
      await asUser(q, USERS.민수);
      const [{ a }] = await q(`select public.invite_join($1) as a`, [td]);
      assertEquals([a.me, a.memberCount], [{ state: "active" }, 2]);
      const [{ b }] = await q(`select public.invite_join($1) as b`, [ta]);
      assertEquals([b.me, b.memberCount], [{ state: "pending" }, 1]);
      await expectFail(q, `select public.invite_join($1)`, [ta], "ALREADY_PENDING");
      await expectFail(q, `select public.invite_join($1)`, [td], "ALREADY_MEMBER");
      // 회전 뒤 옛 토큰
      await asUser(q, USERS.서연);
      await q(`select public.invite_rotate($1)`, [direct.slug]);
      await asUser(q, USERS.현우);
      await expectFail(q, `select public.invite_join($1)`, [td], "INVITE_REVOKED");
      await expectFail(q, `select public.invite_join($1)`, ["no-such-token"], "INVITE_NOT_FOUND");
      const [{ c }] = await q(`select public.invite_join($1) as c`, [await tok(direct.id)]);
      assertEquals(c.me, { state: "active" });
      // 공개 승인제(jcg, 4/4) 는 토큰으로 와도 ROOM_FULL
      await expectFail(q, `select public.invite_join($1)`, ["seed-jcg"], "ROOM_FULL");
    },
  },
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "membership: invite"`
Expected: 3 FAIL — `function public.invite_get(text) does not exist`.

- [ ] **Step 3: 0005 에 초대 함수 + revoke 추가**

`supabase/migrations/0005_membership.sql` 끝에 추가:

```sql
-- ───────── 초대 (03-api §3, I10) ─────────
create or replace function public.invite_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; v_token text;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 초대 링크를 볼 수 있어요'); end if;
  v_token := public.invite_ensure(r.id, v_uid);
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'token', v_token, 'url', '/invite/' || v_token);
end $$;

create or replace function public.invite_rotate(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; v_token text;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 초대 링크를 바꿀 수 있어요'); end if;
  update public.room_invites set revoked_at = now() where room_id = r.id and revoked_at is null;
  v_token := public.invite_ensure(r.id, v_uid);
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'token', v_token, 'url', '/invite/' || v_token);
end $$;

-- 토큰 → 방. 없음 INVITE_NOT_FOUND, 회전됨 INVITE_REVOKED, DRAFT·보관 방은 INVITE_NOT_FOUND(숨김)
create or replace function public.invite_resolve(p_token text) returns public.rooms
language plpgsql stable security definer set search_path = '' as $$
declare i public.room_invites; r public.rooms;
begin
  select * into i from public.room_invites where token = p_token;
  if not found then perform public.fail('INVITE_NOT_FOUND', '초대 링크를 찾을 수 없어요'); end if;
  if i.revoked_at is not null then perform public.fail('INVITE_REVOKED', '만료된 초대 링크예요'); end if;
  select * into r from public.rooms where id = i.room_id;
  if r.status = 'DRAFT' or r.archived_at is not null then perform public.fail('INVITE_NOT_FOUND', '초대 링크를 찾을 수 없어요'); end if;
  return r;
end $$;

create or replace function public.invite_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); r public.rooms; v_tags jsonb;
begin
  r := public.invite_resolve(p_token);
  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label, 'tone', t.tone, 'auto', rt.source = 'AUTO')
                            order by rt.sort_order, t.slug), '[]'::jsonb)
  into v_tags from public.room_tags rt join public.tags t on t.slug = rt.tag_slug where rt.room_id = r.id;
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'room', jsonb_build_object(
      'slug', r.slug, 'title', r.title, 'intro', r.intro,
      'startDate', to_char(r.start_date, 'YYYY-MM-DD'), 'endDate', to_char(r.end_date, 'YYYY-MM-DD'),
      'memberCount', r.member_count, 'maxMembers', r.max_members,
      'status', lower(r.status), 'isPublic', r.visibility = 'PUBLIC', 'joinMode', lower(r.join_mode), 'tags', v_tags),
    'leader', public.person_json(r.leader_id),
    'me', public.room_me_json(r.id, v_uid));
end $$;

-- join_mode 에 따라 참가/신청. 비공개 우회는 토큰을 그대로 넘겨 room_join/room_apply 가 판단
create or replace function public.invite_join(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.invite_resolve(p_token);
  if r.join_mode = 'DIRECT' then return public.room_join(r.slug, p_token); end if;
  return public.room_apply(r.slug, p_token);
end $$;

-- ───────── 내부 전용 함수는 RPC 로 노출하지 않는다 (PostgREST 는 public 함수 전부를 노출) ─────────
revoke execute on function
  public.notify_publish(text, bigint, bigint, uuid, uuid[], text, jsonb),
  public.room_lock(text), public.room_readable(bigint, uuid, text),
  public.room_leaf_stats(bigint), public.room_round_stats(bigint), public.room_current_round_id(bigint, date),
  public.room_me_json(bigint, uuid), public.room_members_json(bigint, uuid), public.room_detail_json(bigint, uuid),
  public.invite_ensure(bigint, uuid), public.room_take_seat(bigint), public.room_release_seat(bigint),
  public.room_transition_active(bigint, uuid), public.room_transition_ended(bigint), public.room_tick(),
  public.room_in_scope(bigint, text, uuid), public.room_matches(bigint, text, text, text[]),
  public.assignment_resync(bigint), public.membership_result(bigint, uuid), public.invite_check(bigint, text),
  public.room_join_precheck(public.rooms, uuid, text, text), public.room_decide_precheck(public.rooms, uuid, uuid),
  public.invite_resolve(text)
from anon, authenticated;
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db`
Expected: `membership:` 7 PASS, 나머지 전부 PASS. PGlite 스텁의 `anon`/`authenticated` 역할이 있어 `revoke` 가 통과한다(플랜 01 `_pglite-stubs.ts` 첫 줄).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0005_membership.sql supabase/tests/_cases-membership.ts
git commit -m "feat(db): invite get/rotate/preview/join, revoke internal functions from RPC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 7: `room_get(p_slug, p_invite_token)` — RoomDetail

**Files:**
- Modify: `supabase/migrations/0004_rooms.sql` (끝에 추가)
- Modify: `supabase/tests/_cases-rooms.ts` (사례 추가)

**Interfaces:**
- Consumes: Task 1 `room_readable`, `room_detail_json`(members/me/currentRound/rounds/stats/myProgress/invite/pendingCount 전부 여기서 만든다 — `goal_nodes`·`task_assignments`·`submissions` 를 직접 읽음); Task 4 `seedAwsTree`, `room_round_stats`; Task 3 시드; Task 6 `invite_rotate`.
- Produces: `public.room_get(p_slug text, p_invite_token text default null) returns jsonb` — `RoomDetail` + `today`. 비공개·DRAFT·보관 방은 읽을 자격이 없으면 `ROOM_NOT_FOUND`(D7). 플랜 03 은 `room_round_stats` 를 `create or replace` 로 고도화할 수 있고(`room_progress(p_room)` 추가), `room_detail_json` 의 rounds/stats 가 그 함수를 쓰도록 바꾸려면 0006 에서 `room_detail_json` 도 같은 시그니처로 교체한다.

- [ ] **Step 1: 실패하는 테스트**

`supabase/tests/_cases-rooms.ts` 의 `ROOM_CASES` 에 추가:

```ts
  {
    name: "room_get: me.state matrix for 철수 (toeic none, sqld pending, docker leader, jcg none, aws active, react none, algo active)",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.철수);
      const st = async (slug: string) => (await q(`select public.room_get($1) as r`, [slug]))[0].r.me.state;
      assertEquals(await Promise.all(["toeic", "sqld", "docker", "jcg", "aws", "react", "algo"].map(st)),
        ["none", "pending", "leader", "none", "active", "none", "active"]);
      assertEquals(await st("spring"), "active");                      // 비공개지만 멤버
      await asUser(q, USERS.도윤);
      assertEquals(await st("aws"), "inactive");
      const [{ r }] = await q(`select public.room_get($1) as r`, ["toeic"]);
      assertEquals([r.today, r.id, r.slug, r.status, r.archived, r.isPublic, r.joinMode], [TODAY, "1", "toeic", "recruit", false, true, "direct"]);
      assertEquals([r.memberCount, r.maxMembers, r.minMembers, r.leader.nickname, r.leaderDoesTasks], [2, 8, 4, "서연", true]);
      assertEquals(r.members.map((m: any) => [m.nickname, m.role, m.status]), [["서연", "leader", "active"], ["도현", "member", "active"]]);
      assertEquals(r.tags.map((t: any) => t.label), ["영어", "토익"]);
      assertEquals([r.currentRound, r.rounds, r.myProgress, r.invite, r.pendingCount], [null, [], null, null, 0]);
      assertEquals(r.stats, { roundCount: 0, leafCount: 0, commonCount: 0, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [] });
    },
  },
  {
    name: "room_get: anon sees public rooms with me null; private/DRAFT/missing → ROOM_NOT_FOUND",
    run: async (q) => {
      await setToday(q, TODAY);
      await asAnon(q);
      const [{ r }] = await q(`select public.room_get($1) as r`, ["toeic"]);
      assertEquals([r.me, r.myProgress, r.invite, r.pendingCount], [null, null, null, 0]);
      await expectFail(q, `select public.room_get($1)`, ["spring"], "ROOM_NOT_FOUND");
      await expectFail(q, `select public.room_get($1)`, ["nope"], "ROOM_NOT_FOUND");
      const d = await createRoom(q, USERS.서연, { title: "Draft Hidden" });
      await asAnon(q);
      await expectFail(q, `select public.room_get($1)`, [d.slug], "ROOM_NOT_FOUND");
      await asUser(q, USERS.민수);
      await expectFail(q, `select public.room_get($1)`, [d.slug], "ROOM_NOT_FOUND");   // 비멤버 로그인도 DRAFT 는 못 본다
      await expectFail(q, `select public.room_get($1)`, ["spring"], "ROOM_NOT_FOUND"); // 비공개 비멤버
      await asUser(q, USERS.서연);
      assertEquals((await q(`select public.room_get($1) as r`, [d.slug]))[0].r.status, "draft");
    },
  },
  {
    name: "room_get: invite/pendingCount only for leader; my PENDING row visible only to me",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.가은);
      const [{ a }] = await q(`select public.room_get($1) as a`, ["sqld"]);
      assertEquals([a.me, a.pendingCount, a.invite], [{ state: "leader" }, 1, { url: "/invite/seed-sqld" }]);
      assertEquals(a.members.map((m: any) => m.nickname), ["가은"]);                 // 타인의 PENDING 은 members 에 없음
      await asUser(q, USERS.철수);
      const [{ b }] = await q(`select public.room_get($1) as b`, ["sqld"]);
      assertEquals([b.me, b.pendingCount, b.invite], [{ state: "pending" }, 0, null]);
      assertEquals(b.members.map((m: any) => [m.nickname, m.status]), [["가은", "active"], ["철수", "pending"]]);
      await asUser(q, USERS.서연);
      assertEquals((await q(`select public.room_get($1) as c`, ["sqld"]))[0].c.members.map((m: any) => m.nickname), ["가은"]);
    },
  },
  {
    name: "room_get: aws with tree — currentRound 2주차 tasks/people, rounds 5/8·1/3·0/4, stats, myProgress 2/4 next EC2, 도윤 inactive listed",
    run: async (q) => {
      await setToday(q, TODAY);
      const t = await seedAwsTree(q);
      await asUser(q, USERS.철수);
      const [{ r }] = await q(`select public.room_get($1) as r`, ["aws"]);
      assertEquals(r.members.map((m: any) => [m.nickname, m.status]),
        [["민수", "active"], ["지은", "active"], ["철수", "active"], ["하나", "active"], ["도윤", "inactive"]]);
      assertEquals(r.rounds.map((x: any) => [x.label, x.leafCount, x.assigned, x.submitted, x.pct]),
        [["1주차", 2, 8, 5, 63], ["2주차", 2, 3, 1, 33], ["3주차", 1, 4, 0, 0]]);
      assertEquals([r.currentRound.id, r.currentRound.label, r.currentRound.title, r.currentRound.startDate, r.currentRound.endDate], [t.rounds[1], "2주차", "EC2·S3", "2026-10-08", "2026-10-14"]);
      assertEquals(r.currentRound.tasks.map((x: any) => [x.id, x.title, x.type, x.startDate, x.endDate, x.people.map((p: any) => `${p.nickname}:${p.status}`).sort()]), [
        [t.ec2, "EC2 인스턴스 유형 정리", "designated", "2026-10-08", "2026-10-14", ["지은:done", "철수:open"]],
        [t.s3, "S3 스토리지 클래스 발표자료", "designated", "2026-10-10", "2026-10-14", ["하나:open"]],
      ]);   // people 은 assigned_at·id 순 — 같은 resync 로 생긴 행은 순서가 고정되지 않아 정렬해서 비교
      assertEquals(r.stats, { roundCount: 3, leafCount: 5, commonCount: 3, designatedCount: 2, totalAssignments: 15, totalSubmissions: 6, overallPct: 40, unassignedCount: 0, startWeekdays: [4] });
      assertEquals(r.myProgress, { submitted: 2, assigned: 4, nextDue: { nodeId: t.ec2, title: "EC2 인스턴스 유형 정리", roundLabel: "2주차", dueDate: "2026-10-14" } });
      // 1주차 사람별 코드: 지은 late, 하나 missed (10/12 > 10/07)
      await setToday(q, "2026-10-05");                                           // 1주차 안에서 보면 current 가 1주차
      const [{ r2 }] = await q(`select public.room_get($1) as r2`, ["aws"]);
      assertEquals(r2.currentRound.label, "1주차");
      assertEquals(r2.currentRound.tasks[0].people.map((p: any) => `${p.nickname}:${p.status}`).sort(), ["민수:done", "지은:late", "철수:done", "하나:open"].sort());
      // 회차 사이 공백이면 직전 회차, 시작 전이면 null
      await setToday(q, "2026-09-30");
      assertEquals((await q(`select public.room_get($1) as r3`, ["aws"]))[0].r3.currentRound, null);
      // 비로그인은 집계는 보되 myProgress 없음
      await setToday(q, TODAY);
      await asAnon(q);
      const [{ an }] = await q(`select public.room_get($1) as an`, ["aws"]);
      assertEquals([an.me, an.myProgress, an.rounds.length, an.currentRound.tasks.length], [null, null, 3, 2]);
    },
  },
  {
    name: "room_get: archived room readable by leader/members only; invite token opens private room; rotated token → ROOM_NOT_FOUND",
    run: async (q) => {
      await setToday(q, TODAY);
      await asUser(q, USERS.민수);
      await q(`select public.room_archive('aws')`);
      assertEquals((await q(`select public.room_get('aws') as r`))[0].r.archived, true);
      await asUser(q, USERS.철수);
      assertEquals((await q(`select public.room_get('aws') as r`))[0].r.archived, true);
      await asUser(q, USERS.서연);
      await expectFail(q, `select public.room_get('aws')`, [], "ROOM_NOT_FOUND");
      await asAnon(q);
      await expectFail(q, `select public.room_get('aws')`, [], "ROOM_NOT_FOUND");
      await expectFail(q, `select public.room_get('aws', 'seed-aws')`, [], "ROOM_NOT_FOUND");   // 토큰도 보관 방은 못 연다
      // 비공개 spring: 토큰으로 비멤버·비로그인 읽기
      const [{ r }] = await q(`select public.room_get('spring', 'seed-spring') as r`);
      assertEquals([r.slug, r.me], ["spring", null]);
      await asUser(q, USERS.서연);
      assertEquals((await q(`select public.room_get('spring', 'seed-spring') as r`))[0].r.me, { state: "none" });
      await asUser(q, USERS.지훈);
      await q(`select public.invite_rotate('spring')`);
      await asUser(q, USERS.서연);
      await expectFail(q, `select public.room_get('spring', 'seed-spring')`, [], "ROOM_NOT_FOUND");
    },
  },
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm run test:db -- --filter "rooms: room_get"`
Expected: 5 FAIL — `function public.room_get(text) does not exist`.

- [ ] **Step 3: 0004 에 `room_get` 추가**

`supabase/migrations/0004_rooms.sql` 끝에 추가:

```sql
-- ───────── room_get (03-api §2 RoomDetail) — 공개 범위는 room_readable 이 판정, 아니면 ROOM_NOT_FOUND (D7) ─────────
create or replace function public.room_get(p_slug text, p_invite_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); v_id bigint;
begin
  select id into v_id from public.rooms where slug = p_slug;
  if v_id is null or not public.room_readable(v_id, v_uid, p_invite_token) then
    perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요');
  end if;
  return public.room_detail_json(v_id, v_uid);
end $$;
```

`room_detail_json` 이 그룹장에게 `invite_ensure` 로 토큰을 **만들 수 있으므로**(쓰기) `room_get` 은 `stable` 로 선언하지 않는다. PostgREST 는 volatile 함수도 `POST /rpc` 로 호출하므로 어댑터에는 영향 없다.

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm run test:db`
Expected: `rooms: room_get` 5 PASS, 전체 녹색. `startWeekdays: [4]` 는 2026-10-01·10-08·10-15 가 전부 목요일(isodow 4)이라는 뜻. 1주차 `pct 63` 은 `pct(8,5)` 의 half-up.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0004_rooms.sql supabase/tests/_cases-rooms.ts
git commit -m "feat(db): room_get with visibility/invite-token gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

### Task 8: 로컬 Supabase — 정원 race · RLS 스모크 · RPC 에러 전달 (`rooms-db.test.ts`)

**Files:**
- Create: `supabase/tests/rooms-db.test.ts`

**Interfaces:**
- Consumes: 플랜 01 `_testenv.ts`(`dbTest`, `anon`, `service`, `userClient`, `RUN`), `me_update`(온보딩), 이 플랜의 `room_create`, `room_open_recruit`, `room_join`, `room_delete`, `room_get`, `rooms_list`, 0003 `rooms` SELECT 정책(`can_read_room`).
- Produces: 없음(검증만). Review Focus 1 의 소유 테스트.

- [ ] **Step 1: 테스트 작성**

`supabase/tests/rooms-db.test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import type { SupabaseClient } from "supabase-js";
import { anon, dbTest, RUN, service, userClient } from "./_testenv.ts";

// 실제 Postgres + PostgREST 에서만 보이는 것: 두 연결의 정원 race, RLS 차단, 에러 전달 형식.
// 시드 행은 읽기만. 쓰기는 이 테스트가 만든 방(제목에 RUN) 과 테스트 사용자 자신의 행뿐.

/** 테스트 사용자 n 을 온보딩(닉네임)까지 마친 클라이언트 */
async function member(n: number): Promise<{ id: string; c: SupabaseClient }> {
  const { u, c } = await userClient(n);
  const { error } = await c.rpc("me_update", { p_nickname: `u${n}${RUN}` });
  if (error) throw new Error("me_update " + error.message);
  return { id: u.id, c };
}

async function rpc<T = unknown>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

dbTest("capacity race: 5/6 room, two concurrent joins → exactly one ROOM_FULL, member_count 6", async () => {
  const leader = await member(1);
  const room = await rpc<{ id: string; slug: string }>(leader.c, "room_create", {
    p_title: `race ${RUN}`, p_intro: "동시성", p_start_date: "2026-12-01", p_end_date: "2026-12-28",
    p_max_members: 6, p_is_public: true, p_join_mode: "direct",
  });
  try {
    // 리프 1개 (node_create 는 플랜 03) — service_role 로 직접 INSERT
    const admin = service();
    const { data: round, error: e1 } = await admin.from("goal_nodes")
      .insert({ room_id: Number(room.id), parent_id: null, depth: 2, sort_order: 0, label: "1주차", title: "회차", start_date: "2026-12-01", end_date: "2026-12-07" })
      .select("id").single();
    if (e1) throw new Error(e1.message);
    await admin.from("goal_nodes").update({ round_id: round!.id }).eq("id", round!.id);
    const { error: e2 } = await admin.from("goal_nodes")
      .insert({ room_id: Number(room.id), parent_id: round!.id, round_id: round!.id, depth: 3, sort_order: 0, title: "과제", start_date: "2026-12-01", end_date: "2026-12-07", task_type: "COMMON" });
    if (e2) throw new Error(e2.message);
    await rpc(leader.c, "room_open_recruit", { p_slug: room.slug });

    for (const n of [2, 3, 4, 5]) await rpc((await member(n)).c, "room_join", { p_slug: room.slug });   // 5/6
    const a = await member(6), b = await member(7);
    const results = await Promise.all([
      a.c.rpc("room_join", { p_slug: room.slug }),
      b.c.rpc("room_join", { p_slug: room.slug }),
    ]);
    const codes = results.map((r) => r.error?.message ?? "OK").sort();
    assertEquals(codes, ["OK", "ROOM_FULL"]);
    const { data: row } = await admin.from("rooms").select("member_count, max_members").eq("id", Number(room.id)).single();
    assertEquals([row!.member_count, row!.max_members], [6, 6]);
    const { count } = await admin.from("room_members").select("*", { count: "exact", head: true }).eq("room_id", Number(room.id)).eq("status", "ACTIVE");
    assertEquals(count, 6);
  } finally {
    await leader.c.rpc("room_delete", { p_slug: room.slug });   // RECRUIT 이므로 하드 삭제(cascade)
  }
});

dbTest("RLS: anon cannot see private room via from('rooms'), sees public room", async () => {
  const a = anon();
  const { data: priv, error: e1 } = await a.from("rooms").select("slug").eq("slug", "spring");
  assertEquals(e1, null);
  assertEquals(priv, []);
  const { data: pub, error: e2 } = await a.from("rooms").select("slug").eq("slug", "aws");
  assertEquals(e2, null);
  assertEquals(pub, [{ slug: "aws" }]);
  // 로그인했지만 비멤버도 비공개 방은 못 본다
  const u = await member(8);
  const { data: priv2 } = await u.c.from("rooms").select("slug").eq("slug", "spring");
  assertEquals(priv2, []);
});

dbTest("rpc error mapping: message = code, details = Korean, hint = json", async () => {
  const a = anon();
  const r1 = await a.rpc("room_get", { p_slug: "spring" });
  assertEquals(r1.error?.message, "ROOM_NOT_FOUND");
  assertEquals(r1.error?.details, "방을 찾을 수 없어요");
  const r2 = await a.rpc("room_join", { p_slug: "toeic" });
  assertEquals(r2.error?.message, "AUTH_REQUIRED");
  const u = await member(8);
  const r3 = await u.c.rpc("room_apply", { p_slug: "jcg" });
  assertEquals(r3.error?.message, "ROOM_FULL");
  assertEquals(JSON.parse(r3.error!.hint!), { field: "maxMembers" });
  // 내부 함수는 RPC 로 보이지 않는다
  const r4 = await u.c.rpc("assignment_resync", { p_room: 6 });
  assert(r4.error !== null, "assignment_resync must not be callable through PostgREST");
});

dbTest("rooms_list/room_get through PostgREST for anon: 8 public rooms, aws detail", async () => {
  const a = anon();
  const list = await rpc<{ items: { slug: string }[]; tabCounts: Record<string, number> }>(a, "rooms_list", { p_scope: "public" });
  assertEquals(list.items.length, 8);
  assertEquals(list.tabCounts, { public: 8, mine: 0, created: 0 });
  const d = await rpc<{ slug: string; me: unknown; memberCount: number }>(a, "room_get", { p_slug: "aws" });
  assertEquals([d.slug, d.me, d.memberCount], ["aws", null, 4]);
});
```

- [ ] **Step 2: 환경 없이 실행 — ignore 확인**

Run: `npm run test:db -- --filter "db:"`
Expected: `db: …` 4 ignored (환경변수 없음), 실패 0.

- [ ] **Step 3: 로컬 Supabase 띄우고 실행**

```bash
vm_stat | grep -E 'free|compressor'
supabase start
npm run db:reset
eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
npm run test:db -- --filter "db:"
```
Expected: reset 로그에 `0004_rooms.sql`, `0005_membership.sql` 적용 + 시드. `db:` 4 PASS(플랜 01 의 6 포함 10). race 사례는 `["OK","ROOM_FULL"]` — 두 번 돌려도 같다(방을 매번 새로 만들고 지운다). `assignment_resync` RPC 는 `permission denied for function` 또는 404 — 둘 다 "에러" 로 통과.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/rooms-db.test.ts
git commit -m "test(db): rooms capacity race, RLS smoke, rpc error mapping on local supabase

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx"
```

---

## Phase 종료 게이트

- [ ] `npm run test:db` 전부 통과 — PGlite: 플랜 01 39 + `rooms:` 21(Task 1 3 · Task 2 6 · Task 3 1 · Task 4 6 · Task 7 5 — Task 2 의 "room_archive/unarchive/delete" 는 Task 3 뒤, `room_start`·`room_update 잠금` 은 Task 5 뒤에 녹색) + `membership:` 7. `SUPABASE_URL` 등이 있으면 `db:` 10.
- [ ] `supabase db reset` 이 0001→0002→0003→0004→0005→seed 순으로 깨끗이 적용되고, Studio 에서 `rooms` 9행·`room_members` 33행·`tags` 19행·`room_invites` 9행이 보인다.
- [ ] `npm run db:types` 로 `database.types.ts` 재생성 → `rooms_list`, `room_get`, `room_join` 등 RPC 가 `Functions` 에 잡힌다(플랜 05 어댑터가 쓴다).
- [ ] 다음 계획(`…-03-curriculum-progress.md`)에 넘기는 것:
  - 노드 쓰기 함수는 `room_lock(p_slug)` → 편집 가능 상태(DRAFT·RECRUIT·ACTIVE ∧ 보관 아님) 검사 → 끝에 `assignment_resync(room_id)`. `seedLeaves`(테스트 헬퍼)가 직접 INSERT 하던 자리를 `node_create` 로 바꾸되 사례의 기대값은 유지.
  - `room_round_stats(p_room)` 와 `room_leaf_stats(p_room)` 는 시그니처 고정, 본문은 0006 에서 `create or replace` 가능. `room_detail_json` 의 rounds/stats 를 바꾸고 싶으면 같은 시그니처로 교체.
  - 시드 §3(트리·배정·제출)은 §2 뒤에 붙이고 마지막에 `select assignment_resync(id) from rooms` 를 다시 호출. aws 회귀값(24%, 1주차 5/8, 철수 2/4, 다음 마감 EC2 10/14)은 `seedAwsTree` 가 쓰는 제목·날짜와 같아야 한다 — 플랜 03 시드가 들어오면 `seedAwsTree` 호출 사례 둘(Task 4 progress, Task 7 aws)은 헬퍼 호출을 빼고 시드 값으로 단언한다(그때 rounds 가 3→5·13 개로 늘어난다는 점만 반영).
  - 플랜 04: `0009_tags.sql` 의 태그 slug 19개는 Task 3 시드와 같아야 하며 둘 다 `on conflict (slug) do nothing`. `notify_publish` 는 0004 의 자리표와 **같은 시그니처**로 `create or replace`. `member_deactivate` 는 `room_lock` → INACTIVE 전환 → `room_release_seat` → `assignment_resync` → `membership_result` 순서로 Task 5 함수들과 같은 꼴.

## Self-Review 메모

- 스펙 커버리지: 03-api §2 `rooms_list`(Task 4)·`room_create`(Task 1)·`room_get`(Task 7)·`room_update`·`room_open_recruit`·`room_start`·`room_archive`/`unarchive`·`room_delete`(Task 2); §3 `room_join`·`room_apply`·`room_leave`·`room_cancel_application`·`room_applications`·`room_approve`·`room_reject`·`room_members_get`(Task 5), `invite_get`·`invite_rotate`·`invite_preview`·`invite_join`(Task 6). `member_deactivate_preview`/`member_deactivate` 는 플랜 04(개요 분담). 02 §3 I7(Task 1 seat 함수 + Task 8 race)·I8(모든 멤버십 함수 끝 resync)·I10(`invite_ensure` + partial unique)·I11(`room_update` slug 잠금); §4.3(Task 4 CTE); §6 방·멤버십·초대 행 전부; §7 `room_tick`(Task 2, 등록은 플랜 04 0010); §8 rooms/room_members/tags/room_tags/invites/settings 시드(Task 3). D2·D3·D4·D11·D13 반영. main §3-6/3-7/3-8/3-9 → Task 4. roomview §2.0 결정 순서는 `me.state` + 프론트 `actionOf`(플랜 05).
- 플레이스홀더 점검: 없음. 모든 단계에 코드·실행 명령·기대값이 있다.
- 이름 일치: `room_leaf_stats`·`room_round_stats`·`room_current_round_id`·`room_in_scope`·`room_matches`·`room_detail_json`·`room_me_json`·`room_members_json`·`invite_ensure`·`invite_check`·`invite_resolve`·`room_join_precheck`·`room_decide_precheck`·`membership_result`·`room_take_seat`/`room_release_seat` — 선언과 호출이 같다. 시그니처는 개요 공통 계약 및 플랜 04 의 가정(`room_apply(p_slug, p_invite_token)`, `room_approve(p_slug, p_user)`)과 일치. 테스트 헬퍼 `USERS`·`TODAY`·`expectFail(q, sql, params, code)`·`createRoom`·`seedLeaves`·`seedAwsTree`·`listRooms`·`openRoom` 은 `_cases-rooms.ts`/`_cases-membership.ts` 에 정의되고 그 이름으로만 쓰인다.
- 하네스 정합성: Task 1·2 본문이 처음에 가정했던 `withCase(name, fn)`/`_seed-users.ts`/`asUser(q, null)` 는 플랜 01 의 실제 export(`withCase(db, fn)` + `sqlTest`, `asAnon`)에 맞춰 고쳤고, `USERS` 는 플랜 01 Task 8 의 seed_users 번호를 그대로 쓴다(철수 01 … 승호 29). `openDb()` 는 마이그레이션을 자동 탐색하므로 등록 단계가 없다.
- Review Focus 5건: 1→Task 8(race), 2→Task 5(approval 표: 같은 행·applied_at 갱신), 3→Task 4(보관 사례)+Task 7(보관 읽기), 4→Task 2(tick 사례), 5→Task 6(rotate 뒤 preview/join)+Task 7(rotate 뒤 room_get).
- 의도적 미포함: `room_get` 의 커버 이미지 URL(파일은 플랜 04 Storage 뒤 `coverUrl` 로 확장), 태그 facet 의 한국어 collation 정렬(`label` 기본 정렬 — 프론트가 `localeCompare('ko')` 로 최종 정렬), `rooms_list` 의 `popular` 정렬(스펙 미정).
