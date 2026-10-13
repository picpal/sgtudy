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
| `…-05-frontend-integration.md` | Phase 7 어댑터로 목업 교체·로그인/온보딩/초대/프로필 라우트·알림 드롭다운·E2E | 04 |

Phase 순서대로 실행. 각 Phase 끝에 `deno test supabase/tests` + `supabase db reset`(로컬) 통과 + 커밋.

## Global Constraints

- 디렉터리: `supabase/{config.toml, migrations/, seed.sql, tests/, functions/}`, `src/lib/supabase/{server,client,admin,middleware}.ts`, `src/lib/api/{errors,rooms,room-view,my-study,schedule,me,notifications}.ts`, `src/lib/supabase/database.types.ts`(generated).
- 마이그레이션 `supabase/migrations/0001_schema.sql`, `0002_functions_core.sql`, `0003_rls.sql`, `0004_rooms.sql`, `0005_membership.sql`, `0006_curriculum.sql`, `0007_submissions.sql`, `0008_notifications.sql`, `0009_tags.sql`, `0010_cron.sql`. 배포된 파일은 수정하지 않는다.
- 모든 쓰기 함수: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''`, 테이블은 `public.` 한정, 사용자는 `public.current_user_id()`. 비로그인 호출은 `AUTH_REQUIRED`, 온보딩 전은 `ONBOARDING_REQUIRED`.
- 에러는 `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='<CODE>', DETAIL='<한국어 문구>', HINT='<json details>'`. `<CODE>` 는 `03-api.md` §0 목록에만.
- "오늘"은 `public.kst_today()` 만 사용(`current_date` 직접 사용 금지). 테스트는 `select set_config('app.today','2026-10-12',true)` 로 고정.
- JSON 키 camelCase, 숫자 id 는 `::text` 로 문자열, 날짜 `to_char(d,'YYYY-MM-DD')`, 시각 `to_char(ts at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.
- 테스트: `supabase/tests/_pglite-stubs.ts`(auth.users·cron 스텁), `_cases-*.ts`(공유 사례) → `*-sql.test.ts`(PGlite) / `*-db.test.ts`(로컬 supabase, `SUPABASE_URL` 있을 때만). 사례마다 `begin … rollback`. 조건 없는 delete·truncate 금지.
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
```

```ts
// src/lib/supabase/server.ts  — asklyy 그대로 (createServerClient + cookies())
// src/lib/supabase/client.ts  — createBrowserClient
// src/lib/supabase/middleware.ts — updateSession(request): 세션 갱신 + 보호 라우트 → /login?returnTo=
// src/lib/api/errors.ts
export type ApiError = { code: string; message: string; details?: Record<string, string> };
export function toApiError(e: unknown): ApiError;             // PostgrestError → {code: message, message: details, details: JSON.parse(hint)}
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T>;  // supabase.rpc 래퍼, 실패 시 ApiError throw
```

## Review Focus

스펙이 암시하지만 어느 태스크의 테스트도 자연히 다루지 않을 입력 5가지. 각 항목은 소유 Phase 의 태스크에 테스트로 박는다.

1. **정원 race** — 5/6 방에 두 세션이 동시에 `room_join` 하면 정확히 한 명만 ACTIVE, 다른 한 명은 `ROOM_FULL`, `member_count=6`. PGlite 는 단일 연결이라 로컬 supabase `*-db.test.ts` 에서 `Promise.all` 로 검증. (Phase 2)
2. **자정 경계 지각 판정** — 마감 10/03 과제를 KST 10/04 00:00:30(= UTC 10/03 15:00:30) 에 제출하면 `is_late=true`. (Phase 4, `task_code`/`submission_upsert` 사례)
3. **이탈자 분모** — 공통 과제 제출자 도윤을 이탈 처리하면 회차 집계가 5/8 이 되고 도윤의 제출물은 그룹장이 계속 조회. INACTIVE→재참가 거부. (Phase 5 deactivate + Phase 3 resync)
4. **제출물 있는 리프 구조 변경** — 하위 추가 / 지정→공통 / 삭제 / 해당 담당자 제거 네 가지 모두 `NODE_HAS_SUBMISSIONS`·`ASSIGNEE_HAS_SUBMISSION`, 보관은 허용되고 집계에서 빠진다. (Phase 3)
5. **cron 재실행·누락** — `room_tick()` 이 이틀 안 돌다가 돌면 start_date 지난 RECRUIT 전부 ACTIVE, 바로 다시 돌려도 알림이 중복되지 않는다(`dedupe_key`). (Phase 2 tick + Phase 5 notify)
