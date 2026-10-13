# 데이터 접근 계약 (Supabase RPC · 테이블)

> DTO 는 프론트 `src/data/*.ts` 타입과 1:1 이 되도록 **원시 값**만 담는다(D13). 문자열 조립(D-day·기간 문구·회차 창·glance 문구)은 프론트 어댑터 몫.
> 표의 `METHOD path` 열은 **의미상 REST 이름**이고, 실제 호출은 오른쪽 `RPC` 열의 Postgres 함수(`supabase.rpc(name, args)`)다. 이관(D15) 시 이 REST 이름이 그대로 엔드포인트가 된다.
> 함수 인자 이름은 `p_` 접두(`p_slug`), JSON 키는 camelCase.
> 권한 열: `공개` = 비로그인 가능(비공개 방은 404), `로그인`, `멤버` = ACTIVE/INACTIVE/PENDING 멤버(읽기), `활성멤버` = ACTIVE, `그룹장`, `담당자`.
> 모든 읽기 함수 JSON 최상위에 `today: "YYYY-MM-DD"`(KST) 를 포함한다. 아래 shape 에서는 생략.

## 0. 공통

```sql
-- 함수 안에서
RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ROOM_FULL', DETAIL = '정원이 찼어요', HINT = '{"field":"maxMembers"}';
```
```ts
// 프론트 어댑터 (src/lib/api/errors.ts)
type ApiError = { code: string; message: string; details?: Record<string,string> };
// PostgrestError { message: 'ROOM_FULL', details: '정원이 찼어요', hint: '{"field":...}' } → ApiError
```
`HTTP` 열은 이관 시 상태 코드. Supabase 에서는 전부 PostgREST 400 + `message=code`.

| HTTP | 대표 code |
|---|---|
| 400 | `VALIDATION_FAILED`, `INVALID_PERIOD`, `INVALID_TITLE`, `INVALID_LINK`, `NICKNAME_INVALID`, `NICKNAME_RESERVED`, `SCHEDULE_RANGE_INVALID`, `LEAVE_DECISION_MISSING`, `REASSIGN_REQUIRED`, `CAPACITY_BELOW_CURRENT` |
| 401 | `AUTH_REQUIRED` |
| 403 | `ONBOARDING_REQUIRED`, `NOT_LEADER`, `NOT_MEMBER`, `TASK_NOT_ASSIGNED`, `OWNER_CANNOT_LEAVE` |
| 404 | `ROOM_NOT_FOUND`(비공개 포함), `NODE_NOT_FOUND`, `INVITE_NOT_FOUND`, `NOT_FOUND` |
| 409 | `ROOM_FULL`, `ROOM_NOT_RECRUITING`, `ROOM_NOT_ACTIVE`, `ROOM_NOT_EDITABLE`, `ROOM_STATUS_INVALID`, `ROOM_NO_LEAF_TASK`, `ALREADY_MEMBER`, `ALREADY_PENDING`, `ALREADY_DECIDED`, `JOIN_MODE_MISMATCH`, `OWNER_CANNOT_JOIN`, `NICKNAME_TAKEN`, `NODE_HAS_SUBMISSIONS`, `NODE_DEPTH_EXCEEDED`, `NODE_NOT_LEAF`, `PARENT_ARCHIVED`, `ROOT_CANNOT_OUTDENT`, `ASSIGNEE_NOT_MEMBER`, `ASSIGNEE_HAS_SUBMISSION`, `FIELD_LOCKED`, `MEMBER_NOT_ACTIVE`, `CANNOT_DEACTIVATE_LEADER`, `TASK_NOT_STARTED`, `TASK_ARCHIVED`, `FILE_LIMIT_EXCEEDED`, `FILE_NOT_READY`, `TAG_LIMIT_EXCEEDED` |
| 410 | `INVITE_REVOKED` |
| 413 | `FILE_TOO_LARGE` |
| 415 | `FILE_TYPE_NOT_ALLOWED` |
| 429 | (OTP 제한은 Supabase Auth 가 처리: `over_email_send_rate_limit`, `otp_expired`) |

공통 타입:
```ts
type Tone = "mint"|"blue"|"peach"|"lav"|"amber"|"slate";
type Person = { userId: string; nickname: string; tone: Tone };
type RoomStatus = "draft"|"recruit"|"active"|"ended";
type TaskStatus = "planned"|"open"|"done"|"late"|"missed";      // src/lib/types.ts 와 동일
type TaskType = "common"|"designated";
type Membership = { role: "leader"|"member"; status: "active"|"pending"|"inactive"|"rejected"|"canceled"|"expired" } | null;
type RoomTag = { slug: string; label: string; tone: Tone; auto: boolean };
```

## 1. 인증 · 사용자

인증은 Supabase Auth 가 담당한다(함수 없음):

| 동작 | supabase-js | 비고 |
|---|---|---|
| OTP 요청 | `auth.signInWithOtp({ email, options: { shouldCreateUser: true } })` | 대시보드: Email OTP 켜기, 템플릿에 `{{ .Token }}`, 만료 600초, 재전송 60초 |
| OTP 검증 | `auth.verifyOtp({ email, token, type: "email" })` | 성공 시 `@supabase/ssr` 가 쿠키 세션 저장 |
| 로그아웃 | `auth.signOut()` | |
| 온보딩 판정 | `me_get().onboarded` | `profiles.nickname IS NULL` → `/onboarding` |

| METHOD path | RPC | 인자 | 응답 | 권한 |
|---|---|---|---|---|
| `GET /meta` | `meta_get` | — | `{ today, serverTime }` | 공개 |
| `GET /me` | `me_get` | — | `Me` | 로그인(온보딩 전 허용) |
| `PATCH /me` | `me_update` | `p_nickname?, p_optional_mail_enabled?` | `Me` | 로그인(온보딩 전 허용) |
| `GET /users/nickname-check` | `nickname_check` | `p_value` | `{ available, reason?: "taken"\|"invalid"\|"reserved" }` | 로그인 |

```ts
type Me = { id: string; email: string; nickname: string | null; initial: string; tone: Tone;
            onboarded: boolean; optionalMailEnabled: boolean; unreadCount: number };
```
닉네임 규칙: 2~16자, 한글·영문·숫자·`_`·`.`·공백(연속 불가), NFC+lower 로 정규화해 UNIQUE, 금칙어(`관리자`,`admin`,`sgtudy`,`슥터디`). `returnTo` 는 `/rooms/`, `/my-study`, `/schedule`, `/invite/` 접두사만(프론트 미들웨어).

## 2. 방 목록 · 생성 · 수정 · 상태

### `GET /rooms` → `rooms_list(p_scope, p_status, p_q, p_tags text[], p_page, p_size, p_sort)` — 공개
인자: `scope=public|mine|created`(기본 public; mine/created 는 로그인) · `status=all|recruit|active|ended` · `q` · `tags=a,b`(OR) · `page=0` · `size=24` · `sort=default|latest|startDate`
```ts
type RoomListResponse = {
  items: RoomCard[]; page: number; size: number; totalElements: number;
  tabCounts: { public: number; mine: number; created: number };   // 비로그인: mine/created = 0
  tagFacets: { slug: string; label: string; count: number }[];     // 현재 scope 기준
};
type RoomCard = {
  id: string; slug: string; title: string; intro: string;
  status: RoomStatus; isFull: boolean;                 // isFull = recruit && memberCount >= maxMembers
  isPublic: boolean; joinMode: "direct"|"approval";
  memberCount: number; maxMembers: number;
  leader: Person; tags: RoomTag[];
  startDate: string; endDate: string;
  membership: Membership;
  progress:
    | { kind: "recruit" }
    | { kind: "mine";  submitted: number; assigned: number; nextTask: { nodeId: string; title: string; dueDate: string } | null }
    | { kind: "team";  currentRound: { index: number; label: string; title: string } | null; totalRounds: number }
    | { kind: "final"; submitted: number; assigned: number; totalRounds: number };
};
```
`progress.kind` 결정: `recruit|draft` → recruit · `active` & 내가 담당자(ACTIVE, 그룹장은 leader_does_tasks) → mine · `active` 그 외 → team · `ended` → final.
정렬 기본값: active → recruit → draft → ended, 그 안에서 `start_date ASC`, `created_at DESC`. 검색은 제목 + 태그 label/aliases ILIKE. 비공개 방은 `mine/created` 에서만.

### 나머지
| METHOD path | RPC | 인자 | 응답 | 권한 |
|---|---|---|---|---|
| `POST /rooms` | `room_create` | `CreateRoom` | `201 RoomDetail` + `Location` | 로그인 |
| `GET /rooms/{slug}` | `room_get` | — | `RoomDetail` | 공개 / 비공개: 멤버·`?invite=token` |
| `PATCH /rooms/{slug}` | `room_update` | `UpdateRoom`(부분) | `RoomDetail` + `warnings[]` | 그룹장 (상태별 잠금 D11) |
| `POST /rooms/{slug}/open-recruit` | `room_open_recruit` | — | `RoomDetail` | 그룹장, DRAFT, 리프 ≥1 (`ROOM_NO_LEAF_TASK`) |
| `POST /rooms/{slug}/start` | `room_start` | — | `RoomDetail` + `warnings: [{ code:"UNASSIGNED_TASK", nodeId }]` | 그룹장, RECRUIT |
| `POST /rooms/{slug}/archive` / `unarchive` | `room_archive / room_unarchive` | — | `RoomDetail` | 그룹장, ACTIVE·ENDED |
| `DELETE /rooms/{slug}` | `room_delete` | — | 204 | 그룹장, DRAFT·RECRUIT (`ROOM_STATUS_INVALID`) |

```ts
type CreateRoom = { title: string; intro: string; startDate: string; endDate: string; maxMembers: number;
  isPublic: boolean; joinMode: "direct"|"approval";
  descriptionMd?: string; rulesMd?: string; minMembers?: number; leaderDoesTasks?: boolean; coverFileId?: string; tagSlugs?: string[] };
type UpdateRoom = Partial<Omit<CreateRoom, "tagSlugs">>;
type RoomDetail = {
  id: string; slug: string; title: string; intro: string; descriptionMd: string; rulesMd: string;
  status: RoomStatus; archived: boolean; isPublic: boolean; joinMode: "direct"|"approval";
  startDate: string; endDate: string; maxMembers: number; minMembers: number | null;
  memberCount: number; leader: Person; leaderDoesTasks: boolean; tags: RoomTag[];
  members: (Person & { role: "leader"|"member"; status: "active"|"pending"|"inactive"; joinedAt: string | null })[];
      // ACTIVE 전원 + INACTIVE(이탈, 회색) + **내** PENDING 행만. 타인의 PENDING 은 applications 로
  me: { state: "none"|"pending"|"active"|"inactive"|"leader" } | null;      // null = 비로그인
  currentRound: RoundSummary | null;                                        // D5·mystudy §3.8
  rounds: RoundSummary[];                                                   // depth-2 전부, sort_order 순
  stats: { roundCount: number; leafCount: number; commonCount: number; designatedCount: number;
           totalAssignments: number; totalSubmissions: number; overallPct: number | null;
           unassignedCount: number; startWeekdays: number[] };
  myProgress: { submitted: number; assigned: number; nextDue: { nodeId: string; title: string; roundLabel: string; dueDate: string } | null } | null;
  invite: { url: string } | null;                                           // 그룹장만
  pendingCount: number;                                                     // 그룹장만, 아니면 0
};
type RoundSummary = { id: string; label: string; title: string; startDate: string; endDate: string;
  leafCount: number; assigned: number; submitted: number; pct: number | null;
  tasks?: LeafSummary[] };                                                  // currentRound 에만 채움
type LeafSummary = { id: string; title: string; type: TaskType; startDate: string; endDate: string;
  people: (Person & { status: TaskStatus })[] };
```

## 3. 멤버십 · 초대

| METHOD path | RPC | 인자 | 응답 | 권한 |
|---|---|---|---|---|
| `POST /rooms/{slug}/join` | `room_join` | `{ inviteToken? }` | `MembershipResult` | 로그인, RECRUIT, DIRECT |
| `POST /rooms/{slug}/applications` | `room_apply` | `{ inviteToken? }` | `MembershipResult` | 로그인, RECRUIT, APPROVAL |
| `DELETE /rooms/{slug}/membership` | `room_leave` | — | `MembershipResult` | 활성멤버(MEMBER), RECRUIT |
| `DELETE /rooms/{slug}/applications/me` | `room_cancel_application` | — | `MembershipResult` | PENDING 본인 |
| `GET /rooms/{slug}/applications` | `room_applications` | — | `{ items: (Person & { appliedAt })[] }` | 그룹장 |
| `POST /rooms/{slug}/applications/{userId}/approve` / `reject` | `room_approve / room_reject` | — | `MembershipResult` | 그룹장, RECRUIT |
| `GET /rooms/{slug}/members` | `room_members_get` | — | `{ items: RoomDetail["members"] }` (전 상태) | 그룹장 |
| `GET /rooms/{slug}/members/{userId}/deactivate-preview` | `member_deactivate_preview` | — | `{ tasks: { nodeId, title, roundLabel, currentAssignees: Person[] }[] }` | 그룹장, ACTIVE |
| `POST /rooms/{slug}/members/{userId}/deactivate` | `member_deactivate` | `{ decisions: { nodeId, action: "exclude"\|"reassign", assigneeIds?: string[] }[] }` | `MembershipResult` | 그룹장, ACTIVE |
| `GET /rooms/{slug}/invite` | `invite_get` | — | `{ token, url }` (없으면 생성) | 그룹장 |
| `POST /rooms/{slug}/invite/rotate` | `invite_rotate` | — | `{ token, url }` | 그룹장 |
| `GET /invite/{token}` | `invite_preview` | — | `InvitePreview` | 공개 |
| `POST /invite/{token}/join` | `invite_join` | — | `MembershipResult`(join_mode 에 따라 참가/신청) | 로그인 |

```ts
type MembershipResult = { me: RoomDetail["me"]; memberCount: number; members: RoomDetail["members"]; pendingCount: number };
type InvitePreview = { room: { slug, title, intro, startDate, endDate, memberCount, maxMembers, status, isPublic, joinMode, tags }, leader: Person, me: RoomDetail["me"] };
```
CTA 결정 순서(프론트 `actionOf`): 비로그인→login · leader→owner · active&recruit→leave · active&(active|ended)→joined · pending→pending · ended→ended · active→activeClosed · full→full · approval→apply · direct→join.

## 4. 커리큘럼

| METHOD path | RPC | 인자 | 응답 | 권한 |
|---|---|---|---|---|
| `GET /rooms/{slug}/curriculum?includeArchived=true` | `curriculum_get` | — | `Curriculum` | 공개(비로그인은 `people: []`) / 비공개: 멤버 |
| `POST /rooms/{slug}/curriculum/nodes` | `node_create` | `{ parentId: string\|null, title?, label?, taskType?, startDate?, endDate?, index? }` | `Curriculum`(전체 재조회) | 그룹장, 편집 가능 상태 |
| `PATCH …/nodes/{nodeId}` | `node_update` | `{ title?, descriptionMd?, startDate?, endDate?, label?, taskType?, assigneeIds?: string[] }` | `Curriculum` + `warnings[]` | 그룹장 |
| `POST …/nodes/{nodeId}/move` | `node_move` | `{ parentId: string\|null, index: number }` | `Curriculum` | 그룹장 |
| `DELETE …/nodes/{nodeId}` | `node_delete` | — | `Curriculum` / 409 `NODE_HAS_SUBMISSIONS` | 그룹장 |
| `POST …/nodes/{nodeId}/archive` / `unarchive` | `node_archive / node_unarchive` | — | `Curriculum` | 그룹장 |

```ts
type Curriculum = {
  room: { slug: string; status: RoomStatus; leaderDoesTasks: boolean };
  members: (Person & { role: "leader"|"member"; status: "active"|"inactive"; doesTasks: boolean })[];
  nodes: NodeDto[];                       // 전위(pre-order), sort_order 순 — 프론트 buildTree 입력
  stats: { overallPct: number | null; leafCount: number; unassignedCount: number };
};
type NodeDto = {
  id: string; parentId: string | null; roundId: string; depth: number; sortOrder: number;
  label: string | null; title: string; descriptionMd: string; startDate: string; endDate: string; archived: boolean;
  task: { type: TaskType; people: (Person & { status: TaskStatus })[]; assigned: number; submitted: number;
          state: "unassigned"|"complete"|"planned"|"delayed"|"progress" } | null;   // 리프만
  assigned: number; submitted: number; pct: number | null;                         // 부모는 Σ
};
```
기본값: 하위 노드 생성 시 `title="새 과제"`, `taskType=common`, 기간=부모 기간, 맨 뒤. 회차 생성 시 `title="새 회차"`, `label="{n}주차"`, `start=마지막 회차 end+1`, `end=start+6`.
`warnings` code: `PERIOD_OUTSIDE_PARENT`, `PERIOD_OUTSIDE_ROOM`, `UNASSIGNED_TASK`.

## 5. 과제 · 제출 · 파일

| METHOD path | RPC | 인자 | 응답 | 권한 |
|---|---|---|---|---|
| `GET /rooms/{slug}/tasks/{nodeId}` | `task_get` | — | `TaskDetail` | 멤버(비로그인·비멤버: 제출물 제외 메타만, 공개 방) |
| `PUT /rooms/{slug}/tasks/{nodeId}/submissions/me` | `submission_upsert` | `{ bodyMd, links: string[], fileIds: string[] }` | `Submission` | 담당자, ACTIVE, `today ≥ startDate` |
| `POST /rooms/{slug}/tasks/{nodeId}/attachments/presign` | `(Storage `upload` 직접 — 경로 규칙 D10)` | `{ fileName, size, contentType }` | `{ fileId, uploadUrl, headers, expiresInSec: 300 }` | 담당자 |
| `POST /rooms/{slug}/tasks/{nodeId}/attachments/{fileId}/complete` | `file_register` | — | `FileMeta` | 파일 소유자 |
| `GET /files/{fileId}/url` | `(Storage `createSignedUrl(path, 300)`)` | — | `{ url, expiresInSec: 300 }` | 같은 방 멤버 |

```ts
type TaskDetail = { node: NodeDto; path: { id: string; title: string; label: string | null }[];   // 방 › 회차 › … › 과제
  mySubmission: Submission | null; isAssignee: boolean; allSubmitted: boolean;
  submissions: (Submission & { author: Person })[] };                                           // 멤버만
type Submission = { id: string; bodyMd: string; links: string[]; files: FileMeta[]; firstSubmittedAt: string; isLate: boolean; updatedAt: string };
type FileMeta = { id: string; name: string; contentType: string; size: number; status: "pending"|"ready" };
```
> plan 04 구현 메모: 객체 키 확장자는 **소문자**(`[a-z0-9]{1,10}`)여야 한다 — 프론트가 키를 만들 때 소문자로 바꾼다(`photo.PNG` → `….png`). `file_register` 는 Storage 메타의 mimetype 을 우선 저장(화이트리스트 통과 후). 같은 fileId 재등록은 object_path 가 같을 때만 갱신. `links` 에 null/비문자열 원소 → `INVALID_LINK {index}`. 제출·파일 등록은 방 잠금(`room_lock`)으로 직렬화된다.

## 6. 내 스터디 · 내 일정

| METHOD path | RPC | 인자 | 응답 | 권한 |
|---|---|---|---|---|
| `GET /me/studies` | `me_studies` | — | `{ groups: { kind: "active"\|"recruit"\|"ended"; items: StudyItem[] }[] }` | 로그인 |
| `GET /me/schedule?from&to` | `me_schedule` | `to-from ≤ 62일` | `ScheduleResponse` | 로그인 |

```ts
type StudyItem = { slug: string; title: string; intro: string; membership: "leader"|"joined"|"pending";
  when: { kind: "deadline"|"start"|"end"; date: string } };      // left = diffDays(today, date) 는 프론트
type ScheduleResponse = {
  studies: { slug: string; title: string; membership: "leader"|"joined"|"pending"; tone: Tone; status: RoomStatus; startDate: string; endDate: string }[];
  tasks:    ScheduleTask[];          // 창과 겹치는 내 담당 리프 (+PENDING 방은 전체 리프)
  markers:  { date: string; slug: string; round: string }[];
  upcoming: ScheduleTask[];          // today ~ today+7, st ∈ {open, planned}, e ASC
};
type ScheduleTask = { id: string; slug: string; title: string; s: string; e: string; st: TaskStatus | null; round: string };
```
사이드바 그룹 규칙: active = ACTIVE 방 & (ACTIVE 멤버|그룹장) · recruit = RECRUIT|DRAFT 방 & (ACTIVE|PENDING|그룹장) · ended = ENDED 방. 보관 제외. `when`: active → 내 다음 마감(OPEN 중 최소 e, 없으면 방 end) · recruit → start · ended → end.
방 `tone` 은 방 생성 시 `id % 6` 순환.

## 7. 태그 · 알림 · 설정

| METHOD path | RPC | 인자 | 응답 | 권한 |
|---|---|---|---|---|
| `GET /tags?q=` | `tags_search` | — | `{ items: RoomTag[] }`(상위 20, usage_count DESC) | 공개 |
| `GET /rooms/{slug}/tags` | `room_tags_get` | — | `{ items: RoomTag[] }` | 공개/멤버 |
| `PUT /rooms/{slug}/tags` | `room_tags_put` | `{ slugs: string[], freeLabels: string[] }` | `{ items: RoomTag[] }` | 그룹장 (≤ 8) |
| `POST /rooms/{slug}/tags/suggest` | `(Edge Function `suggest-tags` 또는 `tag_autoselect`)` | — | `202 { jobId }` | 그룹장 |
| `GET /notifications?cursor&limit=20` | `notifications_list` | — | `{ items: Notification[]; nextCursor: string \| null }` | 로그인 |
| `GET /notifications/unread-count` | `notifications_unread_count` | — | `{ count }` | 로그인 |
| `POST /notifications/{id}/read` | `notifications_read` | — | 204 | 본인 |
| `POST /notifications/read-all` | `notifications_read_all` | — | `{ updated }` | 로그인 |
| `GET /rooms/{slug}/notification-settings` | `settings_get` | — | `NotificationSettings` | 그룹장 |
| `PUT /rooms/{slug}/notification-settings` | `settings_put` | `NotificationSettings` | 동일 | 그룹장 |

```ts
type Notification = { id: string; kind: NotificationKind; title: string; body: string | null;
  room: { slug: string; title: string } | null; link: string; actor: Person | null; createdAt: string; readAt: string | null };
type NotificationKind = "ROUND_STARTED"|"TASK_ALL_SUBMITTED"|"TASK_COMPLETION_DIGEST"|"JOIN_REQUESTED"|"JOIN_APPROVED"|"JOIN_REJECTED"|"JOIN_EXPIRED"
  |"DEADLINE_REMINDER"|"TASK_ASSIGNED"|"TASK_UNASSIGNED"|"SCHEDULE_CHANGED"|"ROOM_STARTED"|"ROOM_ENDED"|"ROOM_START_BLOCKED"|"MEMBER_DEACTIVATED";
type NotificationSettings = { reminderD1: boolean; reminderD3: boolean; taskAssigned: boolean; scheduleChanged: boolean; roomStartEnd: boolean; completionMode: "daily"|"immediate" };
```
> plan 04 구현 메모:
> - `tags_search` 는 CURATED 태그 + **호출자가 읽을 수 있는 방에서 쓰인** CUSTOM 태그만 돌려준다(비공개 방 라벨 비노출). 자동 선택(`tag_autoselect`)은 CURATED 만.
> - `room_tags_suggest` 의 SQL 경로는 동기 `{ today, items }` 를 돌려준다(위 표의 `202 { jobId }` 는 Edge Function 경로 — 미구현). plan 05 어댑터는 SQL 응답을 쓴다.
> - `Notification.room` 은 수신자가 그 방을 더 읽을 수 없으면 `null`(title/body 는 생성 시점 스냅샷).
> - 행위성 알림(JOIN_*, TASK_ASSIGNED/UNASSIGNED, SCHEDULE_CHANGED)의 txid 접미는 **호출자**가 붙인다; `notify_publish` 는 prefix 뒤에 `:<recipient>` 만 붙인다.
> - 한 저장에서 담당 추가 + 기간 변경이면 TASK_ASSIGNED 와 SCHEDULE_CHANGED 가 각각 나간다(설정 토글이 kind 별로 독립). SCHEDULE_CHANGED 수신자 = 현재 리프 담당자(활성 참가자 전원 아님). 방 기간 변경(`room_update`) 알림은 미구현 — 후속 과제.
> - `notifications_list` 의 잘못된 커서 → `VALIDATION_FAILED`.

## 8. 스케줄 작업

`02-domain-and-schema.md` §7(pg_cron) 참조. 잡 함수와 조건·효과는 거기에 고정.
