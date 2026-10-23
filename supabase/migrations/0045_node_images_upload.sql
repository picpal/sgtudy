-- 0045_node_images_upload.sql — 2026-10-23 노드 첨부 그림(종류별 한도·SVG) · MCP 그림 업로드(2단계 서명 업로드). 배포 후 수정 금지.
-- 스펙: docs/superpowers/specs/2026-10-23-md-images-attachments-design.md (D18~D31, §3.3)
-- 담는 것: ① 한도·목록 헬퍼 + 버킷 MIME(+SVG) ② node_file_register 재정의(노드 MIME·SVG 2MB·미저장 한도 종류별)
--   ③ node_files_set 2인자 재정의(종류별 한도) + 3인자 판 신규(p_base, D30) — 공통 본문은 내부 node_files_set_core
--   ④ 업로드 티켓 표 ⑤ anon Storage 정책 2개(열린 티켓의 그 경로만) ⑥ node_upload_prepare·node_upload_commit(내부, api_invoke 만)
--   ⑦ api_scope_of·api_invoke 재정의(+2 op)
-- 재정의 원본: node_file_register ←0031 · node_files_set(bigint, uuid[]) ←0030 · api_scope_of·api_invoke ←0037 (0038~0044·0046 재정의 없음)
-- 재정의하지 않는 것: api_rate_check·api_limits·job_cleanup·file_register·node_doc_target·file_orphan_candidates·files_select 정책·allowed_mime_types
-- 0046 과 독립(0046 은 files·Storage·api_invoke 를 건드리지 않는다).
-- C0 실측(로컬 storage-api v1.80.2): createSignedUploadUrl 은 호출자(anon)의 INSERT RLS 로 판정하고, 서명 URL 로 PUT 할 때는
--   RLS 를 다시 보지 않는다(티켓을 닫은 뒤에도 2시간 안이면 한 번 올라간다 — 완료는 티켓이 막고, 그런 객체는 고아 정리 대상).
--   덮어쓰기는 x-upsert 와 무관하게 409. anon 업로드 객체는 owner_id 가 비어 있다 → 완료는 업로더가 아니라 티켓 주인을 본다.

-- ───────── ① 한도·목록 (D12·D18·D19) ─────────
create or replace function public.node_image_mime_types() returns text[]
language sql immutable set search_path = '' as $$
  select array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
$$;

-- 노드 첨부만 SVG 를 더 받는다. 제출 첨부(file_register)는 allowed_mime_types() 그대로
create or replace function public.node_doc_mime_types() returns text[]
language sql immutable set search_path = '' as $$
  select public.allowed_mime_types() || array['image/svg+xml']
$$;

-- node_file_limit()=5 는 이제 "그림이 아닌 파일" 한도(값·함수 그대로)
create or replace function public.node_image_limit() returns int
language sql immutable set search_path = '' as $$ select 20 $$;

create or replace function public.node_svg_max_bytes() returns bigint
language sql immutable set search_path = '' as $$ select 2097152::bigint $$;

-- 종류별 한도 판정(내부). 행이 없는 id 는 "그림 아님"으로 센다 — 어차피 FILE_NOT_READY 로 끝나지만, 큰 배열을 잠금 전에 끊는다
create or replace function public.node_files_limit_check(p_ids uuid[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_img int;
begin
  select count(*) into v_img from public.files f
  where f.id = any(p_ids) and f.content_type = any(public.node_image_mime_types());
  if v_img > public.node_image_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('그림은 항목당 %s개까지예요', public.node_image_limit()),
                        jsonb_build_object('field', 'fileIds', 'kind', 'image', 'max', public.node_image_limit()));
  end if;
  if cardinality(p_ids) - v_img > public.node_file_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('파일은 항목당 %s개까지예요', public.node_file_limit()),
                        jsonb_build_object('field', 'fileIds', 'kind', 'file', 'max', public.node_file_limit()));
  end if;
end $$;

-- 버킷은 전역 목록 — SVG 를 더한다(멱등). config.toml 의 로컬 버킷 정의도 같이 바꾼다
update storage.buckets set allowed_mime_types = allowed_mime_types || array['image/svg+xml']
where id = 'attachments' and not ('image/svg+xml' = any(coalesce(allowed_mime_types, '{}')));

-- ───────── ② node_file_register (0031 판 + 표시한 곳) ─────────
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
  v_img  boolean;   -- 0045
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
  if p_mime is null or not (p_mime = any(public.node_doc_mime_types())) then                       -- 0045: 노드 목록(+SVG)
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
  if not (v_mime = any(public.node_doc_mime_types())) then                                          -- 0045
    perform public.fail('FILE_TYPE_NOT_ALLOWED', '허용되지 않는 파일 형식이에요', jsonb_build_object('field', 'contentType', 'contentType', v_mime));
  end if;
  if v_size > 10485760 then
    perform public.fail('FILE_TOO_LARGE', '파일은 10MB까지예요', jsonb_build_object('field', 'size', 'size', v_size));
  end if;
  if v_mime = 'image/svg+xml' and v_size > public.node_svg_max_bytes() then                         -- 0045: SVG 2MB
    perform public.fail('FILE_TOO_LARGE', 'SVG 는 2MB까지예요', jsonb_build_object('field', 'size', 'size', v_size));
  end if;
  if exists (select 1 from public.files x where x.id = v_id and x.owner_user_id = v_uid and x.object_path = p_path
               and x.status = 'DELETED' and x.deleted_at <= now() - public.file_purge_grace()) then
    perform public.fail('FILE_NOT_READY', '정리된 파일이에요. 다시 올려 주세요', jsonb_build_object('fileId', v_id::text));
  end if;

  -- 내 미저장(24h 안)만 센다(0019 file_register 와 같음). 붙은 파일 수는 node_files_set 이 막는다 —
  -- 붙은 것 중 하나를 편집에서 빼고 새 파일로 바꿔 저장할 수 있어야 하므로 붙은 것은 여기서 세지 않는다
  -- 0045: 종류별(그림 20 / 그 밖 5)
  v_img := v_mime = any(public.node_image_mime_types());
  select count(*) into v_cnt from public.files
  where owner_user_id = v_uid and node_id = n.id and purpose = 'NODE_DOC' and status = 'READY'
    and attached_at is null and created_at > now() - interval '24 hours' and id <> v_id
    and (content_type = any(public.node_image_mime_types())) = v_img;
  if v_img and v_cnt >= public.node_image_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('그림은 항목당 %s개까지예요', public.node_image_limit()), '{"field":"fileIds","kind":"image"}'::jsonb);
  end if;
  if not v_img and v_cnt >= public.node_file_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('파일은 항목당 %s개까지예요', public.node_file_limit()), '{"field":"fileIds","kind":"file"}'::jsonb);
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

-- ───────── ③ node_files_set (0030 판 본문 → core) ─────────
-- p_base null = 2인자 판(목록이 곧 결과 — 빠진 붙은 파일은 모두 지운다).
-- p_base 있음 = 3인자 판(D30): 지우는 것은 base − ids 뿐, base 에 없던(편집 중 MCP 등이 붙인) 파일은 남긴다. 한도는 합친 결과로 센다
create or replace function public.node_files_set_core(p_node bigint, p_file_ids uuid[], p_base uuid[]) returns jsonb
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
  if p_base is not null and exists (select 1 from unnest(p_base) x where x is null) then
    perform public.fail('VALIDATION_FAILED', '기준 목록이 올바르지 않아요', '{"field":"baseIds"}'::jsonb);
  end if;
  perform public.node_files_limit_check(v_ids);                                                     -- 0045: 종류별(잠금 전 빠른 거부)
  select coalesce(array_agg(f.id), '{}') into v_cur from public.files f
  where f.node_id = p_node and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null;
  n := public.node_doc_target(p_node, v_uid, v_ids <@ v_cur);   -- base 로 남길 것은 v_cur 의 부분이라 "빼기만" 판정은 v_ids 로 같다
  -- 잠근 뒤 다시 읽는다
  select coalesce(array_agg(f.id), '{}') into v_cur from public.files f
  where f.node_id = n.id and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null;
  if p_base is not null then                                                                         -- 0045 (D30)
    v_ids := v_ids || coalesce((select array_agg(x) from unnest(v_cur) x where not (x = any(p_base)) and not (x = any(v_ids))), '{}');
  end if;
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
  perform public.node_files_limit_check(v_ids);                                                     -- 0045: 합친 결과로
  update public.files set status = 'DELETED', deleted_at = now() where id = any(v_cur) and not (id = any(v_ids));
  update public.files set attached_at = now() where id = any(v_ids) and attached_at is null;
  return public.node_files_json(n.id);
end $$;

-- 2인자 판: 시그니처 그대로(GRANT 유지) — 본문만 core 로
create or replace function public.node_files_set(p_node bigint, p_file_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.node_files_set_core(p_node, p_file_ids, null);
end $$;

-- 3인자 판(D30): 웹 편집 저장 경로. p_base = 편집을 시작할 때 붙어 있던 id
create or replace function public.node_files_set(p_node bigint, p_file_ids uuid[], p_base uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_base is null then perform public.fail('VALIDATION_FAILED', '기준 목록이 필요해요', '{"field":"baseIds"}'::jsonb); end if;
  return public.node_files_set_core(p_node, p_file_ids, p_base);
end $$;

grant execute on function public.node_files_set(bigint, uuid[], uuid[]) to authenticated;

-- ───────── ④ 업로드 티켓 (D22) — RPC 전용 ─────────
create table public.node_upload_tickets (
  id           uuid primary key default gen_random_uuid(),                 -- = files.id = 경로의 uuid
  user_id      uuid not null references public.profiles(id) on delete cascade,
  room_id      bigint not null references public.rooms(id) on delete cascade,
  node_id      bigint not null references public.goal_nodes(id) on delete cascade,
  object_path  text not null unique,                                       -- n/{room}/{node}/{id}.{ext}
  file_name    text not null,
  content_type text not null,
  size_bytes   bigint not null,
  replace      boolean not null default false,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,                                       -- 서명 업로드 URL 수명(2h)과 같게
  committed_at timestamptz,
  file_id      uuid
);
create index ix_node_upload_tickets_user on public.node_upload_tickets (user_id, created_at);
alter table public.node_upload_tickets enable row level security;
revoke all on public.node_upload_tickets from anon, authenticated;

-- 정책용(anon): 그 경로의 열린 티켓이 있는가. 경로 uuid(122bit)는 DB 가 발급해 티켓 주인에게만 준다 = 능력 URL(D21)
create or replace function public.node_upload_ticket_open(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.node_upload_tickets t
                 where t.object_path = p_name and t.committed_at is null and t.expires_at > now())
$$;
grant execute on function public.node_upload_ticket_open(text) to anon, authenticated;

-- ───────── ⑤ Storage 정책 (anon, 열린 티켓의 정확한 경로만 · UPDATE/DELETE 없음 = 덮어쓰기 없음) ─────────
create policy attachments_insert_upload_ticket on storage.objects for insert to anon
  with check (bucket_id = 'attachments' and public.node_upload_ticket_open(name));
create policy attachments_select_upload_ticket on storage.objects for select to anon
  using (bucket_id = 'attachments' and public.node_upload_ticket_open(name));

-- ───────── ⑥ 발급·완료 (내부 — api_invoke 만 부른다, GRANT 없음) ─────────
-- 그 노드의 붙은 그림 이름(첨부 순서)
create or replace function public.node_image_names(p_node bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(f.original_name order by f.attached_at, f.created_at, f.id), '[]'::jsonb)
  from public.files f
  where f.node_id = p_node and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null
    and f.content_type = any(public.node_image_mime_types())
$$;

create or replace function public.node_upload_node_json(n public.goal_nodes) returns jsonb
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select g.id, g.parent_id, g.label from public.goal_nodes g where g.id = n.id
    union all
    select g.id, g.parent_id, g.label from public.goal_nodes g join up on g.id = up.parent_id
  )
  select jsonb_build_object('id', n.id::text, 'title', n.title,
                            'round', (select up.label from up where up.parent_id is null))   -- 최상위 = 회차
$$;

-- 같은 이름의 붙은 파일 수(그림만 / 전부)
create or replace function public.node_upload_same_name(p_node bigint, p_name text, p_images_only boolean) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.files f
  where f.node_id = p_node and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null
    and f.original_name = p_name and (not p_images_only or f.content_type = any(public.node_image_mime_types()))
$$;

-- 스펙 §3.3 순서. 사용자 잠금 아래 셈(D28, 0041 comment_rate_check 모양)
create or replace function public.node_upload_prepare(p_slug text, p_node bigint, p_name text, p_mime text, p_size bigint, p_replace boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  n       public.goal_nodes;
  v_name  text := coalesce(p_name, '');
  v_ext   text;
  v_canon text;
  v_rep   boolean := coalesce(p_replace, false);
  v_h     int;
  v_open  int;
  v_old   timestamptz;
  v_cnt   int;
  t       public.node_upload_tickets;
begin
  n := public.node_doc_target(p_node, v_uid, false);                        -- 방 잠금 · 존재 은닉 · 권한 · 방 상태 · 보관
  if n.room_id is distinct from (select x.id from public.rooms x where x.slug = p_slug) then
    perform public.fail('NODE_NOT_FOUND', '이 스터디에 그 항목이 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  if n.task_type = 'PERSONAL' then
    perform public.fail('PERSONAL_NODE', '개인 목표에는 그림을 올릴 수 없어요 · 웹에서 올려 주세요', jsonb_build_object('nodeId', n.id::text));
  end if;
  -- D25: 마크다운 조각을 인코딩 없이 쓸 수 있는 이름만
  if v_name !~ '^[^[:space:][:cntrl:]/\\()<>%#?"''\[\]]{1,120}$' then
    perform public.fail('VALIDATION_FAILED', '파일 이름은 1~120자, 공백·/ \ ( ) [ ] < > % # ? 따옴표 없이 써 주세요', '{"field":"fileName"}'::jsonb);
  end if;
  if p_mime is null or not (p_mime = any(public.node_image_mime_types())) then
    perform public.fail('FILE_TYPE_NOT_ALLOWED', '그림(PNG·JPG·GIF·WEBP·SVG)만 올릴 수 있어요 · 다른 파일은 웹에서 올려 주세요',
                        jsonb_build_object('field', 'contentType', 'contentType', p_mime));
  end if;
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]+)$'));
  v_canon := case v_ext when 'png' then 'image/png' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
                        when 'gif' then 'image/gif' when 'webp' then 'image/webp' when 'svg' then 'image/svg+xml' end;
  if v_canon is distinct from p_mime then
    perform public.fail('VALIDATION_FAILED', '파일 확장자가 형식과 맞지 않아요', jsonb_build_object('field', 'fileName', 'contentType', p_mime));
  end if;
  if p_size is null or p_size < 1 then
    perform public.fail('VALIDATION_FAILED', '파일 크기가 올바르지 않아요', '{"field":"size"}'::jsonb);
  end if;
  if p_size > 10485760 then
    perform public.fail('FILE_TOO_LARGE', '파일은 10MB까지예요', jsonb_build_object('field', 'size', 'size', p_size));
  end if;
  if p_mime = 'image/svg+xml' and p_size > public.node_svg_max_bytes() then
    perform public.fail('FILE_TOO_LARGE', 'SVG 는 2MB까지예요', jsonb_build_object('field', 'size', 'size', p_size));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sgtudy.upload:' || v_uid::text, 0));
  delete from public.node_upload_tickets where user_id = v_uid and created_at < now() - interval '1 day';   -- D29 (job_cleanup 재정의 없이)
  select count(*) filter (where created_at > now() - interval '1 hour')::int,
         count(*) filter (where committed_at is null and expires_at > now())::int
    into v_h, v_open
  from public.node_upload_tickets where user_id = v_uid;
  if v_h >= 60 then
    select min(created_at) into v_old from public.node_upload_tickets where user_id = v_uid and created_at > now() - interval '1 hour';
    perform public.fail('RATE_LIMITED', '그림 올리기는 한 시간에 60번까지예요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 hour' - now()))::int), 'window', 'hour'));
  end if;
  if v_open >= 10 then
    select min(expires_at) into v_old from public.node_upload_tickets where user_id = v_uid and committed_at is null and expires_at > now();
    perform public.fail('RATE_LIMITED', '완료하지 않은 그림 올리기가 10개예요 · finish_image_upload 로 먼저 마무리해 주세요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old - now()))::int), 'window', 'open'));
  end if;

  if not v_rep and public.node_upload_same_name(n.id, v_name, false) > 0 then
    perform public.fail('FILE_NAME_TAKEN', '같은 이름의 첨부가 이미 있어요 · 바꾸려면 replace:true 로 다시 준비해 주세요', jsonb_build_object('field', 'fileName'));
  end if;
  -- 한도: 붙은 그림 + 이 노드의 내 열린 티켓 − replace 로 빠질 같은 이름 그림 < 20
  select count(*)::int into v_cnt from public.files f
  where f.node_id = n.id and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null
    and f.content_type = any(public.node_image_mime_types());
  v_cnt := v_cnt + (select count(*)::int from public.node_upload_tickets x
                    where x.user_id = v_uid and x.node_id = n.id and x.committed_at is null and x.expires_at > now())
                 - case when v_rep then public.node_upload_same_name(n.id, v_name, true) else 0 end;
  if v_cnt >= public.node_image_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('그림은 항목당 %s개까지예요', public.node_image_limit()),
                        jsonb_build_object('field', 'fileIds', 'kind', 'image', 'max', public.node_image_limit()));
  end if;

  t.id := gen_random_uuid();
  insert into public.node_upload_tickets (id, user_id, room_id, node_id, object_path, file_name, content_type, size_bytes, replace, expires_at)
  values (t.id, v_uid, n.room_id, n.id,
          format('n/%s/%s/%s.%s', n.room_id, n.id, t.id, case v_canon when 'image/jpeg' then 'jpg' when 'image/svg+xml' then 'svg' else v_ext end),
          v_name, p_mime, p_size, v_rep, now() + interval '2 hours')
  returning * into t;
  return jsonb_build_object('uploadId', t.id::text, 'objectPath', t.object_path, 'fileName', t.file_name,
                            'contentType', t.content_type, 'size', t.size_bytes, 'replace', t.replace,
                            'expiresAt', public.iso(t.expires_at), 'node', public.node_upload_node_json(n));
end $$;

-- 완료(D22·D23·D24). 신고값은 믿지 않고 실물 메타데이터로 다시 본다. 두 번째 완료는 같은 결과(replayed)
create or replace function public.node_upload_commit(p_slug text, p_upload uuid, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  t      public.node_upload_tickets;
  n      public.goal_nodes;
  v_meta jsonb;
  v_size bigint;
  v_mime text;
  v_cnt  int;
  v_rep  jsonb := '[]'::jsonb;
  f      public.files;
begin
  select * into t from public.node_upload_tickets where id = p_upload and user_id = v_uid;
  if not found or t.room_id is distinct from (select x.id from public.rooms x where x.slug = p_slug) then
    perform public.fail('UPLOAD_NOT_FOUND', '그림 올리기 기록을 찾을 수 없어요 · prepare_image_upload 부터 다시 해 주세요');
  end if;
  if t.committed_at is null then
    if t.created_at < now() - interval '3 hours' then
      perform public.fail('UPLOAD_EXPIRED', '그림 올리기 시간이 지났어요 · prepare_image_upload 부터 다시 해 주세요', jsonb_build_object('uploadId', t.id::text));
    end if;
    n := public.node_doc_target(t.node_id, v_uid, false);                   -- 방 잠금(잠금 순서: 사용자 → 방 → 티켓 행) · 권한 재확인
    select * into t from public.node_upload_tickets where id = p_upload for update;
  end if;
  if t.committed_at is not null then
    select * into f from public.files where id = t.file_id;
    return jsonb_build_object('file', case when f.id is not null then public.file_json(f) end, 'replaced', '[]'::jsonb, 'replayed', true,
                              'node', (select public.node_upload_node_json(g) from public.goal_nodes g where g.id = t.node_id),
                              'images', public.node_image_names(t.node_id));
  end if;

  select o.metadata into v_meta from storage.objects o where o.bucket_id = 'attachments' and o.name = t.object_path;
  if not found then
    perform public.fail('FILE_NOT_READY', '아직 업로드가 안 됐어요 — prepare 결과의 curl 을 먼저 실행하세요', jsonb_build_object('uploadId', t.id::text));
  end if;
  v_mime := v_meta ->> 'mimetype';
  v_size := (v_meta ->> 'size')::bigint;
  if v_mime is distinct from t.content_type then
    perform public.fail('FILE_TYPE_NOT_ALLOWED', format('올린 파일 형식(%s)이 준비한 형식(%s)과 달라요', coalesce(v_mime, '?'), t.content_type),
                        jsonb_build_object('field', 'contentType', 'contentType', v_mime));
  end if;
  if v_size is null or v_size < 1 or v_size > 10485760 then
    perform public.fail('FILE_TOO_LARGE', '파일은 10MB까지예요', jsonb_build_object('field', 'size', 'size', v_size));
  end if;
  if v_mime = 'image/svg+xml' and v_size > public.node_svg_max_bytes() then
    perform public.fail('FILE_TOO_LARGE', 'SVG 는 2MB까지예요', jsonb_build_object('field', 'size', 'size', v_size));
  end if;
  if not t.replace and public.node_upload_same_name(t.node_id, t.file_name, false) > 0 then
    perform public.fail('FILE_NAME_TAKEN', '같은 이름의 첨부가 이미 있어요 · 바꾸려면 replace:true 로 다시 준비해 주세요', jsonb_build_object('field', 'fileName'));
  end if;
  select count(*)::int into v_cnt from public.files x
  where x.node_id = t.node_id and x.purpose = 'NODE_DOC' and x.status = 'READY' and x.attached_at is not null
    and x.content_type = any(public.node_image_mime_types());
  v_cnt := v_cnt - case when t.replace then public.node_upload_same_name(t.node_id, t.file_name, true) else 0 end;
  if v_cnt >= public.node_image_limit() then
    perform public.fail('FILE_LIMIT_EXCEEDED', format('그림은 항목당 %s개까지예요', public.node_image_limit()),
                        jsonb_build_object('field', 'fileIds', 'kind', 'image', 'max', public.node_image_limit()));
  end if;
  if coalesce(p_dry, false) then
    return jsonb_build_object('dry', true, 'objectPath', t.object_path, 'contentType', v_mime, 'size', v_size,
                              'node', public.node_upload_node_json(n));
  end if;

  if t.replace then
    with d as (update public.files x set status = 'DELETED', deleted_at = now()
               where x.node_id = t.node_id and x.purpose = 'NODE_DOC' and x.status = 'READY' and x.attached_at is not null
                 and x.original_name = t.file_name
               returning x.id)
    select coalesce(jsonb_agg(d.id::text order by d.id), '[]'::jsonb) into v_rep from d;
  end if;
  insert into public.files (id, owner_user_id, room_id, node_id, purpose, bucket_id, object_path, original_name, content_type, size_bytes,
                            status, completed_at, attached_at)
  values (t.id, v_uid, t.room_id, t.node_id, 'NODE_DOC', 'attachments', t.object_path, t.file_name, v_mime, v_size,
          'READY', now(), now())
  returning * into f;
  update public.node_upload_tickets set committed_at = now(), file_id = f.id where id = t.id;
  return jsonb_build_object('file', public.file_json(f), 'replaced', v_rep, 'replayed', false,
                            'node', public.node_upload_node_json(n), 'images', public.node_image_names(t.node_id));
end $$;

-- ───────── ⑦ api_scope_of (0037 판 + 2) ─────────
create or replace function public.api_scope_of(p_op text) returns text
language sql immutable set search_path = '' as $$
  select case p_op
    when 'whoami'               then 'any'
    when 'me_studies'           then 'read'
    when 'me_schedule'          then 'read'              -- 〔UX 재검토 T2〕 me_tasks 대신(기간 창)
    when 'curriculum_get'       then 'read'
    when 'curriculum_plan_preview' then 'curriculum:write'
    when 'curriculum_plan_apply'   then 'curriculum:write'
    when 'personal_create_many' then 'personal:write'
    when 'personal_delete_many' then 'personal:write'   -- 〔UX 재검토 D16〕
    when 'exam_get_brief'       then 'read'              -- 0037 시험 브리프(편집자만 — 함수가 막는다)
    when 'exam_draft_put'       then 'curriculum:write'  -- 0037 시험 AI 초안
    when 'node_upload_prepare'  then 'curriculum:write'  -- 0045 그림 올리기(D26 — 새 스코프 없음)
    when 'node_upload_commit'   then 'curriculum:write'  -- 0045
  end
$$;

-- ───────── api_invoke (0037 판) — ① study 해석 +2(commit 은 티켓의 방) ② 디스패치 +2 ③ 감사 summary(이름 없음, T12) ─────────
create or replace function public.api_invoke(p_token text, p_op text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t        public.api_tokens;
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
  v_uid    uuid;
  v_source text;
  v_dry    boolean;
  v_room   bigint;
  v_data   jsonb;
  v_out    jsonb;
  v_state  text;
  v_code   text;
  v_msg    text;
  v_hint   text;
  v_ok     boolean;
  v_err    text;
  v_slug   text;
  v_replay boolean := false;
begin
  if octet_length(v_args::text) > 307200 then                                  -- 〔C#11〕 해석·인증 전에 크기부터(라우트 우회 대비)
    perform public.fail('PAYLOAD_TOO_LARGE', '요청이 너무 커요(300KB 까지). 계획을 나눠 주세요');
  end if;
  if jsonb_typeof(v_args) <> 'object' then perform public.fail('VALIDATION_FAILED', '인자가 올바르지 않아요'); end if;
  if p_token is not null then
    if auth.uid() is not null then perform public.fail('API_AUTH_CONFLICT', '토큰과 로그인 세션을 함께 쓸 수 없어요'); end if;
    t := public.api_authenticate(p_token, p_op);
    v_uid := t.user_id;
    v_source := 'PAT';
  else
    v_uid := auth.uid();
    if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
    if public.api_scope_of(p_op) is null then perform public.fail('API_UNKNOWN_OP', '지원하지 않는 작업이에요', jsonb_build_object('op', left(p_op, 40))); end if;
    v_source := case when nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id' is not null then 'OAUTH' else 'SESSION' end;
  end if;
  v_dry := case p_op when 'curriculum_plan_preview' then true when 'curriculum_plan_apply' then false
                     when 'node_upload_commit' then coalesce(v_args ->> 'dry', '') = 'true' end;          -- 0045 (캐스트 없이)
  if p_op = 'curriculum_plan_apply' then                                       -- 〔C#7·N3〕 소유권 확인된 재생은 적용 한도 제외
    perform public.api_user_lock(v_uid);                                       -- ① 사용자(rate check 가 다시 잡아도 즉시)
    select x.slug into v_slug from public.api_plan_drafts d join public.rooms x on x.id = d.room_id
    where d.id = v_args ->> 'previewId' and d.user_id = v_uid;
    if v_slug is not null then perform public.room_lock(v_slug); end if;       -- ② 방(웹 직접 apply 와도 직렬화)
    v_replay := exists (select 1 from public.api_plan_drafts d                 -- ③ 잠금 뒤에 읽는다
                        where d.id = v_args ->> 'previewId' and d.user_id = v_uid and d.applied_at is not null);
    v_slug := null;                                                            --    (아래 디스패치가 다시 정한다)
  end if;
  -- ④ 사용자 잠금 → 집계(그 안). whoami 는 잠금 없이 분당 한도만 — 라우트가 HTTP 요청마다 부른다(〔C#6〕)
  perform public.api_rate_check(t.id, v_uid, p_op, v_dry, v_replay);

  begin
    -- 〔D14〕 스터디 해석: study|slug → slug (apply 는 초안의 방). 해석 오류도 디스패치 오류로 감사된다
    if p_op = 'curriculum_plan_apply' then
      select x.slug, x.id into v_slug, v_room from public.api_plan_drafts d join public.rooms x on x.id = d.room_id
      where d.id = v_args ->> 'previewId' and d.user_id = v_uid;
      if v_slug is null then perform public.fail('PREVIEW_NOT_FOUND', '미리보기를 찾을 수 없어요. 다시 미리 봐 주세요'); end if;
    elsif p_op = 'node_upload_commit' then                                     -- 0045: 티켓의 방(내 티켓만)
      select x.slug, x.id into v_slug, v_room from public.node_upload_tickets k join public.rooms x on x.id = k.room_id
      where k.id::text = lower(coalesce(v_args ->> 'uploadId', '')) and k.user_id = v_uid;
      if v_slug is null then perform public.fail('UPLOAD_NOT_FOUND', '그림 올리기 기록을 찾을 수 없어요 · prepare_image_upload 부터 다시 해 주세요'); end if;
    elsif p_op in ('curriculum_get', 'curriculum_plan_preview', 'personal_create_many', 'personal_delete_many', 'exam_get_brief', 'exam_draft_put',
                   'node_upload_prepare') then
      v_slug := public.api_resolve_study(v_uid, coalesce(v_args ->> 'study', v_args ->> 'slug'));
      select id into v_room from public.rooms where slug = v_slug;
    end if;
    v_data := case p_op
      when 'whoami' then jsonb_build_object('userId', v_uid::text, 'nickname', (select nickname from public.profiles where id = v_uid),
                           'source', lower(v_source), 'tokenName', t.name,
                           'scopes', to_jsonb(coalesce(t.scopes, array['curriculum:write', 'personal:write', 'read'])),
                           'expiresAt', public.iso(t.expires_at))
      when 'me_studies' then public.api_studies(v_uid, coalesce((v_args ->> 'includeEnded')::boolean, false))
      when 'me_schedule' then public.me_schedule((v_args ->> 'from')::date, (v_args ->> 'to')::date)
      when 'curriculum_get' then public.api_curriculum_view(public.curriculum_get(v_slug, coalesce((v_args ->> 'includeArchived')::boolean, false)), v_uid)
        || jsonb_build_object('version', public.curriculum_version(v_room),
             'viewer', jsonb_build_object('nickname', (select nickname from public.profiles where id = v_uid)),
             'currentRoundId', public.room_current_round_id(v_room, public.kst_today())::text,
             'fileCounts', coalesce(public.api_node_file_counts(v_room), '{}'::jsonb),
             'study', (select jsonb_build_object('slug', x.slug, 'title', x.title, 'status', lower(x.status),
                      'startDate', to_char(x.start_date, 'YYYY-MM-DD'), 'endDate', to_char(x.end_date, 'YYYY-MM-DD'))
             from public.rooms x where x.id = v_room))
      when 'curriculum_plan_preview' then public.curriculum_plan_preview(v_slug, v_args -> 'plan', v_args ->> 'undo')
      when 'curriculum_plan_apply' then public.curriculum_plan_apply(v_slug, v_args ->> 'previewId')
      when 'personal_create_many' then public.personal_create_many(v_slug, v_args -> 'round', v_args -> 'goals')
      when 'personal_delete_many' then public.personal_delete_many(v_slug, v_args -> 'ids')
      when 'exam_get_brief' then public.exam_brief_text(v_slug, (v_args ->> 'task')::bigint)
      when 'exam_draft_put' then public.exam_draft_put(v_slug, (v_args ->> 'task')::bigint, v_args -> 'exam')
      when 'node_upload_prepare' then public.node_upload_prepare(v_slug, (v_args ->> 'node')::bigint, v_args ->> 'fileName',
                                        v_args ->> 'contentType', (v_args ->> 'size')::bigint, coalesce((v_args ->> 'replace')::boolean, false))
      when 'node_upload_commit' then public.node_upload_commit(v_slug, (v_args ->> 'uploadId')::uuid, v_dry)
    end;
    v_out := jsonb_build_object('ok', true, 'data', v_data);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_code = message_text, v_msg = pg_exception_detail, v_hint = pg_exception_hint;
    v_data := null;
    v_out := jsonb_build_object('ok', false, 'error', public.api_error_json(v_state, v_code, v_msg, v_hint));
  end;
  v_out := v_out || jsonb_build_object('meta', jsonb_strip_nulls(jsonb_build_object('expiresAt', public.iso(t.expires_at))));   -- 〔T4〕

  if p_op <> 'whoami' then
    v_ok := (v_out ->> 'ok')::boolean and coalesce((v_data ->> 'ok')::boolean, true);
    v_err := coalesce(v_out #>> '{error,code}', v_data #>> '{errors,0,code}');
    insert into public.api_audit (token_id, user_id, source, op, room_id, dry_run, ok, error_code, preview_id, summary, created_at)
    values (t.id, v_uid, v_source, p_op, v_room, v_dry, v_ok, case when not v_ok then left(v_err, 40) end,
            case when p_op like 'curriculum_plan_%' then (select x from (select coalesce(v_data ->> 'previewId', v_args ->> 'previewId') as x) z
                                                           where x ~ '^pv_[0-9a-f]{12}$') end,   -- 입력 그대로 싣지 않는다(형식 맞는 것만)
            case when p_op like 'curriculum_plan_%' then jsonb_strip_nulls(jsonb_build_object('summary', v_data -> 'summary', 'createdIds', v_data -> 'createdIds',   -- refs(사용자 라벨) 대신 id
                                                           'replayed', v_data -> 'replayed', 'undoOf', v_data -> 'undoOf'))
                 when p_op = 'personal_create_many' then jsonb_strip_nulls(jsonb_build_object('createdIds', v_data -> 'createdIds'))
                 when p_op = 'personal_delete_many' then jsonb_strip_nulls(jsonb_build_object(   -- 사용자 입력은 숫자 id 모양만(제목·자유 문자열 없음)
                   'ids', (select jsonb_agg(e) from jsonb_array_elements(case when jsonb_typeof(v_args -> 'ids') = 'array' then v_args -> 'ids' end) e
                           where e #>> '{}' ~ '^[0-9]{1,19}$'),
                   'deleted', v_data -> 'deleted'))
                 when p_op = 'exam_draft_put' then jsonb_strip_nulls(jsonb_build_object(   -- 문항 본문은 싣지 않는다(task id 모양 · 문항 수만)
                   'task', (select x from (select v_args ->> 'task' as x) z where x ~ '^[0-9]{1,19}$'),
                   'questionCount', v_data -> 'questionCount'))
                 when p_op in ('node_upload_prepare', 'node_upload_commit') then jsonb_strip_nulls(jsonb_build_object(   -- 0045: 파일 이름은 싣지 않는다(T12)
                   'node', coalesce(v_data #>> '{node,id}', (select x from (select v_args ->> 'node' as x) z where x ~ '^[0-9]{1,19}$')),
                   'contentType', coalesce(v_data ->> 'contentType', v_data #>> '{file,contentType}'),
                   'size', coalesce(v_data -> 'size', v_data #> '{file,size}'),
                   'replaced', case when p_op = 'node_upload_commit' and v_data ? 'replaced' then jsonb_array_length(v_data -> 'replaced') end,
                   'replayed', v_data -> 'replayed',
                   'dry', case when p_op = 'node_upload_commit' then v_dry end))
                 else '{}'::jsonb end,
            public.app_now());
  end if;
  return v_out;
end $$;
