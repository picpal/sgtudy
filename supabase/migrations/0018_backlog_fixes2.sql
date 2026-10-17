-- 0018_backlog_fixes2.sql — 0013 이후 남은 DB 백로그 4건. 배포 후 수정 금지. 추가형(함수 교체만, 스키마·데이터 변경 없음).
-- 1. 요약(DAILY_DIGEST) 모드: member_deactivate 로 전원 제출이 된 과제를 다음 날 TASK_COMPLETION_DIGEST 가 센다
--    (0013 은 IMMEDIATE 만 즉시 알림. 요약 모드는 job_completion_digest 가 "마지막 제출일"만 봐서 놓쳤다)
-- 2. node_delete / node_archive / node_unarchive 후 tag_autoselect — node_update(0013)와 같은 가드: 영향받는 팀 노드 제목이 CURATED 용어를 담을 때만
-- 3. tag_term_hit: 한글로 끝나는 용어도 뒤쪽 경계 — 뒤에 한글 음절이 이어지면 불일치. 단 흔한 조사(0~2개 연속)와 학습 명사 접미(문제·스터디·기초…)는 일치
-- 4. room_update 로 시작일·종료일이 실제로 바뀌면 ACTIVE 참가자에게 ROOM_PERIOD_CHANGED (새 kind. 방 설정 schedule_changed 를 따른다)
-- 재정의 함수는 각 함수의 최신 정의를 복사해 고친 것이다(0006 node_delete·archive·unarchive, 0008 notify_enabled·job_completion_digest,
-- 0012 notification_kinds, 0013 tag_term_hit·notify_render·room_update). 시그니처 동일 → GRANT 유지, 새 GRANT 없음.

-- ───────── 3. 태그 용어 일치 (0013 tag_term_hit 교체) ─────────
-- 2자 영숫자: 앞뒤 경계(0009). 한글로 끝나는 용어(0018): 뒤에 ① 끝·한글 아닌 글자 ② 조사 0~2개 뒤 끝·한글 아닌 글자 ③ 학습 명사 접미 중 하나.
--   '자바' ⊄ '자바스크립트'·'데이터' ⊄ '데이터베이스'·'서버' ⊄ '서버리스' 는 막고, '자바로'·'자바에서는'·'1문제씩'·'기출문제'·'스프링부트'·'영어회화' 는 맞힌다.
--   조사를 일치로 보는 근거: 제목·소개는 "자바로 배우는 …", "자바의 정석"처럼 용어 뒤에 조사를 붙여 쓰는 게 기본형이다 — 조사를 막으면 누락이 오탐보다 훨씬 많다.
--   조사 뒤에 다시 한글이 이어지면(자바도구) 조사가 아니라 다른 낱말이므로 불일치. 남는 한계: 목록에 없는 복합어(면접관·토익스피킹)는 놓친다 — 점수용이라 누락이 오탐보다 낫다.
-- 순수 ASCII 3자 이상: 뒤쪽 경계만(0013). 영숫자로 끝나는 혼합 용어('lc·rc'): ASCII 와 같은 뒤쪽 경계(0018). 그 밖: 부분 일치
create or replace function public.tag_term_hit(p_text text, p_term text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_text is null or length(trim(coalesce(p_term, ''))) < 2 then false
    when length(trim(p_term)) = 2 and trim(p_term) ~ '^[A-Za-z0-9]+$'
      then lower(p_text) ~ ('(^|[^a-z0-9])' || lower(trim(p_term)) || '($|[^a-z0-9])')
    when trim(p_term) ~ '[가-힣]$'
      then lower(p_text) ~ (regexp_replace(lower(trim(p_term)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
        || '(('
        || '은|는|이|가|을|를|의|에|에서|에게|께|로|으로|와|과|도|만|까지|부터|랑|이랑|하고|처럼|보다|나|이나|씩|마다|만큼|뿐'
        || '|요|야|이야|이다|입니다|예요|이에요|란|이란|라는|이라는|든|이든|라도|이라도|조차|마저'
        || '){0,2}($|[^가-힣])'
        || '|문제|풀이|기초|입문|심화|실습|정리|공부|스터디|강의|강좌|개념|복습|예습|준비|대비|실전|핵심|완주|완성|특강|챌린지'
        || '|과제|프로젝트|개발|시험|회화|부트|기본|응용|활용|독학|모임|퀴즈|발표|후기|분석|모델링|설계|면접|자격증)')
    when trim(p_term) ~ '^[ -~]+$'
      then lower(p_text) ~ (regexp_replace(lower(trim(p_term)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^a-z0-9])')
    when lower(trim(p_term)) ~ '[a-z0-9]$'
      then lower(p_text) ~ (regexp_replace(lower(trim(p_term)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^a-z0-9])')
    else position(lower(trim(p_term)) in lower(p_text)) > 0
  end
$$;

-- ───────── 2. 삭제·보관·해제 후 자동 태그 (0006 node_delete·node_archive·node_unarchive) ─────────
-- 점수에 쓰이는 건 팀 노드 제목(개인 목표 제외, 0014 tag_autoselect)뿐이라, 사라지거나 되살아나는 팀 노드 제목에 CURATED 용어가 없으면
-- 결과가 바뀔 수 없다 → 그때는 돌리지 않는다(무관한 조작이 수동 정리와 어긋난 AUTO 를 다시 뒤섞지 않게, 0013 node_update 와 같은 규칙).
-- 판정은 변경 전 서브트리로 한다(삭제 후에는 제목이 없다). MANUAL·억제는 tag_apply_auto 가 지킨다
create or replace function public.node_delete(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid; v_tag boolean;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if public.node_has_submissions(n.id) then
    perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 항목은 삭제할 수 없어요. 보관해 주세요', jsonb_build_object('nodeId', n.id::text));
  end if;
  v_tag := exists (select 1 from public.goal_nodes g where g.id in (select public.node_subtree(n.id))
                    and g.archived_at is null and g.task_type is distinct from 'PERSONAL' and public.tag_text_relevant(g.title));
  -- 서브트리를 한 문장으로 지운다: round_id FK(NO ACTION)가 parent_id cascade 의 중첩 문장에서 먼저 걸리기 때문. 배정은 node_id cascade
  delete from public.goal_nodes where id in (select public.node_subtree(n.id));
  perform public.node_renumber(r.id, n.parent_id);
  perform public.assignment_resync(r.id);
  if v_tag then perform public.tag_autoselect(r.id); end if;   -- 0018
  return public.curriculum_json(r.id, v_uid, true);
end $$;

create or replace function public.node_archive(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid; v_tag boolean;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  v_tag := exists (select 1 from public.goal_nodes g where g.id in (select public.node_subtree(n.id))
                    and g.archived_at is null and g.task_type is distinct from 'PERSONAL' and public.tag_text_relevant(g.title));
  update public.goal_nodes set archived_at = now(), updated_at = now()
  where id in (select public.node_subtree(n.id)) and archived_at is null;
  perform public.assignment_resync(r.id);                  -- 보관 리프의 COMMON·DESIGNATED 행 released (released_at = archived_at, D13)
  if v_tag then perform public.tag_autoselect(r.id); end if;   -- 0018
  return public.curriculum_json(r.id, v_uid, true);
end $$;

create or replace function public.node_unarchive(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n public.goal_nodes; v_uid uuid; v_tag boolean;
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
  v_tag := exists (select 1 from public.goal_nodes g where g.id in (select public.node_subtree(n.id))
                    and g.archived_at is not null and g.task_type is distinct from 'PERSONAL' and public.tag_text_relevant(g.title));
  update public.goal_nodes set archived_at = null, updated_at = now()
  where id in (select public.node_subtree(n.id)) and archived_at is not null;
  perform public.assignment_resync(r.id);                  -- COMMON 행 복구, 그사이 ACTIVE 가 아니게 된 담당자의 DESIGNATED 는 다시 해제
  if v_tag then perform public.tag_autoselect(r.id); end if;   -- 0018
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- ───────── 1. 요약 모드의 이탈 전원 제출 (0008 job_completion_digest) ─────────
-- "어제 전원 제출이 된 과제"의 완료 시각에 이탈 시각을 더한다: 이탈(member_deactivate → INACTIVE)로 풀린 미제출 담당자의 released_at.
-- 제출하고 이탈한 사람(시드 도윤)은 완료 시각을 바꾸지 않는다. IMMEDIATE 방은 0013 member_deactivate 가 즉시 알리고 여기서는 빠진다(기존 조건)
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
         -- 0018: 전원 제출이 된 순간 = 마지막 제출, 또는 그보다 늦은 이탈(INACTIVE)로 미제출 담당자가 빠진 순간(released_at)
         and (greatest(max(s.first_submitted_at),
                       (select max(x.released_at) from public.task_assignments x
                        join public.room_members m on m.room_id = rm.id and m.user_id = x.user_id and m.status = 'INACTIVE'
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

-- ───────── 4. 방 기간 변경 알림 ─────────
-- kind 는 notifications.kind(VARCHAR(32), CHECK 없음)에 그대로 들어간다 — 등록은 notification_kinds() 가 한다(0008·0012 와 같은 방식).
-- 링크는 notify_link(0012) 기본 분기(참가자 → /my-study/{slug}), 본문은 방 제목을 되풀이하지 않는다(0013 규칙)
create or replace function public.notification_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['ROUND_STARTED', 'TASK_ALL_SUBMITTED', 'TASK_COMPLETION_DIGEST', 'JOIN_REQUESTED', 'JOIN_APPROVED', 'JOIN_REJECTED',
               'JOIN_EXPIRED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'SCHEDULE_CHANGED', 'ROOM_STARTED',
               'ROOM_ENDED', 'ROOM_START_BLOCKED', 'MEMBER_DEACTIVATED',
               'CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED', 'ROOM_PERIOD_CHANGED']
$$;

create or replace function public.notify_enabled(p_kind text, p_room bigint, p_model jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_kind
      when 'DEADLINE_REMINDER' then case coalesce(p_model ->> 'days', '1') when '3' then s.reminder_d3 else s.reminder_d1 end
      when 'TASK_ASSIGNED'     then s.task_assigned
      when 'TASK_UNASSIGNED'   then s.task_assigned
      when 'SCHEDULE_CHANGED'  then s.schedule_changed
      when 'ROOM_PERIOD_CHANGED' then s.schedule_changed      -- 0018: 일정 변경 설정을 함께 따른다
      when 'ROOM_STARTED'      then s.room_start_end
      when 'ROOM_ENDED'        then s.room_start_end
      else true end
    from public.room_notification_settings s where s.room_id = p_room), true)
$$;

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
  if p_kind = 'ROOM_PERIOD_CHANGED' then
    v_fmt := case when (select count(distinct left(x, 4)) from unnest(array[p_model ->> 'oldStartDate', p_model ->> 'oldEndDate',
                                                                          p_model ->> 'startDate', p_model ->> 'endDate']) x where x is not null) <= 1
                  then 'MM.DD' else 'YY.MM.DD' end;
  end if;
  v_body := case
    when p_kind = 'ROOM_PERIOD_CHANGED' then
      coalesce(to_char((p_model ->> 'oldStartDate')::date, v_fmt) || ' – ' || to_char((p_model ->> 'oldEndDate')::date, v_fmt) || ' → ', '')
      || to_char((p_model ->> 'startDate')::date, v_fmt) || ' – ' || to_char((p_model ->> 'endDate')::date, v_fmt)
    when p_kind = 'ROUND_STARTED' and v_label is not null and v_node is distinct from v_label then v_node
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null then
      format('"%s"', v_node)
      || coalesce(' ' || to_char((p_model ->> 'startDate')::date, 'MM.DD') || ' – ' || to_char((p_model ->> 'endDate')::date, 'MM.DD'), '')
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

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
    when 'active'  then array['slug', 'startDate', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks']
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
