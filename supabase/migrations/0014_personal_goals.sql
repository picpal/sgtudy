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

-- ───────── 5. 개인 목표 쓰기 RPC ─────────
-- 공통 선행: 방 잠금 → 존재 은닉(못 읽으면 ROOM_NOT_FOUND) → 방 RECRUIT·ACTIVE·미보관
-- DRAFT 제외: 그룹장 혼자라 필요 없고, room_open_recruit 의 "말단 과제 1개 이상"(0004) 을 개인 목표가 통과시키면 안 된다
create or replace function public.personal_room(p_slug text, p_uid uuid) returns public.rooms
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  r := public.room_lock(p_slug);
  if not public.room_readable(r.id, p_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.archived_at is not null or r.status not in ('RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_NOT_EDITABLE', '모집 중이거나 진행 중인 스터디에서만 개인 목표를 바꿀 수 있어요', jsonb_build_object('status', lower(r.status)));
  end if;
  return r;
end $$;

-- 같은 방의 개인 목표 한 건. 팀 노드 id·남의 목표(볼 수 없는 사람) → NODE_NOT_FOUND (존재 숨김)
create or replace function public.personal_get(p_room bigint, p_node bigint, p_uid uuid) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes;
begin
  select * into n from public.goal_nodes where id = p_node and room_id = p_room and task_type = 'PERSONAL';
  if not found or (n.owner_id is distinct from p_uid and not public.personal_viewer(p_room, p_uid)) then
    perform public.fail('NODE_NOT_FOUND', '개인 목표를 찾을 수 없어요', jsonb_build_object('nodeId', p_node::text));
  end if;
  return n;
end $$;

-- 담을 회차: 같은 방 루트 · 보관 아님 · 과제형 회차(A7) 아님
create or replace function public.personal_round(p_room bigint, p_round bigint) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare rd public.goal_nodes;
begin
  select * into rd from public.goal_nodes where id = p_round and room_id = p_room and parent_id is null;
  if not found then perform public.fail('NODE_NOT_FOUND', '회차를 찾을 수 없어요', jsonb_build_object('nodeId', coalesce(p_round::text, ''))); end if;
  if rd.archived_at is not null then
    perform public.fail('PARENT_ARCHIVED', '보관된 회차에는 개인 목표를 둘 수 없어요', jsonb_build_object('nodeId', rd.id::text));
  end if;
  if rd.task_type is not null then
    perform public.fail('VALIDATION_FAILED', '회차 아래에만 개인 목표를 둘 수 있어요', '{"field":"roundId"}'::jsonb);
  end if;
  return rd;
end $$;

-- 제목 1~80 · 시작 ≤ 끝 · 방 기간 안(팀원이 그룹장의 방 종료일 조정을 막지 않게, 스펙 §5.4)
create or replace function public.personal_check(r public.rooms, p_title text, p_s date, p_e date) returns void
language plpgsql set search_path = '' as $$
begin
  if p_title is null or length(p_title) < 1 or length(p_title) > 80 then
    perform public.fail('INVALID_TITLE', '제목은 1~80자예요', '{"field":"title"}'::jsonb);
  end if;
  if p_s > p_e then perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb); end if;
  if p_s < r.start_date or p_e > r.end_date then
    perform public.fail('INVALID_PERIOD', format('방 기간(%s – %s) 안에서 정해 주세요', to_char(r.start_date, 'MM.DD'), to_char(r.end_date, 'MM.DD')),
                        jsonb_build_object('field', case when p_s < r.start_date then 'startDate' else 'endDate' end, 'reason', 'room'));
  end if;
end $$;

create or replace function public.personal_assert_capacity(p_round bigint, p_uid uuid, p_except bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.goal_nodes
      where parent_id = p_round and owner_id = p_uid and archived_at is null and id is distinct from p_except) >= public.personal_limit() then
    perform public.fail('PERSONAL_LIMIT_EXCEEDED', format('회차마다 개인 목표는 %s개까지예요', public.personal_limit()),
                        jsonb_build_object('limit', public.personal_limit()));
  end if;
end $$;

create or replace function public.personal_create(
  p_slug text, p_round_id bigint, p_title text, p_start_date date default null, p_end_date date default null, p_description_md text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  r       public.rooms;
  rd      public.goal_nodes;
  v_title text := trim(coalesce(p_title, ''));
  v_desc  text := coalesce(p_description_md, '');
  v_s     date;
  v_e     date;
  v_n     int;
  v_id    bigint;
  v_warn  jsonb := '[]'::jsonb;
begin
  r := public.personal_room(p_slug, v_uid);
  if not public.personal_eligible(r.id, v_uid) then
    perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 개인 목표를 만들 수 있어요');
  end if;
  rd := public.personal_round(r.id, p_round_id);
  -- 기본 기간 = 회차 기간을 방 기간으로 자른 것 (방 밖으로 나간 기존 회차 대비)
  v_s := coalesce(p_start_date, greatest(rd.start_date, r.start_date));
  v_e := coalesce(p_end_date, least(rd.end_date, r.end_date));
  perform public.personal_check(r, v_title, v_s, v_e);
  if length(v_desc) > 20000 then perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb); end if;
  perform public.personal_assert_capacity(rd.id, v_uid, null);

  select count(*)::int into v_n from public.goal_nodes where parent_id = rd.id;
  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, description_md, start_date, end_date, task_type, owner_id)
  values (r.id, rd.id, rd.id, 3, v_n, v_title, v_desc, v_s, v_e, 'PERSONAL', v_uid)
  returning id into v_id;
  if v_s < rd.start_date or v_e > rd.end_date then
    v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_PARENT', 'nodeId', v_id::text);
  end if;
  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('createdId', v_id::text, 'warnings', v_warn);
end $$;

-- 소유자 전용. 회차 이동(roundId) + 기간 + 내용을 한 트랜잭션에 (스펙 §5.5)
create or replace function public.personal_update(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  r       public.rooms;
  n       public.goal_nodes;
  rd      public.goal_nodes;
  k       text;
  v_title text;
  v_desc  text;
  v_s     date;
  v_e     date;
  v_round bigint;
  v_sort  int;
  v_warn  jsonb := '[]'::jsonb;
begin
  r := public.personal_room(p_slug, v_uid);
  n := public.personal_get(r.id, p_node_id, v_uid);
  if n.owner_id <> v_uid then perform public.fail('NOT_OWNER', '본인 개인 목표만 고칠 수 있어요'); end if;
  if not public.personal_eligible(r.id, v_uid) then perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 개인 목표를 고칠 수 있어요'); end if;
  if n.archived_at is not null then
    perform public.fail('TASK_ARCHIVED', '보관된 목표는 고칠 수 없어요 · 먼저 보관을 해제해 주세요', jsonb_build_object('nodeId', n.id::text));
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요'); end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'descriptionMd', 'startDate', 'endDate', 'roundId') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
    if k in ('title', 'descriptionMd', 'roundId') and jsonb_typeof(p_patch->k) <> 'string' then
      perform public.fail('VALIDATION_FAILED', '문자열이어야 해요', jsonb_build_object('field', k));
    end if;
  end loop;

  v_title := case when p_patch ? 'title' then trim(p_patch->>'title') else n.title end;
  v_desc  := coalesce(p_patch->>'descriptionMd', n.description_md);
  if length(v_desc) > 20000 then perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb); end if;
  v_s := coalesce(public.patch_date(p_patch, 'startDate'), n.start_date);
  v_e := coalesce(public.patch_date(p_patch, 'endDate'), n.end_date);
  perform public.personal_check(r, v_title, v_s, v_e);

  v_round := n.parent_id;
  if p_patch ? 'roundId' then
    begin v_round := (p_patch->>'roundId')::bigint;
    exception when invalid_text_representation then perform public.fail('VALIDATION_FAILED', '회차 id 가 올바르지 않아요', '{"field":"roundId"}'::jsonb);
    end;
  end if;
  rd := public.personal_round(r.id, v_round);
  v_sort := n.sort_order;
  if rd.id <> n.parent_id then
    perform public.personal_assert_capacity(rd.id, v_uid, n.id);
    perform public.node_renumber(r.id, n.parent_id, n.id);
    select count(*)::int into v_sort from public.goal_nodes where parent_id = rd.id;
  end if;

  update public.goal_nodes
     set parent_id = rd.id, round_id = rd.id, sort_order = v_sort,
         title = v_title, description_md = v_desc, start_date = v_s, end_date = v_e, updated_at = now()
   where id = n.id;
  if v_s < rd.start_date or v_e > rd.end_date then
    v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_PARENT', 'nodeId', n.id::text);
  end if;
  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('warnings', v_warn);
end $$;

-- 소유자(자격 있음) 또는 그룹장(모더레이션, 스펙 R4·D7). 해제는 회차 보관 아님 + 소유자 자격 + 한도
create or replace function public.personal_archive(p_slug text, p_node_id bigint, p_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes;
begin
  if p_archived is null then perform public.fail('VALIDATION_FAILED', '보관 여부가 필요해요', '{"field":"archived"}'::jsonb); end if;
  r := public.personal_room(p_slug, v_uid);
  n := public.personal_get(r.id, p_node_id, v_uid);
  if not ((n.owner_id = v_uid and public.personal_eligible(r.id, v_uid)) or r.leader_id = v_uid) then
    perform public.fail('NOT_OWNER', '본인 개인 목표만 보관할 수 있어요');
  end if;
  if p_archived then
    update public.goal_nodes set archived_at = now(), updated_at = now() where id = n.id and archived_at is null;
  elsif n.archived_at is not null then
    if exists (select 1 from public.goal_nodes p where p.id = n.parent_id and p.archived_at is not null) then
      perform public.fail('PARENT_ARCHIVED', '회차가 보관 중이에요. 회차를 먼저 해제해 주세요', jsonb_build_object('nodeId', n.parent_id::text));
    end if;
    if not public.personal_eligible(r.id, n.owner_id) then
      perform public.fail('OWNER_NOT_ACTIVE', '팀을 떠난 팀원의 목표는 되살릴 수 없어요');
    end if;
    perform public.personal_assert_capacity(n.parent_id, n.owner_id, n.id);
    update public.goal_nodes set archived_at = null, updated_at = now() where id = n.id;
  end if;
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- 소유자: 제출·링크까지 삭제(첨부는 soft delete — Storage 객체는 정리 잡 몫). 그룹장: 제출 없을 때만(팀원 기록 보호)
create or replace function public.personal_delete(p_slug text, p_node_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; n public.goal_nodes; v_owner boolean;
begin
  r := public.personal_room(p_slug, v_uid);
  n := public.personal_get(r.id, p_node_id, v_uid);
  v_owner := n.owner_id = v_uid and public.personal_eligible(r.id, v_uid);
  if not (v_owner or r.leader_id = v_uid) then perform public.fail('NOT_OWNER', '본인 개인 목표만 지울 수 있어요'); end if;
  if exists (select 1 from public.submissions s where s.node_id = n.id) then
    if not v_owner then
      perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 팀원 목표는 삭제할 수 없어요. 보관해 주세요', jsonb_build_object('nodeId', n.id::text));
    end if;
    update public.files set submission_id = null, status = 'DELETED', deleted_at = now()
     where submission_id in (select s.id from public.submissions s where s.node_id = n.id) and status <> 'DELETED';
    delete from public.submissions where node_id = n.id;      -- submission_links 는 cascade
  end if;
  delete from public.goal_nodes where id = n.id;              -- files.node_id 는 set null
  perform public.node_renumber(r.id, n.parent_id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- 완료 = 빈 제출 행(지각 = 마감 뒤 처음 완료). 취소 = 내용(본문·링크·첨부) 없는 제출만 삭제 (스펙 R5·D2).
-- 진행중 방만(제출과 같음). 시작일 검사는 없다 — 개인 목표는 미리 끝내도 된다
create or replace function public.personal_complete(p_slug text, p_node_id bigint, p_done boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_now timestamptz := public.app_now();
  r     public.rooms;
  n     public.goal_nodes;
  s     public.submissions;
begin
  if p_done is null then perform public.fail('VALIDATION_FAILED', '완료 여부가 필요해요', '{"field":"done"}'::jsonb); end if;
  r := public.room_lock(p_slug);
  if not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('ROOM_NOT_ACTIVE', '진행중인 스터디에서만 완료할 수 있어요');
  end if;
  n := public.personal_get(r.id, p_node_id, v_uid);
  if n.owner_id <> v_uid then perform public.fail('NOT_OWNER', '본인 개인 목표만 완료할 수 있어요'); end if;
  if not public.personal_eligible(r.id, v_uid) then perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 완료할 수 있어요'); end if;
  if n.archived_at is not null then perform public.fail('TASK_ARCHIVED', '보관된 목표는 완료할 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;

  select * into s from public.submissions where node_id = n.id and user_id = v_uid;
  if p_done and s.id is null then
    insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
    values (n.id, v_uid, '', v_now, v_now >= public.kst_deadline(n.end_date), v_now);
  elsif not p_done and s.id is not null then
    if s.body_md <> '' or exists (select 1 from public.submission_links l where l.submission_id = s.id)
       or exists (select 1 from public.files f where f.submission_id = s.id and f.status <> 'DELETED') then
      perform public.fail('SUBMISSION_HAS_CONTENT', '제출 내용이 있는 목표는 완료를 취소할 수 없어요');
    end if;
    delete from public.submissions where id = s.id;
  end if;
  return public.curriculum_json(r.id, v_uid, true);
end $$;

grant execute on function public.personal_create(text, bigint, text, date, date, text) to authenticated;
grant execute on function public.personal_update(text, bigint, jsonb)                  to authenticated;
grant execute on function public.personal_archive(text, bigint, boolean)               to authenticated;
grant execute on function public.personal_delete(text, bigint)                         to authenticated;
grant execute on function public.personal_complete(text, bigint, boolean)              to authenticated;

-- ───────── 6. 읽기 경로 ─────────
-- 6a. 방 통계는 팀 과제만 (0006 판 + 유형 필터). room_round_stats·room_detail_json(stats·currentRound·myProgress·nextDue)·room_start 경고·
--     submission_upsert 의 TASK_ALL_SUBMITTED 가 이걸 본다 → 개인 목표는 팀 수치·전원 제출 알림에 들어가지 않는다
create or replace function public.room_leaf_stats(p_room bigint)
returns table (node_id bigint, round_id bigint, parent_id bigint, title text, task_type text,
               start_date date, end_date date, sort_order int, asg int, sub int)
language sql stable security definer set search_path = '' as $$
  select n.id, n.round_id, n.parent_id, n.title::text, n.task_type::text, n.start_date, n.end_date, n.sort_order, p.asg, p.sub
  from public.goal_nodes n
  join public.room_progress(p_room) p on p.node_id = n.id
  where n.room_id = p_room and n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null
$$;

-- 6b. Curriculum (0011 판 + 개인 목표). 남의 개인 목표는 personal_viewer 에게만. 개인 리프의 집계 = 소유자 1명(보관이면 0)
--     room_progress 는 배정 기반이라 개인 리프가 부모 롤업에 0 으로 들어간다(팀 수치 불변). stats 는 팀 리프만
create or replace function public.curriculum_json(p_room bigint, p_uid uuid, p_include_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  v_today   date := public.kst_today();
  v_people  boolean;     -- 팀 과제 people 노출: 그룹장 | ACTIVE·INACTIVE·PENDING 멤버
  v_viewer  boolean;     -- 남의 개인 목표 노출: 그룹장 | ACTIVE·INACTIVE 멤버 (0014)
  v_members jsonb;
  v_nodes   jsonb;
  v_stats   jsonb;
begin
  select * into r from public.rooms where id = p_room;
  v_people := p_uid is not null and (r.leader_id = p_uid or exists (
    select 1 from public.room_members m where m.room_id = p_room and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')));
  v_viewer := public.personal_viewer(p_room, p_uid);

  select coalesce(jsonb_agg(
           public.person_json(m.user_id) || jsonb_build_object(
             'role', lower(m.role), 'status', lower(m.status),
             'doesTasks', m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks),
             'canEditCurriculum', public.member_can_edit_curriculum(r, m))
           order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
  into v_members
  from public.room_members m
  where m.room_id = p_room and m.status in ('ACTIVE', 'INACTIVE');

  with recursive prog as materialized (
    select * from public.room_progress(p_room)),
  t as (
    select n.*, array[n.sort_order::bigint, n.id] as path
    from public.goal_nodes n where n.room_id = p_room and n.parent_id is null
    union all
    select c.*, t.path || array[c.sort_order::bigint, c.id]
    from public.goal_nodes c join t on c.parent_id = t.id),
  nodes as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id::text, 'parentId', t.parent_id::text, 'roundId', t.round_id::text,
             'depth', t.depth, 'sortOrder', t.sort_order, 'label', t.label, 'title', t.title,
             'descriptionMd', t.description_md,
             'startDate', to_char(t.start_date, 'YYYY-MM-DD'), 'endDate', to_char(t.end_date, 'YYYY-MM-DD'),
             'archived', t.archived_at is not null,
             'ownerId', t.owner_id::text,
             'assigned', coalesce(ps.asg, p.asg), 'submitted', coalesce(ps.sub, p.sub),
             'pct', case when ps.asg is null then p.pct else public.pct(ps.asg, ps.sub) end,
             'task', case
               when t.task_type is null then null
               when t.task_type = 'PERSONAL' then jsonb_build_object(
                 'type', 'personal', 'assigned', ps.asg, 'submitted', ps.sub,
                 'state', public.leaf_state(ps.asg, ps.sub, t.start_date, t.end_date, v_today),
                 'people', jsonb_build_array(public.person_json(t.owner_id)
                             || jsonb_build_object('status', public.task_code(t.start_date, t.end_date, ps.first_at, ps.late, v_today))))
               else jsonb_build_object(
                 'type', lower(t.task_type),
                 'assigned', p.asg, 'submitted', p.sub,
                 'state', public.leaf_state(p.asg, p.sub, t.start_date, t.end_date, v_today),
                 -- people 은 의도적으로 멤버 순서(그룹장, joined_at, id) — room_get 의 assigned_at 순서와 다르다
                 'people', case when not v_people then '[]'::jsonb else coalesce((
                   select jsonb_agg(public.person_json(a.user_id)
                            || jsonb_build_object('status', public.task_code(t.start_date, t.end_date, s.first_submitted_at, s.is_late, v_today))
                            order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id)
                   from public.task_assignments a
                   join public.room_members m on m.room_id = p_room and m.user_id = a.user_id
                   left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
                   where a.node_id = t.id and a.released_at is null and t.archived_at is null), '[]'::jsonb) end) end)
             order by t.path), '[]'::jsonb) as j
    from t
    join prog p on p.node_id = t.id
    left join lateral (
      select case when t.archived_at is null then 1 else 0 end as asg,
             case when t.archived_at is null and s.id is not null then 1 else 0 end as sub,
             s.first_submitted_at as first_at, s.is_late as late
      from (select 1) one
      left join public.submissions s on s.node_id = t.id and s.user_id = t.owner_id) ps on t.task_type = 'PERSONAL'
    where (p_include_archived or t.archived_at is null)
      and (t.owner_id is null or t.owner_id = p_uid or v_viewer)),
  stats as (
    select jsonb_build_object(
      'overallPct', public.pct(coalesce(sum(p.asg), 0)::int, coalesce(sum(p.sub), 0)::int),
      'leafCount', count(*),
      'unassignedCount', count(*) filter (where n.task_type = 'DESIGNATED' and p.asg = 0)) as j
    from public.goal_nodes n join prog p on p.node_id = n.id
    where n.room_id = p_room and n.task_type in ('COMMON', 'DESIGNATED') and n.archived_at is null)
  select (select j from nodes), (select j from stats) into v_nodes, v_stats;

  return jsonb_build_object(
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'room', jsonb_build_object('slug', r.slug, 'status', lower(r.status), 'leaderDoesTasks', r.leader_does_tasks),
    'members', v_members, 'nodes', v_nodes, 'stats', v_stats,
    'myPermissions', jsonb_build_object('canEditCurriculum', public.can_edit_curriculum(r, p_uid)),
    'personal', jsonb_build_object(
      'canAdd', r.archived_at is null and r.status in ('RECRUIT', 'ACTIVE') and public.personal_eligible(p_room, p_uid),
      'perRound', public.personal_limit()));
end $$;

-- 6c. 과제 상세 노드 (0007 판 + 개인 목표: people = [소유자], 집계 = 소유자 1명, ownerId)
create or replace function public.task_node_json(p_node bigint, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id::text, 'parentId', n.parent_id::text, 'roundId', n.round_id::text, 'depth', n.depth, 'sortOrder', n.sort_order,
    'label', n.label, 'title', n.title, 'descriptionMd', n.description_md,
    'startDate', to_char(n.start_date, 'YYYY-MM-DD'), 'endDate', to_char(n.end_date, 'YYYY-MM-DD'),
    'archived', n.archived_at is not null,
    'ownerId', n.owner_id::text,
    'task', jsonb_build_object(
      'type', lower(n.task_type),
      'people', case
        when n.task_type = 'PERSONAL' then
          case when p_uid is null or not (n.owner_id = p_uid or public.personal_viewer(n.room_id, p_uid)) then '[]'::jsonb
               else jsonb_build_array(public.person_json(n.owner_id) || jsonb_build_object('status',
                      public.task_code(n.start_date, n.end_date, ow.first_submitted_at, ow.is_late, public.kst_today()))) end
        when p_uid is null or n.archived_at is not null or not (
            exists (select 1 from public.rooms rr where rr.id = n.room_id and rr.leader_id = p_uid)
            or exists (select 1 from public.room_members m where m.room_id = n.room_id and m.user_id = p_uid
                         and m.status in ('ACTIVE', 'INACTIVE', 'PENDING')))
          then '[]'::jsonb
        else coalesce((
          select jsonb_agg(public.person_json(a.user_id)
                           || jsonb_build_object('status', public.task_code(n.start_date, n.end_date, s.first_submitted_at, s.is_late, public.kst_today()))
                           order by a.assigned_at, a.id)
          from public.task_assignments a
          left join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
          where a.node_id = n.id and a.released_at is null), '[]'::jsonb) end,
      'assigned', st.asg, 'submitted', st.sub,
      'state', public.leaf_state(st.asg, st.sub, n.start_date, n.end_date, public.kst_today())),
    'assigned', st.asg, 'submitted', st.sub, 'pct', public.pct(st.asg, st.sub))
  from public.goal_nodes n
  left join public.submissions ow on n.task_type = 'PERSONAL' and ow.node_id = n.id and ow.user_id = n.owner_id
  cross join lateral (
    select case when n.task_type = 'PERSONAL' then (case when n.archived_at is null then 1 else 0 end)
                else (select count(*)::int from public.task_assignments a where a.node_id = n.id and a.released_at is null) end as asg,
           case when n.task_type = 'PERSONAL' then (case when n.archived_at is null and ow.id is not null then 1 else 0 end)
                else (select count(s.id)::int from public.task_assignments a
                      join public.submissions s on s.node_id = a.node_id and s.user_id = a.user_id
                      where a.node_id = n.id and a.released_at is null) end as sub) st
  where n.id = p_node and n.task_type is not null
$$;

-- 6d. task_get (0007 판 + 남의 개인 목표 노출 필터). GRANT 는 시그니처가 같아 유지
create or replace function public.task_get(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.current_user_id();
  r      public.rooms;
  n      public.goal_nodes;
  v_path jsonb;
  v_mine jsonb := null;
  v_subs jsonb := '[]'::jsonb;
  v_node jsonb;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '말단 과제만 상세를 볼 수 있어요'); end if;
  -- 0014: 남의 개인 목표는 personal_viewer 에게만 (존재 숨김)
  if n.task_type = 'PERSONAL' and n.owner_id is distinct from v_uid and not public.personal_viewer(r.id, v_uid) then
    perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요');
  end if;

  with recursive up as (
    select g.id, g.parent_id, g.title, g.label, 0 as lvl from public.goal_nodes g where g.id = n.id
    union all
    select g.id, g.parent_id, g.title, g.label, up.lvl + 1 from public.goal_nodes g join up on g.id = up.parent_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', up.id::text, 'title', up.title, 'label', up.label) order by up.lvl desc), '[]'::jsonb)
  into v_path from up;

  v_node := public.task_node_json(n.id, v_uid);

  if v_uid is not null then
    select public.submission_json(s.id) into v_mine from public.submissions s where s.node_id = n.id and s.user_id = v_uid;
  end if;

  if public.can_read_submissions(r.id) then
    select coalesce(jsonb_agg(public.submission_json(s.id) || jsonb_build_object('author', public.person_json(s.user_id))
                              order by s.first_submitted_at, s.id), '[]'::jsonb)
    into v_subs
    from public.submissions s
    where s.node_id = n.id and public.can_read_submission(n.id, s.user_id);
  end if;

  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'node', v_node,
    'path', v_path,
    'mySubmission', v_mine,
    'isAssignee', v_uid is not null and public.is_task_assignee(n.id, v_uid),
    'allSubmitted', (v_node ->> 'assigned')::int > 0 and (v_node ->> 'assigned') = (v_node ->> 'submitted'),
    'submissions', v_subs);
end $$;

-- 6e. tag_autoselect (0009 판 + 개인 목표 제목 제외 — 팀원 개인 메모가 방 태그를 바꾸지 않게)
create or replace function public.tag_autoselect(p_room bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_title text; v_intro text; v_nodes text; v_slugs text[];
begin
  select r.title, r.intro into v_title, v_intro from public.rooms r where r.id = p_room;
  if not found then return 0; end if;
  select string_agg(n.title, ' ' order by n.sort_order, n.id) into v_nodes
  from public.goal_nodes n where n.room_id = p_room and n.archived_at is null and n.task_type is distinct from 'PERSONAL';

  select coalesce(array_agg(h.slug order by h.score desc, h.slug), '{}') into v_slugs
  from (
    select t.slug,
           sum(case when public.tag_term_hit(v_title, x.term) then 3 else 0 end
             + case when public.tag_term_hit(v_intro, x.term) then 2 else 0 end
             + case when public.tag_term_hit(v_nodes, x.term) then 1 else 0 end) as score
    from public.tags t
    cross join lateral unnest(array_append(t.aliases, t.label)) as x(term)
    where t.kind = 'CURATED'
    group by t.slug
    having sum(case when public.tag_term_hit(v_title, x.term) then 3 else 0 end
             + case when public.tag_term_hit(v_intro, x.term) then 2 else 0 end
             + case when public.tag_term_hit(v_nodes, x.term) then 1 else 0 end) > 0
    order by 2 desc, 1
    limit 5) h;
  perform public.tag_apply_auto(p_room, v_slugs);
  return cardinality(v_slugs);
end $$;

-- 6f. assignment_resync (0005 판 + 0 단계: 자격 잃은 소유자의 개인 목표 보관)
create or replace function public.assignment_resync(p_room bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ldt    boolean;
  v_leader uuid;
begin
  select leader_does_tasks, leader_id into v_ldt, v_leader from public.rooms where id = p_room;
  if not found then return; end if;

  -- 0 (0014). 소유자가 더는 그룹장·ACTIVE 멤버가 아닌 개인 목표 → 보관(제출물은 남는다). 되살리기는 personal_archive(false)
  update public.goal_nodes n set archived_at = now(), updated_at = now()
  where n.room_id = p_room and n.task_type = 'PERSONAL' and n.archived_at is null
    and n.owner_id <> v_leader
    and not exists (select 1 from public.room_members m where m.room_id = p_room and m.user_id = n.owner_id and m.status = 'ACTIVE');

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
