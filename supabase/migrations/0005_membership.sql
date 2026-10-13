-- 0005_membership.sql — 멤버십 상태 머신 · 초대 (플랜 02 Task 1·5)
-- 배포 후 수정 금지. Task 5 가 이 파일 끝에 함수를 이어 붙인다.

-- ───────── D4: 공통 과제 담당자 실체화 (멱등) ─────────
-- 1. 보관 아닌 COMMON 리프 × 담당 자격자(ACTIVE 멤버, 그룹장은 leader_does_tasks) → 없으면 INSERT, released 면 복구
-- 2. 유효 행인데 (리프가 COMMON 아님 | 리프 보관 | 사용자가 담당 자격 없음) → released
--    보관 리프는 COMMON·DESIGNATED 모두 해제(D13 — is_task_assignee 가 거짓이 되어 Storage 업로드도 막힌다).
--    이때 released_at = 리프의 archived_at(같은 트랜잭션의 now()) — 플랜 03 node_unarchive 가 이 값으로 "보관 때문에 풀린 지정 행"을 되살린다.
--    DESIGNATED 행도 사용자가 ACTIVE 멤버가 아니면 released (CANCELED 참가자, INACTIVE 는 member_deactivate 가 먼저 결정)
-- 3. 행은 절대 삭제하지 않는다(제출물 보존)
create or replace function public.assignment_resync(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ldt boolean;
begin
  select leader_does_tasks into v_ldt from public.rooms where id = p_room;
  if not found then return; end if;

  -- 1. 원하는 (리프, 사용자) 조합을 채운다
  insert into public.task_assignments (node_id, user_id, source)
  select n.id, m.user_id, 'COMMON'
  from public.goal_nodes n
  cross join public.room_members m
  where n.room_id = p_room and n.task_type = 'COMMON' and n.archived_at is null
    and m.room_id = p_room and m.status = 'ACTIVE' and (m.role = 'MEMBER' or v_ldt)
  on conflict (node_id, user_id) do update
    set released_at = null, source = 'COMMON'
    where public.task_assignments.released_at is not null or public.task_assignments.source <> 'COMMON';

  -- 2a. 리프 보관 → COMMON·DESIGNATED 모두 해제(released_at = archived_at, D13) / COMMON 행인데 리프가 COMMON 아님 → 해제
  update public.task_assignments a set released_at = coalesce(n.archived_at, now())
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = p_room and a.released_at is null
    and (n.archived_at is not null or (a.source = 'COMMON' and n.task_type is distinct from 'COMMON'));

  -- 2b. 사용자가 담당 자격이 없음 → 해제 (COMMON: 자격 규칙, DESIGNATED: ACTIVE 멤버가 아닐 때만)
  update public.task_assignments a set released_at = now()
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = p_room and a.released_at is null
    and not exists (
      select 1 from public.room_members m
      where m.room_id = p_room and m.user_id = a.user_id and m.status = 'ACTIVE'
        and (a.source = 'DESIGNATED' or m.role = 'MEMBER' or v_ldt));
end $$;
