# 계획 리뷰 — plan 04(제출·알림·태그) · plan 05(프론트 통합)

> 리뷰어: 독립 검토(작성자 아님). 수정하지 않고 보고만 한다. 2026-10-13.
> 대상: `docs/superpowers/plans/2026-10-13-backend-{00-overview,04-submission-notification-tags,05-frontend-integration}.md`
> 대조: `docs/backend/{01,02,03}`, `docs/claude-design-prompt.md` §2–§5, `docs/backend/analysis/*.md` §6, plan 01–03(시그니처·하네스·시드), `src/data/*.ts`, `src/components/my-study/**`.
> 표기: `04:123` = plan 04 파일 123행, `05:…` plan 05, `01:`/`02:`/`03:` 각 plan, `00:` 개요. 등급 **B**=blocker · **S**=should-fix · **N**=nit.
> 실측: PGlite 0.3(Deno)로 ① `CREATE EXTENSION citext` 미로드 시 실패 ② 서브쿼리 whole-row → 명명 composite 함수 호출 가능 ③ `language sql → plpgsql` CREATE OR REPLACE 가능 ④ `RETURNING (xmax = 0)` 동작 — 4건을 직접 확인했다.

---

## 0. 등급별 요약

| # | 등급 | 한 줄 | 위치 |
|---|---|---|---|
| B1 | **B** | plan 04 `_boot.ts` 가 PGlite 를 citext·pg_trgm 없이 띄움 → 0001 에서 즉시 실패, plan 04 테스트 전부 부팅 불가 | 04:132-141 vs 01:389-399 |
| B2 | **B** | 태그 slug: 0009 은 `certificate`, 테스트·계약문은 `certification` → tags 테스트 3건 실패, RF5 미검증 | 04:2219 vs 04:2094,2133,2144,2153,2156,2162 |
| B3 | **B** | `job_round_started()` 를 10/12 에 돌려 0 을 단언 — spring 2주차가 10/12 시작(ACTIVE 5명) → 5 반환 | 04:1833-1834, my-study.ts:362 |
| B4 | **B** | SECURITY DEFINER JSON 헬퍼(`submission_json`, `task_node_json`, `room_tag_json`, `settings_json`) 실행 권한 미회수 → anon 이 PostgREST 로 임의 제출물 본문 열람(D7 위반) | 04:397-406, 862, 2262, 1385 / revoke 04:1432-1437,1752,2043,2406 |
| B5 | **B** | plan 05 에 `room_open_recruit`/`room_start`/승인·거절/초대 링크 복사 UI 없음 → `/rooms/new` 로 만든 방은 DRAFT 에 영구 정지, 승인제·비공개 방은 SQL 없이는 운영 불가 | 05 전체(grep 0건), E2E 05:5277-5282 |
| B6 | **B** | E2E(Phase gate 4)가 로컬 DB 의 **실제 오늘**로 돈다 — 10/14(EC2 마감)·10/19(cs·jcg 시작)·10/26(sqld 시작) 이후 Step 3·5·6·8·9 단언이 깨짐. 오늘이 10/13 이라 01~04 실행 후엔 사실상 통과 불가 | 05:5188, 5238, 5259, 5265, 5281, 5287 |
| S1–S17 | S | 아래 §D·§A·§B 본문 | |
| N | N | 아래 각 절 | |

---

## A. 스펙 커버리지 갭

### A-1. 결정(D8·D10·D11·D12)

| 스펙 인용 | 상태 | 소유 태스크 / 갭 |
|---|---|---|
| D8 "15종 kind … `notify_publish` 같은 트랜잭션, `dedupe_key UNIQUE` + `ON CONFLICT DO NOTHING`" | ✅ | 04 Task 5 (`notification_kinds` 15종, 04:1206-1211) |
| D8 "옵션 설정은 방 단위 … 기본 3종은 컬럼 없음" | ✅ | 04 Task 5 `notify_enabled` (04:1214-1226) |
| D8 "시각: 00:00 KST / 09:00 KST (UTC 15:00 / 00:00)" | ✅ | 04 Task 10 (04:2665-2671) — §7 표와 정확히 일치 |
| D8 "link: 참가자면 `/my-study/{slug}` … 과제 이벤트 → `?task={nodeId}`" | ⚠️ **S11** | 서버 생성은 ✅(04:1262-1272). 그러나 plan 05 `/my-study/[id]` 는 `tab`·`mode` 만 읽어 `?task=` 무시(05:4748-4756) → 알림 클릭이 과제로 이어지지 않음 |
| D8 "본인 이벤트 제외. 한 저장의 같은 수신자·kind 1건" | ✅ | 04:1294 `u is distinct from p_actor` |
| D8 "헤더 배지 60초 폴링" | ✅ | 05 Task 4 (05:1184-1208) |
| D10 "선행: 방 ACTIVE · 담당자 · 리프 보관 아님 · today ≥ start_date. 삭제 없음" | ✅ | 04 Task 2 (04:433-445) |
| D10 "함수에서 개수·`storage.objects` 존재 재검증" | ⚠️ **S4** | `submission_upsert` 는 files.status 만 보고 Storage 존재를 재검증하지 않음(04:463-468). `attachments_delete_own`(01:1527) 으로 제출 후 객체 삭제 가능 → 깨진 FileMeta |
| D10 "파일 경로 `{room_id}/{node_id}/{user_id}/{uuid}-{name}`" | ⚠️ **S1** | 한글 파일명이 그대로 키에 들어감(테스트 `노트.png` 04:552). Supabase Storage 는 비ASCII 키를 `Invalid key` 로 거부 — PGlite 스텁에선 안 드러남 |
| D10 "보관 노드 제출물은 그룹장 + 작성자" | ⚠️ N | 테이블·`task_get` 은 ✅(04:930). Storage SELECT 정책은 `can_read_submissions` 만 봄(01:1524-1525) → 경로를 알면 보관 노드 첨부 signed URL 발급 가능 |
| D11 "이탈 처리 2단계 … 담당자 0명이면 `REASSIGN_REQUIRED`" | ✅ | 04 Task 6 (04:1676-1750) |
| D11 `room_update`·`room_delete`·`room_start` | — | plan 02 소유. 단 프론트 UI 없음(B5) |
| D12 "`tag_autoselect`: 상위 5 · AUTO 교체 · MANUAL 보존 · suppressions · ≤8 · CUSTOM" | ✅(B2 제외) | 04 Task 8 |
| D9/D12 "저장 후 태그 자동 선택은 같은 트랜잭션" | ⚠️ **S6** | 04 서두는 `room_create/room_update/node_create/node_update/node_delete/node_archive` 끝에 가드가 있다고 전제(04:75-83)하지만 실제로는 `node_update` 만 보유(03:1542). 새 방은 노드 제목을 고치기 전까지 태그 0개. 검증 테스트도 node_update 1건뿐(04:2191-2200) |

### A-2. 02 §2 테이블 · §5 Storage · §6 함수 · §7 cron

| 항목 | 상태 | 비고 |
|---|---|---|
| submissions / submission_links | ✅ | 04 Task 2 |
| files (`status PENDING→READY`) | ⚠️ **S3** | `file_register` 가 처음부터 READY 로 INSERT(04:684-685) → PENDING 경로는 죽은 코드. 반대로 **등록만 하고 제출 안 한 READY 고아**는 `job_cleanup` 대상이 아니고(04:2016) 5개 한도에 계속 잡힘(04:680-682) |
| files `purpose=COVER` / `rooms.cover_file_id` | ❌ N | 커버 업로드 경로·함수 없음(디자인 §2.1·§4.3 "커버 이미지(선택)"). plan 05 도 "범위 밖"(05:3143) |
| tags / room_tags / room_tag_suppressions | ✅ | 04 Task 8 |
| notifications / room_notification_settings | ✅ | 04 Task 5 (설정 행 없으면 기본 ON) |
| mail_outbox | ✅(1단계 범위) | 정리만(04:2026) |
| §5 Storage INSERT/SELECT/DELETE | ✅ | plan 01 0003 (01:1518-1528), 04 는 참조만 |
| §6 Phase 4–6 함수 | ✅ | `submission_upsert, task_get, file_register, notifications_*, settings_*, tags_search, room_tags_get/put, tag_autoselect, tag_apply_auto, member_deactivate(_preview), job_* 5, member_count_audit` 전부 존재 |
| §7 cron 7줄 | ✅ | UTC 환산 검증: 15:05=00:05, 15:01=00:01, 00:00=09:00, 19:00=04:00, 19:30=04:30 KST |
| `job_cleanup` 의 Storage 삭제 | ⚠️ **S2** | `delete from storage.objects`(04:2020-2022)는 메타 행만 지우고 실제 객체(S3)는 남는다. 최근 Supabase Storage 는 SQL 직접 삭제를 트리거로 막기도 함 → Storage API(Edge Function) 경로 필요 |

### A-3. 03-api §3·§5·§7 DTO

| 항목 | 상태 |
|---|---|
| §3 `member_deactivate_preview` → `{tasks:[{nodeId,title,roundLabel,currentAssignees}]}` | ✅ (04:1665-1671, `today` 추가) |
| §3 `member_deactivate(decisions)` → MembershipResult | ✅ |
| §5 `TaskDetail.path` "방 › 회차 › … › 과제" | ⚠️ N — 회차부터만 반환, 방은 프론트가 붙인다고 명시(04:764) |
| §5 `Submission`/`FileMeta` | ✅ |
| §7 `POST /rooms/{slug}/tags/suggest` → `202 {jobId}` | ⚠️ N — SQL `room_tags_suggest` 와 Edge Function 모두 동기 200 + items(04:2396-2404, 2554) |
| §7 `Notification`, `NotificationSettings(completionMode daily|immediate)` | ✅ |

### A-4. 디자인 프롬프트

| 스펙 인용 | 상태 | 소유 / 갭 |
|---|---|---|
| §2.3 "마크다운 본문 + 링크 여러 개 + 파일 첨부 … 무제한 수정 … 지각 고정" | 백엔드 ✅ / UI ❌ | 04 Task 2·3 / plan 05 미구현(아래 §4.10) |
| §2.5 알림 종류 "회차 시작, 과제 전원 제출(그룹장), 참가 신청/승인/거절, 마감 임박, 지정 과제 배정/재지정, 일정 변경, 스터디 시작/종료" | ✅ 전부 | 생성: 02(JOIN_*, ROOM_*), 03(SCHEDULE_CHANGED, TASK_(UN)ASSIGNED), 04(나머지). 드롭다운 "아이콘" 은 없음(05:1280-1300) **N**, 2페이지 이후 불러오기 없음 **N** |
| §2.6 "AI 자동 선택 → 칩 + 자동 표식 / 그룹장이 삭제·추가(자동완성 + 자유 입력)" | 백엔드 ✅ / 수동 편집 UI ❌ **S16** | 05:5345 가 범위 밖 명시 |
| §4.1 이메일 → OTP 6자리(자동 포커스·재전송 타이머), 닉네임 실시간 중복, 초대 복귀 | ✅ | 05 Task 5·6 |
| §4.4 "그룹장 전용: 승인 대기 목록(승인/거절 버튼), 초대 링크 복사" | ❌ **B5** | §4.11(설정 탭)이 아니라 **방 상세 사이드 패널** 요구인데 plan 05 는 §4.11 과 함께 통째로 이월 |
| §4.3 → "생성 후 커리큘럼 편집 모드" | ✅ 이동 / ❌ 이후 "모집 시작" 없음 **B5** | 05 Task 10 |
| §4.6 "들여쓰기·내어쓰기, 드래그 정렬" | ❌ **S16** | `node_move` 는 RPC 표에만 있고 소비처 없음(05:751) |
| §4.10 과제 상세 + 제출 | ❌ (이월) | 판단은 아래 |
| §4.12 초대 진입 | ✅ | 05 Task 7 |
| §4.13 프로필(닉네임·아바타·이메일 읽기전용·옵션 메일 토글) | ✅ | 05 Task 6 |
| §4.14 헤더(비로그인 변형·🔔·프로필 메뉴) | ✅ | 05 Task 3·4 |
| §5 "빈 상태 / 로딩(스켈레톤) / 오류 / 권한 없음" | ⚠️ **S13** | 빈 상태 일부(Main·MyStudyEmpty·알림)만. `loading.tsx`·`error.tsx`·`not-found.tsx` 없음, 로딩은 opacity 0.6(05:2981). 루트 레이아웃 `meta_get` 실패 시 전 페이지 500(05:702). 비공개 방은 기본 404 |
| §5 토스트 "저장됨, 제출 완료, 참가 신청됨, 정원 마감" | ⚠️ | 제출 완료 없음(UI 없음). 나머지 ✅ |
| §5 확인 다이얼로그 "참가 취소, 노드 보관, 이탈 처리, 방 삭제" | ⚠️ | 앞 2개 ✅(05:3734, EditPanel). 이탈·방 삭제 UI 없음 |

**§4.10 이월 판단 — 조건부 수용, 현재 상태는 갭(S12).** 목업에 제출 화면이 없으니 "목업 교체" 범위로는 빠질 수 있다. 그러나 ① 디자인 §0 산출물 4 의 핵심 흐름이 "참가 → **과제 제출** → 진척 확인" ② 00 개요의 Goal 은 "도메인 규칙 전체 … 프론트를 실데이터에 연결"(00:5) ③ 00 개요 파일 표에 후속 plan 06 이 없음(00:15-22) ④ 05 Phase 게이트가 "백엔드 계획 00~05 전체 종료"를 선언(05:5331) ⑤ 알림 `?task=` 링크·리마인더가 도착할 화면이 없음. → plan 06(§4.10 + §4.4 그룹장 패널 + 모집 시작/지금 시작 + 태그 편집)을 00 개요에 등록하고 게이트 문구를 "Phase 7a" 로 낮추면 수용 가능. 지금 그대로면 갭.

---

## B. 플랜 간 일관성

### B-1. plan 04/05 가 가정한 시그니처 vs plan 02/03 정의

| 함수 | 가정 | 실제 정의 | 판정 |
|---|---|---|---|
| `room_apply` | `(p_slug text, p_invite_token text default null)` (04:57) | 02:2148 동일 | ✅ |
| `room_approve` / `room_reject` | `(p_slug, p_user uuid)` | 02:2217, 02:2234 | ✅ |
| `node_update` | `(p_slug, p_node_id bigint, p_patch jsonb)` | 03:1394 | ✅ |
| `node_move` | 05: `p_slug, p_node_id, p_parent_id, p_index` | 03:1663 | ✅ (단 소비처 없음) |
| `node_create` | 05: `p_slug, p_parent_id` 만 전달 | 03:1136 나머지 default 有 | ✅ |
| `curriculum_get` | `p_slug, p_include_archived` | 03:974 | ✅ |
| `me_studies()` / `me_schedule(p_from,p_to)` | | 03:1867, 03:2046 | ✅ |
| `room_get` | `p_slug, p_invite_token?` | 02:2658 | ✅ |
| `rooms_list` | `p_tags` 에 `[]` 전달(05:2793) | 02:1643 default null, 내부에서 빈 배열 → null 정규화 | ✅ |
| `membership_result(p_room, p_user)` | | 02:2078 | ✅ |
| `room_release_seat(p_room)` | | 02:436 | ✅ |
| `room_members_json` INACTIVE 포함 | 04:1759 | 02:401-411 `status in ('ACTIVE','INACTIVE')` | ✅ |
| `room_leaf_stats(p_room)` 컬럼 `node_id, round_id, asg, sub` | | 02:375, 03:390(위임) | ✅ |
| `room_readable(p_room, p_uid, p_token)`, `room_lock(p_slug)` | | 02:359, 02:349 | ✅ |
| `can_read_submission`, `is_task_assignee` | | 01:1431, 01:1425 | ✅ |
| `notify_publish` 7인자 | 0004 자리표 = 0008 | 02:341 (`language sql`) → 0008 `plpgsql` 교체 — PGlite 실측 OK | ✅ |
| `tag_autoselect(bigint)` 단일 시그니처(to_regproc) | | 03:1542-1550 요구와 04:2368 일치 | ✅ |
| 04 문서가 말하는 자리표 위치 "0002/0005" | 04:7 | 실제 0004(02:341) | N |

### B-2. 알림 호출 계약 불일치 — **S5**

| kind | 04 계약표(04:61-71) | plan 02/03 실제 호출 | 영향 |
|---|---|---|---|
| SCHEDULE_CHANGED | 수신자 "ACTIVE 전원", prefix `…:tx=<txid>` | 03:1520-1528: 수신자 = **해당 리프 담당자**, prefix `SCHEDULE_CHANGED:room:node:YYYYMMDDYYYYMMDD` | 수신 범위가 문서와 다름. A→B→A 로 되돌리면 두 번째 A 는 dedupe 로 무음 |
| TASK_ASSIGNED / UNASSIGNED | prefix `…:tx=<txid>` | 03:1532-1537 `'TASK_ASSIGNED:'||room||':'||node` (tx 없음) | 제외 → 재지정 시 같은 사람은 **영구히** 다시 못 받음 |
| JOIN_* | `JOIN_REQUESTED:room=1:user=<uuid>` | 02:2163 epoch 포함 | ✅(재신청 시 새 알림 — 오히려 바람직) |
| ROOM_STARTED/ENDED/JOIN_EXPIRED | `ROOM_STARTED:room=1` | 02:882-897 `ROOM_STARTED:<id>` | ✅ |

### B-3. 테스트 하네스 export — **B1 / S8**

| plan 01 `_harness.ts` (01:369-450) | plan 04 `_boot.ts` (04:122-170) | 문제 |
|---|---|---|
| `openDb()` = `new PGlite({ extensions: { citext, pg_trgm } })` + `stripUnsupported` | `new PGlite()` (확장 없음) | **B1**: 0001 `CREATE EXTENSION citext` 에서 `extension "citext" is not available`(실측). Task 1 Step 4 "2 passed" 불가 |
| import map `pglite` / `supabase-js` (`deno.json`, 01:286-294) | `npm:@electric-sql/pglite@0.3` 직접 | 04 의 실행 명령에 `--config supabase/tests/deno.json` 없음(04:194, 361, 736, 2722) → 디렉터리 전체 실행 시 plan 01–03 테스트와 `files-db.test.ts`(→`_testenv.ts` 의 bare `supabase-js`) 해석 실패 **S8**. `npm run test:db`(01:208) 를 써야 함 |
| `withCase`, `asUser(q, uid)`, `asAnon`, `setToday`, `newUser`, `expectFail`, `sqlTest` | `cases`, `asUser(q, uid|null)`, `one`, `setNow`, `uidOf`, `roomId`, `nodeId`, `expectFail` 재정의 | 하네스 2벌. 재사용 대신 중복 |
| `_pglite-stubs.ts` 에 storage 스키마·`auth.role()` 이미 존재(01:338-362) | Task 1 Step 1 이 또 추가(`if not exists` / `create or replace`) | 실해는 없으나 "auth.role() 만 없을 때 추가"(04:100)와 달리 무조건 교체 N |
| `_testenv.ts` `userClient`, `dbTest`, `service` | files-db 가 사용 | ✅ export 존재 |

### B-4. 시드 섹션·태그 slug

| 항목 | 판정 |
|---|---|
| 섹션 번호 §1(01) §2(02) §3(03) §4(04:2677) | ✅ |
| 태그 slug `certificate` — 02 시드(02:1201, 1319-1322) · 0009 사전(04:2219) | ✅ |
| 같은 태그를 04 테스트·계약·Produces 설명은 `certification` 으로 씀(04:2094, 2133, 2144-2145, 2153, 2156, 2162) | **B2** — "autoselect 상위 3", "suppression", "limit 8"(NOT_FOUND 가 먼저 터짐) 3건 실패 |
| 04:2082 Produces 목록은 `certificate` — 같은 문서 안에서도 불일치 | B2 |
| `room_notification_settings` 행을 02 시드(02:~1330)와 04 §4(04:2679-2681)가 둘 다 삽입 | N (멱등이라 무해) |
| 태그 사전을 02 시드와 0009 가 둘 다 정의, tone 상충(Spring mint/lav, 백엔드 slate/blue — 02:1205-1206 vs 04:2222-2223). 0009 가 먼저 돌아 0009 값이 이김 → `src/data/my-study.ts:145-146`(lav/blue)와 일치 | N |
| 클라우드: aws=blue, docker=mint(room-view.ts:126,163) — 사전 tone 1개로는 표현 불가 | N |

### B-5. 프론트 타입(`src/data/*.ts`) vs 어댑터

| 파일 | 확장 | 판정 |
|---|---|---|
| `rooms.ts` | `CardStatus += "draft"`, `Room.leaderTone?` (05:2767-2775) | ✅ RoomCard `STATUS_BADGE`/`SLOT_TONE` 에 draft 추가 지시(05:2865-2871) |
| `room-view.ts` | `RoomId=string`, `Action += "login"`, `RoomMember += userId/tone/pending`, `Room += pub` | ⚠️ N: Step 9 가 `Room.leaderTone` 을 쓰는데 Step 3 확장 목록·`toRoom` 코드에 없음(05:3446 vs 3658) |
| `my-study.ts` | `RoomId=string`, MemberInfo/CurTask/RoundRow/NextDue/SidebarItem 필드 추가 | ⚠️ N: `Room = { …기존…; leaderTone?: Tone }` 처럼 코드 블록에 말줄임(05:3844) |
| `schedule.ts` | `StudyId=string`, `Task.id: string`, `mine?`, `Study.membership?` | ✅ |
| TODAY/ME import 파일 전수(05:518-533) | 실제 grep 결과 12개와 정확히 일치 | ✅ |

### B-6. `routes.ts` 확장 vs plan 01 `return-to.ts` — **S9**

| plan 01 | plan 05 | 문제 |
|---|---|---|
| `vitest.config.ts` 생성 + `npm test`(01:556, 600-608) | Task 1 이 `npm install -D vitest@^3` + `vitest.config.ts` **Create**(05:82-120) | 중복 생성 지시 |
| `safeReturnTo`: 백슬래시·공백·`..`·제어문자 거부(01:643-648), 테스트에 `/\evil.com`, `/rooms/../me`, `javascript:` | `routes.ts` 에 더 약한 버전 재정의(05:607-610) — `..`·`\`·공백 미검사 | 두 구현 공존, 로그인 페이지는 약한 쪽을 import(05:1662) |
| `loginUrl(returnTo)` | `routes.login(returnTo)` | 같은 기능 2개 |
| 05:5347 이 스스로 "re-export 로 바꾸는 게 맞다"고 적어 두고 코드는 그대로 | | 계획 단계에서 정리돼야 함 |

---

## C. Placeholder 스캔

| 위치 | 내용 | 등급 |
|---|---|---|
| 05:5221 | `taskSpace(SPACE_ID)` — 식별자 그대로 붙이면 ReferenceError, "앞 라운드 값으로 치환" 지시 | N |
| 05:2068 | Interfaces 가 `periodOf` 를 "이 파일에 둔다"고 하지만 코드도 정의도 없음(코드는 `periodLong` import 05:2156) | N |
| 05:3627, 3631-3654 | RoomSidebar·JoinCard 를 `…` 섞인 부분 코드·산문으로 지시 | N |
| 05:4668-4688 | MyStudy 컴포넌트 11개 수정이 코드 없이 산문 | N(양은 크지만 구체적) |
| 05:5049-5053 | schedule 컴포넌트 5개 산문 | N |
| 05:3844 | `{ …기존…; leaderTone?: Tone }` | N |
| 04:503 | "`pg_sleep(0.01)` 대신 … 완화하고 주석" — 실패 시 테스트를 바꾸라는 조건부 지시 | N |
| 04:1443 | `total` 을 Task 10 전후로 바꿨다 되돌리라는 이중 지시 | N |
| 04:1191, 04:57 "다르면 테스트 쪽을 고친다" | 계약이 확정됐으니 불필요한 분기 | N |
| TBD/TODO | 없음 | — |

---

## D. 정확성 리스크

### D-1. SQL / Supabase

| # | 등급 | 내용 | 위치 |
|---|---|---|---|
| B4 | **B** | 03:2479-2490 이 "PostgREST 는 public 함수 전부를 노출" 이라며 내부 함수를 회수했는데, 04 는 `submission_json(bigint)`(SECURITY DEFINER, 임의 id 의 본문·링크·파일), `task_node_json(bigint, uuid)`(p_uid 아무 값 → 비공개 방 사람별 상태), `room_tag_json(bigint)`(비공개 방 태그), `settings_json(bigint)`, `leader_room` 등을 회수 목록에서 빠뜨림. `rpc('submission_json',{p_sub:1})` 로 비로그인 열람 가능 → D7 "제출물 본문·첨부·링크 비로그인 불허" 위반 | 04:397, 862, 2262, 1385, 1370; revoke 04:1432-1437, 1752-1753, 2043-2050, 2406-2409 |
| B3 | **B** | 아래 §E 참조 | 04:1833-1834 |
| S1 | S | Storage 키에 원본 파일명(`{uuid}-{name}`) → 한글·공백·특수문자 파일명 업로드 실패. 경로는 `{uuid}.{ext}`, 원본명은 `files.original_name` 으로 | 04:18, 525, 630 |
| S2 | S | `job_cleanup` 의 `delete from storage.objects` → 실제 객체 고아(+ 최신 Storage 의 직접 삭제 차단 가능성) | 04:2020-2022 |
| S3 | S | READY 고아 파일 영구 잔존·한도 점유 | 04:680-685, 2016 |
| S4 | S | 제출 시 Storage 존재 재검증 없음 + 소유자 삭제 정책 | 04:463-468, 01:1527 |
| S5 | S | 알림 dedupe 계약 불일치(B-2) | 04:61-71 vs 03:1520-1537 |
| S6 | S | 태그 자동 선택 훅 대부분 부재(A-1) | 04:75-83 vs 02:573~, 03:1542 |
| N | N | `left(prefix||':'||uid, 160)` — prefix 가 길면 uuid 가 잘려 다른 사용자끼리 충돌 가능(현 prefix 는 짧음) | 04:1298 |
| N | N | `member_deactivate` 에서 `action` 누락(null) 이면 `not in` 검사를 통과해 exclude 로 처리 | 04:1701-1704 |
| N | N | 테스트가 `app.now=10/03` 과 `app.today=10/12` 를 동시에 둠 — 지각 판정은 app_now, 시작일 검사는 kst_today 라 시계가 갈라짐 | 04:166, 282 |
| N | N | 2자 별칭 부분 일치 오탐(`cs`⊂"docs", `데이터`⊂"데이터베이스" → aws 에 `data` 점수 1) | 04:2257-2260 |
| N | N | 시드 알림 DEADLINE_REMINDER 의 created_at(10/13 00:00Z)이 가장 늦은데 id 는 가장 작음 → 드롭다운 순서 ≠ 시간 순 | 04:2686 |
| N | N | `TASK_ALL_SUBMITTED`·digest 는 "최초 제출로 완료"만 감지 — 이탈 처리 exclude 로 완료된 리프는 알림 없음 | 04:485-494, 2000 |
| ✅ | — | Edge Function 인증: `Authorization: Bearer` → `auth.getUser()` 후 `leader_id` 비교, `tag_apply_auto` 만 service_role(04:2451-2461, 2506-2515). 보관 방 미검사·202 아님은 N | |
| ✅ | — | cron UTC 환산, `xmax=0`, `language` 교체, 서브쿼리 whole-row → composite 함수(실측) | |

### D-2. 프론트

| # | 등급 | 내용 | 위치 |
|---|---|---|---|
| ✅ | — | Next 16 `proxy.ts`: plan 01 이 `src/proxy.ts` + `src/lib/supabase/middleware.ts`(`updateSession`)로 만들고 05 가 그대로 소비 — 일관 | 01:760-772, 05:21 |
| ✅/N | — | 서버/클라이언트 경계: `today.ts`·`me.ts` 는 `"use client"` Provider 를 서버 레이아웃이 렌더(정상), 서버 페이지는 전부 `rpc(…, client)` 로 서버 클라이언트를 넘김. 다만 `rpc()` 가 client 생략 시 **브라우저 싱글턴**으로 떨어지므로 서버 코드에서 실수로 생략하면 쿠키 없이 anon 으로 조용히 호출됨 | 05:475-489 |
| ✅ | — | TodayProvider: 루트(`meta_get`) + MyStudy 는 응답 `today` 로 중첩 Provider, Schedule 은 props — 화면별 서버 today 우선 | 05:700-712, 4642 |
| S13 | S | 루트 레이아웃이 `meta_get` 실패 시 전 사이트 500, `error.tsx` 없음 | 05:702 |
| ✅ | — | buildTree 교체: 출력 모양 유지, 소비 함수 시그니처 변경(`leafState/ddayLabel/myCode/boardColumn/calendarAnchor/ganttRange/memberStats`, `Tree.members: TreeMember[]`, `Person.userId/tone`)을 Step 11 이 파일별로 짚음. 기존 CurriculumTab 의 `editSel: \`${id}.${childCount}\`` 임시 id 흐름을 `api.create` → 응답 id 로 대체 | 05:4678 |
| ✅ | — | BoardTab 회차 필터 `l.id.split(".")[0]` → `l.roundId` | BoardTab.tsx:14, 05:4682 |
| ✅ | — | OverviewTab `tree.roots[i]` 인덱스 가정 → `roundId` 매칭(창이 3개라 인덱스 어긋남 해결) | 05:4674 |
| S15 | S | `OverviewTab.tsx:64`, `CurrentRoundCard.tsx:66` 이 `subs / t.people.length` — 현재 회차에 담당자 0명 지정 과제(허용, `UNASSIGNED_TASK` 경고)면 NaN%. plan 05 미수정 | src 직접 |
| N | N | 낙관적 Overrides: `create` 성공 시 `dropKey(added, key)` 가 같은 부모의 임시 항목을 전부 지워 연속 클릭 시 두 번째 임시 행이 잠깐 사라짐. `remove` 의 `hasSub` 는 담당 기준 `n.sub` 라 released 담당자(도윤)의 제출물은 못 봐 `NODE_HAS_SUBMISSIONS` 토스트로만 처리 | 05:4513-4542 |
| N | N | 임시 회차 라벨 `"{n}회차"`(05:4120) vs 서버 기본 `"{n}주차"`(03:1013) → 행 라벨이 깜빡 바뀜 | |
| N | N | EditPanel 담당자 후보가 `tree.members` 전체 — `doesTasks=false` 그룹장도 노출 → 서버 `ASSIGNEE_NOT_MEMBER` | 05:4680 |
| N | N | "저장했어요 · 태그를 자동으로 다시 골랐어요" 를 항상 표시 — 실제 재선택은 title/description 변경 시만 | 05:4567 vs 03:1542 |
| N | N | 다음 마감 경로 `"2주차 EC2·S3 · 지정 과제"` — 목업은 `"2주차 › EC2·S3 · 지정 과제"`(my-study.ts:131). glance active 문구도 목업과 다르게 채택(05:5349) — "문구 유지" 제약(05:29)과 충돌 | 05:4325 |
| S16 | S | `node_move`(들여쓰기·드래그), 태그 수동 편집 UI 소비처 없음 | 05:751 |

### D-3. E2E (ego-browser 만 사용 — ✅ claude-in-chrome 미사용)

| # | 등급 | 내용 | 위치 |
|---|---|---|---|
| B6 | **B** | 로컬 DB 는 실제 오늘 — 05:5188 은 D-day 숫자만 패턴화하지만, **상태 전이**까지 바뀐다: 10/14 이후 EC2 마감 경과(→ "내 다음 마감 EC2", aws "50%" 깨짐 — `rooms_list` mine 분모가 시작된 과제 기준이면 10/15·10/22 마다 변함), 10/19 cs·jcg ACTIVE(Step 5.4 "정원 마감", Step 9 invite "참가하기" 실패), 10/26 sqld ACTIVE + 철수 EXPIRED(Step 5.3, Step 8 `room_approve` → `ROOM_NOT_RECRUITING`). 고정 기준일(예: 로컬 전용 `alter database postgres set app.today = '2026-10-12'`) 또는 상대 날짜 시드가 필요 | 05:5188-5287 |
| S14 | S | 배지 "`1`" 단언 — 04 시드가 철수에게 미읽음 3건(04:2683-2705)을 넣으므로 4. "모두 읽음 비활성"도 거짓 | 05:5283 |
| S14 | S | "칩 3개" — `me_schedule.studies` 는 철수 기준 5개(aws·spring·sqld·docker·algo, 03:1934, 1950) | 05:5082, 5273 |
| S14 | S | "6회차 새 회차" 행 — 서버 응답 후 "6주차" | 05:4770, 5268 |
| N | N | `loc=text:사용할 수 있어요` — ego-browser 는 `text=…`·`loc=css/role/href` 만 지원(SKILL.md:219-224) | 05:5226 |
| N | N | `kill %1` — 매 Bash 호출이 새 셸이라 잡 번호 없음 | 05:5292 |
| N | N | Task 4 Step 7 "시드에 알림이 없으면 '아직 알림이 없어요'" — 시드에 3건 있음 | 05:1316 |

---

## E. Vitest·PGlite 픽스처 산수 검증

### E-1. plan 05 (Vitest)

| 단언 | 계산 | 판정 |
|---|---|---|
| toeic `periodCard` "2026.11.02 – 12.27 · 8주" | 11/02→12/27 = 55일, +1 = 56 → 56/7 = 8 | ✅ (rooms.ts:63 "8주") |
| spring "2026.10.05 – 2027.01.31 · 17주" | 26+30+31+31 = 118, +1 = 119 → 17 | ✅ (rooms.ts:79) |
| aws "13주"(목업 "3개월" 폐기), algo "13주" | 91+1=92 → 13.1 → 13 | ✅ (D14) |
| toeic note "11.02(월) 시작 · 6자리 남음", em "D-21", pct 25 | 2026-11-02 월, 10/12→11/02 = 21, 2/8 | ✅ (rooms.ts:64) |
| aws mine "50%" D-2 | 2/4, 10/12→10/14 | ✅ (rooms.ts:48, 02 §8 "2/4=50%") |
| algo final "87%", "68/78" | algoMiss 10건 → 78−10 = 68, 68/78 = 87.2 | ✅ 수치 / ⚠️ **S10** 문구 |
| **S10** algo "13주 완주"·"13회차 · 완료" | 픽스처가 `roundCount: 13`/`totalRounds: 13` 을 직접 넣음(05:2456, 2474, 2720). 실제 시드는 depth-2 회차 3개(03:689-691) → 실데이터 화면은 "**3주 완주**", "**3회차** · 완료". 주 수는 `periodCard` 주(13)를 써야 함 | ❌ |
| sqld "1/5명 · 20 · 10.26(월) 시작 · 승인 대기중 · D-14" | 10/26 월, 14일 | ✅ |
| jcg "4/4명 · 100 · 10.19(월) · 정원 마감 · D-7", docker "1/6 → 17%"(D3로 0→1) | | ✅ |
| react team "4/8주 · 50%" | 9/21 기준 4번째 주 = 10/12–18 | ✅ |
| aws `roundsWindow` 1·2·3 + "이후 10개" | 13회차, idx 1, lo 0, hi 2 → 13−1−2 = 10 | ✅ (room-view.ts:180) |
| react 3·4·5 + "1~2주차 완료 · 이후 3개" | idx 3, lo 2, hi 4, after 3 | ✅ (room-view.ts:212) |
| recruit toeic 이후 5 / sqld 이후 1 / jcg "" | 8−3, 4−3, 2 | ✅ |
| toeic glance "8회차 · 매주 월요일 시작 / 16개 · 모두 공통 과제", cs "12회차 · 월·목 시작", jcg "2회차" | | ✅ (room-view.ts:80,99,155) |
| sqld glance "9개 · 공통 7 · 지정 2" | 픽스처는 목업 문구, PLANS 시드는 지정 1개(my-study.ts:383) → 실화면 "공통 8 · 지정 1" | N |
| aws curOf meta "10.08(목) – 10.14(수) · 마감 D-2" | 10/01 목 → 10/08 목, 10/14 수 | ✅ |
| toeic curOf "11월 2일(월) 첫 회차가 열려요 / 8회차 · 과제 16개 준비됨" | | ✅ (room-view.ts:71) |
| periodLong toeic "(월) – 12.27(일)", spring "(일)" 2027-01-31 | 2026-12-01 화 → 12/27 일 | ✅ |
| model: 회차 63/33/0/0/0, 전체 24, 5/8·1/3·0/4·0/4·0/6 | IAM DLDM 3 + VPC DMDM 2 = 5/8, 62.5→63(half-up), 6/25 | ✅ (D5, 03:94) |
| 철수 2/6, 하나 0/7, (E2E) 민수 2/5·지은 2/7 | DynamoDB `-P-P` = 지은·하나 | ✅ (03:94) |
| overrides: 1주차 보관 시 5% | 2주차 1/6 + 0/4 + 0/4 + 0/6 = 1/20 | ✅ |
| 임시 회차 s 11-05 / e 11-11 | 마지막 회차 끝 11/04 + 1, +6 | ✅ (라벨은 D-2 N) |
| my-study `toStudyRoom` "이후 2개 회차가 더 있어요 · 커리큘럼 탭에서 전체 보기" | 5회차(시드), idx 1 → after 2 | ✅ (목업 10개는 가상 데이터) |
| sidebar left 2·6, "09.30 종료" | | ✅ (my-study.ts:281-283) |
| schedule 창 09-27~10-31, 11-20 확장(54일), 09-10 확장(51일), 12-15 리셋(79>62) | 2026-10-01 목 → 앞 일요일 09-27, 10-31 토 | ✅ |
| schedule tone: 픽스처 sqld=amber | 03:2063 `id % 6` → sqld(id 3) = **lav**(spring 과 동색) | N |
| upcoming 정렬 "EC2 < 섹션 6~7 < 싱글톤" | 10/14 < 10/18, ㅔ < ㅣ | ✅ |
| "N passed" 개수 | notifications 4(문서 5, 05:1169) · nickname 4(5, 05:1791) · room-view 8(9, 05:3558) · schedule 8(9, 05:4959) · my-study 8 + import 한 model.test 8(05:4470) | N |

### E-2. plan 04 (PGlite)

| 단언 | 계산 | 판정 |
|---|---|---|
| 1주차 5/8 → 하나 IAM 제출 6/8 | | ✅ |
| 지은 이탈 → 1주차 6/4, EC2 1/0, member_count 3 | IAM 3/2 + VPC 3/2 | ✅ |
| 하나 이탈 → 1주차 6/5 | IAM 3/3(민D 지L 철D) + VPC 3/2 | ✅ |
| `task_get` 보관 IAM — 그룹장 3건 | D·L·D | ✅ |
| `is_late` 경계 UTC 10/03 15:00:30 = KST 10/04 00:00:30 → true / 14:59:59 → false | `kst_deadline(10/03)` = 10/04 00:00 KST | ✅ |
| digest "어제 1개" (10/12 실행) | 하나가 10/11 에 IAM 제출 → 4/4, aws 의 다른 완료 리프 없음 | ✅ |
| **B3** `job_round_started` 10/12 → 0 | spring 2주차 start 10/12(my-study.ts:362), spring ACTIVE 5명, 시드 알림 dedupe 는 `seed:*` 라 충돌 없음 → **5** | ❌ |
| `round_started` 10/15 ≥ 4, 도윤 0 | aws 3주차, ACTIVE 4 | ✅ |
| placeholder 사례 tick@10/26: 가은 ROOM_STARTED 1·서연 1·철수 JOIN_EXPIRED 1 | 10/26 까지 시작하는 RECRUIT = cs(예린)·jcg(수민)·sqld(가은). 서연은 toeic(11/02) 그룹장이라 영향 없음 | ✅ |
| autoselect(aws) 상위 3 `[aws, cert…, cloud]` | aws ≫, 자격증 = 제목 3 + '합격' 소개 2 = 5, 클라우드 = '고가용성' 소개 2 + 노드 3 = 5, 동점은 slug 순 `certificate` < `cloud` | ✅ 순위 / ❌ slug 오기(B2) |
| node_update "도커 컨테이너" → docker AUTO | docker 2점, 5위 안 | ✅ |
| 알림 목록 25+3 = 28, 20 + 8 | | ✅ (Task 10 시드 후) |
| 총 신규 48 사례(2+6+4+6+9+6+7+6+2) | | ✅ |

---

## F. Review Focus 소유 항목 — 테스트에 박혔나

| 출처 | 항목 | 테스트 | 판정 |
|---|---|---|---|
| 00 RF2 | 자정 경계 지각 | 04 `submissions: is_late boundary` ×2 (04:281-293) | ✅ |
| 00 RF3 | 이탈자 분모 + 그룹장 열람 | 04 `deactivate 지은`, `도윤 … 5/8`, `task_get archived node` | ✅ |
| 00 RF3 | **INACTIVE → 재참가 거부** | 04:1550-1552 `assertRejects(room_apply('aws'))` — aws 가 ACTIVE 라 `ROOM_NOT_RECRUITING` 으로 통과, `MEMBER_NOT_ACTIVE` 분기(02:2124)는 실행되지 않음 | ❌ **S7** (RECRUIT 방에서 INACTIVE 행을 만들어 코드까지 단언해야) |
| 00 RF5 | cron 재실행·누락 | 04 placeholder 사례 tick 2회(ROOM_STARTED 1건 유지), Task 7 각 잡 재실행 0 | ⚠️ "이틀 밀린 tick 이 지난 RECRUIT **전부** 전환"은 cs·jcg 를 단언하지 않음 N |
| 04 RF1 | 자정 경계 | 위와 동일 | ✅ |
| 04 RF2 | 이탈자 분모, 재이탈 MEMBER_NOT_ACTIVE | `deactivate 지은`(04:1555), `도윤`(04:1560) | ✅ |
| 04 RF3 | 잡 같은 날 0건 / 다른 날 새 키 | draft_blocked 3단(04:1810-1818), round·reminder·digest 재실행 | ✅ (단 round_started 사례는 B3 로 실패) |
| 04 RF4 | 옵션 알림 꺼짐·설정 행 없음 = ON | `optional kind filtered` (04:1034-1050) | ✅ |
| 04 RF5 | 지운 AUTO 복귀 금지·수동 재추가 시 해제 | `suppression` (04:2140-2158) | ❌ B2 로 실패 |
| 05 RF1 | 해 넘김 기간 | `periodCard` spring (05:2353) | ✅ |
| 05 RF2 | 현재 회차 없음 | `curIndexOf/roundsWindow gap`, `curOf without current round` | ✅ |
| 05 RF3 | `st:null` 보정 + **upcoming 제외** | `toScheduleData` tasks 사례는 ✅, 그러나 픽스처 `upcoming` 에 null 항목이 없어 제외 로직(05:4951) 미검증 | ⚠️ **S17** |
| 05 RF4 | 네트워크·AuthApiError → UNKNOWN | `TypeError` ✅(05:408). `AuthApiError` 형(`code` 有, `hint` 無)은 `toApiError` 사례 없음(otp 쪽만) | ⚠️ N |
| 05 RF5 | returnTo 오픈 리다이렉트 | 05 `routes.test` (`//`, `https://`) — plan 01 보다 약함(`/\`, `..` 미포함) | ⚠️ S9 |

---

## 10줄 요약

1. **B1** plan 04 `_boot.ts` 가 citext·pg_trgm 없이 PGlite 를 띄워 0001 에서 실패(실측) — plan 01 `openDb()` 를 재사용해야 plan 04 테스트가 하나라도 돈다.
2. **B2** 태그 slug 가 사전은 `certificate`, 테스트는 `certification` — tags 3사례와 RF5(억제)가 실패한다.
3. **B3** `job_round_started` 10/12=0 단언이 spring 2주차(10/12 시작, 5명)와 충돌.
4. **B4** `submission_json`·`task_node_json` 등 SECURITY DEFINER 헬퍼를 회수하지 않아 anon 이 PostgREST 로 제출물 본문을 읽는다(D7 위반).
5. **B5** plan 05 에 모집 시작·지금 시작·승인/거절·초대 링크 복사 UI 가 없어 새 방은 DRAFT 에 갇히고 승인제·비공개 방은 SQL 없이 운영 불가.
6. **B6** E2E 가 실제 오늘로 돌아 10/14·10/19·10/26 상태 전이 뒤 핵심 단언이 깨진다 — 고정 기준일이나 상대 날짜 시드 필요.
7. Storage: 한글 파일명 키 거부(S1), SQL 삭제로 객체 고아(S2), READY 고아 무정리(S3), 제출 시 존재 재검증 없음(S4).
8. 플랜 간: 알림 dedupe·수신자 계약이 plan 03 과 다름(S5), 태그 자동 선택 훅은 node_update 에만(S6), vitest·safeReturnTo 중복(S9), 테스트 명령에 `--config` 누락(S8).
9. 프론트: `?task=` 링크 미처리(S11), algo "13주 완주"가 실데이터에선 "3주"(S10), 빈 people NaN(S15), 공통 상태·에러 경계 부재(S13), E2E 기대값 3건 오류(S14).
10. §4.10 제출 UI 이월은 plan 06 을 개요에 등록하고 게이트 문구를 낮추는 조건으로만 수용 가능 — 현재는 갭(S12). 나머지 산수(toeic 8주·D-21, aws 50%·D-2·24%, algo 87%, 회차 창, glance)는 맞다.

---

## 반영 내역 (2026-10-13)

> 수정 대상: `04` = `2026-10-13-backend-04-submission-notification-tags.md`, `05` = `2026-10-13-backend-05-frontend-integration.md`. plan 00~03·스펙·src 는 건드리지 않음.

### Blocker

| id | 변경 | 위치 |
|---|---|---|
| B1 | `_boot.ts`·storage/`auth.role()` 중복 스텁 삭제. plan 01 `_harness.ts`(`openDb`·`applySeed`·`withCase`·`sqlTest`·`asUser`·`asAnon`·`setToday`·`expectFail`)를 import 하고, 새로 만드는 건 시드 조회·시계 헬퍼 `_fixtures.ts`(`uidOf`·`roomId`·`nodeId`·`setNow`·`one`·`uuids`·`cases()` — `sqlTest`+`withCase` 위의 얇은 어댑터, plan 03 `uid`/`roomId` 재사용)뿐. 모든 테스트 파일 import·부팅(`openDb()`+`applySeed()`)·`asUser(q,null)`→`asAnon(q)`·`jsr:@std/assert`→`@std/assert` 교체, 모든 실행 명령 `npm run test:db -- --filter "<group>:"` | 04: 파일 구성, 서두 인터페이스, Task 1(전면 재작성), Task 2~10 테스트·Run |
| B2 | `certification` → `certificate` 전부 | 04: Task 8 계약·테스트 |
| B3 | `job_round_started` 10/12 단언을 spring 2주차(ACTIVE 5명) 기준 `5`, 재실행 `0` 으로 수정 + spring ACTIVE 수 가드 | 04: Task 7 테스트 |
| B4 | revoke 문 전부 삭제 → GRANT 전용. 0007 `task_get`(anon)·`submission_upsert`·`file_register`, 0008 `notifications_*`·`settings_*`·`member_deactivate*`, 0009 `tags_search`·`room_tags_get`(anon)·`room_tags_put`·`room_tags_suggest`, `tag_apply_auto` 만 service_role. `has_function_privilege` anon/authenticated=false 단언: `submission_json`·`task_node_json`·`file_json`·`storage_exists`(Task 4), `notify_*`·`notification_*`·`leader_room`·`settings_json`(Task 5), `deactivate_*`(Task 6), `job_*`(Task 7), `room_tag_json`·`tag_*`(Task 8). 종료 게이트에 anon 실행 가능 함수 목록 점검 추가 | 04: Global Constraints, Task 4·5·6·7·8 SQL·테스트, 종료 게이트 4 |
| B5 | 헤더에 "범위 밖 → plan 06" 박스(§4.10 제출, §4.4 승인/거절·초대 복사, 모집 시작/지금 시작, 태그 편집, `node_move`, 라우트별 loading/not-found). Task 10·11·12 에 같은 노트 + `{/* plan 06 */}` 자리표. 게이트 문구 "Phase 7a 종료"로 낮춤 | 05: 헤더, Task 10·11·12 Interfaces, 종료 게이트, Self-Review |
| B6 | E2E 를 seed 의 `app.today=2026-10-12` 고정 기준 정확값으로 재작성. Step 1 에 `psql … select kst_today()` + PostgREST `meta_get` 둘 다 2026-10-12 확인(아니면 재기동·중단) 추가 | 05: Task 15 서두·Step 1·3·5·6·7·8 |

### Should-fix

| id | 변경 | 위치 |
|---|---|---|
| S1 | Storage 키 `{uuid}.{ext}`(원본명은 `files.original_name`), 경로 정규식 교체, 옛 `{uuid}-{name}` 거부 사례 추가 | 04: Global Constraints, Task 3 SQL·테스트·files-db |
| S2 | `job_cleanup` 은 `files.status='DELETED'` 표시만 — `storage.objects`·`files` 행 삭제 제거, 반환 `{filesExpired, orphansExpired, mailPurged}`, 객체 잔존 단언 | 04: Task 7 SQL·테스트 |
| S3 | 24h 지난 미연결 READY 고아 → DELETED(`job_cleanup`), `file_register` 5개 한도는 미연결·24h 이내 파일만 셈(연결 파일은 `submission_upsert` ≤5) + 고아 제외 사례 | 04: Task 3·7 |
| S4 | `submission_upsert` 가 파일마다 `storage_exists(bucket, path)` 재검증 → 없으면 `FILE_NOT_READY` + 사례 | 04: Task 2 SQL, Task 3 테스트 |
| S5 | 서두 알림 계약표를 D8 + plan 02/03 실제 호출로 재작성(SCHEDULE_CHANGED 수신자 = 리프 담당자, prefix 실제 모양). 행위성 3종은 `notify_publish` 가 `:txid` 를 붙임(plan 03 호출부 무수정으로 D8 충족) + 사례. 04 내부 호출 prefix(`ROUND_STARTED`·`DEADLINE_REMINDER`·`TASK_*`·`MEMBER_DEACTIVATED`…)를 `KIND:room:node…` 로 통일 | 04: 서두 계약표, Task 2·5·6·7 |
| S6 | "훅은 plan 03 `node_update` 에만" 사실대로 기술, 0004·0006 함수 재정의 금지 명시, 새 방은 첫 커리큘럼 저장 또는 `room_tags_suggest` 후 AUTO 태그 — "new room" 사례 추가 | 04: 서두, Task 8 Interfaces·테스트·SQL 주석 |
| S7 | RF3: RECRUIT·APPROVAL 방(sqld)에 INACTIVE 행을 만들고 `room_apply` → `MEMBER_NOT_ACTIVE` 단언(기존 `assertRejects` 제거) | 04: Task 6 테스트 |
| S8 | plan 04 의 모든 deno 실행을 `npm run test:db`(= `--config supabase/tests/deno.json`)로. plan 05 에는 deno 명령 없음 | 04 전 태스크 Run, 종료 게이트 1 |
| S9 | `routes.ts` 가 plan 01 `return-to.ts` 의 `safeReturnTo`·`loginUrl` 을 re-export(약한 중복 구현 삭제, 동일 함수 참조 단언, `/\evil.com`·`/rooms/../me` 사례). Vitest 설치·설정 단계 삭제 → plan 01 것 확인만 | 05: Task 1 Step 1, Task 2 |
| S10 | `periodWeeks()` 추가 — "N주 완주" = 기간 주 수(13), "N회차" = roundCount. 픽스처 algo `roundCount/totalRounds: 3`, glance "3회차 · 완료" | 05: Task 8, Task 9 |
| S11 | `/my-study/[id]` 가 `?task=` 를 읽어 `initialLeaf` → `goLeafPatch`(커리큘럼 탭 + 리프 열림), 검증·E2E 항목 추가 | 05: Task 12 Interfaces·MyStudyScreen·page·Step 13, Task 15 Step 8 |
| S12 | B5 와 함께 처리(plan 06 등록 참조) | 05: 헤더·Self-Review |
| S13 | 루트 레이아웃 `meta_get` 실패 → `kstToday()`(Intl Asia/Seoul) 폴백, `me_get` 실패 → 익명, 루트 `error.tsx`(Next 16 `retry`). 라우트별 loading/not-found 는 plan 06 | 05: Task 2 |
| S14 | E2E: 배지 3 → 승인 후 4 → 클릭 후 3 → 모두 읽음 활성, 일정 칩 5개, "6주차" | 05: Task 13 Step 8, Task 15 Step 6·7·8 |
| S15 | `CurrentRoundCard`·`OverviewTab` 담당자 0명 → "담당자 미정"(NaN 가드) + 어댑터 사례 | 05: Task 11 Step 9, Task 12 Step 6·11 |
| S16 | `node_move`·태그 편집 UI → plan 06 참조(헤더·Task 12·RPC 표) | 05 |
| S17 | 일정 픽스처 `upcoming` 에 `st:null` 항목 추가 + 제외 사례 | 05: Task 13 테스트 |
| D5 | aws 내 진척률 픽스처 2/4·50% → **2/6·33%**, D-2 유지(EC2 OPEN) | 05: Architecture, Task 9 테스트·Room 노트, Task 15 Step 3 |

### Nit

| 항목 | 변경 | 위치 |
|---|---|---|
| dedupe `left(…,160)` | 160자 초과 시 `'h:'||md5(base)||':'||recipient` — 수신자 uuid 보존 + 사례 | 04 Task 5 |
| `member_deactivate` null action | `LEAVE_DECISION_MISSING` + 사례 | 04 Task 6 |
| 시드 알림 순서 | 시간순 INSERT(D-3 리마인더 10/11 → 2주차 시작 → 일정 변경), 모두 기준일 이전, createdAt 역순 단언, seed 마지막 `app.today` 줄 앞에 삽입 | 04 Task 10 |
| 2자 별칭 오탐 | 영숫자 2자 용어는 단어 경계 필요(`cs`⊄docs), 한글은 조사 때문에 부분 일치 유지(한계 주석) + 사례 | 04 Task 8 |
| 기타 04 | 자리표 위치 "0002/0005"→0004, `updatedAt` 조건부 지시 → `>=` 확정, `total` 이중 지시 → 시드 수 직접 계산, "다르면 테스트를 고친다" 분기 삭제, 시드 tags 사전 우선순위(0009 승) 사실대로 | 04 서두·Task 2·5·8 |
| `loc=text:` | `text=` | 05 Task 15 Step 2 |
| `kill %1` | pid 파일 + 포트 기준 정리, `SPACE_ID` 환경변수로 전달 | 05 Task 15 Step 1·2·10 |
| Task 4 Step 7 | 시드 3건 기준 배지·드롭다운 문구로 수정 | 05 Task 4 |
| `periodOf` | 정의 없는 지시 삭제 → `format.ts` `periodLong` 하나로 | 05 Task 7 |
| 말줄임 타입 블록 | `src/data/rooms.ts` Room, `room-view.ts` RoomMember/RoomTask/Room, `my-study.ts` Room 전체 블록으로 | 05 Task 9·11·12 |
| `leaderTone` | room-view 확장 목록·타입·`toRoom` 에 추가 | 05 Task 11 |
