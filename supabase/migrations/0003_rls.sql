-- RLS (02-domain-and-schema.md §5, 01-decisions D7). 쓰기는 전부 RPC(SECURITY DEFINER) → INSERT/UPDATE/DELETE 정책 없음 = 거부.
-- 헬퍼는 STABLE SECURITY DEFINER: 정책 안에서 다른 테이블을 보되 그 테이블의 RLS 에 다시 걸리지 않는다.

-- ───────── 헬퍼 ─────────
create or replace function public.is_room_member(p_room bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = public.current_user_id() and m.status in ('ACTIVE', 'INACTIVE', 'PENDING'))
$$;

create or replace function public.is_room_leader(p_room bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rooms r where r.id = p_room and r.leader_id = public.current_user_id())
$$;

-- 공개·비DRAFT·미보관 방은 누구나. 그 외(비공개·DRAFT·보관)는 멤버·그룹장만.
create or replace function public.can_read_room(p_room bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room
      and ((r.archived_at is null and r.visibility = 'PUBLIC' and r.status <> 'DRAFT')
           or public.is_room_member(p_room) or public.is_room_leader(p_room)))
$$;

create or replace function public.can_read_submissions(p_room bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_room_leader(p_room) or exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = public.current_user_id() and m.status in ('ACTIVE', 'INACTIVE'))
$$;

create or replace function public.is_task_assignee(p_node bigint, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_assignments a where a.node_id = p_node and a.user_id = p_user and a.released_at is null)
$$;

-- 정책용 1인자 래퍼: 호출자 자신의 배정만 묻는다(2인자 형은 RPC 로 열지 않는다 — 비공개 방 배정 정보 누출 방지)
create or replace function public.is_my_task(p_node bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_task_assignee(p_node, public.current_user_id())
$$;

-- 제출물 한 건: 같은 방 ACTIVE·INACTIVE·그룹장이 읽되, 보관 노드는 그룹장·작성자만 (D10)
create or replace function public.can_read_submission(p_node bigint, p_author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.goal_nodes n
    where n.id = p_node
      and public.can_read_submissions(n.room_id)
      and (n.archived_at is null or public.is_room_leader(n.room_id) or p_author = public.current_user_id()))
$$;

-- 정책 식은 조회 역할의 권한으로 평가된다 → 정책이 직접 부르는 헬퍼만 GRANT (0002 의 default privileges 로 기본 비공개)
grant execute on function public.current_user_id()                    to anon, authenticated;
grant execute on function public.is_room_member(bigint)               to anon, authenticated;
grant execute on function public.is_room_leader(bigint)               to anon, authenticated;
grant execute on function public.can_read_room(bigint)                to anon, authenticated;
grant execute on function public.can_read_submissions(bigint)         to anon, authenticated;
grant execute on function public.can_read_submission(bigint, uuid)    to anon, authenticated;
grant execute on function public.is_my_task(bigint)                   to authenticated;

-- ───────── RLS 켜기 ─────────
alter table public.profiles                   enable row level security;
alter table public.rooms                      enable row level security;
alter table public.room_members               enable row level security;
alter table public.room_invites               enable row level security;
alter table public.goal_nodes                 enable row level security;
alter table public.task_assignments           enable row level security;
alter table public.submissions                enable row level security;
alter table public.submission_links           enable row level security;
alter table public.files                      enable row level security;
alter table public.tags                       enable row level security;
alter table public.room_tags                  enable row level security;
alter table public.room_tag_suppressions      enable row level security;
alter table public.notifications              enable row level security;
alter table public.room_notification_settings enable row level security;
alter table public.mail_outbox                enable row level security;   -- 정책 없음 = service_role 만

-- ───────── SELECT 정책 (§5 표) ─────────
create policy profiles_select_self on public.profiles for select
  using (id = (select public.current_user_id()));

create policy rooms_select on public.rooms for select
  using (public.can_read_room(id));

create policy room_members_select on public.room_members for select
  using (public.can_read_room(room_id)
         and (status in ('ACTIVE', 'INACTIVE') or user_id = (select public.current_user_id()) or public.is_room_leader(room_id)));

create policy room_invites_select_leader on public.room_invites for select
  using (public.is_room_leader(room_id));

create policy goal_nodes_select on public.goal_nodes for select
  using (public.can_read_room(room_id));

create policy task_assignments_select on public.task_assignments for select
  using (exists (select 1 from public.goal_nodes n where n.id = node_id and public.can_read_room(n.room_id)));

create policy submissions_select on public.submissions for select
  using (public.can_read_submission(node_id, user_id));

create policy submission_links_select on public.submission_links for select
  using (exists (select 1 from public.submissions s where s.id = submission_id and public.can_read_submission(s.node_id, s.user_id)));

-- 파일: 내 것 / 방 커버(방을 읽을 수 있으면) / 제출 첨부(제출물을 읽을 수 있으면)
create policy files_select on public.files for select
  using (owner_user_id = (select public.current_user_id())
         or (purpose = 'COVER' and room_id is not null and public.can_read_room(room_id))
         or (node_id is not null and public.can_read_submission(node_id, owner_user_id)));

create policy tags_select_all on public.tags for select using (true);

create policy room_tags_select on public.room_tags for select
  using (public.can_read_room(room_id));

create policy room_tag_suppressions_select_leader on public.room_tag_suppressions for select
  using (public.is_room_leader(room_id));

create policy room_notification_settings_select_leader on public.room_notification_settings for select
  using (public.is_room_leader(room_id));

create policy notifications_select_own on public.notifications for select
  using (user_id = (select public.current_user_id()));

-- ───────── 타인 프로필: 이메일 비노출 뷰 ─────────
-- 소유자(postgres) 권한으로 실행되는 뷰 → profiles 의 self 정책을 거치지 않고 세 컬럼만 보여 준다(의도된 security definer 뷰).
create view public.public_profiles as
  select id, nickname, avatar_tone from public.profiles;
-- Supabase 는 public 스키마의 테이블·뷰에 anon/authenticated ALL 을 기본 GRANT 한다 → 자동 갱신 가능 뷰로 profiles RLS 를 우회해 쓸 수 있다. 뷰는 항상 revoke all + grant select.
revoke all on public.public_profiles from anon, authenticated, public;
grant select on public.public_profiles to anon, authenticated;

-- ───────── Storage 버킷 attachments (D10) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
              'application/zip', 'application/x-zip-compressed', 'text/plain', 'text/markdown'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 버킷 attachments 안의 키 {room_id}/{node_id}/{user_id}/{uuid}.{ext} (개요 Storage 키 규칙 — 원본 파일명은 키에 넣지 않고 files.original_name)
-- foldername = [room_id, node_id, user_id]. INSERT: 키 형식을 정규식으로 고정(이후 캐스트 보호) + user 세그먼트=본인 + 담당자 + room 세그먼트가 그 노드의 방과 일치.
-- 보관 리프의 DESIGNATED 행은 resync 가 해제하므로(plan 02, D13) is_task_assignee 가 거짓 → 업로드 차단
create policy attachments_insert_assignee on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and name ~ '^[0-9]+/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and (storage.foldername(name))[3] = (select auth.uid())::text
    and public.is_my_task(((storage.foldername(name))[2])::bigint)
    and (storage.foldername(name))[1] = (select n.room_id::text from public.goal_nodes n where n.id = ((storage.foldername(name))[2])::bigint));

-- SELECT: 제출물 읽기 규칙과 동일 — 보관 노드 첨부는 그룹장·작성자(user 세그먼트)만 (D10)
create policy attachments_select_member on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and name ~ '^[0-9]+/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    and public.can_read_submission(((storage.foldername(name))[2])::bigint, ((storage.foldername(name))[3])::uuid));

create policy attachments_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'attachments'
         and name ~ '^[0-9]+/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
         and (storage.foldername(name))[3] = (select auth.uid())::text);
