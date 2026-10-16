-- 0014_personal_goals.sql — 개인 목표(팀원이 회차 아래에 직접 등록하는 PERSONAL 리프) + 내 과제(me_tasks). 배포 후 수정 금지.
-- 추가형: 컬럼 1·제약·인덱스·트리거·정책 교체·함수 교체/추가. 기존 행은 owner_id null · task_type COMMON|DESIGNATED|null 로 새 제약을 모두 만족한다.
-- 모델(스펙 §5.1 P1): 개인 목표 = goal_nodes 리프(task_type 'PERSONAL', owner_id = 만든 사람, depth 3 = 회차 바로 아래).
--   task_assignments 행을 만들지 않는다 → 팀 진척(room_progress)·내 진척(rooms_list mine)·완료 알림(TASK_ALL_SUBMITTED·digest)·
--   이탈 결정(deactivate_pending)은 손대지 않아도 개인 목표를 세지 않는다. 방 통계(room_leaf_stats)만 명시적으로 뺀다.
--   제출 자격은 is_task_assignee 가 소유자도 참으로 본다 → submission_target·첨부 업로드 정책(is_my_task)·task_get.isAssignee 그대로 동작.
-- 재정의 함수는 각 함수의 최신 정의를 복사해 고친 것이다. 시그니처가 같으면 GRANT 유지.

-- ───────── 1. 컬럼·제약·인덱스 ─────────
alter table public.goal_nodes add column owner_id uuid references public.profiles(id);
alter table public.goal_nodes drop constraint ck_goal_nodes_type;
alter table public.goal_nodes add constraint ck_goal_nodes_type
  check (task_type is null or task_type in ('COMMON', 'DESIGNATED', 'PERSONAL'));
-- 개인 목표 ⇔ 소유자. task_type 이 null 일 때 비교가 null(=통과)로 빠지지 않게 is not distinct from
alter table public.goal_nodes add constraint ck_goal_nodes_owner
  check ((task_type is not distinct from 'PERSONAL') = (owner_id is not null));
-- 회차 바로 아래만 (묶음 아래·회차 자리 금지)
alter table public.goal_nodes add constraint ck_goal_nodes_personal_depth
  check (task_type is distinct from 'PERSONAL' or depth = 3);
create index ix_goal_nodes_owner on public.goal_nodes (owner_id, room_id) where owner_id is not null;

-- 개인 목표 아래에는 아무것도 둘 수 없다(직접 INSERT·UPDATE 경로 포함). RPC 경로는 node_get 가드가 먼저 막는다
create or replace function public.goal_nodes_personal_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and exists (select 1 from public.goal_nodes p where p.id = new.parent_id and p.task_type = 'PERSONAL') then
    perform public.fail('PERSONAL_NODE', '개인 목표 아래에는 항목을 둘 수 없어요', jsonb_build_object('nodeId', new.parent_id::text));
  end if;
  return new;
end $$;
create trigger trg_goal_nodes_personal_guard
  before insert or update of parent_id on public.goal_nodes
  for each row execute function public.goal_nodes_personal_guard();

-- ───────── 2. 편집자 RPC(node_*) 에서 개인 목표 차단 (0006 판 + PERSONAL 거부) ─────────
-- node_create(부모)·update·delete·archive·unarchive·move(대상·부모)·indent·outdent 가 모두 이 함수를 지난다.
-- 회차를 지우거나 보관하면 서브트리(개인 목표 포함)는 기존 규칙대로 함께 처리된다(회차 자체는 PERSONAL 이 아니다).
create or replace function public.node_get(p_room bigint, p_node bigint) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes;
begin
  select * into n from public.goal_nodes where id = p_node and room_id = p_room;
  if not found then perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', p_node::text)); end if;
  if n.task_type = 'PERSONAL' then
    perform public.fail('PERSONAL_NODE', '개인 목표는 진행목표 편집으로 바꿀 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  return n;
end $$;

-- ───────── 3. 판정 헬퍼 (GRANT 없음 — D7) ─────────
-- 개인 목표 소유 자격: 그룹장 | ACTIVE 멤버
create or replace function public.personal_eligible(p_room bigint, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (
    exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = p_uid)
    or exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status = 'ACTIVE'))
$$;

-- 남의 개인 목표를 볼 수 있나: 그룹장 | ACTIVE·INACTIVE 멤버 (= can_read_submissions 범위의 임의 uid 판, 스펙 R3·D1)
create or replace function public.personal_viewer(p_room bigint, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and (
    exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = p_uid)
    or exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE')))
$$;

-- 소유자당 회차당 보관 제외 상한 (스펙 R9·D5)
create or replace function public.personal_limit() returns int
language sql immutable set search_path = '' as $$ select 20 $$;

-- 0003 판 + 보관 아닌 개인 목표의 소유자. submission_target·is_my_task(첨부 업로드 정책)·task_get.isAssignee 가 이걸 본다
create or replace function public.is_task_assignee(p_node bigint, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_assignments a where a.node_id = p_node and a.user_id = p_user and a.released_at is null)
      or exists (select 1 from public.goal_nodes n
                 where n.id = p_node and n.task_type = 'PERSONAL' and n.owner_id = p_user and n.archived_at is null)
$$;

-- ───────── 4. RLS: 남의 개인 목표 행은 같은 방 그룹장·ACTIVE·INACTIVE 멤버만 ─────────
-- 공개 방 비로그인·외부인·승인 대기자에게는 팀 노드만. task_assignments·submissions 정책은 그대로(개인 목표엔 배정 행이 없고, 제출 열람은 원래 같은 범위)
drop policy goal_nodes_select on public.goal_nodes;
create policy goal_nodes_select on public.goal_nodes for select
  using (public.can_read_room(room_id)
         and (owner_id is null or owner_id = (select public.current_user_id()) or public.can_read_submissions(room_id)));
