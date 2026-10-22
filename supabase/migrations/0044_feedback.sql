-- 0044_feedback.sql — 2026-10-22 의견 보내기(버그 신고·제안·문의). 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-22-feedback-design.md (D1~D12 권장안).
-- 추가형: 표 1개(feedback, RPC 전용 · 클라이언트 읽기 없음 — 운영자는 대시보드 service role 로 읽는다, D9) + 쓰기 RPC 1개.
-- 절: 1 스키마 · 2 내부 헬퍼 · 3 쓰기 RPC · 4 GRANT

-- ───────── 1. 스키마 (D6·D12) ─────────
create table public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid   references public.profiles(id) on delete set null,   -- 탈퇴해도 신고 내용은 남긴다(D12)
  kind        text   not null check (kind in ('BUG', 'IDEA', 'QUESTION', 'OTHER')),
  message     text   not null check (char_length(message) between 5 and 2000),
  context     jsonb  not null default '{}'::jsonb,                        -- 화면이 붙인 path·room·userAgent·viewport·appVersion(D5)
  status      text   not null default 'NEW' check (status in ('NEW', 'SEEN', 'DONE')),   -- 운영자가 대시보드에서 바꾼다
  created_at  timestamptz not null default now()
);
create index feedback_user_idx on public.feedback (user_id, created_at desc);
create index feedback_status_idx on public.feedback (status, id desc);

alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;   -- 정책 없음 = RPC 전용(D8: 본인 목록도 없음)

-- ───────── 2. 내부 헬퍼 (GRANT 없음) ─────────
-- 상한(D3·D5·D7)
create or replace function public.feedback_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"messageMin":5,"messageMax":2000,"contextValueMax":500,"per10Min":5,"perDay":20}'::jsonb
$$;

-- 레이트 리밋(D7): 사용자당 10분 5건 · 하루 20건. advisory 잠금으로 같은 사용자의 동시 접수가 같은 카운트를 보지 않게 한다(0041 comment_rate_check 와 같은 모양)
create or replace function public.feedback_rate_check(p_uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_lim jsonb := public.feedback_limits();
  v_now timestamptz := public.app_now();
  v_m   int;
  v_d   int;
  v_old timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('sgtudy.feedback:' || p_uid::text, 0));
  select count(*) filter (where f.created_at > v_now - interval '10 minutes')::int, count(*)::int into v_m, v_d
  from public.feedback f where f.user_id = p_uid and f.created_at > v_now - interval '1 day';
  if v_m >= (v_lim ->> 'per10Min')::int then
    select min(f.created_at) into v_old from public.feedback f where f.user_id = p_uid and f.created_at > v_now - interval '10 minutes';
    perform public.fail('RATE_LIMITED', '의견을 너무 자주 보내고 있어요 · 잠시 후 다시 보내 주세요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '10 minutes' - v_now))::int), 'window', '10min'));
  end if;
  if v_d >= (v_lim ->> 'perDay')::int then
    select min(f.created_at) into v_old from public.feedback f where f.user_id = p_uid and f.created_at > v_now - interval '1 day';
    perform public.fail('RATE_LIMITED', '오늘은 의견을 더 보낼 수 없어요 · 내일 다시 보내 주세요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 day' - v_now))::int), 'window', 'day'));
  end if;
end $$;

-- context 검증(D5): 객체 · 허용 키만 · 값은 문자열(≤500자). 사용자 id·이메일은 받지 않는다 — 서버가 auth.uid() 로 붙인다
create or replace function public.feedback_validate_context(p_ctx jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v_max int := (public.feedback_limits() ->> 'contextValueMax')::int;
begin
  if jsonb_typeof(p_ctx) is distinct from 'object' then
    perform public.fail('VALIDATION_FAILED', '함께 보내는 정보가 올바르지 않아요', '{"field":"context"}'::jsonb);
  end if;
  for k in select jsonb_object_keys(p_ctx) loop
    if not (k = any(array['path', 'room', 'userAgent', 'viewport', 'appVersion'])) then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
    if jsonb_typeof(p_ctx -> k) is distinct from 'string' or char_length(p_ctx ->> k) > v_max then
      perform public.fail('VALIDATION_FAILED', '함께 보내는 정보가 올바르지 않아요', jsonb_build_object('field', k));
    end if;
  end loop;
end $$;

-- ───────── 3. 쓰기 RPC ─────────
-- D1: 로그인만(온보딩 전 계정도 — require_user 대신 uid·프로필만 확인). 내용은 앞뒤 공백을 빼고 저장(0040 notice_trim 과 같은 공백 집합)
create or replace function public.feedback_submit(p_kind text, p_message text, p_context jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v_lim jsonb := public.feedback_limits();
  v_msg text := public.notice_trim(coalesce(p_message, ''));
  f     public.feedback;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid) then
    perform public.fail('AUTH_REQUIRED', '로그인이 필요해요');
  end if;
  if p_kind is null or p_kind not in ('BUG', 'IDEA', 'QUESTION', 'OTHER') then
    perform public.fail('VALIDATION_FAILED', '종류를 골라 주세요', '{"field":"kind"}'::jsonb);
  end if;
  if char_length(v_msg) not between (v_lim ->> 'messageMin')::int and (v_lim ->> 'messageMax')::int then
    perform public.fail('VALIDATION_FAILED', '내용은 5~2,000자예요', '{"field":"message"}'::jsonb);
  end if;
  perform public.feedback_validate_context(coalesce(p_context, '{}'::jsonb));
  perform public.feedback_rate_check(v_uid);
  insert into public.feedback (user_id, kind, message, context, created_at)
  values (v_uid, p_kind, v_msg, coalesce(p_context, '{}'::jsonb), public.app_now())
  returning * into f;
  return jsonb_build_object('id', f.id::text, 'createdAt', public.iso(f.created_at));
end $$;

-- ───────── 4. GRANT (공개 RPC 만 — feedback_* 헬퍼는 GRANT 없음) ─────────
grant execute on function public.feedback_submit(text, text, jsonb) to authenticated;
