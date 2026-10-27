-- 0052_ai_explain.sql — 2026-10-27 「AI에게 물어보기」(선택 용어를 그 방 관점으로 해설)의 상한·방별 캐시·RPC. 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-27-ask-ai-term-explain-design.md (D13 캐시 · D14 상한 · D15 권한 · D16 응시 중 거부 · D19 저장).
-- 추가형: 표 1개(ai_explain_cache, RPC 전용) + kind 제약 확장 + 재정의 2개(ai_limits ← 0049 · ai_turn_check ← 0049, 시그니처 동일 → GRANT 유지)
--   + 공개 RPC 2개(ai_explain_begin · ai_explain_done). api_invoke 허용 목록에는 넣지 않는다(MCP 비노출).
-- 캐시 행에는 정규화 용어와 해설만 — 선택 문맥·사용자 id 는 저장하지 않는다(D19).
-- 절: 1 스키마 · 2 ai_limits · 3 ai_turn_check · 4 ai_explain_begin · 5 ai_explain_done · 6 GRANT

-- ───────── 1. 스키마 ─────────
alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('room_interview', 'room_rounds', 'term_explain'));

create table public.ai_explain_cache (
  room_id     bigint not null references public.rooms(id) on delete cascade,
  term_key    text   not null,                 -- sha256(norm_term) hex 64
  norm_term   text   not null,                 -- 정규화 용어(표시·디버그용, ≤ 40cp)
  body        jsonb  not null,                 -- ExplainOut 그대로(kind='term' 만)
  model       text,
  hits        int    not null default 0,
  created_at  timestamptz not null default now(),
  last_hit_at timestamptz,
  primary key (room_id, term_key),
  constraint ck_ai_explain_cache_key check (term_key ~ '^[0-9a-f]{64}$')
);
create index ai_explain_cache_room_created_idx on public.ai_explain_cache (room_id, created_at);

alter table public.ai_explain_cache enable row level security;
revoke all on public.ai_explain_cache from anon, authenticated;   -- 정책 없음 = RPC 전용

-- ───────── 2. 상한 (GRANT 없음) ─────────
-- 0049 값 + 용어 해설(D14): 사용자 10분 10회 · 하루 60회 · 서비스 전체 하루 2,000회
create or replace function public.ai_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"perTenMin":30,"perDay":120,"startsPerDay":10,"globalPerDay":3000,"roundsPerDay":10,"roundsGlobalPerDay":300,"explainPerTenMin":10,"explainPerDay":60,"explainGlobalPerDay":2000}'::jsonb
$$;

-- ───────── 3. ai_turn_check (0049 본문 + term_explain 분기) ─────────
-- term_explain 은 인터뷰·회차의 공통 10분·하루 창에 합산하지 않고(그 창도 보지 않는다) 자기 창만 본다 — 해설은 잦고 싸서 인터뷰 창을 잠식하면 안 된다(D14).
-- room_interview·room_rounds 의 공통 창 집계에서 term_explain 행을 뺀다. term_explain 행은 started=false
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
  if p_kind is null or p_kind not in ('room_interview', 'room_rounds', 'term_explain') then
    perform public.fail('VALIDATION_FAILED', '알 수 없는 AI 기능이에요', '{"field":"kind"}'::jsonb);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sgtudy.ai:' || v_uid::text, 0));
  if p_kind = 'term_explain' then
    select count(*) filter (where u.created_at > v_now - interval '10 minutes')::int, count(*)::int
      into v_m, v_d
    from public.ai_usage u where u.user_id = v_uid and u.kind = 'term_explain' and u.created_at > v_now - interval '1 day';
    if v_m >= (v_lim ->> 'explainPerTenMin')::int then
      select min(u.created_at) into v_old from public.ai_usage u
       where u.user_id = v_uid and u.kind = 'term_explain' and u.created_at > v_now - interval '10 minutes';
      perform public.fail('RATE_LIMITED', 'AI 해설을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요',
        jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '10 minutes' - v_now))::int), 'window', 'explainTenMin'));
    end if;
    if v_d >= (v_lim ->> 'explainPerDay')::int then
      select min(u.created_at) into v_old from public.ai_usage u
       where u.user_id = v_uid and u.kind = 'term_explain' and u.created_at > v_now - interval '1 day';
      perform public.fail('RATE_LIMITED', '오늘은 AI 해설을 더 쓸 수 없어요 · 내일 다시 해 주세요',
        jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '1 day' - v_now))::int), 'window', 'explain'));
    end if;
    if (select count(*) from public.ai_usage u where u.kind = 'term_explain' and u.created_at > v_now - interval '1 day') >= (v_lim ->> 'explainGlobalPerDay')::int then
      perform public.fail('AI_BUDGET_EXCEEDED', '오늘은 AI 해설을 더 쓸 수 없어요 · 내일 다시 해 주세요');
    end if;
    insert into public.ai_usage (user_id, kind, started, created_at) values (v_uid, 'term_explain', false, v_now)
    returning id into v_id;
    return jsonb_build_object('id', v_id);
  end if;
  select count(*) filter (where u.created_at > v_now - interval '10 minutes')::int,
         count(*)::int,
         count(*) filter (where u.started)::int,
         count(*) filter (where u.kind = 'room_rounds')::int
    into v_m, v_d, v_s, v_r
  from public.ai_usage u where u.user_id = v_uid and u.kind <> 'term_explain' and u.created_at > v_now - interval '1 day';
  if v_m >= (v_lim ->> 'perTenMin')::int then
    select min(u.created_at) into v_old from public.ai_usage u
     where u.user_id = v_uid and u.kind <> 'term_explain' and u.created_at > v_now - interval '10 minutes';
    perform public.fail('RATE_LIMITED', 'AI 인터뷰를 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요',
      jsonb_build_object('retryAfterSec', greatest(1, ceil(extract(epoch from v_old + interval '10 minutes' - v_now))::int), 'window', 'tenMin'));
  end if;
  if v_d >= (v_lim ->> 'perDay')::int then
    select min(u.created_at) into v_old from public.ai_usage u
     where u.user_id = v_uid and u.kind <> 'term_explain' and u.created_at > v_now - interval '1 day';
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

-- ───────── 4. ai_explain_begin ─────────
-- 방(slug) → 권한(D15: 그룹장 · ACTIVE·INACTIVE 멤버) → 응시 중 거부(D16, 캐시보다 먼저) → 캐시(TTL 30일, 적중은 상한 안 씀) → 상한 → 방 메타.
-- 방 메타는 서버가 DB 에서 읽는다(D8) — 시험 문항·보기·정답·해설은 넣지 않는다
create or replace function public.ai_explain_begin(p_slug text, p_term_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  v_now   timestamptz := public.app_now();
  r       public.rooms;
  c       public.ai_explain_cache;
  v_turn  jsonb;
  v_round jsonb;
  v_tags  jsonb;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then
    perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요');
  end if;
  if r.leader_id <> v_uid and not exists (
       select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status in ('ACTIVE', 'INACTIVE')) then
    perform public.fail('NOT_MEMBER', '참가가 승인되면 쓸 수 있어요');
  end if;
  if p_term_key is null or p_term_key !~ '^[0-9a-f]{64}$' then
    perform public.fail('VALIDATION_FAILED', '용어를 다시 선택해 주세요', '{"field":"term"}'::jsonb);
  end if;
  if exists (
       select 1 from public.exam_attempts a
       join public.exams x on x.node_id = a.node_id
       join public.goal_nodes n on n.id = a.node_id
       where a.user_id = v_uid and a.status = 'IN_PROGRESS' and x.room_id = r.id and x.status = 'PUBLISHED'
         and n.archived_at is null and v_today <= n.end_date) then
    perform public.fail('EXAM_IN_PROGRESS', '시험을 제출한 뒤에 쓸 수 있어요');
  end if;

  select * into c from public.ai_explain_cache ec
   where ec.room_id = r.id and ec.term_key = p_term_key and ec.created_at > v_now - interval '30 days';
  if found then
    update public.ai_explain_cache set hits = hits + 1, last_hit_at = v_now
     where room_id = r.id and term_key = p_term_key;
    return jsonb_build_object('hit', true, 'body', c.body);
  end if;

  v_turn := public.ai_turn_check('term_explain', false);

  select coalesce(jsonb_agg(t.label order by rt.sort_order, t.slug), '[]'::jsonb) into v_tags
  from public.room_tags rt join public.tags t on t.slug = rt.tag_slug where rt.room_id = r.id;
  select jsonb_build_object('label', coalesce(n.label, ''), 'title', n.title, 'goal', left(n.description_md, 300)) into v_round
  from public.goal_nodes n where n.id = public.room_current_round_id(r.id, v_today);

  return jsonb_build_object('hit', false, 'id', (v_turn ->> 'id')::bigint, 'room', jsonb_build_object(
    'title', r.title, 'intro', r.intro, 'description', left(r.description_md, 600), 'tags', v_tags, 'round', v_round));
end $$;

-- ───────── 5. ai_explain_done ─────────
-- 모델 응답 뒤 한 번: 토큰 기록(ai_turn_done) + 캐시 upsert. 조용히 무시하는 경우 — 남의 id · term_explain 아닌 id · 이미 기록된 id(재사용 방지)
-- · 멤버 아님 · term_key 가 norm_term 의 sha256 이 아님 · body 모양이 다름 · kind 가 'term' 아님(not_term 은 저장하지 않는다)
create or replace function public.ai_explain_done(p_id bigint, p_slug text, p_term_key text, p_norm_term text, p_body jsonb,
                                                  p_in int, p_out int, p_cached int, p_model text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_now timestamptz := public.app_now();
  r     public.rooms;
begin
  if not exists (select 1 from public.ai_usage u
                 where u.id = p_id and u.user_id = v_uid and u.kind = 'term_explain' and u.model is null and u.input_tokens is null) then
    return;
  end if;
  perform public.ai_turn_done(p_id, p_in, p_out, p_cached, coalesce(p_model, ''));
  select * into r from public.rooms where slug = p_slug;
  if not found then return; end if;
  if r.leader_id <> v_uid and not exists (
       select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status in ('ACTIVE', 'INACTIVE')) then
    return;
  end if;
  if p_norm_term is null or char_length(p_norm_term) not between 1 and 40
     or p_term_key is distinct from encode(sha256(convert_to(p_norm_term, 'UTF8')), 'hex') then
    return;
  end if;
  if p_body is null or jsonb_typeof(p_body) is distinct from 'object' or p_body ->> 'kind' is distinct from 'term'
     or jsonb_typeof(p_body -> 'term') is distinct from 'string' or jsonb_typeof(p_body -> 'oneLiner') is distinct from 'string'
     or jsonb_typeof(p_body -> 'inContext') is distinct from 'string' or jsonb_typeof(p_body -> 'points') is distinct from 'array'
     or jsonb_typeof(p_body -> 'related') is distinct from 'array' or octet_length(p_body::text) > 8192 then
    return;
  end if;
  insert into public.ai_explain_cache (room_id, term_key, norm_term, body, model, hits, created_at, last_hit_at)
  values (r.id, p_term_key, p_norm_term, p_body, left(p_model, 64), 0, v_now, null)
  on conflict (room_id, term_key) do update
    set norm_term = excluded.norm_term, body = excluded.body, model = excluded.model,
        created_at = excluded.created_at, hits = 0, last_hit_at = null;
end $$;

-- ───────── 6. GRANT (공개 RPC 만). api_invoke 허용 목록에는 넣지 않는다(MCP 비노출) ─────────
grant execute on function public.ai_explain_begin(text, text) to authenticated;
grant execute on function public.ai_explain_done(bigint, text, text, text, jsonb, int, int, int, text) to authenticated;
