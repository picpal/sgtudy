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
