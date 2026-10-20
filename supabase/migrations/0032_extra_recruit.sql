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

-- ───────── 9. 초대: 판정 · JSON (D7·D8) ─────────
create or replace function public.invite_bypass_ok(i public.room_invites, r public.rooms) returns boolean
language sql stable security definer set search_path = '' as $$
  -- 실효 기한 = least(bypass_until, 방 종료일) (Codex #3 — 종료일 단축 대응)
  select i.revoked_at is null and i.bypass_until is not null and least(i.bypass_until, r.end_date) >= public.kst_today()
     and (i.bypass_max is null or i.bypass_used < i.bypass_max)
     and r.archived_at is null and r.status in ('RECRUIT', 'ACTIVE')
$$;

-- invite_get·invite_rotate·invite_bypass_set 응답(InviteLink) — 기존 키 today/token/url 유지 + code·bypass
create or replace function public.invite_json(i public.room_invites, r public.rooms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'token', i.token, 'url', '/invite/' || i.token, 'code', i.code,
    'bypass', case when i.bypass_until is null then null else jsonb_build_object(
      'until', to_char(least(i.bypass_until, r.end_date), 'YYYY-MM-DD'), 'max', i.bypass_max, 'used', i.bypass_used,   -- 실효 기한
      'active', public.invite_bypass_ok(i, r)) end)
$$;

-- invite_ensure ← 0004 판. 0032: 새 행에 코드, 코드 없는 기존 활성 행은 처음 볼 때 채운다
create or replace function public.invite_ensure(p_room bigint, p_by uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text; v_code text;
begin
  select token, code into v_token, v_code from public.room_invites where room_id = p_room and revoked_at is null;
  if v_token is null then
    -- 동시 요청이면 ux_room_invites_active 에 걸린다 → 23505 원문 대신 이긴 쪽 토큰을 다시 읽는다 (D9)
    insert into public.room_invites (token, room_id, created_by, code)
    values (replace(gen_random_uuid()::text, '-', ''), p_room, p_by, public.invite_code_new())   -- 0032: 코드도
    on conflict do nothing;
    select token into v_token from public.room_invites where room_id = p_room and revoked_at is null;
  elsif v_code is null then
    -- 0032: 코드 없는 기존 행(로컬 seed 등) — 처음 볼 때 채운다
    update public.room_invites set code = public.invite_code_new() where token = v_token and code is null;
  end if;
  return v_token;
end $$;

-- invite_get ← 0005 판. 0032: 반환 = invite_json (code·bypass)
create or replace function public.invite_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; v_token text; i public.room_invites;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 초대 링크를 볼 수 있어요');
  v_token := public.invite_ensure(r.id, v_uid);
  select * into i from public.room_invites where token = v_token;
  return public.invite_json(i, r);   -- 0032: code·bypass
end $$;

-- invite_rotate ← 0005 판. 0032: 반환 = invite_json. 회전 = 새 행 → 바로 참가 꺼짐
create or replace function public.invite_rotate(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; v_token text; i public.room_invites;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 초대 링크를 바꿀 수 있어요');
  update public.room_invites set revoked_at = now() where room_id = r.id and revoked_at is null;
  v_token := public.invite_ensure(r.id, v_uid);
  select * into i from public.room_invites where token = v_token;
  return public.invite_json(i, r);   -- 0032: code·bypass
end $$;

-- invite_preview ← 0005 판. 0032: room.recruitUntil · join {mode, via, until}
create or replace function public.invite_preview(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); r public.rooms; i public.room_invites; v_bypass boolean; v_open boolean;
begin
  r := public.invite_resolve(p_token);
  select * into i from public.room_invites where token = p_token;
  v_bypass := public.invite_bypass_ok(i, r);
  v_open   := public.room_recruit_open(r);
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'room', jsonb_build_object(
      'slug', r.slug, 'title', r.title, 'intro', r.intro,
      'startDate', to_char(r.start_date, 'YYYY-MM-DD'), 'endDate', to_char(r.end_date, 'YYYY-MM-DD'),
      'memberCount', r.member_count, 'maxMembers', r.max_members,
      'status', lower(r.status), 'isPublic', r.visibility = 'PUBLIC', 'joinMode', lower(r.join_mode), 'tags', public.room_tags_json(r.id),
      'recruitUntil', case when v_open then to_char(public.room_recruit_until(r), 'YYYY-MM-DD') end),   -- 0032
    'leader', public.person_json(r.leader_id),
    'me', public.room_me_json(r.id, v_uid),
    -- 0032: 지금 이 초대로 할 수 있는 것. mode null = 참가 불가(종료·모집 끝)
    'join', jsonb_build_object(
      'mode',  case when v_bypass then 'direct' when v_open then lower(r.join_mode) end,
      'via',   case when v_bypass then 'invite' when v_open and r.status = 'ACTIVE' then 'extra' when v_open then 'recruit' end,
      'until', case when v_bypass then to_char(least(i.bypass_until, r.end_date), 'YYYY-MM-DD')   -- 실효 기한 (v_bypass → bypass_until not null)
                    when v_open and r.status = 'ACTIVE' then to_char(public.room_recruit_until(r), 'YYYY-MM-DD') end));
end $$;

-- ───────── 10. 바로 참가 설정 (그룹장) ─────────
-- p_until null = 끄기. 켜기: 오늘..min(종료일, 오늘+30). 켜져 있던 상태에서 바꾸면 사용 수는 유지, 꺼져 있다 켜면 0부터
create or replace function public.invite_bypass_set(p_slug text, p_until date, p_max int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  i       public.room_invites;
  v_token text;
  v_last  date;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 초대 설정을 바꿀 수 있어요');
  if r.archived_at is not null or r.status not in ('RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_STATUS_INVALID', '모집중이거나 진행중인 방에서만 바꿀 수 있어요');
  end if;
  v_last := least(r.end_date, v_today + 30);
  if p_until is not null and (p_until < v_today or p_until > v_last) then
    perform public.fail('INVALID_PERIOD', '바로 참가 기한은 오늘부터 30일 안, 스터디 종료일까지예요',
      jsonb_build_object('field', 'bypassUntil', 'maxDate', to_char(v_last, 'YYYY-MM-DD')));
  end if;
  if p_max is not null and (p_max < 1 or p_max > 100) then
    perform public.fail('VALIDATION_FAILED', '인원 한도는 1~100명이에요', '{"field":"bypassMax"}'::jsonb);
  end if;
  v_token := public.invite_ensure(r.id, v_uid);
  update public.room_invites
     set bypass_used  = case when bypass_until is null then 0 else bypass_used end,
         bypass_until = p_until,
         bypass_max   = case when p_until is null then null else p_max end
   where token = v_token
  returning * into i;
  return public.invite_json(i, r);
end $$;

-- ───────── 11. 바로 참가 (내부, invite_join 이 부른다) ─────────
-- 잠금: 방 → 초대 행. 잠근 뒤 다시 판정(동시 한도). 정원은 지킨다(D3). PENDING 이면 승인 없이 승격
create or replace function public.room_join_by_invite(p_slug text, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; i public.room_invites; m public.room_members;
begin
  r := public.room_lock(p_slug);
  select * into i from public.room_invites where token = p_token and room_id = r.id for update;
  if not found or not public.invite_bypass_ok(i, r) then
    perform public.fail('INVITE_EXPIRED', '바로 참가 기한이 끝났거나 인원이 찼어요 · 그룹장에게 문의해 주세요');
  end if;
  if r.leader_id = v_uid then perform public.fail('OWNER_CANNOT_JOIN', '그룹장은 이미 참가자예요'); end if;
  select * into m from public.room_members where room_id = r.id and user_id = v_uid;
  if found then
    if m.status = 'ACTIVE' then perform public.fail('ALREADY_MEMBER', '이미 참가한 방이에요'); end if;
    if m.status = 'INACTIVE' then perform public.fail('MEMBER_NOT_ACTIVE', '이탈 처리된 방에는 다시 참가할 수 없어요'); end if;
  end if;
  perform public.room_take_seat(r.id);                       -- ROOM_FULL
  perform public.room_member_activate(r, v_uid, 'invite');
  update public.room_invites set bypass_used = bypass_used + 1 where token = i.token;
  return public.membership_result(r.id, v_uid);
end $$;

-- invite_join ← 0024 판. 0032: 바로 참가 갈래
create or replace function public.invite_join(p_token text, p_message text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; i public.room_invites;   -- require_user() 를 resolve 보다 먼저: 비로그인은 INVITE_* 대신 AUTH_REQUIRED
begin
  r := public.invite_resolve(p_token);
  select * into i from public.room_invites where token = p_token;
  -- 0032: 바로 참가 초대 → 모집 상태·참가 방식과 무관하게 바로(D8). 아니면 지금과 같음(precheck 가 모집 열림 판정)
  if public.invite_bypass_ok(i, r) then return public.room_join_by_invite(r.slug, p_token); end if;
  if r.join_mode = 'DIRECT' then return public.room_join(r.slug, p_token); end if;
  return public.room_apply(r.slug, p_token, p_message);
end $$;

-- ───────── 12. 코드 조회 (D9·D10, §6) ─────────
-- 로그인 필수. 사용자별 실패 10회/1시간. 못 찾음은 "반환"한다 — fail 로 던지면 실패 기록 INSERT 가 롤백돼 제한이 무력해진다.
-- 실패만 기록한다(성공·회전 코드 적중은 저장 안 함 — Codex #7). 정리는 room_tick(1일).
-- 회전된 코드는 옛 링크로 보낸다(랜딩이 INVITE_REVOKED 를 보여 준다) — 실패로 세지 않는다.
-- 한계: 사용자별 제한이라 여러 계정으로 나눠 시도하는 것은 막지 못한다(스펙 §6 — 필요하면 요청/IP 제한을 따로 설계)
create or replace function public.invite_code_lookup(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_code  text := public.invite_code_norm(p_code);
  v_limit constant int := 10;
  v_fails int;
  v_token text;
begin
  perform pg_advisory_xact_lock(hashtextextended('sgtudy.invite_code:' || v_uid, 0));
  select count(*)::int into v_fails from public.invite_code_failures
  where user_id = v_uid and created_at > public.app_now() - interval '1 hour';
  if v_fails >= v_limit then
    perform public.fail('RATE_LIMITED', '코드를 너무 많이 틀렸어요 · 1시간 뒤에 다시 시도해 주세요', '{"retryAfterMinutes":60}'::jsonb);
  end if;
  if v_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$' then
    select token into v_token from public.room_invites where code = v_code;
  end if;
  if v_token is null then
    insert into public.invite_code_failures (user_id, created_at) values (v_uid, public.app_now());
    return jsonb_build_object('found', false, 'remaining', v_limit - v_fails - 1);
  end if;
  return jsonb_build_object('found', true, 'url', '/invite/' || v_token);
end $$;

grant execute on function public.invite_bypass_set(text, date, int) to authenticated;
grant execute on function public.invite_code_lookup(text)           to authenticated;

-- ───────── 13. 읽기 경로 (D5·D9·D14, Codex #4·#5) ─────────
-- room_detail_json ← 0026 판. 0032: recruit {open, extraUntil}(모두에게) · invite = invite_json − today(그룹장에게만)
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
    -- 0032: 코드·바로 참가 설정까지(그룹장에게만, D9). 코드 없는 행이면 code null — 화면이 invite_get 으로 채운다
    select public.invite_json(i, r) - 'today' into v_invite
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
    'recruit', jsonb_build_object(
      'open', public.room_recruit_open(r),
      'extraUntil', case when r.status = 'ACTIVE' and public.room_recruit_open(r) then to_char(public.room_recruit_until(r), 'YYYY-MM-DD') end),   -- 0032 실효 마감
    'invite', v_invite, 'pendingCount', v_pending, 'leaveRequestCount', v_leaves,
    'myPermissions', jsonb_build_object('canEditCurriculum', public.can_edit_curriculum(r, p_uid)));
end $$;


-- room_matches ← 0004 판. 0032: status 'recruit' 가 추가 모집 창이 열린 ACTIVE 방도 포함(D5)
create or replace function public.room_matches(p_room bigint, p_status text, p_q text, p_tags text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room
      and (p_status = 'all' or r.status = upper(p_status)
           -- 0032: 추가 모집도 '모집중'(D5). 실효 마감·NULL 가드는 room_recruit_open(→ room_recruit_until) 한 곳에서
           or (p_status = 'recruit' and r.status = 'ACTIVE' and public.room_recruit_open(r)))
      and (p_q is null
           or r.title ilike '%' || public.like_escape(p_q) || '%'
           or exists (select 1 from public.room_tags rt join public.tags t on t.slug = rt.tag_slug
                      where rt.room_id = r.id
                        and (t.label ilike '%' || public.like_escape(p_q) || '%'
                             or exists (select 1 from unnest(t.aliases) a where a ilike '%' || public.like_escape(p_q) || '%'))))
      and (p_tags is null or exists (select 1 from public.room_tags rt where rt.room_id = r.id and rt.tag_slug = any(p_tags))))
$$;


-- rooms_list ← 0024 판. 0032: 카드 isFull(모집 열림 ∧ 꽉 참) · recruitUntil(ACTIVE ∧ 창 열림일 때 실효 마감)
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

  -- 탭 총계(0024, #19): 범위마다 현재 상태·검색어·태그 조건을 적용한 수 — 조건을 걸면 탭 숫자도 따라 바뀐다. 비로그인은 mine/created 0.
  -- room_matches 는 방마다 한 번만(where 절) 평가하고, 범위 판정만 세 번 — 0004 고정값과 같은 스캔 한 번
  select jsonb_build_object(
    'public',  count(*) filter (where public.room_in_scope(r.id, 'public', v_uid)),
    'mine',    count(*) filter (where v_uid is not null and public.room_in_scope(r.id, 'mine', v_uid)),
    'created', count(*) filter (where v_uid is not null and public.room_in_scope(r.id, 'created', v_uid)))
  into v_counts
  from public.rooms r where r.archived_at is null and public.room_matches(r.id, v_status, v_q, v_tags);

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
               case when v_sort <> 'startDate' then r.created_at end desc, r.id desc) as ord   -- startDate: start_date asc, id desc
      from public.rooms r
      where public.room_in_scope(r.id, v_scope, v_uid) and public.room_matches(r.id, v_status, v_q, v_tags)) o
    order by o.ord
    limit v_size offset (v_page::bigint * v_size)   -- int 곱셈 22003 방지
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
    'status', lower(p.status),
    -- 0032: 모집 열림(RECRUIT ∨ 추가 모집 창) ∧ 꽉 참
    -- 주의(Codex 2-1): least(NULL, end_date) = end_date — 창이 없는 방을 걸러야 하므로 recruit_until is not null 가드 필수
    'isFull', (p.status = 'RECRUIT'
               or (p.status = 'ACTIVE' and p.recruit_until is not null and least(p.recruit_until, p.end_date) >= v_today))
              and p.member_count >= p.max_members,
    'recruitUntil', case when p.status = 'ACTIVE' and p.recruit_until is not null and least(p.recruit_until, p.end_date) >= v_today
                         then to_char(least(p.recruit_until, p.end_date), 'YYYY-MM-DD') end,
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


-- me_studies ← 0024 판(create or replace — 시그니처 동일, GRANT 유지). 0032: 추가 모집 대기 신청 → recruit 묶음, when.kind 'recruitEnd' (Codex #4)
create or replace function public.me_studies(p_include_archived boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  v_out   jsonb;
  v_arch  jsonb;
begin
  with mine as (
    select r.id, r.slug, r.title, r.intro, r.start_date, r.end_date,
           case when r.leader_id = v_uid then 'leader' when m.status = 'PENDING' then 'pending' else 'joined' end as membership,
           -- 0032: 대기 신청은 방 상태와 무관하게 '모집중' 묶음(추가 모집 신청 포함)
           case when m.status = 'PENDING' and r.leader_id <> v_uid then 'recruit'
                when r.status = 'ACTIVE' then 'active' when r.status in ('RECRUIT', 'DRAFT') then 'recruit' else 'ended' end as kind,
           public.room_recruit_until(r) as recruit_end   -- 0032: ACTIVE 추가 모집 실효 마감(아니면 null)
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = v_uid
    where r.archived_at is null
      -- 그룹장 분기: 방장은 room_members 행의 status 와 무관하게 자기 방을 항상 본다(DRAFT 포함). 멤버는 ACTIVE, 대기자는 모집 중인 방만.
      -- 0032: 대기자 = RECRUIT·DRAFT 방, 또는 추가 모집 창이 열린 ACTIVE 방
      and (r.leader_id = v_uid or m.status = 'ACTIVE'
           or (m.status = 'PENDING' and (r.status in ('RECRUIT', 'DRAFT') or public.room_recruit_open(r))))),
  due as (
    -- 내 OPEN 과제(미제출, 기간 안, 보관 아님) 중 가장 빠른 마감
    select n.room_id, min(n.end_date) as d
    from public.goal_nodes n
    join public.task_assignments a on a.node_id = n.id and a.user_id = v_uid and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.task_type is not null and n.archived_at is null and s.id is null
      and n.start_date <= v_today and v_today <= n.end_date
    group by n.room_id),
  items as (
    select m.*, d.d,
           jsonb_build_object('slug', m.slug, 'title', m.title, 'intro', m.intro, 'membership', m.membership, 'archived', false,
             'when', case m.kind
               when 'active'  then jsonb_build_object('kind', case when d.d is null then 'end' else 'deadline' end,
                                                      'date', to_char(coalesce(d.d, m.end_date), 'YYYY-MM-DD'))
               when 'recruit' then case when m.recruit_end is not null
                                        then jsonb_build_object('kind', 'recruitEnd', 'date', to_char(m.recruit_end, 'YYYY-MM-DD'))   -- 0032
                                        else jsonb_build_object('kind', 'start', 'date', to_char(m.start_date, 'YYYY-MM-DD')) end
               else                jsonb_build_object('kind', 'end',   'date', to_char(m.end_date, 'YYYY-MM-DD')) end) as j
    from mine m left join due d on d.room_id = m.id)
  select jsonb_build_array(
    jsonb_build_object('kind', 'active',  'items', coalesce((select jsonb_agg(j order by coalesce(d, end_date), id) from items where kind = 'active'),  '[]'::jsonb)),
    jsonb_build_object('kind', 'recruit', 'items', coalesce((select jsonb_agg(j order by start_date, id)          from items where kind = 'recruit'), '[]'::jsonb)),
    jsonb_build_object('kind', 'ended',   'items', coalesce((select jsonb_agg(j order by end_date desc, id)       from items where kind = 'ended'),   '[]'::jsonb)))
  into v_out;
  -- 0024 (#5): 보관된 방 — 내가 그룹장이거나 ACTIVE 멤버였던 방(활성 목록과 같은 자격). 보관 최신순
  if coalesce(p_include_archived, false) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'slug', r.slug, 'title', r.title, 'intro', r.intro,
             'membership', case when r.leader_id = v_uid then 'leader' else 'joined' end, 'archived', true,
             'when', jsonb_build_object('kind', 'end', 'date', to_char(r.end_date, 'YYYY-MM-DD')))
             order by r.archived_at desc, r.id), '[]'::jsonb)
    into v_arch
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = v_uid
    where r.archived_at is not null and (r.leader_id = v_uid or m.status = 'ACTIVE');
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'archived', 'items', v_arch));
  end if;
  return jsonb_build_object('today', to_char(v_today, 'YYYY-MM-DD'), 'groups', v_out);
end $$;

-- curriculum_json ← 0024 판. 0032: members[].assignFrom (Codex #5) — 그룹장·ACTIVE/INACTIVE 멤버 호출에만(Codex 2-6)
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

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'room', jsonb_build_object('slug', r.slug, 'status', lower(r.status), 'leaderDoesTasks', r.leader_does_tasks),
    'members', v_members, 'nodes', v_nodes, 'stats', v_stats,
    'myPermissions', jsonb_build_object('canEditCurriculum', public.can_edit_curriculum(r, p_uid)),
    'personal', jsonb_build_object(
      'canAdd', r.archived_at is null and r.status in ('RECRUIT', 'ACTIVE') and public.personal_eligible(p_room, p_uid),
      'perRound', public.personal_limit()));
end $$;

