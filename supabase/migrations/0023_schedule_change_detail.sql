-- 0023_schedule_change_detail.sql — 일정 변경 알림 본문에 "무엇이 어떻게 바뀌었는지". 배포 후 수정 금지. 추가형(함수 교체만, 스키마·데이터 변경 없음).
-- 과제 일정 변경(SCHEDULE_CHANGED) 본문이 새 기간만 말했다('"과제" 10.13 – 10.19') → 바뀐 쪽의 옛 → 새:
--   마감만 '"과제" 마감 10.21 → 10.24' · 시작만 '"과제" 시작 10.13 → 10.15' · 둘 다 '"과제" 기간 10.13 – 10.21 → 10.15 – 10.24'
--   네 날짜가 같은 해면 MM.DD, 해를 넘기면 YY.MM.DD(0018 방 기간 변경과 같은 규칙). 제목('{방} 일정이 변경됐어요')은 그대로.
-- 방 기간 변경(ROOM_PERIOD_CHANGED)은 0018 부터 이미 '옛 기간 → 새 기간' — 손대지 않는다(아래 notify_render 에 그대로 옮김).
-- 회차(비 리프) 일정 변경은 알림을 내지 않는다(node_update 는 과제 유형이 있는 노드만 알린다) — 이번 범위 밖.
-- 이미 쌓인 알림 행은 그대로 둔다: notifications 는 렌더된 title·body 만 저장하고 모델(옛 날짜)을 남기지 않아
--   옛 기간을 되살릴 수 없다(현재 노드 날짜는 그 뒤 또 바뀌었을 수 있다). 거짓 '옛 → 새'를 쓰느니 원래 본문(새 기간)을 유지한다.
-- 재정의 함수는 최신 정의를 복사해 고친 것이다(node_update ← 0020, notify_render ← 0018 — 0021·0022 에 재정의 없음).
-- 시그니처 동일 → GRANT 유지, 새 GRANT 없음.

-- ───────── 1. node_update (0020) — SCHEDULE_CHANGED 모델에 옛 기간 ─────────
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
          jsonb_build_object('title', v_title, 'startDate', to_char(v_s, 'YYYY-MM-DD'), 'endDate', to_char(v_e, 'YYYY-MM-DD'),
                             -- 0023: 본문이 옛 날짜 → 새 날짜를 말하도록 저장 전 기간을 함께 넘긴다
                             'oldStartDate', to_char(n.start_date, 'YYYY-MM-DD'), 'oldEndDate', to_char(n.end_date, 'YYYY-MM-DD')));
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

  -- 전원 제출 (0020): 담당 해제(이 함수의 released + 이어지는 assignment_resync 의 해제)로 남은 담당자 전원이 제출한 상태가 됐다
  -- → member_deactivate(0013 6단계)와 같은 규칙: IMMEDIATE 만 지금, submission_upsert 와 같은 자연 키(이미 나간 과제는 dedupe 로 다시 안 나감),
  -- 상태 이벤트라 actor 는 null(편집자가 그룹장이어도 그룹장이 받는다). DAILY_DIGEST 는 job_completion_digest(0020)가 해제 시각으로 센다
  if v_open
     and (select coalesce(completion_mode, 'DAILY_DIGEST') from public.room_notification_settings where room_id = r.id) = 'IMMEDIATE'
     and exists (select 1 from public.room_leaf_stats(r.id) ls where ls.node_id = n.id and ls.asg > 0 and ls.sub = ls.asg) then
    perform public.notify_publish('TASK_ALL_SUBMITTED', r.id, n.id, null, array[r.leader_id],
                                  'TASK_ALL_SUBMITTED:' || r.id || ':' || n.id, '{}'::jsonb);
  end if;

  -- 태그 자동 선택 (0013): 노드 제목이 실제로 바뀌었고, 옛 제목이나 새 제목이 CURATED 용어를 담을 때만.
  -- 점수에 쓰이는 건 노드 제목뿐(설명은 안 쓴다)이라 용어 없는 제목끼리의 변경은 결과를 바꿀 수 없다 — 무관한 저장이
  -- 시드·수동 정리와 어긋난 AUTO 태그를 다시 뒤섞지 않게 한다(QA Q3-22). MANUAL·억제 규칙은 tag_apply_auto 가 그대로 지킨다
  if p_patch ? 'title' and v_title is distinct from n.title
     and (public.tag_text_relevant(n.title) or public.tag_text_relevant(v_title)) then
    perform public.tag_autoselect(r.id);
  end if;

  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('warnings', v_warn);
end $$;

-- ───────── 2. notify_render (0018) — SCHEDULE_CHANGED 본문에 옛 → 새 ─────────
create or replace function public.notify_render(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_model jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_room  text;
  v_node  text;
  v_label text;
  v_actor text;
  v_title text;
  v_body  text;
  v_fmt   text;
  v_os    date;   -- 0023 SCHEDULE_CHANGED: 옛 시작·마감, 새 시작·마감
  v_oe    date;
  v_ns    date;
  v_ne    date;
  v_diff  text;
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
  end;
  -- 본문(0013): 방 제목은 프론트가 메타 줄에 따로 그리므로 본문에 넣지 않는다(QA Q1-14). 제목에 없는 정보만 —
  -- 회차 시작은 회차 제목(라벨과 다를 때), 일정 변경은 과제와 새 기간. 나머지 과제 알림은 제목이 이미 과제를 말한다
  -- 기간 변경(0018): '옛 기간 → 새 기간'. 네 날짜가 같은 해면 MM.DD, 해를 넘기면 YY.MM.DD
  if p_kind in ('ROOM_PERIOD_CHANGED', 'SCHEDULE_CHANGED') then
    v_fmt := case when (select count(distinct left(x, 4)) from unnest(array[p_model ->> 'oldStartDate', p_model ->> 'oldEndDate',
                                                                          p_model ->> 'startDate', p_model ->> 'endDate']) x where x is not null) <= 1
                  then 'MM.DD' else 'YY.MM.DD' end;
  end if;
  -- 일정 변경(0023): 바뀐 쪽만 — 마감만 '마감 옛 → 새', 시작만 '시작 옛 → 새', 둘 다 '기간 옛 – 옛 → 새 – 새'.
  -- 옛 날짜가 없는 모델(0023 이전 호출·옛 날짜가 비어 있던 과제)은 v_diff 가 null → 아래에서 0013 형식(새 기간만)으로
  if p_kind = 'SCHEDULE_CHANGED' then
    v_os := (p_model ->> 'oldStartDate')::date;
    v_oe := (p_model ->> 'oldEndDate')::date;
    v_ns := (p_model ->> 'startDate')::date;
    v_ne := (p_model ->> 'endDate')::date;
    v_diff := case
      when v_os is not distinct from v_ns and v_oe is distinct from v_ne then '마감 ' || to_char(v_oe, v_fmt) || ' → ' || to_char(v_ne, v_fmt)
      when v_oe is not distinct from v_ne and v_os is distinct from v_ns then '시작 ' || to_char(v_os, v_fmt) || ' → ' || to_char(v_ns, v_fmt)
      else '기간 ' || to_char(v_os, v_fmt) || ' – ' || to_char(v_oe, v_fmt) || ' → ' || to_char(v_ns, v_fmt) || ' – ' || to_char(v_ne, v_fmt)
    end;
  end if;
  v_body := case
    when p_kind = 'ROOM_PERIOD_CHANGED' then
      coalesce(to_char((p_model ->> 'oldStartDate')::date, v_fmt) || ' – ' || to_char((p_model ->> 'oldEndDate')::date, v_fmt) || ' → ', '')
      || to_char((p_model ->> 'startDate')::date, v_fmt) || ' – ' || to_char((p_model ->> 'endDate')::date, v_fmt)
    when p_kind = 'ROUND_STARTED' and v_label is not null and v_node is distinct from v_label then v_node
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null and v_diff is not null then
      format('"%s" %s', v_node, v_diff)
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null then
      format('"%s"', v_node)
      || coalesce(' ' || to_char((p_model ->> 'startDate')::date, 'MM.DD') || ' – ' || to_char((p_model ->> 'endDate')::date, 'MM.DD'), '')
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;
