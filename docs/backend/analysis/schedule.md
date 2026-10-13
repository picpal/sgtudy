# 내 일정 (MySchedule, `/schedule`) — 백엔드 요구 분석

> 대상 화면: `src/components/schedule/*`, 목 데이터 `src/data/schedule.ts`, 스펙 `docs/specs/myschedule.md`.
> 이 화면은 **쓰기 액션이 없는 순수 읽기 화면**이다. 핵심은 "내가 속한 모든 방"을 가로지르는 단일 집계 쿼리와, 과제마다 **나(ME) 기준 상태**를 계산하는 규칙이다.

## 1. 화면이 읽는 데이터 (Read model)

### 1-1. 스터디(방) 목록 — `Study`

| 필드 | 타입 | 어디서 오는가 | 비고(목업 값 예) |
|---|---|---|---|
| `id` | string | `room.slug` (라우트 `/rooms/[slug]`, `/my-study/[slug]` 에 그대로 쓰임) | `"aws"`, `"spring"`, `"sqld"` |
| `name` | string | `room.title` + (승인 대기면 `" · 승인 대기"` 접미) — **서버는 title 과 membership 만 주고 접미는 프론트가 붙인다** | `"SQLD · 승인 대기"`. 목업의 `"AWS SAA"` 는 실제 방 제목 `"AWS SAA 자격증 3개월 완주"` 의 축약 → §7 |
| `pending` | boolean | `room_member.status = PENDING` | sqld 만 true. 막대 줄무늬·이동 경로 분기에 사용 |
| `bg` / `fg` / `dot` | color | **클라이언트 팔레트**. 서버는 `tone`(팔레트 키) 또는 아무것도 주지 않고 프론트가 방 순서로 할당 | `src/lib/palette.ts` 의 `Tone` 재사용 |
| (추가 제안) `membership` | `"leader" \| "joined" \| "pending"` | `room_member.role` + `status` | 이동 경로와 접미 문구의 단일 출처 |
| (추가 제안) `startDate` / `endDate` / `status` | date / `RoomStatus` | `room` | 지금 화면엔 안 그리지만 "스터디 시작/종료" 표시의 재료 (§7) |

### 1-2. 과제 — `Task` (막대·목록·날짜 상세·다가오는 마감의 공통 단위)

| 필드 | 타입 | 어디서 오는가 | 비고 |
|---|---|---|---|
| `id` | number | `task.id` | 목업은 배열 인덱스. 실데이터는 PK. 지금은 링크에 안 쓰이지만 IA 의 `/rooms/[slug]/tasks/[id]` 를 위해 반환 |
| `study` | string | `room.slug` | `Study.id` 와 조인 키 |
| `title` | string | `task.title` (말단 노드 제목) | |
| `s` | `YYYY-MM-DD` | `task.start_date` | KST 달력일 |
| `e` | `YYYY-MM-DD` | `task.due_date` | 마감 시각은 항상 **그 날 23:59 KST** (UpcomingPanel 이 "23:59" 를 하드코딩) |
| `st` | `TaskStatus` | **계산** — §3-1. 나(ME)의 배정·제출 기준 | `missed` 는 목업에 없으나 실데이터에서는 반드시 발생 |
| `round` | string | 말단의 **2단계 조상 노드(회차)** 의 라벨 | `"2주차"`. 부제·툴팁·마커 축약(`"2주"`)에 사용 |

### 1-3. 회차 시작 마커 — `Marker`

| 필드 | 타입 | 어디서 오는가 | 비고 |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | 2단계 노드 `curriculum_node.start_date` | |
| `study` | string | `room.slug` | 승인 대기 방(sqld)의 회차도 포함 — DayPanel 이 "승인되면 참여할 수 있어요" 문구로 분기 |
| `round` | string | 2단계 노드 라벨 | `"1주차"` |

### 1-4. 전역 컨텍스트

| 항목 | 현재 | 실데이터 |
|---|---|---|
| `TODAY` | `src/lib/routes.ts` 상수 `"2026-10-12"` | 서버 응답 `today` (KST 기준 날짜). D-day·past 색·"오늘" 배지·다가오는 마감 창의 기준 |
| `ME` | 상수 철수 | 인증 주체. 모든 상태는 "이 사용자의" 상태 |

## 2. 사용자 액션 → 백엔드 연산 (Write model)

**이 화면에는 서버 상태를 바꾸는 액션이 없다.** 모든 인터랙션은 클라이언트 상태(`y, m, sel, view, off`)만 바꾼다.

| 트리거 UI | 선행 조건 | 서버 연산 | 비고 |
|---|---|---|---|
| ‹ › 이전/다음 달 | 로그인 | **재조회** `GET /me/schedule?from&to` (창이 바뀜) | `sel` 은 유지되므로 `sel` 이 새 창 밖이면 DayPanel 은 비어 보임 → 요청 창을 `sel` 까지 넓히거나(§5) 그대로 둠 |
| 오늘 | 로그인 | 오늘이 속한 달로 재조회 (이미 그 달이면 없음) | |
| 스터디 필터 칩 토글 | — | 없음 (클라 필터) | 영구 저장은 범위 밖. 원하면 `user_pref` 로 분리 |
| 월간/목록 탭 | — | 없음 | 같은 데이터의 다른 투영 |
| 날짜 셀 클릭 | — | 없음 | `sel` 변경 |
| 막대 / 날짜 상세 항목 클릭 | — | 없음 (라우팅) | `pending` → `/rooms/[slug]`, 그 외 → `/my-study/[slug]` |
| 목록 행 / 다가오는 마감 항목 | — | 없음 | 정적 요소 |

실패 케이스는 조회 하나뿐: 미인증 `401 UNAUTHENTICATED`, 잘못된 창 `400 SCHEDULE_RANGE_INVALID` (§5).

## 3. 파생 값 계산 규칙

### 3-1. 나(ME) 기준 과제 상태 `st` — **서버 계산**

입력: `task.start_date(s)`, `task.due_date(e)`, `today`(KST), 내 제출 `submission.first_submitted_at`(nullable), 내 배정 여부.

```
deadlineAt = e 23:59:59.999 KST
if submission 있음:
    first_submitted_at <= deadlineAt ? done : late      -- 최초 제출 시점 기준 고정 (§2.3)
else:
    today <  s        → planned
    s <= today <= e   → open
    today >  e        → missed
```

목업 검증 (today = 2026-10-12):

| 과제 | s–e | 기대 | 규칙 |
|---|---|---|---|
| aws EC2 인스턴스 유형 정리 | 10/08–10/14 | `open` | 미제출, s ≤ today ≤ e |
| spring 스프링 컨테이너 실습 | 10/08–10/11 | `late` | 제출 있음, first_submitted_at > 10/11 23:59:59 KST |
| spring 섹션 1~5 정리 노트 | 10/05–10/11 | `done` | 제출 있음, 기한 내 |
| spring 싱글톤 컨테이너 실습 코드 | 10/15–10/18 | `planned` | today < s |
| (목업에 없음) 10/07 마감 미제출 | — | `missed` | today > e, 제출 없음 |

승인 대기 방: 신청자는 배정이 없고, 대기 상태는 모집중(시작 전)에만 존재하므로(§2.1 "시작일에 미처리 대기는 자동 만료") 항상 `planned` 가 나온다. 별도 분기 불필요.

### 3-2. 창(window) 포함 규칙 — 서버

- 과제: `s <= to AND e >= from` (기간이 창과 **겹치면** 포함. 막대가 주 경계를 넘어 그려지므로 `e` 만 보면 안 된다)
- 마커: `from <= start_date <= to`
- 방: 사용자가 `room_member` 로 묶인 방 중 `status IN (ACTIVE, PENDING)`. 이탈(LEFT)·거절·만료 제외. 종료된 방은 **포함**(지난 달 이력 열람). 보관(archived) 방은 제외
- 과제는 보관(archived) 제외, 말단 노드만

### 3-3. 어떤 과제가 "내 것"인가 — 서버

- 공통 과제: 그 방의 활성 참가자 전원 → 나 포함 (그룹장은 `leader_does_tasks = true` 일 때만)
- 지정 과제: `task_assignment` 에 내가 있을 때
- 승인 대기 방: 배정이 없으므로 **방의 모든 말단 과제**를 보여준다 (목업 sqld 2건이 그렇게 나옴). 미리보기 성격
- 그룹장이면서 `leader_does_tasks = false` → §7 결정 필요

### 3-4. 다가오는 마감 — 서버 또는 클라 (권장: 서버, §5)

```
대상   : st ∈ {open, planned}  AND  today <= e <= today + 7   (양끝 포함)
정렬   : e 오름차순 (동일 e 는 study, title 순으로 안정화)
개수   : 제한 없음 (목업). 실서비스는 20 캡 제안
D-day  : diffDays(today, e)  → 0 "D-DAY", n "D-n";  n <= 2 면 빨강 배지
```

목업 검증: 창 10/12–10/19 → EC2(10/14, D-2 빨강), 섹션 6~7(10/18, D-6), 싱글톤(10/18, D-6, planned 포함). ALB(10/21) 제외. 스펙 §4 와 일치.

### 3-5. 날짜 상세 패널 (sel 기준) — 클라 유지

| 그룹 | 조건 | 배지 |
|---|---|---|
| 회차 시작 | `marker.date == sel` | "시작" |
| 이 날 마감 | `e == sel` | done/late 면 상태 텍스트, 아니면 `마감 D-n` (D+n 포함). `open` 이면 긴급색 |
| 진행 중인 과제 | `s <= sel < e` | 상태 텍스트 |

서버는 `sel` 을 알 필요가 없다. 단 `sel` 이 요청 창 밖이면 결과가 비므로 클라가 창을 넓힌다.

### 3-6. 목록 보기 — 클라 유지

마감일이 표시 달(1일~말일) 안인 과제를 `e` 오름차순, `weekStartOf(e)`(일요일) 로 그룹. `today` 포함 주에 "이번 주". 전부 `calc.ts`/`ListView.tsx` 에 이미 있고 서버 데이터로 그대로 동작한다.

### 3-7. 막대 배치 (`packWeek`) / 격자 (`monthWeeks`) — 클라 유지

주 단위 절단·레인 그리디 배정은 순수 표현 로직. 서버가 관여하면 안 된다.

### 3-8. 이동 경로 규칙

| 항목 | membership | 목적지 |
|---|---|---|
| 막대, 날짜 상세 항목 (회차 시작 포함) | `joined` / `leader` | `/my-study/[slug]` |
| 막대, 날짜 상세 항목 | `pending` | `/rooms/[slug]` |

스펙 §2 표에는 "날짜 상세 항목은 승인 대기도 RoomDetail" 로 적혀 있으나 **구현 코드(`DayPanel.tsx`)는 막대와 같은 pending 분기**를 쓴다. 코드를 기준으로 한다. 서버는 `membership` 만 주면 된다.

## 4. 엔티티·관계 후보

| 엔티티 | 이 화면이 쓰는 필드 | 공용 여부 |
|---|---|---|
| `user` | `id` | 공용 |
| `room` | `id`, `slug`, `title`, `status(RECRUIT/ACTIVE/ENDED/ARCHIVED)`, `start_date`, `end_date`, `leader_does_tasks` | 공용 (방 목록·방 상세·내 스터디) |
| `room_member` | `room_id`, `user_id`, `role(LEADER/MEMBER)`, `status(ACTIVE/PENDING/LEFT/REJECTED/EXPIRED)` | 공용 |
| `curriculum_node` | `id`, `room_id`, `parent_id`, `depth(1~5)`, `label`(회차 라벨 "2주차"), `title`, `start_date`, `end_date`, `sort_order` | 공용 (커리큘럼·간트·내 스터디) |
| `task` (말단 노드 확장) | `id`, `node_id`, `room_id`, **`round_node_id`**(2단계 조상 비정규화), `title`, `type(COMMON/ASSIGNED)`, `start_date`, `due_date`, `archived` | 공용 |
| `task_assignment` | `task_id`, `user_id` | 공용 (지정 과제. 공통 과제는 조인 시 참가자 전원으로 확장하거나 생성 시점에 물질화) |
| `submission` | `task_id`, `user_id`, **`first_submitted_at`**(불변), `updated_at` | 공용 (과제 상세·칸반·간트) |

설계 메모
- `task.round_node_id` 를 비정규화하지 않으면 깊이 2~5 트리를 **재귀 CTE** 로 매 조회마다 올라가야 한다. 이 화면이 매달 호출되므로 비정규화를 권장한다 (커리큘럼 저장 시 갱신).
- `submission.first_submitted_at` 은 지각 판정의 단일 출처이며 수정으로 바뀌면 안 된다.
- 공통 과제 배정을 물질화할지(참가 승인·과제 생성 시 `task_assignment` 삽입) 조인 시 계산할지는 칸반/간트 분석과 함께 결정. 이 화면만 보면 **물질화**가 쿼리를 단순하게 한다 (`a.user_id = :me` 하나로 끝).

## 5. API 후보

### `GET /api/me/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD`

권한: 로그인 사용자 (본인 데이터만). 역할 무관.

요청 규칙
- `from <= to`, `to - from <= 62일` (6주 격자 42일 + 여유). 위반 시 `400 SCHEDULE_RANGE_INVALID`
- 클라는 `monthWeeks(y,m)` 의 첫 날~마지막 날을 보내고, `sel` 이 그 밖이면 `sel` 까지 넓힌다
- 날짜는 KST 달력일. 서버는 `Asia/Seoul` 로 `today` 를 만든다

응답 (`src/data/schedule.ts` 타입과 1:1)

```json
{
  "today": "2026-10-12",
  "studies": [
    { "id": "aws",    "name": "AWS SAA 자격증 3개월 완주", "membership": "joined",  "tone": "mint",
      "status": "active",  "startDate": "2026-10-01", "endDate": "2026-12-31" },
    { "id": "spring", "name": "Spring 김영한 로드맵 완강",  "membership": "joined",  "tone": "violet",
      "status": "active",  "startDate": "2026-10-05", "endDate": "2027-01-31" },
    { "id": "sqld",   "name": "SQLD 4주 벼락치기",         "membership": "pending", "tone": "amber",
      "status": "recruit", "startDate": "2026-10-26", "endDate": "2026-11-22" }
  ],
  "tasks": [
    { "id": 1023, "study": "aws", "title": "EC2 인스턴스 유형 정리",
      "s": "2026-10-08", "e": "2026-10-14", "st": "open", "round": "2주차" }
  ],
  "markers": [
    { "date": "2026-10-12", "study": "spring", "round": "2주차" }
  ],
  "upcoming": [
    { "id": 1023, "study": "aws", "title": "EC2 인스턴스 유형 정리",
      "s": "2026-10-08", "e": "2026-10-14", "st": "open", "round": "2주차" }
  ]
}
```

- `studies`: 사용자가 ACTIVE/PENDING 으로 묶인 **비보관 방 전부** (창과 무관). 필터 칩이 달을 넘겨도 흔들리지 않게 한다. `pending` 불리언은 `membership == "pending"` 으로 프론트가 파생
- `tasks` / `markers`: 창 안 항목만 (§3-2)
- `upcoming`: `today ~ today+7` 로 서버가 별도 계산. 창과 독립이라 11월을 보고 있어도 패널이 맞다. 같은 쿼리를 범위만 바꿔 한 번 더 돌리면 되므로 비용은 미미
- `tone`: 팔레트 키. 방 생성 시 순환 배정하거나(권장, 다른 화면과 색 일치) 응답에서 생략하고 프론트가 순서로 배정

핵심 쿼리 형태 (PostgreSQL, 배정 물질화 가정)

```sql
SELECT t.id, r.slug AS study, t.title, t.start_date AS s, t.due_date AS e,
       rn.label AS round,
       sub.first_submitted_at, t.due_date
FROM task t
JOIN room r              ON r.id = t.room_id AND r.status <> 'ARCHIVED'
JOIN room_member m       ON m.room_id = r.id AND m.user_id = :me
                        AND m.status IN ('ACTIVE','PENDING')
JOIN curriculum_node rn  ON rn.id = t.round_node_id
LEFT JOIN task_assignment a ON a.task_id = t.id AND a.user_id = :me
LEFT JOIN submission sub    ON sub.task_id = t.id AND sub.user_id = :me
WHERE t.archived = false
  AND t.start_date <= :to AND t.due_date >= :from
  AND (a.user_id IS NOT NULL OR m.status = 'PENDING')   -- 대기 방은 전체 미리보기
ORDER BY t.start_date, t.due_date, t.id;
```

`st` 는 Java 에서 §3-1 로 매핑. 인덱스: `task(room_id, start_date, due_date)`, `room_member(user_id, status)`, `submission(task_id, user_id)` unique.

마커 쿼리: `curriculum_node WHERE depth = 2 AND room_id IN (:myRooms) AND start_date BETWEEN :from AND :to`.

## 6. 목업 ↔ 실데이터 전환 포인트

| 현재 (`src/data/schedule.ts`) | 전환 후 |
|---|---|
| `STUDIES`, `STUDY`, `TASKS`, `MARKERS` 상수 export | `ScheduleScreen` 이 `useSchedule(from, to)` 로 fetch. 타입은 그대로, 값만 응답에서 |
| `StudyId = "aws" \| "spring" \| "sqld"` 리터럴 유니온 | `string` (slug). `Record<StudyId, Study>` 는 `Map`/객체로 |
| `Study.name` 에 `" · 승인 대기"` 포함, `shortName()` 이 `" · "` 앞을 자름 | 서버 `name` 은 순수 제목. 칩 라벨 = `membership === "pending" ? \`${name} · 승인 대기\` : name`, 짧은 칩 = `name` 그대로 + CSS 말줄임 (§7-1) |
| `Study.bg/fg/dot` 하드코딩 | `tone` → `palette.ts` 매핑 |
| `Task.id` = 배열 인덱스 | 서버 PK. `key` 로만 쓰므로 영향 없음 |
| `TODAY` 상수 (`routes.ts`) | 응답 `today`. `DayPanel`, `ListView`, `MonthGrid`, `UpcomingPanel` 이 모두 import 하므로 context/prop 으로 주입 |
| `ScheduleScreen` 초기 `y=2026, m=9` 하드코딩, `goToday()` 도 하드코딩 | `today` 에서 파생 |
| `UpcomingPanel` 이 `tasks` 를 자체 필터 | 응답 `upcoming` 을 그대로 렌더 (필터 칩 `off` 는 여전히 클라에서 적용) |
| `MARKERS` 에 pending 방 포함 | 서버도 PENDING 방의 회차를 포함해야 DayPanel 문구 분기가 살아남 |

목업에서만 가능한 것: 고정 `TODAY`, 고정 로그인 사용자 철수, 3개 방 고정 팔레트, `missed` 부재.

## 7. 디자인 프롬프트에 있으나 화면에 없는 것 / 불명확한 것

| # | 항목 | 결정 필요 | 제안 기본값 |
|---|---|---|---|
| 1 | 칩·막대용 **짧은 방 이름** ("AWS SAA" vs 실제 제목 "AWS SAA 자격증 3개월 완주") | 별도 필드를 둘지 | 필드 추가 없이 제목 + CSS 말줄임. 필요해지면 `room.short_title`(선택, ≤12자) 추가 |
| 2 | 그룹장이고 `leader_does_tasks = false` 인 방의 과제 | 캘린더에 보일지, 상태를 뭘로 할지 | 보이되 `st` 는 날짜 기준 `planned/open` 만, 마감 경과는 아이콘 없음(`st: null` 허용). 다가오는 마감에서는 제외. `TaskStatus` 에 값을 추가하지 않고 nullable 로 처리 |
| 3 | **스터디 시작/종료 표시** — 디자인 §2.5 알림엔 있으나 캘린더엔 없음 | 방 시작·종료일 마커를 그릴지 | 지금은 안 그림. 응답 `studies[].startDate/endDate` 로 재료만 넘겨 둠 |
| 4 | 회차 라벨 "N주차" 의 출처 | 2단계 노드 `label` 컬럼 vs `sort_order` 로 생성 | `label` 컬럼 저장 (그룹장이 "오리엔테이션" 같은 비주차 라벨을 쓸 수 있음). 비어 있으면 `${sort_order}주차` |
| 5 | 승인 대기 방의 과제 노출 | 신청자에게 커리큘럼 미리보기를 허용할지 (비공개 방도?) | 허용. 공개/비공개 무관하게 "신청한 방" 은 읽기 가능 (RoomView 에서 이미 보여주고 있음) |
| 6 | 방 상세 캘린더(§4.8) 의 "특정 참가자 선택" 필터 | 이 화면에도 필요한지 | 아니오. 내 일정은 항상 ME 고정. 같은 쿼리에 `userId` 파라미터만 열어 두면 §4.8 에 재사용 가능 (그룹장/참가자 권한 체크 추가) |
| 7 | 종료된 방 포함 범위 | 몇 달 전까지 | 전부 포함, 보관(archived)만 제외. `studies` 가 길어지면 `endDate < today - 180일` 방은 칩에서 접는 것을 프론트에서 처리 |
| 8 | `sel` 이 창 밖일 때 | 클라가 창 확장 vs 빈 패널 허용 | 클라가 `from/to` 를 `sel` 까지 넓힘 (62일 한도 안에서). 한도를 넘으면 `sel` 을 창 첫날로 리셋 |
| 9 | 필터 칩 `off` 영속화 | 서버 저장 여부 | 하지 않음. 필요 시 `localStorage` |
| 10 | 시간대 | 전 서비스 공통 | 모든 달력일은 KST, 마감 = 23:59:59.999 KST. 프론트의 UTC 문자열 연산은 날짜 문자열만 다루므로 그대로 안전 |
