# 방 상세 — 둘러보기 (RoomView, `/rooms/[id]`) — 백엔드 요구 분석

> 근거: `docs/claude-design-prompt.md` §2.1·§2.4·§2.5·§3·§4.4·§4.5·§4.12·§5, `docs/specs/roomview.md`, `src/data/room-view.ts`, `src/components/room-view/*.tsx`, `src/lib/{types,routes,date}.ts`
> 목업 기준일 `TODAY = 2026-10-12`, 로그인 사용자 `ME = 철수`

이 화면은 **"방 둘러보기"에서 카드를 눌러 들어오는 공개 방의 개요 탭 + 참가 패널**이다. 참가자 시점의 과제 제출(RoomDetail)과 달리 **읽기 + 참가 상태 전이**가 전부다. 좌측은 전체 방 목록(마스터), 우측은 선택 방(디테일)이며 URL은 `/rooms/{id}`.

---

## 1. 화면이 읽는 데이터 (Read model)

### 1.1 좌측 사이드바 (방 목록, `RoomSidebar`)

| 필드 | 타입 | 어디서 오는가 | 비고(목업 값) |
|---|---|---|---|
| total | number | `count(room where visibility=PUBLIC)` — 필터·검색과 무관한 전체 수 | 8 |
| groups[].key / label | `recruit\|active\|ended` | `room.status` 로 그룹핑, 순서 모집중→진행중→종료 | — |
| room.id | string | `room.id` (slug 또는 숫자 id) | `toeic` |
| room.title | string | `room.title` | — |
| room.when | string | **계산** §3.2 (`D-21`, `종료`) | — |
| room.tags[0], 나머지 수 | tag[] | `room_tag` ⨝ `tag` (순서 유지) | `영어`, `+1` |
| room.period | string | `start_date`, `end_date` 포맷 (요일 제거) | `2026.11.02 – 12.27` |
| capCur / capMax | number | `count(membership status=ACTIVE)` / `room.max_members` | `2/8명` |
| mark | enum | **계산** §3.5: 내 membership 상태 → `참가함/승인 대기/참가중/내 방/없음` | sqld=승인 대기 |
| 검색 | — | 프론트 로컬 필터(제목+태그 label 포함 여부). 8개면 클라이언트 필터로 충분하나 공개 방이 늘면 서버 검색 필요 | — |

### 1.2 우측 상단 정보 (`RoomInfo` dl)

| 필드 | 타입 | 어디서 오는가 | 비고 |
|---|---|---|---|
| title, intro | string | `room.title`, `room.intro` | — |
| period | string | `start_date ~ end_date` (요일 포함 포맷) | `2026.10.01(목) – 12.31(목)` |
| dday | string | **계산** §3.2 | `D-80` |
| status | `recruit\|active\|ended` | `room.status` (스케줄러가 전이) | — |
| approval | boolean | `room.join_mode = APPROVAL` | 승인제/바로 참가 |
| 공개 범위 | string | `room.visibility` — 화면은 "공개" 고정 | 비공개 방은 이 화면에 못 들어옴(§7) |
| leader | string | `room.owner_id` → `user.nickname` | 아바타 이니셜은 nickname 첫 글자 |
| tags[] | `{label, tone, auto}` | `room_tag.auto` (AI 자동 여부), `tag.label`, tone은 tag 사전 고정 색 | `✦` 자동 표식 |
| about | markdown | `room.description_md` | 현재 plain text 렌더, 추후 md |
| rules[] | markdown | `room.rules_md` — 목업은 문자열 배열(2개) | md 불릿 1개 = 배열 1개로 변환하거나 md 통째로 |

### 1.3 현재 회차 카드 (`CurrentRoundCard`)

| 필드 | 타입 | 어디서 오는가 | 비고 |
|---|---|---|---|
| pill | string | **계산** §3.3: `시작 전` / `{N}주차 · 진행중` / `종료` | 회차 label은 노드 title에서 |
| title | string | 모집중: `"{start_date M월 D일(요일)} 첫 회차가 열려요"` / 진행중: 현재 회차 title / 종료: `"13주 완주 · 전체 달성률 87%"` | 문구 조립은 프론트 권장(§6) |
| meta | string | 모집중: `"{회차 수}회차 · 과제 {leaf 수}개 준비됨"` / 진행중: `"{회차 기간} · 마감 D-{n}"` / 종료: `"{기간} · 제출 {제출}/{담당}건"` | — |
| tasks[] | task[] | 현재 회차 하위의 **leaf 노드** 전부 (진행중일 때만) | aws 2주차 2개 |
| task.title, type | string, `공통\|지정` | `goal_node.title`, `goal_node.task_type` | — |
| task.dates | string | `goal_node.start_date ~ due_date` | `10.08 – 10.14` |
| task.people[] | `{name, status}` | `task_assignment` ⨝ `user` + **계산** §3.4 사람별 상태 | 담당자 순서 = assignment 생성 순 |

### 1.4 전체 일정 (`ScheduleList`)

| 필드 | 타입 | 어디서 오는가 | 비고 |
|---|---|---|---|
| rounds[] | round[] | 2단계 노드(회차) 목록, 정렬 `sort_order`. 화면은 **3개 창**만 표시 §3.6 | — |
| label | string | 회차 노드 `label` 또는 순번 기반 `"{n}주차"` | algo는 `1–4주차`처럼 묶음(§7) |
| title, dates | string | 노드 title, 기간 | — |
| state | string | **계산** §3.3: `예정 / 진행중 / 기간 종료 / 완료` 또는 시작 전이면 `"과제 N개"` | — |
| sub / total | number | **계산** §3.1 회차 집계 (제출 수 / 담당 건수). 시작 전 회차는 `undefined` | aws 1주차 5/8 |
| current | boolean | 회차 기간 ∋ TODAY | — |
| moreRounds | string | **계산** §3.6 | `이후 10개 회차가 더 있어요` |

### 1.5 참가 카드 (`JoinCard`)

| 필드 | 타입 | 어디서 오는가 | 비고 |
|---|---|---|---|
| status, ddayLong | — | §1.2 + **계산** §3.2 (`시작까지 D-21` / `종료까지 D-80` / `09.30 종료`) | — |
| capCur / capMax | number | `count(membership ACTIVE)` / `max_members` | 승인 대기는 **미포함** |
| minNeed | number | `room.min_members` (nullable → 0이면 문구 숨김, §7) | — |
| minOk, full | boolean | **계산** `capCur >= minNeed`, `capCur >= capMax` | — |
| members[] | `{name, leader, me}` | `membership status=ACTIVE` ⨝ user, 정렬 `joined_at`(모집중 힌트 "참가 확정 순") | 그룹장 포함 |
| members[].pending | boolean | **내 membership 만** `PENDING` 이면 내 행을 회색으로 추가 | 타인의 대기자는 이 화면에서 **안 보임** |
| act | Action | **계산** §3.5 CTA 상태 머신 | — |

### 1.6 한눈에 보기 (`GlanceCard`)

| 필드 | 어디서 오는가 | 목업 값 → 계산 |
|---|---|---|
| glance.rounds | `회차 수` + 시작 요일 규칙성 + 상태 | `8회차 · 매주 월요일 시작` (모든 회차 start_date 요일이 같으면 "매주 X요일 시작", cs처럼 2패턴이면 "월·목 시작", 종료면 "13회차 · 완료") |
| glance.tasks | leaf 수 + 유형 분포 | `16개 · 모두 공통 과제` / `9개 · 공통 7 · 지정 2` / 진행중 `진행 중 · 공통·지정 혼합` / 종료 `78건 중 68건 제출` |
| 제출 방식 | 상수 | `마크다운 · 링크 · 파일` 고정 |

---

## 2. 사용자 액션 → 백엔드 연산 (Write model)

### 2.0 참가 상태 머신 (단일 출처)

`membership.status` ∈ `{ACTIVE, PENDING, REJECTED, CANCELED, EXPIRED, LEFT, INACTIVE(이탈)}` + `role ∈ {OWNER, MEMBER}`.
화면의 `Action` 은 `(room.status, room.join_mode, capCur vs max, 내 membership)` 의 순수 함수다.

```
결정 순서 (위에서 처음 맞는 것):
 1. 비로그인                                   → login       ("로그인하고 참가")  ※ 현 시안엔 없음, §4.4
 2. 내가 owner                                 → owner
 3. 내 membership = ACTIVE
      room.status = recruit                    → leave  ("참가 완료 · 참가 취소")
      room.status = active|ended               → joined ("참가중 · 내 스터디에서 보기")
 4. 내 membership = PENDING (recruit 에서만 존재) → pending ("승인 대기중 · 신청 취소")
 5. room.status = ended                        → ended
 6. room.status = active                       → activeClosed
 7. recruit && capCur >= max                   → full
 8. recruit && join_mode = APPROVAL            → apply
 9. recruit && join_mode = DIRECT              → join
```

전이 표:

| from → to | 트리거 | 백엔드 연산 | 알림 (§2.5) |
|---|---|---|---|
| none → ACTIVE | `참가하기` | `POST /rooms/{id}/join` | 그룹장에게 "참가" (선택) |
| none → PENDING | `참가 신청` | `POST /rooms/{id}/applications` | 그룹장: **참가 신청** |
| ACTIVE → CANCELED | `참가 취소` | `DELETE /rooms/{id}/membership` | 없음 (그룹장 선택) |
| PENDING → CANCELED | `신청 취소` | `DELETE /rooms/{id}/applications/me` | 없음 |
| PENDING → ACTIVE | 그룹장 `승인` (RoomDetail/설정 탭) | `POST /rooms/{id}/applications/{uid}/approve` | 신청자: **참가 승인** |
| PENDING → REJECTED | 그룹장 `거절` | `POST .../reject` | 신청자: **참가 거절** |
| PENDING → EXPIRED | 시작일 00:00 KST 배치 | 스케줄러 (방 recruit→active 전이와 같은 트랜잭션) | 신청자: 만료 안내(선택) |
| ACTIVE → INACTIVE | 그룹장 이탈 처리 (설정 탭) | 다른 화면. 이 화면엔 **이탈자 노출 안 함**(§7) | — |
| REJECTED/CANCELED/EXPIRED → PENDING/ACTIVE | 재신청 | 새 row 또는 status 되돌림 — **재신청 허용** 권장(횟수 제한 없음) | — |

### 2.1 참가하기 (바로 참가)

| 항목 | 내용 |
|---|---|
| 트리거 UI | `JoinCard` `참가하기` 버튼 (act=join) |
| 선행 조건 | 로그인 · `room.status=recruit` · `join_mode=DIRECT` · `visibility=PUBLIC` 또는 유효 초대 token 보유 · 내가 owner 아님 · 내 membership ∉ {ACTIVE, PENDING} |
| 입력 | `roomId` (+ 선택 `inviteToken`) |
| 검증 | `count(ACTIVE) < max_members` — **반드시 잠금 하에서** 재검증 |
| 상태 변화 | `membership(ACTIVE, role=MEMBER, joined_at=now)` insert. 응답으로 새 `capCur`, `act=leave`, members 갱신분 |
| 동시성 | 정원 race: 두 요청이 동시에 `5/6` 을 읽고 둘 다 insert → 7/6. 대응 중 하나: (a) `SELECT ... FOR UPDATE` on `room` row 후 count → insert, (b) `room.member_count` 컬럼을 `UPDATE room SET member_count = member_count+1 WHERE id=? AND member_count < max_members` 로 원자 증가 후 affected=0 이면 `ROOM_FULL`. **(b) 권장** — 카드 그리드 `3/6` 집계에도 재사용. `UNIQUE(room_id, user_id)` 로 중복 참가 차단 |
| 실패 케이스 | `401 UNAUTHENTICATED` · `403 ROOM_PRIVATE`(token 없음) · `409 ROOM_NOT_RECRUITING` · `409 ROOM_FULL` · `409 ALREADY_MEMBER` · `409 ALREADY_PENDING` · `400 JOIN_MODE_APPROVAL`(승인제 방에 join 호출) · `409 OWNER_CANNOT_JOIN` |
| 토스트 | "참가했어요" / 실패 "정원 마감" (§5) |

### 2.2 참가 신청 (승인제)

| 항목 | 내용 |
|---|---|
| 트리거 UI | `참가 신청` (act=apply) |
| 선행 조건 | 2.1 과 동일하되 `join_mode=APPROVAL` |
| 검증 | 정원은 **신청 시점에 검사하지 않음**(대기자는 정원 미포함, §2.1). 단 이미 `capCur>=max` 면 화면은 `full` 이라 버튼이 없음 → 서버도 `ROOM_FULL` 로 거절(일관성) |
| 상태 변화 | `membership(PENDING, applied_at=now)` insert. 응답 `act=pending`, members 에 내 행(pending) 추가, capCur 불변 |
| 부수효과 | 알림 → 그룹장 `APPLICATION_RECEIVED` |
| 실패 | `409 ALREADY_PENDING` · `409 ALREADY_MEMBER` · `409 ROOM_NOT_RECRUITING` · `400 JOIN_MODE_DIRECT` |

### 2.3 참가 취소 (모집중 참가자)

| 항목 | 내용 |
|---|---|
| 트리거 UI | `참가 취소` 보조 버튼 (act=leave). 시안은 확인 모달 없음, 디자인 프롬프트 §5는 확인 다이얼로그 요구 → **프론트에서 confirm 추가 권장** |
| 선행 조건 | `room.status=recruit` · 내 membership=ACTIVE · role≠OWNER |
| 상태 변화 | status→`CANCELED` (soft; 재참가 시 재활용) 또는 delete. `member_count-1`. 지정 과제 담당으로 들어가 있었다면 `task_assignment` 삭제 → 담당자 0명 과제는 "담당자 미정" 경고로 노출(§2.2) |
| 실패 | `409 ROOM_NOT_RECRUITING`("모집 기간에만 참가를 취소할 수 있어요") · `403 OWNER_CANNOT_LEAVE` · `404 NOT_MEMBER` |

### 2.4 신청 취소 (승인 대기자)

| 항목 | 내용 |
|---|---|
| 트리거 UI | `신청 취소` (act=pending) |
| 선행 조건 | 내 membership=PENDING |
| 상태 변화 | → `CANCELED`. 그룹장 대기 목록에서 제거 |
| 실패 | `404 NO_PENDING_APPLICATION` · `409 ALREADY_DECIDED`(그 사이 승인/거절됨 → 화면 새로고침 유도) |

### 2.5 그룹장 승인 / 거절 (이 화면 CTA 는 아니나 상태 머신 완결용)

| 항목 | 내용 |
|---|---|
| 선행 조건 | 요청자 = owner · 대상 membership=PENDING · `room.status=recruit` |
| 승인 검증 | `member_count < max_members` — 2.1 과 같은 원자 증가. 정원 차면 승인 버튼 비활성(§4.4) + 서버 `ROOM_FULL` |
| 상태 변화 | PENDING→ACTIVE(`joined_at=now`, "참가 확정 순" 정렬 기준) / PENDING→REJECTED(`decided_at`, `decided_by`) |
| 알림 | 신청자에게 `APPLICATION_APPROVED` / `APPLICATION_REJECTED` (기본 알림, 끄기 불가 §4.11) |
| 실패 | `403 NOT_OWNER` · `409 ROOM_FULL` · `409 ALREADY_DECIDED` · `409 ROOM_NOT_RECRUITING` |

### 2.6 대기 자동 만료 + 방 상태 자동 전이 (스케줄러)

| 항목 | 내용 |
|---|---|
| 트리거 | 매일 00:00 KST (또는 분 단위 폴링, `Asia/Seoul` 고정) |
| recruit→active | `start_date <= today(KST)` 인 recruit 방. 같은 트랜잭션에서 `PENDING → EXPIRED`. 그룹장 "지금 시작"도 같은 서비스 메서드 호출 |
| active→ended | `end_date < today(KST)` (종료일 **다음날**) |
| 멱등성 | `WHERE status='RECRUIT' AND start_date <= :today` 조건부 UPDATE. 다중 인스턴스면 ShedLock 등 |
| 알림 | 스터디 시작/종료, 회차 시작(해당 날 start_date 인 2단계 노드) |
| 최소 인원 미달 | §2.1 에 규칙 없음. **제안**: 자동 시작은 그대로 하되 그룹장에게 "최소 인원 미달" 알림만(§7) |

### 2.7 초대 링크 복사 (owner) / 공유

| 항목 | 내용 |
|---|---|
| 트리거 UI | `초대 링크 복사`(act=owner), 상단 `공유` 버튼(핸들러 없음) |
| 백엔드 | `GET /rooms/{id}/invite` → `{ url: "/invite/{token}" }`. token 없으면 생성. owner 만 |
| token 설계 | `room_invite(token UNIQUE 22~32자 base64url, room_id, created_by, expires_at nullable, revoked_at nullable, use_count)`. 공개 방은 공유 URL `/rooms/{id}` 로 충분하므로 token 은 **비공개 방 진입 권한** 용도. 재발급 시 기존 revoke |
| 진입 (§4.12) | `GET /invite/{token}` → 방 미리보기(제목·소개·기간·인원·그룹장) + `act`. 비로그인이면 `/login?next=/invite/{token}` 복귀. `POST /rooms/{id}/join {inviteToken}` 에서 token 유효성이 `ROOM_PRIVATE` 를 우회 |
| 실패 | `404 INVITE_NOT_FOUND` · `410 INVITE_EXPIRED/REVOKED` |

### 2.8 그 밖의 UI (백엔드 영향 없음)

- 탭 5개: 정적. 커리큘럼/보드/캘린더/간트는 다른 화면 분석에서.
- 알림 버튼 배지 `3`: 공용 `GET /me/notifications/unread-count`.
- `참가중 · 내 스터디에서 보기`, `내가 만든 방 · 관리하기`: 라우팅만.

---

## 3. 파생 값 계산 규칙

### 3.1 제출 집계 (회차 sub/total, 과제 `k/n 제출`, 전체 달성률)

```
담당 건수(total) = Σ_leaf |assignees(leaf)|
  공통 과제 assignees = 방의 ACTIVE 참가자 전원 (+ owner, room.owner_does_tasks=true 일 때)
                        — 이탈(INACTIVE)·대기·취소자는 제외
  지정 과제 assignees = task_assignment rows
제출 수(sub)         = Σ_leaf |{a ∈ assignees : submission(a, leaf) exists}|   ← done + late 모두 포함
진척률(%)            = round(sub / total × 100)
```

목업 검증:

| 방 · 범위 | 계산 | 결과 |
|---|---|---|
| aws 1주차 (IAM·VPC) | IAM 정책 이해: 민수🟢 지은🟡 철수🟢 하나🔴 → 3/4 · VPC 실습: 민수🟢 지은⚪ 철수🟢 하나⚪ → 2/4 | **5/8** ✓ (도윤 이탈 제외라 4명) |
| aws 2주차 (현재) | EC2(지정 지은·철수): done+open → 1/2 · S3(지정 하나): open → 0/1 | **1/3** ✓ |
| aws 3주차 | "로드밸런서 비교"는 자식이 있어 leaf 아님. leaf = "ALB vs NLB 실습"(공통) → 4명 | **0/4** ✓ |
| react 4주차 | 공통 2개 × 5명 = 10, done 3 | **3/10** ✓ |
| algo 전체 | 23+21+24 = 68 / 24+24+30 = 78 (6명 × 13주) | **87%** = round(68/78×100) ✓ |
| 과제 바 색 | pct ≥ 80 → 진한 초록, 아니면 민트 (프론트) | algo 1–4주차 96% |

**공통 과제의 담당자 스냅샷 문제**: 참가자가 모집 중 취소/진행 중 이탈하면 분모가 바뀐다. 공통 과제도 방 시작(recruit→active) 시점에 `task_assignment` 로 **실체화(materialize)** 하고, 이탈 처리 시 미제출 건만 삭제하는 것을 권장. 그러면 공통/지정 모두 같은 쿼리로 집계된다.

### 3.2 D-day·기간 표기 (KST 날짜 기준, `src/lib/date.ts` 와 동일 산식)

```
n = diffDays(today, target)         // 달력 일수, 시간 무시
dday(n): n=0 → "D-DAY", n>0 → "D-n", n<0 → "D+n"
```

| 상태 | `dday`/`when` (칩) | `ddayLong` (참가 카드) | target |
|---|---|---|---|
| recruit | `D-21` | `시작까지 D-21` | start_date |
| active | `D-80` | `종료까지 D-80` | end_date |
| ended | `종료` | `09.30 종료` | end_date 를 `MM.DD` 로 |

검증(TODAY 10-12): toeic 11-02 → 19+2 = **21** ✓ · aws 12-31 → 19+30+31 = **80** ✓ · react 11-15 → **34** ✓ · docker 11-09 → **28** ✓.
현재 회차 meta `마감 D-2` = diff(10-12, 회차 end 10-14) ✓, react `마감 D-6` = 10-18 ✓.
D-day 칩 색은 recruit=blue, 그 밖=mint (프론트).

**백엔드는 날짜만 내려주고 D-day 문자열은 프론트가 계산**하는 것을 권장. 서버 캐시가 자정을 넘기면 틀어지기 때문. 단 `status` 는 서버 진실(스케줄러 전이 결과).

### 3.3 회차(2단계 노드) 상태 · 현재 회차

```
current  = round.start_date <= today <= round.end_date        (여러 개면 start 가장 늦은 것; 겹침은 §7)
state    = room.ended                      → "완료"
         | today < start                   → "예정"   (시안: 시작 전엔 sub/total 없이 "과제 N개")
         | current                         → "진행중"
         | today > end                     → "기간 종료"
pill     = room.recruit → "시작 전" | room.active → "{label} · 진행중" | room.ended → "종료"
```

진행중인데 오늘이 어느 회차에도 속하지 않으면(회차 사이 공백) **직전 회차**를 current 로 보여주되 pill 은 `"{label} · 기간 종료"` 제안(§7).

### 3.4 사람별 과제 상태 (`TaskStatus`, §2.4) — 공용 규칙

```
submission 존재:  submitted_at(최초) <= due_date 23:59:59 KST → done, 그 외 → late  (최초 제출 시각 고정)
submission 없음:  today < start_date → planned | start <= today <= due → open | today > due → missed
참가자 INACTIVE(이탈) → 이 화면에서는 담당자 목록에서 제외 (RoomDetail 에선 회색 "이탈")
```

aws 2주차 EC2: 지은 제출 → done, 철수 미제출 & 10-12 ∈ [10-08, 10-14] → open ✓. react "Context로 props 전달 줄이기" 10-15 시작 → 전원 planned → 요약 `"10.15 시작"`, 바 0% ✓.

### 3.5 CTA `act` 와 사이드바 mark

§2.0 결정 순서를 그대로 쓴다. 목업 대응:

| 방 | room.status / join_mode / cap | 내 membership | act | mark |
|---|---|---|---|---|
| toeic | recruit / DIRECT / 2<8 | 없음 | join | — |
| sqld | recruit / APPROVAL / 1<5 | PENDING | pending | 승인 대기 |
| docker | recruit / DIRECT / 0<6 | OWNER | owner | 내 방 |
| jcg | recruit / APPROVAL / 4=4 | 없음 | full | — |
| aws | active / APPROVAL | ACTIVE | joined | 참가중 |
| react | active / DIRECT | 없음 | activeClosed | — |
| algo | ended | ACTIVE | ended (※ 목업). §2.0 규칙 3 대로면 `joined` → "내 스터디에서 보기"가 더 자연스러움(§7) | — |

참가 인원 표기: `capCur` 는 서버 값 그대로 쓰고, 프론트가 낙관적으로 `+1` 하지 않는다(현재 `JoinCard` 는 act=leave 일 때 `+1` 하고 있음 → 실데이터에서는 응답 값으로 교체).

### 3.6 일정 목록의 3개 창 + moreRounds

```
recruit : rounds[0..2],                     more = "이후 {N-3}개 회차가 더 있어요"  (N<=3 이면 "")
active  : [current-1, current, current+1],  prefix = "{1}~{current-2}주차 완료 · " (current-1 > 1 일 때),
                                            more   = "이후 {N - (current+1)}개 회차가 더 있어요"
ended   : 전부 (목업 algo 는 4주 단위로 묶어 3행 — 묶음 규칙 없음, §7)
```

검증: toeic 8회차 → `이후 5개` ✓ · sqld 4 → `이후 1개` ✓ · jcg 2 → `""` ✓ · aws 13, current=2 → 1·2·3 표시, `이후 10개` ✓ · react 8, current=4 → 3·4·5, `1~2주차 완료 · 이후 3개` ✓.
**백엔드는 회차 전체 목록(13개)을 내려주고 창 선택·문구 조립은 프론트**가 한다.

### 3.7 glance 문구

```
rounds: "{N}회차" + (ended ? " · 완료" : 모든 회차 start 요일이 1종 ? " · 매주 {요}요일 시작" : 2종 ? " · {요}·{요} 시작" : "")
tasks : recruit → "{leaf}개 · " + (지정 0 ? "모두 공통 과제" : "공통 {c} · 지정 {d}")
        active  → "진행 중 · 공통·지정 혼합" (목업 상수) → 제안: "{leaf}개 · 공통 {c} · 지정 {d}"
        ended   → "{total}건 중 {sub}건 제출"
```

백엔드는 `roundCount, leafCount, commonCount, assignedCount, startWeekdays[], totalAssignments, totalSubmissions` 숫자만 제공.

---

## 4. 엔티티·관계 후보

| 엔티티 | 주요 필드 | 이 화면 용도 | 공용 |
|---|---|---|---|
| `user` | id, email, nickname, avatar_tone | 그룹장·참가자 표시 | 공용 |
| `room` | id, slug?, title, intro, description_md, rules_md, start_date, end_date, max_members, min_members(null), visibility(PUBLIC/PRIVATE), join_mode(DIRECT/APPROVAL), owner_id, owner_does_tasks, status(RECRUIT/ACTIVE/ENDED/ARCHIVED), **member_count**(정원 원자 증가용), cover_url, created_at | 전부 | 공용 |
| `room_membership` | id, room_id, user_id, role(OWNER/MEMBER), status(ACTIVE/PENDING/REJECTED/CANCELED/EXPIRED/INACTIVE), applied_at, joined_at, decided_at, decided_by, left_at; `UNIQUE(room_id,user_id)` | 참가자 목록, 내 CTA, 승인 흐름 | 공용 |
| `tag` | id, label, tone | 태그 칩 | 공용 |
| `room_tag` | room_id, tag_id, auto(bool), sort_order | `✦` 자동 표식 | 공용 |
| `goal_node` | id, room_id, parent_id(null=방 직속=회차), depth(2~5), sort_order, title, label(“1주차”), description_md, start_date, end_date, is_leaf(계산 가능), task_type(COMMON/ASSIGNED, leaf만), archived | 현재 회차·일정·과제 | 공용(커리큘럼) |
| `task_assignment` | node_id, user_id, assigned_at, `UNIQUE(node_id,user_id)` | 담당자 아바타, 분모 | 공용 |
| `submission` | id, node_id, user_id, first_submitted_at, updated_at, body_md, is_late(계산 or 고정) | 분자, 사람별 상태 | 공용 |
| `room_invite` | token, room_id, created_by, created_at, expires_at, revoked_at | 초대 링크 | 공용(RoomDetail 설정) |
| `notification` | id, user_id, type, room_id, ref_id, read_at, created_at | 참가 신청/승인/거절 | 공용 |

읽기 성능: 방 목록 8개는 문제없지만 `sub/total` 은 leaf×assignee 조인이라 방당 1회 집계 쿼리로 묶는다(`GROUP BY round_id`). 종료 방 통계(`68/78`)는 ENDED 전이 시 `room_stat` 에 고정 저장해도 좋다.

---

## 5. API 후보

| METHOD path | 요청 | 응답 shape | 권한 |
|---|---|---|---|
| `GET /rooms?visibility=public&status=&q=` | 쿼리 | `{ total, items: SidebarRoom[] }` · `SidebarRoom = {id,title,status,startDate,endDate,tags[{label,tone}],memberCount,maxMembers,myState(NONE/PENDING/ACTIVE/OWNER)}` | 비로그인 가능(myState 는 로그인 시만) |
| `GET /rooms/{id}` | — | `RoomViewDto` (§6) | 공개 방: 누구나. 비공개: ACTIVE 멤버·owner, 또는 `?invite=token` |
| `GET /rooms/{id}/rounds` | — | `Round[] {id,label,title,startDate,endDate,leafCount,submitted,total}` (전체) — `/rooms/{id}` 에 인라인해도 됨 | 위와 동일 |
| `POST /rooms/{id}/join` | `{inviteToken?}` | `MembershipResult {myState, memberCount, members[]}` | 로그인 |
| `POST /rooms/{id}/applications` | `{inviteToken?}` | `MembershipResult` | 로그인 |
| `DELETE /rooms/{id}/membership` | — | `MembershipResult` | ACTIVE 멤버, recruit |
| `DELETE /rooms/{id}/applications/me` | — | `MembershipResult` | PENDING 본인 |
| `GET /rooms/{id}/applications` | — | `Applicant[] {userId,nickname,appliedAt}` | owner (사이드 패널 대기 목록, §4.4) |
| `POST /rooms/{id}/applications/{userId}/approve` / `reject` | — | `MembershipResult` | owner |
| `GET /rooms/{id}/invite` · `POST .../invite/rotate` | — | `{url, token, expiresAt}` | owner |
| `GET /invite/{token}` | — | `RoomPreview {id,title,intro,startDate,endDate,memberCount,maxMembers,leader,act}` | 누구나 |
| `GET /me/notifications/unread-count` | — | `{count}` | 로그인 (공용) |

에러 바디: `{ code: "ROOM_FULL", message: "정원이 마감됐어요" }` 로 통일. 코드 목록은 §2.

---

## 6. 목업 ↔ 실데이터 전환 포인트

### 6.1 현재 프론트 시그니처 (`src/data/room-view.ts`)

```ts
export const ROOMS: Record<RoomId, Room>;         // 8개 하드코딩
export const ROOM_GROUPS;                          // 상태별 id 배열(정렬 고정)
export const INITIAL_JOIN: Partial<Record<RoomId, JoinState>>;   // { sqld: 'pending' }
export const actionOf(room, join): Action;         // base + join → act
export const MARK, STATUS_BADGE;
```

`page.tsx` 는 `generateStaticParams` + `isRoomId` 로 정적 생성. 실데이터 전환 시 `dynamic` 라우트 + 서버 fetch 로 바꾸고 `notFound()` 는 404/403 응답에 매핑.

### 6.2 백엔드 DTO (프론트 `Room` 과 1:1 — 문자열 조립 필드는 **원시 값**으로 대체)

```ts
type RoomViewDto = {
  id: string; title: string; intro: string;
  status: "recruit" | "active" | "ended";
  joinMode: "direct" | "approval";            // ← approval:boolean
  visibility: "public" | "private";
  startDate: string; endDate: string;          // ← period / dday / ddayLong / when 은 프론트 계산
  leader: { id: string; nickname: string };
  tags: { label: string; tone: Tone; auto: boolean }[];
  memberCount: number; maxMembers: number; minMembers: number | null;   // ← capCur/capMax/minNeed
  members: { id: string; nickname: string; role: "owner" | "member"; joinedAt: string }[];  // ACTIVE 만, joinedAt 순
  me: { state: "none" | "pending" | "active" | "owner" } | null;        // null = 비로그인 → act 계산 입력
  descriptionMd: string; rulesMd: string;      // ← about / rules[]
  currentRound: {                               // null 가능 (recruit 이면 null 로 두고 프론트가 "첫 회차가 열려요" 조립)
    id: string; label: string; title: string; startDate: string; endDate: string;
    tasks: { id: string; title: string; type: "common" | "assigned"; startDate: string; dueDate: string;
             people: { id: string; nickname: string; status: TaskStatus }[] }[];
  } | null;
  rounds: { id: string; label: string; title: string; startDate: string; endDate: string;
            leafCount: number; submitted: number | null; total: number | null }[];   // 전체, sort_order 순
  stats: { roundCount: number; leafCount: number; commonCount: number; assignedCount: number;
           totalAssignments: number; totalSubmissions: number };                    // glance + ended cur 카드
};
```

프론트 어댑터 `toRoom(dto, today)` 가 기존 `Room` 모양(`period`, `dday`, `cur.pill`, `rounds` 3개 창, `moreRounds`, `glance`)을 만들면 컴포넌트 변경 없이 교체 가능. `base` 필드는 폐기하고 `actionOf(dto)` 를 §2.0 로직으로 재작성.

### 6.3 목업에서만 가능한 것

| 항목 | 현재 | 실데이터 |
|---|---|---|
| `TODAY = "2026-10-12"` | 상수 | 서버 응답 `serverNow`(KST) 또는 클라이언트 시계. 상태 판정은 서버, D-day 는 클라이언트 |
| `ME = 철수` | 상수 | 세션 사용자. `members[].me` 는 `id === me.id` 로 판정(닉네임 비교 금지) |
| `join` useState + `INITIAL_JOIN` | 클라이언트 state | `me.state` 로 초기화, 액션 후 `MembershipResult` 로 갱신. 낙관적 업데이트 시 실패 롤백 |
| `capCur + 1`(JoinCard/Sidebar) | 프론트 가산 | 서버 `memberCount` 그대로 |
| 사이드바 8개 전체 로드 | 정적 | `GET /rooms` 별도 호출, 검색은 로컬 → 50개 넘으면 서버 검색 |
| `rounds` 3개 + `moreRounds` 문자열 | 데이터에 박힘 | 전체 목록에서 프론트가 창 계산 §3.6 |
| 종료 방 `cur.title "13주 완주 · 전체 달성률 87%"` | 문자열 | `stats` 로 조립 |
| 이름별 아바타 색 `COLOR` 맵 | 이름 해시 | `user.avatar_tone` 저장 또는 id 해시 |

---

## 7. 디자인 프롬프트에 있으나 화면에 없는 것 / 불명확한 것

| # | 항목 | 현황 | 제안 기본값 |
|---|---|---|---|
| 1 | **비로그인 상태** (`로그인하고 참가`, 읽기 전용) | 시안은 항상 철수 로그인 | `me=null` 이면 act=`login`, 버튼은 `/login?next=/rooms/{id}` 링크. GET 은 공개 방이면 비로그인 허용 |
| 2 | **비공개 방 접근** / 권한 없음 화면 (§5) | "공개" 고정 | 비공개 방 GET → 멤버·owner·유효 token 외 `403 ROOM_PRIVATE`, 프론트는 "비공개 방이에요" 빈 상태. 사이드바 목록엔 미노출 |
| 3 | **그룹장 전용 승인 대기 목록**(승인/거절, §4.4) | 이 화면엔 없음(owner 는 "관리하기" 링크만) | RoomDetail/설정 탭 담당. API 만 §5 에 포함 |
| 4 | **이탈자 회색 표시** (§4.4 참가자 목록) | members 에 이탈자 없음(aws 도윤 누락) | 둘러보기 화면은 ACTIVE 만. 이탈자는 RoomDetail 에서 |
| 5 | 타인 승인 대기자 노출 | 내 pending 행만 보임 | 비공개 정보로 취급, owner 외 미노출 |
| 6 | **최소 인원 미달 시 시작** 규칙 | 없음 | 자동 시작 유지 + 그룹장 알림. `min_members` null 이면 문구 숨김 |
| 7 | 정원 축소(`max_members` 수정) 후 `capCur > max` | 없음 | 모집중 수정 시 `max >= member_count` 검증 |
| 8 | 승인제 + 정원 마감 상태에서 신청 | jcg 는 `full` 로 버튼 비활성 | 서버도 `ROOM_FULL` 거절(대기열 없음) |
| 9 | 종료 방 + 내가 멤버 (algo) | 목업은 `ended`(비활성 버튼) | 규칙 3 대로 `joined` 링크 노출 권장 — 프론트 결정 사항 |
| 10 | 회차 사이 공백·겹침, current 판정 | 없음 | 겹치면 start 가 늦은 것, 공백이면 직전 회차 + "기간 종료" pill |
| 11 | 회차 label(`1주차`/`1회차`/`1–4주차`) | 문자열 | `goal_node.label` 자유 입력, 기본값 `"{n}주차"`. algo 식 묶음은 지원 안 함(회차 13개 그대로) |
| 12 | 공통 과제 담당자 확정 시점 | 없음 | 방 시작 시 `task_assignment` 실체화 (§3.1) |
| 13 | 재신청/재참가 허용 여부 (거절·취소·만료 후) | 없음 | 허용, 같은 row status 되돌림. 거절 후 재신청은 그룹장에게 다시 알림 |
| 14 | `참가 취소` 확인 다이얼로그 (§5) | 시안 모달 없음 | 프론트 confirm 추가 |
| 15 | 공유 버튼 | 핸들러 없음 | 공개 방 URL 복사(백엔드 불필요) |
| 16 | 태그 tone | 고정 팔레트 6색 | `tag.tone` 사전 테이블에 저장 |
| 17 | 운영규칙 형식 | 문자열 배열 2개 | `rules_md` 하나, 프론트가 md 렌더(불릿은 md `-`) |
| 18 | 시간대 | `date.ts` 는 UTC 계산 | 서버·DB `DATE` 컬럼 + 판정은 `Asia/Seoul`. 프론트도 KST 고정으로 통일 |
