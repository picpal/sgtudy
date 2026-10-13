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
                          jsonb_build_object('nodeId', new.id::text, 'field', case when new.depth <> 2 then 'depth' else 'roundId' end));
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
-- 전제: 보관은 항상 서브트리 전체에 전파된다(node_archive). 그래서 "보관되지 않은 리프만 센다" 가 곧 "보관 서브트리 제외" 이고,
-- 보관된 부모 밑에 살아 있는 리프가 남지 않는다. 직접 UPDATE 로 일부만 보관하면 이 롤업은 부모 숫자에서 그 리프를 그냥 뺀다.
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

-- ───────── 내부 헬퍼 (GRANT 없음 — node_create / node_move 가 공유, E5) ─────────
-- 리프 → 부모 전환 (I1): 제출물이 있으면 불가. task_type 을 비우고 배정을 해제한다. 호출자가 이후 assignment_resync 한다.
create or replace function public.node_make_parent(p public.goal_nodes, p_msg text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.node_has_submissions(p.id) then
    perform public.fail('NODE_HAS_SUBMISSIONS', p_msg, jsonb_build_object('nodeId', p.id::text));
  end if;
  update public.goal_nodes set task_type = null, updated_at = now() where id = p.id;
  update public.task_assignments set released_at = now() where node_id = p.id and released_at is null;
end $$;

-- 형제 sort_order 를 0..n-1 로 재부여 (p_except 노드는 제외 — 이동 중인 노드)
create or replace function public.node_renumber(p_room bigint, p_parent bigint, p_except bigint default null) returns void
language sql security definer set search_path = '' as $$
  update public.goal_nodes g set sort_order = s.rn - 1
  from (select id, row_number() over (order by sort_order, id) as rn
        from public.goal_nodes
        where room_id = p_room and parent_id is not distinct from p_parent and id is distinct from p_except) s
  where g.id = s.id and g.sort_order <> s.rn - 1
$$;

-- ───────── node_create (03-api §4 기본값, mystudy E1·E2) ─────────
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

  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, label, title, start_date, end_date, task_type)
  values (r.id, p_parent_id, v_round, v_depth, v_idx, v_label, v_title, v_s, v_e, v_type)
  returning id into v_id;
  if p_parent_id is null then update public.goal_nodes set round_id = v_id where id = v_id; end if;

  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- ───────── node_delete (E8) ─────────
create or replace function public.node_delete(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if public.node_has_submissions(n.id) then
    perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 항목은 삭제할 수 없어요. 보관해 주세요', jsonb_build_object('nodeId', n.id::text));
  end if;
  -- 서브트리를 한 문장으로 지운다: round_id FK(NO ACTION)가 parent_id cascade 의 중첩 문장에서 먼저 걸리기 때문. 배정은 node_id cascade
  delete from public.goal_nodes where id in (select public.node_subtree(n.id));
  perform public.node_renumber(r.id, n.parent_id);
  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- ───────── node_archive / node_unarchive (E9·E10, I5) ─────────
create or replace function public.node_archive(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  update public.goal_nodes set archived_at = now(), updated_at = now()
  where id in (select public.node_subtree(n.id)) and archived_at is null;
  perform public.assignment_resync(r.id);                  -- 보관 리프의 COMMON·DESIGNATED 행 released (released_at = archived_at, D13)
  return public.curriculum_json(r.id, v_uid, true);
end $$;

create or replace function public.node_unarchive(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  -- 해제는 서브트리 전체를 푼다: 따로 먼저 보관해 둔 하위 노드도 함께 풀린다(보관 시점을 기억하지 않는다). 부모가 보관 중이면 먼저 부모를 해제해야 한다.
  if n.parent_id is not null and exists (select 1 from public.goal_nodes p where p.id = n.parent_id and p.archived_at is not null) then
    perform public.fail('PARENT_ARCHIVED', '상위 항목이 보관 중이에요. 상위 항목을 먼저 해제해 주세요', jsonb_build_object('nodeId', n.parent_id::text));
  end if;
  -- 보관 때문에 풀린 DESIGNATED 행만 되살린다: resync 가 released_at = 리프의 archived_at 으로 찍어 두었다(D13)
  update public.task_assignments a set released_at = null
  from public.goal_nodes g
  where g.id = a.node_id and g.id in (select public.node_subtree(n.id)) and g.archived_at is not null
    and a.source = 'DESIGNATED' and a.released_at = g.archived_at;
  update public.goal_nodes set archived_at = null, updated_at = now()
  where id in (select public.node_subtree(n.id)) and archived_at is not null;
  perform public.assignment_resync(r.id);                  -- COMMON 행 복구, 그사이 ACTIVE 가 아니게 된 담당자의 DESIGNATED 는 다시 해제
  return public.curriculum_json(r.id, v_uid, true);
end $$;

grant execute on function public.node_create(text, bigint, text, text, text, date, date, int) to authenticated;
grant execute on function public.node_delete(text, bigint)    to authenticated;
grant execute on function public.node_archive(text, bigint)   to authenticated;
grant execute on function public.node_unarchive(text, bigint) to authenticated;

-- ───────── node_update (E3~E7, I2·I6, D9) ─────────
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
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if n.archived_at is not null then   -- I1: 보관된 노드는 변경 전에 거부 (배정·알림 오염 방지)
    if n.task_type is null then perform public.fail('PARENT_ARCHIVED', '보관된 항목은 수정할 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
    perform public.fail('TASK_ARCHIVED', '보관된 과제는 수정할 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'descriptionMd', 'startDate', 'endDate', 'label', 'taskType', 'assigneeIds') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;

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

  -- 알림 (진행중 방만. 0008 전에는 자리표가 0 을 돌려준다)
  -- 행위자(v_uid) 제외는 notify_publish 계약이 맡는다 — 여기서는 담당자 전원을 넘긴다(A5).
  -- 세 알림 모두 행위 이벤트 → prefix 'KIND:room:node:' || txid_current() (D8: 같은 사람 해제 후 재배정도 새 알림, 한 저장 안에서는 1건)
  if r.status = 'ACTIVE' and v_type is not null then
    if (v_s, v_e) is distinct from (n.start_date, n.end_date) then
      select coalesce(array_agg(user_id), '{}') into v_rcpt
      from public.task_assignments where node_id = n.id and released_at is null;
      if cardinality(v_rcpt) > 0 then
        perform public.notify_publish('SCHEDULE_CHANGED', r.id, n.id, v_uid, v_rcpt,
          'SCHEDULE_CHANGED:' || r.id || ':' || n.id || ':' || txid_current(),
          jsonb_build_object('title', v_title, 'startDate', to_char(v_s, 'YYYY-MM-DD'), 'endDate', to_char(v_e, 'YYYY-MM-DD')));
      end if;
    end if;
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

  -- 태그 자동 선택 (0009 가 있을 때만 — 플랜 04)
  if (p_patch ? 'title' or p_patch ? 'descriptionMd') and to_regproc('public.tag_autoselect') is not null then
    execute 'select public.tag_autoselect($1)' using r.id;
  end if;

  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('warnings', v_warn);
end $$;

grant execute on function public.node_update(text, bigint, jsonb) to authenticated;

-- ───────── node_move (E11~E13, I1·I3·I4) ─────────
create or replace function public.node_move(p_slug text, p_node_id bigint, p_parent_id bigint, p_index int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r          public.rooms;
  n          public.goal_nodes;
  p          public.goal_nodes;
  v_uid      uuid;
  v_depth    int;
  v_round    bigint;
  v_max      int;
  v_delta    int;
  v_n        int;
  v_idx      int;
  v_label    text;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if n.archived_at is not null then   -- I1: 보관된 노드는 이동 전에 거부 (대상 리프의 부모 전환·배정 해제 방지). indent/outdent 도 여기를 지난다
    if n.task_type is null then perform public.fail('PARENT_ARCHIVED', '보관된 항목은 옮길 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
    perform public.fail('TASK_ARCHIVED', '보관된 과제는 옮길 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;

  if p_parent_id is not null then
    p := public.node_get(r.id, p_parent_id);
    if p.id in (select public.node_subtree(n.id)) then
      perform public.fail('VALIDATION_FAILED', '자기 자신이나 하위 항목 아래로는 옮길 수 없어요', jsonb_build_object('field', 'parentId'));
    end if;
    if p.archived_at is not null then
      perform public.fail('PARENT_ARCHIVED', '보관된 항목 아래로는 옮길 수 없어요', jsonb_build_object('nodeId', p.id::text));
    end if;
    v_depth := p.depth + 1;
    v_round := p.round_id;
  else
    v_depth := 2;
    v_round := n.id;
  end if;

  select max(depth) into v_max from public.goal_nodes where id in (select public.node_subtree(n.id));
  v_delta := v_depth - n.depth;
  if v_max + v_delta > 5 then
    perform public.fail('NODE_DEPTH_EXCEEDED', '최대 5단계까지만 만들 수 있어요', jsonb_build_object('nodeId', n.id::text));
  end if;

  if p_parent_id is not null and p.task_type is not null then
    perform public.node_make_parent(p, '제출물이 있는 과제 아래로는 옮길 수 없어요. 보관해 주세요');
  end if;

  -- 옛 형제 재정렬 (자기 제외)
  perform public.node_renumber(r.id, n.parent_id, n.id);

  -- 새 형제 사이에 끼우기 (자기 제외한 수로 클램프)
  select count(*)::int into v_n from public.goal_nodes
  where room_id = r.id and parent_id is not distinct from p_parent_id and id <> n.id;
  v_idx := least(greatest(coalesce(p_index, v_n), 0), v_n);
  update public.goal_nodes set sort_order = sort_order + 1
  where room_id = r.id and parent_id is not distinct from p_parent_id and id <> n.id and sort_order >= v_idx;

  -- 회차가 되면 label 기본 {n}주차(있으면 유지). task_type 은 건드리지 않는다 → 리프는 depth-2 리프가 된다(A7, 트리거가 허용)
  v_label := case when p_parent_id is null then coalesce(n.label, (v_n + 1) || '주차') else null end;
  update public.goal_nodes
  set parent_id = p_parent_id, sort_order = v_idx, depth = v_depth, round_id = v_round, label = v_label, updated_at = now()
  where id = n.id;
  update public.goal_nodes set depth = depth + v_delta, round_id = v_round, updated_at = now()
  where id in (select public.node_subtree(n.id)) and id <> n.id;

  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- 내어쓰기: 조부모 아래, 부모 바로 다음. 회차는 불가 (GRANT 없음 — 프론트는 node_move)
create or replace function public.node_outdent(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; p public.goal_nodes;
begin
  r := public.node_assert_editable(p_slug);
  n := public.node_get(r.id, p_node_id);
  if n.parent_id is null then
    perform public.fail('ROOT_CANNOT_OUTDENT', '회차는 더 내어쓸 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  select * into p from public.goal_nodes where id = n.parent_id;
  return public.node_move(p_slug, n.id, p.parent_id, p.sort_order + 1);
end $$;

-- 들여쓰기: 직전 형제 아래 맨 뒤 (GRANT 없음)
create or replace function public.node_indent(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_prev bigint;
begin
  r := public.node_assert_editable(p_slug);
  n := public.node_get(r.id, p_node_id);
  select id into v_prev from public.goal_nodes
  where room_id = r.id and parent_id is not distinct from n.parent_id and id <> n.id and sort_order < n.sort_order
  order by sort_order desc, id desc limit 1;
  if v_prev is null then
    perform public.fail('VALIDATION_FAILED', '바로 위 항목이 없어 들여쓸 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  return public.node_move(p_slug, n.id, v_prev, null);
end $$;

grant execute on function public.node_move(text, bigint, bigint, int) to authenticated;

-- ───────── me_studies (03-api §6, mystudy §1.1·§3.8) ─────────
create or replace function public.me_studies() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  v_out   jsonb;
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
           jsonb_build_object('slug', m.slug, 'title', m.title, 'intro', m.intro, 'membership', m.membership,
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
  return jsonb_build_object('today', to_char(v_today, 'YYYY-MM-DD'), 'groups', v_out);
end $$;

grant execute on function public.me_studies() to authenticated;

-- ───────── me_schedule (03-api §6, schedule §3·§5, 02 §4.4) ─────────
-- 내 방(그룹장|ACTIVE|PENDING, 보관 아님)의 보관 아닌 리프 중 "내 것":
--   유효 배정 → st = task_code / PENDING 방 → 전체 리프 미리보기(st 는 날짜 기준) / 그룹장 leader_does_tasks=false → 보이되 st null
create or replace function public.me_schedule_leaves(p_uid uuid, p_today date)
returns table (node_id bigint, room_id bigint, slug text, title text, s date, e date, st text, round text)
language sql stable security definer set search_path = '' as $$
  select n.id, r.id, r.slug::text, n.title::text, n.start_date, n.end_date,
         case when m.status = 'PENDING' or a.id is not null
              then public.task_code(n.start_date, n.end_date, sub.first_submitted_at, sub.is_late, p_today)
              else null end,
         coalesce(rn.label::text, (rn.sort_order + 1) || '주차')
  from public.rooms r
  join public.room_members m on m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE', 'PENDING')
  join public.goal_nodes n on n.room_id = r.id and n.task_type is not null and n.archived_at is null
  join public.goal_nodes rn on rn.id = n.round_id
  left join public.task_assignments a on a.node_id = n.id and a.user_id = p_uid and a.released_at is null
  left join public.submissions sub on sub.node_id = n.id and sub.user_id = p_uid
  where r.archived_at is null
    and (a.id is not null or m.status = 'PENDING' or (r.leader_id = p_uid and not r.leader_does_tasks))
$$;
-- me_schedule_leaves 는 임의 p_uid 를 받는 내부 함수 — GRANT 없음(D7)

create or replace function public.me_schedule(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := public.require_user();
  v_today    date := public.kst_today();
  v_studies  jsonb;
  v_tasks    jsonb;
  v_markers  jsonb;
  v_upcoming jsonb;
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 62 then
    perform public.fail('SCHEDULE_RANGE_INVALID', '조회 기간은 62일 이내여야 해요', jsonb_build_object('from', to_char(p_from, 'YYYY-MM-DD'), 'to', to_char(p_to, 'YYYY-MM-DD')));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', r.slug, 'title', r.title,
           'membership', case when r.leader_id = v_uid then 'leader' when m.status = 'PENDING' then 'pending' else 'joined' end,
           'tone', (array['mint', 'blue', 'peach', 'lav', 'amber', 'slate'])[1 + (r.id % 6)],
           'status', lower(r.status),
           'startDate', to_char(r.start_date, 'YYYY-MM-DD'), 'endDate', to_char(r.end_date, 'YYYY-MM-DD'))
           order by r.id), '[]'::jsonb)
  into v_studies
  from public.rooms r
  join public.room_members m on m.room_id = r.id and m.user_id = v_uid
  where r.archived_at is null and (r.leader_id = v_uid or m.status in ('ACTIVE', 'PENDING'));

  -- 리프 집합은 한 번만 평가하고 tasks(창 겹침)·upcoming(오늘~+7, 미제출) 이 같은 JSON 을 공유한다(E6)
  with l as materialized (select * from public.me_schedule_leaves(v_uid, v_today)),
       o as (select l.*, jsonb_build_object(
               'id', l.node_id::text, 'slug', l.slug, 'title', l.title,
               's', to_char(l.s, 'YYYY-MM-DD'), 'e', to_char(l.e, 'YYYY-MM-DD'), 'st', l.st, 'round', l.round) as j
             from l)
  select (select coalesce(jsonb_agg(o.j order by o.s, o.e, o.slug, o.node_id), '[]'::jsonb)
            from o where o.s <= p_to and o.e >= p_from),
         (select coalesce(jsonb_agg(o.j order by o.e, o.slug, o.s, o.node_id), '[]'::jsonb)
            from o where o.st in ('open', 'planned') and o.e between v_today and v_today + 7)
  into v_tasks, v_upcoming;

  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(n.start_date, 'YYYY-MM-DD'), 'slug', r.slug,
           'round', coalesce(n.label::text, (n.sort_order + 1) || '주차'))
           order by n.start_date, r.slug, n.sort_order), '[]'::jsonb)
  into v_markers
  from public.rooms r
  join public.room_members m on m.room_id = r.id and m.user_id = v_uid and m.status in ('ACTIVE', 'PENDING')
  join public.goal_nodes n on n.room_id = r.id and n.parent_id is null and n.archived_at is null
  where r.archived_at is null and n.start_date between p_from and p_to;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'studies', v_studies, 'tasks', v_tasks, 'markers', v_markers, 'upcoming', v_upcoming);
end $$;

grant execute on function public.me_schedule(date, date) to authenticated;
