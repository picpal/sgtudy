# 추가 모집 · 초대 코드(바로 참가) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 시작한(ACTIVE) 스터디에 참가자를 더 받는다 — ① 그룹장이 마감일을 정해 여는 **추가 모집**(기존 참가/신청·승인 흐름 재사용, 둘러보기 노출, 마감일 자동 종료), ② 모집이 닫혀 있어도 들어오는 **초대 링크·8자 코드 "바로 참가"**(기한·인원 한도·회전). 중간 합류자는 합류일 이후 마감인 공통 과제만 맡는다.

**Architecture:** DB = 마이그레이션 1개 `0032_extra_recruit.sql`(추가형, **확정 — AI 연동보다 먼저 배포**, 아래 "번호" 절). 판정 함수 `room_recruit_open(r)`(RECRUIT ∨ ACTIVE ∧ `least(recruit_until, end_date) ≥ today`) 하나로 `room_join_precheck`·`room_decide_precheck` 의 `status <> 'RECRUIT'` 를 대체하고, 기존 방당 1개 초대(`room_invites`)에 `code`·`bypass_until`·`bypass_max`·`bypass_used` 를 붙여 `invite_join` 이 "바로 참가"면 `room_join_by_invite` 로 보낸다. 중간 합류는 `room_members.assign_from` + `assignment_resync` 한 줄. 웹 = 어댑터·순수 로직 `src/lib/api/recruit.ts` → 방 설정 「추가 모집 · 초대」 섹션(바로 저장) → 그룹장 패널·참가 카드·방 카드 표시 → 초대 랜딩 CTA 확장 + `/join` 코드 입력 페이지.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Tailwind v4 · Supabase PG17(plpgsql `security definer set search_path=''`, `public.fail`) · vitest(`src/**/*.test.ts`, DOM 은 `// @vitest-environment jsdom` + `renderToStaticMarkup`) · deno + PGlite SQL 테스트(`npm run test:db`).

**Spec:** `docs/superpowers/specs/2026-10-20-extra-recruit-design.md`. 스펙 §8 D1~D14 는 **권장안 기준(사용자 승인 대기)**. 승인 때 바뀌는 결정은 맨 끝 "결정에 따른 변경" 표를 따라 해당 Task 만 고친다.

## Codex 리뷰 반영 (2026-10-20, review-1 · 판정 needs rework → 9건 모두 수용)

| # | 지적 | 반영 | 위치 |
|---|---|---|---|
| 1 | tick 만료가 잠금 대기 중 연장된 창까지 닫음 | 수동 마감(`room_extra_recruit_expire`, 호출자가 방 잠금) ↔ 자동 만료(`room_extra_recruit_auto_expire`: 방 행 `for update` → 최신 상태로 조건 재검사 → 아직 유효하면 손대지 않음) 분리. tick 은 자동 만료만 부른다 | Task 2 · Task 9(두 연결 경쟁) |
| 2 | 마감 뒤 tick 전에 다시 열면 옛 PENDING 이 새 창으로 넘어감 | `room_extra_recruit_open` 이 지난 창(실효 마감 < 오늘)을 먼저 만료(대기 → EXPIRED + 알림)한 뒤 새 창을 연다. 같은 창 연장은 대기 유지 | Task 2 테스트 "reopen after lapse" |
| 3 | 종료일 단축 시 정리 순서·초대 기한 불일치 | 실효 마감 = `least(recruit_until, end_date)`·`least(bypass_until, end_date)` 로 판정·표시(`room_recruit_until`). tick 의 창 정리 루프를 ACTIVE→ENDED 루프 **뒤**로 옮겨 같은 tick(트랜잭션)에서 종료 전이 + 대기 만료. 테스트는 `room_update` 로 실제 단축 | Task 1·2·3·4 |
| 4 | 추가 모집 신청자가 내 스터디에서 사라짐 | `me_studies` ←0024 재정의: 모집 열린 ACTIVE 방의 PENDING 을 `recruit` 그룹("모집중 · 승인 대기")에, `when = {kind:'recruitEnd', date: 실효 마감}` → "MM.DD 모집 마감" | Task 4 · Task 5 |
| 5 | 편집 미리보기 공통 담당자 ≠ 서버 | `curriculum_json` ←0024 재정의로 멤버에 `assignFrom`. `model.ts` 공통 재계산 = 기존 담당 ∪ (`assignFrom` 없음 ∨ 마감 ≥ `assignFrom`), 공통 과제 날짜만 바꿔도 중간 합류자가 있으면 재계산 | Task 4 · Task 5 |
| 6 | `min_members` > 새 정원이면 원시 제약 오류 | `public.fail('VALIDATION_FAILED', …, {field:'maxMembers', minMembers})` | Task 2 |
| 7 | 성공 기록 무한 누적·다계정 방어 과장 | 표를 `invite_code_failures`(실패만)로, 성공은 저장 안 함. 1일 지난 실패는 `room_tick` 이 지운다(재정의 이미 함 — `job_cleanup` 추가 재정의 회피). 스펙 §6 에서 다계정 방어 주장 삭제 → 한계로 명시 | Task 1·3 · 스펙 §6 |
| 8 | 추가 모집이 바꾼 `joinMode` 가 설정 폼에 안 보임 | `settings.ts` `syncServerFields(base, v, next)` — 서버가 바꾼 `maxMembers`·`joinMode` 를 기준값·현재값에 반영, 다른 미저장 칸 유지(테스트) | Task 6 |
| 9 | 단일 연결 테스트로는 경쟁·커밋 지속성 미검증 | 새 Task 9 `extra-recruit-db.test.ts`(로컬 supabase 전용, 두 연결): 마지막 좌석 동시 참가 · 바로 참가 한도 경쟁 · tick↔연장 경쟁 · 별도 트랜잭션 실패 누적. 로그인 복귀 코드 보존은 `middleware.test.ts` 실행 테스트 + 브라우저 시나리오 | Task 8·9·10 |

### 2차 (review-2 · 5 resolved / 4 partial → 남은 항목 모두 수용)

| # | 지적 | 반영 | 위치 |
|---|---|---|---|
| 2-1 | `least(NULL, end_date)` = `end_date` → 창 없는 ACTIVE 방도 `recruitUntil`·`isFull` | `rooms_list` 두 식 모두 `p.recruit_until is not null` 가드(다른 곳은 이미 가드: `room_recruit_until`·`room_matches`·tick 후보·`invite_bypass_ok`). `react.recruitUntil = null` 테스트가 이제 실제 회귀를 잡고, 꽉 찬 창 없는 방 `isFull = false` 단언 추가. 웹 `toRoomCard` 는 `recruitUntil` 있을 때만 배지 — 서버 수정으로 충분 | Task 4 |
| 2-2 | tick 종료(·시작) 루프가 잠금 대기 뒤 `status` 만 재검사 → 종료일을 연장해도 종료 | `room_tick` 을 통째로 다시 쓴다: 두 전이 루프 모두 방 행 `for update` 후 `status`·`archived_at`·`end_date`(시작은 `start_date`) 재검사, **실제로 전이한 것만** 센다. 두 연결 테스트(`room_update(endDate)` 연장 ↔ tick) | Task 2 · Task 9 |
| 2-3 | 지정→공통 미리보기가 기존 지정 담당을 유지(서버는 0028:150–153 에서 해제) | 기존 담당 유지는 **원래 공통 과제(기존 COMMON 배정)** 에만. 지정→공통 + 지난 과제 중간 합류 담당자 테스트 | Task 5 |
| 2-4 | `syncServerFields` 가 안 바뀐 칸도 덮고, 요청 전 상태를 캡처 | 동작별 변경 칸 목록(`open` → `maxMembers`·`joinMode`, `close` → 없음)을 넘기고 `mergeServerFields` 를 **함수형 setState** 로 최신 상태에 병합. 테스트: "지금 마감" 뒤 미저장 정원 유지, 요청 중 입력 유지 | Task 6 |
| 2-5 | 400ms 대기는 잠금 대기를 증명 못 함·시작일 오늘이라 cron 경쟁·연결 미종료 | `pg_stat_activity`/`pg_blocking_pids` 로 대상 백엔드가 잡은 연결에 막혀 있음을 제한시간(5s) 안에 확인한 뒤 커밋 → 둘 다 잠금 앞에서 기다림이 보장돼 오류 코드가 확정적. 방은 **미래 시작일**로 만든 뒤 `room_start`. 마지막 `dbTest` 에서 `pg.end()` 명시 | Task 9 |
| 2-6 | `assignFrom` 이 공개 방 익명 `curriculum_get` 에 노출 | 그룹장·ACTIVE/INACTIVE 멤버(`v_viewer`, 0014 규칙)에게만 키를 싣는다. 익명·외부인 테스트 | Task 4 |

16개 재정의 복사 원본은 Codex 가 0031 기준 최신으로 확인. 이번 반영으로 재정의가 2개(`me_studies`·`curriculum_json`, 둘 다 ←0024) 늘었다 — AI 연동 플랜(0033~0035)은 둘 다 재정의하지 않는다(`api_studies` 가 `me_studies` 출력을 소비하므로 `when.kind = 'recruitEnd'`·ACTIVE 방 PENDING 항목이 새로 보일 수 있다 — 동작 상호작용으로 컨트롤러에 알림).

## 번호 (중요)

- **선택됨(확정): 이 기능이 AI 연동보다 먼저 배포된다 → `0032_extra_recruit.sql`.** AI 연동 플랜(`docs/superpowers/plans/2026-10-19-ai-integration.md`)은 0033~0035 로 밀렸다(문서 재번호 완료).
- 이 번호에 맞춰 적용된 것:
  1. 파일명 `supabase/migrations/0032_extra_recruit.sql`, 파일 머리 주석, `supabase/tests/extra-recruit-sql.test.ts` 머리 주석과 `cases("… 0032 …")` 묶음 이름, 커밋 메시지의 `0032`, `src/lib/api/types.ts` 의 `// 0032` 주석.
  2. `notification_kinds`·`notify_render` 복사 원본 = 현재 `supabase/migrations/` 의 최신 판(`notification_kinds` ← 0024 · `notify_render` ← 0028; Task 0 Step 2 grep 으로 재확인).
  3. AI 플랜은 `notification_kinds`·`notify_render` 복사 원본이 **`0032_extra_recruit`** 이고 `MEMBER_JOINED` 를 유지해야 한다 — AI 플랜 문서에 이미 반영됨.
- **AI 와의 함수 충돌**: 둘 다 재정의 = `notification_kinds()`·`notify_render()` + TS `NOTIFICATION_KINDS`. 그 외 AI 재정의 대상(`current_user_id`·`node_create`·`node_update`·`notify_link`·`pat_*`·`plan_*`·`api_*`·`curriculum_plan_*`·`personal_*_many`)은 이 플랜이 건드리지 않는다. 이 플랜이 재정의하는 `assignment_resync` 는 AI 0034 가 호출만 한다.

## Global Constraints

- 마이그레이션은 **`0032_extra_recruit.sql` 하나만**. 0001~0031 수정 금지. 0033~0035 는 AI 연동 예약 — 만들지 않는다. Task 0 에서 `0032_*` 가 이미 있으면 멈추고 번호를 컨트롤러와 다시 정한다.
- **재정의는 최신 판 복사 후 표시한 곳만 고친다**(Task 0 Step 2 로 최신 판 확정): `assignment_resync` ←0014 · `room_join_precheck`·`room_join`·`room_approve`·`room_decide_precheck` ←0005 · `room_tick`·`invite_ensure`·`room_matches` ←0004 · `invite_get`·`invite_rotate`·`invite_preview` ←0005 · `invite_join` ←0024 · `room_detail_json` ←0026 · `rooms_list` ←0024 · `notification_kinds` ←0024 · `notify_render` ←0028 · `me_studies` ←0024 · `curriculum_json` ←0024(Codex #4·#5). `create or replace` 는 이름·인자명·기본값 동일 → GRANT 유지.
- **재정의 금지**: `room_apply`(precheck 가 관문) · `room_leave` · `room_update` · `notify_link` · `notify_enabled` · `invite_resolve` · `room_transition_active`/`room_transition_ended` · `member_deactivate`.
- `room_tick()` 반환 모양 `{activated, ended}` 는 그대로(기존 `_cases-rooms.ts` 가 객체 전체를 단언).
- **실효 마감**: 모집 창·바로 참가 기한은 언제나 `least(…, rooms.end_date)` 로 판정·표시한다(종료일 단축 대응, Codex #3). 저장값을 고치지 않는다(`room_update` 재정의 금지 유지).
- **자동 만료는 방 행을 잠근 뒤 재판정**한다. tick 이 고른 후보 목록을 그대로 믿지 않는다(Codex #1).
- 새 plpgsql 함수: `security definer set search_path = ''`, 객체는 `public.` 접두, 실패는 `perform public.fail(code, 한국어 문구, details)`. 공개 RPC 만 GRANT(`room_extra_recruit_open`·`room_extra_recruit_close`·`invite_bypass_set`·`invite_code_lookup` → `authenticated`). 내부 헬퍼는 0002 기본 권한으로 닫혀 있다 — 아무것도 하지 않는다.
- 시간: 날짜는 `public.kst_today()`(테스트 `app.today`), 시각 비교는 `public.app_now()`(테스트 `app.now`).
- 잠금 순서: 방 행(`room_lock`) → 초대 행(`for update`) → 사용자 advisory(코드 조회는 방을 잡지 않으므로 독립).
- SQL 테스트는 `supabase/tests/*-sql.test.ts`(deno + PGlite, `_harness.ts`·`_fixtures.ts`). 각 case 는 롤백된다. 시드 기준일 `2026-10-12`.
- 문구는 스펙 §4·§5 그대로(한국어). 사용자 용어 "추가 모집", "초대 코드", "초대 링크", "바로 참가", "진행목표", "공통 과제".
- 한 페이지 스크롤: 새 안쪽 스크롤러 금지. 버튼 ≥ 44px(`h-11`/`min-h-11`). 확인 폭 390 / 820 / 1440, 가로 스크롤 없음. 코드 표시는 `font-mono` + `whitespace-nowrap`.
- Supabase 는 `src/lib/api/*` 에서만 import. 새 npm 의존성 금지. 새 Next API 를 쓰지 않는다(새 페이지는 기존 `page.tsx` 패턴 — `params`/`searchParams` 는 Promise). 다르게 써야 하면 먼저 `node_modules/next/dist/docs/` 해당 문서를 읽는다(AGENTS.md).
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

1. **관문이 한 곳** — 참가·신청·승인 판정이 모두 `room_recruit_open` 을 거치는가. 창 밖 ACTIVE 는 지금과 똑같이 `ROOM_NOT_RECRUITING`(기존 `_cases-membership.ts`·`backlog-0028-sql.test.ts` 단언 유지). → Task 2.
2. **이미 퍼진 링크가 열리지 않는다** — 0032 전 초대 행(`bypass_until null`)은 진행중 방에서 여전히 참가 불가. 바로 참가는 그룹장이 명시적으로 켠 경우만, 기한 ≤ 30일 ∧ ≤ 종료일. → Task 3.
3. **실패 기록이 롤백되지 않는다** — `invite_code_lookup` 은 못 찾음을 **반환**(`{found:false}`)하고, 한도 초과만 `fail`. `fail` 로 던지면 실패 INSERT 가 함께 롤백돼 제한이 무력해진다. 테스트가 10회 실패 후 11회째 `RATE_LIMITED` 를 확인. → Task 3.
4. **중간 합류 배정** — 합류일(KST) 이전 마감 공통 과제는 배정 안 됨, 이후·진행중 과제는 배정. 기존 멤버(`assign_from null`)는 무변화. 이미 해제된(released) 행을 되살리지 않는다(`on conflict … where released_at is not null` 이 `assign_from` 조건 밖에서 돌지 않는지). → Task 1·2.
5. **동시성** — 바로 참가 한도: 방 행 잠금 → 초대 행 `for update` → 재판정 → 좌석 → `bypass_used + 1`. 정원은 `room_take_seat` 그대로. → Task 3.
6. **대기 신청 정리** — 창이 닫히면(수동·tick·방 종료·종료일 단축) PENDING 이 남지 않는다. tick 반환 모양 불변. → Task 2.
7. **노출 범위** — 코드·토큰·바로 참가 설정은 그룹장에게만(`room_detail_json.invite`), 비로그인 `room_get` 에는 `recruit` 만. → Task 4.
8. **AI 플랜과의 재정의 충돌** — `notification_kinds`·`notify_render` 를 실제 최신 판(0024·0028)에서 복사했는가. → Task 0·2.
9. **창 경계 정리** — 마감 뒤 tick 전 재개·종료일 단축·tick↔연장 경쟁 어느 경로에서도 옛 PENDING 이 새 창으로 넘어가거나 새 창이 닫히지 않는다. → Task 2·9.
10. **화면 = 서버** — 내 스터디 목록(`me_studies`)·편집 미리보기(`model.ts`)가 서버 배정·노출 규칙과 같은가. → Task 4·5.
11. **실패 기록 수명** — 성공은 저장 안 함, 실패만 1일 보관(tick 정리). 실패 누적이 요청(트랜잭션) 사이에 유지되는가(실 DB). → Task 3·9.
12. **`least()` 와 NULL** — PostgreSQL `least` 는 NULL 을 무시한다. `least(recruit_until, end_date)` 를 쓰는 모든 식에 `recruit_until is not null` 가드가 있는가(`room_recruit_until`·`room_matches`·`rooms_list` 두 식·tick 후보). → Task 1·2·4.
13. **tick 전이 재판정** — 시작·종료 전이도 잠금 뒤 날짜 재검사, 실제 전이만 카운트. → Task 2·9.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음 (읽기만)

- [ ] **Step 1: 작업 트리·번호**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && git status --short && ls supabase/migrations | tail -5`
Expected: `supabase/migrations/**`·`supabase/tests/**`·`src/lib/api/**`·`src/components/{room-settings,room-view,auth,main}/**` 에 커밋 안 된 변경 없음. `0032_*` 없음. 마지막 파일이 `0031_orphan_objects.sql` 이 아니면 멈추고 보고(이 기능이 AI 연동보다 먼저 배포되는 것으로 확정).

- [ ] **Step 2: 복사 원본 확정**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && for f in assignment_resync room_join_precheck room_join room_approve room_decide_precheck room_tick invite_ensure invite_get invite_rotate invite_preview invite_join room_detail_json rooms_list room_matches notification_kinds notify_render room_apply room_leave room_update notify_link me_studies curriculum_json job_cleanup; do echo "$f: $(grep -lE "create (or replace )?function public\.$f\(" supabase/migrations/*.sql | sort | tail -1 | xargs basename)"; done`
Expected: `assignment_resync: 0014…` · `room_join_precheck/room_join/room_approve/room_decide_precheck/invite_get/invite_rotate/invite_preview: 0005…` · `room_tick/invite_ensure/room_matches: 0004…` · `invite_join: 0024…` · `room_detail_json: 0026…` · `rooms_list: 0024…` · `notification_kinds: 0024…` · `notify_render: 0028…` · `room_apply: 0026…` · `room_leave: 0005…` · `room_update: 0018…` · `notify_link: 0028…` · `me_studies: 0024…` · `curriculum_json: 0024…` · `job_cleanup: 0030…`(재정의하지 않음 — 확인만). 그 밖의 줄이 다르면 그 파일 판을 원본으로 쓰고 컨트롤러에 알린다.

- [ ] **Step 3: 게이트 기준선**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db && npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 모두 통과(env 없이 돌리면 `*-db.test.ts` 는 ignored). 실패하면 멈추고 보고.

---

### Task 1: 0032 (1) — 스키마 · 코드 생성 · 판정 · `assignment_resync` (opus)

**Files:**
- Create: `supabase/migrations/0032_extra_recruit.sql`
- Create: `supabase/tests/extra-recruit-sql.test.ts`

**Interfaces (이 Task 가 만드는 것):**
- 열 `rooms.recruit_until date` · `room_members.assign_from date` · `room_invites.code varchar(8)`·`bypass_until date`·`bypass_max int`·`bypass_used int not null default 0`, 체크 2개, 유니크 인덱스 `ux_room_invites_code`
- 표 `invite_code_failures(id, user_id, created_at)` — **실패만**(Codex #7) + 인덱스 2개, RLS on(정책 없음), anon·authenticated 권한 회수
- `invite_code_norm(text) → text`(immutable, INVOKER) · `invite_code_new() → text` · `room_recruit_open(public.rooms) → boolean` · `room_recruit_until(public.rooms) → date`(실효 마감 = `least(recruit_until, end_date)`, ACTIVE 아니면 null)
- `assignment_resync(bigint)` 재정의(0014 + 1줄)

- [ ] **Step 1: 실패하는 테스트 작성** — `supabase/tests/extra-recruit-sql.test.ts`

```ts
// supabase/tests/extra-recruit-sql.test.ts — 0032 추가 모집 · 초대 코드(바로 참가) (스펙 2026-10-20-extra-recruit-design)
import { assert, assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { applySeed, asAnon, asUser, expectFail, newUser, openDb, setToday } from "./_harness.ts";
import { cases, nodeId, one, roomId, setNow, uidOf, type Q, type Row } from "./_fixtures.ts";
import { openRoom } from "./_cases-membership.ts";   // 리프 있는 RECRUIT 방 (실제 종료일 단축 사례)
import { USERS } from "./_cases-rooms.ts";

const db = await openDb();
await applySeed(db);

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** 시드 사용자로 행동 */
const as = async (q: Q, nick: string) => asUser(q, await uidOf(q, nick));
/** select <expr> as r 의 r */
const rpc = async (q: Q, expr: string, p: unknown[] = []) => (await one(q, `select ${expr} as r`, p)).r as Row;
const memberRow = async (q: Q, slug: string, uid: string) =>
  await one(q, `select m.status, to_char(m.assign_from, 'YYYY-MM-DD') as assign_from from public.room_members m
                join public.rooms r on r.id = m.room_id where r.slug = $1 and m.user_id = $2::uuid`, [slug, uid]);
/** 배정 행이 있으면 유효 여부, 없으면 null */
const live = async (q: Q, node: string, uid: string) =>
  (await one(q, "select released_at is null as v from public.task_assignments where node_id = $1::bigint and user_id = $2::uuid", [node, uid]))?.v ?? null;
const recruitOpen = async (q: Q, slug: string) =>
  (await one(q, "select public.room_recruit_open(r) as v from public.rooms r where r.slug = $1", [slug])).v as boolean;
const openExtra = (q: Q, slug: string, until: string, max: number | null = null, mode: string | null = null) =>
  rpc(q, "public.room_extra_recruit_open($1, $2::date, $3::int, $4)", [slug, until, max, mode]);
const notes = async (q: Q, nick: string, kind: string, slug: string) =>
  await q(`select n.title, n.body from public.notifications n join public.rooms r on r.id = n.room_id
           where n.user_id = $1::uuid and n.kind = $2 and r.slug = $3 order by n.id`, [await uidOf(q, nick), kind, slug]);
// (Task 1 시점에 아직 안 쓰는 import·헬퍼는 Task 2~4 묶음이 쓴다)

cases("extra recruit 0032 · schema & helpers", db, [
  { name: "invite_code_norm: upper, strip spaces/hyphens, O→0 I/L→1", run: async (q) => {
    const n = async (s: string) => (await one(q, "select public.invite_code_norm($1) as v", [s])).v;
    assertEquals(await n(" k7qm-3xpa "), "K7QM3XPA");
    assertEquals(await n("oIlL"), "0111");
    assertEquals(await n(""), "");
  } },
  { name: "invite_code_new: 8 Crockford chars, unique among 200", run: async (q) => {
    const rows = await q("select public.invite_code_new() as c from generate_series(1, 200)");
    for (const r of rows) assertMatch(r.c as string, CODE_RE);
    assertEquals(new Set(rows.map((r) => r.c)).size, 200);
  } },
  { name: "room_recruit_open: RECRUIT yes · ACTIVE only inside window · archived/ENDED no", run: async (q) => {
    assertEquals(await recruitOpen(q, "toeic"), true);
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-12' where slug = 'aws'");
    assertEquals(await recruitOpen(q, "aws"), true);                 // 오늘까지 포함
    await setToday(q, "2026-10-13");
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-20', archived_at = now() where slug = 'aws'");
    assertEquals(await recruitOpen(q, "aws"), false);
    await q("update public.rooms set recruit_until = '2026-10-20' where slug = 'algo'");
    assertEquals(await recruitOpen(q, "algo"), false);               // ENDED
    // 실효 마감 = least(recruit_until, end_date) (Codex #3)
    await q("update public.rooms set archived_at = null, recruit_until = '2026-11-30', end_date = '2026-10-14' where slug = 'aws'");
    assertEquals((await one(q, "select to_char(public.room_recruit_until(r), 'YYYY-MM-DD') as v from public.rooms r where slug = 'aws'")).v, "2026-10-14");
    await setToday(q, "2026-10-15");
    assertEquals(await recruitOpen(q, "aws"), false);                // 종료일이 지나면 tick 전에도 닫힘
  } },
  { name: "assignment_resync: assign_from skips COMMON leaves that ended before it; others unchanged", run: async (q) => {
    const aws = await roomId(q, "aws");
    const late = await uidOf(q, "서연");
    const jieun = await uidOf(q, "지은");
    await q("insert into public.room_members (room_id, user_id, role, status, joined_at, assign_from) values ($1::bigint, $2::uuid, 'MEMBER', 'ACTIVE', now(), '2026-10-12')", [aws, late]);
    await q("select public.assignment_resync($1::bigint)", [aws]);
    assertEquals(await live(q, await nodeId(q, "aws", "IAM 정책 이해"), late), null);      // 10/01~10/03
    assertEquals(await live(q, await nodeId(q, "aws", "VPC 실습"), late), null);           // 10/04~10/07
    assertEquals(await live(q, await nodeId(q, "aws", "ALB vs NLB 실습"), late), true);    // 10/15~
    assertEquals(await live(q, await nodeId(q, "aws", "RDS·Aurora 비교"), late), true);
    assertEquals(await live(q, await nodeId(q, "aws", "IAM 정책 이해"), jieun), true);     // 기존 멤버 그대로
    // 나중에 만든 지난 날짜 공통 과제도 중간 합류자에겐 안 간다
    const r2 = (await one(q, "select n.id from public.goal_nodes n where n.room_id = $1::bigint and n.label = '2주차'", [aws])).id;
    const past = (await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                                values ($1::bigint, $2, $2, 3, 99, '지난 공통', '2026-10-08', '2026-10-11', 'COMMON') returning id::text as id`, [aws, r2])).id;
    const today = (await one(q, `insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
                                 values ($1::bigint, $2, $2, 3, 100, '오늘 마감', '2026-10-08', '2026-10-12', 'COMMON') returning id::text as id`, [aws, r2])).id;
    await q("select public.assignment_resync($1::bigint)", [aws]);
    assertEquals(await live(q, past, late), null);
    assertEquals(await live(q, past, jieun), true);
    assertEquals(await live(q, today, late), true);                  // 마감 = 합류일 → 배정
  } },
  { name: "invite_code_failures: closed to clients", run: async (q) => {
    const p = async (role: string, priv: string) => (await one(q, "select has_table_privilege($1, 'public.invite_code_failures', $2) as v", [role, priv])).v;
    for (const role of ["anon", "authenticated"]) for (const priv of ["select", "insert"]) assertEquals(await p(role, priv), false, `${role} ${priv}`);
  } },
]);
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db -- --filter "0032"`
Expected: FAIL(함수·열 없음).

- [ ] **Step 3: 마이그레이션 작성(앞부분)** — `supabase/migrations/0032_extra_recruit.sql`

```sql
-- 0032_extra_recruit.sql — 2026-10-20 추가 모집 · 초대 코드(바로 참가). 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-20-extra-recruit-design.md (D1~D13).
-- 추가형: 열·표·함수 추가 + 재정의(최신 판 복사). 기존 행 의미 무변경 — 기존 초대 행은 bypass_until null(바로 참가 꺼짐),
-- 기존 멤버는 assign_from null(처음부터 배정).
-- 재정의 원본: assignment_resync ←0014 · room_join_precheck·room_join·room_approve·room_decide_precheck ←0005 ·
--   room_tick·invite_ensure·room_matches ←0004 · invite_get·invite_rotate·invite_preview ←0005 · invite_join ←0024 ·
--   room_detail_json ←0026 · rooms_list ←0024 · notification_kinds ←0024 · notify_render ←0028

-- ───────── 1. 스키마 ─────────
alter table public.rooms        add column recruit_until date;   -- 추가 모집 마감일(KST, 포함). null = 추가 모집 아님. ACTIVE 에서만 의미(D1)
alter table public.room_members add column assign_from   date;   -- 진행중 합류일(KST). null = 모집 단계 합류(처음부터 배정, D6)
alter table public.room_invites add column code          varchar(8);            -- Crockford base32 8자(D9)
alter table public.room_invites add column bypass_until  date;                  -- 이 날(KST, 포함)까지 바로 참가. null = 꺼짐(D7)
alter table public.room_invites add column bypass_max    int;                   -- 바로 참가 인원 한도. null = 정원까지
alter table public.room_invites add column bypass_used   int not null default 0;
alter table public.room_invites add constraint ck_room_invites_code   check (code is null or code ~ '^[0-9A-HJKMNP-TV-Z]{8}$');
alter table public.room_invites add constraint ck_room_invites_bypass check (bypass_max is null or bypass_max between 1 and 100);
create unique index ux_room_invites_code on public.room_invites (code) where code is not null;

-- 코드 조회 실패만(성공은 저장 안 함 — Codex #7). 사용자별 실패 10회/1시간 제한(§6). 1일 지난 행은 room_tick 이 지운다.
-- 클라이언트 접근 없음 — DEFINER RPC 만
create table public.invite_code_failures (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ix_invite_code_failures_user on public.invite_code_failures (user_id, created_at);
create index ix_invite_code_failures_at   on public.invite_code_failures (created_at);   -- tick 정리용
alter table public.invite_code_failures enable row level security;
revoke all on public.invite_code_failures from anon, authenticated;

-- ───────── 2. 코드 ─────────
-- 입력 정규화(순수 헬퍼: INVOKER·GRANT 없음): 대문자, 공백·하이픈 제거, 헷갈리는 글자 O→0, I·L→1
create or replace function public.invite_code_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select translate(upper(regexp_replace(coalesce(p, ''), '[[:space:]-]', '', 'g')), 'OIL', '011')
$$;

-- 8자 Crockford base32(0-9A-Z − I L O U = 32자, 40bit). gen_random_uuid 의 랜덤 바이트(버전·변형 비트가 든 6·8번 제외) & 31
create or replace function public.invite_code_new() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_abc  constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_pick constant int[] := array[0, 1, 2, 3, 4, 5, 10, 11];
  v_b    bytea;
  v_code text;
  v_try  int := 0;
begin
  loop
    v_b := uuid_send(gen_random_uuid());
    v_code := '';
    for k in 1..8 loop
      v_code := v_code || substr(v_abc, 1 + (get_byte(v_b, v_pick[k]) & 31), 1);
    end loop;
    exit when not exists (select 1 from public.room_invites where code = v_code);
    v_try := v_try + 1;
    if v_try >= 5 then perform public.fail('INTERNAL', '초대 코드를 만들지 못했어요 · 다시 시도해 주세요'); end if;
  end loop;
  return v_code;
end $$;

-- 활성 초대 행에 코드 채우기(호스티드 기존 행). 행마다 따로 — 같은 문장 안의 중복을 피한다
do $$
declare t text;
begin
  for t in select token from public.room_invites where revoked_at is null and code is null loop
    update public.room_invites set code = public.invite_code_new() where token = t;
  end loop;
end $$;

-- ───────── 3. 모집 열림 판정 (D1) ─────────
-- 추가 모집 실효 마감(KST, 포함) = least(recruit_until, end_date). ACTIVE 가 아니거나 창이 없으면 null.
-- 종료일을 모집 마감보다 앞당겨도 저장값을 고치지 않고 여기서 자른다(Codex #3 — room_update 재정의 없음)
create or replace function public.room_recruit_until(r public.rooms) returns date
language sql stable security definer set search_path = '' as $$
  select case when r.status = 'ACTIVE' and r.recruit_until is not null then least(r.recruit_until, r.end_date) end
$$;

-- RECRUIT, 또는 ACTIVE 인데 추가 모집 창 안(실효 마감 포함). 보관 방은 언제나 닫힘
create or replace function public.room_recruit_open(r public.rooms) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.archived_at is null and (
       r.status = 'RECRUIT'
    or coalesce(public.room_recruit_until(r) >= public.kst_today(), false))
$$;

-- ───────── 4. assignment_resync (0014 판 + 1줄, D6) ─────────
```

이어서 0014 `assignment_resync` 전체를 복사하고 **1단계 insert 의 where 끝에 한 줄**만 더한다:

```sql
  where n.room_id = p_room and n.task_type = 'COMMON' and n.archived_at is null
    and m.room_id = p_room and m.status = 'ACTIVE' and (m.role = 'MEMBER' or v_ldt)
    and (m.assign_from is null or n.end_date >= m.assign_from)   -- 0032: 중간 합류자는 합류일 이후 마감 과제만(D6)
```

(2a·2b 해제 단계는 그대로 — 이미 있는 행은 건드리지 않으므로 기존 멤버·중간 합류자 모두 기존 배정을 잃지 않는다.)

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run test:db -- --filter "0032"` → PASS. 그다음 `npm run test:db` 전체 → PASS.

(커밋은 Task 4 끝에서 한 번 — 같은 파일을 이어 쓴다.)

---

### Task 2: 0032 (2) — 추가 모집 RPC · 관문 · 승인 · tick · `MEMBER_JOINED` (opus)

**Files:** Modify `supabase/migrations/0032_extra_recruit.sql`(뒤에 추가) · Modify `supabase/tests/extra-recruit-sql.test.ts`(묶음 추가)

**Interfaces:**
- 내부: `room_member_activate(r public.rooms, p_uid uuid, p_via text) → void` · `room_extra_recruit_expire(p_room bigint, p_actor uuid) → void`(**호출자가 방 행을 잠갔다고 가정**, 무조건 닫기 — 수동 마감·재개용) · `room_extra_recruit_auto_expire(p_room bigint) → boolean`(tick 용: 방 행 `for update` → 최신 상태 재검사 → 지났을 때만 닫기, Codex #1)
- 공개: `room_extra_recruit_open(p_slug text, p_until date, p_max_members int default null, p_join_mode text default null) → jsonb(RoomDetail)` · `room_extra_recruit_close(p_slug text) → jsonb(RoomDetail)`
- 재정의: `room_join_precheck` · `room_join` · `room_decide_precheck` · `room_approve` · `room_tick` · `notification_kinds` · `notify_render`
- 오류 코드: `ROOM_STATUS_INVALID` · `INVALID_PERIOD {field:'recruitUntil', maxDate}` · `CAPACITY_NO_SEAT {field:'maxMembers', memberCount}` · `VALIDATION_FAILED {field}`(정원 < 최소 인원이면 `{field:'maxMembers', minMembers}` — Codex #6) · 기존 `ROOM_NOT_RECRUITING`

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
cases("extra recruit 0032 · window", db, [
  { name: "open: leader·ACTIVE only; until today..min(end, today+30); needs a free seat; sets max & joinMode atomically", run: async (q) => {
    await as(q, "지은");
    await expectFail(openExtra(q, "aws", "2026-10-19"), "NOT_LEADER");
    await as(q, "민수");
    await expectFail(openExtra(q, "aws", "2026-10-11"), "INVALID_PERIOD");
    await expectFail(openExtra(q, "aws", "2026-11-12"), "INVALID_PERIOD");          // 오늘+31
    await expectFail(openExtra(q, "aws", "2026-10-19", 4), "CAPACITY_NO_SEAT");     // 4/4
    await expectFail(openExtra(q, "aws", "2026-10-19", 101), "VALIDATION_FAILED");
    await expectFail(openExtra(q, "aws", "2026-10-19", null, "free"), "VALIDATION_FAILED");
    await q("update public.rooms set min_members = 6 where slug = 'aws'");          // 최소 6 > 새 정원 5 > 참가 4
    await expectFail(openExtra(q, "aws", "2026-10-19", 5), "VALIDATION_FAILED");     // 원시 ck_rooms_members 오류가 아니라 fail (Codex #6)
    await q("update public.rooms set min_members = 3 where slug = 'aws'");
    const d = await openExtra(q, "aws", "2026-11-11", 7, "direct");                  // 경계 = 오늘+30
    assertEquals([d.recruit, d.maxMembers, d.joinMode, d.status], [{ open: true, extraUntil: "2026-11-11" }, 7, "direct", "active"]);
    await as(q, "서연");
    await expectFail(openExtra(q, "toeic", "2026-10-19"), "ROOM_STATUS_INVALID");    // RECRUIT
    await as(q, "현우");
    await expectFail(openExtra(q, "algo", "2026-10-19"), "ROOM_STATUS_INVALID");     // ENDED
    await q("update public.rooms set archived_at = now() where slug = 'aws'");
    await as(q, "민수");
    await expectFail(openExtra(q, "aws", "2026-10-19"), "ROOM_STATUS_INVALID");
  } },
  { name: "approval window: closed → ROOM_NOT_RECRUITING; open → apply·approve; late joiner gets only future COMMON", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    await as(q, "서연");
    await expectFail(rpc(q, "public.room_apply('aws')"), "ROOM_NOT_RECRUITING");
    await as(q, "민수");
    await openExtra(q, "aws", "2026-10-19");
    await as(q, "서연");
    assertEquals((await rpc(q, "public.room_apply('aws', null, '늦게 합류해요')")).me.state, "pending");
    assertEquals((await notes(q, "민수", "JOIN_REQUESTED", "aws")).length, 1);   // 시드에 같은 알림이 있으면 전후 차이로 바꾼다
    await as(q, "민수");
    const r = await rpc(q, "public.room_approve('aws', $1::uuid)", [seoyeon]);
    assertEquals(r.memberCount, 5);
    assertEquals(await memberRow(q, "aws", seoyeon), { status: "ACTIVE", assign_from: "2026-10-12" });
    assertEquals(await live(q, await nodeId(q, "aws", "VPC 실습"), seoyeon), null);
    assertEquals(await live(q, await nodeId(q, "aws", "ALB vs NLB 실습"), seoyeon), true);
    assertEquals((await notes(q, "민수", "MEMBER_JOINED", "aws")).length, 0);       // 승인은 그룹장이 한 일 — 알림 없음
  } },
  { name: "direct window: room_join works; MEMBER_JOINED to leader (via extra); RECRUIT direct join stays silent", run: async (q) => {
    await as(q, "태호");
    await openExtra(q, "react", "2026-10-20");
    await as(q, "서연");
    assertEquals((await rpc(q, "public.room_join('react')")).me.state, "active");
    const n = await notes(q, "태호", "MEMBER_JOINED", "react");
    assertEquals(n.length, 1);
    assertEquals(n[0].title, "서연님이 리액트 공식문서 함께 읽기에 합류했어요");
    assert((n[0].body as string).startsWith("추가 모집으로 참가했어요"));
    await as(q, "예린");
    await rpc(q, "public.room_join('toeic')");
    assertEquals((await notes(q, "서연", "MEMBER_JOINED", "toeic")).length, 0);
    assertEquals((await memberRow(q, "toeic", await uidOf(q, "예린"))).assign_from, null);
  } },
  { name: "close: expires PENDING with JOIN_EXPIRED; decisions blocked after; close twice → ROOM_STATUS_INVALID", run: async (q) => {
    const [seoyeon, gaeun] = [await uidOf(q, "서연"), await uidOf(q, "가은")];
    await as(q, "민수");
    await openExtra(q, "aws", "2026-10-19");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    await as(q, "가은"); await rpc(q, "public.room_apply('aws')");
    await as(q, "민수");
    const d = await rpc(q, "public.room_extra_recruit_close('aws')");
    assertEquals([d.recruit, d.pendingCount], [{ open: false, extraUntil: null }, 0]);
    for (const u of [seoyeon, gaeun]) assertEquals((await memberRow(q, "aws", u)).status, "EXPIRED");
    assertEquals((await notes(q, "서연", "JOIN_EXPIRED", "aws")).length, 1);
    await expectFail(rpc(q, "public.room_approve('aws', $1::uuid)", [seoyeon]), "ROOM_NOT_RECRUITING");
    await expectFail(rpc(q, "public.room_extra_recruit_close('aws')"), "ROOM_STATUS_INVALID");
    // 다시 열고 다시 신청해 다시 만료돼도 알림이 가게 dedupe 키에 txid 를 싣는다.
    // (사례 전체가 한 트랜잭션이라 txid 가 같아 두 번째 알림은 여기서 재현할 수 없다 — 키 모양만 고정)
    const key = (await one(q, "select n.dedupe_key from public.notifications n where n.kind = 'JOIN_EXPIRED' and n.user_id = $1::uuid", [seoyeon])).dedupe_key as string;
    assertMatch(key, new RegExp(`^JOIN_EXPIRED:${await roomId(q, "aws")}:extra:\\d+:`));
  } },
  { name: "tick: closes past windows; return shape unchanged", run: async (q) => {
    await as(q, "민수");
    await openExtra(q, "aws", "2026-10-13");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    await setToday(q, "2026-10-13");
    assertEquals((await one(q, "select public.room_tick() as r")).r, { activated: 0, ended: 0 });
    assertEquals(await recruitOpen(q, "aws"), true);                                 // 마감일 당일은 열림
    await setToday(q, "2026-10-14");
    assertEquals((await one(q, "select public.room_tick() as r")).r, { activated: 0, ended: 0 });
    assertEquals((await one(q, "select recruit_until from public.rooms where slug = 'aws'")).recruit_until, null);
    assertEquals((await memberRow(q, "aws", await uidOf(q, "서연"))).status, "EXPIRED");
  } },
  { name: "reopen after lapse without tick: old PENDING expires first; extending a live window keeps PENDING (Codex #2)", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    await as(q, "민수"); await openExtra(q, "aws", "2026-10-13");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    await setToday(q, "2026-10-15");                                                   // tick 없음
    await as(q, "민수");
    await expectFail(rpc(q, "public.room_approve('aws', $1::uuid)", [seoyeon]), "ROOM_NOT_RECRUITING");   // 지난 창은 승인 불가
    const d = await openExtra(q, "aws", "2026-10-20");
    assertEquals([d.recruit, d.pendingCount], [{ open: true, extraUntil: "2026-10-20" }, 0]);
    assertEquals((await memberRow(q, "aws", seoyeon)).status, "EXPIRED");
    assertEquals((await notes(q, "서연", "JOIN_EXPIRED", "aws")).length, 1);
    await expectFail(rpc(q, "public.room_approve('aws', $1::uuid)", [seoyeon]), "ALREADY_DECIDED");
    const gaeun = await uidOf(q, "가은");
    await as(q, "가은"); await rpc(q, "public.room_apply('aws')");
    await as(q, "민수"); await openExtra(q, "aws", "2026-10-25");                    // 열린 창 연장 → 대기 유지
    assertEquals((await memberRow(q, "aws", gaeun)).status, "PENDING");
  } },
  { name: "auto_expire re-checks fresh state: a window extended after the tick picked it is left alone (Codex #1)", run: async (q) => {
    const aws = await roomId(q, "aws");
    await as(q, "민수"); await openExtra(q, "aws", "2026-10-13");
    await setToday(q, "2026-10-14");
    // tick 이 후보로 고른 뒤(옛 상태) 그룹장이 먼저 다시 열었다고 가정 — 실제 두 연결 경쟁은 Task 9
    await openExtra(q, "aws", "2026-10-20");
    await as(q, "가은"); await rpc(q, "public.room_apply('aws')");
    assertEquals((await one(q, "select public.room_extra_recruit_auto_expire($1::bigint) as v", [aws])).v, false);
    assertEquals((await one(q, "select to_char(recruit_until, 'YYYY-MM-DD') as v from public.rooms where id = $1::bigint", [aws])).v, "2026-10-20");
    assertEquals((await memberRow(q, "aws", await uidOf(q, "가은"))).status, "PENDING");
    await setToday(q, "2026-10-21");
    assertEquals((await one(q, "select public.room_extra_recruit_auto_expire($1::bigint) as v", [aws])).v, true);
  } },
  { name: "tick ends only rooms whose end_date is still past after locking; counts only real transitions (Codex 2-2)", run: async (q) => {
    // PGlite 는 단일 연결 — 경쟁 자체는 Task 9. 여기선 "후보였어도 재판정에서 빠지면 세지 않는다"만 고정
    const r = await openRoom(q, USERS.서연, { maxMembers: 4 });
    await q("select public.room_start($1)", [r.slug]);
    await rpc(q, "public.room_update($1, $2::jsonb)", [r.slug, JSON.stringify({ endDate: "2026-11-08" })]);
    await setToday(q, "2026-11-09");
    const before = (await one(q, "select count(*)::int as n from public.rooms where status = 'ACTIVE' and archived_at is null and end_date < '2026-11-09'")).n;
    const t = (await one(q, "select public.room_tick() as r")).r;
    assertEquals(t.ended, before);                                                        // 실제 전이 수 = 후보 수(경쟁 없음)
    assertEquals((await one(q, "select status from public.rooms where slug = $1", [r.slug])).status, "ENDED");
  } },
  { name: "real end-date shortening: window capped by end_date; the ending tick expires PENDING in the same run (Codex #3)", run: async (q) => {
    const r = await openRoom(q, USERS.서연, { joinMode: "approval", maxMembers: 4 });   // 리프 11/01~11/07, 종료 11/28
    await q("select public.room_start($1)", [r.slug]);                                    // 10/12 → ACTIVE
    await openExtra(q, r.slug, "2026-11-11");
    await asUser(q, USERS.민수); await rpc(q, "public.room_apply($1)", [r.slug]);
    await asUser(q, USERS.서연);
    await rpc(q, "public.room_update($1, $2::jsonb)", [r.slug, JSON.stringify({ endDate: "2026-11-08" })]);   // 실제 단축(마지막 과제 11/07 이후)
    assertEquals((await rpc(q, "public.room_get($1)", [r.slug])).recruit, { open: true, extraUntil: "2026-11-08" });
    await setToday(q, "2026-11-09");
    assertEquals(await recruitOpen(q, r.slug), false);                                    // tick 전에도 닫힘
    await asUser(q, USERS.현우);
    await expectFail(rpc(q, "public.room_apply($1)", [r.slug]), "ROOM_NOT_RECRUITING");
    await q("select public.room_tick()");                                                 // 한 번의 tick 으로 종료 + 대기 만료
    const row = await one(q, "select status, recruit_until from public.rooms where slug = $1", [r.slug]);
    assertEquals([row.status, row.recruit_until], ["ENDED", null]);
    assertEquals((await memberRow(q, r.slug, USERS.민수)).status, "EXPIRED");
  } },
  { name: "kinds & grants", run: async (q) => {
    assert((await one(q, "select 'MEMBER_JOINED' = any(public.notification_kinds()) as v")).v);
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    assertEquals(await can("authenticated", "public.room_extra_recruit_open(text, date, integer, text)"), true);
    assertEquals(await can("authenticated", "public.room_extra_recruit_close(text)"), true);
    assertEquals(await can("anon", "public.room_extra_recruit_open(text, date, integer, text)"), false);
    for (const f of ["public.room_member_activate(public.rooms, uuid, text)", "public.room_extra_recruit_expire(bigint, uuid)", "public.room_extra_recruit_auto_expire(bigint)", "public.room_recruit_open(public.rooms)", "public.room_recruit_until(public.rooms)", "public.invite_code_new()"]) {
      assertEquals(await can("authenticated", f), false, f);
    }
  } },
]);
```

- [ ] **Step 2: 실패 확인** — `npm run test:db -- --filter "0032"` → 새 묶음 FAIL.

- [ ] **Step 3: 구현(0032 뒤에 추가)**

```sql
-- ───────── 5. 참가 공통: ACTIVE 로 만들기 (room_join·room_join_by_invite) ─────────
-- 진행중 방이면 assign_from = 오늘(D6) + 그룹장에게 MEMBER_JOINED(D11). 모집 단계면 지금과 같다(알림 없음)
create or replace function public.room_member_activate(r public.rooms, p_uid uuid, p_via text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from date := case when r.status = 'ACTIVE' then public.kst_today() end;
begin
  insert into public.room_members (room_id, user_id, role, status, joined_at, assign_from)
  values (r.id, p_uid, 'MEMBER', 'ACTIVE', now(), v_from)
  on conflict (room_id, user_id) do update
    set status = 'ACTIVE', role = 'MEMBER', joined_at = now(), left_at = null,
        decided_at = null, decided_by = null, assign_from = v_from, updated_at = now();
  perform public.assignment_resync(r.id);
  if r.status = 'ACTIVE' then
    perform public.notify_publish('MEMBER_JOINED', r.id, null, p_uid, array[r.leader_id],
      'MEMBER_JOINED:' || r.id || ':' || p_uid || ':' || txid_current(), jsonb_build_object('via', p_via));
  end if;
end $$;

-- ───────── 6. 관문 재정의 (0005 판) ─────────
```

`room_join_precheck` ← 0005 전체 복사, **한 군데만**:

```sql
  -- 0032: RECRUIT 전용 → 모집 열림(RECRUIT ∨ 추가 모집 창) (D1)
  if not public.room_recruit_open(r) then
    perform public.fail('ROOM_NOT_RECRUITING', '모집중인 방이 아니에요');
  end if;
```

(원본: `if r.archived_at is not null or r.status <> 'RECRUIT' then … end if;` — 보관 판정은 `room_recruit_open` 안에 있다.)

`room_join` ← 0005, 본문의 upsert·resync 를 헬퍼로:

```sql
create or replace function public.room_join(p_slug text, p_invite_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  perform public.room_join_precheck(r, v_uid, p_invite_token, 'DIRECT');
  perform public.room_take_seat(r.id);                       -- ROOM_FULL
  perform public.room_member_activate(r, v_uid, 'extra');    -- 0032: 진행중(추가 모집)이면 assign_from·MEMBER_JOINED
  return public.membership_result(r.id, v_uid);
end $$;
```

`room_decide_precheck` ← 0005, **한 군데만**:

```sql
  -- 0032: 추가 모집 창 안에서도 처리(창이 닫히면 대기는 EXPIRED 로 정리된다 — D4)
  if not public.room_recruit_open(r) then
    perform public.fail('ROOM_NOT_RECRUITING', '모집중인 방에서만 신청을 처리할 수 있어요');
  end if;
```

`room_approve` ← 0005, update 에 한 열만:

```sql
  update public.room_members
     set status = 'ACTIVE', joined_at = v_now, decided_at = v_now, decided_by = v_uid, updated_at = now(),
         assign_from = case when r.status = 'ACTIVE' then public.kst_today() end   -- 0032 (D6)
   where id = m.id;
```

```sql
-- ───────── 7. 추가 모집 열기·닫기 (D1~D4) ─────────
-- 창 닫기(내부): recruit_until null, 남은 PENDING → EXPIRED + JOIN_EXPIRED. 이미 닫혀 있으면 아무 일도 없다.
-- 호출자가 방 행을 잠갔다고 가정한다(room_extra_recruit_close·room_extra_recruit_open 은 room_lock, tick 은 auto_expire 경유)
create or replace function public.room_extra_recruit_expire(p_room bigint, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_expired uuid[];
begin
  update public.rooms set recruit_until = null, updated_at = now() where id = p_room and recruit_until is not null;
  if not found then return; end if;
  with x as (
    update public.room_members set status = 'EXPIRED', decided_at = now(), updated_at = now()
    where room_id = p_room and status = 'PENDING'
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_expired from x;
  if cardinality(v_expired) > 0 then
    -- 시작 때 만료(JOIN_EXPIRED:{room})와 겹치지 않게, 다시 열어 다시 만료돼도 알림이 가게 txid
    perform public.notify_publish('JOIN_EXPIRED', p_room, null, p_actor, v_expired,
      'JOIN_EXPIRED:' || p_room || ':extra:' || txid_current(), '{}'::jsonb);
  end if;
end $$;

-- 자동 만료(tick 용, Codex #1): 후보를 고른 뒤 그룹장이 연장·재개했을 수 있다 → 방 행을 잠그고 최신 상태로 다시 판정.
-- 닫을 조건 = 창이 있고 보관 아님 ∧ (ACTIVE 아님 ∨ 실효 마감 < 오늘). 닫았으면 true
create or replace function public.room_extra_recruit_auto_expire(p_room bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.recruit_until is null or r.archived_at is not null then return false; end if;
  if r.status = 'ACTIVE' and public.room_recruit_until(r) >= public.kst_today() then return false; end if;   -- 연장됨
  perform public.room_extra_recruit_expire(p_room, null);
  return true;
end $$;

-- 열기(이미 열려 있으면 마감일·정원·방식 바꾸기). 진행중·미보관, 마감일 = 오늘..min(종료일, 오늘+30), 빈자리 필수(D3).
-- 지난 창(실효 마감 < 오늘)이 tick 전이라 남아 있으면 먼저 만료시킨다 — 옛 PENDING 을 새 창으로 넘기지 않는다(Codex #2)
create or replace function public.room_extra_recruit_open(p_slug text, p_until date, p_max_members int default null, p_join_mode text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  v_max   int;
  v_last  date;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.archived_at is not null or r.status <> 'ACTIVE' then
    perform public.fail('ROOM_STATUS_INVALID', '진행중인 방에서만 추가 모집을 열 수 있어요');
  end if;
  v_last := least(r.end_date, v_today + 30);
  if p_until is null or p_until < v_today or p_until > v_last then
    perform public.fail('INVALID_PERIOD', '추가 모집 마감일은 오늘부터 30일 안, 스터디 종료일까지예요',
      jsonb_build_object('field', 'recruitUntil', 'maxDate', to_char(v_last, 'YYYY-MM-DD')));
  end if;
  v_max := coalesce(p_max_members, r.max_members);
  if v_max < 2 or v_max > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  -- Codex #6: ck_rooms_members(min ≤ max) 원시 오류 대신
  if r.min_members is not null and v_max < r.min_members then
    perform public.fail('VALIDATION_FAILED', format('정원은 최소 인원(%s명) 이상이어야 해요', r.min_members),
      jsonb_build_object('field', 'maxMembers', 'minMembers', r.min_members));
  end if;
  if v_max <= r.member_count then
    perform public.fail('CAPACITY_NO_SEAT', '빈자리가 없어요 · 정원을 늘려 주세요',
      jsonb_build_object('field', 'maxMembers', 'memberCount', r.member_count));
  end if;
  if p_join_mode is not null and p_join_mode not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;
  if r.recruit_until is not null and public.room_recruit_until(r) < v_today then
    perform public.room_extra_recruit_expire(r.id, v_uid);   -- Codex #2: 지난 창 정리(대기 만료 + 알림) 먼저
  end if;
  update public.rooms
     set recruit_until = p_until, max_members = v_max, join_mode = coalesce(upper(p_join_mode), join_mode), updated_at = now()
   where id = r.id;
  return public.room_detail_json(r.id, v_uid);
end $$;

create or replace function public.room_extra_recruit_close(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.recruit_until is null then perform public.fail('ROOM_STATUS_INVALID', '추가 모집 중이 아니에요'); end if;
  perform public.room_extra_recruit_expire(r.id, v_uid);
  return public.room_detail_json(r.id, v_uid);
end $$;

grant execute on function public.room_extra_recruit_open(text, date, int, text) to authenticated;
grant execute on function public.room_extra_recruit_close(text)                to authenticated;
```

`room_tick` ← 0004 판을 바탕으로 **본문 전체를 아래로 교체**(시그니처·반환 모양 `{activated, ended}` 동일). 바뀐 점:
- (Codex 2-2) 두 전이 루프 모두 후보를 잠금 없이 고른 뒤 **방 행을 `for update` 로 잠그고 `status`·`archived_at`·날짜를 다시 본다**. 그 사이 `room_update` 로 종료일(시작일)을 바꿨으면 전이하지 않는다. `room_transition_ended`/`active` 의 조건부 UPDATE 는 잠금 대기 뒤 `status` 만 재평가하기 때문. 실제로 전이한 것만 센다.
- 창 정리 루프는 ACTIVE→ENDED 루프 **뒤** — 이 tick 에서 막 ENDED 가 된 방(종료일 단축 포함)의 대기 신청을 **같은 트랜잭션**에서 만료(Codex #3).

```sql
create or replace function public.room_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.kst_today();
  v_id    bigint;
  r       public.rooms;
  v_act   int := 0;
  v_end   int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('room_tick'));
  for v_id in
    select id from public.rooms where status = 'RECRUIT' and archived_at is null and start_date <= v_today order by id
  loop
    -- 0032 (Codex 2-2): 잠근 뒤 최신 상태로 재판정 — 그 사이 시작일을 미뤘거나 보관했으면 건너뛴다
    select * into r from public.rooms where id = v_id for update;
    if r.status = 'RECRUIT' and r.archived_at is null and r.start_date <= v_today then
      perform public.room_transition_active(v_id, null);
      v_act := v_act + 1;
    end if;
  end loop;
  for v_id in
    select id from public.rooms where status = 'ACTIVE' and archived_at is null and end_date < v_today order by id
  loop
    -- 0032 (Codex 2-2): 그 사이 종료일을 연장했으면 끝내지 않는다
    select * into r from public.rooms where id = v_id for update;
    if r.status = 'ACTIVE' and r.archived_at is null and r.end_date < v_today then
      perform public.room_transition_ended(v_id);
      v_end := v_end + 1;
    end if;
  end loop;
  -- 0032: 추가 모집 창 정리 — 실효 마감(least(recruit_until, end_date))이 지났거나 방이 더는 ACTIVE 가 아니면 닫고 대기 만료(D4).
  -- 후보는 잠금 없이 고르고, 닫기는 auto_expire 가 방 행을 잠근 뒤 다시 판정한다(그 사이 연장·재개됐으면 손대지 않음 — Codex #1).
  -- 보관 방은 건드리지 않는다(풀린 뒤 다음 tick). 반환 모양 {activated, ended} 는 기존 테스트가 고정 — 세지 않는다
  for v_id in
    select id from public.rooms
    where recruit_until is not null and archived_at is null
      and (status <> 'ACTIVE' or least(recruit_until, end_date) < v_today)
    order by id
  loop
    perform public.room_extra_recruit_auto_expire(v_id);
  end loop;
  -- 0032: 초대 코드 조회 실패 기록 정리(1일 지난 것, Codex #7) — job_cleanup(0030) 재정의를 피해 여기서
  delete from public.invite_code_failures where created_at < public.app_now() - interval '1 day';
  return jsonb_build_object('activated', v_act, 'ended', v_end);
end $$;
```

(0004 판의 주석 "보관 방·DRAFT 는 건드리지 않는다" 는 그대로 유지된다 — 후보·재판정 모두 `archived_at is null`.)

```sql
-- ───────── 8. 알림 MEMBER_JOINED (D11) ─────────
```

`notification_kinds` ← Task 0 이 확정한 최신 판(0024) 복사, 배열 끝에:

```sql
               -- 0032
               , 'MEMBER_JOINED'
```

(배열 마지막 원소 뒤 쉼표 위치에 맞춰 넣는다.)

`notify_render` ← 같은 기준의 최신 판 복사. 제목 `case p_kind` 의 마지막 `when` 뒤에:

```sql
    -- 0032
    when 'MEMBER_JOINED'          then format('%s님이 %s에 합류했어요', v_actor, v_room)
```

본문 `v_body := case` 의 **첫 `when` 앞**에:

```sql
    when p_kind = 'MEMBER_JOINED' then
      case p_model ->> 'via' when 'invite' then '초대로 바로 참가했어요' else '추가 모집으로 참가했어요' end
      || ' · 지정 과제 담당이 필요하면 진행목표에서 정해 주세요'
```

기존 분기 순서·문구는 건드리지 않는다. `notify_link` 는 재정의하지 않는다(그룹장 기본 갈래 `/my-study/{slug}`).

- [ ] **Step 4: 통과 확인** — `npm run test:db -- --filter "0032"` → PASS, `npm run test:db` 전체 → PASS(특히 `_cases-membership.ts` 의 `ROOM_NOT_RECRUITING` 단언, `backlog-0028-sql.test.ts` 보관 방 승인 차단, `_cases-rooms.ts` tick 단언).

---

### Task 3: 0032 (3) — 초대: 코드 · 바로 참가 · 코드 조회 (opus)

**Files:** Modify `0032_extra_recruit.sql` · Modify `extra-recruit-sql.test.ts` · Modify `supabase/tests/_cases-membership.ts`(invite_get 단언 1곳)

**Interfaces:**
- 내부: `invite_bypass_ok(i public.room_invites, r public.rooms) → boolean` · `invite_json(i public.room_invites, r public.rooms) → jsonb` · `room_join_by_invite(p_slug text, p_token text) → jsonb`
- 공개: `invite_bypass_set(p_slug text, p_until date, p_max int default null) → jsonb(InviteLink)` · `invite_code_lookup(p_code text) → jsonb {found:true,url} | {found:false,remaining}`
- 재정의: `invite_ensure`(코드 채움) · `invite_get`·`invite_rotate`(반환 = `invite_json`) · `invite_join`(바로 참가 갈래) · `invite_preview`(`join`·`room.recruitUntil`)
- InviteLink 응답 = `{today, token, url, code, bypass: null | {until, max, used, active}}` — 기존 3키 유지
- 오류: `INVITE_EXPIRED`(바로 참가 판정이 잠금 뒤 거짓) · `RATE_LIMITED {retryAfterMinutes}` · 기존 `ROOM_FULL`·`MEMBER_NOT_ACTIVE`·`OWNER_CANNOT_JOIN`·`ALREADY_MEMBER`

- [ ] **Step 1: 기존 단언 고치기** — `supabase/tests/_cases-membership.ts` "invite_get/rotate: leader only, seed token, rotation revokes old"

```ts
      const [{ g }] = await q(`select public.invite_get($1) as g`, ["docker"]);
      // 0032: code·bypass 가 붙었다 — 기존 3키는 그대로
      assertEquals({ today: g.today, token: g.token, url: g.url }, { today: TODAY, token: "seed-docker", url: "/invite/seed-docker" });
      assertEquals([/^[0-9A-HJKMNP-TV-Z]{8}$/.test(g.code), g.bypass], [true, null]);
```

- [ ] **Step 2: 실패하는 테스트 추가** — `extra-recruit-sql.test.ts`

```ts
const bypassSet = (q: Q, slug: string, until: string | null, max: number | null = null) =>
  rpc(q, "public.invite_bypass_set($1, $2::date, $3::int)", [slug, until, max]);

cases("extra recruit 0032 · invite", db, [
  { name: "invite_get fills code lazily for seed rows; bypass_set; rotate → new token+code, bypass off", run: async (q) => {
    await as(q, "민수");
    const g = await rpc(q, "public.invite_get('aws')");
    assertEquals([g.token, g.url, g.bypass], ["seed-aws", "/invite/seed-aws", null]);
    assertMatch(g.code, CODE_RE);
    assertEquals((await rpc(q, "public.invite_get('aws')")).code, g.code);          // 한 번 정하면 그대로
    const b = await bypassSet(q, "aws", "2026-10-19", 2);
    assertEquals(b.bypass, { until: "2026-10-19", max: 2, used: 0, active: true });
    const n = await rpc(q, "public.invite_rotate('aws')");
    assertNotEquals(n.token, "seed-aws");
    assertNotEquals(n.code, g.code);
    assertEquals(n.bypass, null);
    assertEquals((await bypassSet(q, "aws", null)).bypass, null);                   // 끄기
  } },
  { name: "bypass_set validation", run: async (q) => {
    await as(q, "지은");
    await expectFail(bypassSet(q, "aws", "2026-10-19"), "NOT_LEADER");
    await as(q, "현우");
    await expectFail(bypassSet(q, "algo", "2026-10-19"), "ROOM_STATUS_INVALID");    // ENDED
    await as(q, "민수");
    await expectFail(bypassSet(q, "aws", "2026-10-11"), "INVALID_PERIOD");
    await expectFail(bypassSet(q, "aws", "2026-11-12"), "INVALID_PERIOD");           // 오늘+31
    await expectFail(bypassSet(q, "aws", "2026-10-19", 0), "VALIDATION_FAILED");
    await as(q, "수민");
    await expectFail(bypassSet(q, "jcg", "2026-11-05"), "INVALID_PERIOD");           // jcg 종료 11/01 넘김
    assertEquals((await bypassSet(q, "jcg", "2026-10-19")).bypass.active, true);    // 모집중 방에서도 켤 수 있다
    // 실효 기한 = least(bypass_until, end_date): 종료일이 당겨지면 기한도 따라 줄어든다 (Codex #3)
    await q("update public.rooms set start_date = '2026-10-12', end_date = '2026-10-15' where slug = 'jcg'");   // ck_rooms_period(시작 ≤ 종료)
    assertEquals((await rpc(q, "public.invite_get('jcg')")).bypass.until, "2026-10-15");
    await setToday(q, "2026-10-16");
    assertEquals((await rpc(q, "public.invite_get('jcg')")).bypass.active, false);
  } },
  { name: "old invites stay closed for ACTIVE rooms (no bypass) — preview join.mode null", run: async (q) => {
    await as(q, "서연");
    const p = await rpc(q, "public.invite_preview('seed-aws')");
    assertEquals(p.join, { mode: null, via: null, until: null });
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "ROOM_NOT_RECRUITING");
    const t = await rpc(q, "public.invite_preview('seed-toeic')");
    assertEquals(t.join, { mode: "direct", via: "recruit", until: null });
  } },
  { name: "bypass join on closed ACTIVE approval room: direct ACTIVE, assign_from, used+1, MEMBER_JOINED; limit → falls back", run: async (q) => {
    const seoyeon = await uidOf(q, "서연");
    await as(q, "민수");
    await bypassSet(q, "aws", "2026-10-19", 1);
    await as(q, "서연");
    assertEquals((await rpc(q, "public.invite_preview('seed-aws')")).join, { mode: "direct", via: "invite", until: "2026-10-19" });
    const r = await rpc(q, "public.invite_join('seed-aws')");
    assertEquals([r.me.state, r.memberCount], ["active", 5]);
    assertEquals(await memberRow(q, "aws", seoyeon), { status: "ACTIVE", assign_from: "2026-10-12" });
    assertEquals(await live(q, await nodeId(q, "aws", "IAM 정책 이해"), seoyeon), null);
    assertEquals((await one(q, "select bypass_used from public.room_invites where token = 'seed-aws'")).bypass_used, 1);
    const n = await notes(q, "민수", "MEMBER_JOINED", "aws");
    assertEquals(n.length, 1);
    assert((n[0].body as string).startsWith("초대로 바로 참가했어요"));
    await as(q, "가은");
    assertEquals((await rpc(q, "public.invite_preview('seed-aws')")).join.mode, null);   // 한도 소진
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "ROOM_NOT_RECRUITING");
    // 기한 지남
    await as(q, "민수");
    await bypassSet(q, "aws", "2026-10-19", null);
    await setToday(q, "2026-10-20");
    await as(q, "가은");
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "ROOM_NOT_RECRUITING");
  } },
  { name: "bypass edges: INACTIVE, leader, PENDING promoted, full, RECRUIT approval room direct, archived hidden", run: async (q) => {
    const aws = await roomId(q, "aws");
    await as(q, "민수");
    await bypassSet(q, "aws", "2026-10-19");
    await as(q, "도윤");
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "MEMBER_NOT_ACTIVE");
    await as(q, "민수");
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "OWNER_CANNOT_JOIN");
    const gaeun = await uidOf(q, "가은");
    await q("insert into public.room_members (room_id, user_id, role, status, applied_at) values ($1::bigint, $2::uuid, 'MEMBER', 'PENDING', now())", [aws, gaeun]);
    await as(q, "가은");
    assertEquals((await rpc(q, "public.invite_join('seed-aws')")).me.state, "active");
    // 꽉 찬 비공개 진행중 방
    await as(q, "지훈");
    await bypassSet(q, "spring", "2026-10-19");
    await as(q, "서연");
    await expectFail(rpc(q, "public.invite_join('seed-spring')"), "ROOM_FULL");
    // 모집중 승인제 방에서도 바로 참가 초대면 승인 없이
    await as(q, "가은");
    await bypassSet(q, "sqld", "2026-10-19");
    await as(q, "서연");
    assertEquals((await rpc(q, "public.invite_join('seed-sqld')")).me.state, "active");
    assertEquals((await memberRow(q, "sqld", await uidOf(q, "서연"))).assign_from, null);
    // 보관 방은 초대 자체가 숨겨진다
    await q("update public.rooms set archived_at = now() where id = $1::bigint", [aws]);
    await as(q, "예린");
    await expectFail(rpc(q, "public.invite_join('seed-aws')"), "INVITE_NOT_FOUND");
  } },
  { name: "invite_code_lookup: normalized hit; misses are recorded & limited (10/h); rotated code still routes; anon blocked", run: async (q) => {
    await setNow(q, "2026-10-12T03:00:00Z");
    await as(q, "민수");
    const code = (await rpc(q, "public.invite_get('aws')")).code as string;
    await as(q, "서연");
    const messy = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `;
    assertEquals(await rpc(q, "public.invite_code_lookup($1)", [messy]), { found: true, url: "/invite/seed-aws" });
    const miss = code === "ZZZZZZZZ" ? "YYYYYYYY" : "ZZZZZZZZ";
    for (let i = 9; i >= 0; i--) assertEquals(await rpc(q, "public.invite_code_lookup($1)", [miss]), { found: false, remaining: i });
    await expectFail(rpc(q, "public.invite_code_lookup($1)", [code]), "RATE_LIMITED");   // 맞는 코드도 막힌다
    const fails = async () => (await one(q, "select count(*)::int as n from public.invite_code_failures where user_id = $1::uuid", [await uidOf(q, "서연")])).n;
    assertEquals(await fails(), 10);                                                       // 성공(첫 조회)은 저장 안 함 (Codex #7)
    await setNow(q, "2026-10-12T04:01:00Z");
    assertEquals((await rpc(q, "public.invite_code_lookup('abc')")).found, false);         // 모양이 틀려도 실패로 센다
    // tick 이 1일 지난 실패를 지운다 (요청 사이 커밋 지속성은 Task 9 실 DB 에서)
    await setNow(q, "2026-10-13T05:00:00Z");
    await q("select public.room_tick()");
    assertEquals(await fails(), 0);
    // 회전된 코드 → 옛 링크로 보낸다(랜딩이 INVITE_REVOKED 를 보여 줌), 실패로 세지 않음
    await as(q, "민수");
    await rpc(q, "public.invite_rotate('aws')");
    await as(q, "예린");
    assertEquals(await rpc(q, "public.invite_code_lookup($1)", [code]), { found: true, url: "/invite/seed-aws" });
    await expectFail(rpc(q, "public.invite_preview('seed-aws')"), "INVITE_REVOKED");
    await asAnon(q);
    await expectFail(rpc(q, "public.invite_code_lookup($1)", [code]), "AUTH_REQUIRED");
  } },
  { name: "invite grants", run: async (q) => {
    const can = async (role: string, fn: string) => (await one(q, "select has_function_privilege($1, $2, 'execute') as v", [role, fn])).v;
    assertEquals(await can("authenticated", "public.invite_bypass_set(text, date, integer)"), true);
    assertEquals(await can("authenticated", "public.invite_code_lookup(text)"), true);
    assertEquals(await can("anon", "public.invite_code_lookup(text)"), false);
    assertEquals(await can("anon", "public.invite_preview(text)"), true);                   // 기존 그대로
    for (const f of ["public.room_join_by_invite(text, text)", "public.invite_json(public.room_invites, public.rooms)", "public.invite_bypass_ok(public.room_invites, public.rooms)"]) {
      assertEquals(await can("authenticated", f), false, f);
    }
  } },
]);
```

- [ ] **Step 3: 실패 확인** — `npm run test:db -- --filter "0032"` → invite 묶음 FAIL.

- [ ] **Step 4: 구현(0032 뒤에 추가)**

```sql
-- ───────── 9. 초대: 판정 · JSON (D7·D8) ─────────
create or replace function public.invite_bypass_ok(i public.room_invites, r public.rooms) returns boolean
language sql stable security definer set search_path = '' as $$
  -- 실효 기한 = least(bypass_until, 방 종료일) (Codex #3 — 종료일 단축 대응)
  select i.revoked_at is null and i.bypass_until is not null and least(i.bypass_until, r.end_date) >= public.kst_today()
     and (i.bypass_max is null or i.bypass_used < i.bypass_max)
     and r.archived_at is null and r.status in ('RECRUIT', 'ACTIVE')
$$;

-- invite_get·invite_rotate·invite_bypass_set 응답(InviteLink) — 기존 키 today/token/url 유지 + code·bypass
create or replace function public.invite_json(i public.room_invites, r public.rooms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'token', i.token, 'url', '/invite/' || i.token, 'code', i.code,
    'bypass', case when i.bypass_until is null then null else jsonb_build_object(
      'until', to_char(least(i.bypass_until, r.end_date), 'YYYY-MM-DD'), 'max', i.bypass_max, 'used', i.bypass_used,   -- 실효 기한
      'active', public.invite_bypass_ok(i, r)) end)
$$;
```

`invite_ensure` ← 0004 전체 복사, 본문을:

```sql
declare v_token text; v_code text;
begin
  select token, code into v_token, v_code from public.room_invites where room_id = p_room and revoked_at is null;
  if v_token is null then
    -- 동시 요청이면 ux_room_invites_active 에 걸린다 → 23505 원문 대신 이긴 쪽 토큰을 다시 읽는다 (D9)
    insert into public.room_invites (token, room_id, created_by, code)
    values (replace(gen_random_uuid()::text, '-', ''), p_room, p_by, public.invite_code_new())   -- 0032: 코드도
    on conflict do nothing;
    select token into v_token from public.room_invites where room_id = p_room and revoked_at is null;
  elsif v_code is null then
    -- 0032: 코드 없는 기존 행(로컬 seed 등) — 처음 볼 때 채운다
    update public.room_invites set code = public.invite_code_new() where token = v_token and code is null;
  end if;
  return v_token;
end $$;
```

`invite_get` ← 0005, 마지막 `return` 을:

```sql
  v_token := public.invite_ensure(r.id, v_uid);
  select * into i from public.room_invites where token = v_token;
  return public.invite_json(i, r);   -- 0032: code·bypass
```

(`declare` 에 `i public.room_invites;` 추가.) `invite_rotate` ← 0005 도 같은 방식으로 마지막 `return` 교체(회전 = 새 행 → 바로 참가 꺼짐).

```sql
-- ───────── 10. 바로 참가 설정 (그룹장) ─────────
-- p_until null = 끄기. 켜기: 오늘..min(종료일, 오늘+30). 켜져 있던 상태에서 바꾸면 사용 수는 유지, 꺼져 있다 켜면 0부터
create or replace function public.invite_bypass_set(p_slug text, p_until date, p_max int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  i       public.room_invites;
  v_token text;
  v_last  date;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 초대 설정을 바꿀 수 있어요');
  if r.archived_at is not null or r.status not in ('RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_STATUS_INVALID', '모집중이거나 진행중인 방에서만 바꿀 수 있어요');
  end if;
  v_last := least(r.end_date, v_today + 30);
  if p_until is not null and (p_until < v_today or p_until > v_last) then
    perform public.fail('INVALID_PERIOD', '바로 참가 기한은 오늘부터 30일 안, 스터디 종료일까지예요',
      jsonb_build_object('field', 'bypassUntil', 'maxDate', to_char(v_last, 'YYYY-MM-DD')));
  end if;
  if p_max is not null and (p_max < 1 or p_max > 100) then
    perform public.fail('VALIDATION_FAILED', '인원 한도는 1~100명이에요', '{"field":"bypassMax"}'::jsonb);
  end if;
  v_token := public.invite_ensure(r.id, v_uid);
  update public.room_invites
     set bypass_used  = case when bypass_until is null then 0 else bypass_used end,
         bypass_until = p_until,
         bypass_max   = case when p_until is null then null else p_max end
   where token = v_token
  returning * into i;
  return public.invite_json(i, r);
end $$;

-- ───────── 11. 바로 참가 (내부, invite_join 이 부른다) ─────────
-- 잠금: 방 → 초대 행. 잠근 뒤 다시 판정(동시 한도). 정원은 지킨다(D3). PENDING 이면 승인 없이 승격
create or replace function public.room_join_by_invite(p_slug text, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; i public.room_invites; m public.room_members;
begin
  r := public.room_lock(p_slug);
  select * into i from public.room_invites where token = p_token and room_id = r.id for update;
  if not found or not public.invite_bypass_ok(i, r) then
    perform public.fail('INVITE_EXPIRED', '바로 참가 기한이 끝났거나 인원이 찼어요 · 그룹장에게 문의해 주세요');
  end if;
  if r.leader_id = v_uid then perform public.fail('OWNER_CANNOT_JOIN', '그룹장은 이미 참가자예요'); end if;
  select * into m from public.room_members where room_id = r.id and user_id = v_uid;
  if found then
    if m.status = 'ACTIVE' then perform public.fail('ALREADY_MEMBER', '이미 참가한 방이에요'); end if;
    if m.status = 'INACTIVE' then perform public.fail('MEMBER_NOT_ACTIVE', '이탈 처리된 방에는 다시 참가할 수 없어요'); end if;
  end if;
  perform public.room_take_seat(r.id);                       -- ROOM_FULL
  perform public.room_member_activate(r, v_uid, 'invite');
  update public.room_invites set bypass_used = bypass_used + 1 where token = i.token;
  return public.membership_result(r.id, v_uid);
end $$;
```

`invite_join` ← **0024** 판 복사(시그니처 `(p_token text, p_message text default null)` 그대로):

```sql
create or replace function public.invite_join(p_token text, p_message text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; i public.room_invites;   -- require_user() 를 resolve 보다 먼저: 비로그인은 INVITE_* 대신 AUTH_REQUIRED
begin
  r := public.invite_resolve(p_token);
  select * into i from public.room_invites where token = p_token;
  -- 0032: 바로 참가 초대 → 모집 상태·참가 방식과 무관하게 바로(D8). 아니면 지금과 같음(precheck 가 모집 열림 판정)
  if public.invite_bypass_ok(i, r) then return public.room_join_by_invite(r.slug, p_token); end if;
  if r.join_mode = 'DIRECT' then return public.room_join(r.slug, p_token); end if;
  return public.room_apply(r.slug, p_token, p_message);
end $$;
```

`invite_preview` ← 0005 전체 복사. `declare` 에 `i public.room_invites; v_bypass boolean; v_open boolean;`, `r := …resolve…` 다음에:

```sql
  select * into i from public.room_invites where token = p_token;
  v_bypass := public.invite_bypass_ok(i, r);
  v_open   := public.room_recruit_open(r);
```

`'room'` 객체에 `'recruitUntil', case when v_open then to_char(public.room_recruit_until(r), 'YYYY-MM-DD') end` 를, 최상위에 아래 키를 더한다(`'me'` 다음):

```sql
    -- 0032: 지금 이 초대로 할 수 있는 것. mode null = 참가 불가(종료·모집 끝)
    'join', jsonb_build_object(
      'mode',  case when v_bypass then 'direct' when v_open then lower(r.join_mode) end,
      'via',   case when v_bypass then 'invite' when v_open and r.status = 'ACTIVE' then 'extra' when v_open then 'recruit' end,
      'until', case when v_bypass then to_char(least(i.bypass_until, r.end_date), 'YYYY-MM-DD')   -- 실효 기한
                    when v_open and r.status = 'ACTIVE' then to_char(public.room_recruit_until(r), 'YYYY-MM-DD') end)
```

```sql
-- ───────── 12. 코드 조회 (D9·D10, §6) ─────────
-- 로그인 필수. 사용자별 실패 10회/1시간. 못 찾음은 "반환"한다 — fail 로 던지면 실패 기록 INSERT 가 롤백돼 제한이 무력해진다.
-- 실패만 기록한다(성공·회전 코드 적중은 저장 안 함 — Codex #7). 정리는 room_tick(1일).
-- 회전된 코드는 옛 링크로 보낸다(랜딩이 INVITE_REVOKED 를 보여 준다) — 실패로 세지 않는다.
-- 한계: 사용자별 제한이라 여러 계정으로 나눠 시도하는 것은 막지 못한다(스펙 §6 — 필요하면 요청/IP 제한을 따로 설계)
create or replace function public.invite_code_lookup(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_code  text := public.invite_code_norm(p_code);
  v_limit constant int := 10;
  v_fails int;
  v_token text;
begin
  perform pg_advisory_xact_lock(hashtextextended('sgtudy.invite_code:' || v_uid, 0));
  select count(*)::int into v_fails from public.invite_code_failures
  where user_id = v_uid and created_at > public.app_now() - interval '1 hour';
  if v_fails >= v_limit then
    perform public.fail('RATE_LIMITED', '코드를 너무 많이 틀렸어요 · 1시간 뒤에 다시 시도해 주세요', '{"retryAfterMinutes":60}'::jsonb);
  end if;
  if v_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$' then
    select token into v_token from public.room_invites where code = v_code;
  end if;
  if v_token is null then
    insert into public.invite_code_failures (user_id, created_at) values (v_uid, public.app_now());
    return jsonb_build_object('found', false, 'remaining', v_limit - v_fails - 1);
  end if;
  return jsonb_build_object('found', true, 'url', '/invite/' || v_token);
end $$;

grant execute on function public.invite_bypass_set(text, date, int) to authenticated;
grant execute on function public.invite_code_lookup(text)           to authenticated;
```

- [ ] **Step 5: 통과 확인** — `npm run test:db -- --filter "0032"` · `npm run test:db -- --filter "membership"` → PASS, 그다음 전체.

---

### Task 4: 0032 (4) — 읽기: `room_detail_json` · `rooms_list` · `room_matches` · `me_studies` · `curriculum_json` + 커밋 (opus)

**Files:** Modify `0032_extra_recruit.sql` · Modify `extra-recruit-sql.test.ts`

**Interfaces:**
- `RoomDetail.recruit = {open: boolean, extraUntil: string | null}`(모두에게) · `RoomDetail.invite` = 그룹장에게 `invite_json − today`(`url` 키 유지), 그 외 null
- `RoomCardDto.recruitUntil: string | null`(ACTIVE ∧ 창 열림일 때만), `isFull` = 모집 열림 ∧ 꽉 참
- `rooms_list(p_status='recruit')` 가 추가 모집 중인 ACTIVE 방을 포함(D5)
- `me_studies`(←0024): 모집 열린 ACTIVE 방의 내 PENDING → `recruit` 그룹 항목, `when = {kind:'recruitEnd', date: 실효 마감}`(Codex #4, 스펙 D14)
- `curriculum_json`(←0024): `members[].assignFrom: 'YYYY-MM-DD' | null`(Codex #5) — 그룹장·ACTIVE/INACTIVE 멤버 호출일 때만 키가 있다(Codex 2-6)

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
cases("extra recruit 0032 · reads", db, [
  { name: "list: recruit filter includes extra window; card fields; still under active", run: async (q) => {
    await as(q, "민수");
    await openExtra(q, "aws", "2026-10-19");
    await asAnon(q);
    const rec = await rpc(q, "public.rooms_list('public', 'recruit')");
    const aws = (rec.items as Row[]).find((x) => x.slug === "aws")!;
    assertEquals([aws.status, aws.recruitUntil, aws.isFull], ["active", "2026-10-19", false]);
    assert(((await rpc(q, "public.rooms_list('public', 'active')")).items as Row[]).some((x) => x.slug === "aws"));
    // 창 없는 ACTIVE 방: least(NULL, end_date) 회귀 방지(Codex 2-1) — 꽉 차도 isFull false, recruitUntil null
    await q("update public.rooms set member_count = max_members where slug = 'react'");
    const react = ((await rpc(q, "public.rooms_list('public', 'active')")).items as Row[]).find((x) => x.slug === "react")!;
    assertEquals([react.recruitUntil, react.isFull], [null, false]);
    assert(!((await rpc(q, "public.rooms_list('public', 'recruit')")).items as Row[]).some((x) => x.slug === "react"));
    await q("update public.rooms set member_count = max_members where slug = 'aws'");
    const full = ((await rpc(q, "public.rooms_list('public', 'recruit')")).items as Row[]).find((x) => x.slug === "aws")!;
    assertEquals(full.isFull, true);
    await setToday(q, "2026-10-20");
    assert(!((await rpc(q, "public.rooms_list('public', 'recruit')")).items as Row[]).some((x) => x.slug === "aws"));
  } },
  { name: "detail: recruit for everyone; invite (code, bypass) only for leader", run: async (q) => {
    await as(q, "민수");
    await rpc(q, "public.invite_get('aws')");                       // seed 행 코드 채우기
    await openExtra(q, "aws", "2026-10-19");
    await asAnon(q);
    const anon = await rpc(q, "public.room_get('aws')");
    assertEquals([anon.recruit, anon.invite], [{ open: true, extraUntil: "2026-10-19" }, null]);
    await as(q, "지은");
    assertEquals((await rpc(q, "public.room_get('aws')")).invite, null);
    await as(q, "민수");
    const d = await rpc(q, "public.room_get('aws')");
    assertEquals([d.invite.url, d.invite.token, d.invite.bypass, "today" in d.invite], ["/invite/seed-aws", "seed-aws", null, false]);
    assertMatch(d.invite.code, CODE_RE);
    assertEquals((await rpc(q, "public.room_get('toeic')")).recruit, { open: true, extraUntil: null });
  } },
  { name: "me_studies: PENDING in an open extra window shows under recruit with recruitEnd; hidden once closed (Codex #4)", run: async (q) => {
    await as(q, "민수"); await openExtra(q, "aws", "2026-10-19");
    await as(q, "서연"); await rpc(q, "public.room_apply('aws')");
    const g = (await rpc(q, "public.me_studies()")).groups as Row[];
    const rec = g.find((x) => x.kind === "recruit")!.items as Row[];
    const it = rec.find((x) => x.slug === "aws")!;
    assertEquals([it.membership, it.when], ["pending", { kind: "recruitEnd", date: "2026-10-19" }]);
    assert(!(g.find((x) => x.kind === "active")!.items as Row[]).some((x) => x.slug === "aws"));
    await setToday(q, "2026-10-20");                                                   // 창 지남(tick 전)
    assert(!((await rpc(q, "public.me_studies()")).groups as Row[]).flatMap((x) => x.items as Row[]).some((x) => x.slug === "aws"));
  } },
  { name: "curriculum_json: members carry assignFrom (null for recruit-phase members) (Codex #5)", run: async (q) => {
    await as(q, "민수"); await rpc(q, "public.invite_bypass_set('aws', '2026-10-19'::date, null)");
    await as(q, "서연"); await rpc(q, "public.invite_join('seed-aws')");
    await as(q, "민수");
    const ms = (await rpc(q, "public.curriculum_get('aws', true)")).members as Row[];
    assertEquals(ms.find((m) => m.nickname === "서연")!.assignFrom, "2026-10-12");
    assertEquals(ms.find((m) => m.nickname === "지은")!.assignFrom, null);
    // 공개 방이라도 익명·외부인에게는 키 자체가 없다 (Codex 2-6)
    await asAnon(q);
    assert(((await rpc(q, "public.curriculum_get('aws', false)")).members as Row[]).every((m) => !("assignFrom" in m)));
    await as(q, "예린");
    assert(((await rpc(q, "public.curriculum_get('aws', false)")).members as Row[]).every((m) => !("assignFrom" in m)));
  } },
]);
```

- [ ] **Step 2: 실패 확인** — FAIL.

- [ ] **Step 3: 구현**

`room_detail_json` ← **0026** 판 전체 복사, 두 군데:

```sql
  if v_is_leader then
    -- 읽기 전용(GET 안전): 활성 토큰을 SELECT 만 한다. 생성은 invite_get·invite_rotate·room_create 몫
    -- 0032: 코드·바로 참가 설정까지(그룹장에게만, D9). 코드 없는 행이면 code null — 화면이 invite_get 으로 채운다
    select public.invite_json(i, r) - 'today' into v_invite
    from public.room_invites i where i.room_id = p_room and i.revoked_at is null;
```

반환 객체의 `'invite', v_invite,` 앞에:

```sql
    'recruit', jsonb_build_object(
      'open', public.room_recruit_open(r),
      'extraUntil', case when r.status = 'ACTIVE' and public.room_recruit_open(r) then to_char(public.room_recruit_until(r), 'YYYY-MM-DD') end),   -- 0032 실효 마감
```

`room_matches` ← 0004 복사, 상태 조건 한 줄:

```sql
      and (p_status = 'all' or r.status = upper(p_status)
           or (p_status = 'recruit' and r.status = 'ACTIVE' and r.archived_at is null
               and r.recruit_until is not null and least(r.recruit_until, r.end_date) >= public.kst_today()))   -- 0032: 추가 모집도 '모집중'(D5), 실효 마감
```

`rooms_list` ← **0024** 판 전체 복사(page CTE 는 `r.*` 라 `recruit_until` 이 이미 실린다), 항목 JSON 두 군데:

```sql
    'status', lower(p.status),
    -- 0032: 모집 열림(RECRUIT ∨ 추가 모집 창) ∧ 꽉 참
    -- 주의(Codex 2-1): least(NULL, end_date) = end_date — 창이 없는 방을 걸러야 하므로 recruit_until is not null 가드 필수
    'isFull', (p.status = 'RECRUIT'
               or (p.status = 'ACTIVE' and p.recruit_until is not null and least(p.recruit_until, p.end_date) >= v_today))
              and p.member_count >= p.max_members,
    'recruitUntil', case when p.status = 'ACTIVE' and p.recruit_until is not null and least(p.recruit_until, p.end_date) >= v_today
                         then to_char(least(p.recruit_until, p.end_date), 'YYYY-MM-DD') end,
```

(원본 `'isFull', p.status = 'RECRUIT' and p.member_count >= p.max_members,` 를 대체. 그 밖의 CTE·정렬·탭 총계는 그대로.)

`me_studies` ← **0024** 판 전체 복사(`drop`·`create`·`grant` 가 아니라 `create or replace` — 시그니처 `(p_include_archived boolean default false)` 동일), `mine` CTE 세 군데(Codex #4):

```sql
  with mine as (
    select r.id, r.slug, r.title, r.intro, r.start_date, r.end_date,
           case when r.leader_id = v_uid then 'leader' when m.status = 'PENDING' then 'pending' else 'joined' end as membership,
           -- 0032: 대기 신청은 방 상태와 무관하게 '모집중' 묶음(추가 모집 신청 포함)
           case when m.status = 'PENDING' and r.leader_id <> v_uid then 'recruit'
                when r.status = 'ACTIVE' then 'active' when r.status in ('RECRUIT', 'DRAFT') then 'recruit' else 'ended' end as kind,
           public.room_recruit_until(r) as recruit_end   -- 0032: ACTIVE 추가 모집 실효 마감(아니면 null)
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = v_uid
    where r.archived_at is null
      -- 그룹장 분기: 방장은 room_members 행의 status 와 무관하게 자기 방을 항상 본다(DRAFT 포함). 멤버는 ACTIVE, 대기자는 모집 중인 방만.
      -- 0032: 대기자 = RECRUIT·DRAFT 방, 또는 추가 모집 창이 열린 ACTIVE 방
      and (r.leader_id = v_uid or m.status = 'ACTIVE'
           or (m.status = 'PENDING' and (r.status in ('RECRUIT', 'DRAFT') or public.room_recruit_open(r))))),
```

`items` 의 `when` 에서 `recruit` 갈래만:

```sql
               when 'recruit' then case when m.recruit_end is not null
                                        then jsonb_build_object('kind', 'recruitEnd', 'date', to_char(m.recruit_end, 'YYYY-MM-DD'))   -- 0032
                                        else jsonb_build_object('kind', 'start', 'date', to_char(m.start_date, 'YYYY-MM-DD')) end
```

(`mine` 에서 `public.room_recruit_until(r)`·`public.room_recruit_open(r)` 의 `r` 은 행 별칭 — 행 전체가 `public.rooms` 로 넘어간다. 보관 묶음은 그대로.)

`curriculum_json` ← **0024** 판 전체 복사, 멤버 객체 끝에 한 조각(Codex #5). 키는 **그룹장·ACTIVE/INACTIVE 멤버에게만**(같은 함수의 `v_viewer` = `personal_viewer`, 0014 규칙) — 공개 방 익명·외부인 `curriculum_get` 에는 싣지 않는다(Codex 2-6):

```sql
             'canEditCurriculum', public.member_can_edit_curriculum(r, m))
           -- 0032: 중간 합류자 공통 과제 배정 시작일(null = 처음부터). 방 사람에게만
           || case when v_viewer then jsonb_build_object('assignFrom', to_char(m.assign_from, 'YYYY-MM-DD')) else '{}'::jsonb end
```

(원본 `'canEditCurriculum', public.member_can_edit_curriculum(r, m))` 뒤 `order by` 앞에 `|| case …` 를 붙인다.)

- [ ] **Step 4: 통과 확인** — `npm run test:db` 전체 PASS.

- [ ] **Step 5: 원문 정적 점검** — `grep -c "create or replace function" supabase/migrations/0032_extra_recruit.sql` 가 Interfaces 합계(새 14 + 재정의 18 = 32)와 맞는지(`me_studies` 는 0024 에서 `create function` 이었지만 여기서는 `create or replace`), `grep -n "status <> 'RECRUIT'" supabase/migrations/0032_extra_recruit.sql` 가 비어 있는지 확인.

- [ ] **Step 6: 커밋** — `git commit -- supabase/migrations/0032_extra_recruit.sql supabase/tests/extra-recruit-sql.test.ts supabase/tests/_cases-membership.ts -m "feat(db): 0032 — 추가 모집(진행중 모집 창·자동 마감·중간 합류 배정)과 초대 코드·바로 참가(기한·인원 한도·실패 제한)"`

---

### Task 5: 웹 — 타입 · 어댑터 · 순수 로직 (sonnet)

**Files:**
- Modify: `src/lib/api/types.ts` · `src/lib/api/leader.ts` · `src/lib/api/room-view.ts` · `src/lib/api/invite.ts` · `src/lib/api/rooms.ts` · `src/data/rooms.ts`(카드 `Room` 에 `extra?`)
- Create: `src/lib/api/recruit.ts` · `src/lib/api/recruit.test.ts`
- Modify(Codex #4·#5): `src/lib/api/my-study.ts` · `src/lib/api/my-study.test.ts` · `src/components/my-study/model.ts` · `src/components/my-study/model.test.ts`

**Interfaces:**
- `types.ts`: `RoomRecruit` · `InviteBypass` · `InviteInfo` · `InviteJoin`; `RoomDetail.recruit?: RoomRecruit`, `RoomDetail.invite: InviteInfo | null`; `RoomCardDto.recruitUntil?: string | null`; `InvitePreview.join?: InviteJoin`, `InvitePreview.room.recruitUntil?: string | null`; `NOTIFICATION_KINDS` 끝 `// 0032` `"MEMBER_JOINED"`
  - 선택(`?`)으로 두는 이유: 기존 픽스처·DTO 생성 테스트가 깨지지 않게. 서버는 0032 뒤 항상 보낸다.
- `recruit.ts`: `openExtraRecruit` · `closeExtraRecruit` · `setInviteBypass` · `lookupInviteCode` · `normalizeCode` · `isCodeShape` · `formatCode` · `codeInputView` · `extraRecruitDefaults` · `recruitMaxDate` · `extraRecruitNote` · `inviteNote` · `recruitErrorText`
- `room-view.ts` `closedAction` 이 `recruit.open` 을 본다 · `invite.ts` `inviteActionOf` 가 `join` 을 본다 · `leader.ts` `showApplications` · `InviteLink` 확장
- (Codex #4) `StudyItem.when.kind` 에 `"recruitEnd"`, `my-study.ts` `toSidebarGroups` 의 when 문구 `"MM.DD 모집 마감"`
- (Codex #5) `CurriculumMember.assignFrom?: string | null`, `model.ts` `TreeMember.assignFrom`·공통 재계산 규칙

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/recruit.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { closedAction, actionOf } from "@/lib/api/room-view";
import { inviteActionOf } from "@/lib/api/invite";
import { showApplications } from "@/lib/api/leader";
import { toRoomCard } from "@/lib/api/rooms";
import { codeInputView, extraRecruitDefaults, extraRecruitNote, formatCode, inviteNote, isCodeShape, normalizeCode, recruitMaxDate } from "@/lib/api/recruit";
import type { InvitePreview, RoomCardDto } from "@/lib/api/types";

describe("code", () => {
  it("normalizes like SQL invite_code_norm", () => {
    expect(normalizeCode(" k7qm-3xpa ")).toBe("K7QM3XPA");
    expect(normalizeCode("oIlL")).toBe("0111");
  });
  it("shape / format / typing view", () => {
    expect(isCodeShape("K7QM3XPA")).toBe(true);
    expect(isCodeShape("K7QM3XP")).toBe(false);
    expect(isCodeShape("K7QM3XPU")).toBe(false); // U 없음
    expect(formatCode("K7QM3XPA")).toBe("K7QM-3XPA");
    expect(codeInputView("k7q")).toBe("K7Q");
    expect(codeInputView("k7qm3")).toBe("K7QM-3");
    expect(codeInputView("k7qm-3xpa99")).toBe("K7QM-3XPA"); // 8자에서 자른다
  });
});

describe("closedAction / actionOf with extra window", () => {
  const base = { status: "active" as const, memberCount: 4, maxMembers: 6, joinMode: "approval" as const, me: { state: "none" as const } };
  it("active without window → activeClosed; with window → apply/join; full → full", () => {
    expect(closedAction(base)).toBe("activeClosed");
    expect(closedAction({ ...base, recruit: { open: true, extraUntil: "2026-10-19" } })).toBeNull();
    expect(actionOf({ ...base, recruit: { open: true, extraUntil: "2026-10-19" } })).toBe("apply");
    expect(actionOf({ ...base, joinMode: "direct", recruit: { open: true, extraUntil: "2026-10-19" } })).toBe("join");
    expect(closedAction({ ...base, memberCount: 6, recruit: { open: true, extraUntil: "2026-10-19" } })).toBe("full");
  });
  it("active member in extra window stays joined (no leave)", () => {
    expect(actionOf({ ...base, me: { state: "active" }, recruit: { open: true, extraUntil: "2026-10-19" } })).toBe("joined");
  });
});

describe("inviteActionOf with join", () => {
  const p = (over: Partial<InvitePreview> & { join?: InvitePreview["join"] }): InvitePreview => ({
    today: "2026-10-12",
    room: { slug: "aws", title: "t", intro: "", startDate: "2026-10-01", endDate: "2026-12-31", memberCount: 4, maxMembers: 6, status: "active", isPublic: true, joinMode: "approval", tags: [] },
    leader: { userId: "l", nickname: "민수", tone: "mint" },
    me: { state: "none" },
    ...over,
  });
  it("bypass → join even on approval room; PENDING can be promoted", () => {
    const j = { mode: "direct" as const, via: "invite" as const, until: "2026-10-19" };
    expect(inviteActionOf(p({ join: j }))).toBe("join");
    expect(inviteActionOf(p({ join: j, me: { state: "pending" } }))).toBe("join");
  });
  it("extra approval → apply; closed → activeClosed / ended; anon → login only when open", () => {
    expect(inviteActionOf(p({ join: { mode: "approval", via: "extra", until: "2026-10-19" } }))).toBe("apply");
    expect(inviteActionOf(p({ join: { mode: null, via: null, until: null } }))).toBe("activeClosed");
    expect(inviteActionOf(p({ join: { mode: null, via: null, until: null }, room: { ...p({}).room, status: "ended" } }))).toBe("ended");
    expect(inviteActionOf(p({ me: null, join: { mode: "direct", via: "invite", until: "2026-10-19" } }))).toBe("login");
    expect(inviteActionOf(p({ me: null, join: { mode: null, via: null, until: null } }))).toBe("activeClosed");
  });
  it("legacy preview without join keeps old rules", () => {
    expect(inviteActionOf(p({}))).toBe("activeClosed");
  });
});

describe("leader helpers", () => {
  it("showApplications in active room with window", () => {
    expect(showApplications({ status: "active", joinMode: "approval", pendingCount: 0, archived: false, recruit: { open: true, extraUntil: "2026-10-19" } })).toBe(true);
    expect(showApplications({ status: "active", joinMode: "approval", pendingCount: 0, archived: false, recruit: { open: false, extraUntil: null } })).toBe(false);
  });
  it("defaults & notes", () => {
    const d = { today: "2026-10-12", endDate: "2026-10-15", maxMembers: 6, memberCount: 6, joinMode: "approval" as const };
    expect(recruitMaxDate(d)).toBe("2026-10-15");
    expect(extraRecruitDefaults(d)).toEqual({ until: "2026-10-15", maxMembers: 7, joinMode: "approval" });
    expect(extraRecruitNote({ isPublic: false })).toContain("목록에는 안 보여요");
    expect(inviteNote({ status: "active", recruit: { open: false, extraUntil: null }, invite: { url: "/invite/x", token: "x", code: "K7QM3XPA", bypass: null }, isPublic: true })).toContain("지금은 이 링크로 참가할 수 없어요");
  });
});

describe("toRoomCard extra badge", () => {
  it("active + recruitUntil → extra", () => {
    const dto = { id: "6", slug: "aws", title: "t", intro: "", status: "active", isFull: false, isPublic: true, joinMode: "approval", memberCount: 4, maxMembers: 6,
      leader: { userId: "l", nickname: "민수", tone: "mint" }, tags: [], startDate: "2026-10-01", endDate: "2026-12-31", membership: null,
      progress: { kind: "team", currentRound: null, totalRounds: 13 }, recruitUntil: "2026-10-19" } as RoomCardDto;
    expect(toRoomCard(dto, "2026-10-12")).toMatchObject({ status: "active", extra: "open" });
    expect(toRoomCard({ ...dto, isFull: true }, "2026-10-12")).toMatchObject({ extra: "full" });
    expect(toRoomCard({ ...dto, recruitUntil: null }, "2026-10-12").extra).toBeUndefined();
  });
});
```

추가(Codex #4) — `src/lib/api/my-study.test.ts`:

```ts
it("sidebar: extra-recruit PENDING sits in 모집중 · 승인 대기 with '모집 마감' date", () => {
  const ms: MeStudies = { today: "2026-10-12", groups: [
    { kind: "active", items: [] },
    { kind: "recruit", items: [{ slug: "aws", title: "AWS", intro: "", membership: "pending", archived: false, when: { kind: "recruitEnd", date: "2026-10-19" } }] },
    { kind: "ended", items: [] } ] };
  const g = toSidebarGroups(ms, "2026-10-12").find((x) => x.items.some((it) => it.id === "aws"))!;
  expect(g.label).toBe("모집중 · 승인 대기");
  expect(g.items[0].when).toContain("모집 마감");
});
```

(라벨 문자열은 `MEMBERSHIP_LABEL.pending` 실제 값에 맞춘다.)

추가(Codex #5) — `src/components/my-study/model.test.ts`(`fixtures.ts` 의 `AWS` 에 늦게 들어온 멤버를 더한 사본):

```ts
describe("late joiner (assignFrom) — preview equals server assignment_resync", () => {
  const late = { userId: "u6", nickname: "서연", tone: "amber" as const, role: "member" as const, status: "active" as const, doesTasks: true, canEditCurriculum: false, assignFrom: "2026-10-12" };
  const cur = { ...AWS, members: [...AWS.members, late] };
  const ids = (t: ReturnType<typeof buildTree>, id: string) => (t.nodes.find((n) => n.id === id) as LeafNode).people.map((p) => p.userId);
  it("temp leaf under a past round (ends 10/07) excludes the late joiner", () => {
    const t = buildTree(cur, { ...EMPTY_OVERRIDES, added: { "1": ["지난 과제"] } }, REF_DAY);
    const temp = t.nodes.find((n) => n.temp && n.leaf)!;
    expect(ids(t, temp.id)).not.toContain("u6");
  });
  it("designated → 공통 on a leaf ending 10/14 includes the late joiner", () => {
    expect(ids(buildTree(cur, { ...EMPTY_OVERRIDES, typeOv: { "21": "공통" } }, REF_DAY), "21")).toContain("u6");
  });
  it("designated → 공통 on a PAST leaf drops a late joiner who was designated there (server releases DESIGNATED first) (Codex 2-3)", () => {
    const past = { ...cur, nodes: cur.nodes.map((n) => n.id !== "21" ? n : { ...n, endDate: "2026-10-10",
      task: { ...n.task!, people: [...n.task!.people, { userId: "u6", nickname: "서연", tone: "amber" as const, status: "missed" as const }] } }) };
    expect(ids(buildTree(past, EMPTY_OVERRIDES, REF_DAY), "21")).toContain("u6");                         // 지금은 지정 담당
    const after = ids(buildTree(past, { ...EMPTY_OVERRIDES, typeOv: { "21": "공통" } }, REF_DAY), "21");
    expect(after).not.toContain("u6");                                                                     // 마감 10/10 < assignFrom 10/12
    expect(after).toEqual(expect.arrayContaining(["u2", "u3", "u1", "u4"]));                              // 처음부터 멤버는 모두
  });
  it("moving a past 공통 leaf's end past assignFrom adds the late joiner (server resync does too)", () => {
    expect(ids(buildTree(cur, EMPTY_OVERRIDES, REF_DAY), "11")).not.toContain("u6");
    expect(ids(buildTree(cur, { ...EMPTY_OVERRIDES, dates: { "11": { e: "2026-10-20" } } }, REF_DAY), "11")).toContain("u6");
  });
});
```

(`ov.dates` 의 실제 모양 — `{ s?, e? }` — 은 `model.ts` 의 `Overrides` 를 따른다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/api/recruit.test.ts src/lib/api/my-study.test.ts src/components/my-study/model.test.ts` → 새 사례 FAIL.

- [ ] **Step 3: 구현**

`src/lib/api/types.ts`(RoomDetail 위):

```ts
/** 0032 — 모집 열림(RECRUIT 또는 추가 모집 창) · 추가 모집 마감일(진행중 + 창 열림일 때만) */
export type RoomRecruit = { open: boolean; extraUntil: string | null };
/** 0032 — 모집 상태와 무관한 "바로 참가". active = 지금 유효(기한 안 · 한도 남음 · 방 모집중/진행중) */
export type InviteBypass = { until: string; max: number | null; used: number; active: boolean };
/** 그룹장에게만 오는 초대 정보(room_detail_json.invite). code 는 0032 전 행이면 null — invite_get 이 채운다 */
export type InviteInfo = { url: string; token: string; code: string | null; bypass: InviteBypass | null };
/** 0032 invite_preview.join — 이 초대로 지금 할 수 있는 것. mode null = 참가 불가 */
export type InviteJoin = { mode: JoinMode | null; via: "recruit" | "extra" | "invite" | null; until: string | null };
```

`RoomDetail` 의 `invite: { url: string } | null;` → `invite: InviteInfo | null;` 와 `recruit?: RoomRecruit;`. `RoomCardDto` 에 `recruitUntil?: string | null;`. `InvitePreview` 에 `join?: InviteJoin;`, `room` 에 `recruitUntil?: string | null;`. `NOTIFICATION_KINDS` 끝:

```ts
  // 0032
  "MEMBER_JOINED",
```

(기존 픽스처가 `invite: { url }` 만 넣어 tsc 가 깨지면 그 픽스처에 `token`·`code: null`·`bypass: null` 을 채운다.)

`src/lib/api/recruit.ts`:

```ts
import { rpc, type Db } from "@/lib/api/errors";
import { addDays } from "@/lib/date";
import { mmdd } from "@/lib/api/format";
import type { InviteLink } from "@/lib/api/leader";
import type { JoinMode, RoomDetail } from "@/lib/api/types";

/* 추가 모집 · 초대 코드(0032). 쓰기 RPC 는 모두 그룹장 전용 — 서버가 다시 검사한다 */

export const openExtraRecruit = (slug: string, v: { until: string; maxMembers: number; joinMode: JoinMode }, client?: Db) =>
  rpc<RoomDetail>("room_extra_recruit_open", { p_slug: slug, p_until: v.until, p_max_members: v.maxMembers, p_join_mode: v.joinMode }, client);
export const closeExtraRecruit = (slug: string, client?: Db) => rpc<RoomDetail>("room_extra_recruit_close", { p_slug: slug }, client);
/** until null = 끄기 */
export const setInviteBypass = (slug: string, until: string | null, max: number | null, client?: Db) =>
  rpc<InviteLink>("invite_bypass_set", { p_slug: slug, p_until: until, p_max: max }, client);
export type CodeLookup = { found: true; url: string } | { found: false; remaining: number };
export const lookupInviteCode = (code: string, client?: Db) => rpc<CodeLookup>("invite_code_lookup", { p_code: code }, client);

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
/** SQL invite_code_norm 과 같은 규칙 */
export const normalizeCode = (s: string) => s.replace(/[\s-]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
export const isCodeShape = (s: string) => CODE_RE.test(normalizeCode(s));
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4, 8)}`;
/** 입력 중 표시 — 정규화 후 8자에서 자르고 4자 뒤 하이픈 */
export function codeInputView(raw: string): string {
  const c = normalizeCode(raw).replace(/[^0-9A-Z]/g, "").slice(0, 8);
  return c.length > 4 ? formatCode(c) : c;
}

type RecruitSrc = Pick<RoomDetail, "today" | "endDate" | "maxMembers" | "memberCount" | "joinMode">;
/** 마감일 상한 = min(종료일, 오늘+30) (서버와 같은 규칙) */
export const recruitMaxDate = (d: Pick<RoomDetail, "today" | "endDate">) => {
  const cap = addDays(d.today, 30);
  return d.endDate < cap ? d.endDate : cap;
};
/** 처음 열 때 기본값: 마감 오늘+7(상한 안), 정원은 빈자리가 1개 이상 되게, 방식은 지금 방식 */
export function extraRecruitDefaults(d: RecruitSrc): { until: string; maxMembers: number; joinMode: JoinMode } {
  const week = addDays(d.today, 7);
  const max = recruitMaxDate(d);
  return { until: week < max ? week : max, maxMembers: Math.max(d.maxMembers, d.memberCount + 1), joinMode: d.joinMode };
}

export const extraRecruitNote = (d: Pick<RoomDetail, "isPublic">) =>
  (d.isPublic ? "공개 방이라 둘러보기에 '추가 모집'으로 보여요." : "비공개 방이라 목록에는 안 보여요 · 초대 링크·코드를 받은 사람만 참가할 수 있어요.") +
  " 들어온 사람은 오늘 이후 마감인 공통 과제부터 맡아요";

/** 그룹장 패널 초대 행 안내 */
export function inviteNote(d: Pick<RoomDetail, "status" | "isPublic" | "invite"> & { recruit?: RoomDetail["recruit"] }): string {
  const b = d.invite?.bypass;
  if (b?.active) return `${mmdd(b.until)}까지 이 링크·코드로 바로 참가할 수 있어요`;
  if (d.status === "draft") return "모집을 시작하면 이 링크로 들어올 수 있어요";
  if (d.status === "active" && !d.recruit?.open) return "진행중이라 지금은 이 링크로 참가할 수 없어요 · 방 설정에서 추가 모집이나 바로 참가를 켜 주세요";
  return d.isPublic ? "링크를 받은 사람은 바로 이 방으로 와요" : "비공개 방이라 이 링크를 받은 사람만 들어올 수 있어요";
}

export function recruitErrorText(code: string, message: string): string {
  switch (code) {
    case "CAPACITY_NO_SEAT": return "빈자리가 없어요 · 정원을 늘려 주세요";
    case "INVITE_EXPIRED": return "바로 참가 기한이 끝났거나 인원이 찼어요 · 그룹장에게 문의해 주세요";
    case "RATE_LIMITED": return "코드를 너무 많이 틀렸어요 · 1시간 뒤에 다시 시도해 주세요";
    default: return message || "처리하지 못했어요 · 잠시 후 다시 시도해 주세요";
  }
}
```

(`mmdd` 가 `format.ts` 에 없거나 모양이 다르면 그룹장 패널이 쓰는 `mmdd` 를 그대로 import — leader.ts 가 이미 쓴다.)

`src/lib/api/leader.ts`:

```ts
import type { InviteBypass } from "@/lib/api/types";
export type InviteLink = { today: string; token: string; url: string; code: string | null; bypass: InviteBypass | null };

/** 승인 대기 목록 — 모집 열림(모집중·추가 모집)이고 승인제이거나, 대기자가 남아 있을 때 */
export const showApplications = (d: Pick<RoomDetail, "status" | "joinMode" | "pendingCount" | "archived"> & { recruit?: RoomDetail["recruit"] }) =>
  !d.archived && (d.status === "recruit" || d.status === "active") &&
  (((d.recruit?.open ?? d.status === "recruit") && d.joinMode === "approval") || d.pendingCount > 0);
```

`leaderErrorText` 에 `CAPACITY_NO_SEAT`·`INVITE_EXPIRED` 를 `recruitErrorText` 로 위임하는 `case` 두 줄.

`src/lib/api/room-view.ts`:

```ts
type ActionInput = Pick<RoomDetail, "status" | "joinMode" | "memberCount" | "maxMembers" | "me"> & { archived?: boolean; recruit?: RoomDetail["recruit"] };

/** 지금 참가할 수 없는 방 상태 — 진행중이라도 추가 모집 창이 열려 있으면 닫힘이 아니다(0032) */
export function closedAction(d: Pick<RoomDetail, "status" | "memberCount" | "maxMembers"> & { recruit?: RoomDetail["recruit"] }): "ended" | "activeClosed" | "full" | null {
  if (d.status === "ended") return "ended";
  if (d.status === "active" && !d.recruit?.open) return "activeClosed";
  if (d.memberCount >= d.maxMembers) return "full";
  return null;
}
```

(`actionOf` 본문은 그대로 — `closedAction(d)` 에 `recruit` 가 같이 넘어간다.)

`src/lib/api/invite.ts`:

```ts
/** 0032: 서버 join 을 따른다. join 이 없으면(0032 전 응답) 기존 규칙 */
function inviteClosed(p: InvitePreview): "ended" | "activeClosed" | "full" | null {
  const r = p.room;
  if (!p.join) return closedAction(r);
  if (!p.join.mode) return r.status === "ended" ? "ended" : "activeClosed";
  return r.memberCount >= r.maxMembers ? "full" : null;
}

export function inviteActionOf(p: InvitePreview): InviteAction {
  const r = p.room;
  if (!p.me) return inviteClosed(p) ?? "login";
  if (p.me.state === "leader") return "owner";
  if (p.me.state === "active") return "joined";
  // 바로 참가 초대면 승인 대기 중이어도 바로 참가로 승격된다(서버 room_join_by_invite)
  if (p.me.state === "pending") return p.join?.via === "invite" && p.join.mode ? inviteClosed(p) ?? "join" : "pending";
  if (p.me.state === "inactive") return "inactive";
  const mode = p.join ? p.join.mode : r.joinMode;
  return inviteClosed(p) ?? (mode === "approval" ? "apply" : "join");
}
```

`src/data/rooms.ts` 의 카드 `Room` 에 `/** 0032 진행중 추가 모집 — open·full */ extra?: "open" | "full";`. `src/lib/api/rooms.ts` `toRoomCard` 반환에:

```ts
    extra: d.status === "active" && d.recruitUntil ? (d.isFull ? "full" : "open") : undefined,
```

추가(Codex #4) — `src/lib/api/types.ts` `StudyItem.when.kind` 에 `"recruitEnd"`. `src/lib/api/my-study.ts` `toSidebarGroups` 의 `when` 문구:

```ts
        const when = w.kind === "deadline" ? `${d} 마감` : w.kind === "start" ? `${d} 시작` : w.kind === "recruitEnd" ? `${d} 모집 마감` : g.kind === "active" ? `${d} 까지` : `${d} 종료`;
```

추가(Codex #5) — `types.ts` `CurriculumMember` 에 `/** 0032 중간 합류자 공통 과제 배정 시작일. null·없음 = 처음부터 */ assignFrom?: string | null;`. `src/components/my-study/model.ts`:

```ts
export type TreeMember = { userId: string; name: string; tone: Tone; doesTasks: boolean; assignFrom: string | null };
// buildTree: members 매핑에 assignFrom: m.assignFrom ?? null
// 리프 재계산 조건 — 공통 과제 날짜만 바꿔도 중간 합류자가 있으면 다시 계산(서버 node_update → assignment_resync 가 새로 배정하므로)
const recompute = !personal && (temp || n.id in ov.typeOv || n.id in ov.assignOv || (type === "공통" && n.id in ov.dates && doers.some((m) => m.assignFrom)));
// 공통 담당 = (원래 공통 과제였다면) 이미 배정된 사람 ∪ 배정 자격(assignFrom 없음 ∨ 마감 ≥ assignFrom) — 서버 assignment_resync 1단계와 같은 규칙.
// 지정→공통 전환은 서버가 기존 DESIGNATED 배정을 먼저 해제한다(node_update 0028:150–153) → 기존 담당 유지는 원래 COMMON 배정에만(Codex 2-3)
const keepKnown = n.task.type === "common";
const commonDoers = doers.filter((m) => (keepKnown && known.has(m.userId)) || !m.assignFrom || e >= m.assignFrom);
const chosen = type === "공통" ? commonDoers : ov.assignOv[n.id] ? doers.filter((m) => ov.assignOv[n.id].includes(m.userId)) : doers.filter((m) => known.has(m.userId));
```

(일반 조회(재계산 없음)는 서버 배정 행을 그대로 쓰므로 바뀌지 않는다.)

- [ ] **Step 4: 통과 확인** — `npx vitest run src/lib/api src/components/my-study` → PASS. `npx tsc --noEmit` → 픽스처 오류가 나면 위 지시대로 채운다.

- [ ] **Step 5: 커밋** — `git commit -- src/lib/api/types.ts src/lib/api/leader.ts src/lib/api/room-view.ts src/lib/api/invite.ts src/lib/api/rooms.ts src/lib/api/recruit.ts src/lib/api/recruit.test.ts src/lib/api/my-study.ts src/lib/api/my-study.test.ts src/components/my-study/model.ts src/components/my-study/model.test.ts src/data/rooms.ts <고친 픽스처> -m "feat(web): 추가 모집·초대 코드 타입·어댑터·판정(closedAction·inviteActionOf·카드 배지)"`

---

### Task 6: 방 설정 「추가 모집 · 초대」 섹션 (opus)

**Files:**
- Create: `src/components/room-settings/RecruitInviteSection.tsx` · `src/components/room-settings/RecruitInviteSection.dom.test.ts`
- Modify: `src/components/room-settings/RoomSettingsForm.tsx`(알림 설정 섹션 **위**에 끼우기, `d`·폼 기준값 갱신)

**동작(스펙 §4.1):**
- 렌더 조건: `!d.archived && (d.status === "active" || d.status === "recruit")`. 추가 모집 카드는 `active` 일 때만, 초대 카드는 둘 다.
- 바로 저장(방 정보 폼 저장 막대와 따로) — `NotifySettingsSection` 과 같은 패턴(busy·토스트·실패 시 되돌림).
- 추가 모집 카드
  - 닫힘: 마감일(`<input type="date" min={today} max={recruitMaxDate(d)}>`), 정원(number, `min={memberCount+1}` max 100), 참가 방식 `ChoiceList`(승인 후 참가 / 바로 참가), 안내 `extraRecruitNote(d)`, [추가 모집 시작] → `openExtraRecruit` → `onDetail(next)` + 토스트 "추가 모집을 시작했어요 · {mm/dd}까지".
  - 열림(`d.recruit?.extraUntil`): 상태 줄 `● {mm/dd(요일)}까지 · {승인제|바로 참가}` + `{memberCount}/{maxMembers}명 · 승인 대기 {pendingCount}명`, [기간·정원 바꾸기](같은 입력을 펼쳐 다시 `openExtraRecruit`) · [지금 마감](ConfirmDialog: "추가 모집을 마감할까요? · 승인 대기 {n}명의 신청은 만료돼요") → `closeExtraRecruit`.
  - 서버 오류는 `recruitErrorText`, `INVALID_PERIOD`·`CAPACITY_NO_SEAT` 는 해당 칸 아래 줄 오류(`details.field`).
- 초대 카드
  - 마운트 시 `d.invite?.code` 가 없으면 `fetchInvite(slug)` 로 채운다(서버가 코드를 만든다).
  - 코드 `formatCode` 를 `font-mono text-[28px] tracking-[0.08em] whitespace-nowrap` 로, [코드 복사](`navigator.clipboard.writeText(formatCode(code))`), [초대 링크 복사](`absoluteUrl`), [새 코드로 바꾸기](ConfirmDialog — 기존 LeaderPanel rotate 문구 + "바로 참가 설정도 꺼져요") → `rotateInvite`.
  - `Switch` "모집이 끝나도 이 초대로 바로 참가" — 켜면 기한(date, 기본 `min(today+7, recruitMaxDate)`)·인원(number, 비우면 null) 입력과 [저장] → `setInviteBypass`. 끄면 즉시 `setInviteBypass(slug, null, null)`.
  - 켜져 있을 때 안내: `{used}명 사용{max ? ` / ${max}명` : ""} · 승인 없이 바로 참가해요`, `bypass.active === false` 면 "기한이 지났거나 인원이 찼어요 · 기한을 늘리거나 새 코드로 바꿔 주세요"(warn 색).
- `RoomSettingsForm` 연결(Codex #8): 폼은 `base`(기준값)·`v`(현재값)를 들고 있다(`RoomSettingsForm.tsx` 48–49행). 섹션의 `onDetail(next)` 는 `setD(next)` 하고, **서버가 바꾼 칸(`maxMembers`·`joinMode`)만** 기준값·현재값 둘 다에 반영한다 — 다른 칸의 미저장 수정은 그대로. 순수 함수로 `settings.ts` 에 둔다:

```ts
/** 폼 밖 RPC 가 실제로 바꾼 칸 — 동작별(Codex 2-4). 마감은 정원·방식을 바꾸지 않는다 */
export const RECRUIT_CHANGED = { open: ["maxMembers", "joinMode"], close: [] } as const satisfies Record<string, readonly Field[]>;
/** 최신 폼 값(cur)에 서버가 바꾼 칸만 덮는다 — 함수형 setState 안에서 부른다(요청 중 입력 보존) */
export function mergeServerFields(cur: NewRoomValues, next: Src, changed: readonly Field[]): NewRoomValues {
  if (changed.length === 0) return cur;
  const fresh = valuesOf(next);
  return { ...cur, ...Object.fromEntries(changed.map((k) => [k, fresh[k]])) };
}
```

폼(요청 전 `base`/`v` 를 캡처하지 않는다):

```ts
const onRecruitDetail = (next: RoomDetail, changed: readonly Field[]) => {
  setD(next);
  setBase((b) => mergeServerFields(b, next, changed));
  setV((cur) => mergeServerFields(cur, next, changed));
};
// 섹션: openExtraRecruit 성공 → onDetail(next, RECRUIT_CHANGED.open) · closeExtraRecruit 성공 → onDetail(next, RECRUIT_CHANGED.close)
```

진행중엔 `joinMode` 칸이 잠겨 있어 사용자가 고칠 수 없으므로 서버 값으로 덮어도 잃는 입력이 없다. 열기 요청이 바꾼 `maxMembers` 는 서버 값이 진실(섹션 입력으로 방금 저장).
- 모바일 390: 카드 안 입력은 한 줄 1개(`grid-cols-[72px_minmax(0,1fr)]` 라벨-값), 버튼은 전체 폭 `h-11`. 820 이상에서 버튼 오른쪽 정렬.

- [ ] **Step 1: 실패하는 DOM 테스트** — `RecruitInviteSection.dom.test.ts`

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { RecruitInviteSection } from "./RecruitInviteSection";
import type { RoomDetail } from "@/lib/api/types";

const base = {
  today: "2026-10-12", slug: "aws", status: "active", archived: false, isPublic: true, joinMode: "approval",
  startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, memberCount: 4, pendingCount: 1,
  recruit: { open: false, extraUntil: null },
  invite: { url: "/invite/seed-aws", token: "seed-aws", code: "K7QM3XPA", bypass: null },
} as unknown as RoomDetail;
const html = (d: Partial<RoomDetail>) => renderToStaticMarkup(createElement(RecruitInviteSection, { detail: { ...base, ...d } as RoomDetail, toast: () => {}, onDetail: () => {} }));

describe("RecruitInviteSection", () => {
  it("active closed: start form with defaults, code shown formatted", () => {
    const h = html({});
    expect(h).toContain("추가 모집 시작");
    expect(h).toContain('value="2026-10-19"');          // 오늘+7
    expect(h).toContain('max="2026-11-11"');            // 오늘+30
    expect(h).toContain("K7QM-3XPA");
    expect(h).toContain("모집이 끝나도 이 초대로 바로 참가");
  });
  it("open window: status line and close button", () => {
    const h = html({ recruit: { open: true, extraUntil: "2026-10-27" } });
    expect(h).toContain("10/27");
    expect(h).toContain("지금 마감");
    expect(h).toContain("승인 대기 1명");
  });
  it("recruit room: invite card only; archived/ended: nothing", () => {
    expect(html({ status: "recruit", recruit: { open: true, extraUntil: null } })).not.toContain("추가 모집 시작");
    expect(html({ status: "ended" })).toBe("");
    expect(html({ archived: true })).toBe("");
  });
  it("bypass on but inactive → warning", () => {
    expect(html({ invite: { ...base.invite!, bypass: { until: "2026-10-11", max: 2, used: 2, active: false } } })).toContain("기한이 지났거나 인원이 찼어요");
  });
});
```

(`mmdd` 표기가 `10/27` 이 아니면 그 함수 출력에 맞춰 단언을 고친다.)

추가(Codex #8) — `src/components/room-settings/settings.test.ts`:

```ts
describe("mergeServerFields (Codex #8·2-4)", () => {
  const d = { title: "t", intro: "i", descriptionMd: "", rulesMd: "", startDate: "2026-10-01", endDate: "2026-12-31", maxMembers: 6, minMembers: 3, isPublic: true, joinMode: "approval" as const, leaderDoesTasks: true };
  it("open: server-changed maxMembers·joinMode land in base and v; other unsaved edits stay", () => {
    const base = valuesOf(d);
    const v = { ...base, title: "고친 제목" };
    const next = { ...d, maxMembers: 8, joinMode: "direct" as const };
    const b2 = mergeServerFields(base, next, RECRUIT_CHANGED.open), v2 = mergeServerFields(v, next, RECRUIT_CHANGED.open);
    expect([b2.maxMembers, b2.joinMode, v2.maxMembers, v2.joinMode]).toEqual(["8", "direct", "8", "direct"]);
    expect(buildPatch(b2, v2)).toEqual({ title: "고친 제목" });
  });
  it("close ('지금 마감'): an unsaved capacity edit survives", () => {
    const base = valuesOf(d);
    const v = { ...base, maxMembers: "8" };                                 // 폼에서 6→8, 아직 저장 안 함
    const v2 = mergeServerFields(v, d, RECRUIT_CHANGED.close);
    expect(v2.maxMembers).toBe("8");
    expect(buildPatch(mergeServerFields(base, d, RECRUIT_CHANGED.close), v2)).toEqual({ maxMembers: 8 });
  });
  it("input typed while the request was in flight survives (merge into the latest state)", () => {
    const atRequest = valuesOf(d);
    const latest = { ...atRequest, intro: "요청 중에 고친 소개" };          // setV(fn) 가 받는 최신 값
    const v2 = mergeServerFields(latest, { ...d, maxMembers: 8 }, RECRUIT_CHANGED.open);
    expect([v2.intro, v2.maxMembers]).toEqual(["요청 중에 고친 소개", "8"]);
  });
});
```

(폼 연결이 함수형 `setBase(fn)`/`setV(fn)` 인지는 리뷰에서 확인 — 캡처한 `base`/`v` 를 쓰면 위 세 번째 사례가 실제 화면에서 깨진다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/room-settings` → FAIL.
- [ ] **Step 3: 구현** — 위 동작대로. 상태는 `useState` 로 입력값만 들고, 서버 응답(`RoomDetail`·`InviteLink`)이 진실. 버튼 `aria-label` 에 동작 이름. `ConfirmDialog`·`ChoiceList`·`Switch`·`Toast` 는 기존 것.
- [ ] **Step 4: 통과 + 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run`
- [ ] **Step 5: 커밋** — `git commit -- src/components/room-settings/RecruitInviteSection.tsx src/components/room-settings/RecruitInviteSection.dom.test.ts src/components/room-settings/RoomSettingsForm.tsx src/components/room-settings/settings.ts src/components/room-settings/settings.test.ts -m "feat(settings): 방 설정 「추가 모집 · 초대」 — 추가 모집 열기·마감, 초대 코드·링크, 바로 참가 기한·인원"`

---

### Task 7: 그룹장 패널 · 참가 카드 · 방 카드 표시 (sonnet)

**Files:** Modify `src/components/room-view/LeaderPanel.tsx` · `src/components/room-view/JoinCard.tsx` · `src/components/room-view/RoomViewScreen.tsx`(필요 시 `recruit` 전달) · `src/components/main/RoomCard.tsx` · 각 `*.dom.test.ts`(있으면 추가, 없으면 `RoomCard.dom.test.ts` 에 한 건)

- [ ] **Step 1: 테스트 먼저** — `RoomCard.dom.test.ts` 에 "extra open → '추가 모집' 배지, full → '정원 마감' 배지" 2건. LeaderPanel 은 순수 함수(`inviteNote`·`showApplications`)가 Task 5 에서 덮였으므로 DOM 1건: 진행중·창 닫힘 → "지금은 이 링크로 참가할 수 없어요" 문구 + 방 설정 링크.
- [ ] **Step 2: 구현**
  - `LeaderPanel`
    - `Detail` Pick 에 `"recruit"` 추가(선택 필드라 `& { recruit?: … }`).
    - 상태 칩 옆: `detail.recruit?.extraUntil` 이면 `<span className="rounded-[7px] bg-[#E3ECFD] px-2 py-[2px] text-[12px] font-semibold text-[#2F5BC2]">추가 모집 ~{mmdd(extraUntil)}</span>`.
    - 초대 행: 기존 [초대 링크 복사] 옆에 `detail.invite?.code` 가 있으면 `[코드 {formatCode(code)} 복사]`(SECONDARY, `font-mono`). 안내 줄은 `inviteNote(detail)` 로 교체, 진행중·창 닫힘·바로 참가 꺼짐이면 끝에 `방 설정 →` 링크(`routes.roomSettings(slug, from)`).
    - `showApplications(detail)` 는 Task 5 판으로 진행중 창도 포함 — 그대로 호출.
    - ConfirmDialog "지금 시작" 본문의 "진행중이 되면 새 참가를 받지 않고" → "진행중이 되면 새 참가는 방 설정의 추가 모집·바로 참가로만 받고".
  - `JoinCard`
    - `DISABLED.activeClosed` 문구: `["모집 종료", "진행중인 스터디예요 · 그룹장에게 초대 코드를 받으면 참가할 수 있어요"]`.
    - `join`/`apply` 안내: `room.status === "active"` 면 `"진행중인 스터디예요 · 오늘 이후 마감인 과제부터 함께해요{until ? ` · ${mmdd(until)}까지 모집` : ""}"` + 둘째 줄 `"참가 뒤에는 취소 대신 탈퇴 요청으로 나갈 수 있어요"`(D12). `Room` 뷰 모델(`src/data/room-view.ts`)에 `extraUntil?: string | null` 을 더하고 `toRoom` 에서 `dto.recruit?.extraUntil ?? null` 로 채운다.
  - `RoomCard`: `room.extra` 면 상태 배지 뒤에 `<Badge bg="#E3ECFD" fg="#2F5BC2">{room.extra === "full" ? "추가 모집 · 정원 마감" : "추가 모집"}</Badge>`.
- [ ] **Step 3: 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run`
- [ ] **Step 4: 커밋** — `git commit -- <위 파일들> -m "feat(web): 그룹장 패널·참가 카드·방 카드에 추가 모집·초대 코드 표시"`

---

### Task 8: 초대 랜딩 확장 · `/join` 코드 입력 (sonnet)

**Files:**
- Modify: `src/components/auth/InviteScreen.tsx` · `src/lib/routes.ts`(`join`) · `src/lib/supabase/return-to.ts`(`/join` 두 목록) · `src/lib/supabase/return-to.test.ts` · `src/components/ui/AppHeader.tsx`(계정 메뉴 항목) · `src/components/main/empty-copy.ts`(+테스트, mine 빈 상태 보조 링크)
- Create: `src/app/join/page.tsx` · `src/components/auth/JoinCodeForm.tsx` · `src/components/auth/JoinCodeForm.dom.test.ts`

- [ ] **Step 1: 테스트 먼저**
  - `return-to.test.ts`: `safeReturnTo("/join")` = `"/join"`, `safeReturnTo("/join?code=K7QM3XPA")` 통과, `safeReturnTo("/joinx")` = `"/"`, `isProtectedPath("/join")` = true.
  - (Codex #9) **로그인 복귀 실행 테스트** — `src/lib/supabase/middleware.test.ts` 에 기존 `@supabase/ssr` 목(`auth.claims = null`)으로:

```ts
it("unauthenticated /join?code=… → /login?returnTo keeps the code, and the login page's safeReturnTo returns it intact", async () => {
  auth.claims = null;
  const res = await updateSession(new NextRequest("http://localhost:3000/join?code=k7qm-3xpa"));
  const loc = new URL(res.headers.get("location")!);
  expect(loc.pathname).toBe("/login");
  const back = loc.searchParams.get("returnTo");
  expect(back).toBe("/join?code=k7qm-3xpa");
  expect(safeReturnTo(back)).toBe("/join?code=k7qm-3xpa");                       // LoginScreen 이 로그인 뒤 router.push 하는 값
  expect(new URL(back!, "http://x").searchParams.get("code")).toBe("k7qm-3xpa");  // /join 페이지가 칸을 채우는 값
});
```

(목·env 준비는 같은 파일의 기존 "updateSession with env" 묶음을 따른다. `safeReturnTo` 는 `./return-to` 에서 import.)
  - `JoinCodeForm.dom.test.ts`: 초기 `?code=k7qm3xpa` → input value `K7QM-3XPA`; 라벨 "초대 코드"; 버튼 "다음".
  - InviteScreen: `join.via === "invite"` 면 "초대로 바로 참가 · 10/19까지" 와 "진행중인 스터디예요" 안내, CTA "바로 참가하기"; `join.mode null` 진행중이면 "모집이 끝났어요 · 그룹장에게 새 초대를 받아 주세요".
- [ ] **Step 2: 구현**
  - `routes.ts`: `/** 초대 코드 입력 (0032) */ join: (code?: string) => (code ? `/join?code=${encodeURIComponent(code)}` : "/join"),`
  - `return-to.ts`: `PROTECTED_PREFIXES` 와 `RETURN_TO_PREFIXES` 에 `"/join"`(정확히 `/join` 또는 `/join?`·`/join/` 만 — `RETURN_TO_PREFIXES` 의 `startsWith` 판정이 `/joinx` 를 통과시키지 않게 `"/join"` 대신 판정식에 `raw === "/join" || raw.startsWith("/join?")` 를 더한다).
  - `src/app/join/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { JoinCodeForm } from "@/components/auth/JoinCodeForm";
import { requireMe } from "@/lib/api/me.server";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "초대 코드로 참가" };

/** 초대 코드 입력 (0032, D10) — 로그인 필수. 맞으면 /invite/{token} 랜딩으로 넘긴다(미리보기·CTA 는 랜딩 한 곳) */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const sp = await searchParams;
  const code = Array.isArray(sp.code) ? sp.code[0] : sp.code;
  await requireMe(code ? routes.join(code) : routes.join());
  return (
    <AuthShell title="초대 코드로 참가" subtitle="그룹장에게 받은 8자리 코드를 넣어 주세요">
      <JoinCodeForm initial={code ?? ""} />
    </AuthShell>
  );
}
```

  - `JoinCodeForm.tsx`(client): `value` = `codeInputView(input)`, `<input inputMode="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} aria-label="초대 코드" className="h-12 … font-mono text-[20px] tracking-[0.08em]">`. 제출: `isCodeShape` 아니면 "8자리 코드를 모두 넣어 주세요". `lookupInviteCode(normalizeCode(v))` → `found` 면 `router.push(res.url)`, 아니면 `맞는 코드가 없어요 · ${remaining}번 더 시도할 수 있어요`(0이면 "1시간 뒤에 다시 시도해 주세요"). 예외는 `recruitErrorText`. 버튼 "다음"(`h-12 w-full`).
  - `InviteScreen`:
    - 정보 카드 아래 안내 박스(`role="note"`, 진행중이고 `join.mode` 있을 때): "진행중인 스터디예요 · 오늘 이후 마감인 과제부터 함께해요. 지난 회차 기록은 볼 수 있어요." + `join.via === "invite"` 면 `초대로 바로 참가 · ${mmdd(until)}까지`, `"extra"` 면 `추가 모집 · ${mmdd(until)}까지`.
    - CTA 라벨: `act === "join" && p.join?.via === "invite"` → "바로 참가하기".
    - 닫힘 문구: 기존 `"이미 진행 중인 스터디예요"` → `"모집이 끝났어요 · 그룹장에게 새 초대를 받아 주세요"`.
    - `go()` 오류 `INVITE_EXPIRED` → `recruitErrorText` 후 `router.refresh()`(미리보기 다시 받기).
  - `AppHeader` 계정 메뉴: "내 프로필" 다음에 `<Link role="menuitem" href={routes.join()}>초대 코드 입력</Link>`(같은 클래스).
  - `empty-copy.ts` mine 빈 상태: 보조 액션 "초대 코드가 있나요?" → `routes.join()`(EmptyState 가 보조 링크를 그릴 수 있게 필드 하나 추가, 테스트 갱신).
- [ ] **Step 3: 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run`
- [ ] **Step 4: 커밋** — `git commit -- <위 파일들> -m "feat(web): 초대 랜딩에 추가 모집·바로 참가 안내, /join 초대 코드 입력(로그인 후 돌아오기)"`

---

### Task 9: 실 PostgreSQL 두 연결 게이트 `extra-recruit-db.test.ts` (opus, Codex #9)

**Files:** Create `supabase/tests/extra-recruit-db.test.ts`

PGlite 는 단일 연결이라 경쟁과 "요청(트랜잭션) 사이 지속"을 증명하지 못한다. 기존 `_testenv.ts` 의 `dbTest`(env 없으면 ignore → `npm run test:db` 기본 실행 영향 없음) + AI 플랜 `api-invoke-db.test.ts` 와 같은 로컬 강제·직접 연결 패턴. **로컬 supabase 전용**(호스티드 금지). 실행:

```
cd /Users/picpal/Desktop/workspace/sgtudy && npx supabase db reset   # 로컬만
eval "$(npx supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY SUPABASE_DB_URL=$DB_URL
deno test -A --config supabase/tests/deno.json supabase/tests/extra-recruit-db.test.ts
```

설계: ① **제어된 동시 시작** — 직접 연결이 `begin; select … from rooms where id = $1 for update` 로 방 행을 쥔 채 요청들을 쏘고, `pg_stat_activity` + `pg_blocking_pids(pid)` 로 **대상 함수를 실행 중인 백엔드 N개가 바로 그 연결(`pg_backend_pid()`)에 막혀 있음**을 제한시간(5s) 안에 확인한 다음 `commit`(Codex 2-5). 시간 대기가 아니라 잠금 대기를 증명하므로, 모든 요청이 잠금 **앞**에서 같은 상태를 보고 기다린다 → 오류 코드가 확정적(예: 초대 둘째 요청은 반드시 `INVITE_EXPIRED`, 커밋 뒤 도착해 `ROOM_NOT_RECRUITING` 이 될 수 없음). 확인 실패면 커밋하지 않고 롤백·실패. 테스트 방은 **미래 시작일**(내일)로 만든 뒤 `room_start` 로 명시적으로 시작한다(cron tick 이 먼저 시작시키는 경쟁 차단). 마지막 `dbTest` 가 `pg.end()` 로 연결을 닫는다. ② tick↔연장 경쟁은 쥔 트랜잭션 안에서 **그룹장 신원으로 실제 RPC**(`set local role authenticated` + `request.jwt.claims`)를 부른 뒤, 다른 연결에서 tick 을 쏴 후보 선택(옛 상태) → 잠금 대기 → 커밋 뒤 재판정을 재현한다. ③ 날짜는 로컬 seed 의 `internal.settings 'today'` — 바꾼 테스트는 `finally` 에서 되돌린다. 옮기는 범위는 오늘+3 까지: 시드 기준일(10/12)에서 그 안에 시작하는 RECRUIT 방·끝나는 ACTIVE 방이 없어 tick 이 시드를 건드리지 않는다(Task 0 에서 `select slug from rooms where (status='RECRUIT' and start_date <= current+3) or (status='ACTIVE' and end_date < current+3)` 가 비었는지 확인, 아니면 멈추고 보고). ④ 정리는 이 파일이 만든 방(제목에 `RUN`)·자기 테스트 사용자 행만.

- [ ] **Step 1: 테스트 작성**

```ts
// supabase/tests/extra-recruit-db.test.ts — 0032 실 PostgreSQL(두 연결) 게이트. PGlite 로 증명 못 하는 경쟁·커밋 지속만. 로컬 supabase 전용
import { assertEquals } from "@std/assert";
import postgres from "npm:postgres@3.4.5";
import type { SupabaseClient } from "supabase-js";
import { dbTest, hasEnv, RUN, service, userClient } from "./_testenv.ts";

const LOCAL = /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "";
if (hasEnv && (!LOCAL.test(Deno.env.get("SUPABASE_URL") ?? "") || !/@(127\.0\.0\.1|localhost):/.test(DB_URL))) {
  throw new Error("extra-recruit-db.test.ts 는 로컬 supabase 전용이에요 — SUPABASE_URL·SUPABASE_DB_URL 이 127.0.0.1/localhost 여야 해요");
}
const pg = hasEnv ? postgres(DB_URL, { max: 4, onnotice: () => {} }) : (null as never);

type R = { data: unknown; error: { message: string } | null };
const ok = <T = unknown>(r: R, label: string): T => { if (r.error) throw new Error(`${label}: ${r.error.message}`); return r.data as T; };
const code = (r: R) => r.error?.message ?? "OK";

async function member(n: number): Promise<{ id: string; c: SupabaseClient }> {
  const { u, c } = await userClient(n);
  ok(await c.rpc("me_update", { p_nickname: `er${n}${RUN}` }), "me_update");
  return { id: u.id, c };
}
const today = async () => (await pg`select public.kst_today()::text as d`)[0].d as string;
const plus = async (n: number) => (await pg`select (public.kst_today() + ${n}::int)::text as d`)[0].d as string;

/** 리프 1개 있는 ACTIVE 방. 시작일은 **내일**로 만들어 cron 이 먼저 시작시키지 못하게 하고, room_start 로 명시적으로 시작(Codex 2-5).
 *  endIn = 종료일(오늘+n). 리프는 내일~종료일 */
async function activeRoom(leader: { c: SupabaseClient }, max: number, joinMode: "direct" | "approval", endIn = 40) {
  const [s, e] = [await plus(1), await plus(endIn)];
  const room = ok<{ id: string; slug: string }>(await leader.c.rpc("room_create", {
    p_title: `추가모집 ${RUN} ${crypto.randomUUID().slice(0, 4)}`, p_intro: "게이트", p_start_date: s, p_end_date: e,
    p_max_members: max, p_is_public: true, p_join_mode: joinMode }), "room_create");
  const admin = service();
  const { data: round, error: e1 } = await admin.from("goal_nodes").insert({ room_id: Number(room.id), parent_id: null, depth: 2, sort_order: 0, label: "1주차", title: "회차", start_date: s, end_date: e }).select("id").single();
  if (e1) throw new Error(e1.message);
  const { error: eU } = await admin.from("goal_nodes").update({ round_id: round!.id }).eq("id", round!.id);
  if (eU) throw new Error(eU.message);
  const { error: e2 } = await admin.from("goal_nodes").insert({ room_id: Number(room.id), parent_id: round!.id, round_id: round!.id, depth: 3, sort_order: 0, title: "과제", start_date: s, end_date: e, task_type: "COMMON" });
  if (e2) throw new Error(e2.message);
  ok(await leader.c.rpc("room_open_recruit", { p_slug: room.slug }), "open_recruit");
  ok(await leader.c.rpc("room_start", { p_slug: room.slug }), "room_start");      // 예정보다 하루 일찍 — 시작일이 오늘로(일정 그대로)
  assertEquals((await pg`select status from public.rooms where id = ${room.id}`)[0].status, "ACTIVE");
  return room;
}
const dropRoom = async (id: string) => { const { error } = await service().from("rooms").delete().eq("id", Number(id)); if (error) console.error("cleanup room", id, error.message); };

/** holder 백엔드에 막혀 있는, 대상 함수를 실행 중인 백엔드가 n 개가 될 때까지(최대 timeoutMs) 기다린다 — 시간 대기가 아니라 잠금 대기 증명 (Codex 2-5) */
async function waitBlocked(holderPid: number, fn: string, n: number, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [{ c }] = await pg`select count(*)::int as c from pg_stat_activity
                             where ${holderPid} = any(pg_blocking_pids(pid)) and query ilike ${"%" + fn + "%"}`;
    if (c >= n) return;
    if (Date.now() > until) throw new Error(`${fn} 요청 ${n}개가 방 잠금을 기다리지 않았어요(지금 ${c}개)`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** 방 행을 쥔 채 during(쥔 트랜잭션 안 작업) → fire → 대상 n 개가 이 연결에 막혀 있음을 확인 → commit */
async function heldRoom<T>(roomId: string, fn: string, fire: () => PromiseLike<T>[], during?: (tx: postgres.ReservedSql) => Promise<void>): Promise<T[]> {
  const tx = await pg.reserve();
  let ps: Promise<T>[] = [];
  try {
    await tx`begin`;
    await tx`select 1 from public.rooms where id = ${roomId} for update`;
    const [{ pid }] = await tx`select pg_backend_pid() as pid`;
    if (during) await during(tx);
    ps = fire().map((p) => Promise.resolve(p));
    await waitBlocked(pid as number, fn, ps.length);
    await tx`commit`;
    return await Promise.all(ps);
  } catch (e) {
    await tx`rollback`.catch(() => {});
    await Promise.allSettled(ps);                                   // 잠금이 풀린 뒤 남은 요청을 기다려 다음 사례에 새지 않게
    throw e;
  } finally { tx.release(); }
}

dbTest("extra window: two concurrent direct joins for the last seat → one OK, one ROOM_FULL", async () => {
  const leader = await member(31);
  const room = await activeRoom(leader, 2, "direct");
  try {
    ok(await leader.c.rpc("room_extra_recruit_open", { p_slug: room.slug, p_until: await plus(3), p_max_members: 2, p_join_mode: "direct" }), "extra_open");
    const [a, b] = [await member(32), await member(33)];
    const res = await heldRoom(room.id, "room_join", () => [a.c.rpc("room_join", { p_slug: room.slug }), b.c.rpc("room_join", { p_slug: room.slug })]);
    assertEquals(res.map(code).sort(), ["OK", "ROOM_FULL"]);
    assertEquals((await pg`select member_count from public.rooms where id = ${room.id}`)[0].member_count, 2);
  } finally { await dropRoom(room.id); }
});

dbTest("bypass invite: limit 1, two concurrent invite_join → one OK, one INVITE_EXPIRED, used = 1", async () => {
  const leader = await member(34);
  const room = await activeRoom(leader, 6, "approval");
  try {
    const inv = ok<{ token: string }>(await leader.c.rpc("invite_bypass_set", { p_slug: room.slug, p_until: await plus(3), p_max: 1 }), "bypass_set");
    const [a, b] = [await member(35), await member(36)];
    const res = await heldRoom(room.id, "invite_join", () => [a.c.rpc("invite_join", { p_token: inv.token }), b.c.rpc("invite_join", { p_token: inv.token })]);
    assertEquals(res.map(code).sort(), ["INVITE_EXPIRED", "OK"]);
    assertEquals((await pg`select bypass_used from public.room_invites where token = ${inv.token}`)[0].bypass_used, 1);
  } finally { await dropRoom(room.id); }
});

dbTest("tick vs extend: tick picks a lapsed window, leader reopens while holding the row → tick re-checks and leaves the new window", async () => {
  const leader = await member(37);
  const room = await activeRoom(leader, 6, "approval");
  const saved = await today();
  try {
    ok(await leader.c.rpc("room_extra_recruit_open", { p_slug: room.slug, p_until: saved, p_max_members: null, p_join_mode: null }), "extra_open");
    await pg`update internal.settings set value = ${await plus(1)} where key = 'today'`;   // 창이 지난 날
    const until = await plus(5);
    const [tick] = await heldRoom(room.id, "room_tick", () => [pg`select public.room_tick() as r`], async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: leader.id, role: "authenticated" })}, true)`;
      await tx`select public.room_extra_recruit_open(${room.slug}, ${until}::date, null, null)`;   // 실제 RPC, 커밋 전
    });
    assertEquals((tick as { r: unknown }[])[0].r !== undefined, true);
    assertEquals((await pg`select recruit_until::text as u from public.rooms where id = ${room.id}`)[0].u, until);   // 새 창이 살아 있다
  } finally {
    await pg`update internal.settings set value = ${saved} where key = 'today'`;
    await dropRoom(room.id);
  }
});

dbTest("code lookup: failures persist across separate requests (10 → RATE_LIMITED); successes are not stored", async () => {
  const leader = await member(38);
  const room = await activeRoom(leader, 6, "approval");
  const u = await member(39);
  try {
    const { code: real } = ok<{ code: string }>(await leader.c.rpc("invite_get", { p_slug: room.slug }), "invite_get");
    await pg`delete from public.invite_code_failures where user_id = ${u.id}`;
    ok(await u.c.rpc("invite_code_lookup", { p_code: real }), "hit");
    assertEquals((await pg`select count(*)::int as n from public.invite_code_failures where user_id = ${u.id}`)[0].n, 0);
    const miss = real === "ZZZZZZZZ" ? "YYYYYYYY" : "ZZZZZZZZ";
    for (let i = 9; i >= 0; i--) assertEquals(ok(await u.c.rpc("invite_code_lookup", { p_code: miss }), "miss"), { found: false, remaining: i });   // 요청마다 별도 트랜잭션
    assertEquals(code(await u.c.rpc("invite_code_lookup", { p_code: real })), "RATE_LIMITED");
    assertEquals((await pg`select count(*)::int as n from public.invite_code_failures where user_id = ${u.id}`)[0].n, 10);
  } finally {
    await pg`delete from public.invite_code_failures where user_id = ${u.id}`;
    await dropRoom(room.id);
  }
});

dbTest("tick vs end-date extension: tick picks an overdue room, leader extends end_date while holding the row → room stays ACTIVE, not counted (Codex 2-2)", async () => {
  const leader = await member(40);
  const room = await activeRoom(leader, 6, "direct", 2);          // 종료일 = 오늘+2
  const saved = await today();
  try {
    await pg`update internal.settings set value = ${await plus(3)} where key = 'today'`;   // 종료일이 지난 날
    const newEnd = await plus(10);
    const [tick] = await heldRoom(room.id, "room_tick", () => [pg`select public.room_tick() as r`], async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: leader.id, role: "authenticated" })}, true)`;
      await tx`select public.room_update(${room.slug}, ${JSON.stringify({ endDate: newEnd })}::jsonb)`;   // 실제 RPC, 커밋 전
    });
    const row = (await pg`select status, end_date::text as e from public.rooms where id = ${room.id}`)[0];
    assertEquals([row.status, row.e], ["ACTIVE", newEnd]);
    assertEquals(((tick as { r: { ended: number } }[])[0]).r.ended, 0);          // 날짜 범위상 시드 방도 끝나지 않는다(설계 ③)
  } finally {
    await pg`update internal.settings set value = ${saved} where key = 'today'`;
    await dropRoom(room.id);
  }
});

// 연결을 명시적으로 닫는다 — 정의 순서대로 도므로 마지막(Codex 2-5)
dbTest("teardown: close the direct pg pool", async () => { await pg.end({ timeout: 5 }); });
```

(`room_start` 인자는 0025 판 시그니처를 따른다 — 기본값이면 `p_slug` 만. `public.fail` 은 PostgREST 오류 `message` 에 코드를 싣는다 — `rooms-db.test.ts` 와 같은 판정. 실패 원문이 다르면 그 형식에 맞춘다.)

- [ ] **Step 2: 실행** — env 없이 `npm run test:db` → 이 파일은 ignored(정상). 로컬 supabase 가 있으면 위 명령으로 6 passed(사례 5 + 정리 1). 없으면 노트에 "실 DB 게이트 미실행 — Task 10 에서 사용자 실행 요청" 을 남기고 **배포 전 필수 게이트**로 표시.
- [ ] **Step 3: 커밋** — `git commit -- supabase/tests/extra-recruit-db.test.ts -m "test(db): 0032 실 PostgreSQL 두 연결 게이트 — 마지막 좌석·바로 참가 한도·tick↔창 연장·tick↔종료일 연장 경쟁, 코드 실패 누적"`

---

### Task 10: 로컬 DB 적용 · 브라우저 확인 (sonnet)

**Files:** 없음(확인만, 문제 있으면 해당 Task 로 되돌림)

- [ ] **Step 1: 로컬 DB** — 로컬 supabase 가 떠 있으면 `npx supabase db reset`(로컬만!) 후 `npm run db:types`(선택 — `rpc()` 는 이름을 문자열로 받으므로 필수 아님). 호스티드에는 아무것도 하지 않는다.
- [ ] **Step 2: dev 서버** — `vm_stat | grep -E 'free|compressor'` 확인 → `lsof -iTCP:3700 -sTCP:LISTEN -P` 비어 있으면 `npx next dev -p 3700` (백그라운드).
- [ ] **Step 3: ego-browser(자기 창) 시나리오** — 로그인 정보는 `.superpowers/sdd/2026-10-14-editor-ux/common.md`.
  1. 민수(aws 그룹장): 방 설정 → 「추가 모집 · 초대」 → 마감일 기본 오늘+7, 정원 7 → [추가 모집 시작] → 그룹장 패널에 "추가 모집 ~MM/DD".
  2. 로그아웃 상태 홈 → 상태 "모집중" 필터에 AWS 카드 `진행중` + `추가 모집` 배지.
  3. 서연: AWS 방 → 참가 신청(한마디) → 민수 알림 `JOIN_REQUESTED` → 승인 → 서연 내 스터디: 1주차 과제 "담당 아님", 3주차 이후 과제 배정.
  4. 민수: [지금 마감] → 남은 신청 만료 확인.
  5. 민수: 바로 참가 켜기(인원 1) → 코드 복사 → 가은: 헤더 메뉴 "초대 코드 입력" → 소문자·하이픈 섞어 입력 → 랜딩 "바로 참가하기" → 내 스터디 이동. 민수 알림 "가은님이 … 합류했어요".
  6. 예린: 같은 코드 → 랜딩이 닫힘 CTA(한도 소진). 틀린 코드 연속 입력 → 남은 횟수 문구.
  7. 비로그인으로 `/join?code=…` → 로그인 → `/join?code=…` 로 복귀, 칸 채워짐(Task 8 실행 테스트의 브라우저 확인).
  8. 민수: 종료일을 추가 모집 마감보다 앞으로 당김 → 설정 섹션·패널 마감 표시가 종료일로 줄어듦. 서연(추가 모집 신청자) 내 스터디 사이드바 "모집중 · 승인 대기" 에 "MM.DD 모집 마감".
  9. Task 9 가 미실행이면 여기서 로컬 supabase 로 실행(배포 전 필수).
  10. 폭 390 / 820 / 1440 에서 설정 섹션·랜딩·`/join` 스크린샷, 가로 스크롤 없음(`document.documentElement.scrollWidth <= innerWidth`), 코드 한 줄.
- [ ] **Step 4: 정리** — dev 서버 종료. 결과(스크린샷 경로·이상 사항) 보고.

---

## 실행 순서 · 모델

| Task | 모델 | 의존 |
|---|---|---|
| 0 | sonnet | — |
| 1·2·3·4 | opus | 0 (같은 파일 — 순서대로, 커밋은 4 끝) |
| 5 | sonnet | 4 (DTO 모양) — 테스트 작성은 1~4 와 병렬 가능 |
| 6 | opus | 5 |
| 7 | sonnet | 5 (6 과 병렬 가능 — 파일 겹침 없음) |
| 8 | sonnet | 5 (6·7 과 병렬 가능, `InviteScreen` 은 8 만 만진다) |
| 9 | opus | 4 (로컬 supabase 필요 — 없으면 10 에서) |
| 10 | sonnet | 전부 |

## 결정에 따른 변경 (스펙 §8 — 승인 때 권장안과 다르게 정하면)

| 결정 | 대안을 고르면 바뀌는 곳 |
|---|---|
| D2 B(항상 승인제) | Task 2 `room_extra_recruit_open` 에서 `p_join_mode` 제거·`join_mode = 'APPROVAL'` 고정, Task 6 방식 선택 삭제 |
| D3 B(차면 자동 마감) | Task 2 `room_join`·`room_approve` 뒤 `member_count >= max_members` 면 `room_extra_recruit_expire` 호출, 테스트 1건 |
| D14 B(진행중 묶음에 대기 표시) | Task 4 `me_studies` 의 `kind` 를 방 상태 그대로 두고 `when` 만 `recruitEnd`, Task 5 사이드바 문구·테스트 |
| D4 B(대기 유지) | Task 2 `room_extra_recruit_expire` 에서 PENDING 만료 제거, `room_decide_precheck` 를 `status in ('RECRUIT','ACTIVE')` 로, ENDED 전이 때 만료 처리(=`room_transition_ended` 재정의 추가) |
| D5 B(별도 필터) | Task 4 `room_matches` 대신 `rooms_list` 에 `p_status = 'extra'` 허용값 추가, FilterBar 칩 |
| D6 B(전부 배정) | Task 1 `assignment_resync` 재정의·`assign_from` 열 제거, Task 2·3 의 `assign_from` 줄 제거 |
| D8 B(초대도 승인) | Task 3 `room_join_by_invite` 를 PENDING 삽입 + `JOIN_REQUESTED` 로, `invite_preview.join.mode` = `'approval'` |
| D11 C(신규 알림 없음) | Task 2 §8(`notification_kinds`·`notify_render`) 와 `room_member_activate` 의 `notify_publish` 삭제, Task 5 `NOTIFICATION_KINDS` 변경 없음 → **AI 플랜과 충돌 0** |
| D12 B(창 안 취소 허용) | `room_leave` ←0005 재정의(`room_recruit_open` + 진행중이면 배정 해제·제출 보존), JoinCard 안내 문구 |
