-- 0028_backlog_f.sql — 2026-10-19 백로그 F. 배포 후 수정 금지. 함수 교체만(시그니처 동일 → GRANT 유지).
-- ① 보관된 방의 승인 대기 신청 취소: room_cancel_application(0005, 이후 재정의 없음)은 보관 여부를 보지 않는다 → 이미 허용. 서버 변경 없음(테스트로 고정).
-- ② 묶음(depth ≥ 3)을 하위와 함께 옮길 때(0026) 과제마다 담당자에게 SCHEDULE_CHANGED 를 1건씩 보내던 것을 담당자별 1건으로 묶는다.
--    k = 그 사람이 맡은 옮긴 팀 과제(보관 제외) 수. k = 1 → 기존 과제 알림 그대로(node = 과제, 0023 옛 → 새 모델).
--    k ≥ 2 → node = 묶음, model {bundle, tasks k, days, 묶음 옛 → 새 기간}. 본문 '"묶음" 과제 k개 일정이 n일 뒤로/앞으로 옮겨졌어요 · 기간 옛 범위 → 새 범위'(시작만 바꿔도 기간).
--    중복 키: 'SCHEDULE_CHANGED:room:<과제 또는 묶음>:txid' — 묶음은 유형이 없어 직접 SCHEDULE_CHANGED 를 받지 않으므로 키가 겹치지 않는다.
-- ③ notify_link: SCHEDULE_CHANGED 딥링크 — 과제면 ?task=(리프 포커스), 묶음이면 ?tab=curriculum&item=(보기 상세). 그 외 kind 불변.
-- 재정의: node_update ← 0026 · notify_render ← 0026 · notify_link ← 0024.

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

  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('warnings', v_warn, 'shifted', v_moved);
end $$;

-- notify_render (0026 + 묶음 이동 묶음 알림)
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
    -- 0028: 묶음 이동 묶음 알림(과제 2개 이상). 묶음 시작만 바꿔도 하위 과제는 종료일까지 함께 옮겨지므로
    -- 0023 의 '시작/마감만' 축약(v_diff) 대신 항상 '기간 옛 범위 → 새 범위' (리뷰 M1)
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null and p_model ? 'bundle' then
      format('"%s" 과제 %s개 일정이 %s일 %s 옮겨졌어요', v_node, v_tasks, abs((p_model ->> 'days')::int),
             case when (p_model ->> 'days')::int < 0 then '앞으로' else '뒤로' end)
      || coalesce(' · 기간 ' || public.notify_range(v_os, v_oe, v_today) || ' → ' || public.notify_range(v_ns, v_ne, v_today), '')
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null and v_diff is not null then
      format('"%s" %s', v_node, v_diff)
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null then
      format('"%s"', v_node)
      || coalesce(' ' || public.notify_range((p_model ->> 'startDate')::date, (p_model ->> 'endDate')::date, v_today), '')
    when p_kind = 'ROUND_SCHEDULE_CHANGED' and p_node is not null then
      case when v_label is not null and v_label is distinct from v_node then format('%s "%s"', v_label, v_node) else coalesce(v_label, format('"%s"', v_node)) end
      || coalesce(' ' || v_diff, '')
      -- 0026: 과제와 개인 목표를 나눠 말한다(옛 모델 'moved' 만 있으면 0024 문구)
      || case
           when p_model ? 'movedTasks' then
             case when coalesce((p_model ->> 'movedTasks')::int, 0) + coalesce((p_model ->> 'movedPersonal')::int, 0) = 0 then ''
                  else ' · ' || concat_ws('·',
                         case when (p_model ->> 'movedTasks')::int > 0 then format('과제 %s개', p_model ->> 'movedTasks') end,
                         case when (p_model ->> 'movedPersonal')::int > 0 then format('개인 목표 %s개', p_model ->> 'movedPersonal') end)
                       || '도 함께 옮겼어요' end
           when coalesce((p_model ->> 'moved')::int, 0) > 0 then format(' · 과제 %s개도 함께 옮겼어요', p_model ->> 'moved')
           else '' end
    when p_kind = 'JOIN_REQUESTED'  then nullif(p_model ->> 'message', '')
    when p_kind = 'LEAVE_REQUESTED' then nullif(p_model ->> 'reason', '')
    when p_kind = 'ROOM_ARCHIVED'   then '내 스터디의 보관함에서 다시 볼 수 있어요'
    when p_kind = 'SUBMISSION_DIGEST' and p_node is not null then
      case when v_tasks <= 1 then format('"%s"', v_node) else format('"%s" 외 과제 %s개', v_node, v_tasks - 1) end
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

-- notify_link (0024 + SCHEDULE_CHANGED 딥링크)
create or replace function public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_node is not null and p_kind in ('TASK_ALL_SUBMITTED', 'SUBMISSION_DIGEST')
      then '/my-study/' || r.slug || '?task=' || p_node || '#submissions'
    when p_node is not null and p_kind in ('DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'PERSONAL_ARCHIVED')
      then '/my-study/' || r.slug || '?task=' || p_node
    -- 0028: 일정 변경 — 과제면 리프 포커스, 묶음(유형 없음)이면 진행목표 보기 상세
    when p_node is not null and p_kind = 'SCHEDULE_CHANGED'
      then '/my-study/' || r.slug || coalesce('?task=' || (select g.id from public.goal_nodes g where g.id = p_node and g.task_type is not null),
                                              '?tab=curriculum&item=' || p_node)
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
