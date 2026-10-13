-- 02-domain-and-schema.md §2 원문. 배포 후 수정 금지(변경은 다음 번호 마이그레이션).
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

