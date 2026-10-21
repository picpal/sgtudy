-- 0043_notice_comment_followups.sql — 2026-10-21 공지·댓글 후속. 배포 후 수정 금지.
-- 재정의 원본: notice_notify ← 0040 · notify_render·comment_list ← 0041 (0042 재정의 없음). 시그니처 동일 → GRANT 유지.
-- 바뀐 것:
--  · notice_notify — 알림 모델에 renotify(= popup_rev > 1, 「다시 알리기」로만 오른다)를 싣는다. notice_update 는 그대로.
--  · notify_render — NOTICE_POSTED 가 renotify 면 '{방} 공지 다시 알림: {제목}', 아니면 0041 판 그대로 '{방} 새 공지: {제목}'.
--  · comment_list — 시험 잠금 응답의 total 을 null 로(D4 보강: 개수도 노출하지 않는다).

-- 0040 판 그대로 + 모델 renotify
create or replace function public.notice_notify(n public.room_notices, p_actor uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rcpt uuid[];
begin
  select coalesce(array_agg(m.user_id), '{}') into v_rcpt
  from public.room_members m join public.rooms r on r.id = m.room_id
  where m.room_id = n.room_id and m.status = 'ACTIVE' and m.user_id <> r.leader_id;
  return public.notify_publish('NOTICE_POSTED', n.room_id, null, p_actor, v_rcpt,
                               'NOTICE_POSTED:' || n.id || ':' || n.popup_rev,
                               jsonb_build_object('noticeId', n.id::text, 'title', n.title, 'renotify', n.popup_rev > 1));
end $$;

-- 0041 판 그대로 + NOTICE_POSTED renotify 제목
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
    -- 0032
    when 'MEMBER_JOINED'          then format('%s님이 %s에 합류했어요', v_actor, v_room)
    -- 0034: 계획 적용·되돌리기 묶음(수신자당 1건). 방 제목은 따옴표 없이
    when 'CURRICULUM_BULK_UPDATED' then format('%s 진행목표가 한꺼번에 바뀌었어요', v_room)
    -- 0037
    when 'EXAM_PUBLISHED'         then format('%s 「%s」 시험이 열렸어요', v_room, v_node)   -- 스펙 §4.6
    -- 0040: 공지 제목은 모델에 담아 온다(노드 없음). 본문 없음 — 방 제목은 프론트가 메타 줄에 그린다(0013)
    -- 0043: 「다시 알리기」(renotify — popup_rev 2 이상)는 새 공지와 구분한다. 옛 모델(키 없음)은 새 공지
    when 'NOTICE_POSTED'          then format(case when (p_model ->> 'renotify')::boolean then '%s 공지 다시 알림: %s' else '%s 새 공지: %s' end,
                                              v_room, p_model ->> 'title')
    -- 0041: 댓글 멘션(스펙 D13). 작성자 닉네임은 발행 시점 스냅샷
    when 'MENTIONED'              then format('%s님이 댓글에서 회원님을 언급했어요', v_actor)
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
    -- 0034: 새 과제·일정·담당 건수 중 0 이 아닌 것만
    when p_kind = 'CURRICULUM_BULK_UPDATED' then
      nullif(concat_ws(' · ',
        case when coalesce((p_model ->> 'newTasks')::int, 0) > 0 then '새 과제 ' || (p_model ->> 'newTasks') || '건' end,
        case when coalesce((p_model ->> 'schedule')::int, 0) > 0 then '일정 ' || (p_model ->> 'schedule') || '건' end,
        case when coalesce((p_model ->> 'assign')::int, 0) > 0 then '담당 ' || (p_model ->> 'assign') || '건' end), '')
    when p_kind = 'MEMBER_JOINED' then
      case p_model ->> 'via' when 'invite' then '초대로 바로 참가했어요' else '추가 모집으로 참가했어요' end
      || ' · 지정 과제 담당이 필요하면 진행목표에서 정해 주세요'
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
    -- 0041: 「노드」 · 발췌(≤80자, 토큰은 @닉네임). 시험 리프는 발췌 없음(comment_notify 가 excerpt 를 비운다)
    when p_kind = 'MENTIONED' then
      format('「%s」', coalesce(v_label, v_node)) || coalesce(' · ' || nullif(p_model ->> 'excerpt', ''), '')
    when p_kind = 'SUBMISSION_DIGEST' and p_node is not null then
      case when v_tasks <= 1 then format('"%s"', v_node) else format('"%s" 외 과제 %s개', v_node, v_tasks - 1) end
  end;
  -- 0037: 시험 발행 — 스펙 §4.6 "{방} 「{제목}」 시험이 열렸어요 · n문항 · ~MM.DD" 의 뒷부분(제목 · 본문 으로 나눠 그린다)
  if p_kind = 'EXAM_PUBLISHED' then
    v_body := format('%s문항 · ~%s', coalesce(p_model ->> 'count', '0'), to_char((select g.end_date from public.goal_nodes g where g.id = p_node), 'MM.DD'));
  end if;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

-- 0041 판 그대로 + 시험 잠금 total null
create or replace function public.comment_list(p_slug text, p_node bigint, p_before bigint default null, p_from bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v       record;
  r       public.rooms;
  n       public.goal_nodes;
  v_uid   uuid := public.current_user_id();
  v_lim   jsonb := public.comment_limits();
  v_page  int := (v_lim ->> 'page')::int;
  v_max   int := (v_lim ->> 'fromMax')::int;
  v_why   text;
  v_total int;
  v_tgt   public.node_comments;
  v_state text;
  v_rows  public.node_comments[];
  v_newer boolean := false;
  v_pg    record;
begin
  select * into v from public.comment_reader(p_slug, p_node);   -- OUT 2개 → record 로 받아 나눈다
  r := v.r;
  n := v.n;
  v_why := public.comment_writable(r, n, v_uid);
  select count(*)::int into v_total from public.node_comments c where c.node_id = n.id and c.deleted_at is null;

  -- 시험 잠금은 쓰기 이유와 따로 본다 — 종료·보관 방(v_why = ended)이라도 정답이 닫혀 있으면 목록도 닫힌다(D4).
  -- 0043: 잠금이면 개수(total)도 null — 몇 개 달렸는지도 정답 공개 전엔 보이지 않게
  if public.comment_exam_locked(n, v_uid) then
    return jsonb_build_object('items', '[]'::jsonb, 'people', '{}'::jsonb, 'hasOlder', false, 'hasNewer', false, 'total', null,
                              'canWrite', false, 'writeBlock', coalesce(v_why, 'exam_locked'), 'locked', '{"reason":"exam"}'::jsonb, 'target', null,
                              'limits', v_lim);
  end if;

  if p_from is not null then
    select * into v_tgt from public.node_comments c where c.id = p_from and c.node_id = n.id;
    v_state := case when not found then 'missing' when v_tgt.deleted_at is not null then 'deleted' else 'ok' end;
  end if;

  if v_state = 'ok' then
    if (select count(*) from public.node_comments c where c.node_id = n.id and c.deleted_at is null and c.id >= p_from) <= v_max then
      select array_agg(c order by c.id) into v_rows from public.node_comments c where c.node_id = n.id and c.deleted_at is null and c.id >= p_from;
    else
      v_newer := true;
      select array_agg(c order by c.id) into v_rows from public.node_comments c
      where c.id in ((select x.id from public.node_comments x where x.node_id = n.id and x.deleted_at is null and x.id < p_from order by x.id desc limit v_max / 2)
                     union all
                     (select x.id from public.node_comments x where x.node_id = n.id and x.deleted_at is null and x.id >= p_from order by x.id limit v_max / 2));
    end if;
  else
    select array_agg(c order by c.id) into v_rows from public.node_comments c
    where c.id in (select x.id from public.node_comments x
                   where x.node_id = n.id and x.deleted_at is null and (p_before is null or x.id < p_before)
                   order by x.id desc limit v_page);
  end if;

  select * into v_pg from public.comment_items(coalesce(v_rows, '{}'), v_uid, v_why is null, r.leader_id = v_uid);
  return jsonb_build_object(
    'items', v_pg.items, 'people', v_pg.people,
    'hasOlder', exists (select 1 from public.node_comments c where c.node_id = n.id and c.deleted_at is null
                        and c.id < coalesce((select min(x.id) from unnest(v_rows) x), p_before, 9223372036854775807)),
    'hasNewer', v_newer,
    'total', v_total,
    'canWrite', v_why is null,
    'writeBlock', v_why,
    'locked', null,
    'target', case when p_from is null then null else jsonb_build_object('id', p_from::text, 'state', v_state) end,
    'limits', v_lim);
end $$;

