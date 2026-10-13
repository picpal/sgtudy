-- 0010_cron.sql — pg_cron 등록 (02 §7). 시각은 UTC(KST −9h).
-- PGlite 에는 pg_cron 이 없다: 이 한 줄은 하니스가 걷어내고, cron.schedule 은 스텁(플랜 01)이 받는다.
create extension if not exists pg_cron;

-- 같은 이름으로 다시 돌리면 pg_cron(≥1.4)·스텁 모두 갱신한다
select cron.schedule('room_tick',          '*/5 * * * *', 'select public.room_tick()');            -- 5분마다 RECRUIT→ACTIVE, ACTIVE→ENDED
select cron.schedule('draft_blocked',      '5 15 * * *',  'select public.job_draft_blocked()');     -- 00:05 KST
select cron.schedule('round_started',      '1 15 * * *',  'select public.job_round_started()');     -- 00:01 KST
select cron.schedule('deadline_reminder',  '0 0 * * *',   'select public.job_deadline_reminder()'); -- 09:00 KST
select cron.schedule('completion_digest',  '0 0 * * *',   'select public.job_completion_digest()'); -- 09:00 KST
select cron.schedule('cleanup',            '0 19 * * *',  'select public.job_cleanup()');           -- 04:00 KST
select cron.schedule('member_count_audit', '32 19 * * *', 'select public.member_count_audit()');    -- 04:32 KST (room_tick */5 와 같은 분을 피한다)
