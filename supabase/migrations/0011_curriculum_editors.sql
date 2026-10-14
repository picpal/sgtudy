-- 0011_curriculum_editors.sql — 커리큘럼 편집 위임 (editor-ux Task I-backend). 배포 후 수정 금지.
-- 그룹장 편집이 기본, 그룹장이 허락한 ACTIVE 멤버도 커리큘럼(node_*)을 편집한다.
-- 방 설정·참가 승인·이탈 처리·권한 부여·방 상태 전환은 그대로 그룹장 전용(require_leader).

-- ───────── 컬럼 ─────────
alter table public.room_members add column can_edit_curriculum boolean not null default false;

-- 상태가 바뀌면(탈퇴·이탈 처리·재참가·승인 등) 위임은 사라진다. 재참가자는 다시 허락받아야 한다
create or replace function public.room_members_reset_editor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then new.can_edit_curriculum := false; end if;
  return new;
end $$;
create trigger trg_room_members_reset_editor before update of status on public.room_members
  for each row execute function public.room_members_reset_editor();

-- ───────── 판정 헬퍼 (GRANT 없음 — D7) ─────────
-- 멤버 행 기준 실효 권한: 그룹장 | ACTIVE ∧ 위임 플래그. 비ACTIVE 행의 플래그는 무시한다
create or replace function public.member_can_edit_curriculum(r public.rooms, m public.room_members) returns boolean
language sql stable set search_path = '' as $$
  select m.user_id = r.leader_id or (m.status = 'ACTIVE' and m.can_edit_curriculum)
$$;

create or replace function public.can_edit_curriculum(r public.rooms, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m
    where m.room_id = r.id and m.user_id = p_uid and m.status = 'ACTIVE' and m.can_edit_curriculum))
$$;

-- require_leader 와 같은 모양: 못 읽으면 ROOM_NOT_FOUND(존재 숨김), 읽을 수 있으면 NOT_CURRICULUM_EDITOR
create or replace function public.require_curriculum_editor(r public.rooms, p_uid uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.can_edit_curriculum(r, p_uid) then return; end if;
  if not public.room_readable(r.id, p_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.fail('NOT_CURRICULUM_EDITOR', '커리큘럼 편집 권한이 없어요');
end $$;

-- 모든 노드 쓰기 함수(node_create·update·delete·archive·unarchive·move·indent·outdent)의 첫 줄 — 0006 판에서 권한 판정만 바꾼다
create or replace function public.node_assert_editable(p_slug text) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  perform public.require_curriculum_editor(r, v_uid);
  if r.archived_at is not null or r.status not in ('DRAFT', 'RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_NOT_EDITABLE', '종료되었거나 보관된 방은 편집할 수 없어요', jsonb_build_object('status', lower(r.status)));
  end if;
  return r;
end $$;

-- ───────── 읽기 노출 ─────────
-- RoomDetail.members: 0004 판 + canEditCurriculum(실효 권한 — 그룹장 true)
create or replace function public.room_members_json(p_room bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           public.person_json(m.user_id)
           || jsonb_build_object('role', lower(m.role), 'status', lower(m.status), 'joinedAt', public.iso(m.joined_at),
                                 'canEditCurriculum', public.member_can_edit_curriculum(r, m))
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  from public.room_members m join public.rooms r on r.id = m.room_id
  where m.room_id = p_room
    and (m.status in ('ACTIVE', 'INACTIVE') or (m.status = 'PENDING' and m.user_id = p_uid))
$$;

-- RoomDetail: 0004 판 + myPermissions.canEditCurriculum(호출자 — 비로그인 false). me 는 그대로(참가 상태만)
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
    'unassignedCount', count(*) filter (where l.task_type = 'DESIGNATED' and l.asg = 0),
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
    -- 읽기 전용(GET 안전): 활성 토큰을 SELECT 만 한다. 생성은 invite_get·invite_rotate·room_create 몫
    select jsonb_build_object('url', '/invite/' || i.token) into v_invite
    from public.room_invites i where i.room_id = p_room and i.revoked_at is null;
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
    'invite', v_invite, 'pendingCount', v_pending,
    'myPermissions', jsonb_build_object('canEditCurriculum', public.can_edit_curriculum(r, p_uid)));
end $$;


-- 그룹장 멤버 목록 한 줄 (room_members_get 과 member_set_curriculum_editor 가 공유)
create or replace function public.member_admin_json(r public.rooms, m public.room_members) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.person_json(m.user_id)
         || jsonb_build_object('role', lower(m.role), 'status', lower(m.status), 'joinedAt', public.iso(m.joined_at),
                               'canEditCurriculum', public.member_can_edit_curriculum(r, m))
$$;

create or replace function public.room_members_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.require_leader(r, v_uid, '그룹장만 볼 수 있어요');
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(public.member_admin_json(r, m)
               order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.applied_at nulls last, m.id)
      from public.room_members m where m.room_id = r.id), '[]'::jsonb));
end $$;

-- Curriculum: 0006 판 + members[].canEditCurriculum + myPermissions.canEditCurriculum(호출자 — 비로그인 false)
create or replace function public.curriculum_json(p_room bigint, p_uid uuid, p_include_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  v_today   date := public.kst_today();
  v_people  boolean;     -- people 노출: 그룹장 | ACTIVE·INACTIVE·PENDING 멤버
  v_members jsonb;
  v_nodes   jsonb;
  v_stats   jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_people := p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')));

  select coalesce(jsonb_agg(
           public.person_json(m.user_id) || jsonb_build_object(
             'role', lower(m.role), 'status', lower(m.status),
             'doesTasks', m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks),
             'canEditCurriculum', public.member_can_edit_curriculum(r, m))
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  into v_members
  from public.room_members m
  where m.room_id = p_room and m.status in ('ACTIVE', 'INACTIVE');

  -- nodes·stats 는 같은 room_progress 결과(prog)를 공유한다 (한 번만 계산)
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
             'assigned', p.asg, 'submitted', p.sub, 'pct', p.pct,
             'task', case when t.task_type is null then null else jsonb_build_object(
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
    from t join prog p on p.node_id = t.id
    where p_include_archived or t.archived_at is null),
  stats as (
    select jsonb_build_object(
      'overallPct', public.pct(coalesce(sum(p.asg), 0)::int, coalesce(sum(p.sub), 0)::int),
      'leafCount', count(*),
      'unassignedCount', count(*) filter (where n.task_type = 'DESIGNATED' and p.asg = 0)) as j
    from public.goal_nodes n join prog p on p.node_id = n.id
    where n.room_id = p_room and n.task_type is not null and n.archived_at is null)
  select (select j from nodes), (select j from stats) into v_nodes, v_stats;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'room', jsonb_build_object('slug', r.slug, 'status', lower(r.status), 'leaderDoesTasks', r.leader_does_tasks),
    'members', v_members, 'nodes', v_nodes, 'stats', v_stats,
    'myPermissions', jsonb_build_object('canEditCurriculum', public.can_edit_curriculum(r, p_uid)));
end $$;


-- ───────── member_set_curriculum_editor: 그룹장이 ACTIVE 멤버에게 커리큘럼 편집을 맡기거나 거둔다 ─────────
-- 멱등(같은 값이면 그대로). 방 상태 무관(편집 가능 여부는 node_assert_editable 이 따로 본다). 반환: 대상 멤버 한 줄(room_members_get.items 와 같은 모양)
create or replace function public.member_set_curriculum_editor(p_slug text, p_user uuid, p_allow boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 편집 권한을 줄 수 있어요');
  if p_user = r.leader_id then perform public.fail('CANNOT_TARGET_LEADER', '그룹장은 항상 커리큘럼을 편집할 수 있어요'); end if;
  if p_allow is null then perform public.fail('VALIDATION_FAILED', '허용 여부가 필요해요', '{"field":"allow"}'::jsonb); end if;
  select * into m from public.room_members where room_id = r.id and user_id = p_user for update;
  if not found or m.status <> 'ACTIVE' then perform public.fail('MEMBER_NOT_ACTIVE', '활성 참가자가 아니에요'); end if;
  if m.can_edit_curriculum is distinct from p_allow then
    update public.room_members set can_edit_curriculum = p_allow, updated_at = now() where id = m.id returning * into m;
  end if;
  return public.member_admin_json(r, m);
end $$;

grant execute on function public.member_set_curriculum_editor(text, uuid, boolean) to authenticated;
