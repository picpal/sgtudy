-- 0031_orphan_objects.sql — 올렸지만 등록되지 않은 Storage 객체(= public.files 행이 아예 없는 객체) 정리 후보
-- 배포 후 수정 금지. 담는 것:
--   1) file_orphan_grace(): 고아로 보기까지의 유예 24시간 — 이 값 한 곳에서만 정의한다
--   2) file_orphan_candidates(limit): Edge Function cleanup-files 가 Storage API 로 지울 고아 객체(service_role 전용)
-- 재정의하는 기존 함수 없음. cron(0019 cleanup_files 45 19 * * * UTC)·Vault 시크릿은 그대로 — 같은 호출에서 함께 처리한다.
--
-- 고아가 생기는 길: 업로드 후 file_register / node_file_register 실패·이탈(탭 닫기·네트워크), 방 삭제로 files 행이 지워진 경우 등.
--   기존 정리(0008 job_cleanup → DELETED, 0019 file_purge_candidates → 객체·행 삭제)는 files 행이 있는 객체만 다룬다.
--
-- 왜 24시간인가: 고아 = 행이 전혀 없음 → 유예는 "업로드 → 등록" 지연만 덮으면 된다(클라이언트는 업로드 직후 바로 등록).
--   등록에는 마감이 없으므로(storage_exists 만 본다) 넉넉히, 다른 업로드 창들과 같은 24h 로 맞춘다
--   (0019 file_register 의 업로드 중 묶음 24h·0030 미저장 NODE_DOC 24h·job_cleanup 고아 24h). 등록된 객체는 행이 있으므로
--   미저장 24h 창과 무관하게 이 후보에 들어오지 않는다(그쪽은 job_cleanup → DELETED → file_purge 경로).
--   남는 경합: 24h 넘게 묵힌 객체를 정리 실행과 같은 순간에 등록하면 READY 행이 객체 없이 남을 수 있다 — 클라이언트 흐름상 사실상 없음.
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
    and not exists (select 1 from public.files f where f.object_path = o.name and f.bucket_id = o.bucket_id)
  order by o.created_at, o.name
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

-- D7: anon/authenticated 에는 주지 않는다(0002 default privileges 에 더해 명시). Edge Function 의 service_role 만.
revoke execute on function public.file_orphan_grace() from public, anon, authenticated;
revoke execute on function public.file_orphan_candidates(int) from public, anon, authenticated;
grant execute on function public.file_orphan_candidates(int) to service_role;
