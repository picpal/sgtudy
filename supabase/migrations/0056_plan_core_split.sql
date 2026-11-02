-- 0056_plan_core_split.sql — 2026-11-02 MCP(PAT) 3초 타임아웃: 내부 호출마다 버려지던 curriculum_json 제거. 배포 후 수정 금지.
-- 실측(mcp-3s-bench, 로컬): 담당 지정 48 + 방 1,098노드 미리보기 3/3 TIMEOUT. plan_run 의 담당 지정 create·update 가 부르는
--   node_update 시간의 ~80% 가 끝의 curriculum_json(방 전체 트리) — plan_run 은 {warnings, shifted} 만 쓰고 버린다. move·personal_create_many 도 같다.
-- 방식(0034 node_create_core 와 같음): 본문을 json 없는 *_core 로 옮기고 공개 RPC 는 core → curriculum_json 한 번의 래퍼.
--   core 본문 = 원본 그대로(검사·잠금·쓰기·resync·알림·태그 순서 동일), 마지막 return 만 바뀐다 → 웹 응답·알림·데이터 불변.
--   plan_run·personal_create_many 는 core 를 부른다. 방 단위 재계산(room_leaf_stats·assignment_resync·room_progress)은 그대로(알림 판정 순서 보존).
-- 재정의(최신 판 복사): node_update ← 0028 · node_move ← 0006 · personal_create ← 0014 · plan_run ← 0038 · personal_create_many ← 0035
--   (0039~0055 재정의 없음). 공개 함수 시그니처·기본값 동일 → GRANT 유지. core 는 GRANT 없음(0002 기본 권한 — 정의자 함수만 부른다).

-- ───────── 1. node_update_core (0028 node_update 본문) → {roomId, warnings, shifted} ─────────
create or replace function public.node_update_core(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb
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
  v_g       record;          -- 0028: 묶음 이동 담당자별 (user_id, k, first_id)
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
                         'moved', (v_moved ->> 'tasks')::int + (v_moved ->> 'personal')::int,
                         'movedTasks', (v_moved ->> 'tasks')::int, 'movedPersonal', (v_moved ->> 'personal')::int));   -- 0026: 꼬리를 나눠 말한다
  end if;
  -- 0026 (리뷰 Important): 묶음(depth ≥ 3)을 하위와 함께 옮기면 회차 알림이 없으므로, 옮긴 팀 과제(보관 제외)의 담당자에게 SCHEDULE_CHANGED.
  -- 0028: 담당자별 1건. 맡은 과제가 1개면 과제를 직접 고친 것과 같은 모델(옛 → 새)·prefix(과제 id), 2개 이상이면 묶음 알림(묶음 id).
  if r.status = 'ACTIVE' and n.depth >= 3 and v_type is null and v_days <> 0 then
    for v_g in
      select a.user_id, count(*)::int as k, min(g.id) as first_id
      from public.goal_nodes g join public.task_assignments a on a.node_id = g.id and a.released_at is null
      where g.id = any(v_desc_ids) and g.archived_at is null and g.task_type in ('COMMON', 'DESIGNATED')
      group by a.user_id order by a.user_id
    loop
      if v_g.k = 1 then
        select * into p from public.goal_nodes where id = v_g.first_id;
        perform public.notify_publish('SCHEDULE_CHANGED', r.id, p.id, v_uid, array[v_g.user_id],
          'SCHEDULE_CHANGED:' || r.id || ':' || p.id || ':' || txid_current(),
          jsonb_build_object('title', p.title, 'startDate', to_char(p.start_date, 'YYYY-MM-DD'), 'endDate', to_char(p.end_date, 'YYYY-MM-DD'),
                             'oldStartDate', to_char(p.start_date - v_days, 'YYYY-MM-DD'), 'oldEndDate', to_char(p.end_date - v_days, 'YYYY-MM-DD')));
      else
        perform public.notify_publish('SCHEDULE_CHANGED', r.id, n.id, v_uid, array[v_g.user_id],
          'SCHEDULE_CHANGED:' || r.id || ':' || n.id || ':' || txid_current(),
          jsonb_build_object('bundle', true, 'tasks', v_g.k, 'days', v_days, 'title', v_title,
                             'startDate', to_char(v_s, 'YYYY-MM-DD'), 'endDate', to_char(v_e, 'YYYY-MM-DD'),
                             'oldStartDate', to_char(n.start_date, 'YYYY-MM-DD'), 'oldEndDate', to_char(n.end_date, 'YYYY-MM-DD')));
      end if;
    end loop;
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

  return jsonb_build_object('roomId', r.id, 'warnings', v_warn, 'shifted', v_moved);   -- 0056: 트리는 래퍼(node_update)만
end $$;

-- node_update (웹 RPC): core → 트리 한 번. 0028 과 같은 병합 순서(트리 || {warnings, shifted} — 트리의 warnings 를 자기 경고로 덮는다)
create or replace function public.node_update(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  v_res := public.node_update_core(p_slug, p_node_id, p_patch);
  return public.curriculum_json((v_res ->> 'roomId')::bigint, public.current_user_id(), true) || (v_res - 'roomId');
end $$;

-- ───────── 2. node_move_core (0006 node_move 본문) → room id ─────────
create or replace function public.node_move_core(p_slug text, p_node_id bigint, p_parent_id bigint, p_index int) returns bigint
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
  return r.id;   -- 0056: 트리는 래퍼(node_move)만
end $$;

-- node_move (웹 RPC · node_indent·node_outdent 가 부른다)
create or replace function public.node_move(p_slug text, p_node_id bigint, p_parent_id bigint, p_index int) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.curriculum_json(public.node_move_core(p_slug, p_node_id, p_parent_id, p_index), public.current_user_id(), true);
end $$;

-- ───────── 3. personal_create_core (0014 personal_create 본문) → {roomId, createdId, warnings} ─────────
create or replace function public.personal_create_core(
  p_slug text, p_round_id bigint, p_title text, p_start_date date, p_end_date date, p_description_md text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  r       public.rooms;
  rd      public.goal_nodes;
  v_title text := trim(coalesce(p_title, ''));
  v_desc  text := coalesce(p_description_md, '');
  v_s     date;
  v_e     date;
  v_n     int;
  v_id    bigint;
  v_warn  jsonb := '[]'::jsonb;
begin
  r := public.personal_room(p_slug, v_uid);
  if not public.personal_eligible(r.id, v_uid) then
    perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 개인 목표를 만들 수 있어요');
  end if;
  rd := public.personal_round(r.id, p_round_id);
  -- 기본 기간 = 회차 기간을 방 기간으로 자른 것 (방 밖으로 나간 기존 회차 대비)
  v_s := coalesce(p_start_date, greatest(rd.start_date, r.start_date));
  v_e := coalesce(p_end_date, least(rd.end_date, r.end_date));
  perform public.personal_check(r, v_title, v_s, v_e);
  if length(v_desc) > 20000 then perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb); end if;
  perform public.personal_assert_capacity(rd.id, v_uid, null);

  select count(*)::int into v_n from public.goal_nodes where parent_id = rd.id;
  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, description_md, start_date, end_date, task_type, owner_id)
  values (r.id, rd.id, rd.id, 3, v_n, v_title, v_desc, v_s, v_e, 'PERSONAL', v_uid)
  returning id into v_id;
  if v_s < rd.start_date or v_e > rd.end_date then
    v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_PARENT', 'nodeId', v_id::text);
  end if;
  return jsonb_build_object('roomId', r.id, 'createdId', v_id::text, 'warnings', v_warn);   -- 0056: 트리는 래퍼(personal_create)만
end $$;

-- personal_create (웹 RPC): 기본값 그대로 — null 기간은 core 가 회차∩방으로 채운다
create or replace function public.personal_create(
  p_slug text, p_round_id bigint, p_title text, p_start_date date default null, p_end_date date default null, p_description_md text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  v_res := public.personal_create_core(p_slug, p_round_id, p_title, p_start_date, p_end_date, p_description_md);
  return public.curriculum_json((v_res ->> 'roomId')::bigint, public.current_user_id(), true) || (v_res - 'roomId');
end $$;

-- ───────── 4. plan_run ← 0038 판. 0056: node_update·node_move → *_core (호출마다 트리 생성 제거) ─────────
create or replace function public.plan_run(r public.rooms, p_uid uuid, p_plan jsonb, p_dry boolean, p_warn jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_slug     text := r.slug;
  v_uid      uuid := p_uid;
  v_dry      boolean := coalesce(p_dry, true);
  v_after_id bigint;
  f          record;
  o          jsonb;
  v_cur      text;
  v_refs     jsonb := '{}'::jsonb;   -- ref → path
  v_ids      jsonb := '{}'::jsonb;   -- path → id (create)
  v_dm       jsonb := '{}'::jsonb;   -- path → diff 항목
  v_diff     jsonb;
  v_warn     jsonb := '[]'::jsonb;   -- 실행 중 경고(node_update)
  v_notes    jsonb;
  v_parent   bigint;
  v_id       bigint;
  v_res      jsonb;
  v_chg      jsonb;
  v_nb       jsonb;                  -- 〔P4〕 담당 닉네임(전)
  v_na       jsonb;                  --        (후)
  b          public.goal_nodes;
  a          public.goal_nodes;
  v_created  int := 0;
  v_updated  int := 0;
  v_moved    int := 0;
  v_shift    int := 0;
  v_sched    jsonb := '{}'::jsonb;   -- 〔N2〕 실제 날짜 변경 {id:[옛s,옛e,새s,새e]}
  v_pre      jsonb;
  v_out      jsonb;
  v_state    text;
  v_code     text;
  v_msg      text;
  v_hint     text;
  v_e        jsonb;
begin
  select coalesce(max(id), 0) into v_after_id from public.notifications;      -- ⑥ 알림 묶기 기준점
  begin                                                                       -- ⑦ 서브트랜잭션
    for f in select * from public.plan_flatten(p_plan) loop
      v_cur := f.path;
      o := f.op;
      if o ? 'ref' then v_refs := v_refs || jsonb_build_object(o ->> 'ref', f.path); end if;
      case coalesce(o ->> 'op', 'create')
        when 'create' then
          v_parent := case
            when f.parent_path is not null then (v_ids ->> f.parent_path)::bigint
            when jsonb_typeof(o -> 'parent') = 'string' and left(o ->> 'parent', 1) = '@'
              then (v_ids ->> (v_refs ->> substr(o ->> 'parent', 2)))::bigint
            else (o ->> 'parent')::bigint end;
          v_id := public.node_create_core(r, v_uid, v_parent, o ->> 'title', o ->> 'label', o ->> 'taskType',
                    public.plan_date_try(o ->> 'startDate'), public.plan_date_try(o ->> 'endDate'),
                    (o ->> 'index')::int, coalesce(o ->> 'descriptionMd', ''));
          v_ids := v_ids || jsonb_build_object(f.path, v_id);
          if o ->> 'kind' = 'exam' then                                       -- 0038 빈 초안(DRAFT·문항 0) — exam_put 이 리프·편집 관문을 다시 본다
            perform public.exam_put(v_slug, v_id, '{"questions": []}'::jsonb);
          end if;
          if o ? 'assigneeIds' then
            perform public.node_update_core(v_slug, v_id, jsonb_build_object('assigneeIds', o -> 'assigneeIds'));   -- 0056
          end if;
        when 'update' then
          v_id := (o ->> 'id')::bigint;                                       -- update 의 id 는 @ref 불가(plan_validate)
          select * into b from public.goal_nodes where id = v_id;
          v_nb := case when (o -> 'set') ? 'assigneeIds' then public.plan_nicks(v_id) end;
          -- 〔N2〕 node_update 가 옮길 수 있는 범위(자기 + 하위, 개인 목표 포함)의 날짜를 앞뒤로 비교
          select coalesce(jsonb_object_agg(g.id::text, jsonb_build_array(g.start_date, g.end_date)), '{}'::jsonb) into v_pre
          from public.goal_nodes g where g.id in (select public.node_subtree(v_id));
          v_res := public.node_update_core(v_slug, v_id, o -> 'set');   -- 0056: {warnings, shifted} 만 쓴다
          select v_sched || coalesce(jsonb_object_agg(g.id::text, jsonb_build_array(
                   coalesce(v_sched -> g.id::text -> 0, v_pre -> g.id::text -> 0),    -- 옛 값은 처음 것
                   coalesce(v_sched -> g.id::text -> 1, v_pre -> g.id::text -> 1),
                   g.start_date, g.end_date)), '{}'::jsonb) into v_sched
          from public.goal_nodes g
          where g.id in (select public.node_subtree(v_id)) and v_pre ? g.id::text
            and jsonb_build_array(g.start_date, g.end_date) <> v_pre -> g.id::text
            and not exists (select 1 from jsonb_each_text(v_ids) c where c.value::bigint = g.id);   -- 이 계획이 만든 노드 제외
          select * into a from public.goal_nodes where id = v_id;
          v_shift := v_shift + coalesce((v_res #>> '{shifted,tasks}')::int, 0) + coalesce((v_res #>> '{shifted,groups}')::int, 0)
                             + coalesce((v_res #>> '{shifted,personal}')::int, 0);
          v_warn := v_warn || coalesce((select jsonb_agg(w || jsonb_build_object('path', f.path,      -- 〔C#9〕 message 보강
                                          'message', coalesce(w ->> 'message', public.plan_warn_text(w ->> 'code'))))
                                        from jsonb_array_elements(v_res -> 'warnings') w), '[]'::jsonb);
          v_chg := public.plan_changes(b, a, o -> 'set');
          if v_nb is not null then
            v_na := public.plan_nicks(v_id);
            if v_na <> v_nb then v_chg := v_chg || jsonb_build_object('assignees', jsonb_build_array(v_nb, v_na)); end if;
          end if;
          v_dm := v_dm || jsonb_build_object(f.path, jsonb_build_object('path', f.path, 'op', 'update', 'id', v_id::text,
                    'kind', public.plan_kind(a), 'title', a.title, 'changes', v_chg)
                    || case when exists (select 1 from public.exams x where x.node_id = v_id) then '{"exam": true}'::jsonb else '{}'::jsonb end);   -- 0038
          v_updated := v_updated + 1;
        when 'move' then
          v_id := case when jsonb_typeof(o -> 'id') = 'string' and left(o ->> 'id', 1) = '@'          -- move 의 id 는 @ref 가능
                         then (v_ids ->> (v_refs ->> substr(o ->> 'id', 2)))::bigint
                       else (o ->> 'id')::bigint end;
          v_parent := case when jsonb_typeof(o -> 'parent') = 'string' and left(o ->> 'parent', 1) = '@'
                             then (v_ids ->> (v_refs ->> substr(o ->> 'parent', 2)))::bigint
                           else (o ->> 'parent')::bigint end;
          select * into b from public.goal_nodes where id = v_id;
          perform public.node_move_core(v_slug, v_id, v_parent, (o ->> 'index')::int);   -- 0056
          select * into a from public.goal_nodes where id = v_id;
          v_dm := v_dm || jsonb_build_object(f.path, jsonb_build_object('path', f.path, 'op', 'move',
                    'id', case when v_dry and left(o ->> 'id', 1) = '@' then null else v_id::text end,   -- 되감길 임시 id 비노출
                    'ref', case when left(o ->> 'id', 1) = '@' then substr(o ->> 'id', 2) end,
                    'kind', public.plan_kind(a), 'title', a.title, 'parent', o -> 'parent', 'index', (o ->> 'index')::int,
                    'from', jsonb_build_object('parentId', case when v_dry and exists (select 1 from jsonb_each_text(v_ids) c where c.value::bigint = b.parent_id)
                                                                then null else b.parent_id::text end, 'index', b.sort_order))
                    || case when exists (select 1 from public.exams x where x.node_id = v_id) then '{"exam": true}'::jsonb else '{}'::jsonb end);   -- 0038
          v_moved := v_moved + 1;
      end case;
    end loop;
    v_cur := null;
    -- 〔N2〕 새 값을 최종 행으로 갱신하고, 계획 안에서 원위치된 항목은 뺀다
    select coalesce(jsonb_object_agg(e.k, jsonb_build_array(e.v -> 0, e.v -> 1, g.start_date, g.end_date)), '{}'::jsonb) into v_sched
    from jsonb_each(v_sched) e(k, v) join public.goal_nodes g on g.id = e.k::bigint
    where jsonb_build_array(g.start_date, g.end_date) <> jsonb_build_array(e.v -> 0, e.v -> 1);
    perform public.assignment_resync(r.id);
    v_notes := public.plan_collapse_notifications(r.id, v_uid, v_after_id,     -- 〔§5.4〕 수신자당 ≤ 1건(dry 면 함께 되감긴다)
                 (select coalesce(array_agg(value::bigint), '{}'::bigint[]) from jsonb_each_text(v_ids)
                  where not exists (select 1 from public.exams x where x.node_id = value::bigint)));   -- 0038 초안 시험은 「새 과제」로 세지 않는다(발행 때 EXAM_PUBLISHED)
    -- create diff: 최종 상태로(리프 → 묶음 전환 반영). dry-run 이면 id null(되감긴 임시 id 비노출), 새 부모는 parentPath. 〔P4〕 지정 과제는 담당 닉네임
    for f in select * from public.plan_flatten(p_plan) x where coalesce(x.op ->> 'op', 'create') = 'create' loop
      select * into a from public.goal_nodes where id = (v_ids ->> f.path)::bigint;
      v_dm := v_dm || jsonb_build_object(f.path, jsonb_build_object('path', f.path, 'op', 'create', 'ref', f.op ->> 'ref',
        'id', case when v_dry then null else a.id::text end, 'kind', public.plan_kind(a), 'title', a.title, 'label', a.label,
        'taskType', lower(a.task_type), 'startDate', to_char(a.start_date, 'YYYY-MM-DD'), 'endDate', to_char(a.end_date, 'YYYY-MM-DD'),
        'parent', case when f.parent_path is null and left(coalesce(f.op ->> 'parent', ''), 1) <> '@' then f.op ->> 'parent' end,
        'parentPath', coalesce(f.parent_path, case when left(f.op ->> 'parent', 1) = '@' then v_refs ->> substr(f.op ->> 'parent', 2) end))
        || case when a.task_type = 'DESIGNATED' then jsonb_build_object('assignees', public.plan_nicks(a.id)) else '{}'::jsonb end
        || case when exists (select 1 from public.exams x where x.node_id = a.id) then '{"exam": true}'::jsonb else '{}'::jsonb end);   -- 0038
      v_created := v_created + 1;
    end loop;
    select coalesce(jsonb_agg(v_dm -> x.path order by x.seq), '[]'::jsonb) into v_diff
    from public.plan_flatten(p_plan) x where v_dm ? x.path;
    v_out := jsonb_build_object('ok', true,
      'summary', jsonb_build_object('created', v_created, 'updated', v_updated, 'moved', v_moved, 'restored', 0, 'shiftedDescendants', v_shift),
      'diff', v_diff, 'warnings', coalesce(p_warn, '[]'::jsonb) || v_warn, 'errors', '[]'::jsonb, 'notifications', v_notes,
      'ids', v_ids, 'sched', v_sched,
      'refs', coalesce((select jsonb_object_agg(k, v_ids ->> (v_refs ->> k)) from jsonb_object_keys(v_refs) k), '{}'::jsonb));
    if v_dry then raise exception using errcode = 'P0001', message = 'PLAN_DRY_RUN'; end if;
  exception when others then                                                  -- ⑧
    get stacked diagnostics v_state = returned_sqlstate, v_code = message_text, v_msg = pg_exception_detail, v_hint = pg_exception_hint;
    if v_code = 'PLAN_DRY_RUN' and v_state = 'P0001' then
      v_out := v_out || '{"ids": {}, "refs": {}}'::jsonb;                     -- 되감김 — 임시 id 비노출
    elsif v_dry then
      return jsonb_build_object('ok', false, 'diff', '[]'::jsonb, 'warnings', coalesce(p_warn, '[]'::jsonb),
        'errors', jsonb_build_array(public.plan_runtime_err(v_cur, v_state, v_code, v_msg, v_hint)), 'notifications', null);
    else
      v_e := public.plan_runtime_err(v_cur, v_state, v_code, v_msg, v_hint);
      raise exception using errcode = 'P0001', message = v_e ->> 'code', detail = v_e ->> 'message', hint = (v_e - 'code' - 'message')::text;
    end if;
  end;
  return v_out;
end $$;

-- ───────── 5. personal_create_many ← 0035 판. 0056: personal_create → personal_create_core ─────────
create or replace function public.personal_create_many(p_slug text, p_round jsonb, p_goals jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g      jsonb;
  k      text;
  v_t    text;
  v_res  jsonb;
  v_ids  jsonb := '[]'::jsonb;
  v_skip jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_warn jsonb := '[]'::jsonb;
  v_uid  uuid := public.require_user();
  r      public.rooms;
  v_pick jsonb;
  v_rd   public.goal_nodes;
begin
  r := public.personal_room(p_slug, v_uid);                                   -- ① room_lock FOR UPDATE · 읽기 · RECRUIT/ACTIVE
  if not public.personal_eligible(r.id, v_uid) then                           -- ②
    perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 개인 목표를 만들 수 있어요');
  end if;
  v_pick := public.plan_round_pick(r, coalesce(p_round, '"current"'::jsonb)); -- ③
  if v_pick ? 'error' then
    perform public.fail(v_pick #>> '{error,code}', coalesce(v_pick #>> '{error,message}', '회차를 찾을 수 없어요'),
      jsonb_strip_nulls(jsonb_build_object('candidates', v_pick #> '{error,candidates}')));
  end if;
  v_rd := public.personal_round(r.id, (v_pick ->> 'id')::bigint);            --    보관·과제형 회차 거부(0014)
  if jsonb_typeof(p_goals) is distinct from 'array' then                      -- ④
    perform public.fail('VALIDATION_FAILED', '개인 목표는 한 번에 1~20개예요', '{"field":"goals"}'::jsonb);
  end if;
  if jsonb_array_length(p_goals) not between 1 and 20 then
    perform public.fail('VALIDATION_FAILED', '개인 목표는 한 번에 1~20개예요', '{"field":"goals"}'::jsonb);
  end if;
  for g in select value from jsonb_array_elements(p_goals) loop
    if jsonb_typeof(g) <> 'object' then perform public.fail('VALIDATION_FAILED', '목표 항목이 올바르지 않아요', '{"field":"goals"}'::jsonb); end if;
    for k in select jsonb_object_keys(g) loop
      if k not in ('title', 'startDate', 'endDate', 'descriptionMd') then
        perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', left(k, 40)));
      end if;
    end loop;
  end loop;
  for g in select value from jsonb_array_elements(p_goals) loop               -- ⑤⑥ (방 잠금 안 — 동시 호출이 같은 제목을 둘 다 만들지 못한다)
    v_t := trim(coalesce(g ->> 'title', ''));
    if v_t <> '' and (v_t = any(v_seen) or exists (
          select 1 from public.goal_nodes n where n.parent_id = v_rd.id and n.owner_id = v_uid and n.task_type = 'PERSONAL'
            and n.archived_at is null and trim(n.title) = v_t)) then
      v_skip := v_skip || to_jsonb(v_t);
      continue;
    end if;
    v_seen := v_seen || v_t;
    v_res := public.personal_create_core(p_slug, v_rd.id, g ->> 'title', (g ->> 'startDate')::date, (g ->> 'endDate')::date, coalesce(g ->> 'descriptionMd', ''));   -- 0056
    v_ids := v_ids || to_jsonb(v_res ->> 'createdId');
    v_warn := v_warn || coalesce((select jsonb_agg(w || jsonb_build_object('message', public.plan_warn_text(w ->> 'code')))   -- 〔C#9〕
                                  from jsonb_array_elements(v_res -> 'warnings') w), '[]'::jsonb);
  end loop;
  return jsonb_build_object('createdIds', v_ids, 'skipped', v_skip, 'warnings', v_warn, 'count', jsonb_array_length(v_ids),
    'round', jsonb_build_object('id', v_rd.id::text, 'label', v_rd.label, 'title', v_rd.title),
    'remaining', public.personal_limit() - (select count(*) from public.goal_nodes n where n.parent_id = v_rd.id and n.owner_id = v_uid
                                              and n.task_type = 'PERSONAL' and n.archived_at is null));
end $$;
