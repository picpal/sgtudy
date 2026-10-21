-- 0034_curriculum_plan.sql — 2026-10-19 AI 연동(MCP) 1단계: 진행목표 계획서. 배포 후 수정 금지.
-- 스펙 §5·§7·§8. 재정의: node_create ← 0024(본문을 node_create_core 로 옮김, 시그니처·GRANT 동일),
--                      notification_kinds ← 0032, notify_render ← 0032 (둘 다 MEMBER_JOINED 유지), notify_link ← 0028 (Task 5).

-- ───────── 1. node_create_core (0024 node_create 본문 그대로 + 설명 인자, 잠금·권한·resync·json 은 호출자) ─────────
-- 내부 헬퍼 — GRANT 없음(0002 기본 권한이 막는다). r 은 호출자가 node_assert_editable 로 잠근 방.
create or replace function public.node_create_core(
  r public.rooms, p_uid uuid, p_parent_id bigint, p_title text, p_label text, p_task_type text,
  p_start_date date, p_end_date date, p_index int, p_description_md text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  p        public.goal_nodes;
  v_id     bigint;
  v_depth  int;
  v_round  bigint;
  v_title  text := nullif(trim(coalesce(p_title, '')), '');
  v_label  text := nullif(trim(coalesce(p_label, '')), '');
  -- 회차: taskType 이 없으면 빈 부모, 있으면 회차 자체가 과제인 depth-2 리프(A7). 하위: 기본 common
  v_type   text := upper(coalesce(p_task_type, case when p_parent_id is null then null else 'common' end));
  v_desc   text := coalesce(p_description_md, '');
  v_s      date;
  v_e      date;
  v_n      int;
  v_idx    int;
begin
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
  -- 0034 추가: 설명 길이
  if length(v_desc) > 20000 then perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb); end if;

  -- 제출물 없는 리프 아래에 자식을 만들면 그 리프는 부모로 전환 (I1)
  if p.id is not null and p.task_type is not null then
    perform public.node_make_parent(p, '제출물이 있는 과제 아래에는 추가할 수 없어요. 보관해 주세요');
  end if;

  v_idx := least(greatest(coalesce(p_index, v_n), 0), v_n);
  update public.goal_nodes set sort_order = sort_order + 1
  where room_id = r.id and parent_id is not distinct from p_parent_id and sort_order >= v_idx;

  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, label, title, description_md, start_date, end_date, task_type, created_by)
  values (r.id, p_parent_id, v_round, v_depth, v_idx, v_label, v_title, v_desc, v_s, v_e, v_type, p_uid)   -- 0024: 작성자(#13)
  returning id into v_id;
  if p_parent_id is null then update public.goal_nodes set round_id = v_id where id = v_id; end if;
  return v_id;
end $$;

-- 0024 판과 시그니처·기본값 동일(GRANT 유지)
create or replace function public.node_create(
  p_slug text, p_parent_id bigint default null, p_title text default null, p_label text default null,
  p_task_type text default null, p_start_date date default null, p_end_date date default null, p_index int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms;
  v_uid uuid;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  perform public.node_create_core(r, v_uid, p_parent_id, p_title, p_label, p_task_type, p_start_date, p_end_date, p_index, '');
  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- ───────── 2. curriculum_version ─────────
-- 〔C#3〕 jsonb 배열 직렬화(문자열 이스케이프·null 자리 유지)의 md5. 세 부분: 방 설정 · ACTIVE 멤버 · 팀 노드(id 순).
-- 제출·개인 목표(owner_id not null)는 반영하지 않는다. 내부 헬퍼 — GRANT 없음. p_room null → md5('[null, [], []]').
create or replace function public.curriculum_version(p_room bigint) returns text
language sql stable security definer set search_path = '' as $$
  select md5(jsonb_build_array(
    (select jsonb_build_array(r.start_date, r.end_date, r.status, r.leader_does_tasks, r.archived_at is not null)
       from public.rooms r where r.id = p_room),
    (select coalesce(jsonb_agg(m.user_id order by m.user_id), '[]'::jsonb)
       from public.room_members m where m.room_id = p_room and m.status = 'ACTIVE'),
    (select coalesce(jsonb_agg(jsonb_build_array(n.id, n.parent_id, n.sort_order, n.depth, n.start_date, n.end_date, n.label, n.title,
              md5(n.description_md), n.task_type, n.archived_at,
              (select coalesce(jsonb_agg(a.user_id order by a.user_id), '[]'::jsonb) from public.task_assignments a
                where a.node_id = n.id and a.released_at is null and a.source = 'DESIGNATED'))
            order by n.id), '[]'::jsonb)
       from public.goal_nodes n where n.room_id = p_room and n.owner_id is null)
  )::text)
$$;
