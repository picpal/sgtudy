-- 0032_extra_recruit.sql — 2026-10-20 추가 모집 · 초대 코드(바로 참가). 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-20-extra-recruit-design.md (D1~D13).
-- 추가형: 열·표·함수 추가 + 재정의(최신 판 복사). 기존 행 의미 무변경 — 기존 초대 행은 bypass_until null(바로 참가 꺼짐),
-- 기존 멤버는 assign_from null(처음부터 배정).
-- 재정의 원본: assignment_resync ←0014 · room_join_precheck·room_join·room_approve·room_decide_precheck ←0005 ·
--   room_tick·invite_ensure·room_matches ←0004 · invite_get·invite_rotate·invite_preview ←0005 · invite_join ←0024 ·
--   room_detail_json ←0026 · rooms_list ←0024 · notification_kinds ←0024 · notify_render ←0028 ·
--   me_studies ←0024 · curriculum_json ←0024  (18개. create or replace — 이름·인자·기본값 동일 → GRANT 유지)

-- ───────── 1. 스키마 ─────────
alter table public.rooms        add column recruit_until date;   -- 추가 모집 마감일(KST, 포함). null = 추가 모집 아님. ACTIVE 에서만 의미(D1)
alter table public.room_members add column assign_from   date;   -- 진행중 합류일(KST). null = 모집 단계 합류(처음부터 배정, D6)
alter table public.room_invites add column code          varchar(8);            -- Crockford base32 8자(D9)
alter table public.room_invites add column bypass_until  date;                  -- 이 날(KST, 포함)까지 바로 참가. null = 꺼짐(D7)
alter table public.room_invites add column bypass_max    int;                   -- 바로 참가 인원 한도. null = 정원까지
alter table public.room_invites add column bypass_used   int not null default 0;
alter table public.room_invites add constraint ck_room_invites_code   check (code is null or code ~ '^[0-9A-HJKMNP-TV-Z]{8}$');
alter table public.room_invites add constraint ck_room_invites_bypass check (bypass_max is null or bypass_max between 1 and 100);
create unique index ux_room_invites_code on public.room_invites (code) where code is not null;

-- 코드 조회 실패만(성공은 저장 안 함 — Codex #7). 사용자별 실패 10회/1시간 제한(§6). 1일 지난 행은 room_tick 이 지운다.
-- 클라이언트 접근 없음 — DEFINER RPC 만
create table public.invite_code_failures (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ix_invite_code_failures_user on public.invite_code_failures (user_id, created_at);
create index ix_invite_code_failures_at   on public.invite_code_failures (created_at);   -- tick 정리용
alter table public.invite_code_failures enable row level security;
revoke all on public.invite_code_failures from anon, authenticated;

-- ───────── 2. 코드 ─────────
-- 입력 정규화(순수 헬퍼: INVOKER·GRANT 없음): 대문자, 공백·하이픈 제거, 헷갈리는 글자 O→0, I·L→1
create or replace function public.invite_code_norm(p text) returns text
language sql immutable set search_path = '' as $$
  select translate(upper(regexp_replace(coalesce(p, ''), '[[:space:]-]', '', 'g')), 'OIL', '011')
$$;

-- 8자 Crockford base32(0-9A-Z − I L O U = 32자, 40bit). gen_random_uuid 의 랜덤 바이트(버전·변형 비트가 든 6·8번 제외) & 31
create or replace function public.invite_code_new() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_abc  constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_pick constant int[] := array[0, 1, 2, 3, 4, 5, 10, 11];
  v_b    bytea;
  v_code text;
  v_try  int := 0;
begin
  loop
    v_b := uuid_send(gen_random_uuid());
    v_code := '';
    for k in 1..8 loop
      v_code := v_code || substr(v_abc, 1 + (get_byte(v_b, v_pick[k]) & 31), 1);
    end loop;
    exit when not exists (select 1 from public.room_invites where code = v_code);
    v_try := v_try + 1;
    if v_try >= 5 then perform public.fail('INTERNAL', '초대 코드를 만들지 못했어요 · 다시 시도해 주세요'); end if;
  end loop;
  return v_code;
end $$;

-- 활성 초대 행에 코드 채우기(호스티드 기존 행). 행마다 따로 — 같은 문장 안의 중복을 피한다
do $$
declare t text;
begin
  for t in select token from public.room_invites where revoked_at is null and code is null loop
    update public.room_invites set code = public.invite_code_new() where token = t;
  end loop;
end $$;

-- ───────── 3. 모집 열림 판정 (D1) ─────────
-- 추가 모집 실효 마감(KST, 포함) = least(recruit_until, end_date). ACTIVE 가 아니거나 창이 없으면 null.
-- 종료일을 모집 마감보다 앞당겨도 저장값을 고치지 않고 여기서 자른다(Codex #3 — room_update 재정의 없음)
create or replace function public.room_recruit_until(r public.rooms) returns date
language sql stable security definer set search_path = '' as $$
  select case when r.status = 'ACTIVE' and r.recruit_until is not null then least(r.recruit_until, r.end_date) end
$$;

-- RECRUIT, 또는 ACTIVE 인데 추가 모집 창 안(실효 마감 포함). 보관 방은 언제나 닫힘
create or replace function public.room_recruit_open(r public.rooms) returns boolean
language sql stable security definer set search_path = '' as $$
  select r.archived_at is null and (
       r.status = 'RECRUIT'
    or coalesce(public.room_recruit_until(r) >= public.kst_today(), false))
$$;

-- ───────── 4. assignment_resync (0014 판 + 1줄, D6) ─────────
create or replace function public.assignment_resync(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ldt    boolean;
  v_leader uuid;
begin
  select leader_does_tasks, leader_id into v_ldt, v_leader from public.rooms where id = p_room;
  if not found then return; end if;

  -- 0 (0014). 소유자가 더는 그룹장·ACTIVE 멤버가 아닌 개인 목표 → 보관(제출물은 남는다). 되살리기는 personal_archive(false)
  update public.goal_nodes n set archived_at = now(), updated_at = now()
  where n.room_id = p_room and n.task_type = 'PERSONAL' and n.archived_at is null
    and n.owner_id <> v_leader
    and not exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = n.owner_id and m.status = 'ACTIVE');

  -- 1. 원하는 (리프, 사용자) 조합을 채운다
  insert into public.task_assignments (node_id, user_id, source)
  select n.id, m.user_id, 'COMMON'
  from public.goal_nodes n
  cross join public.room_members m
  where n.room_id = p_room and n.task_type = 'COMMON' and n.archived_at is null
    and m.room_id = p_room and m.status = 'ACTIVE' and (m.role = 'MEMBER' or v_ldt)
    and (m.assign_from is null or n.end_date >= m.assign_from)   -- 0032: 중간 합류자는 합류일 이후 마감 과제만(D6)
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

-- ───────── 5. 참가 공통: ACTIVE 로 만들기 (room_join·room_join_by_invite) ─────────
-- 진행중 방이면 assign_from = 오늘(D6) + 그룹장에게 MEMBER_JOINED(D11). 모집 단계면 지금과 같다(알림 없음)
create or replace function public.room_member_activate(r public.rooms, p_uid uuid, p_via text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_from date := case when r.status = 'ACTIVE' then public.kst_today() end;
begin
  insert into public.room_members (room_id, user_id, role, status, joined_at, assign_from)
  values (r.id, p_uid, 'MEMBER', 'ACTIVE', now(), v_from)
  on conflict (room_id, user_id) do update
    set status = 'ACTIVE', role = 'MEMBER', joined_at = now(), left_at = null,
        decided_at = null, decided_by = null, assign_from = v_from, updated_at = now();
  perform public.assignment_resync(r.id);
  if r.status = 'ACTIVE' then
    perform public.notify_publish('MEMBER_JOINED', r.id, null, p_uid, array[r.leader_id],
      'MEMBER_JOINED:' || r.id || ':' || p_uid || ':' || txid_current(), jsonb_build_object('via', p_via));
  end if;
end $$;

-- ───────── 6. 관문 재정의 (0005 판) ─────────
-- 참가 공통 선행 검사. 반환: 내 기존 행(없으면 null)
create or replace function public.room_join_precheck(r public.rooms, p_uid uuid, p_token text, p_mode text)
returns public.room_members language plpgsql security definer set search_path = '' as $$
declare m public.room_members;
begin
  perform public.room_hide_unless_known(r, p_uid, p_token);
  -- 0032: RECRUIT 전용 → 모집 열림(RECRUIT ∨ 추가 모집 창) (D1)
  if not public.room_recruit_open(r) then
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

-- room_join: 모집 열림·DIRECT, 정원 원자 판정 (D3). 0032: upsert·resync 를 room_member_activate 로
create or replace function public.room_join(p_slug text, p_invite_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  perform public.room_join_precheck(r, v_uid, p_invite_token, 'DIRECT');
  perform public.room_take_seat(r.id);                       -- ROOM_FULL
  perform public.room_member_activate(r, v_uid, 'extra');    -- 0032: 진행중(추가 모집)이면 assign_from·MEMBER_JOINED
  return public.membership_result(r.id, v_uid);
end $$;

-- 승인·거절 공통: 그룹장, 모집 열림, 대상 PENDING. 반환: 대상 행
create or replace function public.room_decide_precheck(r public.rooms, p_uid uuid, p_user uuid)
returns public.room_members language plpgsql security definer set search_path = '' as $$
declare m public.room_members;
begin
  perform public.require_leader(r, p_uid);
  -- 0032: 추가 모집 창 안에서도 처리(창이 닫히면 대기는 EXPIRED 로 정리된다 — D4)
  if not public.room_recruit_open(r) then
    perform public.fail('ROOM_NOT_RECRUITING', '모집중인 방에서만 신청을 처리할 수 있어요');
  end if;
  select * into m from public.room_members where room_id = r.id and user_id = p_user;
  if not found then perform public.fail('NOT_FOUND', '참가 신청을 찾을 수 없어요'); end if;
  if m.status <> 'PENDING' then perform public.fail('ALREADY_DECIDED', '이미 처리된 신청이에요'); end if;
  return m;
end $$;

-- room_approve: PENDING → ACTIVE (정원 원자 판정)
create or replace function public.room_approve(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members; v_now timestamptz := now();
begin
  r := public.room_lock(p_slug);
  m := public.room_decide_precheck(r, v_uid, p_user);
  perform public.room_take_seat(r.id);                       -- ROOM_FULL → 행은 PENDING 그대로
  update public.room_members
     set status = 'ACTIVE', joined_at = v_now, decided_at = v_now, decided_by = v_uid, updated_at = now(),
         assign_from = case when r.status = 'ACTIVE' then public.kst_today() end   -- 0032 (D6)
   where id = m.id;
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_APPROVED', r.id, null, v_uid, array[p_user],
    'JOIN_APPROVED:' || r.id || ':' || p_user || ':' || txid_current(), '{}'::jsonb);
  return public.membership_result(r.id, v_uid);
end $$;

-- ───────── 7. 추가 모집 열기·닫기 (D1~D4) ─────────
-- 창 닫기(내부): recruit_until null, 남은 PENDING → EXPIRED + JOIN_EXPIRED. 이미 닫혀 있으면 아무 일도 없다.
-- 호출자가 방 행을 잠갔다고 가정한다(room_extra_recruit_close·room_extra_recruit_open 은 room_lock, tick 은 auto_expire 경유)
create or replace function public.room_extra_recruit_expire(p_room bigint, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_expired uuid[];
begin
  update public.rooms set recruit_until = null, updated_at = now() where id = p_room and recruit_until is not null;
  if not found then return; end if;
  with x as (
    update public.room_members set status = 'EXPIRED', decided_at = now(), updated_at = now()
    where room_id = p_room and status = 'PENDING'
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_expired from x;
  if cardinality(v_expired) > 0 then
    -- 시작 때 만료(JOIN_EXPIRED:{room})와 겹치지 않게, 다시 열어 다시 만료돼도 알림이 가게 txid
    perform public.notify_publish('JOIN_EXPIRED', p_room, null, p_actor, v_expired,
      'JOIN_EXPIRED:' || p_room || ':extra:' || txid_current(), '{}'::jsonb);
  end if;
end $$;

-- 자동 만료(tick 용, Codex #1): 후보를 고른 뒤 그룹장이 연장·재개했을 수 있다 → 방 행을 잠그고 최신 상태로 다시 판정.
-- 닫을 조건 = 창이 있고 보관 아님 ∧ (ACTIVE 아님 ∨ 실효 마감 < 오늘). 닫았으면 true
create or replace function public.room_extra_recruit_auto_expire(p_room bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.recruit_until is null or r.archived_at is not null then return false; end if;
  if r.status = 'ACTIVE' and public.room_recruit_until(r) >= public.kst_today() then return false; end if;   -- 연장됨
  perform public.room_extra_recruit_expire(p_room, null);
  return true;
end $$;

-- 열기(이미 열려 있으면 마감일·정원·방식 바꾸기). 진행중·미보관, 마감일 = 오늘..min(종료일, 오늘+30), 빈자리 필수(D3).
-- 지난 창(실효 마감 < 오늘)이 tick 전이라 남아 있으면 먼저 만료시킨다 — 옛 PENDING 을 새 창으로 넘기지 않는다(Codex #2)
create or replace function public.room_extra_recruit_open(p_slug text, p_until date, p_max_members int default null, p_join_mode text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  v_max   int;
  v_last  date;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.archived_at is not null or r.status <> 'ACTIVE' then
    perform public.fail('ROOM_STATUS_INVALID', '진행중인 방에서만 추가 모집을 열 수 있어요');
  end if;
  v_last := least(r.end_date, v_today + 30);
  if p_until is null or p_until < v_today or p_until > v_last then
    perform public.fail('INVALID_PERIOD', '추가 모집 마감일은 오늘부터 30일 안, 스터디 종료일까지예요',
      jsonb_build_object('field', 'recruitUntil', 'maxDate', to_char(v_last, 'YYYY-MM-DD')));
  end if;
  v_max := coalesce(p_max_members, r.max_members);
  if v_max < 2 or v_max > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  -- Codex #6: ck_rooms_members(min ≤ max) 원시 오류 대신
  if r.min_members is not null and v_max < r.min_members then
    perform public.fail('VALIDATION_FAILED', format('정원은 최소 인원(%s명) 이상이어야 해요', r.min_members),
      jsonb_build_object('field', 'maxMembers', 'minMembers', r.min_members));
  end if;
  if v_max <= r.member_count then
    perform public.fail('CAPACITY_NO_SEAT', '빈자리가 없어요 · 정원을 늘려 주세요',
      jsonb_build_object('field', 'maxMembers', 'memberCount', r.member_count));
  end if;
  if p_join_mode is not null and p_join_mode not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;
  if r.recruit_until is not null and public.room_recruit_until(r) < v_today then
    perform public.room_extra_recruit_expire(r.id, v_uid);   -- Codex #2: 지난 창 정리(대기 만료 + 알림) 먼저
  end if;
  update public.rooms
     set recruit_until = p_until, max_members = v_max, join_mode = coalesce(upper(p_join_mode), join_mode), updated_at = now()
   where id = r.id;
  return public.room_detail_json(r.id, v_uid);
end $$;

create or replace function public.room_extra_recruit_close(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.recruit_until is null then perform public.fail('ROOM_STATUS_INVALID', '추가 모집 중이 아니에요'); end if;
  perform public.room_extra_recruit_expire(r.id, v_uid);
  return public.room_detail_json(r.id, v_uid);
end $$;

grant execute on function public.room_extra_recruit_open(text, date, int, text) to authenticated;
grant execute on function public.room_extra_recruit_close(text)                to authenticated;

-- room_tick (0004 판 본문 교체 — 시그니처·반환 모양 {activated, ended} 동일).
-- pg_cron 5분마다(0010, 플랜 04). 보관 방·DRAFT 는 건드리지 않는다(모든 루프 — 보관 방은 알림 제외, 해제 뒤 다음 tick 이 처리). 결과 {activated, ended}
create or replace function public.room_tick() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := public.kst_today();
  v_id    bigint;
  r       public.rooms;
  v_act   int := 0;
  v_end   int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('room_tick'));
  for v_id in
    select id from public.rooms where status = 'RECRUIT' and archived_at is null and start_date <= v_today order by id
  loop
    -- 0032 (Codex 2-2): 잠근 뒤 최신 상태로 재판정 — 그 사이 시작일을 미뤘거나 보관했으면 건너뛴다
    select * into r from public.rooms where id = v_id for update;
    if r.status = 'RECRUIT' and r.archived_at is null and r.start_date <= v_today then
      perform public.room_transition_active(v_id, null);
      v_act := v_act + 1;
    end if;
  end loop;
  for v_id in
    select id from public.rooms where status = 'ACTIVE' and archived_at is null and end_date < v_today order by id
  loop
    -- 0032 (Codex 2-2): 그 사이 종료일을 연장했으면 끝내지 않는다
    select * into r from public.rooms where id = v_id for update;
    if r.status = 'ACTIVE' and r.archived_at is null and r.end_date < v_today then
      perform public.room_transition_ended(v_id);
      v_end := v_end + 1;
    end if;
  end loop;
  -- 0032: 추가 모집 창 정리 — 실효 마감(least(recruit_until, end_date))이 지났거나 방이 더는 ACTIVE 가 아니면 닫고 대기 만료(D4).
  -- 후보는 잠금 없이 고르고, 닫기는 auto_expire 가 방 행을 잠근 뒤 다시 판정한다(그 사이 연장·재개됐으면 손대지 않음 — Codex #1).
  -- 보관 방은 건드리지 않는다(풀린 뒤 다음 tick). 반환 모양 {activated, ended} 는 기존 테스트가 고정 — 세지 않는다
  for v_id in
    select id from public.rooms
    where recruit_until is not null and archived_at is null
      and (status <> 'ACTIVE' or least(recruit_until, end_date) < v_today)
    order by id
  loop
    perform public.room_extra_recruit_auto_expire(v_id);
  end loop;
  -- 0032: 초대 코드 조회 실패 기록 정리(1일 지난 것, Codex #7) — job_cleanup(0030) 재정의를 피해 여기서
  delete from public.invite_code_failures where created_at < public.app_now() - interval '1 day';
  return jsonb_build_object('activated', v_act, 'ended', v_end);
end $$;

-- ───────── 8. 알림 MEMBER_JOINED (D11) ─────────
-- notification_kinds (0024 판 + MEMBER_JOINED)
create or replace function public.notification_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['ROUND_STARTED', 'TASK_ALL_SUBMITTED', 'TASK_COMPLETION_DIGEST', 'JOIN_REQUESTED', 'JOIN_APPROVED', 'JOIN_REJECTED',
               'JOIN_EXPIRED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'SCHEDULE_CHANGED', 'ROOM_STARTED',
               'ROOM_ENDED', 'ROOM_START_BLOCKED', 'MEMBER_DEACTIVATED',
               'CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED', 'ROOM_PERIOD_CHANGED',
               -- 0024
               'ROUND_SCHEDULE_CHANGED', 'ROOM_ARCHIVED', 'PERSONAL_ARCHIVED', 'LEAVE_REQUESTED', 'LEAVE_REQUEST_DISMISSED', 'SUBMISSION_DIGEST'
               -- 0032
               , 'MEMBER_JOINED']
$$;

-- notify_render (0028 판 + MEMBER_JOINED 제목·본문)
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
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;
