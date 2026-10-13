# 계획 00–03 적대적 리뷰 (Supabase 백엔드)

> 대상: `docs/superpowers/plans/2026-10-13-backend-{00-overview,01-foundation-auth,02-rooms-membership,03-curriculum-progress}.md`
> 기준: `docs/backend/01-decisions.md`(D), `02-domain-and-schema.md`(S2), `03-api.md`(API), `docs/claude-design-prompt.md` §2, 목업 `src/data/{my-study,rooms,room-view,schedule}.ts`.
> 표기: **P00/P01/P02/P03** = 각 계획 파일, `L123` = 그 파일의 행. 등급 **B**=blocker(그대로 실행하면 실패하거나 보안 구멍), **S**=should-fix, **N**=nit. 고치지 않고 보고만 한다.

---

## A. 스펙 커버리지 공백

| # | 등급 | 스펙 원문 | 현재 상태 | 맡아야 할 태스크 |
|---|---|---|---|---|
| A1 | S | S2 L352 "트리거: … `goal_nodes` BEFORE INSERT/UPDATE 에서 depth·root·period CHECK 보강" | 어느 계획에도 없음. P01 Task 5 의 트리거는 `updated_at`·I9·이메일 동기화뿐(P01 L1210-1231). 노드 불변식(I3·I4)은 함수 코드에만 있고, 시드·테스트·service_role 이 직접 INSERT 하면 막는 장치가 없음 | P03 Task 1(0006) |
| A2 | S | D L166 "`nextDue` \| OPEN 만" | P02 `room_detail_json.nextDue`(L543)와 `rooms_list.nxt`(L1758)는 `end_date >= today` 만 봐서 **시작 전(planned) 과제도** 포함. 테스트가 이 위반을 단언함: P02 L1521(10/12 에 10/15 시작 ALB 를 nextTask 로), L687(11/01 시작 과제를 nextDue 로). 반면 P03 `me_studies`(L1889)는 OPEN 만 — 두 화면의 "다음 마감" 규칙이 서로 다름 | P02 Task 1·4 |
| A3 | S | D L107 "읽기는 RLS SELECT 정책 + 집계 함수(**SECURITY INVOKER**, RLS 통과한 행만 집계)" | 모든 읽기 함수가 `SECURITY DEFINER` + 함수 안에서 직접 거르는 방식(P02 L7, L1646, L2658; P03 L975). 설계를 바꾼 셈인데 D7 이 갱신되지 않음 → 이후 리뷰어가 RLS 가 읽기를 지킨다고 오해할 수 있음 | P00(D7 개정 또는 근거 명시) |
| A4 | S | S2 L381 "철수 aws 내 진척률 **2/4=50%**(방 목록)" | 전체 시드로는 만들 수 없는 값(E절 참조, 실제로는 2/6). P02 는 부분 트리(`seedAwsTree`, 3회차)로만 2/4 를 재현하고(L1501), P03 게이트는 2/6 이라고 말함(L2126). 어느 쪽인지 결정이 없음 | S2 §8 결정 + P03 Task 2 |
| A5 | S | D L115 "본인이 일으킨 이벤트는 본인 제외" | 이 책임이 `notify_publish` 자리표 계약(P02 L65-66)에 없음. 호출하는 쪽마다 다름: P03 `SCHEDULE_CHANGED` 는 호출자가 직접 v_uid 를 뺌(L1524), `TASK_ASSIGNED` 는 빼지 않음(L1532), P02 `ROOM_STARTED` 는 행위자(그룹장)를 수신자에 넣음(L884) | P00 공통 계약 / P02 Task 1 |
| A6 | S | S2 §3 I7 "야간 `member_count_audit()` 보정", §6 L350 | 00–03 범위 밖이고 P00 표는 cron 잡을 plan 04 에 배정. plan 04 에 실제로 있는지 확인 필요 | plan 04(확인) |
| A7 | N | D L121 "루트=depth 2 & label" | `node_update` 로 회차 label 을 null 로 지울 수 있음(P03 L1444). `node_move` 로 리프를 루트로 올리면 `task_type` 을 가진 depth-2 리프가 생김(L1693-1695, L1725). 그런데 `node_create` 는 회차에 taskType 을 금지함(L1160) | P03 Task 5·6 |
| A8 | N | API §2 `CreateRoom.coverFileId` | 소유자·`purpose` 검증 없이 아무 파일 id 나 받음(P02 L617-620, L1085) | P02 Task 1·2(또는 plan 04 files 이후) |
| A9 | N | S2 §8 L372 "철수·민수·…·**태민·소연·준호** …" | 목업 어디에도 없는 이름. P01 은 `NAME_TONE` 29명만 시드(L1869-1898) — 계획이 맞고 스펙이 틀림 | S2 §8 정정 |
| A10 | N | S2 L27 "`0004_cron.sql` 에서 CREATE EXTENSION" | 다른 곳은 전부 `0010_cron.sql`(S2 L4, P00 L29) — 스펙 오타 | S2 |
| A11 | N | D L65 "모집중 방 asg(**sqld 0/2**)" vs D L83 "sqld null" | 스펙끼리 충돌. P03 은 `leader_does_tasks=false` 로 null 을 택함(L673). P02 주석은 여전히 "sqld 0/2"(L531) | D4 문구 정정 |
| A12 | N | D12 / 목업 태그 tone | `my-study.ts` spring 태그는 Spring **lav**·백엔드 **blue**·Java `auto:false` 인데, P02 시드는 spring **mint**·backend **slate**(L1204-1206)이고 java 는 AUTO(L1325). 클라우드는 목업에서도 docker(mint)·aws(blue)로 갈림 — 전역 태그 하나로는 둘 다 맞출 수 없음 | P02 Task 3 |
| A13 | N | API §6 L227 "방 `tone` 은 `id % 6`" | 규칙대로면 sqld=**lav**(P03 L1956)인데 `schedule.ts` 목업의 sqld 는 amber. 스펙을 따르는 게 맞으니 기록만 | — |

커버 확인(공백 없음): D1·D2·D3·D4·D5·D6·D9·D11 / I1~I6·I8·I10·I11 / S2 §6 공통·상태·동기화·방·멤버십(이탈 처리 제외 — P00 L84 에서 Phase 5 로 배정)·커리큘럼·`me_*`·`room_tick` / API §1·§2·§3(deactivate 제외)·§4·§6 / 디자인 §2.1(상태·정원·승인·만료·공개/비공개·리프≥1)·§2.2(깊이·리프 과제·공통/지정·보관·롤업)·§2.4(task_code). D8·D10·D12 의 나머지는 plan 04 범위.

---

## B. 계획 사이 정합성

| # | 등급 | 항목 | 위치 1 | 위치 2 | 내용 |
|---|---|---|---|---|---|
| B1 | **B** | P02 `seedAwsTree` 사례 ↔ P03 시드 §3 | P02 L1495-1527, L2533-2549, L2588-2618 | P03 L638-754, L17, L760 | P03 Task 2 가 9개 방 전부에 트리를 시드하면 P02 사례 3개가 깨진다. aws 에는 회차가 중복으로 붙고, react 는 `team null/0` 이 아니게 되고, algo 는 `final 0/0/0` 이 아니게 되며, toeic `rounds: []`·stats 0 도 틀어진다. P02 L2836 은 이 수정을 P03 에 넘기는데, P03 은 "다른 파일은 만들지도 고치지도 않는다"(L17)고 하면서 "플랜 01·02 전 사례 PASS"(L760)라고 적어 둠 |
| B2 | S | `room_transition_active/ended` 파일 | P00 L59-62(`0005_membership.sql`) | P02 L76-77, L860-898(`0004_rooms.sql`) | 파일 번호가 다름 |
| B3 | S | `room_progress` 계층 | P02 L80, L1369("room_progress 는 room_round_stats **위에**"), L2525("room_detail_json 교체 가능") | P03 L7, L365-398 | P03 은 `room_progress` 를 독립적으로 만들고 거꾸로 `room_leaf_stats` 가 그걸 쓰게 바꿈. `room_detail_json` 은 교체하지 않음. 숫자는 맞지만 두 문서의 설명이 서로 반대 |
| B4 | S | `expectFail` 이름 충돌 | P01 L430 `expectFail(p, code)`(하네스) | P02 L163 `expectFail(q, sql, params, code)`(`_cases-rooms.ts`) | 이름은 같고 시그니처가 다름. P02 의 Consumes 목록(L41-49)에서 하네스 쪽이 빠져 있음. P03 은 하네스 쪽을 씀(L65) → 잘못 import 할 위험 |
| B5 | N | 하네스 export 목록 | P01 L266-276(Interfaces), L56(파일 표) | P01 L384-442(실제 코드) | `sqlTest`·`migrationFiles`·`makeQ` 가 Interfaces 에 없음. P02(L46)·P03(L66)은 `sqlTest` 를 씀. `withCase/asUser/asAnon/setToday/openDb/applySeed` 는 세 계획이 일치 ✓ |
| B6 | N | P03 의 낡은 단서 | P03 L2132 | P02 L2844 | P03 은 "플랜 02 가 `withCase(name, fn)`/`_seed-users.ts`/MIGRATIONS 일 수 있으니 확인하라"고 하는데, P02 는 이미 고쳤다고 명시함 |
| B7 | N | seed 섹션 번호 | P01 L184("§2 방·멤버 → §3 커리큘럼 → **§4 제출·알림·태그**") | P02 L1195(§2 에 태그 포함), P03 L742-750(§3 에 제출 포함) | plan 04 가 머리말대로 §4 에 태그·제출을 다시 시드하면 중복될 위험 |
| B8 | N | Review Focus 1 정원 | P00 L82 "5/6 방" | P02 L104 "1/2 방" | 테스트는 5/6(P02 L2724) |
| B9 | N | P01 내부 태스크 번호 | P01 L18("Task 6 → Task 8"), L37-41(→Task 8/6) | P01 L2087(→Task 7/5) | 0002 는 Task 5, `me_*` 는 Task 7 |
| B10 | N | `notify_publish` 위치 | P00 L64-65(0008 만) | P02 L65, L341(0004 에 자리표) | 시그니처 7인자·`returns int` 는 세 계획이 같음 ✓. 0004 자리표는 개요에 없음 |
| B11 | N | sqld `leader_does_tasks` | P03 L69(플랜 02 시드가 false 인 것처럼 적음) | P02 L1225(전 방 `true`) | P03 L673 이 덮어써서 결과는 맞음. 서술만 틀림 |
| B12 | N | 태그 slug 19개 | P02 L1136, L1198-1218 | plan 04 `0009_tags.sql`(범위 밖) | 일치 여부는 plan 04 리뷰에서 확인 |

일치 확인 ✓: 시드 사용자 번호·UUID 규칙(P01 L1869-1904 ↔ P02 L57, L157-160), `assignment_resync(p_room bigint)`(P00 L60 ↔ P02 L295 ↔ P03 L53), `membership_result(p_room, p_user)`, `node_update(p_slug,p_node_id,p_patch)`·`node_move(p_slug,p_node_id,p_parent_id,p_index)`(P03 L85-86 ↔ API §4), 마이그레이션 0001–0006 번호, `room_leaf_stats` 반환 열(P02 L376-377 ↔ P03 L391-392).

---

## C. 자리표·미정의 스캔

`TBD/TODO/추후/적절히/비슷하게` 는 없다. 대신 아래가 있다.

| # | 등급 | 위치 | 내용 |
|---|---|---|---|
| C1 | S | P02 L1109 | Task 2 기대값이 "PASS 9 사례, 실패 2건"인데 실제로는 4건이 실패한다: `room_tick`(L733 이 `room_apply` 사용), `room_start`(L705), `room_update 잠금`(L773 `room_join`), archive(L831-837 이 시드 aws 사용 — Task 3 전). tick 사례는 언급조차 없음 |
| C2 | N | P03 L760 | 대안 코드가 `drop function public._seed3_kst_at(date,int), public._seed3_seed_round(…), …;` 로 생략돼 있음. "세 함수"라고 했지만 실제로는 4개(`kst_at`, `seed_round`, `seed_node`, `seed_leaf`) |
| C3 | N | P02 L842-846 | "둘 중 하나만 남긴다" — 실행자가 고르게 남겨 둠 |
| C4 | N | P02 L1801 | "순서가 어긋나면 … 넣는다" — 처음부터 `row_number() over (order by …)` 를 써야 함(D5) |
| C5 | N | P01 L1237, L2052 | 조건부 수정 지시(assert 줄이기, 0003 에 GRANT 추가) |
| C6 | N | P03 L1381 | `count >= 0` 은 항상 참 — 아무것도 검증하지 않는 단언 |
| C7 | N | P03 L2132 | "실제 `_harness.ts` 를 열어 둘 중 어느 쪽인지 확인" — 조건부 서술(B6) |
| C8 | — | 미정의 참조 | `tag_autoselect`(P03 L1542, `to_regproc` 로 보호 ✓), `member_count_audit`·`job_*`·`storage_exists`·`member_deactivate*`(→ plan 04). 00–03 안에서 정의 없이 호출되는 함수는 없음 |

---

## D. SQL 정확성 위험 (Postgres 15 / PGlite / Supabase)

| # | 등급 | 위치 | 위험 |
|---|---|---|---|
| D1 | **B** | P02 L2486-2497, P03 L329/336/350/361/387/971/2044, 지침 P01 L2081·P02 L2310·P03 L23 | **`revoke … from anon, authenticated` 만 하고 `PUBLIC` 은 그대로다.** Postgres 는 새 함수에 기본으로 `EXECUTE TO PUBLIC` 을 주므로 anon 이 PostgREST 로 내부 SECURITY DEFINER 함수를 계속 호출할 수 있다. 영향: `room_detail_json(p_room, p_uid)` 와 `curriculum_json`/`membership_result`/`me_schedule_leaves` 는 **임의의 uid 를 받는다** → 비공개 방 상세 + 그룹장 초대 URL 이 노출되고(`invite_ensure`), 결국 비공개 방에 참가할 수 있다. 그 밖에 `room_transition_active` 로 남의 방 강제 시작, `room_take_seat`/`room_release_seat` 로 정원 오염, `room_tick` 호출이 가능하다. 그룹장 uuid 는 `rooms_list.leader.userId` 로 공개돼 있다. 수정: `from public, anon, authenticated`(+ `alter default privileges … revoke execute on functions from public`). 검증: `has_function_privilege('anon','public.room_detail_json(bigint,uuid)','execute')`. P02 L2786 테스트가 이 문제를 잡아낼 것이므로 L2814 의 "통과" 기대가 틀림 |
| D2 | **B** | P01 L1297-1299 | 테스트 "no insert/update/delete policies anywhere" 가 `pg_policy` 전체를 조회한다. 그런데 같은 마이그레이션이 `storage.objects` 에 INSERT·DELETE 정책을 만든다(L1518, L1527) → `['attachments_delete_own','attachments_insert_assignee']` 가 나와서 실패. Step 4 의 "28 passed" 가 나올 수 없음. `polrelid::regclass::text like 'public.%'` 로 범위를 좁혀야 함 |
| D3 | **B** | P02 L1506-1508 | 민수(그룹장) aws 를 `{submitted 2, assigned 4, nextTask EC2}` 로 단언한다. 하지만 `seedAwsTree` 에서 EC2 는 지은·철수에게만 지정돼 있으므로(L1403) 민수는 IAM·VPC·ALB 3건이다 → 실제는 `{2, 3, nextTask ALB 2026-10-21}`. 테스트 실패 |
| D4 | S | P01 L1112-1115 | `current_user_id() = coalesce(auth.uid(), app.uid)` 는 비로그인 세션에서 GUC 를 믿는 테스트용 뒷문이다. 스텁 `auth.uid()` 가 이미 app.uid 를 읽으므로(L338-339) 필요 없는 코드이고, D13 L149("auth.uid() 를 래퍼로만")와도 어긋난다. 운영에서는 `auth.uid()` 만 써야 함 |
| D5 | S | P02 L1699 | `row_number() over ()` 는 바깥 쿼리에서 서브쿼리의 `ORDER BY` 순서를 보장하지 않는다 → 목록 순서가 비결정적이 될 수 있음 |
| D6 | S | P01 L380-381, L343-347 | pg_cron 을 걷어내는 정규식이 `create extension if not exists pg_cron;` 한 형태만 지운다. Supabase 권장형(`… with schema pg_catalog;`)이나 `cron.unschedule`(스텁 없음)을 0010 에서 쓰면 PGlite 부팅이 실패한다. P00 에 정확한 문장 형태를 고정해야 함 |
| D7 | N | P01 L1104-1227, L1679-1706 | SECURITY DEFINER 가 아닌 헬퍼(`kst_today`, `iso`, `task_code`, `pct`, `leaf_state`, `slugify`, `nickname_*`, `meta_get`, `fail`, 트리거 함수)에 `set search_path` 가 없다 → Supabase linter `function_search_path_mutable` 경고. 실제 해는 없음 |
| D8 | N | P01 L9, L294 / P00 L9 | PGlite 0.3 은 Postgres **17** 기반이고 Supabase 는 15 → PG15 전용 차이는 `*-db.test.ts` 에서만 잡힌다 |
| D9 | N | P02 L413-423, L553 | 그룹장이 `room_get` 하면 잠금 없이 `invite_ensure` 가 돈다 → 활성 토큰이 없을 때 동시에 요청하면 날것의 23505 에러. 드묾 |
| D10 | N | P02 L1633-1637 | 검색어의 `%`·`_` 를 이스케이프하지 않음 |
| D11 | N | P02 L607/619, L1044-1048; P03 L1438-1439 | 잘못된 날짜·불리언 캐스트는 `22007/22P02` 원문 에러가 나고 `VALIDATION_FAILED` 가 아님. `p_join_mode=null` 이면 NOT NULL 위반 |
| D12 | N | P03 L1532, L1536 | `TASK_ASSIGNED:<room>:<node>` dedupe 접두사에 회차·시각이 없다 → 0008 이 `:recipient` 를 붙인 뒤에는 같은 사람을 해제했다가 다시 배정해도 알림이 영구히 막힌다 |
| D13 | N | P02 L314-318 | resync 는 보관된 리프의 **DESIGNATED** 행을 해제하지 않는다 → `is_task_assignee` 가 참이라 Storage INSERT 정책(P01 L1518-1522)을 통과함. plan 04 `submission_upsert` 와 Storage 쪽에서 보관 여부를 검사해야 함 |
| D14 | N | P01 L1505 | `public_profiles` 가 security-definer 뷰 → Supabase advisor 경고(의도된 설계임) |

점검했는데 문제없음 ✓:
- `ON CONFLICT` 대상이 전부 실제 unique/PK 와 맞는다(assignments `(node_id,user_id)`, members `(room_id,user_id)`, `rooms(id)`, `room_tags` PK, `room_invites(token)`, `auth.identities(provider_id,provider)`).
- 재귀 CTE(P03 L321-328, L365-386, L928-933)는 종료한다.
- RLS 헬퍼가 DEFINER 라 정책 재귀가 없다.
- `auth.uid()` 를 INVOKER 에서 써도 안전하다.
- '오늘'은 전부 `kst_today()` 이고 `now()` 는 시각 컬럼에만 쓴다.
- 정원은 `room_lock FOR UPDATE` 와 조건부 UPDATE 로 보호된다.

---

## E. 목업 회귀 산수 검증

| 대상 | 목업 근거 | 계산 | 계획 단언 | 판정 |
|---|---|---|---|---|
| aws 전체 | PLANS.aws | 회차: 8+3+4+4+6=25 배정, 제출 D/L 은 IAM 3 + VPC 2 + EC2 1 = 6 → 24.0% | P03 L452 `24, 25/6` | ✓ |
| aws 회차 | 1주차 DLDM·DMDM / 2주차 -DO-·---O / PPPP / PPPP / PPPP + -P-P | 5/8 · 1/3 · 0/4 · 0/4 · 0/6 | P03 L451 | ✓ (`my-study.ts` rounds 5/8·1/3·0/4 와도 일치) |
| spring | 회차 DDDDD+DLDDM / DODDO+PPPPP / ×2 / PPPPP | 9/10·3/10·0/10·0/5 → 12/35 = 34.3 → 34 | P03 L470-471 | ✓ |
| algo | 6명×13주, 결석 10건(w2·5·6·7·9·10·11·12×2·13) | 68/78 = 87.2 → 87, 묶음 23/24·21/24·24/30 | P03 L472-473, `algo_codes`(L626-627) 한 글자씩 대조 | ✓ |
| sqld | `leader_does_tasks=false`, 철수 PENDING | 0/0 → null | P03 L474 | ✓ (A11 의 스펙 충돌은 남음) |
| 1주차 5/8 · pct 63 | 5/8=62.5 → half-up 63 | — | P01 L1009, P02 L2597 | ✓ |
| react 4/8주 | room-view: 오늘 10-12 = 4주차 시작일 | 현재 회차 4, 전체 8 | P03 시드 L699-706 → rooms_list team `{index 4, totalRounds 8}` | ✓(P02 L1503 의 `null/0` 은 B1 때문에 깨짐) |
| **철수 aws** | rooms.ts slot `50%`, my-study members `철수 2/4` | 실제 철수 배정: IAM D·VPC D·EC2 O·ALB P·AutoScaling P·RDS P = **2/6(33%)** | P02 L1501, L2604 = 2/4(부분 트리) / P03 L501 = 2/6 / P03 L2126 = 2/6 | **충돌** |

**충돌 설명:** 목업의 참가자 숫자는 개요에 보이는 **1~3주차 회차만** 세어 만든 값이다. 민수 2/3·지은 2/4·철수 2/4·하나 0/4 가 1~3주차 리프(IAM·VPC·EC2·S3·ALB)만 셌을 때와 정확히 같다. spring 도 마찬가지다: 지훈 3/6·철수 2/6 이 1~3주차 6리프 기준이고, rooms.ts spring `33%` 도 2/6 이다. 전체로 세면 2/7=29% 가 된다.

반면 API §2 의 `mine.assigned`·§2 `myProgress`·D5 에는 회차 범위를 자르는 규칙이 없다. 그래서 전체 시드에서는 철수 aws 가 **방 목록 슬롯과 참가자 통계 모두 2/6** 이 된다. 정리하면:
- "방 목록 2/4" 는 P02 `seedAwsTree`(3회차만 있는 트리)가 우연히 재현한 값이다.
- "참가자 통계 2/6" 은 P03 전체 시드의 값이다.
- 두 값이 다른 이유는 테스트 트리가 달라서지, 집계 규칙이 다른 게 아니다.

S2 L381 의 "2/4=50%" 와 my-study 참가자 숫자(2/3·2/4·2/4·0/4)는 실제 데이터로 재현할 수 없다. "회차 범위 규칙을 추가할지" 아니면 "회귀값을 2/6·2/5·2/7·0/7 로 바꿀지" 를 정하는 결정이 필요하다(A4). P03 L94 는 2/5·2/7·2/6·0/7 을 적으면서 목업과의 차이를 언급하지 않는다.

---

## F. Review Focus 1–5(개요 P00 L78-86) 고정 여부

| RF | 내용 | 소유 테스트(계획·이름) | 판정 |
|---|---|---|---|
| 1 | 정원 race 5/6 | P02 L2724 `db: capacity race: 5/6 room, two concurrent joins → exactly one ROOM_FULL, member_count 6` | ✓ 고정. 단 `SUPABASE_URL` 이 없으면 ignore되고, 위 B8 의 숫자 표기가 엇갈림 |
| 2 | 자정 경계 지각 | P01 L976 `kst_deadline: next day 00:00 KST = 15:00Z of end_date (Review Focus 4)`, L993 `task_code` late 사례 | △ 함수 수준만. `submission_upsert` 수준(개요가 지정한 Phase 4)은 범위 밖 |
| 3 | 이탈자 분모(제출자 도윤) 5/8 · 그룹장 조회 · 재참가 거부 | P03 L448 `seed §3: aws 24% — 회차 5/8…`(시드상 도윤이 이미 INACTIVE), L490 `…도윤은 released 행만`, P02 L1912 `MEMBER_NOT_ACTIVE` | △ **"제출자를 이탈시켰을 때" 전환 사례가 없다.** P03 L512-523 은 IAM 미제출자인 하나를 이탈시켜 3/3 을 확인할 뿐이다. 제출자(예: 철수)를 INACTIVE 로 만들면 IAM 이 2/3 이 되고 제출물은 남는지 Phase 3 에서 박아야 함. 그룹장 조회는 plan 04 |
| 4 | 제출물 있는 리프 구조 변경 4종 + 보관 허용 | P03 L1044 `node_create(하위)…`(NODE_HAS_SUBMISSIONS), L1325 `node_update(taskType)…`(지정→공통), L1082 `node_delete…`, L1348 `node_update(assigneeIds)…`(ASSIGNEE_HAS_SUBMISSION), L1102 `node_archive/unarchive…`, 추가로 move L1648 | ✓ 완전 |
| 5 | cron 이틀 누락·재실행·dedupe | P02 L720 `room_tick: … (이틀 누락 포함) … 재실행은 0건 …` | △ tick 쪽은 고정. 알림 dedupe 는 자리표가 0 을 돌려줘서 검증되지 않음 → plan 04 에서 같은 사례로 건수를 단언해야 함 |

---

## 등급별 모음

- **Blocker(4):** D1 내부 함수 PUBLIC EXECUTE 노출 · D2 RLS 정책 테스트 범위 오류 · D3 민수 aws 진척 단언 오류 · B1 P03 시드가 P02 사례 3개를 깨뜨리는데 수정 담당이 없음
- **Should-fix(13):** A1 A2 A3 A4 A5 A6 · B2 B3 B4 · C1 · D4 D5 D6
- **Nit:** 나머지(A7–A13, B5–B12, C2–C7, D7–D14)

## 요약 (10줄)

1. 구조는 탄탄하다. 00–03 범위의 스펙 함수·DTO·불변식 I1–I11 은 대부분 구현과 테스트가 함께 있다.
2. 가장 큰 위험은 보안이다. `revoke … from anon, authenticated` 만으로는 PUBLIC EXECUTE 가 남아, uid 를 인자로 받는 내부 JSON 빌더가 anon 에게 열린다(D1).
3. 그대로 실행하면 실패하는 테스트가 3곳 있다: RLS 정책 전역 조회(D2), 민수 aws 진척 단언(D3), P03 시드 뒤 P02 의 `seedAwsTree`·빈 트리 가정 사례들(B1).
4. "철수 aws 2/4" 는 3회차짜리 테스트 트리에서만 성립한다. 전체 시드에서는 목록·통계 모두 2/6 이다. 목업은 1~3주차만 세었으므로 회귀값을 다시 정해야 한다(A4·E).
5. aws 24%·회차 5/8·1/3·0/4·0/4·0/6, spring 34%, algo 87%, sqld null 은 목업과 한 글자씩 대조해 모두 맞았다.
6. `nextDue` 는 D14 의 "OPEN 만" 과 달리 시작 전 과제까지 포함하고, 테스트가 그걸 단언한다. `me_studies` 와도 규칙이 갈린다(A2).
7. 읽기 함수를 전부 SECURITY DEFINER 로 바꾼 설계 변경이 D7 에 반영되지 않았다(A3). 본인 제외 알림 책임도 정해지지 않았다(A5).
8. 플랜 간 서술이 어긋난 곳: `room_transition_*` 파일(0004 vs 0005), `room_progress` 계층 설명, `expectFail` 이름 충돌, seed 섹션 번호, P01 태스크 번호.
9. TBD 같은 자리표는 없다. 다만 P02 Task 2 의 기대 통과 수가 틀렸고(C1), 생략부호 대안 코드·조건부 지시가 몇 개 있다.
10. Review Focus 는 1·4 가 완전히 고정, 2·3·5 는 부분 고정이다. 특히 RF3 은 "제출자 이탈" 전환 사례를 Phase 3 에 추가해야 한다.
