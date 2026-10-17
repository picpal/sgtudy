-- 0019_cleanup_files_cron.sql — Edge Function cleanup-files 하루 1회 호출 (0008 job_cleanup·0015 file_discard 주석의 2단계)
-- 배포 후 수정 금지. 0010 과 같은 pg_cron 방식 + pg_net 으로 HTTP 호출.
-- 시크릿은 마이그레이션에 쓰지 않는다: Vault 의 두 이름만 참조한다(값은 호스팅에서 vault.create_secret 으로 넣는다).
--   cleanup_files_url    = https://<project-ref>.supabase.co/functions/v1/cleanup-files
--   cleanup_files_secret = Edge Function 시크릿 CLEANUP_FILES_SECRET 과 같은 값(x-cleanup-secret 헤더)
-- Vault 값이 없으면 경고만 내고 건너뛴다(잡은 실패하지 않는다).
-- PGlite(supabase/tests 하니스)에는 pg_net 이 없다 → 확장·잡 등록을 pg_net 이 있을 때만 한다(없으면 호출할 수단도 없다).

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- pg_net 은 비동기: 요청을 큐에 넣고 id 를 돌려준다(응답은 net._http_response 에 남는다). 함수는 시간 상한 안에서 상한 개수만 처리.
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

-- 04:45 KST = 19:45 UTC: job_cleanup(04:00) 이 DELETED 로 바꾼 뒤, member_count_audit(04:32) 와 겹치지 않게.
-- 함수는 DELETED 후 1시간 유예가 지난 행만 지운다 → 그날 04:00 에 DELETED 된 행은 다음 날 정리.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('cleanup_files', '45 19 * * *', 'select public.job_cleanup_files()');
  end if;
end $$;
