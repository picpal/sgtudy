-- 공통 헬퍼 (00-overview "공통 계약", 01-decisions D5·D7·D13). 순수 함수는 IMMUTABLE, 설정·테이블을 읽는 함수는 STABLE.
-- 규칙: 모든 함수 search_path = '' + 스키마 한정(DEFINER 여부 무관, linter function_search_path_mutable). 에러는 fail() 만.

-- ───────── 함수 권한 (D7) ─────────
-- Postgres 는 새 함수에 EXECUTE TO PUBLIC 을, Supabase 는 public 스키마 함수에 anon·authenticated GRANT 를 기본으로 준다.
-- PostgREST 는 public 의 실행 가능한 함수를 전부 RPC 로 연다 → 이후 만드는 함수는 기본 비공개로 하고,
-- 03-api RPC 열의 공개 함수만 각 마이그레이션이 명시적으로 GRANT 한다. 개별 `revoke … from anon, authenticated` 는 쓰지 않는다.
-- 스키마 한정 기본 권한(in schema public)은 전역 기본값에 "더해질" 뿐이라 PUBLIC 의 내장 EXECUTE 를 걷어내지 못한다
-- → PUBLIC 은 전역 형태로 먼저 걷어내고, Supabase 가 anon·authenticated 에 명시 부여하는 기본 GRANT 는 스키마 한정 형태로 걷어낸다.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- 쓰기는 전부 RPC(SECURITY DEFINER) 로만 한다 — 이후 만드는 테이블·뷰에 anon/authenticated 쓰기 권한을 기본으로 주지 않는다(뷰 write-through 방어, D7).
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;

-- ───────── 에러 ─────────
create or replace function public.fail(p_code text, p_detail text, p_hint jsonb default null)
returns void language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = p_detail, hint = coalesce(p_hint, '{}'::jsonb)::text;
end $$;

-- ───────── 사용자 ─────────
-- auth.uid() 의 유일한 래퍼(D13). GUC 폴백 없음 — PGlite 에서는 auth.uid() 스텁이 app.uid 를 읽는다.
create or replace function public.current_user_id()
returns uuid language sql stable set search_path = '' as $$
  select auth.uid()
$$;

create or replace function public.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v_nick text;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  select nickname into v_nick from public.profiles where id = v_uid;
  if not found or v_nick is null then perform public.fail('ONBOARDING_REQUIRED', '닉네임을 먼저 정해 주세요'); end if;
  return v_uid;
end $$;

create or replace function public.person_json(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('userId', p.id::text, 'nickname', coalesce(p.nickname, ''), 'tone', p.avatar_tone)
  from public.profiles p where p.id = p_user
$$;

-- ───────── 날짜 ─────────
-- 로컬·E2E 고정 기준일 저장소(seed 마지막 줄이 'today' 를 넣는다). PostgREST 에 노출되지 않는 스키마, anon/authenticated 접근 없음.
-- `alter database postgres set app.today` 는 Supabase 의 postgres 역할(비 superuser)에서 42501 로 거부되어 테이블에 둔다.
create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;
create table if not exists internal.settings (key text primary key, value text not null);
revoke all on internal.settings from public, anon, authenticated;

-- 우선순위: 세션 설정 app.today(테스트) → internal.settings 'today'(로컬 seed) → 서울 날짜. 호스팅에는 행이 없어 실제 날짜.
create or replace function public.kst_today()
returns date language sql stable security definer set search_path = '' as $$
  select coalesce(
    nullif(current_setting('app.today', true), '')::date,
    (select s.value::date from internal.settings s where s.key = 'today'),
    (now() at time zone 'Asia/Seoul')::date)
$$;

-- 마감 = end_date 다음날 00:00 KST (exclusive). 제출 시각 >= 마감 이면 지각.
create or replace function public.kst_deadline(p_end date)
returns timestamptz language sql stable set search_path = '' as $$
  select ((p_end + 1)::timestamp at time zone 'Asia/Seoul')
$$;

create or replace function public.iso(p_ts timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- ───────── 상태 (D5) ─────────
create or replace function public.task_code(p_s date, p_e date, p_first timestamptz, p_late boolean, p_today date)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_first is not null then case when p_late then 'late' else 'done' end
    when p_today < p_s then 'planned'
    when p_today > p_e then 'missed'
    else 'open' end
$$;

create or replace function public.leaf_state(p_asg int, p_sub int, p_s date, p_e date, p_today date)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_asg = 0 then 'unassigned'
    when p_sub = p_asg then 'complete'
    when p_today < p_s then 'planned'
    when p_today > p_e then 'delayed'
    else 'progress' end
$$;

-- round(numeric) 은 .5 를 0 에서 먼 쪽으로 → 양수에서 half-up. 5/8 → 62.5 → 63
create or replace function public.pct(p_asg int, p_sub int)
returns int language sql immutable set search_path = '' as $$
  select case when p_asg = 0 then null else round(p_sub * 100.0 / p_asg)::int end
$$;

-- ───────── slug (D1) ─────────
-- 영문·숫자만 남겨 '-' 로 잇는다. 아무것도 안 남으면 r-<base36(id)>. 최대 50자(충돌 접미 '-2' 자리를 남긴다).
create or replace function public.slugify(p_title text, p_id bigint)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text;
  v_n bigint := p_id;
  v_b36 text := '';
  v_digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
begin
  v := lower(p_title);
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := trim(both '-' from v);
  if v = '' then
    if v_n = 0 then v_b36 := '0'; end if;
    while v_n > 0 loop
      v_b36 := substr(v_digits, (v_n % 36)::int + 1, 1) || v_b36;
      v_n := v_n / 36;
    end loop;
    return 'r-' || v_b36;
  end if;
  return trim(both '-' from left(v, 50));
end $$;

-- ───────── 트리거 ─────────
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_rooms_updated_at        before update on public.rooms        for each row execute function public.set_updated_at();
create trigger trg_room_members_updated_at before update on public.room_members for each row execute function public.set_updated_at();
create trigger trg_goal_nodes_updated_at   before update on public.goal_nodes   for each row execute function public.set_updated_at();
create trigger trg_submissions_updated_at  before update on public.submissions  for each row execute function public.set_updated_at();

-- I9: first_submitted_at / is_late 는 최초 제출 시 고정
create or replace function public.submissions_guard_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.first_submitted_at is distinct from old.first_submitted_at or new.is_late is distinct from old.is_late then
    perform public.fail('FIELD_LOCKED', '최초 제출 시각과 지각 여부는 바꿀 수 없어요',
                        jsonb_build_object('field', case when new.is_late is distinct from old.is_late then 'isLate' else 'firstSubmittedAt' end));
  end if;
  return new;
end $$;

create trigger trg_submissions_immutable before update on public.submissions
  for each row execute function public.submissions_guard_immutable();

-- 이메일 변경 동기화 (0001 의 트리거는 INSERT 만). handle_new_auth_user 의 ON CONFLICT … SET email 이 UPDATE 도 처리한다.
create trigger on_auth_user_email_updated after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.handle_new_auth_user();

-- ───────── 닉네임 (03-api §1) ─────────
-- 2~16자, 한글 음절·영문·숫자·'_'·'.'·단일 공백(앞뒤 불가). 정규화 = trim → NFC → lower, UNIQUE 는 정규화값.
create or replace function public.nickname_normalize(p_value text)
returns text language sql immutable set search_path = '' as $$
  select lower(normalize(btrim(p_value), NFC))
$$;

create or replace function public.nickname_problem(p_value text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := normalize(coalesce(p_value, ''), NFC);
  v_norm text;
  v_reserved constant text[] := array['관리자', 'admin', 'sgtudy', '슥터디'];
  w text;
begin
  -- 앞뒤 공백·탭·전각 공백·제어문자는 그대로 거부(사용자가 보낸 문자열 그대로 검사)
  if v <> btrim(v) or char_length(v) < 2 or char_length(v) > 16 then return 'invalid'; end if;
  if v !~ '^[가-힣A-Za-z0-9._]+( [가-힣A-Za-z0-9._]+)*$' then return 'invalid'; end if;
  v_norm := public.nickname_normalize(v);
  foreach w in array v_reserved loop
    if position(w in v_norm) > 0 then return 'reserved'; end if;
  end loop;
  return null;
end $$;

-- ───────── 메타 ─────────
-- 공개 RPC 는 전부 SECURITY DEFINER (내부 헬퍼는 GRANT 되지 않으므로 INVOKER 면 권한 오류).
create or replace function public.meta_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'serverTime', public.iso(now()));
end $$;

-- ───────── 나 ─────────
-- 온보딩 전에도 호출 가능(require_user 아님). initial = 닉네임 첫 글자, 없으면 이메일 첫 글자.
create or replace function public.me_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v jsonb;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  select jsonb_build_object(
           'id', p.id::text,
           'email', p.email::text,
           'nickname', p.nickname,
           'initial', left(coalesce(p.nickname, p.email::text), 1),
           'tone', p.avatar_tone,
           'onboarded', p.nickname is not null,
           'optionalMailEnabled', p.optional_mail_enabled,
           'unreadCount', (select count(*)::int from public.notifications n where n.user_id = p.id and n.read_at is null),
           'today', to_char(public.kst_today(), 'YYYY-MM-DD'))
    into v
  from public.profiles p where p.id = v_uid;
  if v is null then perform public.fail('NOT_FOUND', '프로필이 없어요'); end if;
  return v;
end $$;

create or replace function public.me_update(p_nickname text default null, p_optional_mail_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v_problem text;
  v_nick text;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  if p_nickname is not null then
    v_problem := public.nickname_problem(p_nickname);
    if v_problem = 'invalid' then
      perform public.fail('NICKNAME_INVALID', '닉네임은 2~16자, 한글·영문·숫자·_·.·공백만 쓸 수 있어요', '{"field":"nickname"}'::jsonb);
    elsif v_problem = 'reserved' then
      perform public.fail('NICKNAME_RESERVED', '사용할 수 없는 닉네임이에요', '{"field":"nickname"}'::jsonb);
    end if;
    v_nick := normalize(btrim(p_nickname), NFC);
    begin
      update public.profiles
         set nickname = v_nick, nickname_normalized = public.nickname_normalize(v_nick)
       where id = v_uid;
    exception when unique_violation then
      perform public.fail('NICKNAME_TAKEN', '이미 쓰고 있는 닉네임이에요', '{"field":"nickname"}'::jsonb);
    end;
  end if;
  if p_optional_mail_enabled is not null then
    update public.profiles set optional_mail_enabled = p_optional_mail_enabled where id = v_uid;
  end if;
  return public.me_get();
end $$;

create or replace function public.nickname_check(p_value text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.current_user_id();
  v_problem text;
begin
  if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
  v_problem := public.nickname_problem(p_value);
  if v_problem is not null then return jsonb_build_object('available', false, 'reason', v_problem); end if;
  if exists (select 1 from public.profiles p
             where p.nickname_normalized = public.nickname_normalize(p_value) and p.id <> v_uid) then
    return jsonb_build_object('available', false, 'reason', 'taken');
  end if;
  return jsonb_build_object('available', true);
end $$;

-- ───────── 공개 RPC GRANT (D7, 03-api §1) ─────────
grant execute on function public.meta_get()                        to anon, authenticated;
grant execute on function public.me_get()                          to authenticated;
grant execute on function public.me_update(text, boolean)          to authenticated;
grant execute on function public.nickname_check(text)              to authenticated;
