-- 0008_notifications.sql — 알림 · 설정 · 이탈 처리 · cron 잡 (플랜 04 Task 5~7)
-- 배포 후 수정 금지. Task 6·7 이 이 파일 끝에 이어 붙인다.
-- notify_publish 는 0004 의 자리표와 **같은 시그니처**로 CREATE OR REPLACE 한다(의존 함수가 있어 DROP 불가).

-- ───────── 알림 종류 (03-api §7 NotificationKind) ─────────
create or replace function public.notification_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['ROUND_STARTED', 'TASK_ALL_SUBMITTED', 'TASK_COMPLETION_DIGEST', 'JOIN_REQUESTED', 'JOIN_APPROVED', 'JOIN_REJECTED',
               'JOIN_EXPIRED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'SCHEDULE_CHANGED', 'ROOM_STARTED',
               'ROOM_ENDED', 'ROOM_START_BLOCKED', 'MEMBER_DEACTIVATED']
$$;

-- 옵션 kind 는 방 설정(cross-cutting §2.3.4)으로 거른다. 설정 행이 없으면 기본 ON. 기본·잠금 kind 는 항상 true
create or replace function public.notify_enabled(p_kind text, p_room bigint, p_model jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'DEADLINE_REMINDER' then case coalesce(p_model ->> 'days', '1') when '3' then s.reminder_d3 else s.reminder_d1 end
      when 'TASK_ASSIGNED'     then s.task_assigned
      when 'TASK_UNASSIGNED'   then s.task_assigned
      when 'SCHEDULE_CHANGED'  then s.schedule_changed
      when 'ROOM_STARTED'      then s.room_start_end
      when 'ROOM_ENDED'        then s.room_start_end
      else true end
    from public.room_notification_settings s where s.room_id = p_room), true)
$$;

-- 한국어 제목·본문 (생성 시점 스냅샷, cross-cutting §2.3.3). 과제 이벤트는 body 에 방 제목
create or replace function public.notify_render(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_model jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_room  text;
  v_node  text;
  v_label text;
  v_actor text;
  v_title text;
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
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', case when p_node is null then null else left(v_room, 500) end);
end $$;

-- 링크(D8): 과제 이벤트 → /my-study/{slug}?task={nodeId}, 방 이벤트 → 참가자(ACTIVE·그룹장)면 /my-study/{slug}, 아니면 /rooms/{slug}
create or replace function public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_node is not null and p_kind in ('TASK_ALL_SUBMITTED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED')
      then '/my-study/' || r.slug || '?task=' || p_node
    when r.leader_id = p_user
      or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_user and m.status = 'ACTIVE')
      then '/my-study/' || r.slug
    else '/rooms/' || r.slug end
  from public.rooms r where r.id = p_room
$$;

-- ───────── notify_publish (D8) — 0004 자리표 교체 ─────────
-- 설정 필터 → 템플릿 렌더 → 수신자별 INSERT (ON CONFLICT DO NOTHING). 반환: 실제 생성 건수
-- D8: ① p_actor 는 여기서 뺀다(호출자 책임 아님) ② prefix 는 호출부 소유 — 행위성 kind(JOIN_*·SCHEDULE_CHANGED·TASK_(UN)ASSIGNED)는
--     호출부가 이미 ':' || txid_current() 를 붙여 넘긴다(0005/0006). 여기서는 손대지 않는다(ruling C1/E1)
-- ③ dedupe_key = prefix || ':' || recipient, 160자 초과면 'h:' || md5(prefix) || ':' || recipient
create or replace function public.notify_publish(
  p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_recipients uuid[], p_dedupe_prefix text, p_model jsonb)
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
            public.notify_link(p_kind, p_room, p_node, v_r), v_key)
    on conflict (dedupe_key) do nothing;
    get diagnostics v_c = row_count;
    v_n := v_n + v_c;
  end loop;
  return v_n;
end $$;

-- ───────── 알림 읽기 (03-api §7, cross-cutting §2.3.1) ─────────
create or replace function public.notification_json(p_n public.notifications) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_n.id::text, 'kind', p_n.kind, 'title', p_n.title, 'body', p_n.body,
    'room', (select jsonb_build_object('slug', r.slug, 'title', r.title) from public.rooms r where r.id = p_n.room_id),
    'link', p_n.link,
    'actor', case when p_n.actor_user_id is null then null else public.person_json(p_n.actor_user_id) end,
    'createdAt', public.iso(p_n.created_at), 'readAt', public.iso(p_n.read_at))
$$;

-- 최신순, 커서 = 마지막 id(문자열). limit 1~50
create or replace function public.notifications_list(p_cursor text default null, p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.current_user_id();
  v_lim  int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_cur  bigint := nullif(p_cursor, '')::bigint;
  v_rows jsonb;
  v_cnt  int;
  v_next text := null;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  select coalesce(jsonb_agg(public.notification_json(n) order by n.id desc), '[]'::jsonb), count(*)
  into v_rows, v_cnt
  from (select * from public.notifications
        where user_id = v_uid and (v_cur is null or id < v_cur)
        order by id desc limit v_lim + 1) n;
  if v_cnt > v_lim then
    v_next := v_rows -> (v_lim - 1) ->> 'id';
    select jsonb_agg(e order by i) into v_rows from jsonb_array_elements(v_rows) with ordinality as t(e, i) where i <= v_lim;
  end if;
  return jsonb_build_object('items', v_rows, 'nextCursor', v_next);
end $$;

create or replace function public.notifications_unread_count() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id();
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  return jsonb_build_object('count', (select count(*) from public.notifications where user_id = v_uid and read_at is null));
end $$;

create or replace function public.notifications_read(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id();
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  update public.notifications set read_at = coalesce(read_at, now()) where id = p_id and user_id = v_uid;
  if not found then perform public.fail('NOT_FOUND', '알림을 찾을 수 없어요'); end if;
end $$;

create or replace function public.notifications_read_all() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); v_n int;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  update public.notifications set read_at = now() where user_id = v_uid and read_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end $$;

-- ───────── 그룹장 전용 헬퍼 ─────────
-- p_lock=true 면 room_lock(FOR UPDATE), 아니면 단순 조회. 없으면 ROOM_NOT_FOUND, 그룹장 판정은 require_leader
-- (못 읽는 외부인 ROOM_NOT_FOUND, 그 외 NOT_LEADER — plan 02 I-2)
create or replace function public.leader_room(p_slug text, p_lock boolean default false) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  if p_lock then
    r := public.room_lock(p_slug);
  else
    select * into r from public.rooms where slug = p_slug;
    if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  end if;
  perform public.require_leader(r, v_uid);
  return r;
end $$;

-- ───────── 방 알림 설정 (03-api §7 NotificationSettings) ─────────
create or replace function public.settings_json(p_room bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reminderD1', coalesce(s.reminder_d1, true), 'reminderD3', coalesce(s.reminder_d3, true),
    'taskAssigned', coalesce(s.task_assigned, true), 'scheduleChanged', coalesce(s.schedule_changed, true),
    'roomStartEnd', coalesce(s.room_start_end, true),
    'completionMode', case when coalesce(s.completion_mode, 'DAILY_DIGEST') = 'IMMEDIATE' then 'immediate' else 'daily' end)
  from (select 1) x left join public.room_notification_settings s on s.room_id = p_room
$$;

create or replace function public.settings_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public.leader_room(p_slug);
  return public.settings_json(r.id);
end $$;

-- 전체 교체. 키 6개 전부 필수, 불리언은 jsonb boolean, completionMode ∈ daily|immediate
create or replace function public.settings_put(p_slug text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms;
  v_k   text;
  v_mode text := p_settings ->> 'completionMode';
begin
  r := public.leader_room(p_slug, true);
  foreach v_k in array array['reminderD1', 'reminderD3', 'taskAssigned', 'scheduleChanged', 'roomStartEnd'] loop
    if jsonb_typeof(p_settings -> v_k) is distinct from 'boolean' then
      perform public.fail('VALIDATION_FAILED', '알림 설정 값이 올바르지 않아요', jsonb_build_object('field', v_k));
    end if;
  end loop;
  if v_mode is null or v_mode not in ('daily', 'immediate') then
    perform public.fail('VALIDATION_FAILED', '완료 알림 방식은 daily 또는 immediate 예요', '{"field":"completionMode"}'::jsonb);
  end if;
  insert into public.room_notification_settings (room_id, reminder_d1, reminder_d3, task_assigned, schedule_changed, room_start_end, completion_mode)
  values (r.id, (p_settings ->> 'reminderD1')::boolean, (p_settings ->> 'reminderD3')::boolean, (p_settings ->> 'taskAssigned')::boolean,
          (p_settings ->> 'scheduleChanged')::boolean, (p_settings ->> 'roomStartEnd')::boolean,
          case v_mode when 'immediate' then 'IMMEDIATE' else 'DAILY_DIGEST' end)
  on conflict (room_id) do update
    set reminder_d1 = excluded.reminder_d1, reminder_d3 = excluded.reminder_d3, task_assigned = excluded.task_assigned,
        schedule_changed = excluded.schedule_changed, room_start_end = excluded.room_start_end, completion_mode = excluded.completion_mode;
  return public.settings_json(r.id);
end $$;

-- ───────── 공개 RPC (D7 GRANT 전용 — revoke 문은 쓰지 않는다) ─────────
-- notify_*, notification_kinds, notification_json, leader_room, settings_json 은 GRANT 하지 않는다(0002 default privileges 로 비공개).
-- pg_cron 은 postgres(소유자)로 돌므로 job·notify 함수에 별도 GRANT 가 필요 없다.
grant execute on function public.notifications_list(text, int)  to authenticated;
grant execute on function public.notifications_unread_count()   to authenticated;
grant execute on function public.notifications_read(bigint)     to authenticated;
grant execute on function public.notifications_read_all()       to authenticated;
grant execute on function public.settings_get(text)             to authenticated;
grant execute on function public.settings_put(text, jsonb)      to authenticated;

-- ───────── 이탈 처리 (D11, 03-api §3, mystudy §2.3.3) ─────────
-- 대상의 미제출 지정 과제(보관 제외) + 그 과제의 나머지 유효 담당자. 미리보기와 본처리가 같은 목록을 본다
create or replace function public.deactivate_pending(p_room bigint, p_user uuid)
returns table (node_id bigint, title text, round_label text, others uuid[])
language sql stable security definer set search_path = '' as $$
  select n.id, n.title::text, rd.label::text,
         coalesce((select array_agg(b.user_id order by b.assigned_at, b.id) from public.task_assignments b
                   where b.node_id = n.id and b.released_at is null and b.user_id <> p_user), '{}'::uuid[])
  from public.task_assignments a
  join public.goal_nodes n on n.id = a.node_id
  left join public.goal_nodes rd on rd.id = n.round_id
  where n.room_id = p_room and n.task_type = 'DESIGNATED' and n.archived_at is null
    and a.user_id = p_user and a.released_at is null
    and not exists (select 1 from public.submissions s where s.node_id = n.id and s.user_id = p_user)
  order by rd.sort_order, n.sort_order, n.id      -- B10: 회차 → 형제 순
$$;

-- 공통 검사: 그룹장 · 방 ACTIVE·미보관 · 대상 ≠ 그룹장 · 대상 ACTIVE. p_lock 이면 방·멤버 행을 잠근다
create or replace function public.deactivate_check(p_slug text, p_user uuid, p_lock boolean) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; v_status text;
begin
  r := public.leader_room(p_slug, p_lock);
  if r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('ROOM_NOT_ACTIVE', '진행중인 스터디에서만 이탈 처리할 수 있어요');
  end if;
  if p_user = r.leader_id then perform public.fail('CANNOT_DEACTIVATE_LEADER', '그룹장은 이탈 처리할 수 없어요'); end if;
  if p_lock then
    select status into v_status from public.room_members where room_id = r.id and user_id = p_user for update;
  else
    select status into v_status from public.room_members where room_id = r.id and user_id = p_user;
  end if;
  if not found or v_status <> 'ACTIVE' then perform public.fail('MEMBER_NOT_ACTIVE', '활성 참가자가 아니에요'); end if;
  return r;
end $$;

create or replace function public.member_deactivate_preview(p_slug text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public.deactivate_check(p_slug, p_user, false);
  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nodeId', p.node_id::text, 'title', p.title, 'roundLabel', p.round_label,
               'currentAssignees', (select coalesce(jsonb_agg(public.person_json(u)), '[]'::jsonb) from unnest(p.others) u))
             order by p.ord)
      from (select dp.*, row_number() over () as ord from public.deactivate_pending(r.id, p_user) dp) p), '[]'::jsonb));
end $$;

-- 1) 결정을 전부 검증(아무것도 바꾸지 않음) → 2) 대상 배정 전부 released, INACTIVE, 정원 -1 → 3) 재지정 INSERT + TASK_ASSIGNED
--    → 4) assignment_resync → 5) MEMBER_DEACTIVATED. 제출된 지정 과제의 행도 released 되고 제출물은 남는다(집계 제외, D4-3)
create or replace function public.member_deactivate(p_slug text, p_user uuid, p_decisions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  r        public.rooms;
  p        record;
  d        jsonb;
  v_action text;
  v_new    uuid[];
  v_adds   uuid[];
  v_id     uuid;
  v_bad    boolean;
  v_plan   jsonb := '[]'::jsonb;    -- [{nodeId, adds: uuid[]}]
  v_item   jsonb;
begin
  r := public.deactivate_check(p_slug, p_user, true);
  if jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' then
    perform public.fail('VALIDATION_FAILED', 'decisions 는 배열이어야 해요', '{"field":"decisions"}'::jsonb);
  end if;

  -- 1. 검증
  for p in select * from public.deactivate_pending(r.id, p_user) loop
    d := null;
    select e into d from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) e where e ->> 'nodeId' = p.node_id::text limit 1;
    if d is null then
      perform public.fail('LEAVE_DECISION_MISSING', '미제출 지정 과제마다 처리 방법을 정해 주세요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    v_action := d ->> 'action';
    if v_action is null then          -- null 이면 `not in` 이 null 이 되어 통과해 버린다 → 결정 없음으로 본다
      perform public.fail('LEAVE_DECISION_MISSING', '미제출 지정 과제마다 처리 방법을 정해 주세요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    if v_action not in ('exclude', 'reassign') then
      perform public.fail('VALIDATION_FAILED', 'action 은 exclude 또는 reassign 이에요', jsonb_build_object('field', 'action', 'nodeId', p.node_id::text));
    end if;
    v_new := '{}'::uuid[];
    if v_action = 'reassign' then
      -- B9: assigneeIds 는 문자열 uuid 배열이어야 한다. 비문자열·잘못된 uuid 가 raw 22P02 로 새지 않게 한다
      v_bad := jsonb_typeof(coalesce(d -> 'assigneeIds', '[]'::jsonb)) <> 'array';
      if not v_bad then
        v_bad := exists (select 1 from jsonb_array_elements(coalesce(d -> 'assigneeIds', '[]'::jsonb)) x where jsonb_typeof(x) <> 'string');
      end if;
      if not v_bad then
        begin
          select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_new
          from jsonb_array_elements_text(coalesce(d -> 'assigneeIds', '[]'::jsonb)) x;
        exception when invalid_text_representation then
          v_bad := true;
        end;
      end if;
      if v_bad then
        perform public.fail('VALIDATION_FAILED', 'assigneeIds 는 uuid 문자열 배열이어야 해요', jsonb_build_object('field', 'assigneeIds', 'nodeId', p.node_id::text));
      end if;
      foreach v_id in array v_new loop
        if v_id = p_user or not exists (
             select 1 from public.room_members m
             where m.room_id = r.id and m.user_id = v_id and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks)) then
          perform public.fail('ASSIGNEE_NOT_MEMBER', '활성 참가자에게만 재지정할 수 있어요', jsonb_build_object('nodeId', p.node_id::text, 'userId', v_id::text));
        end if;
      end loop;
    end if;
    v_adds := array(select unnest(v_new) except select unnest(p.others));
    if cardinality(p.others) + cardinality(v_adds) = 0 then
      perform public.fail('REASSIGN_REQUIRED', '담당자가 0명이 되는 과제는 다른 참가자에게 재지정해야 해요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    v_plan := v_plan || jsonb_build_object('nodeId', p.node_id::text, 'adds', to_jsonb(v_adds));
  end loop;

  -- 2. 대상 해제 + 상태 전환 + 정원
  update public.task_assignments a set released_at = now()
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = r.id and a.user_id = p_user and a.released_at is null;
  update public.room_members
     set status = 'INACTIVE', left_at = now(), decided_at = now(), decided_by = v_uid, updated_at = now()
   where room_id = r.id and user_id = p_user;
  perform public.room_release_seat(r.id);

  -- 3. 재지정
  for v_item in select e from jsonb_array_elements(v_plan) e loop
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_adds from jsonb_array_elements_text(v_item -> 'adds') x;
    if cardinality(v_adds) > 0 then
      insert into public.task_assignments (node_id, user_id, source)
      select (v_item ->> 'nodeId')::bigint, u, 'DESIGNATED' from unnest(v_adds) u
      on conflict (node_id, user_id) do update set released_at = null, source = 'DESIGNATED', assigned_at = now();
      -- A6: 호출부가 txid 를 붙인다(E1) — 없으면 키가 영구라 같은 사람의 이후 재지정이 dedupe 로 사라진다
      perform public.notify_publish('TASK_ASSIGNED', r.id, (v_item ->> 'nodeId')::bigint, v_uid, v_adds,
                                    'TASK_ASSIGNED:' || r.id || ':' || (v_item ->> 'nodeId') || ':' || txid_current(), '{}'::jsonb);
    end if;
  end loop;

  -- 4·5
  perform public.assignment_resync(r.id);
  perform public.notify_publish('MEMBER_DEACTIVATED', r.id, null, v_uid, array[p_user],
                                'MEMBER_DEACTIVATED:' || r.id || ':' || p_user, '{}'::jsonb);
  return public.membership_result(r.id, v_uid);
end $$;

-- 공개 RPC 만 GRANT(D7). deactivate_pending·deactivate_check 는 내부 헬퍼라 GRANT 하지 않는다
grant execute on function public.member_deactivate_preview(text, uuid)     to authenticated;
grant execute on function public.member_deactivate(text, uuid, jsonb)      to authenticated;
