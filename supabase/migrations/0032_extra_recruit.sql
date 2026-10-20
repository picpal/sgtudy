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
