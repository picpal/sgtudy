-- 0012_editor_notifications.sql — 진행목표(커리큘럼) 편집 권한 알림 (plan 06 Task K)
-- 배포 후 수정 금지. 0008 notification_kinds·notify_render·notify_link, 0011 member_set_curriculum_editor 를
-- 본문 그대로 복사해 CREATE OR REPLACE 하고 추가분만 넣는다.
-- 알림: 값이 실제로 바뀔 때만(멱등 호출은 무알림) 대상 멤버에게. 행위성 kind → prefix 에 txid(0005 JOIN_* 와 같은 규칙).
-- 그룹장은 actor 라 notify_publish 가 뺀다. 링크는 그 방 진행목표 탭(/my-study/{slug}?tab=curriculum).

-- ───────── 알림 종류 (0008 + CURRICULUM_EDITOR_*) ─────────
create or replace function public.notification_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['ROUND_STARTED', 'TASK_ALL_SUBMITTED', 'TASK_COMPLETION_DIGEST', 'JOIN_REQUESTED', 'JOIN_APPROVED', 'JOIN_REJECTED',
               'JOIN_EXPIRED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'SCHEDULE_CHANGED', 'ROOM_STARTED',
               'ROOM_ENDED', 'ROOM_START_BLOCKED', 'MEMBER_DEACTIVATED',
               'CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED']
$$;

-- ───────── 제목 (0008 + CURRICULUM_EDITOR_*) ─────────
create or replace function public.notify_render(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_model jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_room  text;
  v_node  text;
  v_label text;
  v_actor text;
  v_title text;
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
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', case when p_node is null then null else left(v_room, 500) end);
end $$;

-- ───────── 링크 (0008 + CURRICULUM_EDITOR_* → 진행목표 탭) ─────────
create or replace function public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_node is not null and p_kind in ('TASK_ALL_SUBMITTED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED')
      then '/my-study/' || r.slug || '?task=' || p_node
    when p_kind in ('CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED')
      then '/my-study/' || r.slug || '?tab=curriculum'
    when r.leader_id = p_user
      or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_user and m.status = 'ACTIVE')
      then '/my-study/' || r.slug
    else '/rooms/' || r.slug end
  from public.rooms r where r.id = p_room
$$;

-- ───────── member_set_curriculum_editor (0011 + 바뀐 경우 알림) ─────────
create or replace function public.member_set_curriculum_editor(p_slug text, p_user uuid, p_allow boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; m public.room_members;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid, '그룹장만 편집 권한을 줄 수 있어요');
  if p_user = r.leader_id then perform public.fail('CANNOT_TARGET_LEADER', '그룹장은 항상 커리큘럼을 편집할 수 있어요'); end if;
  if p_allow is null then perform public.fail('VALIDATION_FAILED', '허용 여부가 필요해요', '{"field":"allow"}'::jsonb); end if;
  select * into m from public.room_members where room_id = r.id and user_id = p_user for update;
  if not found or m.status <> 'ACTIVE' then perform public.fail('MEMBER_NOT_ACTIVE', '활성 참가자가 아니에요'); end if;
  if m.can_edit_curriculum is distinct from p_allow then
    update public.room_members set can_edit_curriculum = p_allow, updated_at = now() where id = m.id returning * into m;
    perform public.notify_publish(case when p_allow then 'CURRICULUM_EDITOR_GRANTED' else 'CURRICULUM_EDITOR_REVOKED' end,
      r.id, null, v_uid, array[p_user],
      case when p_allow then 'CURRICULUM_EDITOR_GRANTED:' else 'CURRICULUM_EDITOR_REVOKED:' end || r.id || ':' || p_user || ':' || txid_current(),
      '{}'::jsonb);
  end if;
  return public.member_admin_json(r, m);
end $$;
