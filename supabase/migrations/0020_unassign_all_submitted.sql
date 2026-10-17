-- 0020_unassign_all_submitted.sql — 담당 해제로 전원 제출이 된 과제의 완료 알림. 배포 후 수정 금지. 추가형(함수 교체만, 스키마·데이터 변경 없음).
-- 담당자 해제(node_update 의 assigneeIds 변경 → 이어지는 assignment_resync)로 남은 담당자 전원이 이미 제출한 상태가 되면
-- 전원 제출 알림이 없었다. member_deactivate 경로(0013 즉시·0018 하루 요약)와 같은 규칙을 담당 해제 경로에도 넣는다.
--   IMMEDIATE    : node_update 가 저장 전·후 room_leaf_stats 를 비교해 TASK_ALL_SUBMITTED(자연 키 'TASK_ALL_SUBMITTED:room:node' → 이미 나간 과제는 다시 안 나감)
--   DAILY_DIGEST : job_completion_digest 의 완료 시각에 미제출 담당자의 해제 시각(멤버 상태 무관)을 넣는다
--   개인 목표(PERSONAL)는 대상이 아니다: node_get 이 거부하고(0014), room_leaf_stats·task_assignments 에 없다.
-- 진행 중 방의 다른 assignment_resync 호출부는 미제출 담당자를 남긴 채 전원 제출을 만들 수 없다
--   (leaderDoesTasks 는 진행 중 FIELD_LOCKED, 참가 취소는 모집 중만, 유형 전환은 제출물이 있으면 불가, 보관 리프는 집계에서 빠짐) → node_update 만 고친다.
-- 재정의 함수는 최신 정의를 복사해 고친 것이다(0013 node_update, 0018 job_completion_digest — 0014~0019 에 다른 재정의 없음).
-- 시그니처 동일 → GRANT 유지, 새 GRANT 없음.

-- ───────── 1. 즉시 모드 (0013 node_update) ─────────
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

-- ───────── 2. 하루 요약 모드 (0018 job_completion_digest) ─────────
-- "어제 전원 제출이 된 과제"의 완료 시각 = greatest(마지막 제출, 미제출 담당자가 풀린 마지막 시각). IMMEDIATE 방은 위 node_update·
-- 0013 member_deactivate 가 즉시 알리고 여기서는 빠진다(기존 조건)
create or replace function public.job_completion_digest() returns int
language plpgsql security definer set search_path = '' as $$
declare v_today date := public.kst_today(); r record; v_n int := 0;
begin
  for r in
    select rm.id, rm.leader_id, count(*)::int as cnt
    from public.rooms rm
    left join public.room_notification_settings st on st.room_id = rm.id
    join lateral (
      select n.id
      from public.goal_nodes n
      join public.task_assignments a on a.node_id = n.id and a.released_at is null
      left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
      where n.room_id = rm.id and n.task_type is not null and n.archived_at is null
      group by n.id
      having count(a.id) > 0 and count(s.id) = count(a.id)
         -- 0020: 전원 제출이 된 순간 = 마지막 제출, 또는 그보다 늦게 미제출 담당자가 빠진 순간(그 released_at).
         --   빠지는 경로: 이탈(member_deactivate → INACTIVE, 0018)·담당 해제(node_update assigneeIds·assignment_resync, 0020) — 둘 다 같은 규칙.
         --   0018 은 INACTIVE 멤버의 released 행만 봤다: 그 행 중 이탈 전에 담당 해제로 이미 풀린 것은 released_at 이 해제 시각이라
         --   이탈일로 세지 않았고(이중·오집계는 없음), 이탈하지 않은 사람의 담당 해제는 아예 놓쳤다 → 0020 은 멤버 상태를 가리지 않는다.
         --   제출하고 풀린 사람(시드 도윤)은 완료 시각을 바꾸지 않는다(not exists 제출). 보관으로 풀린 행은 n.archived_at 조건으로 이미 빠진다.
         --   다시 배정되면 released_at 이 null 로 돌아가 여기서 빠진다. 개인 목표는 task_assignments 행이 없어 count(a.id) > 0 에서 빠진다
         and (greatest(max(s.first_submitted_at),
                       (select max(x.released_at) from public.task_assignments x
                        where x.node_id = n.id and x.released_at is not null
                          and not exists (select 1 from public.submissions s2 where s2.node_id = n.id and s2.user_id = x.user_id)))
              at time zone 'Asia/Seoul')::date = v_today - 1) done on true
    where rm.status = 'ACTIVE' and rm.archived_at is null and coalesce(st.completion_mode, 'DAILY_DIGEST') = 'DAILY_DIGEST'
    group by rm.id, rm.leader_id order by rm.id
  loop
    v_n := v_n + public.notify_publish('TASK_COMPLETION_DIGEST', r.id, null, null, array[r.leader_id],
                                       'TASK_COMPLETION_DIGEST:' || r.id || ':' || to_char(v_today, 'YYYY-MM-DD'),
                                       jsonb_build_object('count', r.cnt));
  end loop;
  return v_n;
end $$;
