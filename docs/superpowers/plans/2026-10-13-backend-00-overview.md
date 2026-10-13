# 슥터디 백엔드(Supabase) Implementation Plan — 00 개요 · 공통 계약

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목업 데이터로 완성된 Next.js 프론트(4화면)를 그대로 살린 채, 디자인 프롬프트의 도메인 규칙 전체를 Supabase(Postgres 함수·RLS·Auth·Storage·pg_cron)로 구현하고 프론트를 실데이터에 연결한다.

**Architecture:** 비즈니스 규칙은 전부 Postgres 함수(`SECURITY DEFINER`, `p_` 인자, JSON 반환)에 두고 테이블 직접 쓰기는 RLS 로 막는다. 읽기 집계도 함수가 화면 DTO 와 1:1 인 JSON 을 돌려준다. 프론트는 `@supabase/ssr` 세션 + `src/lib/api/*.ts` 어댑터로 `src/data/*.ts` 의 export 시그니처를 유지한 채 목업을 교체한다. 테스트는 PGlite+Deno(SQL 함수, 롤백 격리)와 로컬 Supabase(RLS·Storage·Auth) 두 층.

**Tech Stack:** Supabase CLI(로컬 `supabase start`, Postgres 15), pg_cron, Supabase Auth(이메일 OTP), Storage, `@supabase/ssr` 0.5 + `supabase-js` 2, Deno + `@electric-sql/pglite` 0.3(테스트), Next.js 16(기존), Vitest(어댑터).

**Spec:** `docs/claude-design-prompt.md`(도메인), `docs/backend/01-decisions.md`(결정), `docs/backend/02-domain-and-schema.md`(스키마·불변식·RLS·함수 목록·cron·시드), `docs/backend/03-api.md`(RPC 계약·DTO·에러 코드), `docs/backend/analysis/*.md`(화면별 근거). 실행자는 이 5종을 함께 연다. 관례 참고: `~/Desktop/workspace/assistant/supabase/`(마이그레이션·PGlite 테스트), `~/Desktop/workspace/asklyy/lib/supabase/`(SSR 클라이언트).

## 계획 파일 구성

| 파일 | 범위 | 선행 |
|---|---|---|
| `…-00-overview.md` (이 문서) | 공통 계약·디렉터리·전역 제약·Review Focus | — |
| `…-01-foundation-auth.md` | Phase 0 Supabase 초기화·테스트 하네스·SSR 클라이언트·미들웨어 + Phase 1 스키마(0001)·profiles·RLS 헬퍼·`me_*`·시드 사용자 | 00 |
| `…-02-rooms-membership.md` | Phase 2 방 생성/수정/상태 함수·`rooms_list`·`room_get`·멤버십 상태 머신·초대·`room_tick` cron | 01 |
| `…-03-curriculum-progress.md` | Phase 3 노드 CRUD·불변식·`assignment_resync`·`task_code`·`curriculum_get`·`me_studies`·`me_schedule`·시드 트리 | 02 |
| `…-04-submission-notification-tags.md` | Phase 4 제출·Storage, Phase 5 알림·설정·이탈 처리·cron 잡, Phase 6 태그 | 03 |
| `…-05-frontend-integration.md` | Phase 7a 어댑터로 목업 교체·로그인/온보딩/초대/프로필 라우트·알림 드롭다운·E2E | 04 |
| `…-06-leader-and-submission-ui.md` (**작성 예정**) | Phase 7b 디자인 §4.10 과제 상세·제출(마크다운·링크·파일 업로드) 화면, §4.4 그룹장 사이드 패널(승인 대기 승인/거절·초대 링크 복사), 모집 시작·지금 시작 버튼, §2.6 태그 수동 편집, §4.6 들여쓰기/내어쓰기(`node_move`), §5 공통 상태(`loading.tsx`·`error.tsx`·`not-found.tsx`·권한 없음) | 05 |

Phase 순서대로 실행. 각 Phase 끝에 `npm run test:db`(= `deno test --config supabase/tests/deno.json …`) + `supabase db reset`(로컬) 통과 + 커밋. plan 05 까지 끝나도 "백엔드 전체 종료"가 아니라 **Phase 7a 종료**다 — 과제 제출 UI·그룹장 운영 UI 는 plan 06.

## Global Constraints

- 디렉터리: `supabase/{config.toml, migrations/, seed.sql, tests/, functions/}`, `src/lib/supabase/{server,client,admin,middleware}.ts`, `src/lib/api/{errors,rooms,room-view,my-study,schedule,me,notifications}.ts`, `src/lib/supabase/database.types.ts`(generated).
- 마이그레이션 `supabase/migrations/0001_schema.sql`, `0002_functions_core.sql`, `0003_rls.sql`, `0004_rooms.sql`, `0005_membership.sql`, `0006_curriculum.sql`, `0007_submissions.sql`, `0008_notifications.sql`, `0009_tags.sql`, `0010_cron.sql`. 배포된 파일은 수정하지 않는다.
- 모든 쓰기 함수와 **anon/authenticated 에 GRANT 하는 모든 공개 RPC(읽기 포함)**: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`(INVOKER 함수는 GRANT 되지 않은 내부 헬퍼를 부를 수 없다 — 구현 중 확인 2026-10-13: `meta_get` 이 INVOKER 라 anon 에서 `permission denied for function kst_today`). 각 Phase 의 권한 테스트는 `has_function_privilege` 단언에 더해 `set local role anon|authenticated` 로 공개 RPC 를 **실제 실행**한다, 테이블은 `public.` 한정, 사용자는 `public.current_user_id()`. 비로그인 호출은 `AUTH_REQUIRED`(`to anon, authenticated` 함수는 본문에서; `to authenticated` 함수는 PostgREST 42501 → 프론트 `toApiError` 가 매핑), 온보딩 전은 `ONBOARDING_REQUIRED`.
- **함수 권한(D7)**: `0002` 첫머리에 `ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`(전역 — `IN SCHEMA public` 한정으로는 PUBLIC 기본 EXECUTE 를 못 걷어낸다, 구현 중 확인 2026-10-13) + `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;`. 그 뒤 모든 함수는 기본 비공개이며, `03-api.md` 의 RPC 열에 있는 **공개 함수만** `GRANT EXECUTE ON FUNCTION … TO anon, authenticated`(비로그인 허용 함수) 또는 `TO authenticated`. 내부 헬퍼(uid/room_id 를 받는 `*_json`, `room_transition_*`, `assignment_resync`, `notify_publish`, `job_*`, `room_tick`, `room_lock/take_seat/release_seat`, `me_schedule_leaves` 등)는 GRANT 하지 않는다. 각 Phase 테스트에 `has_function_privilege('anon', 'public.<fn>(<args>)', 'execute') = false` 단언을 넣는다.
- **뷰·테이블 쓰기 권한(D7, 구현 리뷰 2026-10-13)**: 모든 뷰는 `revoke all on <view> from anon, authenticated, public; grant select on <view> to anon, authenticated;`(Supabase 기본 GRANT 로 자동 갱신 가능 뷰가 RLS 를 우회한다). 0002 에 `alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;`. RLS 정책용 헬퍼는 호출자 uid 를 인자로 받지 않는 1인자 형(`is_my_task(p_node)`)만 GRANT 한다.
- 로그인 전용 RPC(`to authenticated`)를 anon 이 부르면 PostgREST 42501 — `*-db.test.ts` 는 `error.code === '42501'` 을 단언하고, `AUTH_REQUIRED` 매핑은 프론트 `toApiError` 몫(plan 05).
- `current_user_id()` 는 운영에서 `auth.uid()` 만 반환한다. 테스트용 `app.uid` 는 **PGlite 스텁의 `auth.uid()`** 가 읽는다(함수 본문에 GUC 폴백을 넣지 않는다).
- 고정 기준일: `seed.sql` 마지막 줄 `alter database postgres set app.today = '2026-10-12';`(로컬·테스트 전용, 02 §8). PGlite 사례는 `setToday()`.
- `job_cleanup` 은 Storage **객체**를 SQL 로 지우지 않는다(`storage.objects` 직접 DELETE 금지). `files.status='DELETED'` 로만 표시하고 실제 객체 삭제는 2단계 Edge Function 몫.
- Storage 객체 키는 `attachments/{room_id}/{node_id}/{user_id}/{uuid}.{ext}` — 원본 파일명은 키에 넣지 않는다(비ASCII 키 거부). 원본명은 `files.original_name`.
- 에러는 `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='<CODE>', DETAIL='<한국어 문구>', HINT='<json details>'`. `<CODE>` 는 `03-api.md` §0 목록에만.
- "오늘"은 `public.kst_today()` 만 사용(`current_date` 직접 사용 금지). 테스트는 `select set_config('app.today','2026-10-12',true)` 로 고정.
- JSON 키 camelCase, 숫자 id 는 `::text` 로 문자열, 날짜 `to_char(d,'YYYY-MM-DD')`, 시각 `to_char(ts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.
- 테스트: **하네스는 plan 01 의 `supabase/tests/_harness.ts` 하나**(`openDb`(citext·pg_trgm 확장 로드 + pg_cron 문장 제거)·`applySeed`·`makeQ`·`withCase(db, fn)`·`sqlTest`·`asUser(q, uid)`·`asAnon(q)`·`setToday(q, ymd)`·`newUser`·`expectFail(promise, code)`) 와 `_pglite-stubs.ts`(auth.users·auth.uid()/role()·cron·storage 스텁), `_testenv.ts`(로컬 supabase: `hasEnv`·`service`·`anon`·`testUser`·`userClient`·`dbTest`). 다른 플랜은 하네스를 **재정의하지 않고 import** 한다. `_cases-*.ts`(공유 사례) → `*-sql.test.ts`(PGlite) / `*-db.test.ts`(로컬 supabase, `SUPABASE_URL` 있을 때만). 실행은 항상 `npm run test:db`(`--config supabase/tests/deno.json` 포함). 사례마다 `begin … rollback`. 조건 없는 delete·truncate 금지.
- 이 기계는 메모리가 빠듯하다. `supabase start` 전 `vm_stat | grep -E 'free|compressor'` 확인, `npm run build` 와 동시에 돌리지 않는다. PGlite 테스트는 Docker 불필요.
- 커밋 메시지 `feat(db): …` / `feat(web): …` / `test(db): …`, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 과 `Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx`.
- 프론트 수정 범위(Phase 7): `src/data/*.ts` 의 타입·export 이름 유지(값은 어댑터가 공급), `src/lib/routes.ts` 확장, 신규 라우트 `/login`, `/onboarding`, `/invite/[token]`, `/me`, 알림 드롭다운. 화면 컴포넌트는 데이터 소스만 바꾼다.
- `service_role` 키는 `.env.local`·시드 스크립트에만. Vercel 환경변수는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 만.

## 공통 계약 (모든 Phase 가 쓰는 이름 — 여기서 고정)

```sql
-- 0002_functions_core.sql
public.current_user_id() returns uuid               -- auth.uid(); PGlite 스텁에서는 set_config('app.uid') 를 읽음
public.require_user() returns uuid                  -- null 이면 AUTH_REQUIRED, nickname null 이면 ONBOARDING_REQUIRED
public.kst_today() returns date                     -- app.today 설정 우선, 없으면 (now() at time zone 'Asia/Seoul')::date
public.kst_deadline(p_end date) returns timestamptz -- (p_end + 1) 00:00 Asia/Seoul
public.fail(p_code text, p_detail text, p_hint jsonb default null)  -- RAISE EXCEPTION 래퍼
public.iso(p_ts timestamptz) returns text           -- UTC ISO 문자열
public.task_code(p_s date, p_e date, p_first timestamptz, p_late boolean, p_today date) returns text  -- planned|open|done|late|missed
public.leaf_state(p_asg int, p_sub int, p_s date, p_e date, p_today date) returns text               -- unassigned|complete|planned|delayed|progress
public.pct(p_asg int, p_sub int) returns int        -- null if asg=0, round half-up
public.person_json(p_user uuid) returns jsonb       -- {userId, nickname, tone}
public.slugify(p_title text, p_id bigint) returns text

-- 0003_rls.sql 헬퍼 (STABLE SECURITY DEFINER)
public.is_room_member(p_room bigint) / is_room_leader / can_read_room / can_read_submissions / is_task_assignee(p_node bigint, p_user uuid)

-- 0005_membership.sql
public.assignment_resync(p_room bigint) returns void      -- D4 규칙, 멱등 (0006 에서 노드 생겨도 같은 함수)
public.membership_result(p_room bigint, p_user uuid) returns jsonb   -- MembershipResult DTO
public.room_transition_active(p_room bigint, p_actor uuid) / room_transition_ended(p_room bigint)

-- 0008_notifications.sql
public.notify_publish(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb) returns int
--   · p_actor 는 수신자에서 제외(호출자가 빼지 않아도 됨) · dedupe_key = p_dedupe_prefix || ':' || recipient · 0004 의 자리표(returns 0)와 같은 시그니처
--   · prefix 규칙(D8): 상태성 = 자연키(KIND:room:node:date), 행위성 = KIND:room:node: || txid_current()
```

```ts
// src/lib/supabase/server.ts  — asklyy 그대로 (createServerClient + cookies())
// src/lib/supabase/client.ts  — createBrowserClient
// src/lib/supabase/middleware.ts — updateSession(request): 세션 갱신 + 보호 라우트 → /login?returnTo=
// src/lib/api/errors.ts
export type ApiError = { code: string; message: string; details?: Record<string, string> };
export function toApiError(e: unknown): ApiError;             // PostgrestError → {code: message, message: details, details: JSON.parse(hint)}; PostgREST code 42501(로그인 전용 RPC 를 anon 이 호출) → {code:'AUTH_REQUIRED'} (D7 ruling 2026-10-13)
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T>;  // supabase.rpc 래퍼, 실패 시 ApiError throw
```

## Review Focus

스펙이 암시하지만 어느 태스크의 테스트도 자연히 다루지 않을 입력 5가지. 각 항목은 소유 Phase 의 태스크에 테스트로 박는다.

1. **정원 race** — 5/6 방에 두 세션이 동시에 `room_join` 하면 정확히 한 명만 ACTIVE, 다른 한 명은 `ROOM_FULL`, `member_count=6`. PGlite 는 단일 연결이라 로컬 supabase `*-db.test.ts` 에서 `Promise.all` 로 검증. (Phase 2)
2. **자정 경계 지각 판정** — 마감 10/03 과제를 KST 10/04 00:00:30(= UTC 10/03 15:00:30) 에 제출하면 `is_late=true`. (Phase 4, `task_code`/`submission_upsert` 사례)
3. **이탈자 분모** — 공통 과제 **제출자**(예: 철수, IAM done)를 이탈 처리하면 IAM 이 3/4 → 2/3 이 되고 철수의 제출물은 그룹장이 계속 조회. RECRUIT 방에서 INACTIVE 행을 만들어 `room_apply` 가 `MEMBER_NOT_ACTIVE` 를 내는 것까지 단언. (Phase 3 resync 사례 `제출자 released` + Phase 5 deactivate)
4. **제출물 있는 리프 구조 변경** — 하위 추가 / 지정→공통 / 삭제 / 해당 담당자 제거 네 가지 모두 `NODE_HAS_SUBMISSIONS`·`ASSIGNEE_HAS_SUBMISSION`, 보관은 허용되고 집계에서 빠진다. (Phase 3)
5. **cron 재실행·누락** — `room_tick()` 이 이틀 안 돌다가 돌면 start_date 지난 RECRUIT 전부 ACTIVE, 바로 다시 돌려도 알림이 중복되지 않는다(`dedupe_key`). (Phase 2 tick + Phase 5 notify)
