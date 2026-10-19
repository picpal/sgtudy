# 방 목록 (Main) — 백엔드 요구 분석

> 대상 화면: `/` (`src/app/page.tsx` → `src/components/main/MainScreen.tsx`)
> 근거: `docs/claude-design-prompt.md` §2·§3·§4.2·§4.3·§4.14·§5, `docs/specs/main.md`, `src/data/rooms.ts`, `src/lib/{types,routes,date}.ts`, `src/components/main/*.tsx`, `src/components/ui/AppHeader.tsx`
> 목업 기준일 `TODAY = 2026-10-12`, 로그인 사용자 `ME = 철수` (`src/lib/routes.ts`)

---

## 1. 화면이 읽는 데이터 (Read model)

### 1-1. 헤더 (`AppHeader.tsx`, 전 화면 공용)

| 필드 | 타입 | 어디서 오는가 | 비고(목업 값) |
|---|---|---|---|
| `me.name` | string | `users.nickname` | "철수". 아바타 이니셜은 `name.charAt(0)`, 색상은 `toneOf(name)` 해시 → 백엔드 색상 필드 불필요 |
| `unread` | number | `notifications` 중 `read_at IS NULL` 카운트 (수신자 = me) | 3 고정. `unread > 0` 일 때만 배지 렌더 |
| 검색어 `q` | string | 클라이언트 상태 (헤더 input → 이 화면의 필터) | 서버 검색 파라미터로 전달 |

### 1-2. 방 카드 (`src/data/rooms.ts` `Room` 타입, `RoomCard.tsx`)

| 필드 | 타입 | 어디서 오는가 | 비고(목업 값) |
|---|---|---|---|
| `id` | string | `rooms.id` (또는 slug) | 카드 전체가 `/rooms/{id}` 링크. 디자인 IA 는 `/rooms/[slug]` → §7 결정 항목 |
| `title` | string | `rooms.title` | 2줄 clamp + `title` 툴팁. cs 방처럼 긴 제목 허용 |
| `intro` | string | `rooms.intro` (한 줄 소개) | 검색 대상 아님 |
| `status` | `"recruit"\|"active"\|"ended"\|"full"` | 계산 (§3-1). `full` 은 "모집중 + 정원 도달"의 배지 전용 파생값 | jcg: full. 상태 필터에선 recruit 로 묶임 |
| `pub` | boolean | `rooms.is_public` | false → "비공개" 배지(spring). 비공개 방은 멤버에게만 노출 |
| `approval` | boolean | `rooms.join_policy = APPROVAL` | true → 푸터 "승인제" 아이콘 |
| `cur` | number | `room_members` 중 `status = ACTIVE` 카운트 (그룹장 포함, 이탈·대기 제외) | aws 4/6 = 민수(장)+지은+철수+하나, 도윤(이탈) 제외. §7 docker 0/6 불일치 참조 |
| `max` | number | `rooms.max_members` | `cur >= max` 면 인원 텍스트 빨강 |
| `leader` | string | `users.nickname` (role = LEADER 멤버) | 푸터 "by 민수" + 아바타 |
| `tags` | string[] | `room_tags` → `tags.name` 순서대로 | 카드 행 24px 고정, 넘치면 잘림 → 서버 정렬 순서가 곧 노출 우선순위 |
| `mine` | boolean | 내가 그룹장인 방 + 내 `room_members` MEMBER 행(`status IN (ACTIVE, PENDING)`) — 0029 이후 created ⊂ mine | sqld 는 **승인 대기중인데 mine=true** → "내가 참가한 방"에 대기 방 포함 |
| `created` | boolean | 내 멤버십 `role = LEADER` | docker. mine 에도 포함된다(0029) |
| `period` | string | `rooms.start_date`, `end_date` 로 포맷 (§3-5) | "2026.10.01 – 12.31 · 3개월" |
| `slot.label` | string | 상태·참여 여부로 결정 (§3-2) | 모집 현황 / 내 진척률 / 전체 진행 / 최종 달성률 |
| `slot.value` | string | 상태별 계산 (§3-2) | "4/6명", "50%", "4/8주", "87%" |
| `slot.pct` | 0~100 | 상태별 계산 | 진행바 width |
| `slot.note` | string | 상태별 계산 | "11.02(월) 시작 · 6자리 남음" |
| `slot.em` | string | D-day (§3-4). 빈 문자열이면 미표시 | "D-21", "D-2", "" |

### 1-3. 필터 바 (`FilterBar.tsx`, `MainScreen.tsx`)

| 필드 | 타입 | 어디서 오는가 | 비고 |
|---|---|---|---|
| `tabCounts.public/mine/created` | number | **필터와 무관한 고정 총계**. 전체 공개 방 수 / 내가 참가(대기 포함·그룹장 방 포함)한 방 수 / 내가 만든 방 수 | 8 / 5 / 1 |
| `tagCounts[]` `{tag, count}` | 배열 | **현재 탭의 방만** 기준 집계 (상태·검색·태그 필터 무시). count 내림차순, 동률 시 `localeCompare(ko)` | public 탭: 자격증 3, 클라우드 2, 나머지 1 |
| `rooms[]` | `Room[]` | 탭 → 상태 → 검색 → 태그 순 적용 결과. **배열 순서 = 렌더 순서** (정렬 기준 명시 없음) | 초기 8장 (spring 제외) |

---

## 2. 사용자 액션 → 백엔드 연산 (Write model)

이 화면의 쓰기 연산은 **방 만들기** 하나다. 나머지는 모두 읽기(필터·검색·이동).

### 2-1. 읽기/이동 액션 전체 (`docs/specs/main.md` §3 기준)

| 요소 | 동작 | 백엔드 |
|---|---|---|
| 탭 3개 (`전체 공개 방`/`내가 참가한 방`/`내가 만든 방`) | `tab = public\|mine\|created`. 다른 필터 유지 | `GET /api/rooms?scope=` |
| 상태 칩 4개 | `status = all\|recruit\|active\|ended` 단일 선택. `full` 은 recruit 에 포함 | `&status=` |
| 헤더 검색 input | 입력마다 즉시 필터 (디바운스 없음). `title + tags` 소문자 부분일치, intro 제외 | `&q=` (서버는 디바운스 전제. 프론트에서 250ms 정도 디바운스 추가 권장) |
| 태그 칩 | 다중 토글, **OR** 매칭 | `&tags=a,b` |
| 초기화 | `tags = []` | - |
| 카드 클릭 | `routes.room(id)` → `/rooms/{id}` | 방 상세 API (별도 화면) |
| "방 만들기" (상단 CTA, 빈 상태 CTA) | 현재 `routes.createRoom()` → `/my-study` (목업 임시). 실제론 `/rooms/new` | §2-2 |
| 알림 버튼 | 핸들러 없음 (배지만) | `GET /api/notifications/unread-count` → 드롭다운은 별도 |
| 프로필 버튼 | 핸들러 없음 | `GET /api/me` |
| nav "내 스터디"/"내 일정" | `/my-study`, `/schedule` | 다른 화면 |

### 2-2. 방 만들기 (`POST /api/rooms`) — 디자인 §2.1·§4.3

| 항목 | 내용 |
|---|---|
| 트리거 UI | 타이틀 행 "방 만들기" 버튼, 빈 상태 박스 "방 만들기" 버튼 → `/rooms/new` 폼 (화면 미구현) |
| 선행 조건 | 로그인 사용자. 역할 제한 없음 (누구나 그룹장 가능). 비로그인은 로그인 유도 |
| 입력 (필수) | `title`(= 최상위 목표), `intro`, `startDate`, `endDate`, `maxMembers`, `isPublic`, `joinPolicy` (`OPEN` 바로 참가 / `APPROVAL` 승인제) |
| 입력 (선택, "더 설정하기") | `description`(마크다운), `rules`(마크다운), `minMembers`, `leaderParticipates`(기본 true), `coverImageId`, `tags[]`(수동. 자동 태그는 커리큘럼 저장 시 별도) |
| 검증 규칙 (제안) | `title` 1~60자 trim 후 공백 불가 · `intro` 1~100자 · `startDate <= endDate` · `startDate >= 오늘(KST)` · `maxMembers` 2~100 정수 · `minMembers` null 또는 `1 <= min <= max` · `description/rules` 각 ≤ 20,000자 · `tags` ≤ 10개, 각 1~20자 · 커버 이미지 10MB 이하 이미지 |
| 상태 변화 | `rooms` INSERT (status = 초기 상태, §7 결정) · `room_members` INSERT (me, role LEADER, status ACTIVE, `participates = leaderParticipates`) · `room_tags` INSERT · 응답으로 `id`/`slug` 반환 → 프론트는 **커리큘럼 탭 편집 모드**로 이동 ("첫 회차를 추가해 보세요" 가이드) |
| 부수효과 | 알림 없음 (스터디 시작/종료 알림은 상태 전환 시). 초대 토큰(`invite_token`) 생성 — 비공개 방은 초대 링크로만 진입하므로 생성 시점에 발급 |
| 실패 케이스 | `401 UNAUTHENTICATED` · `400 VALIDATION_FAILED` (필드별 메시지 배열) · `400 ROOM_INVALID_PERIOD` (start > end) · `400 ROOM_MIN_EXCEEDS_MAX` · `413 COVER_TOO_LARGE` · `404 TAG_NOT_FOUND` (사전 전용 정책일 경우) |

> 방 목록 화면 자체에는 참가/참가 취소/승인 버튼이 없다. 카드의 `cur/max`, "정원 마감", "승인 대기중"은 전부 **읽기 전용 파생값**이며 쓰기는 방 상세(RoomView/RoomDetail) 분석 문서 소관.

---

## 3. 파생 값 계산 규칙

모든 날짜는 **KST `LocalDate`** 기준. 프론트 `date.ts` 는 `YYYY-MM-DD` 문자열만 다루므로 API 는 ISO date 문자열을 내려주면 된다.

### 3-1. 방 상태 (`status`) + 정원 마감 배지

```
if archived_at != null or today > end_date      → ended    (종료일 다음날 00:00 자동 종료)
else if started_at != null or today >= start_date → active   (시작일 00:00 자동, 그룹장 "지금 시작"은 started_at 기록)
else                                              → recruit
isFull = (status == recruit) && activeMemberCount >= max_members
cardStatus = isFull ? "full" : status           // 프론트 CardStatus
statusFilter(full) = recruit                     // 상태 칩 매칭용
```

검증: jcg(10/19 시작, 4/4) → recruit & full → 배지 "정원 마감", 칩 "모집중"에 포함. spring(5/5, 진행중) → active, full 아님 (진행중엔 정원 개념 없음). algo(09/30 종료, 오늘 10/12) → ended.

### 3-2. 상태 슬롯 (`slot`) — 상태 × 참여 여부로 4종

| 조건 | label | value | pct | note | em |
|---|---|---|---|---|---|
| recruit / full | 모집 현황 | `{cur}/{max}명` | `round(cur/max*100)` | `{M.DD(요일)} 시작 · {꼬리}` | `D-{start_date}` |
| active & 내가 ACTIVE 멤버(과제 수행자) | 내 진척률 | `{p}%` | `p` | 다음 마감 과제 제목 | `D-{그 과제 마감일}` |
| active & 비멤버 (또는 수행 안 하는 그룹장) | 전체 진행 | `{현재 회차}/{전체 회차}주` | `round(현재/전체*100)` | `{n}주차 · {현재 회차 제목}` | `""` |
| ended | 최종 달성률 | `{p}%` | `p` | `{전체 회차}주 완주 · 제출 {제출}/{담당}건` | `""` |

**모집 현황 꼬리(note) 우선순위**
1. 내 멤버십이 PENDING → `승인 대기중` (sqld)
2. `cur >= max` → `정원 마감` (jcg)
3. 그룹장 외 참가자 0명 → `첫 참가자를 기다려요` (docker)
4. 그 외 → `{max-cur}자리 남음` (toeic 6자리, cs 3자리)

검증: toeic 2/8 → pct 25, "11.02(월) 시작 · 6자리 남음", D-21 (10/12→11/02 = 21일). cs 3/6 → 50, D-7. jcg 4/4 → 100. 요일은 `weekdayKo` 와 동일하게 서버가 주지 않아도 프론트 계산 가능.

**내 진척률 (active & mine)**
```
myTasks   = 내가 담당자인 말단 과제 전체 (공통 과제 = 활성 참가자 전원 담당, 지정 과제 = task_assignees)
          · 예정(planned) 포함, 보관(archived) 노드 제외
submitted = myTasks 중 내 submission 존재 (지각 포함)
p = floor(submitted / myTasks * 100)   // myTasks = 0 이면 0
```
검증 (aws, 철수, 디자인 §6 샘플): 철수 담당 말단 = IAM 정책 이해 🟢, VPC 실습 🟢, EC2 인스턴스 유형 정리(지정: 지은·철수, 미제출), ALB vs NLB 실습(공통, 예정) → **2/4 = 50%** ✓. 로드밸런서 비교는 자식이 있어 말단 아님.

**다음 마감 과제 (note/em)**
```
candidates = myTasks 중 미제출 AND due_date >= today
next = due_date ASC, 같은 날이면 트리 순서 → 제목 + dday(today, due_date)
없으면: note "남은 과제가 없어요", em ""     (§7 결정)
```
검증: aws → "EC2 인스턴스 유형 정리", 2주차 기간 10/8~10/14 → D-2 ✓ (10/12→10/14). spring → D-6 = 마감 10/18.

**전체 진행 (active & 비멤버)**
```
rounds  = 2단계 노드(회차) 목록, 시작일 순
current = today 가 기간에 포함되는 회차 (없으면 today 이전 마지막 회차)
value   = "{current.index}/{rounds.size}주", note = "{index}주차 · {current.title}"
pct     = round(index / size * 100)
```
검증: react 09/21 시작, 8주 → 10/12 는 22일째 → 4주차 (10/12~10/18) → "4/8주", 50%, "4주차 · 컴포넌트 상태 관리" ✓ (회차 제목이 "컴포넌트 상태 관리"라는 가정).

**최종 달성률 (ended)**
```
assigned  = 방 전체 (말단 과제 × 담당자) 건수   -- 이탈자 제외/재지정 반영
submitted = 그중 submission 존재 건수
p = floor(submitted / assigned * 100)
note = "{rounds.size}주 완주 · 제출 {submitted}/{assigned}건"
```
검증: algo 68/78 = 0.8718 → **87%** ✓ (13회차 × 6명 = 78건). 이 값은 **팀 집계**이지 내 진척률이 아님 (§7).

### 3-3. 인원 `cur/max`
`cur = COUNT(room_members WHERE room_id = ? AND status = ACTIVE)` — 그룹장 포함, PENDING·LEFT 제외. aws: 민수·지은·철수·하나 = 4 ✓, 도윤(이탈) 제외. 승인 대기자는 정원 미포함 (디자인 §2.1).

### 3-4. D-day (`date.ts dday`)
`n = target - today` (일). `n == 0 → "D-DAY"`, `n > 0 → "D-{n}"`, `n < 0 → "D+{-n}"`. 서버가 `targetDate` 만 주면 프론트가 계산 가능하나, "오늘"을 KST 로 통일하려면 서버가 `today` 또는 `dday` 정수를 함께 주는 편이 안전.

### 3-5. 기간 문자열 `period`
```
"{YYYY.MM.DD} – {같은 해면 MM.DD, 아니면 YYYY.MM.DD} · {N}주"
N = round(inclusiveDays / 7),  inclusiveDays = end - start + 1
```
검증: toeic 11/02~12/27 = 56일 → 8주 ✓, spring 10/05~2027/01/31 = 119일 → 17주 ✓ (연도 다르므로 "2027.01.31"), cs 43일 → 6주 ✓, algo 92일 → 13주 ✓, sqld 28일 → 4주 ✓. **예외: aws 92일인데 목업은 "3개월"** (§7). 백엔드는 `startDate/endDate` 만 내리고 포맷은 프론트 담당 권장.

### 3-6. 탭 소속 / 카운트
```
public  : is_public = true  (상태 무관 — ended·full 포함, 내 멤버십 무관)
mine    : (내 멤버십 role = LEADER) OR (role = MEMBER AND status IN (ACTIVE, PENDING))   -- 0029: created ⊂ mine
created : 내 멤버십 role = LEADER
tabCounts = 각 집합 크기 (필터 미적용)
```
검증: public 8 (spring 제외), mine 5 (aws, spring, sqld, docker, algo — sqld 는 PENDING, docker 는 그룹장 방), created 1 (docker) ✓. 비공개 방은 `mine`/`created` 에서만 보인다.

### 3-7. 태그 facet
현재 `scope` 집합(상태·검색·태그 미적용)에서 `room_tags` GROUP BY tag → count DESC, name ko-collation ASC. 서버 페이지네이션을 넣으면 **facet 은 반드시 서버 집계**여야 한다 (현재는 클라이언트 전체 배열 기준).

### 3-8. 검색
`LOWER(title) LIKE %q%` OR `EXISTS (room_tags.tag LOWER LIKE %q%)`. `q` 는 trim. intro·설명은 제외 (스펙 §4). PostgreSQL 은 `ILIKE` + 필요 시 `pg_trgm` 인덱스.

### 3-9. 정렬 (미정)
목업은 하드코딩 순서. 제안 기본값: `status` 우선순위(active → recruit/full → ended) → `start_date ASC` → `created_at DESC`. `sort` 파라미터로 `latest|startDate|popular` 확장 여지.

---

## 4. 엔티티·관계 후보

| 테이블 | 핵심 필드 | 이 화면 용도 | 공용 |
|---|---|---|---|
| `users` | id, email(unique), nickname(unique, 2~16), avatar_url, created_at | 헤더 `me`, 리더명 | 공용 |
| `rooms` | id, slug(unique), title, intro, description_md, rules_md, start_date, end_date, max_members, min_members(null), is_public, join_policy(OPEN/APPROVAL), leader_participates, cover_image_id, status(DRAFT?/RECRUITING/ACTIVE/ENDED/ARCHIVED), started_at, archived_at, invite_token(unique), created_by, created_at | 카드 전부, 방 만들기 | 공용 |
| `room_members` | room_id, user_id, role(LEADER/MEMBER), status(ACTIVE/PENDING/LEFT/REJECTED/EXPIRED), applied_at, joined_at, left_at · UNIQUE(room_id, user_id) | cur, mine/created, 승인 대기중 | 공용 |
| `tags` | id, name(unique, ko collation) | 태그 칩, facet, 검색 | 공용 |
| `room_tags` | room_id, tag_id, is_auto, sort_order | 태그 행(순서 유지), "자동" 표식 | 공용 |
| `goal_nodes` | id, room_id, parent_id, depth(1~5), sort_order, title, description_md, start_date, end_date, task_type(null/COMMON/ASSIGNED), archived_at | 회차(depth 2) 집계, 말단 과제, 다음 마감 | 공용 (커리큘럼) |
| `task_assignees` | node_id, user_id | 지정 과제 담당자 | 공용 |
| `submissions` | id, node_id, user_id, body_md, first_submitted_at, updated_at, is_late · UNIQUE(node_id, user_id) | 진척률·달성률 분모/분자 | 공용 |
| `notifications` | id, user_id, type, room_id, target_path, message, created_at, read_at | 헤더 unread 카운트 | 공용 |
| `files` | id, owner_id, kind(COVER/ATTACHMENT), url, size, mime | 커버 이미지 | 공용 |

인덱스 후보: `rooms(is_public, status)`, `room_members(user_id, status)`, `room_tags(tag_id)`, `notifications(user_id) WHERE read_at IS NULL`, `rooms USING gin (title gin_trgm_ops)`.

진척률·회차 집계는 카드 1장당 서브쿼리가 4~5개 → 목록 API 는 **카드 20장 기준 N+1 금지**. 방별 집계를 한 번에 가져오는 `room_progress` 뷰(또는 머티리얼라이즈드 뷰 / 제출 시 갱신되는 `room_member_progress` 캐시 테이블)를 권장.

---

## 5. API 후보

| METHOD path | 요청 | 응답 | 권한 |
|---|---|---|---|
| `GET /api/rooms` | `scope=public\|mine\|created` (기본 public) · `status=all\|recruit\|active\|ended` · `q` · `tags=a,b` (OR) · `page,size` · `sort` | `{ items: RoomCard[], page, totalElements, tabCounts: {public,mine,created}, tagFacets: [{tag,count}] }` | public: 익명 허용 / mine·created: 로그인 필수 (401) |
| `GET /api/rooms/counts` | - | `{public, mine, created}` (목록과 분리하고 싶을 때) | 로그인 |
| `GET /api/rooms/tags?scope=` | - | `[{tag, count}]` | public 익명 허용 |
| `POST /api/rooms` | §2-2 body | `201 { id, slug }` + `Location` | 로그인 |
| `GET /api/me` | - | `{ id, nickname, email, unreadNotificationCount }` | 로그인 |
| `GET /api/notifications/unread-count` | - | `{ count }` (헤더 배지 폴링/SSE 용) | 로그인 |

**RoomCard DTO (프론트 `Room` 과 1:1)**
```jsonc
{
  "id": "aws", "slug": "aws-saa-3m",
  "title": "...", "intro": "...",
  "status": "ACTIVE",            // RECRUITING | ACTIVE | ENDED
  "isFull": false,               // RECRUITING && cur >= max  → 프론트 CardStatus "full"
  "isPublic": true,
  "joinPolicy": "APPROVAL",      // OPEN | APPROVAL → approval boolean
  "memberCount": 4, "maxMembers": 6,
  "leader": { "id": 1, "nickname": "민수" },
  "tags": ["AWS", "클라우드", "자격증"],
  "startDate": "2026-10-01", "endDate": "2026-12-31",
  "membership": { "role": "MEMBER", "status": "ACTIVE" } | null,   // mine/created 파생
  "progress": {                  // 슬롯 원재료 — kind 별 discriminated union
    "kind": "MY_PROGRESS",       // RECRUIT | MY_PROGRESS | TEAM_PROGRESS | FINAL
    "submitted": 2, "assigned": 4,
    "nextTask": { "id": 42, "title": "EC2 인스턴스 유형 정리", "dueDate": "2026-10-14" } | null
  }
}
// RECRUIT:       { kind, remaining: 6, waitingFirst: false }      (myPending 은 membership.status 로)
// TEAM_PROGRESS: { kind, currentRound: { index: 4, title: "컴포넌트 상태 관리" }, totalRounds: 8 }
// FINAL:         { kind, submitted: 68, assigned: 78, totalRounds: 13 }
```
슬롯 문자열(`label/value/note/em`)은 프론트 어댑터에서 조립 (§6). 백엔드가 문구까지 만들면 i18n·디자인 변경마다 배포가 필요해진다.

---

## 6. 목업 ↔ 실데이터 전환 포인트

| 현재 (목업) | 전환 |
|---|---|
| `export const ROOMS: Room[]` (`src/data/rooms.ts`) 동기 상수 | `fetchRooms(params): Promise<RoomListResponse>` + `toRoomCard(dto, today): Room` 어댑터. `Room` 타입은 유지하고 어댑터가 `slot`·`period`·`status:"full"`·`mine/created` 를 생성 |
| `TAB_COUNTS` 를 `ROOMS` 에서 모듈 로드 시 계산 (`MainScreen.tsx`) | 응답 `tabCounts` 사용. 익명이면 mine/created 탭 숨김 또는 로그인 유도 |
| `tagCounts` 를 `tabRooms` 에서 `useMemo` 집계 | 응답 `tagFacets` 사용 (페이지네이션 시 클라이언트 집계 불가) |
| 탭→상태→검색→태그 필터를 클라이언트에서 적용 | 전부 쿼리 파라미터로. 검색 input 에 디바운스 추가 |
| `TODAY = "2026-10-12"` (`routes.ts`) | 서버 응답 `today`(KST) 또는 클라이언트 `Intl` KST 날짜. `dday()`·회차 계산 입력 |
| `ME = 철수` 고정, 비로그인 분기 없음 | `GET /api/me` + 401 시 익명 모드 (공개 탭만, "방 만들기" → 로그인) |
| `AppHeader unread = 3` 기본값 | `me.unreadNotificationCount` 전달 |
| `period: "2026.10.01 – 12.31 · 3개월"` 문자열 | `startDate/endDate` → §3-5 포맷 함수 |
| `status: "full"` 데이터 값 | `status === "RECRUITING" && isFull` 파생 |
| `routes.createRoom() → "/my-study"` | `/rooms/new` 화면 신설 → `POST /api/rooms` → `/rooms/{slug}?tab=curriculum&mode=edit` |
| `routes.room(id) → /rooms/{id}` | `id` 를 slug 로 쓸지 숫자 id 로 쓸지 결정 (§7) |
| 리더 아바타 색 `toneOf(name)` | 닉네임 해시 — 그대로 둠. 닉네임이 unique 이므로 안정적 |

---

## 7. 디자인 프롬프트에 있으나 화면에 없는 것 / 불명확한 것

| # | 항목 | 문제 | 제안 기본값 |
|---|---|---|---|
| 1 | **방 생성 직후 상태** | 디자인: "말단 과제 1개 이상 있어야 모집 시작 가능" → 생성 직후는 모집중이 아닌 상태가 필요. 화면엔 해당 배지 없음 | `DRAFT` 상태 추가. 내가 만든 방 탭에만 노출, 배지 "준비중". 그룹장 "모집 시작" 액션(커리큘럼 탭)에서 RECRUITING 전환 + 말단 과제 ≥1 검증 |
| 2 | **docker `cur: 0/6`** vs aws `4/6`(그룹장 포함) | 같은 규칙이면 docker 는 1/6 (철수 본인). 목업 불일치 | 그룹장 포함 카운트(aws 기준). docker 는 1/6, "첫 참가자를 기다려요" 조건은 *그룹장 외 0명* |
| 3 | **승인 대기 방이 "내가 참가한 방"에 포함** (sqld) | 참가 전인데 mine. 의도적일 수 있음(내 신청 추적) | 포함 유지. `membership.status = PENDING` 으로 "승인 대기중" 표시. 거절/만료는 제외 |
| 4 | **내가 만든 방이 "내가 참가한 방"에 포함 (0029)** | 원래 목업은 mine·created 배타였음. 그룹장도 과제 수행(기본 ON)인데 내 진척률을 볼 탭이 없음 | 0029 로 mine 에 그룹장 방 포함(created ⊂ mine, 배타 아님). created 탭의 active 방 슬롯은 `leader_participates` 면 "내 진척률", 아니면 "전체 진행" |
| 5 | **종료 방 슬롯 = 팀 달성률 (87% = 68/78)** | mine=true 인데 내 달성률이 아님 | 팀 집계 유지(목업). 내 달성률은 방 상세에서 |
| 6 | **`period` 의 "3개월"(aws) vs "13주"(algo)** | 둘 다 92일. 규칙 도출 불가 | `round(days/7)주` 통일 → aws "13주" |
| 7 | **"전체 진행 4/8주"의 "주" 단위** | 회차가 주 단위가 아닐 수 있음 (2단계 노드명 자유) | 단위는 "회차"로 바꾸거나, 회차 수 = 2단계 노드 수로 두고 라벨만 "주" 유지. 결정 필요 |
| 8 | **다음 마감 과제가 없을 때** (내 과제 전부 제출 / 전부 마감 경과) | 목업 없음 | note "남은 과제가 없어요", em "". 마감 지난 미제출만 있으면 가장 최근 것 + `D+n` 빨강 |
| 9 | **정렬 기준** | 배열 순서 하드코딩 | §3-9 제안. `sort` 파라미터 |
| 10 | **페이지네이션 / 무한 스크롤** | 9장 전제. 공개 서비스 전환 시 수백 장 | `page/size`(기본 24, 4열×6행). facet·탭 카운트는 서버 집계 |
| 11 | **`id` vs `slug`** | 프론트 `/rooms/{id}` ("aws"), 디자인 `/rooms/[slug]` | 둘 다 발급. URL 은 slug(제목 기반 + 중복 시 접미), API 내부 참조는 id |
| 12 | **비로그인 분기** | 디자인: 공개 방 읽기 허용, 참가 클릭 시 로그인. 화면엔 분기 없음 | `GET /api/rooms?scope=public` 익명 허용. 헤더는 로고+로그인 버튼 |
| 13 | **태그 자동 추출 (AI, Jev)** | 커리큘럼 저장 시 트리거. 방 만들기 시점엔 수동 태그만 | `room_tags.is_auto` 컬럼만 예약. 생성 API 는 수동 태그만 받음 |
| 14 | **커버 이미지** | 스펙상 "커버 영역 렌더 안 함(죽은 코드)" | 컬럼·업로드 API 는 두되 목록 DTO 에선 `coverUrl` nullable 로 포함만 |
| 15 | **알림 드롭다운** | 헤더 배지만 있고 목록·읽음 처리 UI 없음 | 이 화면 범위 밖. `unread-count` 만 제공 |
| 16 | **검색 디바운스 없음** | 서버 호출로 바뀌면 키 입력마다 요청 | 프론트 250ms 디바운스 + 요청 취소. 서버 `q` 최소 1자 |
| 17 | **상태 자동 전환 시각** | 시작일 00:00 KST, 종료일 다음날 00:00 KST | 조회 시 날짜 비교로 계산(§3-1)하고, 알림 발송용으로만 스케줄러가 `status` 컬럼을 갱신. 두 값이 어긋나지 않도록 조회는 날짜 계산을 우선 |
