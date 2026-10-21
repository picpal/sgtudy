-- 0042_me_tasks_order.sql — 2026-10-21 내 과제(/tasks) 순서를 진행목표 트리 순서와 맞춘다. 배포 후 수정 금지.
-- 재정의 원본: me_tasks ← 0014 (이후 재정의 없음). 시그니처 동일(returns jsonb) → GRANT 유지(아래 재부여는 멱등).
-- 바뀐 것: items 에 'ord' 추가 = 회차 바로 아래부터 그 노드까지 조상 경로 [[sort_order, id], ...] (depth 순).
--   화면은 형제를 sort_order → id 로 비교해 깊이 우선 순서를 만든다 (진행목표 model.buildTree 와 같은 기준).
create or replace function public.me_tasks() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); v_today date := public.kst_today(); v_out jsonb;
begin
  with rm as materialized (
    select r.id, r.slug, r.title, r.status, r.leader_id = v_uid as is_leader
    from public.rooms r
    where r.archived_at is null
      and (r.leader_id = v_uid or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status = 'ACTIVE'))
      and (r.status <> 'DRAFT' or r.leader_id = v_uid)),
  rounds as (
    select n.id, n.room_id, n.label, n.title, n.start_date, n.end_date, n.sort_order, n.task_type
    from public.goal_nodes n join rm on rm.id = n.room_id
    where n.parent_id is null and n.archived_at is null),
  cur as (
    select rm.id as room_id, coalesce(public.room_current_round_id(rm.id, v_today),
             (select x.id from rounds x where x.room_id = rm.id order by x.start_date, x.sort_order, x.id limit 1)) as round_id
    from rm),
  items as (
    select n.id, n.room_id, n.round_id, n.parent_id, n.depth, n.title, n.task_type, n.start_date, n.end_date, s.first_submitted_at, s.is_late
    from public.goal_nodes n
    join rm on rm.id = n.room_id
    join public.task_assignments a on a.node_id = n.id and a.user_id = v_uid and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null
    union all
    select n.id, n.room_id, n.round_id, n.parent_id, n.depth, n.title, n.task_type, n.start_date, n.end_date, s.first_submitted_at, s.is_late
    from public.goal_nodes n
    join rm on rm.id = n.room_id
    left join public.submissions s on s.node_id = n.id and s.user_id = v_uid
    where n.task_type = 'PERSONAL' and n.owner_id = v_uid and n.archived_at is null)
  select jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'personalPerRound', public.personal_limit(),
    'studies', (select coalesce(jsonb_agg(jsonb_build_object(
                  'slug', r.slug, 'title', r.title,
                  'tone', (array['mint', 'blue', 'peach', 'lav', 'amber', 'slate'])[1 + (r.id % 6)],
                  'status', lower(r.status),
                  'membership', case when r.is_leader then 'leader' else 'joined' end,
                  'currentRoundId', c.round_id::text,
                  'canAddPersonal', r.status in ('RECRUIT', 'ACTIVE'))
                  order by r.id), '[]'::jsonb)
                from rm r left join cur c on c.room_id = r.id),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', x.id::text, 'slug', r.slug, 'label', x.label, 'title', x.title,
                 'startDate', to_char(x.start_date, 'YYYY-MM-DD'), 'endDate', to_char(x.end_date, 'YYYY-MM-DD'),
                 'canAdd', x.task_type is null and r.status in ('RECRUIT', 'ACTIVE'))
                 order by r.id, x.sort_order, x.id), '[]'::jsonb)
               from rounds x join rm r on r.id = x.room_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', i.id::text, 'slug', r.slug, 'roundId', i.round_id::text,
                'groupTitle', case when i.depth > 3 then (select g.title from public.goal_nodes g where g.id = i.parent_id) end,
                'title', i.title, 'type', lower(i.task_type),
                'startDate', to_char(i.start_date, 'YYYY-MM-DD'), 'endDate', to_char(i.end_date, 'YYYY-MM-DD'),
                'st', public.task_code(i.start_date, i.end_date, i.first_submitted_at, i.is_late, v_today),
                'submittedAt', public.iso(i.first_submitted_at),
                'ord', (with recursive up as (
                          select g.id, g.parent_id, g.depth, g.sort_order from public.goal_nodes g where g.id = i.id
                          union all
                          select p.id, p.parent_id, p.depth, p.sort_order
                          from public.goal_nodes p join up on p.id = up.parent_id
                          where p.depth > 2)
                        select jsonb_agg(jsonb_build_array(u.sort_order, u.id) order by u.depth) from up u))
                order by i.end_date, i.start_date, i.id), '[]'::jsonb)
              from items i join rm r on r.id = i.room_id))
  into v_out;
  return v_out;
end $$;

grant execute on function public.me_tasks() to authenticated;
