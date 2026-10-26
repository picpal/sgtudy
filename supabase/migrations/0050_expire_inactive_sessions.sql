-- 0050_expire_inactive_sessions.sql — 30일 비활성 세션 만료 (pg_cron 하루 1회)
-- 배포 후 수정 금지.
-- 무료 플랜이라 Auth 의 sessions_inactivity_timeout(Pro) 를 못 쓴다 → DB 예약 작업으로 대신한다.
-- 최대 유지 기간(timebox)은 두지 않는다: 30일 안에 한 번이라도 쓰면 계속 유지.
-- 세션 행을 지우면 auth.refresh_tokens·auth.mfa_amr_claims 가 FK on delete cascade 로 같이 지워진다.
-- 사용자는 남은 access token(jwt_exp 3600) 이 끝나는 대로 refresh 실패 → 앱의 세션 만료 흐름(로그인 + 안내)으로 간다.
-- pg_cron 확장은 0010 에서 이미 설치했다.

create or replace function public.job_expire_inactive_sessions() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  -- 비활성 한도: 마지막 활동 후 30일 지나면 만료 (사용자 결정 2026-10-26)
  c_idle constant interval := interval '30 days';
  v_n integer;
begin
  -- 마지막 활동 = refresh 시각 → 없으면 updated_at → created_at.
  -- refreshed_at 은 timestamp without time zone(GoTrue 가 UTC 로 기록) → UTC 로 해석해 timestamptz 로 맞춘다.
  delete from auth.sessions s
  where coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) < now() - c_idle;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 외부 RPC 호출 차단: cron(postgres) 만 부른다
revoke all on function public.job_expire_inactive_sessions() from public, anon, authenticated;

-- 멱등 등록: 있으면 지우고 다시 건다. 19:15 UTC = 04:15 KST (cleanup 04:00·member_count_audit 04:32 와 겹치지 않게)
select cron.unschedule('expire-inactive-sessions') from cron.job where jobname = 'expire-inactive-sessions';
select cron.schedule('expire-inactive-sessions', '15 19 * * *', $$select public.job_expire_inactive_sessions()$$);
