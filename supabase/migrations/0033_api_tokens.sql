-- 0033_api_tokens.sql — 2026-10-19 AI 연동(MCP) 1단계: 개인 액세스 토큰(PAT)·감사·멱등. 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-19-ai-integration-design.md §4·§6·§8.
-- 신원: current_user_id() = coalesce(auth.uid(), GUC sgtudy.api_uid). GUC 는 api_authenticate 만 트랜잭션 한정으로 쓴다.
-- 재정의: current_user_id ← 0002.

create table public.api_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  name          varchar(40) not null,
  token_hash    char(64)    not null unique,          -- sha256(원문) hex
  token_prefix  varchar(16) not null,                 -- 'sgt_pat_' + 8 hex (목록 표시용)
  scopes        text[]      not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  http_window   timestamptz,                         -- 〔N7〕 라우트 인증 요청 분 단위 창
  http_count    int         not null default 0,
  constraint ck_api_tokens_scopes check (cardinality(scopes) >= 1 and scopes <@ array['read', 'curriculum:write', 'personal:write']::text[])
);
create index ix_api_tokens_user on public.api_tokens (user_id) where revoked_at is null;
alter table public.api_tokens enable row level security;   -- 정책 없음: RPC 전용

create table public.api_audit (
  id          bigint generated always as identity primary key,
  token_id    uuid        references public.api_tokens(id) on delete set null,
  user_id     uuid        references public.profiles(id) on delete cascade,
  source      varchar(8)  not null,                   -- PAT|OAUTH|SESSION
  op          varchar(40) not null,
  room_id     bigint      references public.rooms(id) on delete set null,
  dry_run     boolean,
  ok          boolean     not null,
  error_code  varchar(40),
  preview_id  varchar(16),                            -- 〔UX 재검토 D11〕 planHash 대신 api_plan_drafts.id
  summary     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index ix_api_audit_token_time on public.api_audit (token_id, created_at desc);
create index ix_api_audit_user_time  on public.api_audit (user_id, op, created_at desc);
alter table public.api_audit enable row level security;

-- 0002 판 + PAT 보조 신원. auth.uid() 가 먼저(로그인 세션이 있으면 GUC 무시)
create or replace function public.current_user_id()
returns uuid language sql stable set search_path = '' as $$
  select coalesce(auth.uid(), nullif(current_setting('sgtudy.api_uid', true), '')::uuid)
$$;

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
  end
$$;

create or replace function public.api_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"perMinute": 60, "httpPerMinute": 120, "appliesPerHour": 20, "plansPerHour": 120, "tokensPerUser": 10}'::jsonb
$$;

create or replace function public.api_token_json(t public.api_tokens) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', t.id::text, 'name', t.name, 'prefix', t.token_prefix, 'scopes', to_jsonb(t.scopes),
    'createdAt', public.iso(t.created_at), 'expiresAt', public.iso(t.expires_at), 'lastUsedAt', public.iso(t.last_used_at),
    'expired', t.expires_at <= public.app_now())
$$;

create or replace function public.pat_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'items', coalesce((
    select jsonb_agg(public.api_token_json(t) order by t.created_at desc, t.id)
    from public.api_tokens t where t.user_id = v_uid and t.revoked_at is null), '[]'::jsonb));
end $$;

create or replace function public.pat_create(p_name text, p_scopes text[], p_days int default 90) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_name   text := trim(coalesce(p_name, ''));
  v_scopes text[];
  v_token  text;
  t        public.api_tokens;
begin
  -- PAT 로 PAT 를 만들 수 없다(토큰 탈취 → 영구화 방지). 브라우저 세션 전용
  if auth.uid() is null then perform public.fail('API_FORBIDDEN', '토큰은 로그인한 화면에서만 만들 수 있어요'); end if;
  if length(v_name) < 1 or length(v_name) > 40 then
    perform public.fail('VALIDATION_FAILED', '토큰 이름은 1~40자예요', '{"field":"name"}'::jsonb);
  end if;
  select array_agg(distinct s order by s) into v_scopes from unnest(coalesce(p_scopes, '{}')) s;
  if v_scopes is null or not (v_scopes <@ array['read', 'curriculum:write', 'personal:write']::text[]) then
    perform public.fail('VALIDATION_FAILED', '권한 범위가 올바르지 않아요', '{"field":"scopes"}'::jsonb);
  end if;
  if p_days is null or p_days not in (30, 90, 365) then
    perform public.fail('VALIDATION_FAILED', '만료 기간은 30·90·365일 중 하나예요', '{"field":"days"}'::jsonb);
  end if;
  -- 〔C#7〕 같은 사용자의 동시 생성이 둘 다 9개를 보고 11개가 되지 않게: 사용자 잠금 → 개수 → insert (트랜잭션 끝까지 유지)
  perform pg_advisory_xact_lock(hashtextextended('sgtudy.pat:' || v_uid::text, 0));
  if (select count(*) from public.api_tokens where user_id = v_uid and revoked_at is null and expires_at > public.app_now())
     >= (public.api_limits() ->> 'tokensPerUser')::int then
    perform public.fail('API_TOKEN_LIMIT', '토큰은 10개까지 만들 수 있어요. 안 쓰는 토큰을 폐기해 주세요');
  end if;
  v_token := 'sgt_pat_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.api_tokens (user_id, name, token_hash, token_prefix, scopes, created_at, expires_at)
  values (v_uid, v_name, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), left(v_token, 16), v_scopes,
          public.app_now(), public.app_now() + make_interval(days => p_days))
  returning * into t;
  return public.api_token_json(t) || jsonb_build_object('token', v_token);
end $$;

create or replace function public.pat_revoke(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  update public.api_tokens set revoked_at = public.app_now()
  where id = p_id and user_id = v_uid and revoked_at is null;
  if not found then perform public.fail('NOT_FOUND', '토큰을 찾을 수 없어요'); end if;
  return public.pat_list();
end $$;

-- 내부: 토큰 → 사용자. 성공하면 이 트랜잭션 동안 current_user_id() 가 토큰 주인. GUC 를 쓰는 유일한 함수
create or replace function public.api_authenticate(p_token text, p_op text) returns public.api_tokens
language plpgsql security definer set search_path = '' as $$
declare
  t       public.api_tokens;
  v_scope text := public.api_scope_of(p_op);
  v_n     int;
begin
  if p_token is null or p_token !~ '^sgt_pat_[0-9a-f]{64}$' then
    perform public.fail('API_TOKEN_INVALID', '토큰이 올바르지 않아요');
  end if;
  select * into t from public.api_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found or t.revoked_at is not null then perform public.fail('API_TOKEN_INVALID', '토큰이 올바르지 않아요'); end if;
  if t.expires_at <= public.app_now() then perform public.fail('API_TOKEN_EXPIRED', '토큰이 만료됐어요. 새 토큰을 만들어 주세요'); end if;
  if v_scope is null then perform public.fail('API_UNKNOWN_OP', '지원하지 않는 작업이에요', jsonb_build_object('op', p_op)); end if;
  if v_scope <> 'any' and not (v_scope = any(t.scopes)) then
    perform public.fail('API_SCOPE_DENIED', '이 토큰으로는 할 수 없는 작업이에요', jsonb_build_object('scope', v_scope));
  end if;
  if p_op = 'whoami' then
    -- 〔N7〕 HTTP 요청(라우트 인증) 수: 토큰 행 하나의 분 단위 카운터. 같은 UPDATE(행 잠금)라 동시 요청에도 원자적
    update public.api_tokens set last_used_at = public.app_now(),
           http_count  = case when http_window = date_trunc('minute', public.app_now()) then http_count + 1 else 1 end,
           http_window = date_trunc('minute', public.app_now())
    where id = t.id returning http_count into v_n;
    if v_n > (public.api_limits() ->> 'httpPerMinute')::int then   -- 실패하면 이 UPDATE 도 롤백 → 카운터는 한도에 머문다
      perform public.fail('API_RATE_LIMITED', '요청이 너무 잦아요. 잠시 후 다시 해 주세요', '{"retryAfterSec":60}'::jsonb);
    end if;
  else
    update public.api_tokens set last_used_at = public.app_now() where id = t.id;
  end if;
  perform set_config('sgtudy.api_uid', t.user_id::text, true);
  return t;
end $$;

-- 〔N3〕 사용자 잠금(트랜잭션 끝까지). advisory xact 잠금은 같은 트랜잭션에서 다시 잡아도 즉시 통과
create or replace function public.api_user_lock(p_user uuid) returns void
language sql volatile set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('sgtudy.api:' || p_user::text, 0))
$$;

-- 〔C#7〕 volatile(잠금). 잠금 순서: (토큰 행) → 사용자 → (호출자가 이어서) 방 → 초안. 웹 직접 RPC 는 사용자 잠금을 잡지 않는다
create or replace function public.api_rate_check(p_token uuid, p_user uuid, p_op text, p_dry boolean, p_replay boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  l     jsonb := public.api_limits();
  v_now timestamptz;
  n     int;
begin
  if p_op <> 'whoami' then
    -- 같은 사용자의 다른 토큰·동시 요청이 같은 집계를 보고 함께 통과하지 않게 직렬화. 감사 insert 는 같은 트랜잭션 → 커밋 뒤 다음 대기자가 센다
    perform public.api_user_lock(p_user);
  end if;
  v_now := public.app_now();
  select count(*) into n from public.api_audit a
  where a.created_at > v_now - interval '1 minute'
    and case when p_token is null then a.user_id = p_user and a.token_id is null else a.token_id = p_token end;
  if n >= (l ->> 'perMinute')::int then
    perform public.fail('API_RATE_LIMITED', '요청이 너무 잦아요. 잠시 후 다시 해 주세요', '{"retryAfterSec":60}'::jsonb);
  end if;
  if p_op = 'whoami' then return; end if;   -- 〔C#6〕 라우트의 요청별 인증: 분당 한도만(자신은 감사·집계 안 됨)
  if p_op = 'curriculum_plan_preview' then
    select count(*) into n from public.api_audit a
    where a.user_id = p_user and a.op = 'curriculum_plan_preview' and a.created_at > v_now - interval '1 hour';
    if n >= (l ->> 'plansPerHour')::int then
      perform public.fail('API_RATE_LIMITED', '진행목표 미리보기는 한 시간에 120번까지예요', '{"retryAfterSec":3600}'::jsonb);
    end if;
  end if;
  if p_op = 'curriculum_plan_apply' and not coalesce(p_replay, false) then   -- 〔C#7〕 20번째 응답을 잃고 재시도하는 replay 는 막지 않는다
    select count(*) into n from public.api_audit a      -- 재생(replayed)은 summary.replayed=true 로 감사돼 세지 않는다(T6)
    where a.user_id = p_user and a.op = 'curriculum_plan_apply' and a.ok
      and coalesce((a.summary ->> 'replayed')::boolean, false) = false and a.created_at > v_now - interval '1 hour';
    if n >= (l ->> 'appliesPerHour')::int then
      perform public.fail('API_RATE_LIMITED', '진행목표 적용은 한 시간에 20번까지예요', '{"retryAfterSec":3600}'::jsonb);
    end if;
  end if;
end $$;

grant execute on function public.pat_create(text, text[], int) to authenticated;
grant execute on function public.pat_list()                    to authenticated;
grant execute on function public.pat_revoke(uuid)              to authenticated;
