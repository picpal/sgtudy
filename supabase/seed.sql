-- 로컬·테스트 전용 시드 (02-domain-and-schema.md §8). `supabase db reset` 이 마이그레이션 뒤에 실행한다.
-- 기준일 2026-10-12. 섹션 순서: §1 사용자(plan 01) → §2 방·멤버·전역 태그·room_tags(plan 02) → §3 커리큘럼·배정·제출(plan 03) → §4 알림·설정 등 나머지(plan 04).
-- §4 는 §2 의 태그와 §3 의 제출을 다시 넣지 않는다(이미 있는 행은 읽기만). 각 섹션은 아래 기준일(internal.settings 'today') 줄 **위에**, 각자 하나의 do 블록으로 끼워 넣는다.

-- ═══════════ §1 사용자 (plan 01) ═══════════
-- 목업 등장 인물 전원. avatar_tone = src/lib/palette.ts NAME_TONE. uuid = 00000000-0000-4000-8000-0000000000NN.
-- 로컬 전용: auth.users 직접 INSERT(비밀번호 없음 — 로컬 로그인은 OTP/Inbucket). 호스팅에는 절대 돌리지 않는다.
-- supabase CLI 는 seed 를 pgx 배치로 보내 모든 문장을 먼저 Parse 한다 → 앞 문장이 만든 임시 테이블을 뒷 문장이 참조하면
-- `relation does not exist` 로 실패한다. 섹션은 문장 사이에 객체를 주고받지 않게 하나의 do 블록으로 감싼다.
do $seed1$
begin
  create temp table if not exists seed_users (n int primary key, email_local text, nickname text, tone text);
  insert into seed_users (n, email_local, nickname, tone) values
    ( 1, 'cheolsu',  '철수', 'blue'),
    ( 2, 'minsu',    '민수', 'mint'),
    ( 3, 'seoyeon',  '서연', 'blue'),
    ( 4, 'jihun',    '지훈', 'lav'),
    ( 5, 'hyeonu',   '현우', 'slate'),
    ( 6, 'sumin',    '수민', 'peach'),
    ( 7, 'yerin',    '예린', 'amber'),
    ( 8, 'taeho',    '태호', 'blue'),
    ( 9, 'gaeun',    '가은', 'amber'),
    (10, 'minjae',   '민재', 'mint'),
    (11, 'boram',    '보람', 'mint'),
    (12, 'dohyeon',  '도현', 'mint'),
    (13, 'haeun',    '하은', 'mint'),
    (14, 'siu',      '시우', 'mint'),
    (15, 'jieun',    '지은', 'peach'),
    (16, 'soyul',    '소율', 'peach'),
    (17, 'jiseong',  '지성', 'peach'),
    (18, 'eunji',    '은지', 'peach'),
    (19, 'hana',     '하나', 'lav'),
    (20, 'daeun',    '다은', 'lav'),
    (21, 'taeyun',   '태윤', 'lav'),
    (22, 'nayeon',   '나연', 'lav'),
    (23, 'dain',     '다인', 'lav'),
    (24, 'doyun',    '도윤', 'slate'),
    (25, 'arin',     '아린', 'amber'),
    (26, 'yujin',    '유진', 'amber'),
    (27, 'junseo',   '준서', 'amber'),
    (28, 'hyeonjun', '현준', 'amber'),
    (29, 'seungho',  '승호', 'blue')
  on conflict (n) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         email_local || '@sgtudy.local', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
         '', '', '', '', ''
  from seed_users
  on conflict (id) do nothing;

  -- GoTrue 가 이메일 로그인에 요구하는 identity 행
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, 'email',
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         now(), now(), now()
  from auth.users u
  where u.email like '%@sgtudy.local'
  on conflict (provider_id, provider) do nothing;

  -- 트리거가 만든 profiles 에 닉네임·tone 지정
  update public.profiles p
     set nickname = s.nickname,
         nickname_normalized = public.nickname_normalize(s.nickname),
         avatar_tone = s.tone
    from seed_users s
   where p.id = ('00000000-0000-4000-8000-' || lpad(s.n::text, 12, '0'))::uuid;

  drop table seed_users;
end
$seed1$;

-- ═══════════ 고정 기준일 (항상 이 파일의 마지막 문장) ═══════════
-- kst_today() 가 로컬·E2E 에서 항상 2026-10-12 를 돌려주게 한다(02 §8). 호스팅에는 seed 가 가지 않는다.
-- (alter database … set app.today 는 Supabase 비 superuser postgres 역할에서 거부되어 internal.settings 에 둔다.)
insert into internal.settings (key, value) values ('today', '2026-10-12') on conflict (key) do update set value = excluded.value;
