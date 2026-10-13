-- 0004_rooms.sql — 방 생성/수정/상태 전환 · 목록/상세 집계 (플랜 02 Task 1~4)
-- 배포 후 수정 금지.

-- 0001 테이블에 남은 Supabase 기본 쓰기 GRANT 제거(D7, RLS 뒤 다층 방어). 쓰기는 DEFINER RPC 만.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

-- ───────── 알림 자리표 (0008 이 같은 시그니처로 CREATE OR REPLACE) ─────────
-- p_dedupe_prefix: '<KIND>:<room_id>[:<extra>]'. 0008 은 prefix || ':' || recipient 를 dedupe_key 로 쓴다.
create or replace function public.notify_publish(
  p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb)
returns int language sql security definer set search_path = '' as $$
  select 0
$$;

-- ───────── 방 헬퍼 ─────────
-- 방 행을 FOR UPDATE 로 잠근다. 모든 쓰기 함수의 첫 줄. 없으면 ROOM_NOT_FOUND(비공개 방도 같은 코드 — D7)
create or replace function public.room_lock(p_slug text) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug for update;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  return r;
end $$;

-- 읽기 가능 여부: 그룹장 | 멤버(ACTIVE·INACTIVE·PENDING) | (보관 아님 ∧ DRAFT 아님 ∧ (공개 | 유효 초대 토큰))
create or replace function public.room_readable(p_room bigint, p_uid uuid, p_token text default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r where r.id = p_room and (
         (p_uid is not null and r.leader_id = p_uid)
      or (p_uid is not null and exists (
            select 1 from public.room_members m
            where m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE','INACTIVE','PENDING')))
      or (r.archived_at is null and r.status <> 'DRAFT' and (
            r.visibility = 'PUBLIC'
         or (p_token is not null and exists (
               select 1 from public.room_invites i
               where i.room_id = r.id and i.token = p_token and i.revoked_at is null))))))
$$;

-- 보관 아닌 리프별 (유효 배정 수, 그중 제출 수). 회차·방 집계는 이걸 합산한다(02 §4.1)
create or replace function public.room_leaf_stats(p_room bigint)
returns table (node_id bigint, round_id bigint, parent_id bigint, title text, task_type text,
               start_date date, end_date date, sort_order int, asg int, sub int)
language sql stable security definer set search_path = '' as $$
  select n.id, n.round_id, n.parent_id, n.title::text, n.task_type::text, n.start_date, n.end_date, n.sort_order,
         count(a.id)::int, count(s.id)::int
  from public.goal_nodes n
  left join public.task_assignments a on a.node_id = n.id and a.released_at is null
  left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
  where n.room_id = p_room and n.task_type is not null and n.archived_at is null
  group by n.id
$$;

-- me.state: null(비로그인) | leader | active | pending | inactive | none(REJECTED·CANCELED·EXPIRED·행 없음)
create or replace function public.room_me_json(p_room bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when p_uid is null then null
    when exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = p_uid) then jsonb_build_object('state', 'leader')
    else jsonb_build_object('state', coalesce((
      select case m.status when 'ACTIVE' then 'active' when 'PENDING' then 'pending' when 'INACTIVE' then 'inactive' else 'none' end
      from public.room_members m where m.room_id = p_room and m.user_id = p_uid), 'none'))
  end
$$;

-- RoomDetail.members: ACTIVE 전원 + INACTIVE + 내 PENDING 행. 그룹장 먼저, 그다음 참가 확정 순
create or replace function public.room_members_json(p_room bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           public.person_json(m.user_id)
           || jsonb_build_object('role', lower(m.role), 'status', lower(m.status), 'joinedAt', public.iso(m.joined_at))
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  from public.room_members m
  where m.room_id = p_room
    and (m.status in ('ACTIVE', 'INACTIVE') or (m.status = 'PENDING' and m.user_id = p_uid))
$$;

-- 활성 초대 토큰을 돌려주고, 없으면 만든다(I10: 방당 활성 토큰 1개). 토큰 = uuid 의 32 hex
create or replace function public.invite_ensure(p_room bigint, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  select token into v_token from public.room_invites where room_id = p_room and revoked_at is null;
  if v_token is null then
    -- 동시 요청이면 ux_room_invites_active 에 걸린다 → 23505 원문 대신 이긴 쪽 토큰을 다시 읽는다 (D9)
    insert into public.room_invites (token, room_id, created_by)
    values (replace(gen_random_uuid()::text, '-', ''), p_room, p_by)
    on conflict do nothing;
    select token into v_token from public.room_invites where room_id = p_room and revoked_at is null;
  end if;
  return v_token;
end $$;

-- 정원 원자 증감 (D3). 자리 없으면 ROOM_FULL
create or replace function public.room_take_seat(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  update public.rooms set member_count = member_count + 1, updated_at = now()
  where id = p_room and member_count < max_members
  returning id into v_id;
  if v_id is null then perform public.fail('ROOM_FULL', '정원이 찼어요', '{"field":"maxMembers"}'::jsonb); end if;
end $$;

create or replace function public.room_release_seat(p_room bigint) returns void
language sql security definer set search_path = '' as $$
  update public.rooms set member_count = greatest(member_count - 1, 0), updated_at = now() where id = p_room
$$;

-- ───────── 회차 집계 (플랜 03 이 0006 에서 CREATE OR REPLACE 로 본문을 바꿀 수 있다 — 시그니처 고정) ─────────
create or replace function public.room_round_stats(p_room bigint)
returns table (round_id bigint, label text, title text, start_date date, end_date date, sort_order int, leaf_count int, asg int, sub int)
language sql stable security definer set search_path = '' as $$
  select n.id, n.label::text, n.title::text, n.start_date, n.end_date, n.sort_order,
         count(l.node_id)::int, coalesce(sum(l.asg), 0)::int, coalesce(sum(l.sub), 0)::int
  from public.goal_nodes n
  left join public.room_leaf_stats(p_room) l on l.round_id = n.id
  where n.room_id = p_room and n.depth = 2 and n.archived_at is null
  group by n.id
$$;

-- 현재 회차: 오늘을 포함하는 회차 중 start 가 가장 늦은 것, 없으면 직전 회차 (roomview §3.3). room_detail_json 과 같은 규칙
create or replace function public.room_current_round_id(p_room bigint, p_today date) returns bigint
language sql stable security definer set search_path = '' as $$
  select n.id from public.goal_nodes n
  where n.room_id = p_room and n.depth = 2 and n.archived_at is null and n.start_date <= p_today
  order by (n.end_date >= p_today) desc, n.start_date desc, n.sort_order desc
  limit 1
$$;

-- 태그 배열 [{slug,label,tone,auto}] (room_detail_json 이 사용)
create or replace function public.room_tags_json(p_room bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'label', t.label, 'tone', t.tone, 'auto', rt.source = 'AUTO')
                            order by rt.sort_order, t.slug), '[]'::jsonb)
  from public.room_tags rt join public.tags t on t.slug = rt.tag_slug
  where rt.room_id = p_room
$$;

-- ───────── RoomDetail JSON (03-api §2) ─────────
create or replace function public.room_detail_json(p_room bigint, p_uid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r          public.rooms;
  v_today    date := public.kst_today();
  v_is_leader boolean;
  v_does_tasks boolean;        -- 내가 담당 자격(ACTIVE 멤버, 그룹장은 leader_does_tasks)
  v_tags     jsonb;
  v_members  jsonb;
  v_rounds   jsonb;
  v_stats    jsonb;
  v_current  jsonb := null;
  v_cur_id   bigint;
  v_my       jsonb := null;
  v_invite   jsonb := null;
  v_pending  int := 0;
begin
  select * into r from public.rooms where id = p_room;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;

  v_is_leader  := p_uid is not null and r.leader_id = p_uid;
  v_does_tasks := p_uid is not null and exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = p_uid and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks));
  v_members := public.room_members_json(p_room, p_uid);

  v_tags := public.room_tags_json(p_room);

  -- 회차(depth 2) 집계: 리프 asg/sub 를 round_id 로 합산
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', round_id::text, 'label', label, 'title', title,
           'startDate', to_char(start_date, 'YYYY-MM-DD'), 'endDate', to_char(end_date, 'YYYY-MM-DD'),
           'leafCount', leaf_count, 'assigned', asg, 'submitted', sub, 'pct', public.pct(asg, sub))
           order by sort_order, round_id), '[]'::jsonb)
  into v_rounds from public.room_round_stats(p_room);

  -- stats (roomview §3.7 glance 원재료)
  select jsonb_build_object(
    'roundCount', (select count(*) from public.goal_nodes n where n.room_id = p_room and n.depth = 2 and n.archived_at is null),
    'leafCount', count(*),
    'commonCount', count(*) filter (where l.task_type = 'COMMON'),
    'designatedCount', count(*) filter (where l.task_type = 'DESIGNATED'),
    'totalAssignments', coalesce(sum(l.asg), 0),
    'totalSubmissions', coalesce(sum(l.sub), 0),
    'overallPct', public.pct(coalesce(sum(l.asg), 0)::int, coalesce(sum(l.sub), 0)::int),
    'unassignedCount', count(*) filter (where l.asg = 0),
    'startWeekdays', (select coalesce(jsonb_agg(d order by d), '[]'::jsonb) from (
        select distinct extract(isodow from n.start_date)::int as d
        from public.goal_nodes n where n.room_id = p_room and n.depth = 2 and n.archived_at is null) w))
  into v_stats
  from public.room_leaf_stats(p_room) l;

  -- 현재 회차: ACTIVE 일 때만. 오늘을 포함하는 회차 중 start 가 가장 늦은 것, 없으면 직전 회차 (roomview §3.3)
  if r.status = 'ACTIVE' then
    v_cur_id := public.room_current_round_id(p_room, v_today);
  end if;
  if v_cur_id is not null then
    select (select e from jsonb_array_elements(v_rounds) e where e->>'id' = v_cur_id::text)
           || jsonb_build_object('tasks', coalesce((
                select jsonb_agg(jsonb_build_object(
                         'id', ls.node_id::text, 'title', ls.title, 'type', lower(ls.task_type),
                         'startDate', to_char(ls.start_date, 'YYYY-MM-DD'), 'endDate', to_char(ls.end_date, 'YYYY-MM-DD'),
                         'people', coalesce((
                           select jsonb_agg(public.person_json(a.user_id)
                                    || jsonb_build_object('status', public.task_code(ls.start_date, ls.end_date, s.first_submitted_at, s.is_late, v_today))
                                    order by a.assigned_at, a.id)
                           from public.task_assignments a
                           left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
                           where a.node_id = ls.node_id and a.released_at is null), '[]'::jsonb))
                       order by ls.start_date, ls.sort_order, ls.node_id)
                from public.room_leaf_stats(p_room) ls where ls.round_id = v_cur_id), '[]'::jsonb))
    into v_current;
  end if;

  -- 내 진척률: 담당 자격이 있으면 상태 무관(모집중 방도 D4 실체화 덕에 같은 쿼리 — 시드 sqld 는 leader_does_tasks=false 라 null)
  -- nextDue 는 OPEN 만(D14): start ≤ today ≤ end ∧ 미제출. 시작 전·마감 지남은 제외
  if v_does_tasks then
    select jsonb_build_object(
      'submitted', count(*) filter (where s.id is not null),
      'assigned', count(*),
      'nextDue', (
        select jsonb_build_object('nodeId', l2.node_id::text, 'title', l2.title, 'roundLabel', rn.label,
                                  'dueDate', to_char(l2.end_date, 'YYYY-MM-DD'))
        from public.room_leaf_stats(p_room) l2
        join public.task_assignments a2 on a2.node_id = l2.node_id and a2.user_id = p_uid and a2.released_at is null
        join public.goal_nodes rn on rn.id = l2.round_id
        left join public.submissions s2 on s2.node_id = l2.node_id and s2.user_id = p_uid
        where s2.id is null and l2.start_date <= v_today and l2.end_date >= v_today
        order by l2.end_date, rn.sort_order, l2.sort_order, l2.node_id
        limit 1))
    into v_my
    from public.room_leaf_stats(p_room) l
    join public.task_assignments a on a.node_id = l.node_id and a.user_id = p_uid and a.released_at is null
    left join public.submissions s on s.node_id = l.node_id and s.user_id = p_uid;
  end if;

  if v_is_leader then
    v_invite := jsonb_build_object('url', '/invite/' || public.invite_ensure(p_room, p_uid));
    select count(*)::int into v_pending from public.room_members m where m.room_id = p_room and m.status = 'PENDING';
  end if;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'id', r.id::text, 'slug', r.slug, 'title', r.title, 'intro', r.intro,
    'descriptionMd', r.description_md, 'rulesMd', r.rules_md,
    'status', lower(r.status), 'archived', r.archived_at is not null,
    'isPublic', r.visibility = 'PUBLIC', 'joinMode', lower(r.join_mode),
    'startDate', to_char(r.start_date, 'YYYY-MM-DD'), 'endDate', to_char(r.end_date, 'YYYY-MM-DD'),
    'maxMembers', r.max_members, 'minMembers', r.min_members,
    'memberCount', r.member_count,
    'leader', public.person_json(r.leader_id), 'leaderDoesTasks', r.leader_does_tasks,
    'tags', v_tags, 'members', v_members, 'me', public.room_me_json(p_room, p_uid),
    'currentRound', v_current, 'rounds', v_rounds, 'stats', v_stats, 'myProgress', v_my,
    'invite', v_invite, 'pendingCount', v_pending);
end $$;

-- ───────── room_create (03-api §2 CreateRoom) ─────────
create or replace function public.room_create(
  p_title text, p_intro text, p_start_date date, p_end_date date, p_max_members int,
  p_is_public boolean, p_join_mode text,
  p_description_md text default '', p_rules_md text default '', p_min_members int default null,
  p_leader_does_tasks boolean default true, p_cover_file_id uuid default null, p_tag_slugs text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_today  date := public.kst_today();
  v_title  text := trim(coalesce(p_title, ''));
  v_intro  text := trim(coalesce(p_intro, ''));
  v_id     bigint;
  v_base   text;
  v_slug   text;
  v_n      int := 2;
begin
  if length(v_title) < 1 or length(v_title) > 60 then
    perform public.fail('INVALID_TITLE', '제목은 1~60자예요', '{"field":"title"}'::jsonb);
  end if;
  if length(v_intro) < 1 or length(v_intro) > 100 then
    perform public.fail('VALIDATION_FAILED', '한 줄 소개는 1~100자예요', '{"field":"intro"}'::jsonb);
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb);
  end if;
  if p_start_date < v_today then
    perform public.fail('INVALID_PERIOD', '시작일은 오늘 이후여야 해요', '{"field":"startDate"}'::jsonb);
  end if;
  if p_max_members is null or p_max_members < 2 or p_max_members > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  if p_min_members is not null and (p_min_members < 1 or p_min_members > p_max_members) then
    perform public.fail('VALIDATION_FAILED', '최소 인원은 1~정원 사이예요', '{"field":"minMembers"}'::jsonb);
  end if;
  if coalesce(p_join_mode, '') not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;
  if p_is_public is null then
    perform public.fail('VALIDATION_FAILED', '공개 여부를 정해 주세요', '{"field":"isPublic"}'::jsonb);
  end if;
  -- 커버는 내가 올린 COVER 용 파일만 (A8)
  if p_cover_file_id is not null and not exists (
       select 1 from public.files f where f.id = p_cover_file_id and f.owner_user_id = v_uid and f.purpose = 'COVER') then
    perform public.fail('VALIDATION_FAILED', '커버 이미지를 찾을 수 없어요', '{"field":"coverFileId"}'::jsonb);
  end if;
  if coalesce(cardinality(p_tag_slugs), 0) > 8 then
    perform public.fail('TAG_LIMIT_EXCEEDED', '태그는 8개까지예요', '{"field":"tagSlugs"}'::jsonb);
  end if;

  -- slug 는 id 가 필요하므로 임시값으로 넣고 바로 갱신
  insert into public.rooms (slug, title, intro, description_md, rules_md, start_date, end_date, max_members, min_members,
                            visibility, join_mode, leader_id, leader_does_tasks, cover_file_id, status, member_count)
  values ('tmp-' || replace(gen_random_uuid()::text, '-', ''), v_title, v_intro, coalesce(p_description_md, ''), coalesce(p_rules_md, ''),
          p_start_date, p_end_date, p_max_members, p_min_members,
          case when p_is_public then 'PUBLIC' else 'PRIVATE' end, upper(p_join_mode), v_uid, coalesce(p_leader_does_tasks, true),
          p_cover_file_id, 'DRAFT', 1)
  returning id into v_id;

  v_base := public.slugify(v_title, v_id);
  v_slug := v_base;
  while exists (select 1 from public.rooms where slug = v_slug) loop
    v_slug := v_base || '-' || v_n;
    v_n := v_n + 1;
  end loop;
  update public.rooms set slug = v_slug where id = v_id;

  insert into public.room_members (room_id, user_id, role, status, joined_at)
  values (v_id, v_uid, 'LEADER', 'ACTIVE', now());
  insert into public.room_notification_settings (room_id) values (v_id);
  perform public.invite_ensure(v_id, v_uid);

  insert into public.room_tags (room_id, tag_slug, source, sort_order)
  select v_id, t.slug, 'MANUAL', s.ord - 1
  from unnest(p_tag_slugs) with ordinality as s(slug, ord)
  join public.tags t on t.slug = s.slug;

  return public.room_detail_json(v_id, v_uid);
end $$;

-- ───────── 공개 RPC GRANT (D7) — 위 헬퍼는 GRANT 없음 ─────────
grant execute on function public.room_create(text, text, date, date, int, boolean, text, text, text, int, boolean, uuid, text[]) to authenticated;

-- ───────── jsonb patch 값 캐스트 (D11) ─────────
-- 순수 헬퍼: INVOKER·GRANT 없음 — DEFINER RPC 안에서만 호출
-- 키가 없거나 json null → null. 타입·형식이 틀리면 22007/22008/22P02 원문 대신 VALIDATION_FAILED {field}
create or replace function public.patch_date(p_patch jsonb, p_key text) returns date
language plpgsql stable set search_path = '' as $$
begin
  if p_patch->p_key is null or jsonb_typeof(p_patch->p_key) = 'null' then return null; end if;
  if jsonb_typeof(p_patch->p_key) <> 'string' or (p_patch->>p_key) !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public.fail('VALIDATION_FAILED', '날짜는 YYYY-MM-DD 형식이어야 해요', jsonb_build_object('field', p_key));
  end if;
  return (p_patch->>p_key)::date;
exception when invalid_datetime_format or datetime_field_overflow then
  perform public.fail('VALIDATION_FAILED', '날짜는 YYYY-MM-DD 형식이어야 해요', jsonb_build_object('field', p_key));
  return null;
end $$;

create or replace function public.patch_bool(p_patch jsonb, p_key text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if p_patch->p_key is null or jsonb_typeof(p_patch->p_key) = 'null' then return null; end if;
  if jsonb_typeof(p_patch->p_key) <> 'boolean' then
    perform public.fail('VALIDATION_FAILED', 'true 또는 false 여야 해요', jsonb_build_object('field', p_key));
  end if;
  return (p_patch->p_key)::boolean;
end $$;

create or replace function public.patch_int(p_patch jsonb, p_key text) returns int
language plpgsql stable set search_path = '' as $$
begin
  if p_patch->p_key is null or jsonb_typeof(p_patch->p_key) = 'null' then return null; end if;
  if jsonb_typeof(p_patch->p_key) <> 'number' or (p_patch->>p_key) !~ '^-?\d{1,9}$' then
    perform public.fail('VALIDATION_FAILED', '정수여야 해요', jsonb_build_object('field', p_key));
  end if;
  return (p_patch->>p_key)::int;
end $$;

-- pg_cron 5분마다(0010, 플랜 04). 보관 방·DRAFT 는 건드리지 않는다(두 루프 모두 — 보관 방은 알림 제외, 해제 뒤 다음 tick 이 처리). 결과 {activated, ended}
create or replace function public.room_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.kst_today();
  v_id    bigint;
  v_act   int := 0;
  v_end   int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('room_tick'));
  for v_id in
    select id from public.rooms where status = 'RECRUIT' and archived_at is null and start_date <= v_today order by id
  loop
    perform public.room_transition_active(v_id, null);
    v_act := v_act + 1;
  end loop;
  for v_id in
    select id from public.rooms where status = 'ACTIVE' and archived_at is null and end_date < v_today order by id
  loop
    perform public.room_transition_ended(v_id);
    v_end := v_end + 1;
  end loop;
  return jsonb_build_object('activated', v_act, 'ended', v_end);
end $$;

-- ───────── 그룹장 상태 액션 ─────────
create or replace function public.room_open_recruit(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.status <> 'DRAFT' then perform public.fail('ROOM_STATUS_INVALID', '준비중인 방만 모집을 시작할 수 있어요'); end if;
  if not exists (select 1 from public.goal_nodes n where n.room_id = r.id and n.task_type is not null and n.archived_at is null) then
    perform public.fail('ROOM_NO_LEAF_TASK', '말단 과제가 1개 이상 있어야 모집을 시작할 수 있어요');
  end if;
  update public.rooms set status = 'RECRUIT', updated_at = now() where id = r.id;
  perform public.assignment_resync(r.id);
  return public.room_detail_json(r.id, v_uid);
end $$;

-- "지금 시작": start_date = today 로 당기고 ACTIVE 전환. 담당자 없는 지정 과제는 warnings(차단 안 함)
create or replace function public.room_start(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  v_warn  jsonb;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.status <> 'RECRUIT' then perform public.fail('ROOM_STATUS_INVALID', '모집중인 방만 시작할 수 있어요'); end if;
  if v_today > r.end_date then perform public.fail('INVALID_PERIOD', '종료일이 이미 지났어요', '{"field":"endDate"}'::jsonb); end if;
  update public.rooms set start_date = v_today, updated_at = now() where id = r.id;
  perform public.room_transition_active(r.id, v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('code', 'UNASSIGNED_TASK', 'nodeId', ls.node_id::text) order by ls.node_id), '[]'::jsonb)
  into v_warn
  from public.room_leaf_stats(r.id) ls where ls.task_type = 'DESIGNATED' and ls.asg = 0;
  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn);
end $$;

create or replace function public.room_archive(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.status not in ('ACTIVE', 'ENDED') or r.archived_at is not null then
    perform public.fail('ROOM_STATUS_INVALID', '진행중이거나 종료된 방만 보관할 수 있어요');
  end if;
  update public.rooms set archived_at = now(), updated_at = now() where id = r.id;
  return public.room_detail_json(r.id, v_uid);
end $$;

create or replace function public.room_unarchive(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.archived_at is null then perform public.fail('ROOM_STATUS_INVALID', '보관된 방이 아니에요'); end if;
  update public.rooms set archived_at = null, updated_at = now() where id = r.id;
  return public.room_detail_json(r.id, v_uid);
end $$;

-- DRAFT·RECRUIT 만 하드 삭제(FK cascade). ACTIVE 이후는 room_archive
create or replace function public.room_delete(p_slug text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.status not in ('DRAFT', 'RECRUIT') then perform public.fail('ROOM_STATUS_INVALID', '진행중이거나 종료된 방은 삭제할 수 없어요. 보관해 주세요'); end if;
  delete from public.rooms where id = r.id;
end $$;

-- ───────── room_update: 상태별 필드 잠금 (mystudy §2.3.1, D11) ─────────
-- p_patch 는 UpdateRoom 부분 객체(camelCase). 받은 키만 바꾼다. 'slug' 는 항상 FIELD_LOCKED(I11)
create or replace function public.room_update(p_slug text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_today  date := public.kst_today();
  r        public.rooms;
  v_phase  text;                 -- recruit(DRAFT·RECRUIT) | active | ended
  v_locked text[];
  k        text;
  v_title  text;
  v_intro  text;
  v_start  date;
  v_end    date;
  v_max    int;
  v_min    int;
  v_ldt    boolean;
  v_pub    boolean;
  v_node_max_end date;
  v_warn   jsonb := '[]'::jsonb;
begin
  r := public.room_lock(p_slug);
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.archived_at is not null then perform public.fail('ROOM_NOT_EDITABLE', '보관된 방은 수정할 수 없어요'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요');
  end if;

  v_phase := case when r.status in ('DRAFT', 'RECRUIT') then 'recruit' when r.status = 'ACTIVE' then 'active' else 'ended' end;
  v_locked := case v_phase
    when 'recruit' then array['slug']
    when 'active'  then array['slug', 'startDate', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks']
    else array['slug', 'title', 'intro', 'descriptionMd', 'rulesMd', 'coverFileId', 'startDate', 'endDate',
               'maxMembers', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks'] end;

  for k in select jsonb_object_keys(p_patch) loop
    if k = any(v_locked) then
      perform public.fail('FIELD_LOCKED', '지금 상태에서는 바꿀 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
    if k not in ('title', 'intro', 'descriptionMd', 'rulesMd', 'coverFileId', 'startDate', 'endDate',
                 'maxMembers', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;

  v_title := case when p_patch ? 'title' then trim(coalesce(p_patch->>'title', '')) else r.title end;
  v_intro := case when p_patch ? 'intro' then trim(coalesce(p_patch->>'intro', '')) else r.intro end;
  v_start := coalesce(public.patch_date(p_patch, 'startDate'), r.start_date);
  v_end   := coalesce(public.patch_date(p_patch, 'endDate'), r.end_date);
  v_max   := coalesce(public.patch_int(p_patch, 'maxMembers'), r.max_members);
  v_min   := case when p_patch ? 'minMembers' then public.patch_int(p_patch, 'minMembers') else r.min_members end;
  v_ldt   := coalesce(public.patch_bool(p_patch, 'leaderDoesTasks'), r.leader_does_tasks);
  v_pub   := coalesce(public.patch_bool(p_patch, 'isPublic'), r.visibility = 'PUBLIC');

  if length(v_title) < 1 or length(v_title) > 60 then
    perform public.fail('INVALID_TITLE', '제목은 1~60자예요', '{"field":"title"}'::jsonb);
  end if;
  if length(v_intro) < 1 or length(v_intro) > 100 then
    perform public.fail('VALIDATION_FAILED', '한 줄 소개는 1~100자예요', '{"field":"intro"}'::jsonb);
  end if;
  if p_patch ? 'startDate' and v_start < v_today then
    perform public.fail('INVALID_PERIOD', '시작일은 오늘 이후여야 해요', '{"field":"startDate"}'::jsonb);
  end if;
  if v_start > v_end then
    perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb);
  end if;
  if v_phase = 'active' and p_patch ? 'endDate' then
    select max(n.end_date) into v_node_max_end from public.goal_nodes n where n.room_id = r.id and n.archived_at is null;
    if v_end < v_today or (v_node_max_end is not null and v_end < v_node_max_end) then
      perform public.fail('INVALID_PERIOD', '진행중에는 종료일을 오늘과 마지막 과제 마감 이후로만 바꿀 수 있어요', '{"field":"endDate"}'::jsonb);
    end if;
  end if;
  if v_max < 2 or v_max > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  if v_max < r.member_count then
    perform public.fail('CAPACITY_BELOW_CURRENT', '현재 참가자 수보다 적게 줄일 수 없어요', jsonb_build_object('field', 'maxMembers', 'memberCount', r.member_count));
  end if;
  if v_min is not null and (v_min < 1 or v_min > v_max) then
    perform public.fail('VALIDATION_FAILED', '최소 인원은 1~정원 사이예요', '{"field":"minMembers"}'::jsonb);
  end if;
  if p_patch ? 'joinMode' and coalesce(p_patch->>'joinMode', '') not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;
  -- 커버는 내가 올린 COVER 용 파일만 (A8). 텍스트로 비교해 uuid 캐스트 오류(22P02)를 피한다. null 은 커버 제거
  if p_patch ? 'coverFileId' and jsonb_typeof(p_patch->'coverFileId') <> 'null' and not exists (
       select 1 from public.files f
       where f.id::text = p_patch->>'coverFileId' and f.owner_user_id = v_uid and f.purpose = 'COVER') then
    perform public.fail('VALIDATION_FAILED', '커버 이미지를 찾을 수 없어요', '{"field":"coverFileId"}'::jsonb);
  end if;

  update public.rooms set
    title = v_title, intro = v_intro,
    description_md = coalesce(p_patch->>'descriptionMd', description_md),
    rules_md       = coalesce(p_patch->>'rulesMd', rules_md),
    cover_file_id  = case when p_patch ? 'coverFileId' then (p_patch->>'coverFileId')::uuid else cover_file_id end,
    start_date = v_start, end_date = v_end, max_members = v_max, min_members = v_min,
    visibility = case when v_pub then 'PUBLIC' else 'PRIVATE' end,
    join_mode  = case when p_patch ? 'joinMode' then upper(p_patch->>'joinMode') else join_mode end,
    leader_does_tasks = v_ldt, updated_at = now()
  where id = r.id;

  if v_ldt <> r.leader_does_tasks then perform public.assignment_resync(r.id); end if;

  -- 방 기간 밖으로 나간 노드(보관 제외)는 경고 (D9)
  if p_patch ? 'startDate' or p_patch ? 'endDate' then
    select coalesce(jsonb_agg(jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', n.id::text) order by n.id), '[]'::jsonb)
    into v_warn
    from public.goal_nodes n
    where n.room_id = r.id and n.archived_at is null and (n.start_date < v_start or n.end_date > v_end);
  end if;

  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn);
end $$;

-- ───────── 공개 RPC GRANT (D7) — room_tick·patch_*·room_transition_* 는 GRANT 없음 ─────────
grant execute on function public.room_open_recruit(text) to authenticated;
grant execute on function public.room_start(text)        to authenticated;
grant execute on function public.room_archive(text)      to authenticated;
grant execute on function public.room_unarchive(text)    to authenticated;
grant execute on function public.room_delete(text)       to authenticated;
grant execute on function public.room_update(text, jsonb) to authenticated;

-- ILIKE 패턴용 이스케이프(기본 escape 문자 '\'). 검색어의 % _ 는 글자 그대로 (D10)
-- 순수 헬퍼: INVOKER·GRANT 없음 — DEFINER RPC 안에서만 호출
create or replace function public.like_escape(p_text text) returns text
language sql immutable set search_path = '' as $$
  select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- ───────── 목록 scope · 필터 (main §3-6, §3-8) ─────────
create or replace function public.room_in_scope(p_room bigint, p_scope text, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room and r.archived_at is null and (
         (p_scope = 'public'  and r.visibility = 'PUBLIC' and r.status <> 'DRAFT')
      or (p_scope = 'mine'    and p_uid is not null and exists (
            select 1 from public.room_members m
            where m.room_id = r.id and m.user_id = p_uid and m.role = 'MEMBER' and m.status in ('ACTIVE', 'PENDING')))
      or (p_scope = 'created' and p_uid is not null and r.leader_id = p_uid)))
$$;

create or replace function public.room_matches(p_room bigint, p_status text, p_q text, p_tags text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room
      and (p_status = 'all' or r.status = upper(p_status))
      and (p_q is null
           or r.title ilike '%' || public.like_escape(p_q) || '%'
           or exists (select 1 from public.room_tags rt join public.tags t on t.slug = rt.tag_slug
                      where rt.room_id = r.id
                        and (t.label ilike '%' || public.like_escape(p_q) || '%'
                             or exists (select 1 from unnest(t.aliases) a where a ilike '%' || public.like_escape(p_q) || '%'))))
      and (p_tags is null or exists (select 1 from public.room_tags rt where rt.room_id = r.id and rt.tag_slug = any(p_tags))))
$$;

-- ───────── rooms_list (03-api §2 RoomListResponse) ─────────
-- 02 §4.3: 페이지 id 집합에 대해 멤버십·태그·회차·팀 집계·내 집계·다음 마감을 각각 1회씩 모아 jsonb_agg
create or replace function public.rooms_list(
  p_scope text default 'public', p_status text default 'all', p_q text default null, p_tags text[] default null,
  p_page int default 0, p_size int default 24, p_sort text default 'default')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.current_user_id();
  v_today  date := public.kst_today();
  v_scope  text := coalesce(p_scope, 'public');
  v_status text := coalesce(p_status, 'all');
  v_q      text := nullif(trim(coalesce(p_q, '')), '');
  v_tags   text[] := case when p_tags is null or cardinality(p_tags) = 0 then null else p_tags end;
  v_page   int := greatest(coalesce(p_page, 0), 0);
  v_size   int := least(greatest(coalesce(p_size, 24), 1), 100);
  v_sort   text := coalesce(p_sort, 'default');
  v_total  int;
  v_items  jsonb;
  v_counts jsonb;
  v_facets jsonb;
begin
  if v_scope not in ('public', 'mine', 'created') then
    perform public.fail('VALIDATION_FAILED', 'scope 는 public·mine·created 중 하나예요', '{"field":"scope"}'::jsonb);
  end if;
  if v_status not in ('all', 'recruit', 'active', 'ended') then
    perform public.fail('VALIDATION_FAILED', 'status 는 all·recruit·active·ended 중 하나예요', '{"field":"status"}'::jsonb);
  end if;
  if v_sort not in ('default', 'latest', 'startDate') then
    perform public.fail('VALIDATION_FAILED', 'sort 는 default·latest·startDate 중 하나예요', '{"field":"sort"}'::jsonb);
  end if;
  if v_scope <> 'public' and v_uid is null then
    perform public.fail('AUTH_REQUIRED', '로그인이 필요해요');
  end if;

  -- 탭 총계: 필터와 무관한 고정값(main §1-3). 비로그인은 mine/created 0
  select jsonb_build_object(
    'public',  count(*) filter (where public.room_in_scope(r.id, 'public', v_uid)),
    'mine',    count(*) filter (where v_uid is not null and public.room_in_scope(r.id, 'mine', v_uid)),
    'created', count(*) filter (where v_uid is not null and public.room_in_scope(r.id, 'created', v_uid)))
  into v_counts
  from public.rooms r where r.archived_at is null;

  -- 태그 facet: 현재 scope 집합(상태·검색·태그 미적용), count desc → label
  select coalesce(jsonb_agg(jsonb_build_object('slug', f.slug, 'label', f.label, 'count', f.n) order by f.n desc, f.label), '[]'::jsonb)
  into v_facets
  from (
    select t.slug, t.label, count(*)::int as n
    from public.rooms r
    join public.room_tags rt on rt.room_id = r.id
    join public.tags t on t.slug = rt.tag_slug
    where public.room_in_scope(r.id, v_scope, v_uid)
    group by t.slug, t.label) f;

  select count(*)::int into v_total
  from public.rooms r
  where public.room_in_scope(r.id, v_scope, v_uid) and public.room_matches(r.id, v_status, v_q, v_tags);

  with page as (   -- 순서는 row_number() over (order by …) 로 고정(D5). 창 함수는 limit 전에 계산된다
    select o.*
    from (
      select r.*, row_number() over (order by
               case when v_sort = 'default' then case r.status when 'ACTIVE' then 0 when 'RECRUIT' then 1 when 'DRAFT' then 2 else 3 end end,
               case when v_sort in ('default', 'startDate') then r.start_date end,
               r.created_at desc, r.id desc) as ord
      from public.rooms r
      where public.room_in_scope(r.id, v_scope, v_uid) and public.room_matches(r.id, v_status, v_q, v_tags)) o
    order by o.ord
    limit v_size offset v_page * v_size
  ),
  mem as (
    select m.room_id, lower(m.role) as role, lower(m.status) as status
    from public.room_members m
    where v_uid is not null and m.user_id = v_uid and m.room_id in (select id from page)
  ),
  rs as (
    select p.id as room_id, count(x.round_id)::int as total_rounds,
           coalesce(sum(x.asg), 0)::int as asg, coalesce(sum(x.sub), 0)::int as sub
    from page p left join lateral public.room_round_stats(p.id) x on true
    group by p.id
  ),
  cur as (
    select p.id as room_id, c.idx, c.label, c.title
    from page p
    cross join lateral (
      select x.idx, x.label, x.title
      from (select rr.round_id, rr.label, rr.title, row_number() over (order by rr.sort_order, rr.round_id)::int as idx
            from public.room_round_stats(p.id) rr) x
      where x.round_id = public.room_current_round_id(p.id, v_today)) c
    where p.status = 'ACTIVE'
  ),
  does as (   -- 내가 담당 자격: ACTIVE 멤버, 그룹장은 leader_does_tasks
    select p.id as room_id from page p
    where v_uid is not null and exists (
      select 1 from public.room_members m
      where m.room_id = p.id and m.user_id = v_uid and m.status = 'ACTIVE' and (m.role = 'MEMBER' or p.leader_does_tasks))
  ),
  mine as (
    select n.room_id, count(*) filter (where s.id is not null)::int as submitted, count(*)::int as assigned
    from public.goal_nodes n
    join public.task_assignments a on a.node_id = n.id and a.user_id = v_uid and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.room_id in (select room_id from does) and n.task_type is not null and n.archived_at is null
    group by n.room_id
  ),
  nxt as (   -- OPEN(start ≤ today ≤ end) ∧ 미제출 중 마감 빠른 것, 같은 날이면 트리 순서 (main §3-2, D14)
    select distinct on (n.room_id) n.room_id, n.id as node_id, n.title, n.end_date
    from public.goal_nodes n
    join public.task_assignments a on a.node_id = n.id and a.user_id = v_uid and a.released_at is null
    join public.goal_nodes rn on rn.id = n.round_id
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.room_id in (select room_id from does) and n.task_type is not null and n.archived_at is null
      and s.id is null and n.start_date <= v_today and n.end_date >= v_today
    order by n.room_id, n.end_date, rn.sort_order, n.sort_order, n.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id::text, 'slug', p.slug, 'title', p.title, 'intro', p.intro,
    'status', lower(p.status), 'isFull', p.status = 'RECRUIT' and p.member_count >= p.max_members,
    'isPublic', p.visibility = 'PUBLIC', 'joinMode', lower(p.join_mode),
    'memberCount', p.member_count, 'maxMembers', p.max_members,
    'leader', public.person_json(p.leader_id), 'tags', public.room_tags_json(p.id),
    'startDate', to_char(p.start_date, 'YYYY-MM-DD'), 'endDate', to_char(p.end_date, 'YYYY-MM-DD'),
    'membership', case when mem.room_id is null then null else jsonb_build_object('role', mem.role, 'status', mem.status) end,
    'progress', case
      when p.status in ('RECRUIT', 'DRAFT') then jsonb_build_object('kind', 'recruit')
      when p.status = 'ACTIVE' and d.room_id is not null then jsonb_build_object(
        'kind', 'mine', 'submitted', coalesce(mi.submitted, 0), 'assigned', coalesce(mi.assigned, 0),
        'nextTask', case when nx.node_id is null then null
                         else jsonb_build_object('nodeId', nx.node_id::text, 'title', nx.title, 'dueDate', to_char(nx.end_date, 'YYYY-MM-DD')) end)
      when p.status = 'ACTIVE' then jsonb_build_object(
        'kind', 'team',
        'currentRound', case when c.idx is null then null else jsonb_build_object('index', c.idx, 'label', c.label, 'title', c.title) end,
        'totalRounds', rs.total_rounds)
      else jsonb_build_object('kind', 'final', 'submitted', rs.sub, 'assigned', rs.asg, 'totalRounds', rs.total_rounds) end
  ) order by p.ord), '[]'::jsonb)
  into v_items
  from page p
  left join mem  on mem.room_id = p.id
  left join rs   on rs.room_id = p.id
  left join cur c on c.room_id = p.id
  left join does d on d.room_id = p.id
  left join mine mi on mi.room_id = p.id
  left join nxt nx on nx.room_id = p.id;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'items', v_items, 'page', v_page, 'size', v_size, 'totalElements', v_total,
    'tabCounts', v_counts, 'tagFacets', v_facets);
end $$;

-- ───────── 공개 RPC GRANT (D7) — 비로그인 허용(공개) ─────────
grant execute on function public.rooms_list(text, text, text, text[], int, int, text) to anon, authenticated;
