-- 0030_node_attachments.sql — 2026-10-19 진행목표 항목(회차·묶음·공통·지정·개인 목표) 첨부. 배포 후 수정 금지.
-- 스펙: docs/superpowers/specs/2026-10-19-node-attachments-design.md
-- 담는 것: ① files.purpose 'NODE_DOC' + files.attached_at(null = 올렸지만 저장 전) ② 권한 헬퍼 ③ Storage 정책 2개(키 n/{room}/{node}/{uuid}.{ext})
--   ④ files_select 재생성(0003 판 + NODE_DOC 갈래) ⑤ goal_nodes 삭제 트리거 ⑥ RPC 4개 ⑦ job_cleanup 재정의(0008 판 + 미저장 NODE_DOC)
-- 재정의하지 않는 것: node_update·node_delete·curriculum_json·personal_*·file_register (뒤따르는 AI 연동 0031–0033 과 겹치지 않게)
-- 왜 PENDING 을 쓰지 않나: job_cleanup 이 purpose 무관하게 PENDING 1h 를 DELETED 로 바꾼다(0008). 편집 세션은 1h 를 넘길 수 있다.

-- ───────── ① 스키마 ─────────
alter table public.files add column attached_at timestamptz;   -- NODE_DOC 전용. 저장(node_files_set) 시각
create index ix_files_node_doc on public.files (node_id) where purpose = 'NODE_DOC' and status = 'READY';

create or replace function public.node_file_limit() returns int
language sql immutable set search_path = '' as $$ select 5 $$;

-- 업로더 세그먼트 없음(항목 단위 소유). 숫자는 앞자리 0 없이 18자리까지(bigint 캐스트 보호, '02' 처럼 id 와 글자가 다른 키 차단). 제출 키(^[0-9]+/…)와 겹치지 않는다
create or replace function public.node_doc_key_ok(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_name, '') ~ '^n/[1-9][0-9]{0,17}/[1-9][0-9]{0,17}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$'
$$;

-- ───────── ② 권한 헬퍼 (스펙 §5) ─────────
-- 읽기: 팀 = 그룹장·ACTIVE·INACTIVE(PENDING 제외, 보관이면 편집자만) / 개인 = 소유자 + personal_viewer(보관이면 소유자·그룹장). 외부인·비로그인 불가(D3)
create or replace function public.node_doc_readable(p_node bigint, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (
    select 1 from public.goal_nodes n join public.rooms r on r.id = n.room_id
    where n.id = p_node and (
      case when n.task_type = 'PERSONAL' then
        n.owner_id = p_uid or (public.personal_viewer(r.id, p_uid) and (n.archived_at is null or r.leader_id = p_uid))
      else
        (r.leader_id = p_uid or exists (select 1 from public.room_members m
                                        where m.room_id = r.id and m.user_id = p_uid and m.status in ('ACTIVE', 'INACTIVE')))
        and (n.archived_at is null or public.can_edit_curriculum(r, p_uid))
      end))
$$;

-- 추가(업로드·붙이기): 팀 = 편집자 ∧ 방 DRAFT·RECRUIT·ACTIVE / 개인 = 소유자 ∧ 소유 자격 ∧ 방 RECRUIT·ACTIVE. 둘 다 항목·방 미보관
create or replace function public.node_doc_writable(p_node bigint, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (
    select 1 from public.goal_nodes n join public.rooms r on r.id = n.room_id
    where n.id = p_node and n.archived_at is null and r.archived_at is null and (
      case when n.task_type = 'PERSONAL' then
        n.owner_id = p_uid and r.status in ('RECRUIT', 'ACTIVE') and public.personal_eligible(r.id, p_uid)
      else
        r.status in ('DRAFT', 'RECRUIT', 'ACTIVE') and public.can_edit_curriculum(r, p_uid)
      end))
$$;

-- 정책용 래퍼 — 정규식을 먼저 보고 나서 캐스트한다(정책 식의 AND 평가 순서에 기대지 않는다)
create or replace function public.node_doc_object_writable(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_seg text[]; v_node bigint;
begin
  if not public.node_doc_key_ok(p_name) then return false; end if;
  v_seg := string_to_array(p_name, '/');
  v_node := v_seg[3]::bigint;
  return exists (select 1 from public.goal_nodes n where n.id = v_node and n.room_id::text = v_seg[2])
     and public.node_doc_writable(v_node, public.current_user_id());
end $$;

-- 서명(SELECT): 그 경로의 files 행이 저장된 READY NODE_DOC 이고 읽기 권한이 있을 때만 — 미저장 객체는 아무도 못 연다
create or replace function public.node_doc_object_readable(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.node_doc_key_ok(p_name) then return false; end if;
  return exists (select 1 from public.files f
                 where f.object_path = p_name and f.bucket_id = 'attachments' and f.purpose = 'NODE_DOC'
                   and f.status = 'READY' and f.attached_at is not null
                   and public.node_doc_readable(f.node_id, public.current_user_id()));
end $$;

create or replace function public.node_doc_readable_me(p_node bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.node_doc_readable(p_node, public.current_user_id())
$$;

-- ───────── ③ Storage 정책 (DELETE 정책 없음 — 클라이언트는 객체를 지우지 않는다) ─────────
create policy attachments_insert_node_doc on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.node_doc_object_writable(name));
create policy attachments_select_node_doc on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.node_doc_object_readable(name));

-- ───────── ④ files_select (0003 판 + NODE_DOC). 세 번째 갈래를 ATTACHMENT 로 좁혀도 기존 동작 동일(COVER 는 node_id 없음) ─────────
drop policy files_select on public.files;
create policy files_select on public.files for select
  using (owner_user_id = (select public.current_user_id())
         or (purpose = 'COVER' and room_id is not null and public.can_read_room(room_id))
         or (purpose = 'ATTACHMENT' and node_id is not null and public.can_read_submission(node_id, owner_user_id))
         or (purpose = 'NODE_DOC' and status = 'READY' and attached_at is not null and node_id is not null
             and public.node_doc_readable_me(node_id)));

-- ───────── ⑤ 삭제 트리거 — node_delete 서브트리·personal_delete·방 cascade·이후 마이그레이션의 어떤 삭제든 ─────────
-- FK files.node_id ON DELETE SET NULL 보다 먼저(BEFORE) 표시해 둔다. 객체는 cleanup-files 가 지운다
create or replace function public.goal_nodes_doc_release() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.files set status = 'DELETED', deleted_at = now()
   where node_id = old.id and purpose = 'NODE_DOC' and status = 'READY';   -- NODE_DOC 은 PENDING 이 없다(등록이 곧 READY) → ix_files_node_doc 를 탄다
  return old;
end $$;
create trigger trg_goal_nodes_doc_release before delete on public.goal_nodes
  for each row execute function public.goal_nodes_doc_release();

-- GRANT (01-decisions D7): 정책이 부르는 래퍼만. files_select 는 anon 질의에도 평가된다
grant execute on function public.node_doc_readable_me(bigint) to anon, authenticated;
grant execute on function public.node_doc_object_writable(text) to authenticated;
grant execute on function public.node_doc_object_readable(text) to authenticated;

-- ───────── ⑥ RPC ─────────
-- 공통 선행(내부, GRANT 없음): 방 잠금(lock-before-hide, 0007 submission_target 과 같은 트레이드오프) → 존재 은닉 → 방 상태 → 보관 → 권한.
-- p_remove_only = 요청이 "빼기만"일 때 — 개인 목표 그룹장 모더레이션(스펙 §5.1·D5)
create or replace function public.node_doc_target(p_node bigint, p_uid uuid, p_remove_only boolean) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare v_room bigint; v_slug text; r public.rooms; n public.goal_nodes;
begin
  select room_id into v_room from public.goal_nodes where id = p_node;
  if not found then perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', coalesce(p_node::text, ''))); end if;
  select slug into v_slug from public.rooms where id = v_room;
  r := public.room_lock(v_slug);
  select * into n from public.goal_nodes where id = p_node;
  if not found then perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', p_node::text)); end if;

  if n.task_type = 'PERSONAL' then
    if not public.room_readable(r.id, p_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
    if n.owner_id is distinct from p_uid and not public.personal_viewer(r.id, p_uid) then
      perform public.fail('NODE_NOT_FOUND', '개인 목표를 찾을 수 없어요', jsonb_build_object('nodeId', n.id::text));
    end if;
    if r.archived_at is not null or r.status not in ('RECRUIT', 'ACTIVE') then
      perform public.fail('ROOM_NOT_EDITABLE', '모집 중이거나 진행 중인 스터디에서만 바꿀 수 있어요', jsonb_build_object('status', lower(r.status)));
    end if;
    if n.archived_at is not null then
      perform public.fail('TASK_ARCHIVED', '보관된 목표는 고칠 수 없어요 · 먼저 보관을 해제해 주세요', jsonb_build_object('nodeId', n.id::text));
    end if;
    if n.owner_id = p_uid and public.personal_eligible(r.id, p_uid) then return n; end if;
    if p_remove_only and r.leader_id = p_uid then return n; end if;
    perform public.fail('NOT_OWNER', '본인 개인 목표에만 파일을 붙일 수 있어요');
  end if;

  perform public.require_curriculum_editor(r, p_uid);            -- ROOM_NOT_FOUND / NOT_CURRICULUM_EDITOR
  if r.archived_at is not null or r.status not in ('DRAFT', 'RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_NOT_EDITABLE', '종료되었거나 보관된 방은 편집할 수 없어요', jsonb_build_object('status', lower(r.status)));
  end if;
  if n.archived_at is not null then
    if n.task_type is null then perform public.fail('PARENT_ARCHIVED', '보관된 항목이에요', jsonb_build_object('nodeId', n.id::text)); end if;
    perform public.fail('TASK_ARCHIVED', '보관된 과제는 수정할 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  return n;
end $$;

create or replace function public.node_files_json(p_node bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.file_json(f) order by f.attached_at, f.created_at, f.id), '[]'::jsonb)
  from public.files f
  where f.node_id = p_node and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null
$$;

-- 0019 file_register 와 같은 검증 순서. 다른 점: 권한(node_doc_target), 키(n/…), purpose NODE_DOC, attached_at null, 한도 = 붙은 것 + 내 미저장(24h)
create or replace function public.node_file_register(p_node bigint, p_path text, p_name text, p_mime text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  n      public.goal_nodes;
  v_seg  text[];
  v_id   uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_cnt  int;
  v_meta jsonb;
  v_size bigint;
  v_mime text;
  f      public.files;
begin
  n := public.node_doc_target(p_node, v_uid, false);
  v_seg := string_to_array(coalesce(p_path, ''), '/');
  if not public.node_doc_key_ok(p_path) or v_seg[2] <> n.room_id::text or v_seg[3] <> n.id::text then
    perform public.fail('VALIDATION_FAILED', '첨부 경로가 올바르지 않아요', '{"field":"path"}'::jsonb);
  end if;
  v_id := left(v_seg[4], 36)::uuid;
  if length(v_name) < 1 or length(v_name) > 255 then
    perform public.fail('VALIDATION_FAILED', '파일 이름은 1~255자예요', '{"field":"name"}'::jsonb);
  end if;
  if p_mime is null or not (p_mime = any(public.allowed_mime_types())) then
    perform public.fail('FILE_TYPE_NOT_ALLOWED', '허용되지 않는 파일 형식이에요', jsonb_build_object('field', 'contentType', 'contentType', p_mime));
  end if;
  if p_size is null or p_size < 1 then
    perform public.fail('VALIDATION_FAILED', '파일 크기가 올바르지 않아요', '{"field":"size"}'::jsonb);
  end if;
  if not public.storage_exists('attachments', p_path) then
    perform public.fail('FILE_NOT_READY', '업로드가 아직 끝나지 않았어요', jsonb_build_object('fileId', v_id::text));
  end if;
  -- 키에 업로더 세그먼트가 없으므로 객체 업로더가 나인지 본다(같은 항목의 다른 편집자가 남의 미등록 객체를 가로채지 못하게)
  select o.metadata into v_meta from storage.objects o
   where o.bucket_id = 'attachments' and o.name = p_path and o.owner_id = v_uid::text;
  if not found then
    perform public.fail('FILE_NOT_READY', '업로드가 아직 끝나지 않았어요', jsonb_build_object('fileId', v_id::text));
  end if;
  v_size := coalesce((v_meta ->> 'size')::bigint, p_size);
  v_mime := coalesce(v_meta ->> 'mimetype', p_mime);
  if not (v_mime = any(public.allowed_mime_types())) then
    perform public.fail('FILE_TYPE_NOT_ALLOWED', '허용되지 않는 파일 형식이에요', jsonb_build_object('field', 'contentType', 'contentType', v_mime));
  end if;
  if v_size > 10485760 then
    perform public.fail('FILE_TOO_LARGE', '파일은 10MB까지예요', jsonb_build_object('field', 'size', 'size', v_size));
  end if;
  if exists (select 1 from public.files x where x.id = v_id and x.owner_user_id = v_uid and x.object_path = p_path
               and x.status = 'DELETED' and x.deleted_at <= now() - public.file_purge_grace()) then
    perform public.fail('FILE_NOT_READY', '정리된 파일이에요. 다시 올려 주세요', jsonb_build_object('fileId', v_id::text));
  end if;

  -- 내 미저장(24h 안)만 센다(0019 file_register 와 같음). 붙은 파일 수는 node_files_set 이 5개로 막는다 —
  -- 붙은 5개 중 하나를 편집에서 빼고 새 파일로 바꿔 저장할 수 있어야 하므로 붙은 것은 여기서 세지 않는다
  select count(*) into v_cnt from public.files
  where owner_user_id = v_uid and node_id = n.id and purpose = 'NODE_DOC' and status = 'READY'
    and attached_at is null and created_at > now() - interval '24 hours' and id <> v_id;
  if v_cnt >= public.node_file_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('첨부는 항목당 %s개까지예요', public.node_file_limit()), '{"field":"fileIds"}'::jsonb);
  end if;

  insert into public.files (id, owner_user_id, room_id, node_id, purpose, bucket_id, object_path, original_name, content_type, size_bytes, status, completed_at)
  values (v_id, v_uid, n.room_id, n.id, 'NODE_DOC', 'attachments', p_path, v_name, v_mime, v_size, 'READY', now())
  on conflict (id) do update
    set status = 'READY', completed_at = now(), size_bytes = excluded.size_bytes, deleted_at = null
    where public.files.owner_user_id = excluded.owner_user_id and public.files.node_id = excluded.node_id
      and public.files.object_path = excluded.object_path and public.files.purpose = 'NODE_DOC'
      and public.files.attached_at is null
      and (public.files.status <> 'DELETED' or public.files.deleted_at is null or public.files.deleted_at > now() - public.file_purge_grace())
  returning * into f;
  if f.id is null then perform public.fail('NOT_FOUND', '다른 사용자의 파일 id 예요', jsonb_build_object('fileId', v_id::text)); end if;
  return public.file_json(f);
end $$;

-- 항목의 첨부를 목록대로(집합 의미, 멱등). 새로 붙일 id = 내 미저장 READY(24h 안) ∧ 같은 항목 ∧ Storage 실재. 빠진 붙은 파일 → DELETED.
-- 목록이 현재의 부분집합이면 빼기만(그룹장 모더레이션 허용). 그룹장은 미저장 파일을 만들 수 없으므로 잠금 전후 경합에도 추가는 막힌다
create or replace function public.node_files_set(p_node bigint, p_file_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_ids uuid[] := coalesce(p_file_ids, '{}');
  v_cur uuid[];
  n     public.goal_nodes;
  v_fid uuid;
begin
  if exists (select 1 from unnest(v_ids) x where x is null)
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    perform public.fail('VALIDATION_FAILED', '같은 파일이 두 번 들어 있어요', '{"field":"fileIds"}'::jsonb);
  end if;
  if cardinality(v_ids) > public.node_file_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('첨부는 항목당 %s개까지예요', public.node_file_limit()), '{"field":"fileIds"}'::jsonb);
  end if;
  select coalesce(array_agg(f.id), '{}') into v_cur from public.files f
  where f.node_id = p_node and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null;
  n := public.node_doc_target(p_node, v_uid, v_ids <@ v_cur);
  -- 잠근 뒤 다시 읽는다
  select coalesce(array_agg(f.id), '{}') into v_cur from public.files f
  where f.node_id = n.id and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null;
  foreach v_fid in array v_ids loop
    continue when v_fid = any(v_cur);
    if not exists (select 1 from public.files f
                   where f.id = v_fid and f.owner_user_id = v_uid and f.node_id = n.id and f.purpose = 'NODE_DOC'
                     and f.status = 'READY' and f.attached_at is null
                     and f.created_at > now() - interval '24 hours'          -- 한도·job_cleanup 과 같은 창(정리 직전 경합 방지)
                     and public.storage_exists(f.bucket_id, f.object_path)) then
      perform public.fail('FILE_NOT_READY', '이 파일을 다시 올려 주세요', jsonb_build_object('fileId', v_fid::text));
    end if;
  end loop;
  update public.files set status = 'DELETED', deleted_at = now() where id = any(v_cur) and not (id = any(v_ids));
  update public.files set attached_at = now() where id = any(v_ids) and attached_at is null;
  return public.node_files_json(n.id);
end $$;

-- 0015 file_discard 의 NODE_DOC 판: 내 미저장 파일을 한도에서 뺀다. 붙은 파일은 편집에서 빼고 저장(node_files_set)
create or replace function public.node_file_discard(p_file uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); f public.files;
begin
  select * into f from public.files where id = p_file and owner_user_id = v_uid and purpose = 'NODE_DOC' for update;
  if not found then perform public.fail('NOT_FOUND', '첨부 파일을 찾을 수 없어요', jsonb_build_object('fileId', p_file::text)); end if;
  if f.attached_at is not null and f.status <> 'DELETED' then
    perform public.fail('FILE_ATTACHED', '항목에 붙은 파일은 편집에서 빼고 저장해 주세요', jsonb_build_object('fileId', p_file::text));
  end if;
  if f.status <> 'DELETED' then update public.files set status = 'DELETED', deleted_at = now() where id = p_file; end if;
  return jsonb_build_object('id', p_file::text, 'status', 'deleted');
end $$;

create or replace function public.node_files(p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  if not public.node_doc_readable(p_node, v_uid) then
    perform public.fail('NODE_NOT_FOUND', '항목을 찾을 수 없어요', jsonb_build_object('nodeId', coalesce(p_node::text, '')));
  end if;
  return public.node_files_json(p_node);
end $$;

grant execute on function public.node_file_register(bigint, text, text, text, bigint) to authenticated;
grant execute on function public.node_files_set(bigint, uuid[]) to authenticated;
grant execute on function public.node_file_discard(uuid) to authenticated;
grant execute on function public.node_files(bigint) to authenticated;

-- ───────── ⑦ job_cleanup (0008 판 + NODE_DOC 두 줄). GRANT 하지 않는다(01-decisions D7) ─────────
create or replace function public.job_cleanup() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_expired int; v_orphans int; v_mail int; v_docs int; v_lost int;
begin
  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'PENDING' and created_at < now() - interval '1 hour';
  get diagnostics v_expired = row_count;

  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'READY' and purpose = 'ATTACHMENT' and submission_id is null and created_at < now() - interval '24 hours';
  get diagnostics v_orphans = row_count;

  -- 0030: 올리고 저장하지 않은 항목 첨부 24h · 노드를 잃은 항목 첨부(트리거 안전망)
  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'READY' and purpose = 'NODE_DOC' and attached_at is null and created_at < now() - interval '24 hours';
  get diagnostics v_docs = row_count;
  update public.files set status = 'DELETED', deleted_at = now()
  where status = 'READY' and purpose = 'NODE_DOC' and node_id is null;
  get diagnostics v_lost = row_count;

  delete from public.mail_outbox where status = 'SENT' and sent_at < now() - interval '30 days';
  get diagnostics v_mail = row_count;

  return jsonb_build_object('filesExpired', v_expired, 'orphansExpired', v_orphans, 'mailPurged', v_mail,
                            'nodeDocsExpired', v_docs + v_lost);
end $$;
