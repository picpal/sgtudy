-- 0024_scenario_qa_fixes.sql — 시나리오 QA(2026-10-18) 서버 수정. 배포 후 수정 금지. 추가형·무손실(nullable 컬럼 3개 + 함수 교체/추가 + 트리거 1 + cron 1).
-- 계약: .superpowers/sdd/2026-10-18-scenario-qa/contract.md
--  a. D1 room_start(p_slug, p_shift): 앞당겨 시작하며 일정을 당기면 방의 모든 노드(보관·개인 목표 포함)를 같은 날수만큼 앞으로. 방 종료일은 그대로
--  b. D2 node_update 의 patch 키 shiftDescendants: 회차·묶음 날짜를 바꾸며 자손(보관·개인 포함)을 같은 날수(시작일 차이)만큼. 회차 기간 변경 → ROUND_SCHEDULE_CHANGED
--  c. D3 탈퇴 요청(member_leave_request·_cancel·_dismiss, room_leave_requests). 처리는 기존 member_deactivate(+preview)
--  d. D4 참가 신청 한마디(room_apply·invite_join 의 p_message, room_applications.message)
--  e. 알림: ROOM_ARCHIVED · PERSONAL_ARCHIVED · 모집 중 지정 담당 변경 · SUBMISSION_DIGEST(09:00 KST) · 처리된 신청/탈퇴 요청 알림 자동 읽음 · 딥링크(#applications·#submissions·#leave-requests)
--     · 노드 작성자(goal_nodes.created_by → curriculum/task_get createdBy) · me_studies(p_include_archived)
--  f. 알림 본문 날짜 = src/lib/api/format.ts dateShort/rangeShort(오늘과 다른 해 → YYYY.MM.DD, 기간 끝은 시작과 다른 해면 YYYY.MM.DD)
-- 재정의 함수는 각 함수의 최신 정의를 복사해 고쳤다:
--   room_start ← 0016 · node_update ← 0023 · notify_render ← 0023 · notify_link ← 0012 · notify_enabled·notification_kinds ← 0018 ·
--   room_detail_json·member_admin_json ← 0011 · room_me_json·room_archive ← 0004 · room_apply·invite_join·room_applications ← 0005 ·
--   node_create·me_studies ← 0006 · curriculum_json·task_node_json·personal_archive ← 0014
-- 시그니처가 바뀌는 4개(room_start·room_apply·invite_join·me_studies)는 drop 후 create + GRANT(옛 이름으로 부르는 호출은 기본값으로 그대로 동작).
-- 개인 목표(0014) 규칙 유지: 편집자 RPC 는 여전히 PERSONAL 노드를 직접 못 바꾼다(node_get). 날짜 일괄 이동만 함께 옮긴다.

-- ───────── 0. 컬럼 ─────────
alter table public.goal_nodes   add column created_by uuid references public.profiles(id);
alter table public.room_members add column apply_message varchar(200);
alter table public.room_members add column leave_requested_at timestamptz;
alter table public.room_members add column leave_request_reason varchar(200);

-- ───────── 1. 날짜 표기 헬퍼 (f) — format.ts dateShort / rangeShort 와 같은 규칙 ─────────
create or replace function public.notify_date(p_d date, p_today date) returns text
language sql immutable set search_path = '' as $$
  select case when p_d is null then null
              when extract(year from p_d) = extract(year from p_today) then to_char(p_d, 'MM.DD')
              else to_char(p_d, 'YYYY.MM.DD') end
$$;
create or replace function public.notify_range(p_s date, p_e date, p_today date) returns text
language sql immutable set search_path = '' as $$
  select public.notify_date(p_s, p_today) || ' – '
         || case when extract(year from p_s) = extract(year from p_e) then to_char(p_e, 'MM.DD') else to_char(p_e, 'YYYY.MM.DD') end
$$;

-- ───────── 2. 알림 종류·설정 ─────────
create or replace function public.notification_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['ROUND_STARTED', 'TASK_ALL_SUBMITTED', 'TASK_COMPLETION_DIGEST', 'JOIN_REQUESTED', 'JOIN_APPROVED', 'JOIN_REJECTED',
               'JOIN_EXPIRED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'SCHEDULE_CHANGED', 'ROOM_STARTED',
               'ROOM_ENDED', 'ROOM_START_BLOCKED', 'MEMBER_DEACTIVATED',
               'CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED', 'ROOM_PERIOD_CHANGED',
               -- 0024
               'ROUND_SCHEDULE_CHANGED', 'ROOM_ARCHIVED', 'PERSONAL_ARCHIVED', 'LEAVE_REQUESTED', 'LEAVE_REQUEST_DISMISSED', 'SUBMISSION_DIGEST']
$$;

create or replace function public.notify_enabled(p_kind text, p_room bigint, p_model jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'DEADLINE_REMINDER' then case coalesce(p_model ->> 'days', '1') when '3' then s.reminder_d3 else s.reminder_d1 end
      when 'TASK_ASSIGNED'     then s.task_assigned
      when 'TASK_UNASSIGNED'   then s.task_assigned
      when 'SCHEDULE_CHANGED'  then s.schedule_changed
      when 'ROOM_PERIOD_CHANGED' then s.schedule_changed      -- 0018: 일정 변경 설정을 함께 따른다
      when 'ROUND_SCHEDULE_CHANGED' then s.schedule_changed   -- 0024: 회차 일정도 같은 설정
      when 'ROOM_STARTED'      then s.room_start_end
      when 'ROOM_ENDED'        then s.room_start_end
      else true end
    from public.room_notification_settings s where s.room_id = p_room), true)
$$;

-- ───────── 3. notify_render (0023) — 새 kind, 날짜 표기 통일 ─────────
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
      || case when coalesce((p_model ->> 'moved')::int, 0) > 0 then format(' · 과제 %s개도 함께 옮겼어요', p_model ->> 'moved') else '' end
    when p_kind = 'JOIN_REQUESTED'  then nullif(p_model ->> 'message', '')
    when p_kind = 'LEAVE_REQUESTED' then nullif(p_model ->> 'reason', '')
    when p_kind = 'ROOM_ARCHIVED'   then '내 스터디의 보관함에서 다시 볼 수 있어요'
    when p_kind = 'SUBMISSION_DIGEST' and p_node is not null then
      case when v_tasks <= 1 then format('"%s"', v_node) else format('"%s" 외 과제 %s개', v_node, v_tasks - 1) end
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

-- ───────── 4. notify_link (0012) — 딥링크 앵커 ─────────
-- #submissions: 과제 상세의 제출 현황 · #applications: 개요 승인 대기 패널 · #leave-requests: 멤버 관리의 탈퇴 요청 목록
create or replace function public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_node is not null and p_kind in ('TASK_ALL_SUBMITTED', 'SUBMISSION_DIGEST')
      then '/my-study/' || r.slug || '?task=' || p_node || '#submissions'
    when p_node is not null and p_kind in ('DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'PERSONAL_ARCHIVED')
      then '/my-study/' || r.slug || '?task=' || p_node
    when p_kind in ('CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED', 'ROUND_SCHEDULE_CHANGED')
      then '/my-study/' || r.slug || '?tab=curriculum'
    when r.leader_id = p_user and p_kind = 'JOIN_REQUESTED'  then '/my-study/' || r.slug || '#applications'
    when r.leader_id = p_user and p_kind = 'LEAVE_REQUESTED' then '/my-study/' || r.slug || '#leave-requests'
    when r.leader_id = p_user
      or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_user and m.status = 'ACTIVE')
      then '/my-study/' || r.slug
    else '/rooms/' || r.slug end
  from public.rooms r where r.id = p_room
$$;

-- ───────── 5. room_members 트리거 — 요청 정리·처리된 알림 자동 읽음 (#18, D3) ─────────
-- ① ACTIVE 가 아니게 되면(이탈 처리·…) 탈퇴 요청을 비운다 ② PENDING 이 처리되면(승인·거절·취소·만료) 그 신청의 JOIN_REQUESTED 를 읽음
-- ③ 탈퇴 요청이 비워지면(취소·반려·이탈) LEAVE_REQUESTED 를 읽음. 두 알림의 수신자는 그룹장, actor 는 신청·요청한 사람
create or replace function public.room_members_request_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from 'ACTIVE' and new.leave_requested_at is not null then
    new.leave_requested_at := null;
    new.leave_request_reason := null;
  end if;
  if old.status = 'PENDING' and new.status is distinct from 'PENDING' then
    update public.notifications set read_at = now()
     where kind = 'JOIN_REQUESTED' and room_id = new.room_id and actor_user_id = new.user_id and read_at is null;
  end if;
  if old.leave_requested_at is not null and new.leave_requested_at is null then
    update public.notifications set read_at = now()
     where kind = 'LEAVE_REQUESTED' and room_id = new.room_id and actor_user_id = new.user_id and read_at is null;
  end if;
  return new;
end $$;
create trigger trg_room_members_request_sync
  before update on public.room_members
  for each row execute function public.room_members_request_sync();

-- ───────── 6. 참가 상태·방 상세·멤버 관리 JSON ─────────
-- room_me_json (0004 + ACTIVE 멤버의 leaveRequest. 방이 ACTIVE·미보관이 아니면 null — 요청은 그때만 의미가 있다)
create or replace function public.room_me_json(p_room bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when p_uid is null then null
    when exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = p_uid) then jsonb_build_object('state', 'leader')
    else coalesce((
      select case m.status
               -- 요청이 없으면 키 자체가 없다(기존 me 모양 {state} 유지)
               when 'ACTIVE' then jsonb_build_object('state', 'active') ||
                 case when m.leave_requested_at is not null and r.status = 'ACTIVE' and r.archived_at is null
                      then jsonb_build_object('leaveRequest', jsonb_build_object('requestedAt', public.iso(m.leave_requested_at), 'reason', m.leave_request_reason))
                      else '{}'::jsonb end
               when 'PENDING' then jsonb_build_object('state', 'pending')
               when 'INACTIVE' then jsonb_build_object('state', 'inactive')
               else jsonb_build_object('state', 'none') end
      from public.room_members m join public.rooms r on r.id = m.room_id
      where m.room_id = p_room and m.user_id = p_uid), jsonb_build_object('state', 'none'))
  end
$$;

-- 그룹장 멤버 목록 한 줄 (0011 + leaveRequestedAt)
create or replace function public.member_admin_json(r public.rooms, m public.room_members) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.person_json(m.user_id)
         || jsonb_build_object('role', lower(m.role), 'status', lower(m.status), 'joinedAt', public.iso(m.joined_at),
                               'canEditCurriculum', public.member_can_edit_curriculum(r, m),
                               'leaveRequestedAt', case when r.status = 'ACTIVE' and r.archived_at is null and m.status = 'ACTIVE'
                                                        then public.iso(m.leave_requested_at) end)
$$;

-- RoomDetail (0011 + leaveRequestCount — 그룹장에게만 실제 수)
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
      where m.room_id = p_room and m.status = 'ACTIVE' and m.leave_requested_at is not null;
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

-- ───────── 7. D1 room_start (0016 + p_shift) ─────────
drop function public.room_start(text);
create function public.room_start(p_slug text, p_shift boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  v_warn  jsonb;
  v_days  int := 0;
  v_nodes int := 0;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.status <> 'RECRUIT' then perform public.fail('ROOM_STATUS_INVALID', '모집중인 방만 시작할 수 있어요'); end if;
  if v_today > r.end_date then perform public.fail('INVALID_PERIOD', '종료일이 이미 지났어요', '{"field":"endDate"}'::jsonb); end if;
  -- 0016: 앞당길 때만 시작일을 오늘로. 늦게 시작해도 예정 시작일은 그대로(회차가 방 기간 안에 남는다)
  if v_today < r.start_date then
    perform public.room_period_check(v_today, r.end_date);
    -- 0024 D1: 일정도 함께 당기기 — 방의 모든 노드(보관·개인 목표 포함)를 같은 날수만큼. 상대 일정(회차 간격·마감 순서)을 그대로 두려고
    --   보관 항목도 옮긴다(되살렸을 때 회차 밖으로 튀지 않게). 방 종료일은 바꾸지 않는다(기간만 늘어난다 — 1년 상한은 위에서 확인)
    if coalesce(p_shift, false) then
      v_days := r.start_date - v_today;
      update public.goal_nodes set start_date = start_date - v_days, end_date = end_date - v_days, updated_at = now()
      where room_id = r.id;
      get diagnostics v_nodes = row_count;
    end if;
    update public.rooms set start_date = v_today, updated_at = now() where id = r.id;
  end if;
  perform public.room_transition_active(r.id, v_uid);
  -- 당겼으면 방금 나간 ROOM_STARTED 본문에 알린다(room_transition_active 는 모델 없이 보낸다 — 시그니처를 건드리지 않으려고 여기서 덧쓴다)
  if v_days > 0 then
    update public.notifications set body = format('일정을 %s일 앞당겨 오늘 시작해요', v_days)
    where room_id = r.id and kind = 'ROOM_STARTED' and created_at = now() and body is null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('code', 'UNASSIGNED_TASK', 'nodeId', ls.node_id::text) order by ls.node_id), '[]'::jsonb)
  into v_warn
  from public.room_leaf_stats(r.id) ls where ls.task_type = 'DESIGNATED' and ls.asg = 0;
  if v_days > 0 then
    v_warn := v_warn || coalesce((
      select jsonb_agg(jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', n.id::text) order by n.id)
      from public.goal_nodes n
      where n.room_id = r.id and n.archived_at is null and (n.start_date < v_today or n.end_date > r.end_date)), '[]'::jsonb);
  end if;
  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn, 'shift', jsonb_build_object('days', v_days, 'nodes', v_nodes));
end $$;
grant execute on function public.room_start(text, boolean) to authenticated;

-- ───────── 8. node_create (0006 + created_by) ─────────
create or replace function public.node_create(
  p_slug text, p_parent_id bigint default null, p_title text default null, p_label text default null,
  p_task_type text default null, p_start_date date default null, p_end_date date default null, p_index int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r        public.rooms;
  p        public.goal_nodes;
  v_uid    uuid;
  v_id     bigint;
  v_depth  int;
  v_round  bigint;
  v_title  text := nullif(trim(coalesce(p_title, '')), '');
  v_label  text := nullif(trim(coalesce(p_label, '')), '');
  -- 회차: taskType 이 없으면 빈 부모, 있으면 회차 자체가 과제인 depth-2 리프(A7). 하위: 기본 common
  v_type   text := upper(coalesce(p_task_type, case when p_parent_id is null then null else 'common' end));
  v_s      date;
  v_e      date;
  v_n      int;
  v_idx    int;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  if v_type is not null and v_type not in ('COMMON', 'DESIGNATED') then
    perform public.fail('VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', '{"field":"taskType"}'::jsonb);
  end if;

  if p_parent_id is null then
    select count(*)::int, max(end_date) + 1 into v_n, v_s from public.goal_nodes where room_id = r.id and parent_id is null;
    v_depth := 2;
    v_title := coalesce(v_title, '새 회차');
    v_label := coalesce(v_label, (v_n + 1) || '주차');
    v_s     := coalesce(p_start_date, v_s, r.start_date);
    v_e     := coalesce(p_end_date, v_s + 6);
  else
    p := public.node_get(r.id, p_parent_id);
    if p.archived_at is not null then
      perform public.fail('PARENT_ARCHIVED', '보관된 항목 아래에는 추가할 수 없어요', jsonb_build_object('nodeId', p.id::text));
    end if;
    if p.depth >= 5 then
      perform public.fail('NODE_DEPTH_EXCEEDED', '최대 5단계까지만 만들 수 있어요', jsonb_build_object('nodeId', p.id::text));
    end if;
    if v_label is not null then
      perform public.fail('VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', '{"field":"label"}'::jsonb);
    end if;
    select count(*)::int into v_n from public.goal_nodes where parent_id = p.id;
    v_depth := p.depth + 1;
    v_round := p.round_id;
    v_title := coalesce(v_title, '새 과제');
    v_s := coalesce(p_start_date, p.start_date);
    v_e := coalesce(p_end_date, p.end_date);
  end if;

  if length(v_title) > 80 then perform public.fail('INVALID_TITLE', '제목은 1~80자예요', '{"field":"title"}'::jsonb); end if;
  if v_label is not null and length(v_label) > 20 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 20자까지예요', '{"field":"label"}'::jsonb); end if;
  if v_s > v_e then perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb); end if;

  -- 제출물 없는 리프 아래에 자식을 만들면 그 리프는 부모로 전환 (I1)
  if p.id is not null and p.task_type is not null then
    perform public.node_make_parent(p, '제출물이 있는 과제 아래에는 추가할 수 없어요. 보관해 주세요');
  end if;

  v_idx := least(greatest(coalesce(p_index, v_n), 0), v_n);
  update public.goal_nodes set sort_order = sort_order + 1
  where room_id = r.id and parent_id is not distinct from p_parent_id and sort_order >= v_idx;

  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, label, title, start_date, end_date, task_type, created_by)
  values (r.id, p_parent_id, v_round, v_depth, v_idx, v_label, v_title, v_s, v_e, v_type, v_uid)   -- 0024: 작성자(#13)
  returning id into v_id;
  if p_parent_id is null then update public.goal_nodes set round_id = v_id where id = v_id; end if;

  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- ───────── 9. D2 node_update (0023 + shiftDescendants · ROUND_SCHEDULE_CHANGED · 모집 중 지정 담당 알림) ─────────
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
                         'moved', (v_moved ->> 'tasks')::int + (v_moved ->> 'personal')::int));
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

-- ───────── 10. 노드 JSON 에 작성자 (#13) ─────────
-- curriculum_json (0014 + createdBy)
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

-- task_node_json (0014 + createdBy)
create or replace function public.task_node_json(p_node bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id::text, 'parentId', n.parent_id::text, 'roundId', n.round_id::text, 'depth', n.depth, 'sortOrder', n.sort_order,
    'label', n.label, 'title', n.title, 'descriptionMd', n.description_md,
    'startDate', to_char(n.start_date, 'YYYY-MM-DD'), 'endDate', to_char(n.end_date, 'YYYY-MM-DD'),
    'archived', n.archived_at is not null,
    'ownerId', n.owner_id::text,
    'createdBy', case when n.created_by is null then null else public.person_json(n.created_by) end,   -- 0024
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

-- ───────── 11. D4 참가 신청 한마디 (0005 room_apply·invite_join·room_applications) ─────────
drop function public.invite_join(text);
drop function public.room_apply(text, text);
create function public.room_apply(p_slug text, p_invite_token text default null, p_message text default null) returns jsonb
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
  insert into public.room_members (room_id, user_id, role, status, applied_at, apply_message)
  values (r.id, v_uid, 'MEMBER', 'PENDING', v_now, v_msg)
  on conflict (room_id, user_id) do update
    set status = 'PENDING', role = 'MEMBER', applied_at = excluded.applied_at, apply_message = excluded.apply_message,
        decided_at = null, decided_by = null, left_at = null, updated_at = now();
  perform public.assignment_resync(r.id);
  perform public.notify_publish('JOIN_REQUESTED', r.id, null, v_uid, array[r.leader_id],
    'JOIN_REQUESTED:' || r.id || ':' || v_uid || ':' || txid_current(),
    jsonb_build_object('applicant', public.person_json(v_uid), 'message', v_msg));
  return public.membership_result(r.id, v_uid);
end $$;

-- join_mode 에 따라 참가/신청. 한마디는 승인제일 때만 쓴다(바로 참가는 무시)
create function public.invite_join(p_token text, p_message text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;   -- require_user() 를 resolve 보다 먼저: 비로그인은 INVITE_* 대신 AUTH_REQUIRED
begin
  r := public.invite_resolve(p_token);
  if r.join_mode = 'DIRECT' then return public.room_join(r.slug, p_token); end if;
  return public.room_apply(r.slug, p_token, p_message);
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
      select jsonb_agg(public.person_json(m.user_id) || jsonb_build_object('appliedAt', public.iso(m.applied_at), 'message', m.apply_message)
                       order by m.applied_at, m.id)
      from public.room_members m where m.room_id = r.id and m.status = 'PENDING'), '[]'::jsonb));
end $$;

grant execute on function public.room_apply(text, text, text) to authenticated;
grant execute on function public.invite_join(text, text)      to authenticated;

-- ───────── 12. D3 탈퇴 요청 ─────────
-- 그룹장용 목록(내부 헬퍼, GRANT 없음): 방 ACTIVE·미보관일 때만. pendingTaskCount = 내보낼 때 재배정 결정이 필요한 과제 수
create or replace function public.leave_requests_json(r public.rooms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'items', coalesce((
      select jsonb_agg(public.person_json(m.user_id) || jsonb_build_object(
               'requestedAt', public.iso(m.leave_requested_at), 'reason', m.leave_request_reason,
               'pendingTaskCount', (select count(*)::int from public.deactivate_pending(r.id, m.user_id)))
             order by m.leave_requested_at, m.id)
      from public.room_members m
      where m.room_id = r.id and m.status = 'ACTIVE' and m.leave_requested_at is not null
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
  if m.leave_requested_at is not null then perform public.fail('LEAVE_ALREADY_REQUESTED', '이미 탈퇴를 요청했어요'); end if;
  update public.room_members set leave_requested_at = now(), leave_request_reason = v_reason, updated_at = now() where id = m.id;
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
  select * into m from public.room_members
  where room_id = r.id and user_id = v_uid and status = 'ACTIVE' and leave_requested_at is not null for update;
  if not found then perform public.fail('NOT_FOUND', '취소할 탈퇴 요청이 없어요'); end if;
  update public.room_members set leave_requested_at = null, leave_request_reason = null, updated_at = now() where id = m.id;   -- 트리거가 알림을 읽음으로
  return public.membership_result(r.id, v_uid);
end $$;

create or replace function public.room_leave_requests(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.require_leader(r, v_uid, '그룹장만 볼 수 있어요');
  return public.leave_requests_json(r);
end $$;

-- 반려: 멤버는 그대로(ACTIVE), 요청만 비우고 알린다. 내보내기는 member_deactivate(트리거가 요청을 비운다)
create or replace function public.member_leave_request_dismiss(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 처리할 수 있어요');
  select * into m from public.room_members
  where room_id = r.id and user_id = p_user and status = 'ACTIVE' and leave_requested_at is not null for update;
  if not found or r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('NOT_FOUND', '처리할 탈퇴 요청이 없어요');
  end if;
  update public.room_members set leave_requested_at = null, leave_request_reason = null, updated_at = now() where id = m.id;
  perform public.notify_publish('LEAVE_REQUEST_DISMISSED', r.id, null, v_uid, array[p_user],
    'LEAVE_REQUEST_DISMISSED:' || r.id || ':' || p_user || ':' || txid_current(), '{}'::jsonb);
  select * into r from public.rooms where id = r.id;
  return public.leave_requests_json(r);
end $$;

grant execute on function public.member_leave_request(text, text)         to authenticated;
grant execute on function public.member_leave_request_cancel(text)        to authenticated;
grant execute on function public.room_leave_requests(text)                to authenticated;
grant execute on function public.member_leave_request_dismiss(text, uuid) to authenticated;

-- ───────── 13. 보관 알림 (#5·#7) ─────────
-- room_archive (0004 + ACTIVE 멤버에게 ROOM_ARCHIVED). 그룹장은 행위자라 notify_publish 가 뺀다. 보관 해제는 알리지 않는다
create or replace function public.room_archive(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; v_rcpt uuid[];
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.status not in ('ACTIVE', 'ENDED') or r.archived_at is not null then
    perform public.fail('ROOM_STATUS_INVALID', '진행중이거나 종료된 방만 보관할 수 있어요');
  end if;
  update public.rooms set archived_at = now(), updated_at = now() where id = r.id;
  select coalesce(array_agg(m.user_id), '{}') into v_rcpt from public.room_members m where m.room_id = r.id and m.status = 'ACTIVE';
  perform public.notify_publish('ROOM_ARCHIVED', r.id, null, v_uid, v_rcpt, 'ROOM_ARCHIVED:' || r.id || ':' || txid_current(), '{}'::jsonb);
  return public.room_detail_json(r.id, v_uid);
end $$;

-- personal_archive (0014 + 그룹장이 남의 목표를 보관하면 소유자에게 PERSONAL_ARCHIVED)
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
    if v_n > 0 and n.owner_id <> v_uid then
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

-- ───────── 14. me_studies (0006 + p_include_archived, items[].archived) ─────────
drop function public.me_studies();
create function public.me_studies(p_include_archived boolean default false) returns jsonb
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
           case when r.status = 'ACTIVE' then 'active' when r.status in ('RECRUIT', 'DRAFT') then 'recruit' else 'ended' end as kind
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = v_uid
    where r.archived_at is null
      -- 그룹장 분기: 방장은 room_members 행의 status 와 무관하게 자기 방을 항상 본다(DRAFT 포함). 멤버는 ACTIVE, 대기자는 모집 중인 방만.
      and (r.leader_id = v_uid or m.status = 'ACTIVE' or (m.status = 'PENDING' and r.status in ('RECRUIT', 'DRAFT')))),
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
               when 'recruit' then jsonb_build_object('kind', 'start', 'date', to_char(m.start_date, 'YYYY-MM-DD'))
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
grant execute on function public.me_studies(boolean) to authenticated;

-- ───────── 15. D4 제출 하루 요약 (SUBMISSION_DIGEST) ─────────
-- 어제(KST) 처음 제출된 팀 과제 제출(그룹장 본인 것·보관 과제·개인 목표 제외) → 그룹장 1건. 0건이면 없음.
-- node = 어제 제출이 가장 많은 과제(동률은 마지막 제출이 늦은 쪽, 그다음 id) → 링크가 그 과제 제출 현황(#submissions)
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
        and (x.first_submitted_at at time zone 'Asia/Seoul')::date = v_today - 1
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
-- GRANT 하지 않는다(job_* 와 같음). 09:00 KST = completion_digest·deadline_reminder 와 같은 시각
select cron.schedule('submission_digest', '0 0 * * *', 'select public.job_submission_digest()');


-- ───────── 16. rooms_list (0004 + 탭 개수에 현재 조건 적용, #19) ─────────
-- 재정의 없음(0005~0023) → 0004 판을 복사. 바뀐 것은 tabCounts 한 문장뿐. 시그니처 동일 → GRANT 유지.
-- tagFacets 는 그대로(현재 scope 집합, 상태·검색·태그 미적용) — 태그를 고르면 다른 태그 칩이 사라지지 않게.
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
