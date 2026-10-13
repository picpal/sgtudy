-- 0005_membership.sql — 멤버십 상태 머신 · 초대 (플랜 02 Task 1·5)
-- 배포 후 수정 금지. Task 5 가 이 파일 끝에 함수를 이어 붙인다.

-- ───────── D4: 공통 과제 담당자 실체화 (멱등) ─────────
-- 1. 보관 아닌 COMMON 리프 × 담당 자격자(ACTIVE 멤버, 그룹장은 leader_does_tasks) → 없으면 INSERT, released 면 복구
-- 2. 유효 행인데 (리프가 COMMON 아님 | 리프 보관 | 사용자가 담당 자격 없음) → released
--    보관 리프는 COMMON·DESIGNATED 모두 해제(D13 — is_task_assignee 가 거짓이 되어 Storage 업로드도 막힌다).
--    이때 released_at = 리프의 archived_at(같은 트랜잭션의 now()) — 플랜 03 node_unarchive 가 이 값으로 "보관 때문에 풀린 지정 행"을 되살린다.
--    DESIGNATED 행도 사용자가 ACTIVE 멤버가 아니면 released (CANCELED 참가자, INACTIVE 는 member_deactivate 가 먼저 결정)
-- 3. 행은 절대 삭제하지 않는다(제출물 보존)
create or replace function public.assignment_resync(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ldt boolean;
begin
  select leader_does_tasks into v_ldt from public.rooms where id = p_room;
  if not found then return; end if;

  -- 1. 원하는 (리프, 사용자) 조합을 채운다
  insert into public.task_assignments (node_id, user_id, source)
  select n.id, m.user_id, 'COMMON'
  from public.goal_nodes n
  cross join public.room_members m
  where n.room_id = p_room and n.task_type = 'COMMON' and n.archived_at is null
    and m.room_id = p_room and m.status = 'ACTIVE' and (m.role = 'MEMBER' or v_ldt)
  on conflict (node_id, user_id) do update
    set released_at = null, source = 'COMMON'
    where public.task_assignments.released_at is not null or public.task_assignments.source <> 'COMMON';

  -- 2a. 리프 보관 → COMMON·DESIGNATED 모두 해제(released_at = archived_at, D13) / COMMON 행인데 리프가 COMMON 아님 → 해제
  update public.task_assignments a set released_at = coalesce(n.archived_at, now())
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = p_room and a.released_at is null
    and (n.archived_at is not null or (a.source = 'COMMON' and n.task_type is distinct from 'COMMON'));

  -- 2b. 사용자가 담당 자격이 없음 → 해제 (COMMON: 자격 규칙, DESIGNATED: ACTIVE 멤버가 아닐 때만)
  update public.task_assignments a set released_at = now()
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = p_room and a.released_at is null
    and not exists (
      select 1 from public.room_members m
      where m.room_id = p_room and m.user_id = a.user_id and m.status = 'ACTIVE'
        and (a.source = 'DESIGNATED' or m.role = 'MEMBER' or v_ldt));
end $$;

-- ───────── 상태 전환 (D2) ─────────
-- RECRUIT → ACTIVE. 조건부 UPDATE 라 두 번 불러도 두 번째는 아무 일도 하지 않는다. tick 과 room_start 가 공유.
create or replace function public.room_transition_active(p_room bigint, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_expired uuid[];
  v_members uuid[];
begin
  update public.rooms set status = 'ACTIVE', started_at = now(), updated_at = now()
  where id = p_room and status = 'RECRUIT';
  if not found then return; end if;

  with x as (
    update public.room_members set status = 'EXPIRED', decided_at = now(), updated_at = now()
    where room_id = p_room and status = 'PENDING'
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_expired from x;

  perform public.assignment_resync(p_room);

  select coalesce(array_agg(user_id), '{}') into v_members
  from public.room_members where room_id = p_room and status = 'ACTIVE';

  if cardinality(v_expired) > 0 then
    perform public.notify_publish('JOIN_EXPIRED', p_room, null, p_actor, v_expired, 'JOIN_EXPIRED:' || p_room, '{}'::jsonb);
  end if;
  perform public.notify_publish('ROOM_STARTED', p_room, null, p_actor, v_members, 'ROOM_STARTED:' || p_room, '{}'::jsonb);
end $$;

-- ACTIVE → ENDED (end_date 다음날 00:00 KST 이후 tick 이 호출)
create or replace function public.room_transition_ended(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_members uuid[];
begin
  update public.rooms set status = 'ENDED', ended_at = now(), updated_at = now()
  where id = p_room and status = 'ACTIVE';
  if not found then return; end if;
  select coalesce(array_agg(user_id), '{}') into v_members
  from public.room_members where room_id = p_room and status = 'ACTIVE';
  perform public.notify_publish('ROOM_ENDED', p_room, null, null, v_members, 'ROOM_ENDED:' || p_room, '{}'::jsonb);
end $$;

-- ───────── MembershipResult (03-api §3) ─────────
create or replace function public.membership_result(p_room bigint, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'me', public.room_me_json(p_room, p_user),
    'memberCount', r.member_count,
    'members', public.room_members_json(p_room, p_user),
    'pendingCount', case when r.leader_id = p_user
                         then (select count(*)::int from public.room_members m where m.room_id = p_room and m.status = 'PENDING')
                         else 0 end)
  from public.rooms r where r.id = p_room
$$;

-- 초대 토큰 검사: 활성 → true, 그 방의 회전된 토큰 → INVITE_REVOKED, 그 외 false
create or replace function public.invite_check(p_room bigint, p_token text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_revoked timestamptz; v_found boolean;
begin
  if p_token is null then return false; end if;
  select revoked_at, true into v_revoked, v_found from public.room_invites where token = p_token and room_id = p_room;
  if v_found is null then return false; end if;
  if v_revoked is not null then perform public.fail('INVITE_REVOKED', '만료된 초대 링크예요'); end if;
  return true;
end $$;

-- 참가 공통 선행 검사. 반환: 내 기존 행(없으면 null)
create or replace function public.room_join_precheck(r public.rooms, p_uid uuid, p_token text, p_mode text)
returns public.room_members language plpgsql security definer set search_path = '' as $$
declare m public.room_members;
begin
  if r.archived_at is not null or r.status <> 'RECRUIT' then
    perform public.fail('ROOM_NOT_RECRUITING', '모집중인 방이 아니에요');
  end if;
  if r.leader_id = p_uid then perform public.fail('OWNER_CANNOT_JOIN', '그룹장은 이미 참가자예요'); end if;
  if r.visibility = 'PRIVATE' and not public.invite_check(r.id, p_token) then
    perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요');
  end if;
  if r.join_mode <> p_mode then
    perform public.fail('JOIN_MODE_MISMATCH',
      case when p_mode = 'DIRECT' then '승인제 방이에요. 참가 신청을 해 주세요' else '바로 참가할 수 있는 방이에요' end,
      jsonb_build_object('joinMode', lower(r.join_mode)));
  end if;
  select * into m from public.room_members where room_id = r.id and user_id = p_uid;
  if found then
    if m.status = 'ACTIVE' then perform public.fail('ALREADY_MEMBER', '이미 참가한 방이에요'); end if;
    if m.status = 'PENDING' then perform public.fail('ALREADY_PENDING', '이미 참가 신청한 방이에요'); end if;
    if m.status = 'INACTIVE' then perform public.fail('MEMBER_NOT_ACTIVE', '이탈 처리된 방에는 다시 참가할 수 없어요'); end if;
    return m;
  end if;
  return null;
end $$;

-- ───────── room_join: RECRUIT·DIRECT, 정원 원자 판정 (D3) ─────────
create or replace function public.room_join(p_slug text, p_invite_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  m := public.room_join_precheck(r, v_uid, p_invite_token, 'DIRECT');
  perform public.room_take_seat(r.id);                       -- ROOM_FULL
  insert into public.room_members (room_id, user_id, role, status, joined_at)
  values (r.id, v_uid, 'MEMBER', 'ACTIVE', now())
  on conflict (room_id, user_id) do update
    set status = 'ACTIVE', role = 'MEMBER', joined_at = now(), left_at = null,
        decided_at = null, decided_by = null, updated_at = now();
  perform public.assignment_resync(r.id);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── room_apply: RECRUIT·APPROVAL, 대기자는 정원 미포함(단 이미 찼으면 ROOM_FULL) ─────────
create or replace function public.room_apply(p_slug text, p_invite_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members; v_now timestamptz := now();
begin
  r := public.room_lock(p_slug);
  m := public.room_join_precheck(r, v_uid, p_invite_token, 'APPROVAL');
  if r.member_count >= r.max_members then
    perform public.fail('ROOM_FULL', '정원이 찼어요', '{"field":"maxMembers"}'::jsonb);
  end if;
  insert into public.room_members (room_id, user_id, role, status, applied_at)
  values (r.id, v_uid, 'MEMBER', 'PENDING', v_now)
  on conflict (room_id, user_id) do update
    set status = 'PENDING', role = 'MEMBER', applied_at = excluded.applied_at,
        decided_at = null, decided_by = null, left_at = null, updated_at = now();
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_REQUESTED', r.id, null, v_uid, array[r.leader_id],
    'JOIN_REQUESTED:' || r.id || ':' || v_uid || ':' || txid_current(),
    jsonb_build_object('applicant', public.person_json(v_uid)));
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── room_leave: RECRUIT 의 MEMBER 만. ACTIVE → CANCELED, 자리 반납, 배정 해제 ─────────
create or replace function public.room_leave(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  select * into m from public.room_members where room_id = r.id and user_id = v_uid and status = 'ACTIVE';
  if not found then perform public.fail('NOT_MEMBER', '참가 중인 방이 아니에요'); end if;
  if m.role = 'LEADER' then perform public.fail('OWNER_CANNOT_LEAVE', '그룹장은 참가를 취소할 수 없어요'); end if;
  if r.archived_at is not null or r.status <> 'RECRUIT' then
    perform public.fail('ROOM_NOT_RECRUITING', '모집 기간에만 참가를 취소할 수 있어요');
  end if;
  update public.room_members set status = 'CANCELED', left_at = now(), updated_at = now() where id = m.id;
  perform public.room_release_seat(r.id);
  perform public.assignment_resync(r.id);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── room_cancel_application: PENDING 본인 → CANCELED ─────────
create or replace function public.room_cancel_application(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  select * into m from public.room_members where room_id = r.id and user_id = v_uid;
  if not found or m.status = 'CANCELED' then perform public.fail('NOT_FOUND', '취소할 참가 신청이 없어요'); end if;
  if m.status <> 'PENDING' then perform public.fail('ALREADY_DECIDED', '이미 처리된 신청이에요. 새로고침해 주세요'); end if;
  update public.room_members set status = 'CANCELED', decided_at = now(), updated_at = now() where id = m.id;
  perform public.assignment_resync(r.id);
  return public.membership_result(r.id, v_uid);
end $$;

-- 승인·거절 공통: 그룹장, RECRUIT, 대상 PENDING. 반환: 대상 행
create or replace function public.room_decide_precheck(r public.rooms, p_uid uuid, p_user uuid)
returns public.room_members language plpgsql security definer set search_path = '' as $$
declare m public.room_members;
begin
  if r.leader_id <> p_uid then perform public.fail('NOT_LEADER', '그룹장만 할 수 있어요'); end if;
  if r.archived_at is not null or r.status <> 'RECRUIT' then
    perform public.fail('ROOM_NOT_RECRUITING', '모집중인 방에서만 신청을 처리할 수 있어요');
  end if;
  select * into m from public.room_members where room_id = r.id and user_id = p_user;
  if not found then perform public.fail('NOT_FOUND', '참가 신청을 찾을 수 없어요'); end if;
  if m.status <> 'PENDING' then perform public.fail('ALREADY_DECIDED', '이미 처리된 신청이에요'); end if;
  return m;
end $$;

-- ───────── room_approve: PENDING → ACTIVE (정원 원자 판정) ─────────
create or replace function public.room_approve(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members; v_now timestamptz := now();
begin
  r := public.room_lock(p_slug);
  m := public.room_decide_precheck(r, v_uid, p_user);
  perform public.room_take_seat(r.id);                       -- ROOM_FULL → 행은 PENDING 그대로
  update public.room_members
     set status = 'ACTIVE', joined_at = v_now, decided_at = v_now, decided_by = v_uid, updated_at = now()
   where id = m.id;
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_APPROVED', r.id, null, v_uid, array[p_user],
    'JOIN_APPROVED:' || r.id || ':' || p_user || ':' || txid_current(), '{}'::jsonb);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── room_reject: PENDING → REJECTED ─────────
create or replace function public.room_reject(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members; v_now timestamptz := now();
begin
  r := public.room_lock(p_slug);
  m := public.room_decide_precheck(r, v_uid, p_user);
  update public.room_members set status = 'REJECTED', decided_at = v_now, decided_by = v_uid, updated_at = now() where id = m.id;
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_REJECTED', r.id, null, v_uid, array[p_user],
    'JOIN_REJECTED:' || r.id || ':' || p_user || ':' || txid_current(), '{}'::jsonb);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── 그룹장 읽기 ─────────
create or replace function public.room_applications(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 볼 수 있어요'); end if;
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(public.person_json(m.user_id) || jsonb_build_object('appliedAt', public.iso(m.applied_at)) order by m.applied_at, m.id)
      from public.room_members m where m.room_id = r.id and m.status = 'PENDING'), '[]'::jsonb));
end $$;

create or replace function public.room_members_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.leader_id <> v_uid then perform public.fail('NOT_LEADER', '그룹장만 볼 수 있어요'); end if;
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(public.person_json(m.user_id)
               || jsonb_build_object('role', lower(m.role), 'status', lower(m.status), 'joinedAt', public.iso(m.joined_at))
               order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.applied_at nulls last, m.id)
      from public.room_members m where m.room_id = r.id), '[]'::jsonb));
end $$;

-- ───────── 공개 RPC GRANT (D7) — membership_result·invite_check·*_precheck 는 GRANT 없음 ─────────
grant execute on function public.room_join(text, text)            to authenticated;
grant execute on function public.room_apply(text, text)           to authenticated;
grant execute on function public.room_leave(text)                 to authenticated;
grant execute on function public.room_cancel_application(text)    to authenticated;
grant execute on function public.room_approve(text, uuid)         to authenticated;
grant execute on function public.room_reject(text, uuid)          to authenticated;
grant execute on function public.room_applications(text)          to authenticated;
grant execute on function public.room_members_get(text)           to authenticated;
