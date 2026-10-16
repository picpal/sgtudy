-- 0016_room_start_date.sql — "지금 시작" 시작일 규칙. 배포 후 수정 금지.
-- 버그: 예정 시작일(10-15)이 지난 뒤(10-16) "지금 시작"을 누르면 0004 room_start 가 start_date 를 오늘로 옮겨
--       1회차(10-15–10-21)가 방 기간 밖이 되고, 모든 회차·과제 수정이 PERIOD_OUTSIDE_ROOM 경고를 낸다.
-- 1. room_start: 앞당겨 시작할 때(오늘 < 예정 시작일)만 start_date = 오늘. 예정일 당일·이후 시작은 예정 시작일 유지.
--    앞당기면 기간이 늘어난다 → 0013 기간 상한(시작일 + 1년 - 1일)을 넘으면 PERIOD_TOO_LONG 으로 막는다(방은 RECRUIT 그대로,
--    detail.maxEndDate 만큼 종료일을 줄이면 시작 가능). ACTIVE 에선 startDate 가 잠기고 종료일 수정마다 상한을 보므로
--    1년 초과 ACTIVE 방을 만들지 않는 편이 안전하다.
--    ROUND_STARTED(0013 room_transition_active)는 오늘 기준이라 영향 없음 — 늦은 시작이면 진행 중 회차를 즉시, 이른 시작이면 잡이 회차 시작일에 보낸다.
-- 2. room_start_date_repair(): 옛 room_start 로 시작일이 뒤로 밀린 ACTIVE 방을 첫 회차 시작일로 되돌린다(1회 실행, 멱등).
-- room_start 는 0004 정의(이후 재정의 없음)를 복사해 고친 것이다. 시그니처 동일 → GRANT 유지.

-- ───────── 1. room_start (0004) ─────────
create or replace function public.room_start(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  r       public.rooms;
  v_warn  jsonb;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.status <> 'RECRUIT' then perform public.fail('ROOM_STATUS_INVALID', '모집중인 방만 시작할 수 있어요'); end if;
  if v_today > r.end_date then perform public.fail('INVALID_PERIOD', '종료일이 이미 지났어요', '{"field":"endDate"}'::jsonb); end if;
  -- 0016: 앞당길 때만 시작일을 오늘로. 늦게 시작해도 예정 시작일은 그대로(회차가 방 기간 안에 남는다)
  if v_today < r.start_date then
    perform public.room_period_check(v_today, r.end_date);
    update public.rooms set start_date = v_today, updated_at = now() where id = r.id;
  end if;
  perform public.room_transition_active(r.id, v_uid);
  select coalesce(jsonb_agg(jsonb_build_object('code', 'UNASSIGNED_TASK', 'nodeId', ls.node_id::text) order by ls.node_id), '[]'::jsonb)
  into v_warn
  from public.room_leaf_stats(r.id) ls where ls.task_type = 'DESIGNATED' and ls.asg = 0;
  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn);
end $$;

-- ───────── 2. 기존 방 복구 ─────────
-- 대상(전부 만족할 때만, 보수적):
--   a. ACTIVE, started_at 있음
--   b. 첫 회차(depth 2, 보관 제외) 시작일 < 방 start_date
--   c. 그 첫 회차가 방 시작 이전(created_at <= started_at)에 만들어졌다 — 시작 뒤에 일부러 앞에 둔 회차는 제외
--   d. tick 이 시작한 흔적(actor 없는 ROOM_STARTED 알림)이 없다 — tick 은 start_date 를 바꾸지 않으므로 제외.
--      옛 room_start 는 actor = 그룹장으로 ROOM_STARTED 를 남긴다(그룹장 혼자인 방·알림 끈 방은 흔적이 없어 이 조건만 통과)
--   e. 되돌린 기간이 1년 상한(첫 회차 시작일 + 1년 - 1일) 안
-- start_date 만 첫 회차 시작일로 바꾼다(updated_at 은 건드리지 않는다). 되돌린 뒤엔 b 가 거짓 → 다시 돌려도 0건.
-- 결과: [{roomId, from, to}]. GRANT 없음 — 0002 default privileges 로 비공개(내부 전용)
create or replace function public.room_start_date_repair() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_out jsonb;
begin
  with c as (
    select r.id, r.start_date as old_start, fr.first_start
    from public.rooms r
    cross join lateral (
      select min(n.start_date) as first_start from public.goal_nodes n
      where n.room_id = r.id and n.depth = 2 and n.archived_at is null) fr
    where r.status = 'ACTIVE' and r.started_at is not null
      and fr.first_start is not null and fr.first_start < r.start_date
      and exists (select 1 from public.goal_nodes n
                  where n.room_id = r.id and n.depth = 2 and n.archived_at is null
                    and n.start_date = fr.first_start and n.created_at <= r.started_at)
      and not exists (select 1 from public.notifications x
                      where x.room_id = r.id and x.kind = 'ROOM_STARTED' and x.actor_user_id is null)
      and r.end_date <= (fr.first_start + interval '1 year')::date - 1
    for update of r
  ), u as (
    update public.rooms r set start_date = c.first_start
    from c where r.id = c.id
    returning r.id, c.old_start, c.first_start)
  select coalesce(jsonb_agg(jsonb_build_object('roomId', u.id::text, 'from', to_char(u.old_start, 'YYYY-MM-DD'),
                                               'to', to_char(u.first_start, 'YYYY-MM-DD')) order by u.id), '[]'::jsonb)
  into v_out from u;
  return v_out;
end $$;

-- 1회 실행
select public.room_start_date_repair();
