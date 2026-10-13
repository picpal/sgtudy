# 백엔드 설계 결정 (ADR 모음)

> 근거: `docs/claude-design-prompt.md`(도메인 규칙), `docs/backend/analysis/*.md`(화면별 요구 분석 5편).
> 분석 문서끼리 결론이 갈린 항목은 여기서 **하나로 확정**한다. 이후 문서(`02-domain-and-schema.md`, `03-api.md`, 구현 계획)는 전부 이 결정을 따른다.
> 2026-10-13 변경: 1단계 스택을 **Supabase** 로 확정(사용자 결정). 규모가 커지면 자체 서버로 이관(D15).

## D0. 스택 — Supabase 우선

| 항목 | 결정 | 이유 |
|---|---|---|
| 플랫폼 | **Supabase** (Postgres 15 + Auth + Storage + pg_cron + Edge Functions) | 지인 스터디 수십 명 규모. 운영·배포 0, 이메일 OTP·파일·스케줄이 기본 제공. 무료 티어로 시작 |
| 비즈니스 규칙 | **Postgres 함수(RPC) + 트리거 + RLS** | 정원 race·트리 불변식·배정 동기화·상태 전환은 전부 트랜잭션 안에서 끝나야 한다. 클라이언트 코드에 두면 우회·경합이 생긴다 |
| 읽기 집계 | SQL 함수가 **JSON 을 반환**(`returns jsonb`), 프론트 DTO 와 1:1 | 화면당 왕복 1회. PostgREST 테이블 select 는 단순 목록에만 |
| 인증 | Supabase Auth **이메일 OTP**(6자리, `signInWithOtp` + `verifyOtp`) | 디자인 §4.1 그대로. 세션은 `@supabase/ssr` 가 쿠키로 관리 |
| 파일 | Supabase Storage private 버킷 `attachments` + signed URL. 버킷 제한 10MB·MIME 화이트리스트 | 디자인 §2.3 제한을 버킷 설정으로 |
| 스케줄 | **pg_cron** (Asia/Seoul 로 환산한 UTC cron) → SQL 함수 호출 | 상태 전환·리마인더·요약·정리 전부 SQL 로 가능 |
| 메일(2단계) | Edge Function + `pg_net`/Resend. 1단계는 `mail_outbox` 테이블만 | OTP 메일은 Supabase Auth 가 보냄 |
| 태그 AI | Edge Function `suggest-tags`(선택) · 기본은 SQL 키워드 매칭 `tag_suggest_keyword()` | LLM 키·비용은 선택 사항 |
| 로컬 개발 | Supabase CLI(`supabase start`, Docker) + `supabase/migrations/*.sql` | 마이그레이션이 곧 스키마 출처. 이 기계는 메모리가 빠듯하므로 `supabase start` 전 `vm_stat` 확인, Next 빌드와 동시 실행 금지 |
| 테스트 | **PGlite + Deno**(`supabase/tests/*.test.ts`)로 SQL 함수·집계 회귀 — Docker 없이, 사례마다 트랜잭션 롤백. RLS·Storage·Auth 는 로컬 `supabase start` 또는 호스팅 DB 에 테스트 사용자로(`_testenv.ts` 패턴). 프론트 어댑터는 Vitest | `~/Desktop/workspace/assistant/supabase/tests/{_pglite-stubs,_testenv}.ts` 패턴 재사용. 목업 숫자(aws 24%, algo 87%)가 기대값 |
| 참고 프로젝트 | `assistant`(번호식 마이그레이션 `0001_*.sql`, `p_` 인자, `security definer set search_path = ''`, pg_cron, PGlite 테스트), `asklyy`(`lib/supabase/{server,client,admin}.ts` @supabase/ssr), `chuck`(Edge Function `_shared/auth.ts`, profiles 트리거) | 같은 사용자의 이전 결정을 그대로 따른다 |
| 타입 | `supabase gen types typescript` → `src/lib/supabase/database.types.ts` | RPC 시그니처가 TS 로 잡힘 |
| 위치 | 모노레포 `supabase/`(CLI 표준) + `src/lib/supabase/`, `src/lib/api/`(화면별 어댑터) | 한 PR 로 마이그레이션·어댑터 동시 변경 |

버린 안: Spring Boot 자체 서버(운영 비용·배포 호스트 필요, 이 규모엔 과함). Next.js Route Handlers + Prisma(Vercel 함수에서 트랜잭션·cron 제약, 결국 DB 가 따로 필요).

## D1. 식별자

- 사용자 id = `auth.users.id`(UUID). 그 외 테이블 PK 는 `BIGINT GENERATED ALWAYS AS IDENTITY`. 프론트에서는 전부 문자열로 취급(`supabase-js` 가 bigint 를 number 로 주므로 어댑터에서 `String()`).
- `rooms.slug`(`VARCHAR(60) UNIQUE`) 를 **공개 식별자**로 쓴다. URL(`/rooms/{slug}`, `/my-study/{slug}`), RPC 인자, 알림 link 전부 slug. 생성 시 제목 slugify(한글만이면 `r-{base36(id)}`) + 충돌 시 `-2`.
- 프론트 목업 id(`aws`, `toeic`…)는 시드 slug 로 그대로 → 현재 `routes.*` 호출부 무수정.
- 노드 id 는 숫자. 보드 회차 필터의 `"0.1".split(".")` 은 DTO `roundId` 로 대체.

## D2. 방 상태

```
DRAFT ──(모집 시작, 말단 과제 ≥1)──▶ RECRUIT ──(start_date 00:00 KST 자동 | 지금 시작)──▶ ACTIVE ──(end_date 다음날 00:00)──▶ ENDED
                                                                                      └─ archived_at (ACTIVE/ENDED 에서 보관, 상태값 유지)
```

- `rooms.status` **컬럼이 진실**. pg_cron 이 5분마다 `room_tick()` 을 호출해 조건부 UPDATE(`WHERE status='RECRUIT' AND start_date <= kst_today()`). 조회 시 날짜로 재계산하지 않는다.
- `DRAFT` 는 디자인 §2.1 "말단 과제 1개 이상 있어야 모집 시작 가능"을 위해 추가. 방 생성 직후 상태. 그룹장에게만 보임(`내가 만든 방`, 배지 "준비중"). `start_date` 가 지나도 자동 전환하지 않고 그룹장에게 `ROOM_START_BLOCKED` 알림.
- 보관은 `archived_at` 플래그 → 해제 시 원래 상태 복귀. 보관 방은 목록·집계·일정·알림에서 제외, 읽기는 그룹장·기존 멤버만.
- 프론트 `RoomStatus` 는 `recruit|active|ended` 유지, 목록 DTO 에 `draft` 추가(배지 1개).

## D3. 멤버십 상태 머신

`room_members.status ∈ {ACTIVE, PENDING, REJECTED, CANCELED, EXPIRED, INACTIVE}`, `role ∈ {LEADER, MEMBER}`, `UNIQUE(room_id, user_id)`.

- 정원 = `rooms.member_count`(ACTIVE 수, 그룹장 포함). `room_join()`/`room_approve()` 는 `UPDATE rooms SET member_count = member_count + 1 WHERE id = $1 AND member_count < max_members RETURNING id` 로 판정(없으면 `ROOM_FULL`). 취소·이탈은 `-1`.
- 대기자(PENDING)는 정원 미포함. 재신청·재참가는 **같은 행의 status 되돌림**.
- `INACTIVE`(이탈)는 진행중에만(그룹장 이탈 처리). 모집중 참가자가 나가는 건 `CANCELED`.
- 목업 docker `0/6` 은 규칙 위반 → 시드에서 `1/6`. "첫 참가자를 기다려요" 조건은 `member_count = 1`.

## D4. 공통 과제 담당자 — **항상 실체화(materialize)**

분석이 갈린 항목(roomview·schedule: 실체화 / mystudy: 런타임 파생). **실체화로 확정.**

- `task_assignments(node_id, user_id, source COMMON|DESIGNATED, released_at)` 에 공통·지정 모두 저장. 집계·일정·보드·간트가 `released_at IS NULL` 행 하나만 본다.
- 일관성은 함수 `assignment_resync(p_room_id)` 하나가 보장. 호출: 멤버십 변경(참가/취소/승인/이탈), 노드 생성/타입 변경/보관/삭제, `leader_does_tasks` 변경, 방 시작. 규칙:
  1. 보관 아닌 COMMON 리프 × (ACTIVE 멤버, 그룹장은 `leader_does_tasks` 일 때) → 없으면 INSERT(source=COMMON), released 면 NULL 로 복구.
  2. COMMON 행인데 멤버가 ACTIVE 아님 또는 리프가 COMMON 아님 → `released_at = now()`.
  3. DESIGNATED 행은 `node_update()`(assigneeIds)·`member_deactivate()`(decisions) 로만 생성·해제. 멤버 INACTIVE 시 제출된 행은 released(집계 제외·제출물 보존), 미제출 행은 exclude/reassign 결정.
  4. 제출물 있는 행은 삭제하지 않고 released 만.
- 모집중에도 실체화 → 모집중 방 `asg`(sqld 0/2)도 같은 쿼리.

## D5. 사람별 상태·진척률 (단일 규칙, DB 함수)

```
kst_today()           = (now() AT TIME ZONE 'Asia/Seoul')::date
deadline(end_date)    = (end_date + 1)::timestamp AT TIME ZONE 'Asia/Seoul'   -- 다음날 00:00 KST (exclusive)
task_code(s, e, first_submitted_at, is_late, today)
  = 제출 있음 ? (is_late ? 'late' : 'done') : today < s ? 'planned' : today > e ? 'missed' : 'open'
is_late               = first_submitted_at >= deadline(e)   (최초 제출 시 고정, 불변)
leaf.asg              = COUNT(assignments WHERE released_at IS NULL)
leaf.sub              = COUNT(그중 submission 존재)
parent.asg/sub        = Σ 자식(archived 제외, 재귀 — `WITH RECURSIVE` 또는 round_id 집계)
pct                   = asg = 0 ? NULL : round(sub*100.0/asg)   (half-up)
leaf_state            = asg=0 ? unassigned : sub=asg ? complete : today<s ? planned : today>e ? delayed : progress
```

- `today` 는 항상 **DB 의 KST 날짜**. 모든 JSON 응답에 `today` 포함, 프론트 `TODAY` 상수를 대체.
- 목업 회귀값: aws 6/25=24%(루트 5/8·1/3·0/4·0/4·0/6), spring 12/35=34%, algo 68/78=87%, sqld null. 스펙 표의 aws 40% 폐기.
- 그룹장이 `leader_does_tasks=false` 면 담당자 아님(프론트 `noBar`).

## D6. 세션·접근 경로

- `@supabase/ssr` 로 Next.js 서버 컴포넌트·Route Handler·미들웨어에서 같은 세션 쿠키 사용. `middleware.ts` 가 세션 갱신 + 보호 라우트(`/my-study`, `/schedule`, `/me`, `/rooms/new`) → `/login?returnTo=`.
- 프론트는 **anon key + 사용자 세션**으로 직접 Supabase 호출(RLS 가 권한). `service_role` 키는 서버 전용(시드·관리 스크립트)이며 Vercel 환경변수에 넣지 않는다.
- 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`(브라우저 노출 가능). `.env.example` 의 `NEXT_PUBLIC_API_URL` 은 폐기.
- `returnTo` 는 `/rooms/`, `/my-study`, `/schedule`, `/invite/` 접두사만 허용.

## D7. 비로그인·권한 경계 (RLS + 함수 내 검사)

| 리소스 | 비로그인 | 비공개 방 비멤버 |
|---|---|---|
| 공개 방 목록·상세·커리큘럼·집계·상태 아이콘 | 허용(anon) | — |
| 비공개 방 전부 | 행 자체 비노출(RLS) → 프론트 404 | 비노출 |
| 초대 미리보기 `invite_preview(token)` | 허용(SECURITY DEFINER) | 허용 |
| 제출물 본문·첨부·링크 | 불허 | 불허 |
| 모든 쓰기 RPC, `me_*` | `AUTH_REQUIRED` | — |
| 승인 대기자(PENDING) | 방 읽기 + 커리큘럼 미리보기(내 일정 포함) | |
| 이탈자(INACTIVE) | 방·제출물 읽기 유지, 쓰기·알림 불가 | |
| 온보딩 미완료(`profiles.nickname IS NULL`) | 쓰기 RPC 전부 `ONBOARDING_REQUIRED` | |

- 쓰기 RPC 는 전부 `SECURITY DEFINER` + 내부에서 `auth.uid()`·역할 검사. 테이블 직접 INSERT/UPDATE 는 RLS 로 막는다(프론트는 RPC 만 호출).
- 읽기는 RLS SELECT 정책 + 집계 함수(`SECURITY INVOKER`, RLS 통과한 행만 집계).

## D8. 알림

- 인앱만 1단계. 15종 `kind`(`03-api.md` §7). 생성은 쓰기 RPC 내부에서 `notify_publish(...)` 호출(같은 트랜잭션), `dedupe_key UNIQUE` + `ON CONFLICT DO NOTHING`.
- 옵션 설정은 **방 단위**(`room_notification_settings`). 기본 3종은 컬럼 없음. 메일은 2단계(방 설정 AND `profiles.optional_mail_enabled`).
- 시각: 상태 전환·대기 만료·회차 시작 = 00:00 KST, 리마인더·일일 요약 = 09:00 KST (pg_cron 은 UTC → 15:00 / 00:00 UTC).
- `link`: 방 이벤트 → 참가자면 `/my-study/{slug}`, 아니면 `/rooms/{slug}`; 과제 이벤트 → `/my-study/{slug}?task={nodeId}`.
- 본인이 일으킨 이벤트는 본인 제외. 한 저장의 같은 수신자·kind 는 1건.
- 헤더 배지는 60초 폴링(`notifications_unread_count()`); Realtime 구독은 2단계.

## D9. 커리큘럼 편집 단위·불변식

- 구조 변경(생성·삭제·보관·이동)은 **즉시 RPC**, 내용 변경(제목·설명·기간·타입·담당자)은 `node_update()` 1회(편집 패널 "저장"). 저장 후 태그 자동 선택은 같은 트랜잭션에서 `tag_autoselect(room_id)` (키워드 방식은 ms 단위) — LLM 방식은 Edge Function 비동기.
- 불변식(함수 + 트리거): 루트=depth 2 & label · depth ≤ 5 · 자식 있는 노드는 `task_type NULL` & 담당자 없음 · 리프는 `task_type` 필수 · `start_date ≤ end_date` · archived 하위 전파 · 제출물 있는 리프는 삭제/부모 전환/타입 변경/해당 담당자 제거 불가(→ 보관).
- 기간은 모든 노드 필수(1차 단순화). 부모·방 기간 밖은 허용 + `warnings`.
- 빈 부모는 리프로 자동 전환하지 않음. 마감 변경 시 `is_late` 재계산 금지.
- 편집 가능 상태: DRAFT·RECRUIT·ACTIVE. ENDED/보관은 `ROOM_NOT_EDITABLE`.

## D10. 제출

- `submission_upsert(node_id, body_md, links[], file_ids[])`. 선행: 방 ACTIVE · 담당자(released 아님) · 리프 보관 아님 · `today ≥ start_date`. 삭제 없음.
- 본문 ≤ 50k자, 링크 ≤ 20, 파일 ≤ 5 × 10MB, MIME `image/png|jpeg|gif|webp`, `application/pdf`, `application/zip|x-zip-compressed`, `text/plain|markdown`. 버킷 `allowed_mime_types`·`file_size_limit` + 함수에서 개수·`storage.objects` 존재 재검증.
- 파일 경로 `attachments/{room_id}/{node_id}/{user_id}/{uuid}-{name}`. Storage RLS: 업로드는 본인 폴더 & 담당자, 읽기는 같은 방 멤버(이탈자 포함)·그룹장. 다운로드는 `createSignedUrl(300s)`.
- 열람: 같은 방 ACTIVE·INACTIVE 멤버 + 그룹장. 보관 노드 제출물은 그룹장 + 작성자.

## D11. 설정 탭 (화면 미설계, RPC 선구현)

- `room_update()` 상태별 잠금(mystudy §2.3.1 표). `max_members ≥ member_count`.
- 이탈 처리 2단계: `member_deactivate_preview()` → `member_deactivate(decisions jsonb)`. 미제출 지정 과제 전부 결정 필수, 담당자 0명이면 `REASSIGN_REQUIRED`.
- `room_delete()` 는 DRAFT·RECRUIT 만(cascade). ACTIVE 이후는 `room_archive()`.
- `room_start()` 는 `start_date = today`, 회차 기간 유지. 담당자 미정 지정 과제는 `warnings`.

## D12. 태그

- 사전 `tags`(slug PK) 시드 = 목업 태그 전부. `tag_autoselect(room_id)`: 제목·소개·노드 제목 vs `label`/`aliases` ILIKE → 상위 5개. LLM 은 Edge Function `suggest-tags` 가 같은 머지 함수 `tag_apply_auto(room_id, slugs[])` 호출.
- AUTO 전부 교체, MANUAL 보존, 그룹장이 지운 AUTO 는 `room_tag_suppressions`. 방당 ≤ 8. 자유 입력은 `kind=CUSTOM`.

## D13. 데이터 접근 규약

- 프론트는 `src/lib/api/*.ts` 어댑터만 통해 Supabase 를 호출하고, 화면은 기존 `src/data/*.ts` 타입을 그대로 받는다(어댑터가 변환). 컴포넌트는 Supabase 를 모른다.
- RPC 는 `rpc_` 접두 없이 도메인 동사형(`room_join`, `node_update`, `me_schedule`), 인자는 `p_` 접두. 읽기 함수는 `jsonb` 반환, 쓰기 함수도 결과 `jsonb`(예: `MembershipResult`).
- 모든 `SECURITY DEFINER` 함수는 `SET search_path = ''` 를 걸고 테이블을 `public.` 으로 한정한다(Supabase 권고, assistant 관례). `auth.uid()` 는 래퍼 `public.current_user_id()` 로만 호출.
- 마이그레이션 파일명은 `supabase/migrations/0001_schema.sql` 식 4자리 번호(assistant 관례). 한 번 배포된 파일은 수정하지 않고 다음 번호로 변경.
- 에러: 함수 안에서 `raise exception using errcode = 'P0001', message = 'ROOM_FULL', detail = '정원이 찼어요', hint = '{"field":"…"}'`. 프론트 어댑터가 `error.message` 를 `code` 로, `details` 를 사람 문구로 매핑. 코드 목록은 `03-api.md` §0.
- 날짜 `YYYY-MM-DD`(KST, `DATE`), 시각 ISO UTC. 모든 읽기 JSON 에 `today`.
- 서버는 원시 값만, 문구 조립(D-day·기간·회차 창·glance)은 프론트 어댑터.

## D14. 분석 간 충돌 정리표

| 항목 | 분석 A | 분석 B | 확정 |
|---|---|---|---|
| 공통 과제 담당자 | 실체화(roomview, schedule) | 런타임 파생(mystudy) | **실체화 + `assignment_resync`** (D4) |
| 방 상태 | 날짜로 계산(main) | 컬럼+스케줄러 | **컬럼 + pg_cron** (D2) |
| 보관 | `status=archived` | 별도 플래그 | **`archived_at`** |
| 이탈자 집계 | 제출 건 보존·분모 고정 | 전부 제외(목업 도윤) | released → 제외, 제출물 보존 |
| 알림 설정 단위 | 방 | 개인(메일) | 인앱=방, 메일=방 AND 개인 |
| 세션 | 쿠키/프록시/Bearer | — | **Supabase Auth + @supabase/ssr** (D6) |
| 방 생성 직후 | DRAFT | 전환 보류 | **DRAFT + `room_open_recruit`** |
| `nextDue` | OPEN 만 | — | OPEN 만 |
| 종료 방 + 멤버 CTA | ended(목업) | joined | joined — 프론트 어댑터 |
| 회차 label | 자유 문자열 | — | `label` 컬럼, 기본 `"{n}주차"` |
| 기간 문구 | "3개월" vs "13주" | — | `round(days/7)주` 통일 |

## D15. 규모가 커지면 — 이관 경로

| 신호 | 조치 |
|---|---|
| PL/pgSQL 로직이 커져 테스트·리뷰가 어려움, 또는 외부 연동(LLM·메일·결제)이 늘어남 | **Supabase 는 Postgres+Auth+Storage 로 남기고**, 쓰기 RPC 만 자체 서버(Spring/Nest)의 엔드포인트로 교체. 프론트는 `src/lib/api/*` 어댑터만 바꾸면 됨(컴포넌트 무수정) |
| 동시 접속·집계 부하 | 읽기 JSON 함수 → 머티리얼라이즈드 뷰 또는 서버 캐시 |
| 멀티 리전·규제 | 스키마(`supabase/migrations`)를 그대로 자체 Postgres 로 복원. `auth.users` 는 Supabase Auth 유지 또는 export |

이관을 쉽게 하려고 지금부터 지키는 규칙: ① 비즈니스 규칙은 **함수** 에만(트리거는 불변식·동기화만) ② 함수 입출력은 JSON DTO 로 고정(`03-api.md`) ③ Supabase 전용 기능(`auth.uid()`, Storage, pg_cron)은 얇은 래퍼 함수(`current_user_id()`, `storage_exists()`)로 격리.
