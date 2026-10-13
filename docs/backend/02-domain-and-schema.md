# 도메인 모델 · 스키마 (Supabase 마이그레이션)

> `01-decisions.md` 를 전제로 한 **단일 스키마 출처**. 구현 계획의 모든 태스크는 여기 컬럼명을 그대로 쓴다.
> 파일 위치: `supabase/migrations/0001_schema.sql`(§2) · `0002_functions_core.sql`(공통 헬퍼) · `0003_rls.sql`(§5) · `0004_rooms.sql` · `0005_membership.sql` · `0006_curriculum.sql` · `0007_submissions.sql` · `0008_notifications.sql` · `0009_tags.sql` · `0010_cron.sql`(§7) · `seed.sql`(§8). 함수 배치는 §6.
> 날짜 컬럼(`*_date`)은 KST 달력일 `DATE`, 시각 컬럼(`*_at`)은 `TIMESTAMPTZ`.

## 1. ERD (텍스트)

```
auth.users 1───1 profiles 1───* room_members *───1 rooms 1───* goal_nodes (self: parent_id, round_id)
profiles 1───* task_assignments *───1 goal_nodes(leaf)
profiles 1───* submissions      *───1 goal_nodes(leaf)      submissions 1───* submission_links
files = storage.objects 메타 (public.files 가 submission 연결)
rooms 1───1 room_notification_settings
rooms 1───* room_invites
rooms *───* tags  (room_tags, room_tag_suppressions)
profiles 1───* notifications    (room_id, node_id, actor_user_id nullable)
(인증 테이블은 Supabase Auth 소유 — email OTP·세션·refresh 는 auth 스키마)
mail_outbox
```

## 2. 0001_schema.sql

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- pg_cron 은 Supabase 대시보드(Database → Extensions)에서 켜거나 0010_cron.sql 에서 `create extension if not exists pg_cron;` (이 한 형태만 — PGlite 하네스가 이 문장을 걷어낸다)

-- ───────── profiles (auth.users 1:1) ─────────
-- 이메일·OTP·세션은 auth 스키마(Supabase Auth)가 소유한다. 앱이 쓰는 사용자 정보만 여기.
CREATE TABLE profiles (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                 CITEXT NOT NULL,                     -- auth.users.email 복사(조인 회피). 트리거로 동기화
  nickname              VARCHAR(16),                        -- NULL = 온보딩 미완료
  nickname_normalized   VARCHAR(32) UNIQUE,                 -- NFC + lower
  avatar_tone           VARCHAR(8)  NOT NULL,               -- mint|blue|peach|lav|amber|slate
  optional_mail_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at         TIMESTAMPTZ
);
-- auth.users INSERT 시 profiles 행 자동 생성 (avatar_tone = 6색 중 uuid 해시)
CREATE OR REPLACE FUNCTION handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (id, email, avatar_tone)
  VALUES (NEW.id, NEW.email,
          (ARRAY['mint','blue','peach','lav','amber','slate'])[1 + (abs(hashtext(NEW.id::text)) % 6)])
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- ───────── rooms ─────────
CREATE TABLE rooms (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug               VARCHAR(60)  NOT NULL UNIQUE,
  title              VARCHAR(60)  NOT NULL,
  intro              VARCHAR(100) NOT NULL,
  description_md     TEXT         NOT NULL DEFAULT '',
  rules_md           TEXT         NOT NULL DEFAULT '',
  start_date         DATE         NOT NULL,
  end_date           DATE         NOT NULL,
  max_members        INT          NOT NULL,
  min_members        INT,
  visibility         VARCHAR(8)   NOT NULL,                -- PUBLIC|PRIVATE
  join_mode          VARCHAR(8)   NOT NULL,                -- DIRECT|APPROVAL
  leader_id          UUID        NOT NULL REFERENCES profiles(id),
  leader_does_tasks  BOOLEAN      NOT NULL DEFAULT TRUE,
  cover_file_id      UUID,                                 -- files.id (FK 는 files 생성 후 추가)
  status             VARCHAR(8)   NOT NULL DEFAULT 'DRAFT',-- DRAFT|RECRUIT|ACTIVE|ENDED
  member_count       INT          NOT NULL DEFAULT 1,      -- ACTIVE 멤버 수(그룹장 포함), 원자 증감
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  archived_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_rooms_period  CHECK (start_date <= end_date),
  CONSTRAINT ck_rooms_members CHECK (max_members BETWEEN 2 AND 100 AND (min_members IS NULL OR min_members BETWEEN 1 AND max_members)),
  CONSTRAINT ck_rooms_count   CHECK (member_count >= 0 AND member_count <= max_members)
);
CREATE INDEX ix_rooms_public_status ON rooms (visibility, status) WHERE archived_at IS NULL;
CREATE INDEX ix_rooms_title_trgm    ON rooms USING gin (title gin_trgm_ops);

CREATE TABLE room_members (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id     BIGINT      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES profiles(id),
  role        VARCHAR(8)  NOT NULL,                        -- LEADER|MEMBER
  status      VARCHAR(10) NOT NULL,                        -- ACTIVE|PENDING|REJECTED|CANCELED|EXPIRED|INACTIVE
  applied_at  TIMESTAMPTZ,
  joined_at   TIMESTAMPTZ,                                 -- ACTIVE 전환 시각 ("참가 확정 순")
  decided_at  TIMESTAMPTZ,
  decided_by  UUID        REFERENCES profiles(id),
  left_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE INDEX ix_room_members_user ON room_members (user_id, status);
CREATE INDEX ix_room_members_room ON room_members (room_id, status);

CREATE TABLE room_invites (
  token       VARCHAR(32) PRIMARY KEY,                     -- base64url(128bit)
  room_id     BIGINT      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by  UUID        NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX ux_room_invites_active ON room_invites (room_id) WHERE revoked_at IS NULL;

-- ───────── curriculum ─────────
CREATE TABLE goal_nodes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id         BIGINT      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id       BIGINT      REFERENCES goal_nodes(id) ON DELETE CASCADE,   -- NULL = 회차(depth 2)
  round_id        BIGINT      REFERENCES goal_nodes(id),                     -- depth-2 조상(회차 자신이면 자기 id). 저장 시 서비스가 채움
  depth           SMALLINT    NOT NULL,                                      -- 2..5
  sort_order      INT         NOT NULL,
  label           VARCHAR(20),                                               -- 회차 라벨, depth=2 만
  title           VARCHAR(80) NOT NULL,
  description_md  TEXT        NOT NULL DEFAULT '',
  start_date      DATE        NOT NULL,
  end_date        DATE        NOT NULL,
  task_type       VARCHAR(10),                                               -- COMMON|DESIGNATED, 리프만
  archived_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_goal_nodes_depth  CHECK (depth BETWEEN 2 AND 5),
  CONSTRAINT ck_goal_nodes_period CHECK (start_date <= end_date),
  CONSTRAINT ck_goal_nodes_root   CHECK ((parent_id IS NULL) = (depth = 2)),
  CONSTRAINT ck_goal_nodes_type   CHECK (task_type IS NULL OR task_type IN ('COMMON','DESIGNATED'))
);
CREATE INDEX ix_goal_nodes_room_parent ON goal_nodes (room_id, parent_id, sort_order);
CREATE INDEX ix_goal_nodes_room_dates  ON goal_nodes (room_id, start_date, end_date);
CREATE INDEX ix_goal_nodes_round       ON goal_nodes (round_id);

CREATE TABLE task_assignments (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id      BIGINT      NOT NULL REFERENCES goal_nodes(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES profiles(id),
  source       VARCHAR(10) NOT NULL,                       -- COMMON|DESIGNATED
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at  TIMESTAMPTZ,                                -- NULL = 유효(집계 포함)
  UNIQUE (node_id, user_id)
);
CREATE INDEX ix_task_assignments_user ON task_assignments (user_id) WHERE released_at IS NULL;

CREATE TABLE submissions (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id            BIGINT      NOT NULL REFERENCES goal_nodes(id),
  user_id            UUID        NOT NULL REFERENCES profiles(id),
  body_md            TEXT        NOT NULL DEFAULT '',
  first_submitted_at TIMESTAMPTZ NOT NULL,                 -- 불변
  is_late            BOOLEAN     NOT NULL,                 -- 불변
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, user_id)
);

CREATE TABLE submission_links (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id  BIGINT        NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  url            VARCHAR(2000) NOT NULL,
  sort_order     INT           NOT NULL
);

-- ───────── files ─────────
CREATE TABLE files (
  id             UUID PRIMARY KEY,
  owner_user_id  UUID        NOT NULL REFERENCES profiles(id),
  room_id        BIGINT       REFERENCES rooms(id) ON DELETE SET NULL,
  node_id        BIGINT       REFERENCES goal_nodes(id) ON DELETE SET NULL,
  submission_id  BIGINT       REFERENCES submissions(id) ON DELETE SET NULL,
  purpose        VARCHAR(12)  NOT NULL,                    -- ATTACHMENT|COVER
  bucket_id      TEXT         NOT NULL DEFAULT 'attachments',
  object_path    TEXT         NOT NULL UNIQUE,            -- storage.objects.name
  original_name  VARCHAR(255) NOT NULL,
  content_type   VARCHAR(100) NOT NULL,
  size_bytes     BIGINT       NOT NULL,
  status         VARCHAR(8)   NOT NULL DEFAULT 'PENDING',  -- PENDING|READY|DELETED
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX ix_files_submission ON files (submission_id) WHERE status = 'READY';
ALTER TABLE rooms ADD CONSTRAINT fk_rooms_cover FOREIGN KEY (cover_file_id) REFERENCES files(id) ON DELETE SET NULL;

-- ───────── tags ─────────
CREATE TABLE tags (
  slug         VARCHAR(40) PRIMARY KEY,
  label        VARCHAR(20) NOT NULL UNIQUE,
  tone         VARCHAR(8)  NOT NULL,
  aliases      TEXT[]      NOT NULL DEFAULT '{}',
  kind         VARCHAR(8)  NOT NULL DEFAULT 'CURATED',    -- CURATED|CUSTOM
  usage_count  INT         NOT NULL DEFAULT 0
);
CREATE TABLE room_tags (
  room_id     BIGINT      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  tag_slug    VARCHAR(40) NOT NULL REFERENCES tags(slug),
  source      VARCHAR(8)  NOT NULL,                        -- AUTO|MANUAL
  sort_order  INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, tag_slug)
);
CREATE INDEX ix_room_tags_tag ON room_tags (tag_slug);
CREATE TABLE room_tag_suppressions (
  room_id   BIGINT      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  tag_slug  VARCHAR(40) NOT NULL REFERENCES tags(slug),
  PRIMARY KEY (room_id, tag_slug)
);

-- ───────── notifications ─────────
CREATE TABLE notifications (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind           VARCHAR(32)  NOT NULL,
  title          VARCHAR(200) NOT NULL,
  body           VARCHAR(500),
  room_id        BIGINT       REFERENCES rooms(id) ON DELETE SET NULL,
  node_id        BIGINT       REFERENCES goal_nodes(id) ON DELETE SET NULL,
  actor_user_id  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  link           VARCHAR(300) NOT NULL,
  dedupe_key     VARCHAR(160) UNIQUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  read_at        TIMESTAMPTZ
);
CREATE INDEX ix_notifications_user_unread ON notifications (user_id, id DESC) WHERE read_at IS NULL;
CREATE INDEX ix_notifications_user        ON notifications (user_id, id DESC);

CREATE TABLE room_notification_settings (
  room_id           BIGINT      PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  reminder_d1       BOOLEAN     NOT NULL DEFAULT TRUE,
  reminder_d3       BOOLEAN     NOT NULL DEFAULT TRUE,
  task_assigned     BOOLEAN     NOT NULL DEFAULT TRUE,
  schedule_changed  BOOLEAN     NOT NULL DEFAULT TRUE,
  room_start_end    BOOLEAN     NOT NULL DEFAULT TRUE,
  completion_mode   VARCHAR(16) NOT NULL DEFAULT 'DAILY_DIGEST'  -- DAILY_DIGEST|IMMEDIATE
);

CREATE TABLE mail_outbox (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  to_email     CITEXT      NOT NULL,
  template     VARCHAR(40) NOT NULL,
  model        JSONB       NOT NULL,
  status       VARCHAR(8)  NOT NULL DEFAULT 'PENDING',    -- PENDING|SENT|FAILED
  attempts     SMALLINT    NOT NULL DEFAULT 0,
  next_try_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

```

## 3. 불변식 (서비스 계층이 보장, DB CHECK 로 못 거는 것)

| # | 불변식 | 검사 시점 | 위반 코드 |
|---|---|---|---|
| I1 | `goal_nodes` 자식이 있으면 `task_type IS NULL` 이고 `task_assignments` 없음(released 제외) | `node_create`·`node_move` | `NODE_HAS_SUBMISSIONS`(제출물 있는 리프를 부모로 바꿀 때) |
| I2 | 리프(자식 0 & 생성 시 리프로 만든 노드)는 `task_type NOT NULL` | 생성·타입 변경 | `NODE_NOT_LEAF` |
| I3 | `depth` = 부모 depth + 1, 서브트리 최대 depth ≤ 5 | `node_create`·`node_move` | `NODE_DEPTH_EXCEEDED` |
| I4 | `round_id` = 자기 depth-2 조상(회차는 자기 자신) | 생성·이동 시 서브트리 갱신 | — |
| I5 | 보관 노드의 하위는 전부 보관(`archived_at` 전파), 부모 보관 중이면 자식 해제 불가 | archive/unarchive | `PARENT_ARCHIVED` |
| I6 | 제출물 있는 리프: 삭제·타입 변경·해당 담당자 제거 불가 | delete·PATCH | `NODE_HAS_SUBMISSIONS`, `ASSIGNEE_HAS_SUBMISSION` |
| I7 | `rooms.member_count` = `COUNT(room_members WHERE status='ACTIVE')` | 원자 증감 + 야간 `member_count_audit()` 보정 | `ROOM_FULL` |
| I8 | `task_assignments` 는 D4 규칙과 일치 | 멤버십·노드 쓰기 함수 끝에서 `assignment_resync(room_id)` | — |
| I9 | `submissions.first_submitted_at/is_late` 불변 | BEFORE UPDATE 트리거가 두 컬럼 변경을 거부 | — |
| I10 | 한 방에 활성 초대 토큰 1개 | partial unique index | — |
| I11 | `rooms.slug` 는 생성 후 불변 | `room_update()` 가 받지 않음 | `FIELD_LOCKED` |

## 4. 파생 규칙 (SQL 스케치)

### 4.1 리프별 asg/sub (한 방 전체)
```sql
SELECT n.id AS node_id, n.round_id, n.parent_id,
       COUNT(a.id)                                   AS asg,
       COUNT(s.id)                                   AS sub
FROM goal_nodes n
LEFT JOIN task_assignments a ON a.node_id = n.id AND a.released_at IS NULL
LEFT JOIN submissions s      ON s.node_id = n.id AND s.user_id = a.user_id
WHERE n.room_id = :roomId AND n.task_type IS NOT NULL AND n.archived_at IS NULL
GROUP BY n.id;
```
부모 합산은 `WITH RECURSIVE` 로 조상 경로를 펼쳐 `GROUP BY ancestor_id` (노드 수 ≤ 수백).

### 4.2 사람별 코드 (리프 × 담당자)
```sql
SELECT a.node_id, a.user_id, u.nickname, u.avatar_tone,
       s.first_submitted_at, s.is_late
FROM task_assignments a
JOIN users u ON u.id = a.user_id
LEFT JOIN submissions s ON s.node_id = a.node_id AND s.user_id = a.user_id
WHERE a.released_at IS NULL AND a.node_id IN (:leafIds)
ORDER BY a.node_id, a.assigned_at;
```
`code` 는 `task_code(s, e, first_submitted_at, is_late, today)` SQL 함수(D5, IMMUTABLE).

### 4.3 방 목록 집계(카드 1장당 서브쿼리 금지)
한 번의 쿼리로 `rooms` 페이지를 뽑은 뒤, 그 id 집합에 대해 (a) 내 멤버십, (b) 내 담당 리프 asg/sub + 다음 마감, (c) 회차 수·현재 회차, (d) 팀 asg/sub, (e) 태그 를 각각 **IN (:roomIds) 1회씩** 조회해 `jsonb_agg` 로 합친다(함수 `rooms_list()` 내부 CTE 6개, 왕복 1회).

### 4.4 내 일정
schedule 분석 §5 쿼리 그대로. 단 `task_assignments a ... a.released_at IS NULL` 조건 추가, PENDING 방은 배정이 없으므로 `OR m.status='PENDING'` 로 전체 리프 미리보기.

## 5. RLS 정책 (`0003_rls.sql`)

모든 public 테이블 `ENABLE ROW LEVEL SECURITY`. **쓰기는 전부 RPC(SECURITY DEFINER)** 이므로 INSERT/UPDATE/DELETE 정책은 만들지 않는다(= 전부 거부). 아래는 SELECT 정책만.

헬퍼(STABLE, SECURITY DEFINER, `search_path=public`):
```sql
current_user_id()              → auth.uid()
is_room_member(room_id)        → EXISTS room_members(user=uid, status IN ('ACTIVE','INACTIVE','PENDING'))
is_room_leader(room_id)        → rooms.leader_id = uid
can_read_room(room_id)         → NOT archived AND (visibility='PUBLIC' AND status<>'DRAFT')  OR is_room_member OR is_room_leader
can_read_submissions(room_id)  → is_room_leader OR EXISTS room_members(uid, status IN ('ACTIVE','INACTIVE'))
```

| 테이블 | SELECT 허용 |
|---|---|
| profiles | 본인 전체. 타인은 `id, nickname, avatar_tone` 만 → 뷰 `public_profiles` 로 노출(이메일 비노출) |
| rooms | `can_read_room(id)` |
| room_members | `can_read_room(room_id)` AND (status IN ('ACTIVE','INACTIVE') OR user_id = uid OR is_room_leader(room_id)) — 타인 PENDING 은 그룹장만 |
| room_invites | `is_room_leader(room_id)` (미리보기는 `invite_preview()` 함수) |
| goal_nodes | `can_read_room(room_id)` |
| task_assignments | `can_read_room(room_id via node)` — 상태 아이콘은 공개 방이면 공개(디자인 §2.1 읽기 전용) |
| submissions, submission_links, files | `can_read_submissions(room_id)` AND (node 미보관 OR is_room_leader OR user_id = uid) |
| tags | 전체 공개 |
| room_tags | `can_read_room(room_id)` |
| room_tag_suppressions, room_notification_settings | `is_room_leader(room_id)` |
| notifications | `user_id = uid` |
| mail_outbox | 없음(service_role 만) |

Storage 버킷 `attachments`(private, `file_size_limit=10485760`, `allowed_mime_types` = D10 목록):
- INSERT: `authenticated` AND 키가 `^\d+/\d+/<uuid>/[^/]+$` 형식 AND 3번째 세그먼트 = `auth.uid()` AND `is_task_assignee(node_id, uid)` AND 1번째 세그먼트 = 그 노드의 `room_id`(교차 방 업로드·비숫자 세그먼트 차단, 구현 리뷰 반영 2026-10-13)
- SELECT: `can_read_submission(node_id, author)` (path 2·3번째 세그먼트) — 보관 노드 첨부는 제출물과 같이 그룹장·작성자만(D10)
- DELETE: 소유자 본인

## 6. 함수 목록 — 시그니처는 `03-api.md` 가 출처, 파일은 도메인별(0002~0009)

| 구분 | 함수 | 성격 |
|---|---|---|
| 공통(0002) | `current_user_id()`, `require_user()`, `kst_today()`, `kst_deadline(date)`, `fail()`, `iso()`, `person_json()`, `slugify()` | `app.today`/`app.uid` 설정이 있으면 그 값(PGlite 테스트) |
| 상태 | `task_code(...)`, `leaf_state(...)`, `pct(asg, sub)` | IMMUTABLE 순수 함수 |
| 동기화 | `assignment_resync(room_id)` | SECURITY DEFINER, 멱등 |
| 알림 | `notify_publish(kind, room_id, node_id, actor, recipients uuid[], dedupe_prefix, model jsonb)` | 설정 필터 + dedupe |
| 방 | `room_create`, `room_update`, `room_open_recruit`, `room_start`, `room_archive`, `room_unarchive`, `room_delete`, `room_transition_active(room_id, actor)`, `room_transition_ended(room_id)` | 쓰기 |
| 멤버십 | `room_join`, `room_apply`, `room_leave`, `room_cancel_application`, `room_approve`, `room_reject`, `member_deactivate_preview`, `member_deactivate`, `invite_get`, `invite_rotate`, `invite_preview`, `invite_join` | 쓰기/읽기 |
| 커리큘럼 | `node_create`, `node_update`, `node_move`, `node_delete`, `node_archive`, `node_unarchive`, `curriculum_get(slug, include_archived)` | 쓰기 + 읽기 JSON |
| 제출 | `submission_upsert`, `task_get(slug, node_id)`, `file_register(node_id, path, name, mime, size)` | |
| 읽기 | `rooms_list(scope, status, q, tags, page, size, sort)`, `room_get(slug, invite_token)`, `me_get`, `me_update`, `nickname_check`, `me_studies`, `me_schedule(from, to)`, `notifications_list(cursor, limit)`, `notifications_unread_count`, `notifications_read(id)`, `notifications_read_all`, `settings_get`, `settings_put`, `tags_search(q)`, `room_tags_get`, `room_tags_put`, `tag_autoselect(room_id)`, `tag_apply_auto(room_id, slugs[])` | JSON |
| 잡 | `room_tick()`, `job_draft_blocked()`, `job_round_started()`, `job_deadline_reminder()`, `job_completion_digest()`, `job_cleanup()`, `member_count_audit()` | pg_cron 호출 |

트리거: `profiles` 생성(§2), `submissions` 불변 컬럼 보호(I9), `goal_nodes` BEFORE INSERT/UPDATE 에서 `depth = 부모 depth + 1`·`round_id` 일치·`label` 은 depth 2 만 검사(0006, 직접 INSERT 경로 방어), `rooms.updated_at`/`goal_nodes.updated_at` 갱신.

## 7. pg_cron (`0010_cron.sql`) — UTC 로 환산

| job | cron(UTC) | KST | 호출 |
|---|---|---|---|
| room_tick | `*/5 * * * *` | 5분 | `room_tick()` (RECRUIT→ACTIVE, ACTIVE→ENDED) |
| draft_blocked | `5 15 * * *` | 00:05 | `job_draft_blocked()` |
| round_started | `1 15 * * *` | 00:01 | `job_round_started()` |
| deadline_reminder | `0 0 * * *` | 09:00 | `job_deadline_reminder()` |
| completion_digest | `0 0 * * *` | 09:00 | `job_completion_digest()` |
| cleanup | `0 19 * * *` | 04:00 | `job_cleanup()` |
| member_count_audit | `30 19 * * *` | 04:30 | `member_count_audit()` |

## 8. 시드 데이터 (`supabase/seed.sql`, 로컬·테스트 전용)

목업(`src/data/*.ts`)과 **숫자가 일치**하도록 구성한다. 기준일은 pgTAP 에서 `set_config('app.today','2026-10-12',true)` 로 고정(`kst_today()` 가 이 설정을 우선 읽음).

| 대상 | 내용 |
|---|---|
| auth.users + profiles | 고정 UUID 로 `auth.users` 에 직접 INSERT(로컬 전용) → 트리거가 profiles 생성 후 nickname UPDATE. `src/lib/palette.ts` NAME_TONE 의 29명 전부, `avatar_tone` 동일 |
| rooms | slug = toeic, cs, sqld, docker, jcg, aws, react, algo, spring (9개). 상태·기간·정원·공개·참가방식은 `src/data/rooms.ts` 값. docker 는 `member_count=1` |
| room_members | aws: 민수(LEADER)·지은·철수·하나 ACTIVE, 도윤 INACTIVE. sqld: 가은 LEADER, 철수 PENDING. docker: 철수 LEADER. algo/spring: 목업 멤버 |
| goal_nodes | `src/data/my-study.ts` PLANS 트리 그대로(aws 5회차, spring 4, sqld 4, algo 13). `round_id` 채움 |
| task_assignments | 시드 끝에서 `SELECT assignment_resync(id) FROM rooms` + 지정 과제 명시 행 |
| submissions | 목업 `codes` 의 D/L 을 제출로 변환. L 은 `first_submitted_at = end_date + 1일 09:00 KST`, D 는 `end_date 18:00 KST` |
| tags | 목업 태그 19개 + tone |
| notifications | 철수에게 3건(unread) |

회귀 테스트 기대값: aws overall 24%, 1주차 5/8, spring 34%, algo 87%, sqld null(`leader_does_tasks=false`), 철수 aws 내 진척률 **2/6=33%**(방 목록 슬롯·참가자 통계 동일, D5), 민수 2/5·지은 2/7·하나 0/7, 철수 aws 다음 마감 EC2 10/14(OPEN 만).

로컬·테스트 전용 고정 기준일: `seed.sql` 끝에 `insert into internal.settings (key, value) values ('today', '2026-10-12') on conflict (key) do update set value = excluded.value;` 를 넣어 `kst_today()` 가 항상 2026-10-12 를 돌려주게 한다(E2E 가 실제 날짜에 따라 깨지지 않게). 호스팅 프로젝트에는 적용하지 않는다(`supabase db push` 는 seed 를 보내지 않음).
