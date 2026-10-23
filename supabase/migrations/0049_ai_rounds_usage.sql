-- 0049_ai_rounds_usage.sql — 2026-10-23 방 만들기 AI 회차 초안(POST /api/rooms/rounds)의 사용량·상한. 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-23-room-create-ai-rounds-design.md (D29 — 별도 kind + 자체 상한, 사용자 창은 공유).
-- 한 번이 인터뷰 턴의 10~15배 비용이라 전체 하루 상한을 인터뷰(3,000)와 나눈다. 사용자 10분·하루 창은 두 kind 합산(루프 방지).
-- 재정의: ai_limits ← 0047 · ai_turn_check ← 0047. 시그니처 동일 → 0047 의 GRANT 가 그대로 유지된다(재선언 없음).
-- ai_turn_done 무변경. api_invoke 허용 목록에는 넣지 않는다(MCP 비노출).
-- 절: 1 스키마 · 2 내부 헬퍼 · 3 RPC

-- ───────── 1. 스키마 ─────────
alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('room_interview', 'room_rounds'));

-- ───────── 2. 내부 헬퍼 (GRANT 없음) ─────────
-- 0047 값 + 회차 초안: 사용자 하루 10회(다시 생성 포함) · 서비스 전체 하루 300회
create or replace function public.ai_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"perTenMin":30,"perDay":120,"startsPerDay":10,"globalPerDay":3000,"roundsPerDay":10,"roundsGlobalPerDay":300}'::jsonb
$$;

-- ───────── 3. RPC ─────────
-- 0047 본문 + kind 분기. 공통(10분·하루)은 두 kind 합산 → room_interview 면 시작·전체(인터뷰 행만) → room_rounds 면 내 하루 rounds·전체 rounds.
-- room_rounds 행은 started 를 항상 false 로 남긴다(인터뷰 시작 횟수에 안 잡힌다)
create or replace function public.ai_turn_check(p_kind text, p_started boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  v_lim  jsonb := public.ai_limits();
  v_now  timestamptz := public.app_now();
  v_m    int;
  v_d    int;
  v_s    int;
  v_r    int;
  v_old  timestamptz;
  v_id   bigint;
begin
  if p_kind is null or p_kind not in ('room_interview', 'room_rounds') then
    perform public.fail('VALIDATION_FAILED', '알 수 없는 AI 기능이에요', '{"field":"kind"}'::jsonb);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sgtudy.ai:' || v_uid::text, 0));
  select count(*) filter (where u.created_at > v_now - interval '10 minutes')::int,
         count(*)::int,
         count(*) filter (where u.started)::int,
         count(*) filter (where u.kind = 'room_rounds')::int
    into v_m, v_d, v_s, v_r
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
  if p_kind = 'room_interview' then
    if coalesce(p_started, false) and v_s >= (v_lim ->> 'startsPerDay')::int then
      select min(u.created_at) into v_old from public.ai_usage u where u.user_id = v_uid and u.started and u.created_at > v_now - interval '1 day';
      perform public.fail('RATE_LIMITED', '오늘은 AI 인터뷰를 더 시작할 수 없어요 · 직접 입력으로 만들어 주세요',
        jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 day' - v_now))::int), 'window', 'starts'));
    end if;
    if (select count(*) from public.ai_usage u where u.kind = 'room_interview' and u.created_at > v_now - interval '1 day') >= (v_lim ->> 'globalPerDay')::int then
      perform public.fail('AI_BUDGET_EXCEEDED', '오늘은 AI 인터뷰를 더 쓸 수 없어요 · 직접 입력으로 만들어 주세요');
    end if;
  else
    if v_r >= (v_lim ->> 'roundsPerDay')::int then
      select min(u.created_at) into v_old from public.ai_usage u where u.user_id = v_uid and u.kind = 'room_rounds' and u.created_at > v_now - interval '1 day';
      perform public.fail('RATE_LIMITED', '오늘은 회차 초안을 더 만들 수 없어요 · 방을 만든 뒤 진행목표에서 채울 수 있어요',
        jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 day' - v_now))::int), 'window', 'rounds'));
    end if;
    if (select count(*) from public.ai_usage u where u.kind = 'room_rounds' and u.created_at > v_now - interval '1 day') >= (v_lim ->> 'roundsGlobalPerDay')::int then
      perform public.fail('AI_BUDGET_EXCEEDED', '오늘은 회차 초안을 더 만들 수 없어요 · 방을 만든 뒤 진행목표에서 채울 수 있어요');
    end if;
  end if;
  insert into public.ai_usage (user_id, kind, started, created_at)
  values (v_uid, p_kind, p_kind = 'room_interview' and coalesce(p_started, false), v_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;
