-- 0027_deactivate_unassign.sql — 내보내기(member_deactivate)가 막히지 않게: 결정 action 'unassign'(담당 미정으로 두기). 배포 후 수정 금지. 함수 교체만.
-- 오케스트레이터 결정(2026-10-19). 기존 decisions 형식 [{nodeId, action, assigneeIds?}] 에 action 하나를 더한다:
--   exclude  — 이 사람만 뺀다. 다른 담당자가 없으면 REASSIGN_REQUIRED(기존)
--   reassign — assigneeIds 로 재지정(기존)
--   unassign — 이 사람만 빼고 재지정하지 않는다. 담당이 0명이 돼도 허용(담당 미정 지정 과제). assigneeIds 를 주면 VALIDATION_FAILED
-- 담당 0명 과제는 기존 규칙 그대로 처리된다: room_progress asg 0 · room_leaf_stats 전원 제출 판정은 asg > 0 조건(0013 6단계·0020)이라 TASK_ALL_SUBMITTED 없음 ·
--   job_completion_digest 는 count(a.id) > 0(0018/0020) · RoomDetail.stats.unassignedCount / curriculum stats.unassignedCount 가 이미 세고 node_update 는 UNASSIGNED_TASK 경고.
--   → 그룹장 안내용 새 필드는 만들지 않는다(기존 unassignedCount 사용).
-- 재정의: member_deactivate ← 0013(이후 재정의 없음 — 0018·0020 은 주석으로만 참조). 시그니처 동일 → GRANT 유지. member_deactivate_preview(0008) 그대로.

create or replace function public.member_deactivate(p_slug text, p_user uuid, p_decisions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  r        public.rooms;
  p        record;
  d        jsonb;
  v_action text;
  v_new    uuid[];
  v_adds   uuid[];
  v_id     uuid;
  v_bad    boolean;
  v_plan   jsonb := '[]'::jsonb;    -- [{nodeId, adds: uuid[]}]
  v_item   jsonb;
  v_open   bigint[];               -- 0013: 이탈 전 아직 전원 제출이 아닌 과제
  v_node   bigint;
begin
  r := public.deactivate_check(p_slug, p_user, true);
  if jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' then
    perform public.fail('VALIDATION_FAILED', 'decisions 는 배열이어야 해요', '{"field":"decisions"}'::jsonb);
  end if;

  -- 1. 검증
  for p in select * from public.deactivate_pending(r.id, p_user) loop
    d := null;
    select e into d from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) e where e ->> 'nodeId' = p.node_id::text limit 1;
    if d is null then
      perform public.fail('LEAVE_DECISION_MISSING', '미제출 지정 과제마다 처리 방법을 정해 주세요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    v_action := d ->> 'action';
    if v_action is null then          -- null 이면 `not in` 이 null 이 되어 통과해 버린다 → 결정 없음으로 본다
      perform public.fail('LEAVE_DECISION_MISSING', '미제출 지정 과제마다 처리 방법을 정해 주세요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    if v_action not in ('exclude', 'reassign', 'unassign') then
      perform public.fail('VALIDATION_FAILED', 'action 은 exclude·reassign·unassign 중 하나예요', jsonb_build_object('field', 'action', 'nodeId', p.node_id::text));
    end if;
    -- 0027: unassign 은 재지정 없이 빼기만 — assigneeIds 를 같이 주면 뜻이 섞이므로 거부
    if v_action = 'unassign' and coalesce(jsonb_array_length(case when jsonb_typeof(d -> 'assigneeIds') = 'array' then d -> 'assigneeIds' end), 0) > 0 then
      perform public.fail('VALIDATION_FAILED', '담당 미정으로 둘 때는 새 담당자를 고를 수 없어요', jsonb_build_object('field', 'assigneeIds', 'nodeId', p.node_id::text));
    end if;
    v_new := '{}'::uuid[];
    if v_action = 'reassign' then
      -- B9: assigneeIds 는 문자열 uuid 배열이어야 한다. 비문자열·잘못된 uuid 가 raw 22P02 로 새지 않게 한다
      v_bad := jsonb_typeof(coalesce(d -> 'assigneeIds', '[]'::jsonb)) <> 'array';
      if not v_bad then
        v_bad := exists (select 1 from jsonb_array_elements(coalesce(d -> 'assigneeIds', '[]'::jsonb)) x where jsonb_typeof(x) <> 'string');
      end if;
      if not v_bad then
        begin
          select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_new
          from jsonb_array_elements_text(coalesce(d -> 'assigneeIds', '[]'::jsonb)) x;
        exception when invalid_text_representation then
          v_bad := true;
        end;
      end if;
      if v_bad then
        perform public.fail('VALIDATION_FAILED', 'assigneeIds 는 uuid 문자열 배열이어야 해요', jsonb_build_object('field', 'assigneeIds', 'nodeId', p.node_id::text));
      end if;
      foreach v_id in array v_new loop
        if v_id = p_user or not exists (
             select 1 from public.room_members m
             where m.room_id = r.id and m.user_id = v_id and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks)) then
          perform public.fail('ASSIGNEE_NOT_MEMBER', '활성 참가자에게만 재지정할 수 있어요', jsonb_build_object('nodeId', p.node_id::text, 'userId', v_id::text));
        end if;
      end loop;
    end if;
    v_adds := array(select unnest(v_new) except select unnest(p.others));
    -- 0027: unassign 이면 담당 0명(담당 미정)도 허용 — 내보내기가 넘길 사람이 없어 막히지 않게. 진척·전원 제출은 asg 0 을 기존 규칙대로 뺀다
    if v_action <> 'unassign' and cardinality(p.others) + cardinality(v_adds) = 0 then
      perform public.fail('REASSIGN_REQUIRED', '담당자가 0명이 되는 과제는 다른 참가자에게 재지정해야 해요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    v_plan := v_plan || jsonb_build_object('nodeId', p.node_id::text, 'adds', to_jsonb(v_adds));
  end loop;

  select coalesce(array_agg(ls.node_id), '{}') into v_open
  from public.room_leaf_stats(r.id) ls where ls.sub < ls.asg;

  -- 2. 대상 해제 + 상태 전환 + 정원
  update public.task_assignments a set released_at = now()
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = r.id and a.user_id = p_user and a.released_at is null;
  update public.room_members
     set status = 'INACTIVE', left_at = now(), decided_at = now(), decided_by = v_uid, updated_at = now()
   where room_id = r.id and user_id = p_user;
  perform public.room_release_seat(r.id);

  -- 3. 재지정
  for v_item in select e from jsonb_array_elements(v_plan) e loop
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_adds from jsonb_array_elements_text(v_item -> 'adds') x;
    if cardinality(v_adds) > 0 then
      insert into public.task_assignments (node_id, user_id, source)
      select (v_item ->> 'nodeId')::bigint, u, 'DESIGNATED' from unnest(v_adds) u
      on conflict (node_id, user_id) do update set released_at = null, source = 'DESIGNATED', assigned_at = now();
      -- A6: 호출부가 txid 를 붙인다(E1) — 없으면 키가 영구라 같은 사람의 이후 재지정이 dedupe 로 사라진다
      perform public.notify_publish('TASK_ASSIGNED', r.id, (v_item ->> 'nodeId')::bigint, v_uid, v_adds,
                                    'TASK_ASSIGNED:' || r.id || ':' || (v_item ->> 'nodeId') || ':' || txid_current(), '{}'::jsonb);
    end if;
  end loop;

  -- 4·5
  perform public.assignment_resync(r.id);
  perform public.notify_publish('MEMBER_DEACTIVATED', r.id, null, v_uid, array[p_user],
                                'MEMBER_DEACTIVATED:' || r.id || ':' || p_user, '{}'::jsonb);
  -- 6 (0013). 이탈로 남은 담당자 전원이 제출한 상태가 된 과제 → submission_upsert 와 같은 TASK_ALL_SUBMITTED(IMMEDIATE 만, 같은 dedupe 키).
  -- 행위자는 그룹장 자신이지만 상태 이벤트라 actor 는 null(그룹장이 수신자라 빠지면 안 된다)
  if (select coalesce(completion_mode, 'DAILY_DIGEST') from public.room_notification_settings where room_id = r.id) = 'IMMEDIATE' then
    for v_node in
      select ls.node_id from public.room_leaf_stats(r.id) ls
      where ls.node_id = any(v_open) and ls.asg > 0 and ls.sub = ls.asg order by ls.node_id
    loop
      perform public.notify_publish('TASK_ALL_SUBMITTED', r.id, v_node, null, array[r.leader_id],
                                    'TASK_ALL_SUBMITTED:' || r.id || ':' || v_node, '{}'::jsonb);
    end loop;
  end if;
  return public.membership_result(r.id, v_uid);
end $$;
