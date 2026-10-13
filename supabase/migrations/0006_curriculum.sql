-- 0006_curriculum.sql — 커리큘럼 트리 · 진척률 · 내 스터디/일정 (플랜 03 Task 1~8)
-- 배포 후 수정 금지. Task 3~8 이 이 파일 끝에 함수를 이어 붙인다.
-- 권한(D7): 함수는 0002 의 default privileges 로 기본 비공개. 공개 RPC 만 각 Task 끝에서 GRANT 한다.

-- ───────── goal_nodes 형태 보강 트리거 (02 §6, I3·I4, 리뷰 A1) ─────────
-- node_* 함수가 지키는 형태를 직접 INSERT/UPDATE 경로(시드·테스트·service_role)에서도 강제한다.
--   루트(parent null): depth 2, round_id = 자기 id(비우면 채움), label 필수(공백 불가)
--   하위: label 없음. INSERT 이거나 parent_id 가 바뀐 행은 같은 방·depth = 부모+1·round_id = 부모 round_id(비우면 채움)
--   parent_id 가 그대로이고 depth·round_id 만 바뀌는 행 = node_move 의 서브트리 일괄 재기록이다. 같은 문장 안에서 부모 행도
--   바뀌어 행 단위로는 부모의 새 값을 볼 수 없으므로 부모 관계 검사를 건너뛴다(이동한 노드 자신은 parent_id 가 바뀌어 검사된다).
--   depth-2 리프(task_type 있음)는 허용한다(A7).
create or replace function public.goal_nodes_guard() returns trigger
language plpgsql set search_path = '' as $$
declare p public.goal_nodes;
begin
  if new.parent_id is null then
    new.round_id := coalesce(new.round_id, new.id);
    if new.depth <> 2 or new.round_id <> new.id then
      perform public.fail('VALIDATION_FAILED', '회차는 depth 2 이고 round_id 가 자기 자신이어야 해요',
                          jsonb_build_object('nodeId', new.id::text, 'field', 'depth'));
    end if;
    if new.label is null or btrim(new.label) = '' then
      perform public.fail('VALIDATION_FAILED', '회차에는 라벨이 있어야 해요', jsonb_build_object('nodeId', new.id::text, 'field', 'label'));
    end if;
  else
    if new.label is not null then
      perform public.fail('VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', jsonb_build_object('nodeId', new.id::text, 'field', 'label'));
    end if;
    if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
      select * into p from public.goal_nodes where id = new.parent_id;
      new.round_id := coalesce(new.round_id, p.round_id);
      if p.room_id <> new.room_id or new.depth <> p.depth + 1 or new.round_id is distinct from p.round_id then
        perform public.fail('VALIDATION_FAILED', '상위 항목과 깊이·회차·방이 맞지 않아요',
                            jsonb_build_object('nodeId', new.id::text, 'parentId', new.parent_id::text));
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger trg_goal_nodes_guard
  before insert or update of parent_id, depth, round_id, label, room_id on public.goal_nodes
  for each row execute function public.goal_nodes_guard();

-- ───────── 트리 헬퍼 ─────────
-- 자기 자신을 포함한 서브트리 id 집합
create or replace function public.node_subtree(p_node bigint) returns setof bigint
language sql stable security definer set search_path = '' as $$
  with recursive t as (
    select n.id from public.goal_nodes n where n.id = p_node
    union all
    select c.id from public.goal_nodes c join t on c.parent_id = t.id)
  select id from t
$$;

-- 서브트리 어느 리프에든 제출물이 있으면 true (I1·I6 — 삭제·부모 전환·타입 변경 금지의 근거)
create or replace function public.node_has_submissions(p_node bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.submissions s where s.node_id in (select public.node_subtree(p_node)))
$$;

-- 모든 노드 쓰기 함수의 첫 줄: 방 잠금 + 그룹장 + 편집 가능 상태(DRAFT·RECRUIT·ACTIVE, 보관 아님)
create or replace function public.node_assert_editable(p_slug text) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 커리큘럼을 편집할 수 있어요');   -- 외부인(못 읽음) ROOM_NOT_FOUND, 그 외 NOT_LEADER (plan 02 I-2)
  if r.archived_at is not null or r.status not in ('DRAFT', 'RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_NOT_EDITABLE', '종료되었거나 보관된 방은 편집할 수 없어요', jsonb_build_object('status', lower(r.status)));
  end if;
  return r;
end $$;

-- 방 소속 노드 조회. 다른 방의 노드도 NODE_NOT_FOUND
create or replace function public.node_get(p_room bigint, p_node bigint) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes;
begin
  select * into n from public.goal_nodes where id = p_node and room_id = p_room;
  if not found then perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', p_node::text)); end if;
  return n;
end $$;

-- ───────── 진척률 롤업 (D5, 02 §4.1) ─────────
-- 모든 노드 한 행씩. 리프 = (유효 배정, 그중 제출), 부모 = 보관 아닌 후손 리프의 합. 보관 노드와 그 하위는 0/0(pct null).
create or replace function public.room_progress(p_room bigint)
returns table (node_id bigint, asg int, sub int, pct int)
language sql stable security definer set search_path = '' as $$
  with recursive leaf as (
    select n.id, n.parent_id, count(a.id)::int as asg, count(s.id)::int as sub
    from public.goal_nodes n
    left join public.task_assignments a on a.node_id = n.id and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
    where n.room_id = p_room and n.task_type is not null and n.archived_at is null
    group by n.id, n.parent_id),
  up as (
    select l.id as node_id, l.asg, l.sub, l.parent_id from leaf l
    union all
    select p.id, u.asg, u.sub, p.parent_id
    from up u join public.goal_nodes p on p.id = u.parent_id)
  select n.id, coalesce(sum(u.asg), 0)::int, coalesce(sum(u.sub), 0)::int,
         public.pct(coalesce(sum(u.asg), 0)::int, coalesce(sum(u.sub), 0)::int)
  from public.goal_nodes n
  left join up u on u.node_id = n.id
  where n.room_id = p_room
  group by n.id
$$;

-- 플랜 02 의 room_leaf_stats 를 같은 시그니처로 교체: 숫자는 room_progress 에서 가져온다 (room_get·rooms_list 가 자동으로 같은 값을 본다)
create or replace function public.room_leaf_stats(p_room bigint)
returns table (node_id bigint, round_id bigint, parent_id bigint, title text, task_type text,
               start_date date, end_date date, sort_order int, asg int, sub int)
language sql stable security definer set search_path = '' as $$
  select n.id, n.round_id, n.parent_id, n.title::text, n.task_type::text, n.start_date, n.end_date, n.sort_order, p.asg, p.sub
  from public.goal_nodes n
  join public.room_progress(p_room) p on p.node_id = n.id
  where n.room_id = p_room and n.task_type is not null and n.archived_at is null
$$;

-- ───────── Curriculum JSON (03-api §4) ─────────
create or replace function public.curriculum_json(p_room bigint, p_uid uuid, p_include_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  v_today   date := public.kst_today();
  v_people  boolean;     -- people 노출: 그룹장 | ACTIVE·INACTIVE·PENDING 멤버
  v_members jsonb;
  v_nodes   jsonb;
  v_stats   jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_people := p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')));

  select coalesce(jsonb_agg(
           public.person_json(m.user_id) || jsonb_build_object(
             'role', lower(m.role), 'status', lower(m.status),
             'doesTasks', m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks))
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  into v_members
  from public.room_members m
  where m.room_id = p_room and m.status in ('ACTIVE', 'INACTIVE');

  -- nodes·stats 는 같은 room_progress 결과(prog)를 공유한다 (한 번만 계산)
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
             'assigned', p.asg, 'submitted', p.sub, 'pct', p.pct,
             'task', case when t.task_type is null then null else jsonb_build_object(
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
    from t join prog p on p.node_id = t.id
    where p_include_archived or t.archived_at is null),
  stats as (
    select jsonb_build_object(
      'overallPct', public.pct(coalesce(sum(p.asg), 0)::int, coalesce(sum(p.sub), 0)::int),
      'leafCount', count(*),
      'unassignedCount', count(*) filter (where n.task_type = 'DESIGNATED' and p.asg = 0)) as j
    from public.goal_nodes n join prog p on p.node_id = n.id
    where n.room_id = p_room and n.task_type is not null and n.archived_at is null)
  select (select j from nodes), (select j from stats) into v_nodes, v_stats;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'room', jsonb_build_object('slug', r.slug, 'status', lower(r.status), 'leaderDoesTasks', r.leader_does_tasks),
    'members', v_members, 'nodes', v_nodes, 'stats', v_stats);
end $$;
-- curriculum_json 은 임의 p_uid 를 받는 내부 빌더 — GRANT 없음(D7)

-- 공개 RPC. 비공개 방 비멤버·보관 방 비멤버는 ROOM_NOT_FOUND (D7)
create or replace function public.curriculum_get(p_slug text, p_include_archived boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.current_user_id(); v_room bigint;
begin
  select id into v_room from public.rooms where slug = p_slug;
  if v_room is null or not public.room_readable(v_room, v_uid) then
    perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요');
  end if;
  return public.curriculum_json(v_room, v_uid, coalesce(p_include_archived, false));
end $$;

grant execute on function public.curriculum_get(text, boolean) to anon, authenticated;
