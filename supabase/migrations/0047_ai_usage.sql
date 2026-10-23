-- 0047_ai_usage.sql — 2026-10-23 방 만들기 AI 인터뷰 모드의 사용량·상한. 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-23-room-create-ai-interview-design.md (D17·D18 — 서버가 모델을 부르기 전에 상한을 본다).
-- 추가형: 표 1개(ai_usage, RPC 전용 · 클라이언트 읽기 없음) + 내부 헬퍼 1개 + 공개 RPC 2개. 기존 함수 재정의 없음.
-- 대화 내용·초안은 저장하지 않는다(D8·D18) — 행에는 시각·종류·토큰 수·모델 이름만.
-- 절: 1 스키마 · 2 내부 헬퍼 · 3 RPC · 4 GRANT

-- ───────── 1. 스키마 ─────────
create table public.ai_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('room_interview')),
  started       boolean not null default false,     -- 인터뷰 첫 턴(하루 시작 횟수 상한)
  input_tokens  int,
  output_tokens int,
  cached_tokens int,
  model         text,
  created_at    timestamptz not null default now()
);
create index ai_usage_user_idx on public.ai_usage (user_id, created_at desc);
create index ai_usage_created_idx on public.ai_usage (created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;   -- 정책 없음 = RPC 전용

-- ───────── 2. 내부 헬퍼 (GRANT 없음) ─────────
-- 상한(D17): 사용자 10분 30턴 · 하루 120턴 · 하루 시작 10회, 서비스 전체 하루 3,000턴. 숫자를 바꿀 땐 이 함수만 재정의한다
create or replace function public.ai_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"perTenMin":30,"perDay":120,"startsPerDay":10,"globalPerDay":3000}'::jsonb
$$;

-- ───────── 3. RPC ─────────
-- 모델 호출 전 한 번(D17·Review Focus 5): 상한을 넘으면 fail, 아니면 이 턴의 행을 남기고 {id} 를 돌려준다.
-- 사용자 창은 advisory 잠금으로 같은 사용자의 동시 턴이 같은 카운트를 보지 않게 한다(0041 comment_rate_check 와 같은 모양).
-- 전체 상한은 잠금 없이 센다 — 동시 요청 몇 건만큼 넘을 수 있지만 비용 상한으로는 충분하다
create or replace function public.ai_turn_check(p_kind text, p_started boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  v_lim  jsonb := public.ai_limits();
  v_now  timestamptz := public.app_now();
  v_m    int;
  v_d    int;
  v_s    int;
  v_old  timestamptz;
  v_id   bigint;
begin
  if p_kind is null or p_kind not in ('room_interview') then
    perform public.fail('VALIDATION_FAILED', '알 수 없는 AI 기능이에요', '{"field":"kind"}'::jsonb);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sgtudy.ai:' || v_uid::text, 0));
  select count(*) filter (where u.created_at > v_now - interval '10 minutes')::int,
         count(*)::int,
         count(*) filter (where u.started)::int
    into v_m, v_d, v_s
  from public.ai_usage u where u.user_id = v_uid and u.created_at > v_now - interval '1 day';
  if v_m >= (v_lim ->> 'perTenMin')::int then
    select min(u.created_at) into v_old from public.ai_usage u where u.user_id = v_uid and u.created_at > v_now - interval '10 minutes';
    perform public.fail('RATE_LIMITED', 'AI 인터뷰를 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '10 minutes' - v_now))::int), 'window', 'tenMin'));
  end if;
  if v_d >= (v_lim ->> 'perDay')::int then
    select min(u.created_at) into v_old from public.ai_usage u where u.user_id = v_uid and u.created_at > v_now - interval '1 day';
    perform public.fail('RATE_LIMITED', '오늘은 AI 인터뷰를 더 쓸 수 없어요 · 직접 입력으로 이어서 할 수 있어요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 day' - v_now))::int), 'window', 'day'));
  end if;
  if coalesce(p_started, false) and v_s >= (v_lim ->> 'startsPerDay')::int then
    select min(u.created_at) into v_old from public.ai_usage u where u.user_id = v_uid and u.started and u.created_at > v_now - interval '1 day';
    perform public.fail('RATE_LIMITED', '오늘은 AI 인터뷰를 더 시작할 수 없어요 · 직접 입력으로 만들어 주세요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 day' - v_now))::int), 'window', 'starts'));
  end if;
  if (select count(*) from public.ai_usage u where u.created_at > v_now - interval '1 day') >= (v_lim ->> 'globalPerDay')::int then
    perform public.fail('AI_BUDGET_EXCEEDED', '오늘은 AI 인터뷰를 더 쓸 수 없어요 · 직접 입력으로 만들어 주세요');
  end if;
  insert into public.ai_usage (user_id, kind, started, created_at)
  values (v_uid, p_kind, coalesce(p_started, false), v_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- 모델 응답 뒤 토큰 수 기록(실패해도 라우트는 무시한다). 내 행만 — 남의 id 면 조용히 0행
create or replace function public.ai_turn_done(p_id bigint, p_in int, p_out int, p_cached int, p_model text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
begin
  update public.ai_usage u
     set input_tokens = greatest(0, p_in), output_tokens = greatest(0, p_out), cached_tokens = greatest(0, p_cached), model = left(p_model, 64)
   where u.id = p_id and u.user_id = v_uid;
end $$;

-- ───────── 4. GRANT (공개 RPC 만 — ai_limits 는 GRANT 없음). api_invoke 허용 목록에는 넣지 않는다(MCP 비노출) ─────────
grant execute on function public.ai_turn_check(text, boolean) to authenticated;
grant execute on function public.ai_turn_done(bigint, int, int, int, text) to authenticated;
