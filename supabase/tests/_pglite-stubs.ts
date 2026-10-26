// PGlite 용 Supabase 스텁. 마이그레이션·시드가 닿는 auth / cron / storage 객체만 같은 모양으로.
// RLS 는 PGlite(수퍼유저)에서 강제되지 않는다 — 정책의 진릿값은 헬퍼 함수로, 실제 차단은 *-db.test.ts 가 본다.
export const PGLITE_STUBS = `
create role anon; create role authenticated; create role service_role;

create schema auth;
create table auth.users (
  id uuid primary key,
  instance_id uuid default '00000000-0000-0000-0000-000000000000',
  aud text default 'authenticated',
  role text default 'authenticated',
  email text,
  encrypted_password text default '',
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}',
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_sign_in_at timestamptz,
  confirmation_token text default '', recovery_token text default '',
  email_change text default '', email_change_token_new text default '', email_change_token_current text default ''
);
create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null, provider text not null,
  identity_data jsonb not null default '{}',
  last_sign_in_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (provider_id, provider)
);
-- 0050 이 지우는 세션 — 실제 auth.sessions 와 같은 타입(refreshed_at 만 timestamp without time zone)
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz, updated_at timestamptz, not_after timestamptz,
  refreshed_at timestamp
);
create table auth.refresh_tokens (
  id bigserial primary key, token varchar(255), user_id varchar(255), revoked boolean,
  created_at timestamptz, updated_at timestamptz, parent varchar(255),
  session_id uuid references auth.sessions(id) on delete cascade
);
-- 테스트는 set_config('app.uid', <uuid>, true) 로 로그인 사용자를 흉내 낸다
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('app.role', true), ''), case when auth.uid() is null then 'anon' else 'authenticated' end) $$;

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
     on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql as
  $$ with d as (delete from cron.job where jobname = p_name returning 1) select exists (select 1 from d) $$;

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner_id text, metadata jsonb default '{}', created_at timestamptz default now()
);
alter table storage.objects enable row level security;
-- 진짜 storage.foldername 은 마지막 조각(파일명)을 뺀 경로 배열을 돌려준다
create function storage.foldername(p_name text) returns text[] language sql immutable as
  $$ select (string_to_array(p_name, '/'))[1 : array_length(string_to_array(p_name, '/'), 1) - 1] $$;
`;
