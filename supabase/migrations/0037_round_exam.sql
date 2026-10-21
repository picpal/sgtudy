-- 0037_round_exam.sql — 2026-10-21 회차 시험(수동 출제 · AI 초안). 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-21-round-exam-design.md (D1~D14).
-- 추가형: 표 4개 + 트리거 3개(goal_nodes·submissions·files) + RPC + 재정의 7개(최신 판 복사). 리프는 COMMON/DESIGNATED 그대로(D1), 제출 = submissions 1행(D2).
-- 재정의 원본: curriculum_json ←0032 · task_node_json ←0024 · notification_kinds·notify_render·notify_link ←0034 · api_scope_of ←0033 · api_invoke ←0035
-- 절: 1 스키마 · 2 가드 트리거 · 3 계약 검증 · 4 출제 RPC · 5 응시 · 6 편집자 결과 · 7 트리 JSON 재정의 · 8 AI 통로 · 9 알림 종류

-- ───────── 1. 스키마 ─────────
create table public.exams (
  node_id        bigint primary key references public.goal_nodes(id) on delete cascade,
  room_id        bigint not null references public.rooms(id) on delete cascade,
  status         varchar(10) not null default 'DRAFT',        -- DRAFT|PUBLISHED
  reveal         varchar(16) not null default 'AFTER_SUBMIT', -- AFTER_SUBMIT|AFTER_DEADLINE (D4)
  source         varchar(8)  not null default 'MANUAL',       -- MANUAL|AI (마지막으로 문항을 쓴 쪽)
  question_count int         not null default 0,
  total_points   int         not null default 0,
  brief          jsonb,                                       -- AI 브리프 {topic, theory, count, types, difficulty, note} (편집자 전용)
  published_at   timestamptz,
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  constraint ck_exams_status check (status in ('DRAFT', 'PUBLISHED')),
  constraint ck_exams_reveal check (reveal in ('AFTER_SUBMIT', 'AFTER_DEADLINE')),
  constraint ck_exams_source check (source in ('MANUAL', 'AI'))
);
create index ix_exams_room on public.exams (room_id);

create table public.exam_questions (
  id             bigint generated always as identity primary key,
  node_id        bigint not null references public.exams(node_id) on delete cascade,
  ord            int    not null,
  qtype          varchar(8) not null,                         -- SINGLE|MULTI|OX|SHORT (D5)
  prompt_md      text   not null,
  choices        jsonb,                                       -- SINGLE·MULTI: ["…"] 2~8개
  answer         jsonb  not null,                             -- SINGLE: 0 · MULTI: [0,2] · OX: true/false · SHORT: ["허용답", …]
  explanation_md text   not null default '',
  points         int    not null default 1,
  unique (node_id, ord),
  constraint ck_exam_questions_type   check (qtype in ('SINGLE', 'MULTI', 'OX', 'SHORT')),
  constraint ck_exam_questions_points check (points between 1 and 10)
);

create table public.exam_attempts (
  id            bigint generated always as identity primary key,
  node_id       bigint not null references public.exams(node_id) on delete cascade,
  user_id       uuid   not null references public.profiles(id),
  status        varchar(12) not null default 'IN_PROGRESS',   -- IN_PROGRESS|SUBMITTED (D3: 1회)
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  score         int,
  max_score     int,
  correct_count int,
  unique (node_id, user_id),
  constraint ck_exam_attempts_status check (status in ('IN_PROGRESS', 'SUBMITTED'))
);

create table public.exam_answers (
  attempt_id   bigint not null references public.exam_attempts(id) on delete cascade,
  question_id  bigint not null references public.exam_questions(id) on delete cascade,
  answer       jsonb  not null,
  is_correct   boolean,                                       -- exam_submit 만 채운다
  earned       int,
  saved_at     timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

alter table public.exams          enable row level security;
alter table public.exam_questions enable row level security;
alter table public.exam_attempts  enable row level security;
alter table public.exam_answers   enable row level security;
revoke all on public.exams, public.exam_questions, public.exam_attempts, public.exam_answers from anon, authenticated;

-- ───────── 2. 가드 트리거 ─────────
-- 시험 리프는 부모가 될 수 없다(D14) — node_make_parent 가 task_type 을 null 로 바꾸는 순간 막는다
create or replace function public.exams_guard_leaf() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.task_type is null and old.task_type is not null and exists (select 1 from public.exams x where x.node_id = new.id) then
    perform public.fail('EXAM_NODE', '시험 아래에는 항목을 둘 수 없어요', jsonb_build_object('nodeId', new.id::text));
  end if;
  return new;
end $$;
create trigger trg_exams_guard_leaf before update of task_type on public.goal_nodes
  for each row execute function public.exams_guard_leaf();

-- 시험 리프의 submissions 행은 exam_submit 만 만든다(§7-4). 일반 제출·첨부 등록은 EXAM_NODE
-- 우회 불가: sgtudy.exam_submit 은 트랜잭션 로컬 GUC 이고, 클라이언트(PostgREST)는 set_config 를 부를 수 없다(GRANT 된 RPC 만 실행)
create or replace function public.submissions_guard_exam() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.exams x where x.node_id = new.node_id)
     and coalesce(current_setting('sgtudy.exam_submit', true), '') <> '1' then
    perform public.fail('EXAM_NODE', '시험은 문제를 풀어 제출해요', jsonb_build_object('nodeId', new.node_id::text));
  end if;
  return new;
end $$;
create trigger trg_submissions_guard_exam before insert on public.submissions
  for each row execute function public.submissions_guard_exam();

-- file_register 는 submission_target 만 거치고 submissions 를 만들지 않는다 → 시험 리프의 첨부 등록은 files 트리거로 막는다
create or replace function public.files_guard_exam() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.purpose = 'ATTACHMENT' and new.node_id is not null and exists (select 1 from public.exams x where x.node_id = new.node_id) then
    perform public.fail('EXAM_NODE', '시험에는 첨부를 올릴 수 없어요', jsonb_build_object('nodeId', new.node_id::text));
  end if;
  return new;
end $$;
create trigger trg_files_guard_exam before insert on public.files
  for each row execute function public.files_guard_exam();

-- ───────── 3. 계약 검증 (sgtudy.exam/v1, 스펙 §3.2) ─────────
create or replace function public.exam_norm(p text) returns text
language sql immutable set search_path = '' as $$
  -- 구두점을 지운 뒤에도 앞뒤 공백이 남을 수 있어(`IGW .`) 바깥에서 한 번 더 trim
  select trim(regexp_replace(regexp_replace(lower(trim(normalize(coalesce(p, ''), NFC))), '[[:punct:]]', '', 'g'), '\s+', ' ', 'g'))
$$;

-- 문항 배열 정규화. 실패는 VALIDATION_FAILED {field, index}. 반환: [{type, prompt, choices, answer, explanation, points}] (type 대문자)
create or replace function public.exam_validate(p_exam jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$   -- fail() 을 부르므로 volatile 기본값(상수 접기 방지)
declare
  qs    jsonb;
  q     jsonb;
  i     int := 0;
  v_t   text;
  v_c   jsonb;
  v_a   jsonb;
  v_n   int;
  v_p   int;
  v_out jsonb := '[]'::jsonb;
  e     jsonb;
  seen  int[];
begin
  if p_exam is null or jsonb_typeof(p_exam) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '시험 내용이 올바르지 않아요', '{"field":"exam"}'::jsonb);
  end if;
  if p_exam ? 'reveal' and (p_exam ->> 'reveal') not in ('after_submit', 'after_deadline') then
    perform public.fail('VALIDATION_FAILED', '공개 시점은 after_submit 또는 after_deadline 이에요', '{"field":"reveal"}'::jsonb);
  end if;
  qs := coalesce(p_exam -> 'questions', '[]'::jsonb);
  if jsonb_typeof(qs) <> 'array' then perform public.fail('VALIDATION_FAILED', '문항은 배열이어야 해요', '{"field":"questions"}'::jsonb); end if;
  if jsonb_array_length(qs) > 50 then perform public.fail('VALIDATION_FAILED', '문항은 50개까지예요', '{"field":"questions"}'::jsonb); end if;

  for q in select * from jsonb_array_elements(qs) loop
    v_t := case when jsonb_typeof(q) = 'object' then lower(q ->> 'type') end;
    if v_t is null or v_t not in ('single', 'multi', 'ox', 'short') then
      perform public.fail('VALIDATION_FAILED', '문항 유형은 single·multi·ox·short 예요', jsonb_build_object('field', 'type', 'index', i));
    end if;
    if jsonb_typeof(q -> 'prompt') is distinct from 'string' or length(trim(q ->> 'prompt')) < 1 or length(q ->> 'prompt') > 2000 then
      perform public.fail('VALIDATION_FAILED', '문제는 1~2,000자예요', jsonb_build_object('field', 'prompt', 'index', i));
    end if;
    if (q ? 'explanation' and jsonb_typeof(q -> 'explanation') not in ('string', 'null')) or length(coalesce(q ->> 'explanation', '')) > 4000 then
      perform public.fail('VALIDATION_FAILED', '해설은 4,000자까지예요', jsonb_build_object('field', 'explanation', 'index', i));
    end if;
    if q ? 'points' and jsonb_typeof(q -> 'points') <> 'null'
       and (jsonb_typeof(q -> 'points') <> 'number' or (q ->> 'points')::numeric <> floor((q ->> 'points')::numeric)
            or (q ->> 'points')::numeric not between 1 and 10) then     -- int 캐스트 전에 범위(1e12 → 22003 대신 VALIDATION_FAILED)
      perform public.fail('VALIDATION_FAILED', '배점은 1~10점이에요', jsonb_build_object('field', 'points', 'index', i));
    end if;
    v_p := coalesce((q ->> 'points')::numeric::int, 1);
    if v_p < 1 or v_p > 10 then perform public.fail('VALIDATION_FAILED', '배점은 1~10점이에요', jsonb_build_object('field', 'points', 'index', i)); end if;
    v_a := q -> 'answer';
    v_c := null;

    if v_t in ('single', 'multi') then
      v_c := q -> 'choices';
      if v_c is null or jsonb_typeof(v_c) <> 'array' or jsonb_array_length(v_c) < 2 or jsonb_array_length(v_c) > 8 then
        perform public.fail('VALIDATION_FAILED', '보기는 2~8개예요', jsonb_build_object('field', 'choices', 'index', i));
      end if;
      for e in select * from jsonb_array_elements(v_c) loop
        if jsonb_typeof(e) <> 'string' or length(trim(e #>> '{}')) < 1 or length(e #>> '{}') > 200 then
          perform public.fail('VALIDATION_FAILED', '보기는 1~200자예요', jsonb_build_object('field', 'choices', 'index', i));
        end if;
      end loop;
      v_n := jsonb_array_length(v_c);
      if v_t = 'single' then
        if v_a is null or jsonb_typeof(v_a) <> 'number' or (v_a #>> '{}')::numeric <> floor((v_a #>> '{}')::numeric)
           or (v_a #>> '{}')::numeric < 0 or (v_a #>> '{}')::numeric >= v_n then
          perform public.fail('VALIDATION_FAILED', '정답은 보기 번호(0부터) 하나예요', jsonb_build_object('field', 'answer', 'index', i));
        end if;
        v_a := to_jsonb((v_a #>> '{}')::int);
      else
        if v_a is null or jsonb_typeof(v_a) <> 'array' or jsonb_array_length(v_a) < 1 then
          perform public.fail('VALIDATION_FAILED', '정답은 보기 번호 배열이에요', jsonb_build_object('field', 'answer', 'index', i));
        end if;
        seen := '{}';
        for e in select * from jsonb_array_elements(v_a) loop
          if jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <> floor((e #>> '{}')::numeric)
             or (e #>> '{}')::numeric < 0 or (e #>> '{}')::numeric >= v_n or (e #>> '{}')::int = any(seen) then
            perform public.fail('VALIDATION_FAILED', '정답 번호가 보기 범위를 벗어나거나 겹쳐요', jsonb_build_object('field', 'answer', 'index', i));
          end if;
          seen := seen || (e #>> '{}')::int;
        end loop;
        v_a := (select jsonb_agg(x order by x) from unnest(seen) x);     -- 정렬 저장(채점 비교 단순화)
      end if;
    elsif v_t = 'ox' then
      if v_a is null or jsonb_typeof(v_a) <> 'boolean' then
        perform public.fail('VALIDATION_FAILED', 'OX 정답은 true/false 예요', jsonb_build_object('field', 'answer', 'index', i));
      end if;
    else -- short
      if v_a is null or jsonb_typeof(v_a) <> 'array' or jsonb_array_length(v_a) < 1 or jsonb_array_length(v_a) > 10 then
        perform public.fail('VALIDATION_FAILED', '단답 정답은 허용 답 1~10개예요', jsonb_build_object('field', 'answer', 'index', i));
      end if;
      for e in select * from jsonb_array_elements(v_a) loop
        if jsonb_typeof(e) <> 'string' or length(public.exam_norm(e #>> '{}')) < 1 or length(e #>> '{}') > 200 then
          perform public.fail('VALIDATION_FAILED', '허용 답은 1~200자예요', jsonb_build_object('field', 'answer', 'index', i));
        end if;
      end loop;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'type', upper(v_t), 'prompt', q ->> 'prompt', 'choices', v_c, 'answer', v_a,
      'explanation', coalesce(q ->> 'explanation', ''), 'points', v_p));
    i := i + 1;
  end loop;
  return v_out;
end $$;

-- 구조 키: 유형·보기·정답·배점·순서 — 잠금 비교용(D6). prompt·explanation 은 제외
create or replace function public.exam_struct_key(p_qs jsonb) returns text
language sql immutable set search_path = '' as $$
  select md5(coalesce((select jsonb_agg(jsonb_build_array(e -> 'type', e -> 'choices', e -> 'answer', e -> 'points') order by o)
                       from jsonb_array_elements(p_qs) with ordinality x(e, o)), '[]'::jsonb)::text)
$$;

create or replace function public.exam_submitted_count(p_node bigint) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.exam_attempts a where a.node_id = p_node and a.status = 'SUBMITTED'
$$;

-- 편집 잠금 판정: 응시 행이 하나라도 있으면(IN_PROGRESS 포함) 잠긴다 — 구조를 바꾸면 exam_questions 삭제가
-- 저장된 exam_answers 를 cascade 로 지우므로(답 유실). 문구·해설·공개 시점 수정은 허용
create or replace function public.exam_assert_unlocked(p_node bigint, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_all int; v_sub int;
begin
  select count(*)::int, count(*) filter (where a.status = 'SUBMITTED')::int into v_all, v_sub
  from public.exam_attempts a where a.node_id = p_node;
  if v_all > 0 then
    perform public.fail('EXAM_LOCKED',
      case when v_sub > 0 then format('%s명이 제출해 %s', v_sub, p_what) else format('%s명이 응시 중이라 %s', v_all, p_what) end,
      jsonb_build_object('submitted', v_sub, 'started', v_all));
  end if;
end $$;

-- 현재 문항을 계약 모양(정답 포함, type 대문자)으로
create or replace function public.exam_questions_jsonb(p_node bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('type', q.qtype, 'prompt', q.prompt_md, 'choices', q.choices, 'answer', q.answer,
                                               'explanation', q.explanation_md, 'points', q.points) order by q.ord), '[]'::jsonb)
  from public.exam_questions q where q.node_id = p_node
$$;

-- 문항 교체. 잠긴 시험(응시 1건~, 진행 중 포함)은 구조가 같을 때만(문구·해설 갱신) — 아니면 EXAM_LOCKED
create or replace function public.exam_replace_questions(p_node bigint, p_qs jsonb, p_source text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q     jsonb;
  i     int := 0;
begin
  if exists (select 1 from public.exam_attempts a where a.node_id = p_node) then
    if public.exam_struct_key(p_qs) <> public.exam_struct_key(public.exam_questions_jsonb(p_node)) then
      perform public.exam_assert_unlocked(p_node, '문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요');
    end if;
    -- 구조 동일: 같은 ord 의 prompt·explanation 만 갱신(exam_answers 의 question_id 보존)
    for q in select * from jsonb_array_elements(p_qs) loop
      update public.exam_questions set prompt_md = q ->> 'prompt', explanation_md = q ->> 'explanation' where node_id = p_node and ord = i;
      i := i + 1;
    end loop;
  else
    delete from public.exam_questions where node_id = p_node;
    for q in select * from jsonb_array_elements(p_qs) loop
      insert into public.exam_questions (node_id, ord, qtype, prompt_md, choices, answer, explanation_md, points)
      values (p_node, i, q ->> 'type', q ->> 'prompt', q -> 'choices', q -> 'answer', q ->> 'explanation', (q ->> 'points')::int);
      i := i + 1;
    end loop;
  end if;
  update public.exams set question_count = jsonb_array_length(p_qs),
                          total_points = coalesce((select sum((e ->> 'points')::int) from jsonb_array_elements(p_qs) e), 0),
                          source = p_source, updated_at = now()
  where node_id = p_node;
end $$;

-- ───────── 4. 출제 RPC ─────────
-- 편집 관문: node_assert_editable(방 잠금·편집자·방 상태) + 리프(PERSONAL 제외) + 이 방 소속
create or replace function public.exam_editable_leaf(p_slug text, p_node bigint, out r public.rooms, out n public.goal_nodes)
language plpgsql security definer set search_path = '' as $$
begin
  r := public.node_assert_editable(p_slug);
  n := public.node_get(r.id, p_node);        -- NODE_NOT_FOUND(다른 방 포함) · PERSONAL_NODE
  if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '시험은 말단 과제에만 둘 수 있어요', jsonb_build_object('nodeId', n.id::text)); end if;
  if n.archived_at is not null then perform public.fail('TASK_ARCHIVED', '보관된 과제예요', jsonb_build_object('nodeId', n.id::text)); end if;
end $$;

-- exams 행을 새로 만드는 경로(exam_put·exam_brief_put·exam_draft_put)의 관문. 이미 제출물이 있는 일반 과제를 시험으로 바꾸면
-- 기존 제출이 "시험 완료" 로 집계되고, 그 사람의 exam_submit 이 submissions 1인 1행과 부딪힌다 → 거부
create or replace function public.exam_assert_creatable(p_node bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.exams x where x.node_id = p_node) and public.node_has_submissions(p_node) then
    perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 과제는 시험으로 바꿀 수 없어요', jsonb_build_object('nodeId', p_node::text));
  end if;
end $$;

create or replace function public.exam_put(p_slug text, p_node bigint, p_exam jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v     record;
  r     public.rooms;
  n     public.goal_nodes;
  v_uid uuid := public.current_user_id();
  v_qs  jsonb;
  v_rev text;
  v_st  text;
begin
  select * into v from public.exam_editable_leaf(p_slug, p_node);   -- OUT 2개 → record 로 받아 나눈다(INTO r, n 은 plpgsql 오류)
  r := v.r;
  n := v.n;
  v_qs := public.exam_validate(p_exam);
  v_rev := upper(p_exam ->> 'reveal');                              -- 없으면 기존 값 유지(새 시험은 기본 AFTER_SUBMIT)
  perform public.exam_assert_creatable(n.id);
  select x.status into v_st from public.exams x where x.node_id = n.id;
  if v_st = 'PUBLISHED' and jsonb_array_length(v_qs) = 0 then
    perform public.fail('EXAM_EMPTY', '발행된 시험은 문항을 비울 수 없어요 · 초안으로 되돌린 뒤 고쳐 주세요', jsonb_build_object('nodeId', n.id::text));
  end if;
  insert into public.exams as x (node_id, room_id, reveal, created_by) values (n.id, r.id, coalesce(v_rev, 'AFTER_SUBMIT'), v_uid)
  on conflict (node_id) do update set reveal = coalesce(v_rev, x.reveal), updated_at = now();
  perform public.exam_replace_questions(n.id, v_qs, 'MANUAL');
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

create or replace function public.exam_publish(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v      record;
  r      public.rooms;
  n      public.goal_nodes;
  x      public.exams;
  v_uid  uuid := public.current_user_id();
  v_rcpt uuid[];
begin
  select * into v from public.exam_editable_leaf(p_slug, p_node);
  r := v.r;
  n := v.n;
  select * into x from public.exams where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
  if x.question_count < 1 then perform public.fail('EXAM_EMPTY', '문항을 하나 이상 넣어야 발행할 수 있어요', jsonb_build_object('nodeId', n.id::text)); end if;
  if x.status = 'PUBLISHED' then return public.exam_view(n.id, v_uid, v_uid); end if;   -- 멱등
  update public.exams set status = 'PUBLISHED', published_at = public.app_now(), updated_at = now() where node_id = n.id;
  select coalesce(array_agg(a.user_id), '{}') into v_rcpt from public.task_assignments a where a.node_id = n.id and a.released_at is null;
  perform public.notify_publish('EXAM_PUBLISHED', r.id, n.id, v_uid, v_rcpt, 'EXAM_PUBLISHED:' || r.id || ':' || n.id,
                                jsonb_build_object('count', x.question_count));
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

create or replace function public.exam_unpublish(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v record; r public.rooms; n public.goal_nodes; v_uid uuid := public.current_user_id();
begin
  select * into v from public.exam_editable_leaf(p_slug, p_node);
  r := v.r;
  n := v.n;
  perform public.exam_assert_unlocked(n.id, '초안으로 되돌릴 수 없어요');
  update public.exams set status = 'DRAFT', published_at = null, updated_at = now() where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

-- 브리프(AI 생성 입력). 없는 시험이면 빈 초안을 만든다
create or replace function public.exam_brief_put(p_slug text, p_node bigint, p_brief jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v record; r public.rooms; n public.goal_nodes; v_uid uuid := public.current_user_id();
  v_cnt int; v_diff text; e jsonb;
begin
  select * into v from public.exam_editable_leaf(p_slug, p_node);
  r := v.r;
  n := v.n;
  if p_brief is null or jsonb_typeof(p_brief) <> 'object' then perform public.fail('VALIDATION_FAILED', '브리프가 올바르지 않아요', '{"field":"brief"}'::jsonb); end if;
  if length(trim(coalesce(p_brief ->> 'topic', ''))) < 1 or length(p_brief ->> 'topic') > 200 then
    perform public.fail('VALIDATION_FAILED', '주제는 1~200자예요', '{"field":"topic"}'::jsonb); end if;
  if length(coalesce(p_brief ->> 'theory', '')) > 20000 then perform public.fail('VALIDATION_FAILED', '기반 이론은 20,000자까지예요', '{"field":"theory"}'::jsonb); end if;
  if length(coalesce(p_brief ->> 'note', '')) > 1000 then perform public.fail('VALIDATION_FAILED', '참고는 1,000자까지예요', '{"field":"note"}'::jsonb); end if;
  if p_brief ? 'count' and jsonb_typeof(p_brief -> 'count') <> 'null'
     and (jsonb_typeof(p_brief -> 'count') <> 'number' or (p_brief ->> 'count')::numeric <> floor((p_brief ->> 'count')::numeric)
          or (p_brief ->> 'count')::numeric not between 1 and 50) then
    perform public.fail('VALIDATION_FAILED', '문항 수는 1~50이에요', '{"field":"count"}'::jsonb); end if;
  v_cnt := coalesce((p_brief ->> 'count')::numeric::int, 10);
  if v_cnt < 1 or v_cnt > 50 then perform public.fail('VALIDATION_FAILED', '문항 수는 1~50이에요', '{"field":"count"}'::jsonb); end if;
  v_diff := coalesce(p_brief ->> 'difficulty', 'normal');
  if v_diff not in ('easy', 'normal', 'hard') then perform public.fail('VALIDATION_FAILED', '난이도는 easy·normal·hard 예요', '{"field":"difficulty"}'::jsonb); end if;
  if p_brief ? 'types' then
    if jsonb_typeof(p_brief -> 'types') <> 'array' then perform public.fail('VALIDATION_FAILED', '유형은 배열이에요', '{"field":"types"}'::jsonb); end if;
    for e in select * from jsonb_array_elements(p_brief -> 'types') loop
      if coalesce(e #>> '{}', '') not in ('single', 'multi', 'ox', 'short') then perform public.fail('VALIDATION_FAILED', '유형은 single·multi·ox·short 예요', '{"field":"types"}'::jsonb); end if;
    end loop;
  end if;
  perform public.exam_assert_creatable(n.id);
  insert into public.exams (node_id, room_id, created_by) values (n.id, r.id, v_uid) on conflict (node_id) do nothing;
  update public.exams set brief = jsonb_strip_nulls(jsonb_build_object(
      'topic', trim(p_brief ->> 'topic'), 'theory', p_brief ->> 'theory', 'count', v_cnt,
      'types', coalesce(p_brief -> 'types', '["single","multi","ox"]'::jsonb), 'difficulty', v_diff, 'note', p_brief ->> 'note')),
    updated_at = now()
  where node_id = n.id;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

grant execute on function public.exam_put(text, bigint, jsonb)       to authenticated;
grant execute on function public.exam_publish(text, bigint)          to authenticated;
grant execute on function public.exam_unpublish(text, bigint)        to authenticated;
grant execute on function public.exam_brief_put(text, bigint, jsonb) to authenticated;

-- ───────── 5. 응시 ─────────
-- 응시 관문 = submission_target(방 잠금·숨김·ACTIVE·보관·리프·담당자) + 시험 존재·발행 + 시작일. 마감 뒤는 허용(지각)
-- 시험 행은 방 잠금(submission_target) 뒤에 읽는다 — exam_unpublish(node_assert_editable 이 같은 방 잠금)와 직렬화.
-- submission_target 이 먼저라 비멤버는 ROOM_NOT_FOUND 로 끝난다(노드 id 로 "시험인지" 를 떠볼 수 없다)
-- 마감 뒤 공개 시험의 마감(스펙 §3.4 의 공개 조건과 같은 식). 정답이 열린 뒤 지각 제출 = 정답 보고 만점 → 응시를 닫는다.
-- 저장값이 아니라 오늘 기준 — 기간을 연장하면 공개가 다시 닫히고 응시도 다시 열린다. after_submit 은 지각 제출 그대로 허용
create or replace function public.exam_closed(x public.exams, n public.goal_nodes) returns boolean
language sql stable set search_path = '' as $$
  select x.reveal = 'AFTER_DEADLINE' and public.kst_today() > n.end_date
$$;

create or replace function public.exam_target(p_node bigint, p_uid uuid) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes; x public.exams;
begin
  n := public.submission_target(p_node, p_uid);
  select * into x from public.exams where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', n.id::text)); end if;
  if x.status <> 'PUBLISHED' then perform public.fail('EXAM_NOT_PUBLISHED', '아직 발행되지 않은 시험이에요', jsonb_build_object('nodeId', n.id::text)); end if;
  if public.kst_today() < n.start_date then
    perform public.fail('TASK_NOT_STARTED', '아직 시작되지 않은 시험이에요', jsonb_build_object('startDate', to_char(n.start_date, 'YYYY-MM-DD')));
  end if;
  if public.exam_closed(x, n) then
    perform public.fail('EXAM_CLOSED', '마감이 지나 해설이 공개된 시험은 제출할 수 없어요', jsonb_build_object('endDate', to_char(n.end_date, 'YYYY-MM-DD')));
  end if;
  return n;
end $$;

-- 답 모양 검사(유형별). plpgsql 의 if 순서로 형 검사 → 캐스트를 보장한다(SQL and 는 평가 순서가 보장되지 않는다).
-- 수 비교는 numeric 으로 — 1e12 같은 큰 수가 int 캐스트(22003)로 새지 않게
create or replace function public.exam_answer_shape_ok(q public.exam_questions, p_answer jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare e jsonb; v_n int := case when jsonb_typeof(q.choices) = 'array' then jsonb_array_length(q.choices) else 0 end;   -- OX·SHORT 의 choices 는 JSON null
begin
  if p_answer is null then return false; end if;
  if q.qtype = 'SINGLE' then
    return jsonb_typeof(p_answer) = 'number' and (p_answer #>> '{}')::numeric = floor((p_answer #>> '{}')::numeric)
           and (p_answer #>> '{}')::numeric >= 0 and (p_answer #>> '{}')::numeric < v_n;
  elsif q.qtype = 'MULTI' then
    if jsonb_typeof(p_answer) <> 'array' or jsonb_array_length(p_answer) > 50 then return false; end if;   -- 중복은 저장 때 걷는다(길이 = 상한만)
    for e in select * from jsonb_array_elements(p_answer) loop
      if jsonb_typeof(e) <> 'number' then return false; end if;
      if (e #>> '{}')::numeric <> floor((e #>> '{}')::numeric) or (e #>> '{}')::numeric < 0 or (e #>> '{}')::numeric >= v_n then return false; end if;
    end loop;
    return true;
  elsif q.qtype = 'OX' then
    return jsonb_typeof(p_answer) = 'boolean';
  elsif q.qtype = 'SHORT' then
    return jsonb_typeof(p_answer) = 'string' and length(p_answer #>> '{}') <= 200;
  end if;
  return false;
end $$;

-- 저장 표기 정규화(모양 검사 통과 뒤에만 부른다): 1.0 → 1 · MULTI 는 정수·중복 제거·정렬. jsonb 는 1.0 의 scale 을 보존해
-- '1.0'::int 가 22P02 로 터지므로 저장값을 항상 정수 표기로 둔다
create or replace function public.exam_answer_canon(q public.exam_questions, p_answer jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case q.qtype
    when 'SINGLE' then to_jsonb((p_answer #>> '{}')::numeric::int)
    when 'MULTI'  then (select coalesce(jsonb_agg(s.x order by s.x), '[]'::jsonb)
                        from (select distinct (e #>> '{}')::numeric::int as x from jsonb_array_elements(p_answer) e) s)
    else p_answer end
$$;

-- "답함" 판정 — 웹 exam.ts isAnswered 와 같은 규칙(null·''·[] 는 답 아님). 저장 응답 answered 가 화면 "답함 n/총" 과 같도록
create or replace function public.exam_is_answered(p_answer jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p_answer is not null and p_answer not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb)
$$;

-- 채점(D12·D13). 답이 없거나 모양이 틀리면 오답 0점. 복수는 전부 일치(중복 선택은 한 번으로), 단답은 exam_norm 비교
create or replace function public.exam_grade(q public.exam_questions, p_answer jsonb, out correct boolean, out earned int)
language plpgsql immutable set search_path = '' as $$
begin
  correct := false;
  if public.exam_is_answered(p_answer) and public.exam_answer_shape_ok(q, p_answer) then
    correct := case q.qtype
      when 'SINGLE' then (p_answer #>> '{}')::numeric::int = (q.answer #>> '{}')::numeric::int
      when 'MULTI'  then public.exam_answer_canon(q, p_answer) = q.answer
      when 'OX'     then (p_answer #>> '{}')::boolean = (q.answer #>> '{}')::boolean
      when 'SHORT'  then exists (select 1 from jsonb_array_elements_text(q.answer) a where public.exam_norm(a) = public.exam_norm(p_answer #>> '{}'))
      else false end;
  end if;
  earned := case when correct then q.points else 0 end;
end $$;

-- 정답·해설·정오 공개 여부(스펙 §3.4). 편집자는 호출 전에 걸러진다. 응시 행이 없으면 a 의 칸은 모두 null
create or replace function public.exam_reveal_ok(x public.exams, n public.goal_nodes, a public.exam_attempts) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(case x.reveal
    when 'AFTER_SUBMIT'   then a.status = 'SUBMITTED'
    when 'AFTER_DEADLINE' then public.exam_closed(x, n)              -- 저장값이 아니라 오늘 기준 — 기간 연장 = 다시 닫힘
    else false end, false)
$$;

-- 시험을 볼 수 있는 방 사람 = 그룹장 | ACTIVE·INACTIVE·PENDING 멤버(curriculum_json 의 people 노출과 같은 자격). exam_view·exam_summary 공용
create or replace function public.exam_viewer_member(r public.rooms, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')))
$$;

-- 보는 사람(p_uid)에 따라 깎은 시험 JSON — 노출 규칙(스펙 §3.4)은 이 함수 한 곳에서만 판정한다.
-- 숨길 값은 키를 만들지 않는다(null 이 아니라 키 없음). p_for = 응시 행 주인(편집자가 남의 답안을 볼 때만 p_uid 와 다르다)
create or replace function public.exam_view(p_node bigint, p_uid uuid, p_for uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  x        public.exams;
  n        public.goal_nodes;
  r        public.rooms;
  a        public.exam_attempts;
  v_edit   boolean;
  v_asg    boolean;
  v_member boolean;
  v_reveal boolean;
  v_reason text;
  v_qs     jsonb;
  v_att    jsonb;
  v_sub    int;
  v_all    int;
begin
  select * into x from public.exams where node_id = p_node;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', p_node::text)); end if;
  select * into n from public.goal_nodes where id = p_node;
  select * into r from public.rooms where id = n.room_id;
  v_edit := coalesce(public.can_edit_curriculum(r, p_uid), false);
  v_member := public.exam_viewer_member(r, p_uid);
  -- 비멤버·익명: 공개 방이라도 시험은 비공개(존재 숨김)
  if not v_edit and not v_member then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', p_node::text)); end if;
  if p_for is distinct from p_uid and not v_edit then perform public.fail('FORBIDDEN', '다른 사람의 답안은 편집자만 볼 수 있어요'); end if;

  -- viewer 의 담당·사유는 응시 행 주인(p_for) 기준 — 편집자가 남의 답안을 볼 때 두 사람 상태가 섞이지 않게(exam_attempt_get).
  -- canTake 는 자기 응시에서만 참(편집자가 남 대신 풀 수 없다)
  v_asg := p_for is not null and public.is_task_assignee(n.id, p_for);
  select * into a from public.exam_attempts where node_id = p_node and user_id = p_for;
  select count(*)::int, count(*) filter (where s.status = 'SUBMITTED')::int into v_all, v_sub
  from public.exam_attempts s where s.node_id = p_node;
  v_reveal := v_edit or public.exam_reveal_ok(x, n, a);

  v_reason := case
    when a.status = 'SUBMITTED' then 'submitted'
    when r.status <> 'ACTIVE' or r.archived_at is not null then 'room_not_active'
    when n.archived_at is not null then 'archived'
    when not v_asg then 'not_assignee'
    when x.status <> 'PUBLISHED' then 'not_published'
    when public.kst_today() < n.start_date then 'not_started'
    when public.exam_closed(x, n) then 'closed'                      -- after_deadline 마감 뒤: 정답이 열려 응시 불가
    else null end;

  -- 문항: 편집자 | 담당자(스펙 §3.4 — 담당 아닌 멤버는 요약만). 담당자에게도 초안·시작 전에는 문항을 싣지 않는다
  -- (시작일 전 문제 유출 방지 — 화면은 reason 으로 안내만). 정답·해설 키는 v_reveal 일 때만 만든다
  if v_edit or (v_asg and x.status = 'PUBLISHED' and public.kst_today() >= n.start_date) then
    select coalesce(jsonb_agg(
      jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'prompt', q.prompt_md, 'choices', q.choices, 'points', q.points)
      || case when v_reveal then jsonb_build_object('answer', q.answer, 'explanation', q.explanation_md) else '{}'::jsonb end
      order by q.ord), '[]'::jsonb)
    into v_qs from public.exam_questions q where q.node_id = p_node;
  end if;

  if a.id is not null then
    v_att := jsonb_build_object(
      'status', lower(a.status),
      'answers', coalesce((select jsonb_object_agg(e.question_id::text, e.answer) from public.exam_answers e where e.attempt_id = a.id), '{}'::jsonb),
      'score', a.score, 'maxScore', a.max_score, 'correctCount', a.correct_count,
      'submittedAt', public.iso(a.submitted_at),
      'isLate', (select s.is_late from public.submissions s where s.node_id = p_node and s.user_id = p_for),
      -- 정오는 공개 조건 + 제출 뒤에만(after_deadline 마감 전엔 점수만 — 스펙 §5.1 results null)
      'results', case when v_reveal and a.status = 'SUBMITTED' then
        coalesce((select jsonb_object_agg(e.question_id::text, jsonb_build_object('correct', e.is_correct, 'earned', e.earned))
                  from public.exam_answers e where e.attempt_id = a.id), '{}'::jsonb) end);
  end if;

  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'node', jsonb_build_object('id', n.id::text, 'title', n.title, 'startDate', to_char(n.start_date, 'YYYY-MM-DD'),
                               'endDate', to_char(n.end_date, 'YYYY-MM-DD'), 'archived', n.archived_at is not null),
    -- 초안은 편집자가 아니면 상태만(문항 수·배점·공개 시점도 싣지 않는다 — exam_summary 와 같은 규칙)
    'exam', case when v_edit or x.status = 'PUBLISHED' then
              jsonb_build_object('status', lower(x.status), 'reveal', lower(x.reveal), 'questionCount', x.question_count,
                                 'totalPoints', x.total_points, 'publishedAt', public.iso(x.published_at),
                                 'closed', public.exam_closed(x, n))
            else jsonb_build_object('status', lower(x.status), 'publishedAt', null, 'closed', false) end
            -- 편집자 전용 키. locked = 응시 행 1건~(진행 중 포함, exam_assert_unlocked 와 같은 규칙) · submittedCount = 제출만
            || case when v_edit then jsonb_build_object('source', lower(x.source), 'locked', v_all > 0, 'submittedCount', v_sub, 'brief', x.brief) else '{}'::jsonb end,
    'viewer', jsonb_build_object('canEdit', v_edit, 'isAssignee', v_asg,
                                 'canTake', v_reason is null and p_for is not distinct from p_uid, 'reason', v_reason),
    'questions', v_qs,
    'attempt', v_att);
end $$;

create or replace function public.exam_get(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); r public.rooms; n public.goal_nodes;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

-- 중간 저장 = 모양 검사만(채점 없음). 첫 저장이 IN_PROGRESS 응시 행을 만든다 → 그때부터 문항 구조·초안 되돌리기가 잠긴다
create or replace function public.exam_answer_save(p_node bigint, p_question bigint, p_answer jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_now timestamptz := public.app_now();
  n     public.goal_nodes;
  q     public.exam_questions;
  a     public.exam_attempts;
  v_cnt int;
  v_tot int;
begin
  n := public.exam_target(p_node, v_uid);                    -- 방 잠금
  select * into q from public.exam_questions where id = p_question and node_id = n.id;
  if not found then perform public.fail('NOT_FOUND', '문항을 찾을 수 없어요', jsonb_build_object('questionId', p_question::text)); end if;
  -- 상태 오류가 모양 오류보다 먼저(제출 뒤엔 무엇을 보내도 EXAM_ALREADY_SUBMITTED). 실패하면 아래 insert 도 함께 롤백된다
  insert into public.exam_attempts (node_id, user_id, started_at) values (n.id, v_uid, v_now) on conflict (node_id, user_id) do nothing;
  select * into a from public.exam_attempts where node_id = n.id and user_id = v_uid for update;   -- 응시 행 잠금(방 잠금 다음)
  if a.status <> 'IN_PROGRESS' then perform public.fail('EXAM_ALREADY_SUBMITTED', '이미 제출한 시험이에요'); end if;
  if not public.exam_answer_shape_ok(q, p_answer) then
    perform public.fail('VALIDATION_FAILED', '답 모양이 문항 유형과 맞지 않아요', jsonb_build_object('field', 'answer', 'questionId', q.id::text));
  end if;
  insert into public.exam_answers (attempt_id, question_id, answer, saved_at) values (a.id, q.id, public.exam_answer_canon(q, p_answer), v_now)
  on conflict (attempt_id, question_id) do update set answer = excluded.answer, saved_at = excluded.saved_at;
  select count(*)::int into v_cnt from public.exam_answers e where e.attempt_id = a.id and public.exam_is_answered(e.answer);
  select count(*)::int into v_tot from public.exam_questions where node_id = n.id;
  return jsonb_build_object('savedAt', public.iso(v_now), 'answered', v_cnt, 'total', v_tot);
end $$;

-- 제출 = 채점 + SUBMITTED + submissions 1행(본문 ''). 빈 응시(답 없음)도 제출된다(0점). 1회 응시(D3)
create or replace function public.exam_submit(p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_now   timestamptz := public.app_now();
  n       public.goal_nodes;
  r       public.rooms;
  a       public.exam_attempts;
  q       public.exam_questions;
  v_c     boolean;
  v_e     int;
  v_score int := 0;
  v_max   int := 0;
  v_cnt   int := 0;
  v_asg   int;
  v_sub   int;
  v_mode  text;
begin
  n := public.exam_target(p_node, v_uid);                    -- 방 잠금
  select * into r from public.rooms where id = n.room_id;
  insert into public.exam_attempts (node_id, user_id, started_at) values (n.id, v_uid, v_now) on conflict (node_id, user_id) do nothing;
  select * into a from public.exam_attempts where node_id = n.id and user_id = v_uid for update;   -- 응시 행 잠금 + IN_PROGRESS 재검사
  if a.status <> 'IN_PROGRESS' then perform public.fail('EXAM_ALREADY_SUBMITTED', '이미 제출한 시험이에요'); end if;

  -- 채점은 여기서만(exam_grade). 미답 문항도 채점 행을 남긴다(answer = JSON null → 웹은 "답 없음")
  for q in select * from public.exam_questions where node_id = n.id order by ord loop
    select g.correct, g.earned into v_c, v_e
    from public.exam_grade(q, (select e.answer from public.exam_answers e where e.attempt_id = a.id and e.question_id = q.id)) g;
    insert into public.exam_answers (attempt_id, question_id, answer, is_correct, earned, saved_at)
    values (a.id, q.id, 'null'::jsonb, v_c, v_e, v_now)
    on conflict (attempt_id, question_id) do update set is_correct = excluded.is_correct, earned = excluded.earned;
    v_score := v_score + v_e;
    v_max := v_max + q.points;
    v_cnt := v_cnt + case when v_c then 1 else 0 end;
  end loop;
  update public.exam_attempts set status = 'SUBMITTED', submitted_at = v_now, score = v_score, max_score = v_max, correct_count = v_cnt
  where id = a.id;

  -- 과제 제출 1행(0022 submission_upsert 와 같은 지각 판정). 가드 트리거는 이 트랜잭션 로컬 설정으로만 연다
  perform set_config('sgtudy.exam_submit', '1', true);
  insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
  values (n.id, v_uid, '', v_now, v_now >= public.kst_deadline(n.end_date), v_now)
  on conflict (node_id, user_id) do nothing;
  if not found then   -- 시험이 되기 전 제출물(C10 경합 창) — 원시 23505 대신 코드로
    perform public.fail('NODE_HAS_SUBMISSIONS', '이미 제출물이 있는 과제예요', jsonb_build_object('nodeId', n.id::text));
  end if;
  perform set_config('sgtudy.exam_submit', '0', true);

  -- 전원 제출 감지(0022 submission_upsert 와 동일 — 이 insert 는 항상 최초 제출)
  select ls.asg, ls.sub into v_asg, v_sub from public.room_leaf_stats(r.id) ls where ls.node_id = n.id;
  if coalesce(v_asg, 0) > 0 and v_sub = v_asg then
    select completion_mode into v_mode from public.room_notification_settings where room_id = r.id;
    if coalesce(v_mode, 'DAILY_DIGEST') = 'IMMEDIATE' then
      perform public.notify_publish('TASK_ALL_SUBMITTED', r.id, n.id, v_uid, array[r.leader_id],
                                    'TASK_ALL_SUBMITTED:' || r.id || ':' || n.id, '{}'::jsonb);
    end if;
  end if;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

grant execute on function public.exam_get(text, bigint)                  to authenticated, anon;   -- anon 은 EXAM_NOT_FOUND 로 끝난다(존재 숨김)
grant execute on function public.exam_answer_save(bigint, bigint, jsonb) to authenticated;
grant execute on function public.exam_submit(bigint)                     to authenticated;

-- ───────── 6. 편집자 결과 (스펙 §5.4 · D7 — 점수는 본인·편집자만) ─────────
create or replace function public.exam_results(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  r     public.rooms;
  n     public.goal_nodes;
  x     public.exams;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.require_curriculum_editor(r, v_uid);
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  select * into x from public.exams where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', n.id::text)); end if;

  return jsonb_build_object(
    -- 집계(제출·평균·최고·정답률)는 현재 담당자만 — 배정 해제된 사람의 응시는 빼서 submitted ≤ assigned
    'submitted', (select count(*)::int from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'
                  and public.is_task_assignee(n.id, a.user_id)),
    'assigned', (select count(*)::int from public.task_assignments a where a.node_id = n.id and a.released_at is null),
    'maxScore', x.total_points,
    'avg', (select round(avg(a.score)::numeric, 1) from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'
            and public.is_task_assignee(n.id, a.user_id)),
    'max', (select max(a.score) from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'
            and public.is_task_assignee(n.id, a.user_id)),
    -- 정답률 = 제출된 응시 중 정답 비율(응시 0 → null, pct 규칙)
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'points', q.points,
                    'correctRate', (select public.pct(count(*)::int, (count(*) filter (where e.is_correct))::int)
                                    from public.exam_answers e join public.exam_attempts a on a.id = e.attempt_id
                                    where e.question_id = q.id and a.status = 'SUBMITTED'
                                      and public.is_task_assignee(n.id, a.user_id))) order by q.ord), '[]'::jsonb)
                  from public.exam_questions q where q.node_id = n.id),
    -- 유효 담당자 전원(미제출 포함). 순서 = curriculum_json people(그룹장, joined_at, id)
    'members', (select coalesce(jsonb_agg(public.person_json(a.user_id) || jsonb_build_object(
                    'status', public.task_code(n.start_date, n.end_date, s.first_submitted_at, s.is_late, public.kst_today()),
                    'score', t.score, 'submittedAt', public.iso(t.submitted_at), 'isLate', s.is_late)
                  order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
                from public.task_assignments a
                join public.room_members m on m.room_id = r.id and m.user_id = a.user_id
                left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
                left join public.exam_attempts t on t.node_id = n.id and t.user_id = a.user_id and t.status = 'SUBMITTED'
                where a.node_id = n.id and a.released_at is null));
end $$;

-- 편집자가 남의 답안 보기(스펙 §5.4) = exam_view(p_for = p_user). 편집자가 아니면 exam_view 가 FORBIDDEN(자기 것은 exam_get 과 같다)
create or replace function public.exam_attempt_get(p_slug text, p_node bigint, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  return public.exam_view(n.id, v_uid, p_user);
end $$;

grant execute on function public.exam_results(text, bigint)           to authenticated;
grant execute on function public.exam_attempt_get(text, bigint, uuid) to authenticated;

-- ───────── 7. 트리·상세 JSON 재정의 (리프 exam 요약 · 정답 없음) ─────────
-- 리프 exam 요약(스펙 §3.1 — 문항·정답·점수는 싣지 않는다). 시험 아님 → null.
-- 편집자: 항상 전부 · 멤버(그룹장·ACTIVE·INACTIVE·PENDING): 발행 뒤 전부, 초안이면 {status} 만(D10 "초안" 배지) ·
-- 비멤버·익명: null(exam_view 의 존재 숨김과 같다 — 공개 방이라도 시험은 비공개)
create or replace function public.exam_summary(p_node bigint, p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare x public.exams; r public.rooms;
begin
  select * into x from public.exams where node_id = p_node;
  if not found then return null; end if;
  select * into r from public.rooms where id = x.room_id;
  if coalesce(public.can_edit_curriculum(r, p_uid), false)
     or (x.status = 'PUBLISHED' and public.exam_viewer_member(r, p_uid)) then
    return jsonb_build_object('status', lower(x.status), 'questionCount', x.question_count, 'totalPoints', x.total_points, 'reveal', lower(x.reveal));
  end if;
  if public.exam_viewer_member(r, p_uid) then return jsonb_build_object('status', lower(x.status)); end if;
  return null;
end $$;

-- curriculum_json ← 0032 판. 0037: 리프 exam 요약(정답 없음) + 편집자에게 warnings EXAM_NOT_PUBLISHED(스펙 §4.6·D10)
-- 주의: 변경 RPC 는 curriculum_json(..) || {warnings: 자기 경고} 라 그 응답에서는 이 경고가 덮인다(트리 exam.status 로도 판정 가능)
create or replace function public.curriculum_json(p_room bigint, p_uid uuid, p_include_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  v_today   date := public.kst_today();
  v_people  boolean;     -- 팀 과제 people 노출: 그룹장 | ACTIVE·INACTIVE·PENDING 멤버
  v_viewer  boolean;     -- 남의 개인 목표 노출: 그룹장 | ACTIVE·INACTIVE 멤버 (0014)
  v_members jsonb;
  v_nodes   jsonb;
  v_stats   jsonb;
  v_warn    jsonb;       -- 0037
begin
  select * into r from public.rooms where id = p_room;
  v_people := p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')));
  v_viewer := public.personal_viewer(p_room, p_uid);

  select coalesce(jsonb_agg(
           public.person_json(m.user_id) || jsonb_build_object(
             'role', lower(m.role), 'status', lower(m.status),
             'doesTasks', m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks),
             'canEditCurriculum', public.member_can_edit_curriculum(r, m))
           -- 0032: 중간 합류자 공통 과제 배정 시작일(null = 처음부터). 방 사람(v_viewer)에게만 — 공개 방 익명·외부인에겐 키 없음(Codex 2-6)
           || case when v_viewer then jsonb_build_object('assignFrom', to_char(m.assign_from, 'YYYY-MM-DD')) else '{}'::jsonb end
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  into v_members
  from public.room_members m
  where m.room_id = p_room and m.status in ('ACTIVE', 'INACTIVE');

  with recursive prog as materialized (
    select * from public.room_progress(p_room)),
  t as (
    select n.*, array[n.sort_order::bigint, n.id] as path
    from public.goal_nodes n where n.room_id = p_room and n.parent_id is null
    union all
    select c.*, t.path || array[c.sort_order::bigint, c.id]
    from public.goal_nodes c join t on c.parent_id = t.id),
  nodes as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id::text, 'parentId', t.parent_id::text, 'roundId', t.round_id::text,
             'depth', t.depth, 'sortOrder', t.sort_order, 'label', t.label, 'title', t.title,
             'descriptionMd', t.description_md,
             'startDate', to_char(t.start_date, 'YYYY-MM-DD'), 'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
             'archived', t.archived_at is not null,
             'ownerId', t.owner_id::text,
             'createdBy', case when t.created_by is null then null else public.person_json(t.created_by) end,   -- 0024
             'exam', public.exam_summary(t.id, p_uid),   -- 0037
             'assigned', coalesce(ps.asg, p.asg), 'submitted', coalesce(ps.sub, p.sub),
             'pct', case when ps.asg is null then p.pct else public.pct(ps.asg, ps.sub) end,
             'task', case
               when t.task_type is null then null
               when t.task_type = 'PERSONAL' then jsonb_build_object(
                 'type', 'personal', 'assigned', ps.asg, 'submitted', ps.sub,
                 'state', public.leaf_state(ps.asg, ps.sub, t.start_date, t.end_date, v_today),
                 'people', jsonb_build_array(public.person_json(t.owner_id)
                             || jsonb_build_object('status', public.task_code(t.start_date, t.end_date, ps.first_at, ps.late, v_today))))
               else jsonb_build_object(
                 'type', lower(t.task_type),
                 'assigned', p.asg, 'submitted', p.sub,
                 'state', public.leaf_state(p.asg, p.sub, t.start_date, t.end_date, v_today),
                 -- people 은 의도적으로 멤버 순서(그룹장, joined_at, id) — room_get 의 assigned_at 순서와 다르다
                 'people', case when not v_people then '[]'::jsonb else coalesce((
                   select jsonb_agg(public.person_json(a.user_id)
                            || jsonb_build_object('status', public.task_code(t.start_date, t.end_date, s.first_submitted_at, s.is_late, v_today))
                            order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id)
                   from public.task_assignments a
                   join public.room_members m on m.room_id = p_room and m.user_id = a.user_id
                   left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
                   where a.node_id = t.id and a.released_at is null and t.archived_at is null), '[]'::jsonb) end) end)
             order by t.path), '[]'::jsonb) as j
    from t
    join prog p on p.node_id = t.id
    left join lateral (
      select case when t.archived_at is null then 1 else 0 end as asg,
             case when t.archived_at is null and s.id is not null then 1 else 0 end as sub,
             s.first_submitted_at as first_at, s.is_late as late
      from (select 1) one
      left join public.submissions s on s.node_id = t.id and s.user_id = t.owner_id) ps on t.task_type = 'PERSONAL'
    where (p_include_archived or t.archived_at is null)
      and (t.owner_id is null or t.owner_id = p_uid or v_viewer)),
  stats as (
    select jsonb_build_object(
      'overallPct', public.pct(coalesce(sum(p.asg), 0)::int, coalesce(sum(p.sub), 0)::int),
      'leafCount', count(*),
      'unassignedCount', count(*) filter (where n.task_type = 'DESIGNATED' and p.asg = 0)) as j
    from public.goal_nodes n join prog p on p.node_id = n.id
    where n.room_id = p_room and n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null)
  select (select j from nodes), (select j from stats) into v_nodes, v_stats;

  -- 0037: 초안(미발행) 시험 경고 — 편집자에게만(키 자체를 싣지 않는다). 보관된 리프 제외, 기간 순
  if coalesce(public.can_edit_curriculum(r, p_uid), false) then
    select coalesce(jsonb_agg(jsonb_build_object('code', 'EXAM_NOT_PUBLISHED', 'nodeId', g.id::text, 'message', '아직 발행되지 않은 시험이에요')
                              order by g.start_date, g.id), '[]'::jsonb)
    into v_warn
    from public.exams x join public.goal_nodes g on g.id = x.node_id
    where x.room_id = p_room and x.status = 'DRAFT' and g.archived_at is null;
  end if;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'room', jsonb_build_object('slug', r.slug, 'status', lower(r.status), 'leaderDoesTasks', r.leader_does_tasks),
    'members', v_members, 'nodes', v_nodes, 'stats', v_stats,
    'myPermissions', jsonb_build_object('canEditCurriculum', public.can_edit_curriculum(r, p_uid)),
    'personal', jsonb_build_object(
      'canAdd', r.archived_at is null and r.status in ('RECRUIT', 'ACTIVE') and public.personal_eligible(p_room, p_uid),
      'perRound', public.personal_limit()))
    || case when v_warn is not null then jsonb_build_object('warnings', v_warn) else '{}'::jsonb end;   -- 0037
end $$;

-- task_node_json ← 0024 판. 0037: 리프 exam 요약(정답 없음)
create or replace function public.task_node_json(p_node bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id::text, 'parentId', n.parent_id::text, 'roundId', n.round_id::text, 'depth', n.depth, 'sortOrder', n.sort_order,
    'label', n.label, 'title', n.title, 'descriptionMd', n.description_md,
    'startDate', to_char(n.start_date, 'YYYY-MM-DD'), 'endDate', to_char(n.end_date, 'YYYY-MM-DD'),
    'archived', n.archived_at is not null,
    'ownerId', n.owner_id::text,
    'createdBy', case when n.created_by is null then null else public.person_json(n.created_by) end,   -- 0024
    'exam', public.exam_summary(n.id, p_uid),   -- 0037
    'task', jsonb_build_object(
      'type', lower(n.task_type),
      'people', case
        when n.task_type = 'PERSONAL' then
          case when p_uid is null or not (n.owner_id = p_uid or public.personal_viewer(n.room_id, p_uid)) then '[]'::jsonb
               else jsonb_build_array(public.person_json(n.owner_id) || jsonb_build_object('status',
                      public.task_code(n.start_date, n.end_date, ow.first_submitted_at, ow.is_late, public.kst_today()))) end
        when p_uid is null or n.archived_at is not null or not (
            exists (select 1 from public.rooms rr where rr.id = n.room_id and rr.leader_id = p_uid)
            or exists (select 1 from public.room_members m where m.room_id = n.room_id and m.user_id = p_uid
                         and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')))
          then '[]'::jsonb
        else coalesce((
          select jsonb_agg(public.person_json(a.user_id)
                           || jsonb_build_object('status', public.task_code(n.start_date, n.end_date, s.first_submitted_at, s.is_late, public.kst_today()))
                           order by a.assigned_at, a.id)
          from public.task_assignments a
          left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
          where a.node_id = n.id and a.released_at is null), '[]'::jsonb) end,
      'assigned', st.asg, 'submitted', st.sub,
      'state', public.leaf_state(st.asg, st.sub, n.start_date, n.end_date, public.kst_today())),
    'assigned', st.asg, 'submitted', st.sub, 'pct', public.pct(st.asg, st.sub))
  from public.goal_nodes n
  left join public.submissions ow on n.task_type = 'PERSONAL' and ow.node_id = n.id and ow.user_id = n.owner_id
  cross join lateral (
    select case when n.task_type = 'PERSONAL' then (case when n.archived_at is null then 1 else 0 end)
                else (select count(*)::int from public.task_assignments a where a.node_id = n.id and a.released_at is null) end as asg,
           case when n.task_type = 'PERSONAL' then (case when n.archived_at is null and ow.id is not null then 1 else 0 end)
                else (select count(s.id)::int from public.task_assignments a
                      join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
                      where a.node_id = n.id and a.released_at is null) end as sub) st
  where n.id = p_node and n.task_type is not null
$$;

-- ───────── 8. AI 통로 (api_invoke op 2개, 스펙 §3.5) ─────────
-- exam_get_brief → exam_brief_text · exam_draft_put → exam_draft_put. 두 함수는 api_invoke 전용(GRANT 없음) — 웹은 exam_brief_put·exam_put.
-- 레이트리밋: api_rate_check 재정의 금지 → 공용 분당 60 한도만 받는다(시간당 묶음 한도는 2단계 api_limits 확장 때 함께).
create or replace function public.exam_contract_text() returns text
language sql immutable set search_path = '' as $$
  select $t$sgtudy.exam/v1 — create_exam_draft 의 exam 인자 모양:
{"questions":[
 {"type":"single","prompt":"문제(마크다운, ≤2000자)","choices":["보기1","보기2","보기3","보기4"],"answer":0,"explanation":"해설(≤4000자)","points":1},
 {"type":"multi","prompt":"…","choices":["…","…","…"],"answer":[0,2],"explanation":"…","points":2},
 {"type":"ox","prompt":"…","answer":true,"explanation":"…"},
 {"type":"short","prompt":"…","answer":["허용 답1","허용 답2"],"explanation":"…"}]}
규칙: 문항 1~50 · choices 2~8개(각 ≤200자) · answer 는 0부터 세는 보기 번호 · multi 는 전부 맞아야 정답 · short 는 정규화(소문자·공백·구두점 제거) 뒤 정확 일치라 허용 답을 여러 개 · points 1~10(기본 1) · 한국어로 · 해설에는 왜 정답인지와 오답 보기가 틀린 이유를 짧게.
초안으로 저장되며 편집자가 웹에서 검토·발행한다. 발행된 시험은 덮어쓸 수 없다.$t$
$$;

-- 브리프 읽기(편집자만). 브리프가 없으면 brief: null — contract 는 그대로 줘서 AI 가 주제를 사용자에게 묻게 한다
create or replace function public.exam_brief_text(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes; x public.exams;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.require_curriculum_editor(r, v_uid);
  n := public.node_get(r.id, p_node);        -- NODE_NOT_FOUND(다른 방 포함) · PERSONAL_NODE
  if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '시험은 말단 과제에만 둘 수 있어요', jsonb_build_object('nodeId', n.id::text)); end if;
  select * into x from public.exams where node_id = n.id;
  return jsonb_build_object(
    'study', jsonb_build_object('slug', r.slug, 'title', r.title),
    'task', jsonb_build_object('id', n.id::text, 'title', n.title, 'startDate', to_char(n.start_date, 'YYYY-MM-DD'), 'endDate', to_char(n.end_date, 'YYYY-MM-DD')),
    'exam', case when x.node_id is null then jsonb_build_object('status', 'none', 'questionCount', 0)
                 else jsonb_build_object('status', lower(x.status), 'questionCount', x.question_count) end,
    'brief', x.brief,
    'contract', public.exam_contract_text(),
    'constraints', jsonb_build_object('maxQuestions', 50, 'types', '["single","multi","ox","short"]'::jsonb, 'pointsRange', '[1,10]'::jsonb));
end $$;

-- AI 초안 저장. 발행된 시험(EXAM_PUBLISHED)·응시 행이 있는 시험(EXAM_LOCKED)은 거부 — 구조 동일 예외 없이 통째로.
-- source = AI, reveal 은 바꾸지 않는다(새 시험은 기본값). 브리프와 어긋나면 저장은 하고 warnings 로 알린다
create or replace function public.exam_draft_put(p_slug text, p_node bigint, p_exam jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v      record;
  r      public.rooms;
  n      public.goal_nodes;
  x      public.exams;
  v_uid  uuid := public.current_user_id();
  v_qs   jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_types jsonb;
begin
  select * into v from public.exam_editable_leaf(p_slug, p_node);   -- 방 잠금·편집자·리프·보관 아님
  r := v.r;
  n := v.n;
  perform public.exam_assert_creatable(n.id);                       -- 제출물 있는 일반 과제 → NODE_HAS_SUBMISSIONS
  select * into x from public.exams where node_id = n.id;
  if x.status = 'PUBLISHED' then
    perform public.fail('EXAM_PUBLISHED', '발행된 시험은 AI 초안으로 덮어쓸 수 없어요 · 웹에서 초안으로 되돌리거나 새 과제를 만들어 주세요',
                        jsonb_build_object('nodeId', n.id::text));
  end if;
  perform public.exam_assert_unlocked(n.id, 'AI 초안으로 덮어쓸 수 없어요');
  v_qs := public.exam_validate(p_exam);
  if jsonb_array_length(v_qs) < 1 then perform public.fail('VALIDATION_FAILED', '문항을 하나 이상 넣어 주세요', '{"field":"questions"}'::jsonb); end if;
  insert into public.exams (node_id, room_id, created_by) values (n.id, r.id, v_uid) on conflict (node_id) do nothing;
  perform public.exam_replace_questions(n.id, v_qs, 'AI');
  if x.brief is not null then
    if (x.brief ->> 'count')::int <> jsonb_array_length(v_qs) then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'COUNT_MISMATCH',
                  'message', format('브리프는 %s문항인데 %s문항이 왔어요', x.brief ->> 'count', jsonb_array_length(v_qs))));
    end if;
    v_types := coalesce(x.brief -> 'types', '[]'::jsonb);
    if jsonb_array_length(v_types) > 0 and exists (select 1 from jsonb_array_elements(v_qs) q where not v_types ? lower(q ->> 'type')) then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'TYPE_NOT_IN_BRIEF', 'message', '브리프에 없는 문항 유형이 섞여 있어요'));
    end if;
  end if;
  return jsonb_build_object('questionCount', jsonb_array_length(v_qs),
                            'totalPoints', coalesce((select sum((q ->> 'points')::int) from jsonb_array_elements(v_qs) q), 0),
                            'warnings', v_warn);
end $$;

-- 재정의: api_scope_of ← 0033(+ exam_get_brief read · exam_draft_put curriculum:write)
create or replace function public.api_scope_of(p_op text) returns text
language sql immutable set search_path = '' as $$
  select case p_op
    when 'whoami'               then 'any'
    when 'me_studies'           then 'read'
    when 'me_schedule'          then 'read'              -- 〔UX 재검토 T2〕 me_tasks 대신(기간 창)
    when 'curriculum_get'       then 'read'
    when 'curriculum_plan_preview' then 'curriculum:write'
    when 'curriculum_plan_apply'   then 'curriculum:write'
    when 'personal_create_many' then 'personal:write'
    when 'personal_delete_many' then 'personal:write'   -- 〔UX 재검토 D16〕
    when 'exam_get_brief'       then 'read'              -- 0037 시험 브리프(편집자만 — 함수가 막는다)
    when 'exam_draft_put'       then 'curriculum:write'  -- 0037 시험 AI 초안
  end
$$;

-- 재정의: api_invoke ← 0035(커밋 d786c54 반영 판) — ① study 해석 목록 +2 op ② 디스패치 +2 ③ 감사 summary(exam_draft_put: task·questionCount 만)
create or replace function public.api_invoke(p_token text, p_op text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t        public.api_tokens;
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
  v_uid    uuid;
  v_source text;
  v_dry    boolean;
  v_room   bigint;
  v_data   jsonb;
  v_out    jsonb;
  v_state  text;
  v_code   text;
  v_msg    text;
  v_hint   text;
  v_ok     boolean;
  v_err    text;
  v_slug   text;
  v_replay boolean := false;
begin
  if octet_length(v_args::text) > 307200 then                                  -- 〔C#11〕 해석·인증 전에 크기부터(라우트 우회 대비)
    perform public.fail('PAYLOAD_TOO_LARGE', '요청이 너무 커요(300KB 까지). 계획을 나눠 주세요');
  end if;
  if jsonb_typeof(v_args) <> 'object' then perform public.fail('VALIDATION_FAILED', '인자가 올바르지 않아요'); end if;
  if p_token is not null then
    if auth.uid() is not null then perform public.fail('API_AUTH_CONFLICT', '토큰과 로그인 세션을 함께 쓸 수 없어요'); end if;
    t := public.api_authenticate(p_token, p_op);
    v_uid := t.user_id;
    v_source := 'PAT';
  else
    v_uid := auth.uid();
    if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
    if public.api_scope_of(p_op) is null then perform public.fail('API_UNKNOWN_OP', '지원하지 않는 작업이에요', jsonb_build_object('op', left(p_op, 40))); end if;
    v_source := case when nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id' is not null then 'OAUTH' else 'SESSION' end;
  end if;
  v_dry := case p_op when 'curriculum_plan_preview' then true when 'curriculum_plan_apply' then false end;
  if p_op = 'curriculum_plan_apply' then                                       -- 〔C#7·N3〕 소유권 확인된 재생은 적용 한도 제외
    perform public.api_user_lock(v_uid);                                       -- ① 사용자(rate check 가 다시 잡아도 즉시)
    select x.slug into v_slug from public.api_plan_drafts d join public.rooms x on x.id = d.room_id
    where d.id = v_args ->> 'previewId' and d.user_id = v_uid;
    if v_slug is not null then perform public.room_lock(v_slug); end if;       -- ② 방(웹 직접 apply 와도 직렬화)
    v_replay := exists (select 1 from public.api_plan_drafts d                 -- ③ 잠금 뒤에 읽는다
                        where d.id = v_args ->> 'previewId' and d.user_id = v_uid and d.applied_at is not null);
    v_slug := null;                                                            --    (아래 디스패치가 다시 정한다)
  end if;
  -- ④ 사용자 잠금 → 집계(그 안). whoami 는 잠금 없이 분당 한도만 — 라우트가 HTTP 요청마다 부른다(〔C#6〕)
  perform public.api_rate_check(t.id, v_uid, p_op, v_dry, v_replay);

  begin
    -- 〔D14〕 스터디 해석: study|slug → slug (apply 는 초안의 방). 해석 오류도 디스패치 오류로 감사된다
    if p_op = 'curriculum_plan_apply' then
      select x.slug, x.id into v_slug, v_room from public.api_plan_drafts d join public.rooms x on x.id = d.room_id
      where d.id = v_args ->> 'previewId' and d.user_id = v_uid;
      if v_slug is null then perform public.fail('PREVIEW_NOT_FOUND', '미리보기를 찾을 수 없어요. 다시 미리 봐 주세요'); end if;
    elsif p_op in ('curriculum_get', 'curriculum_plan_preview', 'personal_create_many', 'personal_delete_many', 'exam_get_brief', 'exam_draft_put') then
      v_slug := public.api_resolve_study(v_uid, coalesce(v_args ->> 'study', v_args ->> 'slug'));
      select id into v_room from public.rooms where slug = v_slug;
    end if;
    v_data := case p_op
      when 'whoami' then jsonb_build_object('userId', v_uid::text, 'nickname', (select nickname from public.profiles where id = v_uid),
                           'source', lower(v_source), 'tokenName', t.name,
                           'scopes', to_jsonb(coalesce(t.scopes, array['curriculum:write', 'personal:write', 'read'])),
                           'expiresAt', public.iso(t.expires_at))
      when 'me_studies' then public.api_studies(v_uid, coalesce((v_args ->> 'includeEnded')::boolean, false))
      when 'me_schedule' then public.me_schedule((v_args ->> 'from')::date, (v_args ->> 'to')::date)
      when 'curriculum_get' then public.api_curriculum_view(public.curriculum_get(v_slug, coalesce((v_args ->> 'includeArchived')::boolean, false)), v_uid)
        || jsonb_build_object('version', public.curriculum_version(v_room),
             'viewer', jsonb_build_object('nickname', (select nickname from public.profiles where id = v_uid)),
             'currentRoundId', public.room_current_round_id(v_room, public.kst_today())::text,
             'fileCounts', coalesce(public.api_node_file_counts(v_room), '{}'::jsonb),
             'study', (select jsonb_build_object('slug', x.slug, 'title', x.title, 'status', lower(x.status),
                      'startDate', to_char(x.start_date, 'YYYY-MM-DD'), 'endDate', to_char(x.end_date, 'YYYY-MM-DD'))
             from public.rooms x where x.id = v_room))
      when 'curriculum_plan_preview' then public.curriculum_plan_preview(v_slug, v_args -> 'plan', v_args ->> 'undo')
      when 'curriculum_plan_apply' then public.curriculum_plan_apply(v_slug, v_args ->> 'previewId')
      when 'personal_create_many' then public.personal_create_many(v_slug, v_args -> 'round', v_args -> 'goals')
      when 'personal_delete_many' then public.personal_delete_many(v_slug, v_args -> 'ids')
      when 'exam_get_brief' then public.exam_brief_text(v_slug, (v_args ->> 'task')::bigint)
      when 'exam_draft_put' then public.exam_draft_put(v_slug, (v_args ->> 'task')::bigint, v_args -> 'exam')
    end;
    v_out := jsonb_build_object('ok', true, 'data', v_data);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_code = message_text, v_msg = pg_exception_detail, v_hint = pg_exception_hint;
    v_data := null;
    v_out := jsonb_build_object('ok', false, 'error', public.api_error_json(v_state, v_code, v_msg, v_hint));
  end;
  v_out := v_out || jsonb_build_object('meta', jsonb_strip_nulls(jsonb_build_object('expiresAt', public.iso(t.expires_at))));   -- 〔T4〕

  if p_op <> 'whoami' then
    v_ok := (v_out ->> 'ok')::boolean and coalesce((v_data ->> 'ok')::boolean, true);
    v_err := coalesce(v_out #>> '{error,code}', v_data #>> '{errors,0,code}');
    insert into public.api_audit (token_id, user_id, source, op, room_id, dry_run, ok, error_code, preview_id, summary, created_at)
    values (t.id, v_uid, v_source, p_op, v_room, v_dry, v_ok, case when not v_ok then left(v_err, 40) end,
            case when p_op like 'curriculum_plan_%' then (select x from (select coalesce(v_data ->> 'previewId', v_args ->> 'previewId') as x) z
                                                           where x ~ '^pv_[0-9a-f]{12}$') end,   -- 입력 그대로 싣지 않는다(형식 맞는 것만)
            case when p_op like 'curriculum_plan_%' then jsonb_strip_nulls(jsonb_build_object('summary', v_data -> 'summary', 'createdIds', v_data -> 'createdIds',   -- refs(사용자 라벨) 대신 id
                                                           'replayed', v_data -> 'replayed', 'undoOf', v_data -> 'undoOf'))
                 when p_op = 'personal_create_many' then jsonb_strip_nulls(jsonb_build_object('createdIds', v_data -> 'createdIds'))
                 when p_op = 'personal_delete_many' then jsonb_strip_nulls(jsonb_build_object(   -- 사용자 입력은 숫자 id 모양만(제목·자유 문자열 없음)
                   'ids', (select jsonb_agg(e) from jsonb_array_elements(case when jsonb_typeof(v_args -> 'ids') = 'array' then v_args -> 'ids' end) e
                           where e #>> '{}' ~ '^[0-9]{1,19}$'),
                   'deleted', v_data -> 'deleted'))
                 when p_op = 'exam_draft_put' then jsonb_strip_nulls(jsonb_build_object(   -- 문항 본문은 싣지 않는다(task id 모양 · 문항 수만)
                   'task', (select x from (select v_args ->> 'task' as x) z where x ~ '^[0-9]{1,19}$'),
                   'questionCount', v_data -> 'questionCount'))
                 else '{}'::jsonb end,
            public.app_now());
  end if;
  return v_out;
end $$;


-- ───────── 9. 알림 종류 EXAM_PUBLISHED (exam_publish 가 발행, 스펙 D11·§4.6) ─────────
-- 재정의: notification_kinds·notify_render·notify_link ← 0034(0035·0036 재정의 없음). 시그니처 동일 → GRANT(없음) 유지.
-- notify_enabled(최신 0025)는 그대로 — 알 수 없는 kind 는 else true.
-- notification_kinds (0034 판 그대로 + EXAM_PUBLISHED)
create or replace function public.notification_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['ROUND_STARTED', 'TASK_ALL_SUBMITTED', 'TASK_COMPLETION_DIGEST', 'JOIN_REQUESTED', 'JOIN_APPROVED', 'JOIN_REJECTED',
               'JOIN_EXPIRED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'SCHEDULE_CHANGED', 'ROOM_STARTED',
               'ROOM_ENDED', 'ROOM_START_BLOCKED', 'MEMBER_DEACTIVATED',
               'CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED', 'ROOM_PERIOD_CHANGED',
               -- 0024
               'ROUND_SCHEDULE_CHANGED', 'ROOM_ARCHIVED', 'PERSONAL_ARCHIVED', 'LEAVE_REQUESTED', 'LEAVE_REQUEST_DISMISSED', 'SUBMISSION_DIGEST'
               -- 0032
               , 'MEMBER_JOINED'
               -- 0034
               , 'CURRICULUM_BULK_UPDATED'
               -- 0037
               , 'EXAM_PUBLISHED']
$$;

-- notify_render (0034 판 그대로 + EXAM_PUBLISHED 제목·본문)
create or replace function public.notify_render(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_model jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_room  text;
  v_node  text;
  v_label text;
  v_actor text;
  v_title text;
  v_body  text;
  v_today date := public.kst_today();   -- 0024: 표기 기준(알림 생성일). format.ts 의 today 와 같은 역할
  v_os    date;   -- 0023 SCHEDULE_CHANGED·0024 ROUND_SCHEDULE_CHANGED: 옛 시작·마감, 새 시작·마감
  v_oe    date;
  v_ns    date;
  v_ne    date;
  v_diff  text;
  v_tasks int;
begin
  select title into v_room from public.rooms where id = p_room;
  select title, label into v_node, v_label from public.goal_nodes where id = p_node;
  select coalesce(nickname, '') into v_actor from public.profiles where id = p_actor;
  v_title := case p_kind
    when 'ROUND_STARTED'          then format('%s의 %s가 시작됐어요', v_room, coalesce(v_label, v_node))
    when 'TASK_ALL_SUBMITTED'     then format('"%s" 과제를 전원 제출했어요', v_node)
    when 'TASK_COMPLETION_DIGEST' then format('어제 %s개 과제가 전원 제출됐어요', coalesce(p_model ->> 'count', '0'))
    when 'JOIN_REQUESTED'         then format('%s님이 %s 참가를 신청했어요', v_actor, v_room)
    when 'JOIN_APPROVED'          then format('%s 참가가 승인됐어요', v_room)
    when 'JOIN_REJECTED'          then format('%s 참가 신청이 거절됐어요', v_room)
    when 'JOIN_EXPIRED'           then format('%s 참가 신청이 만료됐어요', v_room)
    when 'DEADLINE_REMINDER'      then format('"%s" 마감 %s일 전이에요', v_node, coalesce(p_model ->> 'days', '1'))
    when 'TASK_ASSIGNED'          then format('"%s" 과제 담당자로 지정됐어요', v_node)
    when 'TASK_UNASSIGNED'        then format('"%s" 과제 담당에서 제외됐어요', v_node)
    when 'SCHEDULE_CHANGED'       then format('%s 일정이 변경됐어요', v_room)
    when 'ROOM_STARTED'           then format('%s 스터디가 시작됐어요', v_room)
    when 'ROOM_ENDED'             then format('%s 스터디가 종료됐어요', v_room)
    when 'ROOM_START_BLOCKED'     then format('%s 시작일이 지났지만 말단 과제가 없어 시작하지 못했어요', v_room)
    when 'MEMBER_DEACTIVATED'     then format('%s 스터디에서 이탈 처리됐어요', v_room)
    when 'CURRICULUM_EDITOR_GRANTED' then '진행목표 편집 권한을 받았어요'
    when 'CURRICULUM_EDITOR_REVOKED' then '진행목표 편집 권한이 회수됐어요'
    when 'ROOM_PERIOD_CHANGED'    then format('%s 기간이 변경됐어요', v_room)
    -- 0024
    when 'ROUND_SCHEDULE_CHANGED' then format('%s 회차 일정이 변경됐어요', v_room)
    when 'ROOM_ARCHIVED'          then format('%s 스터디가 보관됐어요', v_room)
    when 'PERSONAL_ARCHIVED'      then format('그룹장이 "%s" 개인 목표를 보관했어요', v_node)
    when 'LEAVE_REQUESTED'        then format('%s님이 %s 탈퇴를 요청했어요', v_actor, v_room)
    when 'LEAVE_REQUEST_DISMISSED' then format('%s 탈퇴 요청이 반려됐어요', v_room)
    when 'SUBMISSION_DIGEST'      then format('어제 제출 %s건이 들어왔어요', coalesce(p_model ->> 'count', '0'))
    -- 0032
    when 'MEMBER_JOINED'          then format('%s님이 %s에 합류했어요', v_actor, v_room)
    -- 0034: 계획 적용·되돌리기 묶음(수신자당 1건). 방 제목은 따옴표 없이
    when 'CURRICULUM_BULK_UPDATED' then format('%s 진행목표가 한꺼번에 바뀌었어요', v_room)
    -- 0037
    when 'EXAM_PUBLISHED'         then format('%s 「%s」 시험이 열렸어요', v_room, v_node)   -- 스펙 §4.6
  end;
  -- 본문(0013): 방 제목은 프론트가 메타 줄에 따로 그리므로 본문에 넣지 않는다. 제목에 없는 정보만.
  -- 일정 변경(0023)·회차 일정 변경(0024): 바뀐 쪽만 — 마감만 '마감 옛 → 새', 시작만 '시작 옛 → 새', 둘 다 '기간 옛 범위 → 새 범위'.
  -- 날짜(0024): notify_date/notify_range — 0018·0023 의 'YY.MM.DD' 대신 format.ts 와 같은 규칙
  if p_kind in ('SCHEDULE_CHANGED', 'ROUND_SCHEDULE_CHANGED') then
    v_os := (p_model ->> 'oldStartDate')::date;
    v_oe := (p_model ->> 'oldEndDate')::date;
    v_ns := (p_model ->> 'startDate')::date;
    v_ne := (p_model ->> 'endDate')::date;
    v_diff := case
      when v_os is null or v_oe is null then null
      when v_os is not distinct from v_ns and v_oe is distinct from v_ne then '마감 ' || public.notify_date(v_oe, v_today) || ' → ' || public.notify_date(v_ne, v_today)
      when v_oe is not distinct from v_ne and v_os is distinct from v_ns then '시작 ' || public.notify_date(v_os, v_today) || ' → ' || public.notify_date(v_ns, v_today)
      else '기간 ' || public.notify_range(v_os, v_oe, v_today) || ' → ' || public.notify_range(v_ns, v_ne, v_today)
    end;
  end if;
  v_tasks := coalesce((p_model ->> 'tasks')::int, 1);
  v_body := case
    -- 0034: 새 과제·일정·담당 건수 중 0 이 아닌 것만
    when p_kind = 'CURRICULUM_BULK_UPDATED' then
      nullif(concat_ws(' · ',
        case when coalesce((p_model ->> 'newTasks')::int, 0) > 0 then '새 과제 ' || (p_model ->> 'newTasks') || '건' end,
        case when coalesce((p_model ->> 'schedule')::int, 0) > 0 then '일정 ' || (p_model ->> 'schedule') || '건' end,
        case when coalesce((p_model ->> 'assign')::int, 0) > 0 then '담당 ' || (p_model ->> 'assign') || '건' end), '')
    when p_kind = 'MEMBER_JOINED' then
      case p_model ->> 'via' when 'invite' then '초대로 바로 참가했어요' else '추가 모집으로 참가했어요' end
      || ' · 지정 과제 담당이 필요하면 진행목표에서 정해 주세요'
    when p_kind = 'ROOM_PERIOD_CHANGED' then
      coalesce(public.notify_range((p_model ->> 'oldStartDate')::date, (p_model ->> 'oldEndDate')::date, v_today) || ' → ', '')
      || public.notify_range((p_model ->> 'startDate')::date, (p_model ->> 'endDate')::date, v_today)
    when p_kind = 'ROUND_STARTED' and v_label is not null and v_node is distinct from v_label then v_node
    -- 0028: 묶음 이동 묶음 알림(과제 2개 이상). 묶음 시작만 바꿔도 하위 과제는 종료일까지 함께 옮겨지므로
    -- 0023 의 '시작/마감만' 축약(v_diff) 대신 항상 '기간 옛 범위 → 새 범위' (리뷰 M1)
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null and p_model ? 'bundle' then
      format('"%s" 과제 %s개 일정이 %s일 %s 옮겨졌어요', v_node, v_tasks, abs((p_model ->> 'days')::int),
             case when (p_model ->> 'days')::int < 0 then '앞으로' else '뒤로' end)
      || coalesce(' · 기간 ' || public.notify_range(v_os, v_oe, v_today) || ' → ' || public.notify_range(v_ns, v_ne, v_today), '')
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null and v_diff is not null then
      format('"%s" %s', v_node, v_diff)
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null then
      format('"%s"', v_node)
      || coalesce(' ' || public.notify_range((p_model ->> 'startDate')::date, (p_model ->> 'endDate')::date, v_today), '')
    when p_kind = 'ROUND_SCHEDULE_CHANGED' and p_node is not null then
      case when v_label is not null and v_label is distinct from v_node then format('%s "%s"', v_label, v_node) else coalesce(v_label, format('"%s"', v_node)) end
      || coalesce(' ' || v_diff, '')
      -- 0026: 과제와 개인 목표를 나눠 말한다(옛 모델 'moved' 만 있으면 0024 문구)
      || case
           when p_model ? 'movedTasks' then
             case when coalesce((p_model ->> 'movedTasks')::int, 0) + coalesce((p_model ->> 'movedPersonal')::int, 0) = 0 then ''
                  else ' · ' || concat_ws('·',
                         case when (p_model ->> 'movedTasks')::int > 0 then format('과제 %s개', p_model ->> 'movedTasks') end,
                         case when (p_model ->> 'movedPersonal')::int > 0 then format('개인 목표 %s개', p_model ->> 'movedPersonal') end)
                       || '도 함께 옮겼어요' end
           when coalesce((p_model ->> 'moved')::int, 0) > 0 then format(' · 과제 %s개도 함께 옮겼어요', p_model ->> 'moved')
           else '' end
    when p_kind = 'JOIN_REQUESTED'  then nullif(p_model ->> 'message', '')
    when p_kind = 'LEAVE_REQUESTED' then nullif(p_model ->> 'reason', '')
    when p_kind = 'ROOM_ARCHIVED'   then '내 스터디의 보관함에서 다시 볼 수 있어요'
    when p_kind = 'SUBMISSION_DIGEST' and p_node is not null then
      case when v_tasks <= 1 then format('"%s"', v_node) else format('"%s" 외 과제 %s개', v_node, v_tasks - 1) end
  end;
  -- 0037: 시험 발행 — 스펙 §4.6 "{방} 「{제목}」 시험이 열렸어요 · n문항 · ~MM.DD" 의 뒷부분(제목 · 본문 으로 나눠 그린다)
  if p_kind = 'EXAM_PUBLISHED' then
    v_body := format('%s문항 · ~%s', coalesce(p_model ->> 'count', '0'), to_char((select g.end_date from public.goal_nodes g where g.id = p_node), 'MM.DD'));
  end if;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

-- notify_link (0034 판 그대로 + EXAM_PUBLISHED → 과제 포커스)
create or replace function public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_node is not null and p_kind in ('TASK_ALL_SUBMITTED', 'SUBMISSION_DIGEST')
      then '/my-study/' || r.slug || '?task=' || p_node || '#submissions'
    when p_node is not null and p_kind in ('DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'PERSONAL_ARCHIVED', 'EXAM_PUBLISHED')   -- 0037: EXAM_PUBLISHED
      then '/my-study/' || r.slug || '?task=' || p_node
    -- 0028: 일정 변경 — 과제면 리프 포커스, 묶음(유형 없음)이면 진행목표 보기 상세
    when p_node is not null and p_kind = 'SCHEDULE_CHANGED'
      then '/my-study/' || r.slug || coalesce('?task=' || (select g.id from public.goal_nodes g where g.id = p_node and g.task_type is not null),
                                              '?tab=curriculum&item=' || p_node)
    when p_kind in ('CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED', 'ROUND_SCHEDULE_CHANGED', 'CURRICULUM_BULK_UPDATED')
      then '/my-study/' || r.slug || '?tab=curriculum'
    when r.leader_id = p_user and p_kind = 'JOIN_REQUESTED'  then '/my-study/' || r.slug || '#applications'
    when r.leader_id = p_user and p_kind = 'LEAVE_REQUESTED' then '/my-study/' || r.slug || '#leave-requests'
    when r.leader_id = p_user
      or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_user and m.status = 'ACTIVE')
      then '/my-study/' || r.slug
    else '/rooms/' || r.slug end
  from public.rooms r where r.id = p_room
$$;
