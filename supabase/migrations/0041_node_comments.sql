-- 0041_node_comments.sql — 2026-10-21 회차·과제 댓글 + 멘션 알림. 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-21-node-comments-mentions-design.md (D1~D24 권장안).
-- 추가형: 표 1개(node_comments, RPC 전용) + RPC 4개 + 알림 종류 MENTIONED.
-- 리뷰 결정:
--  · D15 링크 해시 — 발행 뒤 notifications 행을 UPDATE 하지 않는다. notify_publish 에 p_link_hash 를 받는 8인자 판을 새로 두고
--    0008 의 7인자 판은 같은 시그니처로 그 판에 null 을 넘기는 얇은 래퍼로 바꾼다(기존 호출부·GRANT(없음) 그대로).
--  · D4 시험 잠금 — exam_view 가 정답·해설을 여는 식(v_edit or exam_reveal_ok(x, n, a))을 그대로 쓴다. 담당자에게 정답이 아직
--    닫혀 있으면 댓글도 닫힌다(제출 뒤 after_deadline 시험은 마감까지 잠금 유지 — "허용 전엔 어떤 경로로도 못 읽는다").
-- 재정의 원본: notify_publish ← 0008 · notification_kinds·notify_render·notify_link ← 0040. 시그니처 동일 → GRANT(없음) 유지.
-- notify_enabled(최신 0024)는 그대로 — 알 수 없는 kind 는 else true(방 설정으로 끌 수 없는 개인 알림).
-- 절: 1 스키마 · 2 알림 발행(링크 해시) · 3 내부 헬퍼 · 4 읽기 RPC · 5 쓰기 RPC · 6 GRANT · 7 알림 종류

-- ───────── 1. 스키마 (스펙 §4) ─────────
create table public.node_comments (
  id           bigint generated always as identity primary key,
  room_id      bigint not null references public.rooms(id) on delete cascade,
  node_id      bigint not null references public.goal_nodes(id) on delete cascade,   -- D21 노드 삭제 = 댓글 삭제
  author_id    uuid   references public.profiles(id) on delete set null,
  body         text   not null default '' check (char_length(body) <= 4000),        -- 토큰 포함 하드 상한. 표시 길이 1~2000 은 RPC 가 검사
  mention_ids  uuid[] not null default '{}',                                         -- 본문 토큰의 고유 uid(≤10). 알림 diff·정리용
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),                                  -- 본문이 바뀔 때만
  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles(id) on delete set null,
  check ((deleted_at is null) or (body = '' and mention_ids = '{}'))
);
create index node_comments_node_idx   on public.node_comments (node_id, id) where deleted_at is null;
create index node_comments_author_idx on public.node_comments (author_id, created_at);   -- 레이트 리밋(D18)

alter table public.node_comments enable row level security;
revoke all on public.node_comments from anon, authenticated;   -- 정책 없음 = RPC 전용

-- ───────── 2. 알림 발행 — 링크 해시(D15) ─────────
-- 8인자 판: 0008 판 그대로 + p_link_hash(앞의 '#' 없이, 예: 'comment-12'). null 이면 0008 과 같은 링크
create or replace function public.notify_publish(
  p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb, p_link_hash text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_tpl  jsonb;
  v_r    uuid;
  v_n    int := 0;
  v_c    int;
  v_key  text;
begin
  if p_kind is null or not (p_kind = any(public.notification_kinds())) then
    perform public.fail('VALIDATION_FAILED', '알 수 없는 알림 종류예요', jsonb_build_object('kind', p_kind));
  end if;
  if p_room is null then perform public.fail('VALIDATION_FAILED', '알림에는 방이 필요해요', jsonb_build_object('kind', p_kind)); end if;
  if coalesce(cardinality(p_recipients), 0) = 0 then return 0; end if;
  if not public.notify_enabled(p_kind, p_room, coalesce(p_model, '{}'::jsonb)) then return 0; end if;

  v_tpl := public.notify_render(p_kind, p_room, p_node, p_actor, coalesce(p_model, '{}'::jsonb));

  for v_r in select distinct u from unnest(p_recipients) u where u is not null and u is distinct from p_actor loop
    v_key := null;
    if p_dedupe_prefix is not null then
      v_key := p_dedupe_prefix || ':' || v_r;
      if length(v_key) > 160 then v_key := 'h:' || md5(p_dedupe_prefix) || ':' || v_r; end if;   -- 수신자 uuid 는 자르지 않는다
    end if;
    insert into public.notifications (user_id, kind, title, body, room_id, node_id, actor_user_id, link, dedupe_key)
    values (v_r, p_kind, v_tpl ->> 'title', v_tpl ->> 'body', p_room, p_node, p_actor,
            public.notify_link(p_kind, p_room, p_node, v_r) || coalesce('#' || nullif(p_link_hash, ''), ''), v_key)
    on conflict (dedupe_key) do nothing;
    get diagnostics v_c = row_count;
    v_n := v_n + v_c;
  end loop;
  return v_n;
end $$;

-- 7인자 판(0008 시그니처 그대로): 해시 없는 8인자 판으로 위임 — 기존 호출부 동작 불변
create or replace function public.notify_publish(
  p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb)
returns int language plpgsql security definer set search_path = '' as $$
begin
  return public.notify_publish(p_kind, p_room, p_node, p_actor, p_recipients, p_dedupe_prefix, p_model, null::text);
end $$;

-- ───────── 3. 내부 헬퍼 (GRANT 없음) ─────────
-- 상한(D7·D17·D18) — comment_list.limits 와 쓰기 검사가 같은 값을 본다
create or replace function public.comment_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"bodyMax":2000,"mentionsMax":10,"perNode":1000,"perMinute":10,"perHour":120,"page":50,"fromMax":200}'::jsonb
$$;

-- 멘션 토큰 <@uuid>(소문자 uuid). 다른 모양의 <@…> 는 평문
create or replace function public.comment_token_re() returns text
language sql immutable set search_path = '' as $$
  select '<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>'
$$;

-- D1 대상 노드: 회차(depth 2) · 팀 과제 리프(COMMON·DESIGNATED — 시험 포함). 묶음·개인 목표는 아님
create or replace function public.comment_target_ok(n public.goal_nodes) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(n.depth = 2 and n.parent_id is null, false) or coalesce(n.task_type in ('COMMON', 'DESIGNATED'), false)
$$;

-- 열람자(D2): 그룹장 · ACTIVE · INACTIVE 멤버(notice_reader_room 과 같은 순서·코드, 문구만 댓글용)
create or replace function public.comment_reader_room(p_slug text) returns public.rooms
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  r     public.rooms;
  v_st  text;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.leader_id = v_uid then return r; end if;
  select m.status into v_st from public.room_members m where m.room_id = r.id and m.user_id = v_uid;
  if v_st in ('ACTIVE', 'INACTIVE') then return r; end if;
  if v_st = 'PENDING' then
    perform public.fail('NOT_MEMBER', '참가가 승인되면 댓글을 볼 수 있어요', '{"state":"pending"}'::jsonb);
  end if;
  perform public.fail('NOT_MEMBER', '참가 중인 방이 아니에요');
end $$;

-- 방 열람 + 노드가 그 방 소속 ∧ 댓글 대상(D1). 아니면 NODE_NOT_FOUND(보관 노드는 읽기 가능 — D20)
create or replace function public.comment_reader(p_slug text, p_node bigint, out r public.rooms, out n public.goal_nodes)
language plpgsql stable security definer set search_path = '' as $$
begin
  r := public.comment_reader_room(p_slug);
  select * into n from public.goal_nodes g where g.id = p_node and g.room_id = r.id;
  if not found or not public.comment_target_ok(n) then
    perform public.fail('NODE_NOT_FOUND', '댓글을 달 수 없는 항목이에요', jsonb_build_object('nodeId', p_node::text));
  end if;
end $$;

-- D4 시험 잠금: 시험 리프에서 보는 사람이 담당자인데 정답·해설이 아직 닫혀 있으면 잠금.
-- 판정식은 exam_view 의 v_reveal(= 편집자 or exam_reveal_ok(x, n, a)) 그대로 — 시험 노출 규칙을 한 곳에 둔다
create or replace function public.comment_exam_locked(n public.goal_nodes, p_uid uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  x public.exams;
  r public.rooms;
  a public.exam_attempts;
begin
  select * into x from public.exams where node_id = n.id;
  if not found then return false; end if;
  select * into r from public.rooms where id = n.room_id;
  if coalesce(public.can_edit_curriculum(r, p_uid), false) then return false; end if;
  if p_uid is null or not public.is_task_assignee(n.id, p_uid) then return false; end if;
  select * into a from public.exam_attempts where node_id = n.id and user_id = p_uid;
  return not public.exam_reveal_ok(x, n, a);
end $$;

-- 쓰기 가능 여부(D3·D4·D20). null = 가능, 아니면 이유 — ended · archived_node · inactive · exam_locked
create or replace function public.comment_writable(r public.rooms, n public.goal_nodes, p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when r.archived_at is not null or r.status not in ('DRAFT', 'RECRUIT', 'ACTIVE') then 'ended'
    when n.archived_at is not null then 'archived_node'
    when r.leader_id is distinct from p_uid and not exists (
      select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_uid and m.status = 'ACTIVE') then 'inactive'
    when public.comment_exam_locked(n, p_uid) then 'exam_locked'
    else null end
$$;

-- 쓰기 관문: 이유 → 오류 코드
create or replace function public.comment_assert_writable(r public.rooms, n public.goal_nodes, p_uid uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_why text := public.comment_writable(r, n, p_uid);
begin
  if v_why = 'ended' then
    perform public.fail('ROOM_NOT_EDITABLE', '종료된 스터디는 댓글을 쓸 수 없어요', jsonb_build_object('reason', v_why, 'status', lower(r.status)));
  elsif v_why = 'archived_node' then
    perform public.fail('ROOM_NOT_EDITABLE', '보관된 항목에는 댓글을 쓸 수 없어요', jsonb_build_object('reason', v_why));
  elsif v_why = 'inactive' then
    perform public.fail('NOT_MEMBER', '이탈한 스터디에는 댓글을 쓸 수 없어요', '{"state":"inactive"}'::jsonb);
  elsif v_why = 'exam_locked' then
    perform public.fail('COMMENT_LOCKED', '시험을 제출하면 댓글을 볼 수 있어요', '{"reason":"exam"}'::jsonb);
  end if;
end $$;

-- 토큰 추출: 표시 길이(토큰 = 1자) · 고유 uid(처음 나온 순서)
create or replace function public.comment_parse(p_body text, out display_len int, out ids uuid[])
language sql immutable set search_path = '' as $$
  select char_length(regexp_replace(p_body, public.comment_token_re(), '@', 'g')),
         coalesce((select array_agg(s.u order by s.o)
                   from (select t.m[1]::uuid as u, min(t.o) as o
                         from regexp_matches(p_body, public.comment_token_re(), 'g') with ordinality as t(m, o)
                         group by t.m[1]) s), '{}'::uuid[])
$$;

-- 사람 맵 {uid: Person} — 그 방의 그룹장 또는 room_members 행이 있는 사람만(임의 uuid 로 닉네임을 캐지 못하게)
create or replace function public.comment_people(p_room bigint, p_ids uuid[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(p.id::text, public.person_json(p.id)), '{}'::jsonb)
  from public.profiles p join public.rooms r on r.id = p_room
  where p.id = any(coalesce(p_ids, '{}'))
    and (r.leader_id = p.id or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = p.id))
$$;

-- 알림 발췌(D13): 토큰 → @닉네임(방과 무관한 uid 는 @알 수 없음), 공백 접기, ≤80자
create or replace function public.comment_excerpt(p_room bigint, p_body text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_txt text := p_body;
  v_ppl jsonb := public.comment_people(p_room, (public.comment_parse(p_body)).ids);
  v_id  text;
begin
  for v_id in select distinct t.m[1] from regexp_matches(p_body, public.comment_token_re(), 'g') as t(m) loop
    v_txt := replace(v_txt, '<@' || v_id || '>', '@' || coalesce(v_ppl -> v_id ->> 'nickname', '알 수 없음'));
  end loop;
  v_txt := btrim(regexp_replace(v_txt, '\s+', ' ', 'g'));
  return case when char_length(v_txt) > 80 then left(v_txt, 79) || '…' else v_txt end;
end $$;

-- Comment JSON (스펙 §5). p_can_write = 보는 사람이 이 노드에 쓸 수 있는지(comment_writable is null) · p_leader = 그룹장
create or replace function public.comment_json(c public.node_comments, p_viewer uuid, p_can_write boolean, p_leader boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id::text, 'body', c.body,
    'author', case when c.author_id is null then null else public.person_json(c.author_id) end,
    'createdAt', public.iso(c.created_at), 'updatedAt', public.iso(c.updated_at),
    'edited', c.updated_at > c.created_at + interval '1 minute',
    'mine', c.author_id is not distinct from p_viewer and p_viewer is not null,
    'canEdit', p_can_write and c.author_id is not distinct from p_viewer and p_viewer is not null,
    'canDelete', p_can_write and ((c.author_id is not distinct from p_viewer and p_viewer is not null) or p_leader))
$$;

-- 입력 검증(D7): 문자열 · 공백뿐 아님 · 표시 길이 ≤2000 · 저장 길이 ≤4000 · 멘션 ≤10. 반환 = (앞뒤 공백 정리한 본문, 멘션 uid)
create or replace function public.comment_validate(p_body text, out body text, out ids uuid[])
language plpgsql immutable set search_path = '' as $$
declare
  v_lim jsonb := public.comment_limits();
  v_len int;
begin
  body := btrim(coalesce(p_body, ''), E' \t\r\n');
  if body = '' then
    perform public.fail('VALIDATION_FAILED', '댓글 내용을 입력해 주세요', '{"field":"body"}'::jsonb);
  end if;
  select p.display_len, p.ids into v_len, ids from public.comment_parse(body) p;
  if v_len > (v_lim ->> 'bodyMax')::int or char_length(body) > 4000 then
    perform public.fail('VALIDATION_FAILED', '댓글은 2,000자까지예요', jsonb_build_object('field', 'body', 'max', (v_lim ->> 'bodyMax')::int));
  end if;
  if cardinality(ids) > (v_lim ->> 'mentionsMax')::int then
    perform public.fail('VALIDATION_FAILED', '한 댓글에서 10명까지 부를 수 있어요', jsonb_build_object('field', 'mentions', 'max', (v_lim ->> 'mentionsMax')::int));
  end if;
end $$;

-- 레이트 리밋(D18): 작성자당 1분 10개 · 1시간 120개(방 무관, 지운 댓글 포함 — 쓰고 지우기 반복 방지).
-- advisory 잠금으로 같은 사용자의 동시 작성이 같은 카운트를 보지 않게 한다
create or replace function public.comment_rate_check(p_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_lim  jsonb := public.comment_limits();
  v_now  timestamptz := public.app_now();
  v_m    int;
  v_h    int;
  v_old  timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('sgtudy.comment:' || p_uid::text, 0));
  select count(*) filter (where c.created_at > v_now - interval '1 minute')::int, count(*)::int into v_m, v_h
  from public.node_comments c where c.author_id = p_uid and c.created_at > v_now - interval '1 hour';
  if v_m >= (v_lim ->> 'perMinute')::int then
    select min(c.created_at) into v_old from public.node_comments c where c.author_id = p_uid and c.created_at > v_now - interval '1 minute';
    perform public.fail('RATE_LIMITED', '댓글을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 minute' - v_now))::int), 'window', 'minute'));
  end if;
  if v_h >= (v_lim ->> 'perHour')::int then
    select min(c.created_at) into v_old from public.node_comments c where c.author_id = p_uid and c.created_at > v_now - interval '1 hour';
    perform public.fail('RATE_LIMITED', '댓글을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 hour' - v_now))::int), 'window', 'hour'));
  end if;
end $$;

-- 멘션 알림(D11·D12·D13·D14·D15): 수신 = p_new ∩ (그룹장 ∪ ACTIVE). 작성자 본인은 notify_publish 가 뺀다.
-- dedupe = MENTIONED:{commentId}:{uid} → 같은 댓글에서 같은 사람은 1건. 링크 = notify_link + #comment-{id}
create or replace function public.comment_notify(c public.node_comments, p_actor uuid, p_new uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_rcpt uuid[];
  v_exam boolean := exists (select 1 from public.exams x where x.node_id = c.node_id);
begin
  select coalesce(array_agg(u.id), '{}') into v_rcpt
  from unnest(coalesce(p_new, '{}')) as u(id) join public.rooms r on r.id = c.room_id
  where r.leader_id = u.id
     or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = u.id and m.status = 'ACTIVE');
  return public.notify_publish('MENTIONED', c.room_id, c.node_id, p_actor, v_rcpt, 'MENTIONED:' || c.id,
                               jsonb_build_object('commentId', c.id::text,
                                                  'excerpt', case when v_exam then null else public.comment_excerpt(c.room_id, c.body) end),
                               'comment-' || c.id);
end $$;

-- 한 쪽(items) 응답: 사람 맵은 items 의 멘션 uid 만
create or replace function public.comment_items(p_rows public.node_comments[], p_viewer uuid, p_can_write boolean, p_leader boolean,
                                                out items jsonb, out people jsonb)
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_agg(public.comment_json(c, p_viewer, p_can_write, p_leader) order by c.id) from unnest(p_rows) c), '[]'::jsonb),
         public.comment_people((select c.room_id from unnest(p_rows) c limit 1),
                               (select array_agg(distinct u) from unnest(p_rows) c, unnest(c.mention_ids) u))
$$;

-- ───────── 4. 읽기 RPC ─────────
-- 오래된 → 최신. 기본 = 최신 50. p_before = 그 id 보다 오래된 50. p_from = 그 댓글부터 최신까지(≤200 — 넘으면 앞 100 + 그 댓글 + 뒤 99, hasNewer).
-- p_from 이 지워졌거나 없으면 target.state 로 알리고 기본 쪽을 준다. 시험 잠금이면 items·people 비움 + total 만(D4)
create or replace function public.comment_list(p_slug text, p_node bigint, p_before bigint default null, p_from bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v       record;
  r       public.rooms;
  n       public.goal_nodes;
  v_uid   uuid := public.current_user_id();
  v_lim   jsonb := public.comment_limits();
  v_page  int := (v_lim ->> 'page')::int;
  v_max   int := (v_lim ->> 'fromMax')::int;
  v_why   text;
  v_total int;
  v_tgt   public.node_comments;
  v_state text;
  v_rows  public.node_comments[];
  v_newer boolean := false;
  v_pg    record;
begin
  select * into v from public.comment_reader(p_slug, p_node);   -- OUT 2개 → record 로 받아 나눈다
  r := v.r;
  n := v.n;
  v_why := public.comment_writable(r, n, v_uid);
  select count(*)::int into v_total from public.node_comments c where c.node_id = n.id and c.deleted_at is null;

  if v_why = 'exam_locked' then
    return jsonb_build_object('items', '[]'::jsonb, 'people', '{}'::jsonb, 'hasOlder', false, 'hasNewer', false, 'total', v_total,
                              'canWrite', false, 'writeBlock', v_why, 'locked', '{"reason":"exam"}'::jsonb, 'target', null,
                              'limits', v_lim);
  end if;

  if p_from is not null then
    select * into v_tgt from public.node_comments c where c.id = p_from and c.node_id = n.id;
    v_state := case when not found then 'missing' when v_tgt.deleted_at is not null then 'deleted' else 'ok' end;
  end if;

  if v_state = 'ok' then
    if (select count(*) from public.node_comments c where c.node_id = n.id and c.deleted_at is null and c.id >= p_from) <= v_max then
      select array_agg(c order by c.id) into v_rows from public.node_comments c where c.node_id = n.id and c.deleted_at is null and c.id >= p_from;
    else
      v_newer := true;
      select array_agg(c order by c.id) into v_rows from public.node_comments c
      where c.id in ((select x.id from public.node_comments x where x.node_id = n.id and x.deleted_at is null and x.id < p_from order by x.id desc limit v_max / 2)
                     union all
                     (select x.id from public.node_comments x where x.node_id = n.id and x.deleted_at is null and x.id >= p_from order by x.id limit v_max / 2));
    end if;
  else
    select array_agg(c order by c.id) into v_rows from public.node_comments c
    where c.id in (select x.id from public.node_comments x
                   where x.node_id = n.id and x.deleted_at is null and (p_before is null or x.id < p_before)
                   order by x.id desc limit v_page);
  end if;

  select * into v_pg from public.comment_items(coalesce(v_rows, '{}'), v_uid, v_why is null, r.leader_id = v_uid);
  return jsonb_build_object(
    'items', v_pg.items, 'people', v_pg.people,
    'hasOlder', exists (select 1 from public.node_comments c where c.node_id = n.id and c.deleted_at is null
                        and c.id < coalesce((select min(x.id) from unnest(v_rows) x), p_before, 9223372036854775807)),
    'hasNewer', v_newer,
    'total', v_total,
    'canWrite', v_why is null,
    'writeBlock', v_why,
    'locked', null,
    'target', case when p_from is null then null else jsonb_build_object('id', p_from::text, 'state', v_state) end,
    'limits', v_lim);
end $$;

-- ───────── 5. 쓰기 RPC ─────────
-- 작성: 쓰기 가능(D3·D4·D20) → 리밋(D18) → 검증(D7) → 노드당 상한 → insert → 멘션 알림
create or replace function public.comment_create(p_slug text, p_node bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v     record;
  r     public.rooms;
  n     public.goal_nodes;
  v_uid uuid := public.current_user_id();
  v_in  record;
  c     public.node_comments;
begin
  select * into v from public.comment_reader(p_slug, p_node);
  r := v.r;
  n := v.n;
  perform public.comment_assert_writable(r, n, v_uid);
  perform public.comment_rate_check(v_uid);
  select * into v_in from public.comment_validate(p_body);
  if (select count(*) from public.node_comments x where x.node_id = n.id and x.deleted_at is null) >= (public.comment_limits() ->> 'perNode')::int then
    perform public.fail('COMMENT_LIMIT', '이 항목의 댓글이 가득 찼어요', jsonb_build_object('kind', 'perNode', 'max', (public.comment_limits() ->> 'perNode')::int));
  end if;
  insert into public.node_comments (room_id, node_id, author_id, body, mention_ids, created_at, updated_at)
  values (r.id, n.id, v_uid, v_in.body, v_in.ids, public.app_now(), public.app_now())
  returning * into c;
  perform public.comment_notify(c, v_uid, c.mention_ids);
  return jsonb_build_object('comment', public.comment_json(c, v_uid, true, r.leader_id = v_uid),
                            'people', public.comment_people(r.id, c.mention_ids));
end $$;

-- 이 방의 살아 있는 댓글 + 그 노드(쓰기 RPC 공용). 다른 방·지운 댓글 = COMMENT_NOT_FOUND
create or replace function public.comment_row(r public.rooms, p_id bigint, out c public.node_comments, out n public.goal_nodes)
language plpgsql security definer set search_path = '' as $$
begin
  select * into c from public.node_comments x where x.id = p_id and x.room_id = r.id and x.deleted_at is null for update;
  if not found then perform public.fail('COMMENT_NOT_FOUND', '댓글을 찾을 수 없어요', jsonb_build_object('commentId', p_id::text)); end if;
  select * into n from public.goal_nodes g where g.id = c.node_id;
end $$;

-- 수정(D8): 본인만(그룹장도 남의 댓글은 못 고친다). updated_at 은 본문이 바뀔 때만. 알림 = 새로 멘션된 사람만(D14)
create or replace function public.comment_update(p_slug text, p_id bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms := public.comment_reader_room(p_slug);
  v_uid uuid := public.current_user_id();
  v     record;
  c     public.node_comments;
  n     public.goal_nodes;
  v_in  record;
  v_old uuid[];
begin
  select * into v from public.comment_row(r, p_id);
  c := v.c;
  n := v.n;
  if c.author_id is distinct from v_uid then perform public.fail('NOT_AUTHOR', '내가 쓴 댓글만 고칠 수 있어요'); end if;
  perform public.comment_assert_writable(r, n, v_uid);
  select * into v_in from public.comment_validate(p_body);
  v_old := c.mention_ids;
  update public.node_comments x set
    body        = v_in.body,
    mention_ids = v_in.ids,
    updated_at  = case when v_in.body is distinct from x.body then public.app_now() else x.updated_at end
  where x.id = c.id
  returning * into c;
  perform public.comment_notify(c, v_uid, array(select u from unnest(c.mention_ids) u where not (u = any(v_old))));
  return jsonb_build_object('comment', public.comment_json(c, v_uid, true, r.leader_id = v_uid),
                            'people', public.comment_people(r.id, c.mention_ids));
end $$;

-- 삭제(D8·D9): 본인 또는 그룹장. 소프트 삭제(본문·멘션 비움) + 그 댓글의 안 읽은 MENTIONED 알림 정리
create or replace function public.comment_delete(p_slug text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms := public.comment_reader_room(p_slug);
  v_uid uuid := public.current_user_id();
  v     record;
  c     public.node_comments;
  n     public.goal_nodes;
begin
  select * into v from public.comment_row(r, p_id);
  c := v.c;
  n := v.n;
  if c.author_id is distinct from v_uid and r.leader_id is distinct from v_uid then
    perform public.fail('NOT_AUTHOR', '내가 쓴 댓글만 지울 수 있어요');
  end if;
  perform public.comment_assert_writable(r, n, v_uid);
  update public.node_comments x set body = '', mention_ids = '{}', deleted_at = public.app_now(), deleted_by = v_uid where x.id = c.id;
  delete from public.notifications o
  where o.kind = 'MENTIONED' and o.dedupe_key like 'MENTIONED:' || c.id || ':%' and o.read_at is null;
end $$;

-- ───────── 6. GRANT (공개 RPC 만 — comment_* 헬퍼·8인자 notify_publish 는 GRANT 없음) ─────────
grant execute on function public.comment_list(text, bigint, bigint, bigint) to authenticated;
grant execute on function public.comment_create(text, bigint, text)         to authenticated;
grant execute on function public.comment_update(text, bigint, text)         to authenticated;
grant execute on function public.comment_delete(text, bigint)               to authenticated;

-- ───────── 7. 알림 종류 MENTIONED (comment_create·comment_update 가 comment_notify 로 발행, 스펙 D13) ─────────
-- 재정의: notification_kinds·notify_render·notify_link ← 0040. 시그니처 동일 → GRANT(없음) 유지.
-- notification_kinds (0040 판 그대로 + MENTIONED)
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
               , 'EXAM_PUBLISHED'
               -- 0040
               , 'NOTICE_POSTED'
               -- 0041
               , 'MENTIONED']
$$;

-- notify_render (0040 판 그대로 + MENTIONED 제목·본문)
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
    -- 0040: 공지 제목은 모델에 담아 온다(노드 없음). 본문 없음 — 방 제목은 프론트가 메타 줄에 그린다(0013)
    when 'NOTICE_POSTED'          then format('%s 새 공지: %s', v_room, p_model ->> 'title')
    -- 0041: 댓글 멘션(스펙 D13). 작성자 닉네임은 발행 시점 스냅샷
    when 'MENTIONED'              then format('%s님이 댓글에서 회원님을 언급했어요', v_actor)
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
    -- 0041: 「노드」 · 발췌(≤80자, 토큰은 @닉네임). 시험 리프는 발췌 없음(comment_notify 가 excerpt 를 비운다)
    when p_kind = 'MENTIONED' then
      format('「%s」', coalesce(v_label, v_node)) || coalesce(' · ' || nullif(p_model ->> 'excerpt', ''), '')
    when p_kind = 'SUBMISSION_DIGEST' and p_node is not null then
      case when v_tasks <= 1 then format('"%s"', v_node) else format('"%s" 외 과제 %s개', v_node, v_tasks - 1) end
  end;
  -- 0037: 시험 발행 — 스펙 §4.6 "{방} 「{제목}」 시험이 열렸어요 · n문항 · ~MM.DD" 의 뒷부분(제목 · 본문 으로 나눠 그린다)
  if p_kind = 'EXAM_PUBLISHED' then
    v_body := format('%s문항 · ~%s', coalesce(p_model ->> 'count', '0'), to_char((select g.end_date from public.goal_nodes g where g.id = p_node), 'MM.DD'));
  end if;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

-- notify_link (0040 판 그대로 + MENTIONED → 리프 ?task= · 회차 ?tab=curriculum&item=). #comment-{id} 는 notify_publish 의 p_link_hash 가 붙인다
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
    -- 0041: 댓글 멘션 — 과제 리프면 리프 포커스, 회차면 진행목표 보기 상세
    when p_node is not null and p_kind = 'MENTIONED'
      then '/my-study/' || r.slug || coalesce('?task=' || (select g.id from public.goal_nodes g where g.id = p_node and g.task_type is not null),
                                              '?tab=curriculum&item=' || p_node)
    when p_kind = 'NOTICE_POSTED' then '/my-study/' || r.slug || '?tab=notice'   -- 0040 (스펙 D14)
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
