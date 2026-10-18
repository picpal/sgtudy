-- 0026_review_fixes.sql — S 리뷰(S-review.md) 수정. 배포 후 수정 금지. 추가형(테이블 1·정책 1·트리거 2·인덱스 1 + 함수 교체).
-- 0024·0025 는 로컬에 적용돼 있어 손대지 않는다. 호스팅에는 0024 → 0025 → 0026 순서로 적용한다. RPC 이름·인자·반환(contract.md)은 그대로.
-- Critical: 0024 가 room_members 에 둔 apply_message·leave_requested_at·leave_request_reason 은 room_members_select 정책
--   (방을 읽을 수 있으면 ACTIVE·INACTIVE 행 공개, 공개 방은 anon 포함)으로 테이블 직접 조회에 노출됐다. PostgreSQL 은 테이블 단위 SELECT GRANT 가
--   있으면 컬럼 revoke 가 소용없다 → 값을 RLS 가 "본인 | 그 방 그룹장" 인 member_requests 로 옮긴다. 쓰기 정책 없음(security definer RPC 만).
--   room_members 의 세 컬럼은 이전 뒤 null 로 비우고 어떤 함수도 더 읽거나 쓰지 않는다. drop 하지 않는 이유: 추가형 원칙(0001~ 배포 후 스키마 축소 금지)과,
--   이미 생성된 database.types 를 쓰는 코드가 있을 경우의 호환. 다음 정리 마이그레이션에서 drop 해도 된다.
--   신청 한마디는 승인 뒤에도 남긴다(그룹장·본인만 읽으므로 노출 위험이 없고, 승인 이후 그룹장이 다시 볼 수 있다).
-- Important: 묶음(depth ≥ 3)을 shiftDescendants 로 옮기면 하위 팀 과제 담당자에게 SCHEDULE_CHANGED(과제당 1건). 회차(depth 2)는 0024 대로 회차 알림 1건.
-- Minor: 트리거 알림 갱신에 수신자 user_id 조건(ix_notifications_user_unread) · 이탈한 소유자에게 PERSONAL_ARCHIVED 안 보냄 ·
--   회차 알림 꼬리 '과제 n개·개인 목표 m개' · 제출 요약은 timestamptz 범위 + 인덱스 · 방이 종료·보관되면 LEAVE_REQUESTED 읽음.
-- 재정의 함수는 0024 판을 복사해 고쳤다(0025 는 이 함수들을 재정의하지 않음). 시그니처 동일 → GRANT 유지.

-- ───────── 1. member_requests ─────────
create table public.member_requests (
  room_id              bigint       not null,
  user_id              uuid         not null,
  apply_message        varchar(200),
  leave_requested_at   timestamptz,
  leave_request_reason varchar(200),
  updated_at           timestamptz  not null default now(),
  primary key (room_id, user_id),
  foreign key (room_id, user_id) references public.room_members (room_id, user_id) on delete cascade
);
alter table public.member_requests enable row level security;
create policy member_requests_select on public.member_requests for select
  using (user_id = (select public.current_user_id()) or public.is_room_leader(room_id));
-- 쓰기는 RPC 만: 0002 default privileges 가 insert/update/delete 를 빼지만 호스팅 기본 GRANT 를 대비해 명시적으로도 막는다
revoke insert, update, delete, truncate on public.member_requests from anon, authenticated;

-- 수신자 조건 포함(리뷰 Minor 2): JOIN_REQUESTED·LEAVE_REQUESTED 는 그룹장만 받는다
create or replace function public.room_members_request_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_leader uuid;
begin
  -- ① ACTIVE 가 아니게 되면(이탈 처리·…) 탈퇴 요청을 비운다 → member_requests 트리거가 알림을 읽음으로
  if new.status is distinct from 'ACTIVE' then
    update public.member_requests set leave_requested_at = null, leave_request_reason = null, updated_at = now()
     where room_id = new.room_id and user_id = new.user_id and leave_requested_at is not null;
  end if;
  -- ② PENDING 이 처리되면(승인·거절·취소·만료) 그 신청의 JOIN_REQUESTED 를 읽음
  if old.status = 'PENDING' and new.status is distinct from 'PENDING' then
    select leader_id into v_leader from public.rooms where id = new.room_id;
    update public.notifications set read_at = now()
     where user_id = v_leader and kind = 'JOIN_REQUESTED' and room_id = new.room_id and actor_user_id = new.user_id and read_at is null;
  end if;
  return new;
end $$;

-- ③ 탈퇴 요청이 비워지면(취소·반려·이탈) LEAVE_REQUESTED 를 읽음
create or replace function public.member_requests_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_leader uuid;
begin
  if old.leave_requested_at is not null and new.leave_requested_at is null then
    select leader_id into v_leader from public.rooms where id = new.room_id;
    update public.notifications set read_at = now()
     where user_id = v_leader and kind = 'LEAVE_REQUESTED' and room_id = new.room_id and actor_user_id = new.user_id and read_at is null;
  end if;
  return new;
end $$;
create trigger trg_member_requests_sync
  before update on public.member_requests
  for each row execute function public.member_requests_sync();

-- 데이터 이전(로컬에만 있을 수 있음 — 호스팅은 0024 와 함께 적용되므로 0건)
insert into public.member_requests (room_id, user_id, apply_message, leave_requested_at, leave_request_reason)
select room_id, user_id, apply_message, leave_requested_at, leave_request_reason from public.room_members
where apply_message is not null or leave_requested_at is not null or leave_request_reason is not null
on conflict (room_id, user_id) do nothing;
update public.room_members set apply_message = null, leave_requested_at = null, leave_request_reason = null
where apply_message is not null or leave_requested_at is not null or leave_request_reason is not null;

-- 제출 요약 범위 조회용(리뷰 Minor 5)
create index ix_submissions_first_submitted on public.submissions (first_submitted_at);

-- ───────── 2. 요청을 읽고 쓰는 함수 → member_requests ─────────


-- room_me_json (0024 → 요청은 member_requests 에서)
create or replace function public.room_me_json(p_room bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when p_uid is null then null
    when exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = p_uid) then jsonb_build_object('state', 'leader')
    else coalesce((
      select case m.status
               -- 요청이 없으면 키 자체가 없다(기존 me 모양 {state} 유지)
               when 'ACTIVE' then jsonb_build_object('state', 'active') ||
                 case when q.leave_requested_at is not null and r.status = 'ACTIVE' and r.archived_at is null
                      then jsonb_build_object('leaveRequest', jsonb_build_object('requestedAt', public.iso(q.leave_requested_at), 'reason', q.leave_request_reason))
                      else '{}'::jsonb end
               when 'PENDING' then jsonb_build_object('state', 'pending')
               when 'INACTIVE' then jsonb_build_object('state', 'inactive')
               else jsonb_build_object('state', 'none') end
      from public.room_members m join public.rooms r on r.id = m.room_id
      left join public.member_requests q on q.room_id = m.room_id and q.user_id = m.user_id   -- 0026
      where m.room_id = p_room and m.user_id = p_uid), jsonb_build_object('state', 'none'))
  end
$$;

-- member_admin_json (0024 → member_requests)
create or replace function public.member_admin_json(r public.rooms, m public.room_members) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.person_json(m.user_id)
         || jsonb_build_object('role', lower(m.role), 'status', lower(m.status), 'joinedAt', public.iso(m.joined_at),
                               'canEditCurriculum', public.member_can_edit_curriculum(r, m),
                               'leaveRequestedAt', case when r.status = 'ACTIVE' and r.archived_at is null and m.status = 'ACTIVE'
                                                        then public.iso((select q.leave_requested_at from public.member_requests q where q.room_id = m.room_id and q.user_id = m.user_id)) end)
$$;

-- room_detail_json (0024 → leaveRequestCount 를 member_requests 에서)
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
  v_leaves   int := 0;         -- 0024
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
    -- 0024: 처리할 탈퇴 요청 (방 ACTIVE·미보관일 때만 의미)
    if r.status = 'ACTIVE' and r.archived_at is null then
      select count(*)::int into v_leaves from public.room_members m
      join public.member_requests q on q.room_id = m.room_id and q.user_id = m.user_id   -- 0026
      where m.room_id = p_room and m.status = 'ACTIVE' and q.leave_requested_at is not null;
    end if;
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
    'invite', v_invite, 'pendingCount', v_pending, 'leaveRequestCount', v_leaves,
    'myPermissions', jsonb_build_object('canEditCurriculum', public.can_edit_curriculum(r, p_uid)));
end $$;

-- room_apply (0024 → 한마디는 member_requests)
create or replace function public.room_apply(p_slug text, p_invite_token text default null, p_message text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  r     public.rooms;
  v_now timestamptz := now();
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
begin
  r := public.room_lock(p_slug);
  perform public.room_join_precheck(r, v_uid, p_invite_token, 'APPROVAL');
  if r.member_count >= r.max_members then
    perform public.fail('ROOM_FULL', '정원이 찼어요', '{"field":"maxMembers"}'::jsonb);
  end if;
  if length(v_msg) > 200 then perform public.fail('VALIDATION_FAILED', '한마디는 200자까지예요', '{"field":"message"}'::jsonb); end if;
  insert into public.room_members (room_id, user_id, role, status, applied_at)
  values (r.id, v_uid, 'MEMBER', 'PENDING', v_now)
  on conflict (room_id, user_id) do update
    set status = 'PENDING', role = 'MEMBER', applied_at = excluded.applied_at,
        decided_at = null, decided_by = null, left_at = null, updated_at = now();
  -- 0026: 한마디는 본인·그룹장만 읽는 member_requests 에(재신청은 덮어쓴다)
  insert into public.member_requests (room_id, user_id, apply_message) values (r.id, v_uid, v_msg)
  on conflict (room_id, user_id) do update set apply_message = excluded.apply_message, updated_at = now();
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_REQUESTED', r.id, null, v_uid, array[r.leader_id],
    'JOIN_REQUESTED:' || r.id || ':' || v_uid || ':' || txid_current(),
    jsonb_build_object('applicant', public.person_json(v_uid), 'message', v_msg));
  return public.membership_result(r.id, v_uid);
end $$;

create or replace function public.room_applications(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.require_leader(r, v_uid, '그룹장만 볼 수 있어요');
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(public.person_json(m.user_id) || jsonb_build_object('appliedAt', public.iso(m.applied_at), 'message', (select q.apply_message from public.member_requests q where q.room_id = m.room_id and q.user_id = m.user_id))
                       order by m.applied_at, m.id)
      from public.room_members m where m.room_id = r.id and m.status = 'PENDING'), '[]'::jsonb));
end $$;

create or replace function public.leave_requests_json(r public.rooms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(public.person_json(m.user_id) || jsonb_build_object(
               'requestedAt', public.iso(q.leave_requested_at), 'reason', q.leave_request_reason,
               'pendingTaskCount', (select count(*)::int from public.deactivate_pending(r.id, m.user_id)))
             order by q.leave_requested_at, m.id)
      from public.room_members m
      join public.member_requests q on q.room_id = m.room_id and q.user_id = m.user_id
      where m.room_id = r.id and m.status = 'ACTIVE' and q.leave_requested_at is not null
        and r.status = 'ACTIVE' and r.archived_at is null), '[]'::jsonb))
$$;

create or replace function public.member_leave_request(p_slug text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  r        public.rooms;
  m        public.room_members;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  r := public.room_lock(p_slug);
  perform public.room_hide_unless_known(r, v_uid);
  if r.leader_id = v_uid then perform public.fail('OWNER_CANNOT_LEAVE', '그룹장은 탈퇴를 요청할 수 없어요'); end if;
  if r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('ROOM_NOT_ACTIVE', '진행 중인 스터디에서만 탈퇴를 요청할 수 있어요', jsonb_build_object('status', lower(r.status)));
  end if;
  select * into m from public.room_members where room_id = r.id and user_id = v_uid and status = 'ACTIVE' for update;
  if not found then perform public.fail('NOT_MEMBER', '참가 중인 방이 아니에요'); end if;
  if length(v_reason) > 200 then perform public.fail('VALIDATION_FAILED', '사유는 200자까지예요', '{"field":"reason"}'::jsonb); end if;
  if exists (select 1 from public.member_requests q where q.room_id = r.id and q.user_id = v_uid and q.leave_requested_at is not null) then
    perform public.fail('LEAVE_ALREADY_REQUESTED', '이미 탈퇴를 요청했어요');
  end if;
  insert into public.member_requests (room_id, user_id, leave_requested_at, leave_request_reason) values (r.id, v_uid, now(), v_reason)
  on conflict (room_id, user_id) do update set leave_requested_at = excluded.leave_requested_at, leave_request_reason = excluded.leave_request_reason, updated_at = now();
  perform public.notify_publish('LEAVE_REQUESTED', r.id, null, v_uid, array[r.leader_id],
    'LEAVE_REQUESTED:' || r.id || ':' || v_uid || ':' || txid_current(), jsonb_build_object('reason', v_reason));
  return public.membership_result(r.id, v_uid);
end $$;

create or replace function public.member_leave_request_cancel(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  perform public.room_hide_unless_known(r, v_uid);
  select m0.* into m from public.room_members m0
  join public.member_requests q on q.room_id = m0.room_id and q.user_id = m0.user_id
  where m0.room_id = r.id and m0.user_id = v_uid and m0.status = 'ACTIVE' and q.leave_requested_at is not null;
  if not found then perform public.fail('NOT_FOUND', '취소할 탈퇴 요청이 없어요'); end if;
  update public.member_requests set leave_requested_at = null, leave_request_reason = null, updated_at = now()
  where room_id = r.id and user_id = v_uid;   -- 트리거가 알림을 읽음으로
  return public.membership_result(r.id, v_uid);
end $$;

create or replace function public.member_leave_request_dismiss(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 처리할 수 있어요');
  select m0.* into m from public.room_members m0
  join public.member_requests q on q.room_id = m0.room_id and q.user_id = m0.user_id
  where m0.room_id = r.id and m0.user_id = p_user and m0.status = 'ACTIVE' and q.leave_requested_at is not null;
  if not found or r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('NOT_FOUND', '처리할 탈퇴 요청이 없어요');
  end if;
  update public.member_requests set leave_requested_at = null, leave_request_reason = null, updated_at = now()
  where room_id = r.id and user_id = p_user;
  perform public.notify_publish('LEAVE_REQUEST_DISMISSED', r.id, null, v_uid, array[p_user],
    'LEAVE_REQUEST_DISMISSED:' || r.id || ':' || p_user || ':' || txid_current(), '{}'::jsonb);
  select * into r from public.rooms where id = r.id;
  return public.leave_requests_json(r);
end $$;

-- node_update (0024 + 묶음 이동 과제 알림, 회차 꼬리 모델 분리)
create or replace function public.node_update(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  n         public.goal_nodes;
  p         public.goal_nodes;
  v_uid     uuid;
  k         text;
  v_title   text;
  v_desc    text;
  v_s       date;
  v_e       date;
  v_label   text;
  v_type    text;
  v_ids     uuid[];          -- null = 담당자 변경 없음
  v_cur     uuid[];
  v_added   uuid[] := '{}';
  v_removed uuid[] := '{}';
  v_bad     uuid;
  v_asg     int;
  v_rcpt    uuid[];
  v_warn    jsonb := '[]'::jsonb;
  v_open    boolean;         -- 0020: 저장 전 이 과제가 아직 전원 제출이 아니었는가
  v_shift   boolean := false; -- 0024 D2: 자손을 함께 옮기나
  v_days    int := 0;
  v_moved   jsonb := jsonb_build_object('days', 0, 'tasks', 0, 'personal', 0, 'groups', 0, 'archived', 0);
  v_desc_ids bigint[] := '{}';
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if n.archived_at is not null then   -- I1: 보관된 노드는 변경 전에 거부 (배정·알림 오염 방지)
    if n.task_type is null then perform public.fail('PARENT_ARCHIVED', '보관된 항목은 수정할 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
    perform public.fail('TASK_ARCHIVED', '보관된 과제는 수정할 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  -- 0020: 담당 변경 전 상태. room_leaf_stats 는 팀 과제만(0014) → 개인 목표는 대상이 아니다(애초에 node_get 이 거부한다)
  v_open := exists (select 1 from public.room_leaf_stats(r.id) ls where ls.node_id = n.id and ls.sub < ls.asg);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'descriptionMd', 'startDate', 'endDate', 'label', 'taskType', 'assigneeIds', 'shiftDescendants') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;
  -- 0024 D2: shiftDescendants 는 불리언, 하위가 있는 노드(task_type null)에서만
  if p_patch ? 'shiftDescendants' then
    if jsonb_typeof(p_patch->'shiftDescendants') <> 'boolean' then
      perform public.fail('VALIDATION_FAILED', '함께 옮길지 여부가 올바르지 않아요', '{"field":"shiftDescendants"}'::jsonb);
    end if;
    v_shift := (p_patch->>'shiftDescendants')::boolean;
    if v_shift and n.task_type is not null then
      perform public.fail('VALIDATION_FAILED', '하위 항목이 있는 항목에서만 함께 옮길 수 있어요', '{"field":"shiftDescendants"}'::jsonb);
    end if;
  end if;

  -- 제목·설명·기간·라벨 (M3: 문자열이 아니면 거부. description_md 는 NOT NULL 이라 null 로 지울 수 없다)
  for k in select unnest(array['title', 'descriptionMd', 'label']) loop
    if p_patch ? k and jsonb_typeof(p_patch->k) <> 'string' then
      perform public.fail('VALIDATION_FAILED', '문자열이어야 해요', jsonb_build_object('field', k));
    end if;
  end loop;
  v_title := case when p_patch ? 'title' then trim(coalesce(p_patch->>'title', '')) else n.title end;
  if v_title is null or length(v_title) < 1 or length(v_title) > 80 then
    perform public.fail('INVALID_TITLE', '제목은 1~80자예요', '{"field":"title"}'::jsonb);
  end if;
  v_desc := coalesce(p_patch->>'descriptionMd', n.description_md);
  if length(v_desc) > 20000 then
    perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb);
  end if;
  v_s := coalesce(public.patch_date(p_patch, 'startDate'), n.start_date);   -- 형식 오류 → VALIDATION_FAILED (D11)
  v_e := coalesce(public.patch_date(p_patch, 'endDate'), n.end_date);
  if v_s > v_e then perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb); end if;
  v_label := n.label;
  if p_patch ? 'label' then
    if n.depth <> 2 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', '{"field":"label"}'::jsonb); end if;
    v_label := nullif(trim(coalesce(p_patch->>'label', '')), '');
    if v_label is null then perform public.fail('VALIDATION_FAILED', '회차 라벨은 비울 수 없어요', '{"field":"label"}'::jsonb); end if;   -- A7
    if length(v_label) > 20 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 20자까지예요', '{"field":"label"}'::jsonb); end if;
  end if;

  -- 담당자는 리프에만 (E3: 결과 타입과 무관하게 비리프면 조용히 무시하지 않는다)
  if p_patch ? 'assigneeIds' and n.task_type is null then
    perform public.fail('NODE_NOT_LEAF', '하위 항목이 있는 노드에는 담당자를 줄 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;

  -- 과제 유형 (리프만, 제출물 있으면 양방향 불가)
  v_type := n.task_type;
  if p_patch ? 'taskType' then
    if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '하위 항목이 있는 노드에는 과제 유형을 줄 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
    v_type := upper(coalesce(p_patch->>'taskType', ''));
    if v_type not in ('COMMON', 'DESIGNATED') then
      perform public.fail('VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', '{"field":"taskType"}'::jsonb);
    end if;
    if v_type <> n.task_type and public.node_has_submissions(n.id) then
      perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 과제는 유형을 바꿀 수 없어요', jsonb_build_object('nodeId', n.id::text));
    end if;
  end if;

  -- 담당자 (결과 타입이 DESIGNATED 일 때만)
  if v_type = 'DESIGNATED' and p_patch ? 'assigneeIds' then
    if jsonb_typeof(p_patch->'assigneeIds') <> 'array' then
      perform public.fail('VALIDATION_FAILED', '담당자 목록이 올바르지 않아요', '{"field":"assigneeIds"}'::jsonb);
    end if;
    if exists (select 1 from jsonb_array_elements(p_patch->'assigneeIds') e where jsonb_typeof(e) <> 'string') then   -- I2
      perform public.fail('VALIDATION_FAILED', '담당자 id 가 올바르지 않아요', '{"field":"assigneeIds"}'::jsonb);
    end if;
    begin
      select coalesce(array_agg(distinct x::uuid), '{}') into v_ids from jsonb_array_elements_text(p_patch->'assigneeIds') x;
    exception when invalid_text_representation then
      perform public.fail('VALIDATION_FAILED', '담당자 id 가 올바르지 않아요', '{"field":"assigneeIds"}'::jsonb);
    end;
    select u into v_bad from unnest(v_ids) u
    where not exists (select 1 from public.room_members m
                      where m.room_id = r.id and m.user_id = u and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks))
    limit 1;
    if v_bad is not null then
      perform public.fail('ASSIGNEE_NOT_MEMBER', '활성 참가자만 담당자로 지정할 수 있어요', jsonb_build_object('field', 'assigneeIds', 'userId', v_bad::text));
    end if;
  elsif v_type = 'DESIGNATED' and n.task_type = 'COMMON' then
    -- 공통 → 지정 전환, 담당자 미지정: 전환 직전 담당자 승계 (E6)
    select coalesce(array_agg(user_id), '{}') into v_ids from public.task_assignments where node_id = n.id and released_at is null;
  end if;

  if v_ids is not null then
    select coalesce(array_agg(user_id), '{}') into v_cur from public.task_assignments where node_id = n.id and released_at is null;
    select coalesce(array_agg(u), '{}') into v_removed from unnest(v_cur) u where u <> all(v_ids);
    select coalesce(array_agg(u), '{}') into v_added   from unnest(v_ids) u where u <> all(v_cur);
    select s.user_id into v_bad from public.submissions s where s.node_id = n.id and s.user_id = any(v_removed) limit 1;
    if v_bad is not null then
      perform public.fail('ASSIGNEE_HAS_SUBMISSION', '이미 제출한 담당자는 뺄 수 없어요. 과제를 보관해 주세요', jsonb_build_object('field', 'assigneeIds', 'userId', v_bad::text));
    end if;
    update public.task_assignments set released_at = now()
    where node_id = n.id and released_at is null and user_id = any(v_removed);
    insert into public.task_assignments (node_id, user_id, source)
    select n.id, u, 'DESIGNATED' from unnest(v_ids) u
    on conflict (node_id, user_id) do update set released_at = null, source = 'DESIGNATED';
  end if;

  -- 지정 → 공통: 공통 대상이 아닌 사람의 DESIGNATED 행을 풀어 둔다. resync 가 대상자만 COMMON 으로 되살린다 (E4)
  if n.task_type = 'DESIGNATED' and v_type = 'COMMON' then
    update public.task_assignments set released_at = now()
    where node_id = n.id and source = 'DESIGNATED' and released_at is null;
  end if;

  update public.goal_nodes set
    title = v_title, description_md = v_desc, start_date = v_s, end_date = v_e, label = v_label,
    task_type = v_type, updated_at = now()
  where id = n.id;

  -- 0024 D2: 자손 동반 이동 — 이동 날수 = 시작일 차이(종료일만 바꾸면 0). 보관·개인 목표 포함(상대 일정 유지, D1 과 같은 규칙).
  -- 자손은 이 문장으로만 옮긴다 → 과제별 SCHEDULE_CHANGED 는 나가지 않는다(아래 회차 알림 1건이 대신)
  if v_shift and v_s <> n.start_date then
    v_days := v_s - n.start_date;
    select coalesce(array_agg(x), '{}') into v_desc_ids from public.node_subtree(n.id) x where x <> n.id;
    select jsonb_build_object('days', v_days,
             'tasks',    count(*) filter (where g.archived_at is null and g.task_type in ('COMMON', 'DESIGNATED')),
             'personal', count(*) filter (where g.archived_at is null and g.task_type = 'PERSONAL'),
             'groups',   count(*) filter (where g.archived_at is null and g.task_type is null),
             'archived', count(*) filter (where g.archived_at is not null))
    into v_moved from public.goal_nodes g where g.id = any(v_desc_ids);
    update public.goal_nodes set start_date = start_date + v_days, end_date = end_date + v_days, updated_at = now()
    where id = any(v_desc_ids);
    select v_warn || coalesce(jsonb_agg(jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', g.id::text) order by g.id), '[]'::jsonb)
    into v_warn
    from public.goal_nodes g
    where g.id = any(v_desc_ids) and g.archived_at is null and (g.start_date < r.start_date or g.end_date > r.end_date);
  end if;
  perform public.assignment_resync(r.id);

  -- 경고 (D9: 부모·방 기간 밖 허용 + 경고, 담당자 0명 경고)
  if n.parent_id is not null then
    select * into p from public.goal_nodes where id = n.parent_id;
    if v_s < p.start_date or v_e > p.end_date then
      v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_PARENT', 'nodeId', n.id::text);
    end if;
  end if;
  if v_s < r.start_date or v_e > r.end_date then
    v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', n.id::text);
  end if;
  if v_type = 'DESIGNATED' then
    select asg into v_asg from public.room_progress(r.id) where node_id = n.id;
    if coalesce(v_asg, 0) = 0 then v_warn := v_warn || jsonb_build_object('code', 'UNASSIGNED_TASK', 'nodeId', n.id::text); end if;
  end if;

  -- 알림. 행위자(v_uid) 제외는 notify_publish 계약이 맡는다(A5). 행위 이벤트 → prefix 'KIND:room:node:' || txid_current() (D8)
  -- 일정 변경은 진행중 방만(모집 중 편집은 계획 단계). 담당 지정·해제는 0024 부터 모집 중에도(#13: 팀원이 지정 과제를 만들어 담당을 줘도 무통지였다)
  if r.status = 'ACTIVE' and v_type is not null then
    if (v_s, v_e) is distinct from (n.start_date, n.end_date) then
      select coalesce(array_agg(user_id), '{}') into v_rcpt
      from public.task_assignments where node_id = n.id and released_at is null;
      if cardinality(v_rcpt) > 0 then
        perform public.notify_publish('SCHEDULE_CHANGED', r.id, n.id, v_uid, v_rcpt,
          'SCHEDULE_CHANGED:' || r.id || ':' || n.id || ':' || txid_current(),
          jsonb_build_object('title', v_title, 'startDate', to_char(v_s, 'YYYY-MM-DD'), 'endDate', to_char(v_e, 'YYYY-MM-DD'),
                             -- 0023: 본문이 옛 날짜 → 새 날짜를 말하도록 저장 전 기간을 함께 넘긴다
                             'oldStartDate', to_char(n.start_date, 'YYYY-MM-DD'), 'oldEndDate', to_char(n.end_date, 'YYYY-MM-DD')));
      end if;
    end if;
  end if;
  if r.status in ('RECRUIT', 'ACTIVE') and v_type is not null then
    if cardinality(v_added) > 0 then
      perform public.notify_publish('TASK_ASSIGNED', r.id, n.id, v_uid, v_added,
        'TASK_ASSIGNED:' || r.id || ':' || n.id || ':' || txid_current(),
        jsonb_build_object('title', v_title, 'endDate', to_char(v_e, 'YYYY-MM-DD')));
    end if;
    if cardinality(v_removed) > 0 then
      perform public.notify_publish('TASK_UNASSIGNED', r.id, n.id, v_uid, v_removed,
        'TASK_UNASSIGNED:' || r.id || ':' || n.id || ':' || txid_current(),
        jsonb_build_object('title', v_title));
    end if;
  end if;
  -- 0024 D2: 회차(depth 2 비리프) 기간이 바뀌면 진행중 방의 ACTIVE 멤버 전원에게 1건. moved = 함께 옮긴 과제 + 개인 목표(보관 제외)
  if r.status = 'ACTIVE' and n.depth = 2 and v_type is null and (v_s, v_e) is distinct from (n.start_date, n.end_date) then
    select coalesce(array_agg(m.user_id), '{}') into v_rcpt from public.room_members m where m.room_id = r.id and m.status = 'ACTIVE';
    perform public.notify_publish('ROUND_SCHEDULE_CHANGED', r.id, n.id, v_uid, v_rcpt,
      'ROUND_SCHEDULE_CHANGED:' || r.id || ':' || n.id || ':' || txid_current(),
      jsonb_build_object('oldStartDate', to_char(n.start_date, 'YYYY-MM-DD'), 'oldEndDate', to_char(n.end_date, 'YYYY-MM-DD'),
                         'startDate', to_char(v_s, 'YYYY-MM-DD'), 'endDate', to_char(v_e, 'YYYY-MM-DD'),
                         'moved', (v_moved ->> 'tasks')::int + (v_moved ->> 'personal')::int,
                         'movedTasks', (v_moved ->> 'tasks')::int, 'movedPersonal', (v_moved ->> 'personal')::int));   -- 0026: 꼬리를 나눠 말한다
  end if;
  -- 0026 (리뷰 Important): 묶음(depth ≥ 3)을 하위와 함께 옮기면 회차 알림이 없으므로, 옮긴 팀 과제(보관 제외)마다 담당자에게 SCHEDULE_CHANGED.
  -- 과제를 직접 고친 것과 같은 모델(옛 → 새)·같은 prefix 규칙 → 과제당 1건, 이 저장 안에서 중복 없음
  if r.status = 'ACTIVE' and n.depth >= 3 and v_type is null and v_days <> 0 then
    for p in
      select g.* from public.goal_nodes g
      where g.id = any(v_desc_ids) and g.archived_at is null and g.task_type in ('COMMON', 'DESIGNATED') order by g.id
    loop
      select coalesce(array_agg(a.user_id), '{}') into v_rcpt from public.task_assignments a where a.node_id = p.id and a.released_at is null;
      if cardinality(v_rcpt) > 0 then
        perform public.notify_publish('SCHEDULE_CHANGED', r.id, p.id, v_uid, v_rcpt,
          'SCHEDULE_CHANGED:' || r.id || ':' || p.id || ':' || txid_current(),
          jsonb_build_object('title', p.title, 'startDate', to_char(p.start_date, 'YYYY-MM-DD'), 'endDate', to_char(p.end_date, 'YYYY-MM-DD'),
                             'oldStartDate', to_char(p.start_date - v_days, 'YYYY-MM-DD'), 'oldEndDate', to_char(p.end_date - v_days, 'YYYY-MM-DD')));
      end if;
    end loop;
  end if;

  -- 전원 제출 (0020): 담당 해제로 남은 담당자 전원이 제출한 상태가 됐다 → IMMEDIATE 만 지금(member_deactivate 0013 6단계와 같은 규칙)
  if v_open
     and (select coalesce(completion_mode, 'DAILY_DIGEST') from public.room_notification_settings where room_id = r.id) = 'IMMEDIATE'
     and exists (select 1 from public.room_leaf_stats(r.id) ls where ls.node_id = n.id and ls.asg > 0 and ls.sub = ls.asg) then
    perform public.notify_publish('TASK_ALL_SUBMITTED', r.id, n.id, null, array[r.leader_id],
                                  'TASK_ALL_SUBMITTED:' || r.id || ':' || n.id, '{}'::jsonb);
  end if;

  -- 태그 자동 선택 (0013): 노드 제목이 실제로 바뀌었고, 옛 제목이나 새 제목이 CURATED 용어를 담을 때만
  if p_patch ? 'title' and v_title is distinct from n.title
     and (public.tag_text_relevant(n.title) or public.tag_text_relevant(v_title)) then
    perform public.tag_autoselect(r.id);
  end if;

  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('warnings', v_warn, 'shifted', v_moved);
end $$;

-- notify_render (0024 + 회차 꼬리 분리)
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
    when p_kind = 'ROOM_PERIOD_CHANGED' then
      coalesce(public.notify_range((p_model ->> 'oldStartDate')::date, (p_model ->> 'oldEndDate')::date, v_today) || ' → ', '')
      || public.notify_range((p_model ->> 'startDate')::date, (p_model ->> 'endDate')::date, v_today)
    when p_kind = 'ROUND_STARTED' and v_label is not null and v_node is distinct from v_label then v_node
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
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

-- personal_archive (0024 + 이탈 소유자 제외)
create or replace function public.personal_archive(p_slug text, p_node_id bigint, p_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes; v_n int;
begin
  if p_archived is null then perform public.fail('VALIDATION_FAILED', '보관 여부가 필요해요', '{"field":"archived"}'::jsonb); end if;
  r := public.personal_room(p_slug, v_uid);
  n := public.personal_get(r.id, p_node_id, v_uid);
  if not ((n.owner_id = v_uid and public.personal_eligible(r.id, v_uid)) or r.leader_id = v_uid) then
    perform public.fail('NOT_OWNER', '본인 개인 목표만 보관할 수 있어요');
  end if;
  if p_archived then
    update public.goal_nodes set archived_at = now(), updated_at = now() where id = n.id and archived_at is null;
    get diagnostics v_n = row_count;
    if v_n > 0 and n.owner_id <> v_uid and public.personal_eligible(r.id, n.owner_id) then   -- 0026: 이탈한 소유자는 방을 못 읽는다 → 알림 없음
      perform public.notify_publish('PERSONAL_ARCHIVED', r.id, n.id, v_uid, array[n.owner_id],
        'PERSONAL_ARCHIVED:' || r.id || ':' || n.id || ':' || txid_current(), '{}'::jsonb);
    end if;
  elsif n.archived_at is not null then
    if exists (select 1 from public.goal_nodes p where p.id = n.parent_id and p.archived_at is not null) then
      perform public.fail('PARENT_ARCHIVED', '회차가 보관 중이에요. 회차를 먼저 해제해 주세요', jsonb_build_object('nodeId', n.parent_id::text));
    end if;
    if not public.personal_eligible(r.id, n.owner_id) then
      perform public.fail('OWNER_NOT_ACTIVE', '팀을 떠난 팀원의 목표는 되살릴 수 없어요');
    end if;
    perform public.personal_assert_capacity(n.parent_id, n.owner_id, n.id);
    update public.goal_nodes set archived_at = null, updated_at = now() where id = n.id;
  end if;
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- job_submission_digest (0024 + 범위 조건)
create or replace function public.job_submission_digest() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.kst_today(); r record; v_n int := 0;
begin
  for r in
    with s as (
      select n.room_id, rm.leader_id, x.node_id, count(*)::int as c, max(x.first_submitted_at) as last_at
      from public.submissions x
      join public.goal_nodes n on n.id = x.node_id
      join public.rooms rm on rm.id = n.room_id
      where n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null
        and rm.status = 'ACTIVE' and rm.archived_at is null
        and x.user_id <> rm.leader_id
        -- 0026: KST 어제를 timestamptz 범위로 → ix_submissions_first_submitted 를 탄다
        and x.first_submitted_at >= ((v_today - 1)::timestamp at time zone 'Asia/Seoul')
        and x.first_submitted_at <  (v_today::timestamp at time zone 'Asia/Seoul')
      group by n.room_id, rm.leader_id, x.node_id)
    select s.room_id, s.leader_id, sum(s.c)::int as cnt, count(*)::int as tasks,
           (array_agg(s.node_id order by s.c desc, s.last_at desc, s.node_id))[1] as top
    from s group by s.room_id, s.leader_id order by s.room_id
  loop
    v_n := v_n + public.notify_publish('SUBMISSION_DIGEST', r.room_id, r.top, null, array[r.leader_id],
                                       'SUBMISSION_DIGEST:' || r.room_id || ':' || to_char(v_today, 'YYYY-MM-DD'),
                                       jsonb_build_object('count', r.cnt, 'tasks', r.tasks));
  end loop;
  return v_n;
end $$;

-- ───────── 3. 방이 종료·보관되면 LEAVE_REQUESTED 읽음 (리뷰 Minor 9) ─────────
-- 요청 행은 남기되(0024 계약: 노출만 안 함) 그룹장 알림이 읽지 않음으로 남지 않게
create or replace function public.rooms_leave_requests_expire() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (old.status = 'ACTIVE' and new.status is distinct from 'ACTIVE') or (old.archived_at is null and new.archived_at is not null) then
    update public.notifications set read_at = now()
     where user_id = new.leader_id and kind = 'LEAVE_REQUESTED' and room_id = new.id and read_at is null;
  end if;
  return null;
end $$;
create trigger trg_rooms_leave_requests_expire
  after update of status, archived_at on public.rooms
  for each row execute function public.rooms_leave_requests_expire();

