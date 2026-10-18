-- 0025_shift_end_digest_setting.sql — 0024 후속 결정(오케스트레이터 2026-10-19). 배포 후 수정 금지. 추가형(컬럼 1 + 함수 교체).
-- 0024 가 로컬에 이미 적용돼 있어(reset 금지) 고친 내용을 0025 로 분리했다. 호스팅에는 0024 → 0025 순서로 함께 적용한다.
--  1. room_start(p_shift=true): 방 종료일도 같은 날수만큼 당긴다(전체 기간 유지). p_shift=false 는 0024 와 같다(종료일 그대로, 기간이 늘어난다)
--     → 당기기면 기간이 늘지 않으므로 1년 상한은 당긴 기간(오늘 ~ 종료일 − n)으로 검사한다
--  2. SUBMISSION_DIGEST 를 방 알림 설정으로 끌 수 있게: room_notification_settings.submission_digest(기본 켬),
--     settings_get/put 의 submissionDigest. settings_put 에서 이 키는 선택(없으면 기존 값 유지 — 옛 6키 호출 호환)
-- 재정의: room_start ← 0024 · notify_enabled ← 0024 · settings_json·settings_put ← 0008. 시그니처 동일 → GRANT 유지.

alter table public.room_notification_settings add column submission_digest boolean not null default true;

-- ───────── 1. room_start (0024 + 당기기면 종료일도) ─────────
create or replace function public.room_start(p_slug text, p_shift boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  v_warn  jsonb;
  v_days  int := 0;
  v_nodes int := 0;
  v_end   date;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.status <> 'RECRUIT' then perform public.fail('ROOM_STATUS_INVALID', '모집중인 방만 시작할 수 있어요'); end if;
  if v_today > r.end_date then perform public.fail('INVALID_PERIOD', '종료일이 이미 지났어요', '{"field":"endDate"}'::jsonb); end if;
  v_end := r.end_date;
  -- 0016: 앞당길 때만 시작일을 오늘로. 늦게 시작해도 예정 시작일은 그대로(회차가 방 기간 안에 남는다)
  if v_today < r.start_date then
    if coalesce(p_shift, false) then
      -- 0024 D1 + 0025: 방의 모든 노드(보관·개인 목표 포함)와 방 종료일을 같은 날수만큼 — 전체 기간·상대 일정 유지
      v_days := r.start_date - v_today;
      v_end := r.end_date - v_days;
      perform public.room_period_check(v_today, v_end);
      update public.goal_nodes set start_date = start_date - v_days, end_date = end_date - v_days, updated_at = now()
      where room_id = r.id;
      get diagnostics v_nodes = row_count;
    else
      perform public.room_period_check(v_today, r.end_date);
    end if;
    update public.rooms set start_date = v_today, end_date = v_end, updated_at = now() where id = r.id;
  end if;
  perform public.room_transition_active(r.id, v_uid);
  -- 당겼으면 방금 나간 ROOM_STARTED 본문에 알린다(room_transition_active 는 모델 없이 보낸다)
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
      where n.room_id = r.id and n.archived_at is null and (n.start_date < v_today or n.end_date > v_end)), '[]'::jsonb);
  end if;
  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn, 'shift', jsonb_build_object('days', v_days, 'nodes', v_nodes));
end $$;

-- ───────── 2. 제출 요약 설정 ─────────
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
      when 'SUBMISSION_DIGEST' then s.submission_digest       -- 0025
      when 'ROOM_STARTED'      then s.room_start_end
      when 'ROOM_ENDED'        then s.room_start_end
      else true end
    from public.room_notification_settings s where s.room_id = p_room), true)
$$;

create or replace function public.settings_json(p_room bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reminderD1', coalesce(s.reminder_d1, true), 'reminderD3', coalesce(s.reminder_d3, true),
    'taskAssigned', coalesce(s.task_assigned, true), 'scheduleChanged', coalesce(s.schedule_changed, true),
    'roomStartEnd', coalesce(s.room_start_end, true),
    'completionMode', case when coalesce(s.completion_mode, 'DAILY_DIGEST') = 'IMMEDIATE' then 'immediate' else 'daily' end,
    'submissionDigest', coalesce(s.submission_digest, true))
  from (select 1) x left join public.room_notification_settings s on s.room_id = p_room
$$;

-- 전체 교체. 기존 6키 필수(불리언은 jsonb boolean, completionMode ∈ daily|immediate). 0025 submissionDigest 는 선택 — 없으면 기존 값(행이 없으면 기본 켬)
create or replace function public.settings_put(p_slug text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r      public.rooms;
  v_k    text;
  v_mode text := p_settings ->> 'completionMode';
  v_dig  boolean;
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
  if p_settings ? 'submissionDigest' and jsonb_typeof(p_settings -> 'submissionDigest') <> 'boolean' then
    perform public.fail('VALIDATION_FAILED', '알림 설정 값이 올바르지 않아요', '{"field":"submissionDigest"}'::jsonb);
  end if;
  v_dig := case when p_settings ? 'submissionDigest' then (p_settings ->> 'submissionDigest')::boolean
                else coalesce((select s.submission_digest from public.room_notification_settings s where s.room_id = r.id), true) end;
  insert into public.room_notification_settings (room_id, reminder_d1, reminder_d3, task_assigned, schedule_changed, room_start_end, completion_mode, submission_digest)
  values (r.id, (p_settings ->> 'reminderD1')::boolean, (p_settings ->> 'reminderD3')::boolean, (p_settings ->> 'taskAssigned')::boolean,
          (p_settings ->> 'scheduleChanged')::boolean, (p_settings ->> 'roomStartEnd')::boolean,
          case v_mode when 'immediate' then 'IMMEDIATE' else 'DAILY_DIGEST' end, v_dig)
  on conflict (room_id) do update
    set reminder_d1 = excluded.reminder_d1, reminder_d3 = excluded.reminder_d3, task_assigned = excluded.task_assigned,
        schedule_changed = excluded.schedule_changed, room_start_end = excluded.room_start_end, completion_mode = excluded.completion_mode,
        submission_digest = excluded.submission_digest;
  return public.settings_json(r.id);
end $$;
