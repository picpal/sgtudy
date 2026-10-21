-- 0039_room_public_active.sql — 2026-10-21 진행중(ACTIVE) 방도 공개/비공개(isPublic)를 바꿀 수 있게. 배포 후 수정 금지.
-- 바뀐 것: room_update 의 active 잠금 목록에서 'isPublic' 만 뺀다. 종료(ended)는 그대로 잠김, 준비중·모집중은 변화 없음.
-- 부수 효과 점검: 공개 목록(room_in_scope public)·RLS(0003)·참가 관문(room_join_precheck 0032: PRIVATE 면 초대 토큰 필수)·
--   추가 모집 노출은 모두 rooms.visibility 를 그때그때 읽는다 — 파생 저장값이 없어 갱신할 것이 없다.
--   이미 참가한 사람·대기중 신청은 그대로(공개 전환은 새 참가 경로만 바꾼다). 공개 전환 알림은 없다.
-- 재정의(최신 판 복사): room_update ← 0018 (0019~0038 재정의 없음). 시그니처 동일 → GRANT 유지, 새 GRANT 없음.

create or replace function public.room_update(p_slug text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_today  date := public.kst_today();
  r        public.rooms;
  v_phase  text;                 -- recruit(DRAFT·RECRUIT) | active | ended
  v_locked text[];
  k        text;
  v_title  text;
  v_intro  text;
  v_start  date;
  v_end    date;
  v_max    int;
  v_min    int;
  v_ldt    boolean;
  v_pub    boolean;
  v_node_max_end date;
  v_warn   jsonb := '[]'::jsonb;
  v_rcpt   uuid[];
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.archived_at is not null then perform public.fail('ROOM_NOT_EDITABLE', '보관된 방은 수정할 수 없어요'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요');
  end if;

  v_phase := case when r.status in ('DRAFT', 'RECRUIT') then 'recruit' when r.status = 'ACTIVE' then 'active' else 'ended' end;
  v_locked := case v_phase
    when 'recruit' then array['slug']
    when 'active'  then array['slug', 'startDate', 'minMembers', 'joinMode', 'leaderDoesTasks']  -- 0039: isPublic 풀림
    else array['slug', 'title', 'intro', 'descriptionMd', 'rulesMd', 'coverFileId', 'startDate', 'endDate',
               'maxMembers', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks'] end;

  for k in select jsonb_object_keys(p_patch) loop
    if k = any(v_locked) then
      perform public.fail('FIELD_LOCKED', '지금 상태에서는 바꿀 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
    if k not in ('title', 'intro', 'descriptionMd', 'rulesMd', 'coverFileId', 'startDate', 'endDate',
                 'maxMembers', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;

  v_title := case when p_patch ? 'title' then trim(coalesce(p_patch->>'title', '')) else r.title end;
  v_intro := case when p_patch ? 'intro' then trim(coalesce(p_patch->>'intro', '')) else r.intro end;
  v_start := coalesce(public.patch_date(p_patch, 'startDate'), r.start_date);
  v_end   := coalesce(public.patch_date(p_patch, 'endDate'), r.end_date);
  v_max   := coalesce(public.patch_int(p_patch, 'maxMembers'), r.max_members);
  v_min   := case when p_patch ? 'minMembers' then public.patch_int(p_patch, 'minMembers') else r.min_members end;
  v_ldt   := coalesce(public.patch_bool(p_patch, 'leaderDoesTasks'), r.leader_does_tasks);
  v_pub   := coalesce(public.patch_bool(p_patch, 'isPublic'), r.visibility = 'PUBLIC');

  if length(v_title) < 1 or length(v_title) > 60 then
    perform public.fail('INVALID_TITLE', '제목은 1~60자예요', '{"field":"title"}'::jsonb);
  end if;
  if length(v_intro) < 1 or length(v_intro) > 100 then
    perform public.fail('VALIDATION_FAILED', '한 줄 소개는 1~100자예요', '{"field":"intro"}'::jsonb);
  end if;
  if p_patch ? 'startDate' and v_start < v_today then
    perform public.fail('INVALID_PERIOD', '시작일은 오늘 이후여야 해요', '{"field":"startDate"}'::jsonb);
  end if;
  if v_start > v_end then
    perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb);
  end if;
  -- 기간 상한(0013): 기간을 고칠 때만 본다 — 0013 이전에 만든 긴 방은 다른 항목을 고칠 수 있어야 한다
  if p_patch ? 'startDate' or p_patch ? 'endDate' then
    perform public.room_period_check(v_start, v_end);
  end if;
  if v_phase = 'active' and p_patch ? 'endDate' then
    select max(n.end_date) into v_node_max_end from public.goal_nodes n where n.room_id = r.id and n.archived_at is null;
    if v_end < v_today or (v_node_max_end is not null and v_end < v_node_max_end) then
      perform public.fail('INVALID_PERIOD', '진행중에는 종료일을 오늘과 마지막 과제 마감 이후로만 바꿀 수 있어요', '{"field":"endDate"}'::jsonb);
    end if;
  end if;
  if v_max < 2 or v_max > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  if v_max < r.member_count then
    perform public.fail('CAPACITY_BELOW_CURRENT', '현재 참가자 수보다 적게 줄일 수 없어요', jsonb_build_object('field', 'maxMembers', 'memberCount', r.member_count));
  end if;
  if v_min is not null and (v_min < 1 or v_min > v_max) then
    perform public.fail('VALIDATION_FAILED', '최소 인원은 1~정원 사이예요', '{"field":"minMembers"}'::jsonb);
  end if;
  if p_patch ? 'joinMode' and coalesce(p_patch->>'joinMode', '') not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;
  -- 커버는 내가 올린 COVER 용 파일만 (A8). 텍스트로 비교해 uuid 캐스트 오류(22P02)를 피한다. null 은 커버 제거
  if p_patch ? 'coverFileId' and jsonb_typeof(p_patch->'coverFileId') <> 'null' and not exists (
       select 1 from public.files f
       where f.id::text = p_patch->>'coverFileId' and f.owner_user_id = v_uid and f.purpose = 'COVER') then
    perform public.fail('VALIDATION_FAILED', '커버 이미지를 찾을 수 없어요', '{"field":"coverFileId"}'::jsonb);
  end if;

  update public.rooms set
    title = v_title, intro = v_intro,
    description_md = coalesce(p_patch->>'descriptionMd', description_md),
    rules_md       = coalesce(p_patch->>'rulesMd', rules_md),
    cover_file_id  = case when p_patch ? 'coverFileId' then (p_patch->>'coverFileId')::uuid else cover_file_id end,
    start_date = v_start, end_date = v_end, max_members = v_max, min_members = v_min,
    visibility = case when v_pub then 'PUBLIC' else 'PRIVATE' end,
    join_mode  = case when p_patch ? 'joinMode' then upper(p_patch->>'joinMode') else join_mode end,
    leader_does_tasks = v_ldt, updated_at = now()
  where id = r.id;

  if v_ldt <> r.leader_does_tasks then perform public.assignment_resync(r.id); end if;

  -- 기간 변경 알림(0018): 시작일·종료일이 실제로 바뀌면 ACTIVE 참가자에게. 그룹장(행위자)은 notify_publish 가 뺀다.
  -- 행위 이벤트 → prefix 에 txid(SCHEDULE_CHANGED 와 같은 규칙: 저장 1번 = 알림 1건, 같은 방을 다시 고치면 새 알림)
  if (v_start, v_end) is distinct from (r.start_date, r.end_date) then
    select coalesce(array_agg(m.user_id), '{}') into v_rcpt
    from public.room_members m where m.room_id = r.id and m.status = 'ACTIVE';
    perform public.notify_publish('ROOM_PERIOD_CHANGED', r.id, null, v_uid, v_rcpt,
      'ROOM_PERIOD_CHANGED:' || r.id || ':' || txid_current(),
      jsonb_build_object('oldStartDate', to_char(r.start_date, 'YYYY-MM-DD'), 'oldEndDate', to_char(r.end_date, 'YYYY-MM-DD'),
                         'startDate', to_char(v_start, 'YYYY-MM-DD'), 'endDate', to_char(v_end, 'YYYY-MM-DD')));
  end if;

  -- 방 기간 밖으로 나간 노드(보관 제외)는 경고 (D9)
  if p_patch ? 'startDate' or p_patch ? 'endDate' then
    select coalesce(jsonb_agg(jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', n.id::text) order by n.id), '[]'::jsonb)
    into v_warn
    from public.goal_nodes n
    where n.room_id = r.id and n.archived_at is null and (n.start_date < v_start or n.end_date > v_end);
  end if;

  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn);
end $$;
