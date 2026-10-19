-- 0031_orphan_objects.sql — 올렸지만 등록되지 않은 Storage 객체(= public.files 행이 아예 없는 객체) 정리 후보
-- 배포 후 수정 금지. 담는 것:
--   1) file_orphan_grace(): 고아로 보기까지의 유예 24시간 — 이 값 한 곳에서만 정의한다
--   2) file_orphan_candidates(limit): Edge Function cleanup-files 가 Storage API 로 지울 고아 객체(service_role 전용)
--   3) file_register(0019 판)·node_file_register(0030 판) 재정의 — 고아 정리와의 등록 경합 차단(아래 3)
-- cron(0019 cleanup_files 45 19 * * * UTC)·Vault 시크릿은 그대로 — 같은 호출에서 함께 처리한다.
--
-- 고아가 생기는 길: 업로드 후 file_register / node_file_register 실패·이탈(탭 닫기·네트워크), 방 삭제로 files 행이 지워진 경우 등.
--   기존 정리(0008 job_cleanup → DELETED, 0019 file_purge_candidates → 객체·행 삭제)는 files 행이 있는 객체만 다룬다.
--
-- 왜 24시간인가: 고아 = 행이 전혀 없음 → 유예는 "업로드 → 등록" 지연만 덮으면 된다(클라이언트는 업로드 직후 바로 등록).
--   등록에는 마감이 없으므로(storage_exists 만 본다) 넉넉히, 다른 업로드 창들과 같은 24h 로 맞춘다
--   (0019 file_register 의 업로드 중 묶음 24h·0030 미저장 NODE_DOC 24h·job_cleanup 고아 24h). 등록된 객체는 행이 있으므로
--   미저장 24h 창과 무관하게 이 후보에 들어오지 않는다(그쪽은 job_cleanup → DELETED → file_purge 경로).
--   경합: 후보 SELECT 와 Storage remove 사이에 24h 넘은 객체를 등록하면 READY 행만 남는다 → 3) 에서 행이 없는 객체가
--   (유예 − 1h) = 23h 보다 오래됐으면 등록을 거부한다(1h 여유 > 한 번의 정리 실행 시간). 행이 있는 재등록은 영향 없음.
--
-- 대상 키는 알려진 두 모양만(그 밖의 키는 건드리지 않는다 — 수동으로 올린 것·placeholder 보호):
--   제출 첨부 {room}/{node}/{user uuid}/{uuid}.{ext}  (0003 attachments_insert_assignee, 0019 file_register)
--   항목 첨부 n/{room}/{node}/{uuid}.{ext}           (0030 node_doc_key_ok)

-- ───────── 1) 유예 ─────────
create or replace function public.file_orphan_grace() returns interval
language sql immutable set search_path = '' as $$ select interval '24 hours' $$;

-- ───────── 2) 고아 후보 ─────────
-- files.object_path 는 UNIQUE(0001) → not exists 가 인덱스로 간다. 오래된 순, limit 1~1000(기본 500, file_purge_candidates 와 같음).
create or replace function public.file_orphan_candidates(p_limit int) returns table (bucket_id text, object_path text)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id, o.name from storage.objects o
  where o.bucket_id = 'attachments'
    and o.created_at <= now() - public.file_orphan_grace()
    and (o.name ~ '^[1-9][0-9]{0,17}/[1-9][0-9]{0,17}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$'
         or public.node_doc_key_ok(o.name))
    and not exists (select 1 from public.files f where f.object_path = o.name)   -- 버킷 무관: 같은 경로의 행이 하나라도 있으면 남긴다
  order by o.created_at, o.name
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

-- D7: anon/authenticated 에는 주지 않는다(0002 default privileges 에 더해 명시). Edge Function 의 service_role 만.
revoke execute on function public.file_orphan_grace() from public, anon, authenticated;
revoke execute on function public.file_orphan_candidates(int) from public, anon, authenticated;
grant execute on function public.file_orphan_candidates(int) to service_role;

-- ───────── 3) 등록 경합 차단 ─────────
-- 원본: file_register ← 0019(0020~0030 재정의 없음, grep), node_file_register ← 0030. 그대로 복사하고 storage_exists 검사 뒤에
-- "0031:" 블록 하나만 더한다. 시그니처 동일 → GRANT(0007·0030 의 authenticated) 유지.
create or replace function public.file_register(p_node bigint, p_path text, p_name text, p_mime text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  n      public.goal_nodes;
  r      public.rooms;
  v_seg  text[];
  v_id   uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_cnt  int;
  v_meta jsonb;
  v_size bigint;
  v_mime text;
  f      public.files;
begin
  -- 잠금·은닉·방 ACTIVE·보관·리프·담당자 검사는 submission_upsert 와 공통(A2)
  n := public.submission_target(p_node, v_uid);
  select * into r from public.rooms where id = n.room_id;

  v_seg := string_to_array(coalesce(p_path, ''), '/');
  if cardinality(v_seg) <> 4 or v_seg[1] <> r.id::text or v_seg[2] <> n.id::text or v_seg[3] <> v_uid::text
     or v_seg[4] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$' then
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
  -- 0031: 고아 정리와의 경합 차단 — 행이 아직 없는 객체가 (유예 − 1h) 보다 오래됐으면 등록 거부(cleanup-files 가 지우는 중일 수 있음)
  if not exists (select 1 from public.files x where x.object_path = p_path)
     and exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = p_path
                   and o.created_at <= now() - (public.file_orphan_grace() - interval '1 hour')) then
    perform public.fail('FILE_NOT_READY', '오래된 업로드예요. 다시 올려 주세요', jsonb_build_object('fileId', v_id::text));
  end if;
  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'attachments' and o.name = p_path;
  v_size := coalesce((v_meta ->> 'size')::bigint, p_size);
  -- 저장하는 MIME 은 Storage 가 기록한 값을 우선한다(둘 다 화이트리스트 통과)
  v_mime := coalesce(v_meta ->> 'mimetype', p_mime);
  if not (v_mime = any(public.allowed_mime_types())) then
    perform public.fail('FILE_TYPE_NOT_ALLOWED', '허용되지 않는 파일 형식이에요', jsonb_build_object('field', 'contentType', 'contentType', v_mime));
  end if;
  if v_size > 10485760 then
    perform public.fail('FILE_TOO_LARGE', '파일은 10MB까지예요', jsonb_build_object('field', 'size', 'size', v_size));
  end if;

  -- 업로드 중 묶음(제출 미연결, 24시간 이내)만 센다. 연결된 파일 수는 submission_upsert 가, 오래된 고아는 job_cleanup 이 맡는다(S3)
  select count(*) into v_cnt from public.files
  where owner_user_id = v_uid and node_id = n.id and purpose = 'ATTACHMENT' and status in ('PENDING', 'READY')
    and submission_id is null and created_at > now() - interval '24 hours' and id <> v_id;
  if v_cnt >= 5 then perform public.fail('FILE_LIMIT_EXCEEDED', '첨부는 과제당 5개까지예요', '{"field":"fileIds"}'::jsonb); end if;

  -- 0019: 정리 유예가 지난 DELETED 행은 되살리지 않는다 — cleanup-files 가 그 객체를 지우는 중일 수 있다(같은 유예 = file_purge_grace).
  --   본인·같은 경로일 때만 구분해 알린다(남의 id 는 아래 on conflict 가 NOT_FOUND 로 은닉). 클라이언트는 FILE_NOT_READY 를 "다시 올려 주세요"로 보여 주고 새 id 로 올린다.
  if exists (select 1 from public.files x where x.id = v_id and x.owner_user_id = v_uid and x.object_path = p_path
               and x.status = 'DELETED' and x.deleted_at <= now() - public.file_purge_grace()) then
    perform public.fail('FILE_NOT_READY', '정리된 파일이에요. 다시 올려 주세요', jsonb_build_object('fileId', v_id::text));
  end if;

  insert into public.files (id, owner_user_id, room_id, node_id, purpose, bucket_id, object_path, original_name, content_type, size_bytes, status, completed_at)
  values (v_id, v_uid, r.id, n.id, 'ATTACHMENT', 'attachments', p_path, v_name, v_mime, v_size, 'READY', now())
  on conflict (id) do update
    set status = 'READY', completed_at = now(), size_bytes = excluded.size_bytes, deleted_at = null
    where public.files.owner_user_id = excluded.owner_user_id and public.files.node_id = excluded.node_id
      and public.files.object_path = excluded.object_path
      and (public.files.status <> 'DELETED' or public.files.deleted_at is null or public.files.deleted_at > now() - public.file_purge_grace())
  returning * into f;
  if f.id is null then perform public.fail('NOT_FOUND', '다른 사용자의 파일 id 예요', jsonb_build_object('fileId', v_id::text)); end if;
  return public.file_json(f);
end $$;

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
  -- 0031: 고아 정리와의 경합 차단 — 행이 아직 없는 객체가 (유예 − 1h) 보다 오래됐으면 등록 거부(cleanup-files 가 지우는 중일 수 있음)
  if not exists (select 1 from public.files x where x.object_path = p_path)
     and exists (select 1 from storage.objects o where o.bucket_id = 'attachments' and o.name = p_path
                   and o.created_at <= now() - (public.file_orphan_grace() - interval '1 hour')) then
    perform public.fail('FILE_NOT_READY', '오래된 업로드예요. 다시 올려 주세요', jsonb_build_object('fileId', v_id::text));
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
