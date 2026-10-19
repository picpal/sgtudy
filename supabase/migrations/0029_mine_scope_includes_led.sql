-- 0029: 홈 "참가한 스터디"(scope 'mine')에 내가 그룹장인 방도 넣는다 (사용자 결정 2026-10-19)
-- 이전(0004): mine = room_members role='MEMBER' ∧ status ACTIVE|PENDING — 그룹장 방은 'created' 에만 보였다.
-- 이후: mine = (위 조건) ∨ r.leader_id = p_uid. 'created'(만든 스터디)는 그대로 — mine 의 부분집합이 된다.
-- DRAFT(준비중): 'created' 가 그룹장 DRAFT 를 보여 주므로 mine 에도 넣는다(만든 ⊂ 참가한 유지). DRAFT 에는 그룹장 외 멤버가 없다.
-- 보관(archived_at) 규칙·public 규칙은 그대로. 시그니처·security definer·search_path 동일 — GRANT 없음(0002 default privileges 로 비공개)은
-- create or replace 가 기존 권한을 유지하므로 그대로다.
-- 호출부: rooms_list(tabCounts·tagFacets·totalElements·items) 만 — 전부 이 함수 하나로 판정하므로 함께 바뀐다.

create or replace function public.room_in_scope(p_room bigint, p_scope text, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room and r.archived_at is null and (
         (p_scope = 'public'  and r.visibility = 'PUBLIC' and r.status <> 'DRAFT')
      or (p_scope = 'mine'    and p_uid is not null and (
            r.leader_id = p_uid
            or exists (
              select 1 from public.room_members m
              where m.room_id = r.id and m.user_id = p_uid and m.role = 'MEMBER' and m.status in ('ACTIVE', 'PENDING'))))
      or (p_scope = 'created' and p_uid is not null and r.leader_id = p_uid)))
$$;
