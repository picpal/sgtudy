-- 0019_cleanup_files_cron.sql — 첨부 Storage 정리(0008 job_cleanup·0015 file_discard 주석의 2단계)
-- 배포 후 수정 금지. 담는 것:
--   1) file_purge_grace(): DELETED 후 정리까지의 유예 — 이 값 한 곳에서만 정의한다(cleanup-files·file_register 가 같이 쓴다)
--   2) file_purge_candidates(limit): Edge Function cleanup-files 가 고르는 정리 대상(service_role 전용)
--   3) file_register 재정의(0007 판 복사 + 유예 지난 DELETED 행 되살리기 금지) — 정리 중인 객체를 READY 로 되살리는 경쟁 제거
--   4) pg_cron → pg_net 으로 cleanup-files 하루 1회 호출
-- 시크릿은 마이그레이션에 쓰지 않는다: Vault 의 두 이름만 참조한다(값은 호스팅에서 넣는다).
--   cleanup_files_url    = https://<project-ref>.supabase.co/functions/v1/cleanup-files
--   cleanup_files_secret = Edge Function 시크릿 CLEANUP_FILES_SECRET 과 같은 값(x-cleanup-secret 헤더)
-- PGlite(supabase/tests 하니스)에는 pg_net 이 없다 → 확장·잡 등록은 pg_net 이 있을 때만(없으면 notice).

-- ───────── 1) 유예 ─────────
-- 0007 file_register 는 같은 id·경로를 다시 등록하면 DELETED 행을 READY 로 되살린다. 유예 안에서는 그대로 두고(재시도·실수 복구),
-- 유예가 지나면 정리 대상 — 되살리지 않는다(3).
create or replace function public.file_purge_grace() returns interval
language sql immutable set search_path = '' as $$ select interval '1 hour' $$;

-- ───────── 2) 정리 후보 ─────────
create or replace function public.file_purge_candidates(p_limit int) returns table (id uuid, bucket_id text, object_path text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.bucket_id, f.object_path from public.files f
  where f.status = 'DELETED' and f.deleted_at <= now() - public.file_purge_grace()
  order by f.deleted_at, f.id
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;
-- D7: anon/authenticated 에는 주지 않는다(0002 default privileges). Edge Function 의 service_role 만.
grant execute on function public.file_purge_candidates(int) to service_role;

-- ───────── 3) file_register (0007 판 + 유예 규칙) ─────────
-- 0007 이후 재정의 없음(0008~0018 grep) → 0007 판을 그대로 옮기고 두 곳만 바꾼다(아래 "0019:" 주석). GRANT 는 0007 의 것이 유지된다.
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


-- ───────── 4) 예약 실행 ─────────
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- pg_net 은 비동기: 요청을 큐에 넣고 id 를 돌려준다(응답은 net._http_response — 일부 실패면 status_code 207, 전부 실패 500).
create or replace function public.job_cleanup_files() returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
begin
  select s.decrypted_secret into v_url    from vault.decrypted_secrets s where s.name = 'cleanup_files_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'cleanup_files_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise warning 'job_cleanup_files: vault secret cleanup_files_url / cleanup_files_secret 없음 — 건너뜀';
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cleanup-secret', v_secret),
    timeout_milliseconds := 60000);
end $$;
-- GRANT 하지 않는다(D7, 0008 job_* 와 같음). pg_cron 은 postgres 로 실행한다.

-- 04:45 KST = 19:45 UTC: job_cleanup(04:00) 뒤, member_count_audit(04:32) 와 겹치지 않게.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('cleanup_files', '45 19 * * *', 'select public.job_cleanup_files()');
  else
    raise notice 'cleanup_files: pg_net 없음 — cron 잡 미등록 (적용 후 cron.job 에서 cleanup_files 를 꼭 확인)';
  end if;
end $$;
